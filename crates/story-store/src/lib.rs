//! Platform-independent project storage. No GUI, network, or arbitrary paths from IPC.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use uuid::Uuid;

const MAX_SIZE: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct Error {
    pub status: u16,
    pub message: String,
}
impl Error {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::new(500, format!("文件操作失败：{error}"))
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::new(400, "剧本 JSON 格式无效")
    }
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub size: u64,
    pub last_modified: u64,
    pub hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub name: String,
    pub text: String,
    pub stamp: Stamp,
    pub binding_id: String,
}

struct Binding {
    name: String,
    project_id: String,
}
pub struct Store {
    root: PathBuf,
    bindings: HashMap<String, Binding>,
}

fn nonce() -> String {
    Uuid::new_v4().simple().to_string()
}
fn millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn validate_story(text: &str) -> Result<Value> {
    if text.len() as u64 > MAX_SIZE {
        return Err(Error::new(413, "剧本超过 25 MB"));
    }
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))?;
    let valid_id = value["id"].as_str().is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 100
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    });
    if value["format"] != "xuxian.story"
        || !matches!(value["version"].as_u64(), Some(1..=4))
        || !valid_id
        || !value["routes"]
            .as_array()
            .is_some_and(|a| !a.is_empty() && a.len() <= 100)
        || !value["chapters"]
            .as_array()
            .is_some_and(|a| a.len() <= 3000)
        || !value["title"].is_string()
    {
        return Err(Error::new(400, "不是有效的叙线剧本文件（支持 JSON v1–v4）"));
    }
    Ok(value)
}

fn valid_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    !name.is_empty()
        && name.len() <= 240
        && !name.starts_with('.')
        && !name.ends_with(['.', ' '])
        && name.to_ascii_lowercase().ends_with(".json")
        && !reserved.contains(&stem.as_str())
        && !name
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
}

fn title_name(title: &str) -> String {
    let clean: String = title
        .chars()
        .take(60)
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_end_matches('.');
    let name = format!("{clean}.story.json");
    if clean.is_empty() || !valid_name(&name) {
        "未命名剧本".into()
    } else {
        clean.into()
    }
}

fn read_story(path: &Path) -> Result<(String, Value, Stamp)> {
    let meta = fs::symlink_metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            Error::new(404, "项目文件不存在，请刷新项目列表")
        } else {
            e.into()
        }
    })?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(Error::new(400, "项目必须是普通 JSON 文件"));
    }
    if meta.len() > MAX_SIZE {
        return Err(Error::new(413, "剧本超过 25 MB"));
    }
    let bytes = fs::read(path)?;
    let stamp = Stamp {
        size: bytes.len() as u64,
        last_modified: meta
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        hash: format!("{:x}", Sha256::digest(&bytes)),
    };
    let text = String::from_utf8(bytes).map_err(|_| Error::new(400, "剧本不是 UTF-8 文本"))?;
    let project = validate_story(&text)?;
    Ok((text, project, stamp))
}

/// Temp-file replacement never truncates the original if a write fails.
fn atomic_write(path: &Path, text: &str) -> Result<()> {
    let parent = path.parent().ok_or_else(|| Error::new(400, "无效目录"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(text.as_bytes())?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| Error::from(e.error))?;
    Ok(())
}

impl Store {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root)?;
        if fs::symlink_metadata(&root)?.file_type().is_symlink() {
            return Err(Error::new(400, "项目目录不能是符号链接"));
        }
        Ok(Self {
            root,
            bindings: HashMap::new(),
        })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    fn path(&self, name: &str) -> Result<PathBuf> {
        if !valid_name(name) {
            return Err(Error::new(400, "项目文件名无效"));
        }
        let path = self.root.join(name);
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(Error::new(400, "不接受符号链接项目"));
        }
        Ok(path)
    }
    fn subdirectory(&self, name: &str) -> Result<PathBuf> {
        let path = self.root.join(name);
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(Error::new(400, "备份/回收站目录不能是符号链接"));
        }
        fs::create_dir_all(&path)?;
        Ok(path)
    }
    fn unique_name(&self, title: &str) -> String {
        let stem = title_name(title);
        let mut name = format!("{stem}.story.json");
        let mut suffix = 2;
        while self.root.join(&name).exists() {
            name = format!("{stem} ({suffix}).story.json");
            suffix += 1;
        }
        name
    }
    pub fn open(&mut self, name: &str) -> Result<Opened> {
        let (text, project, stamp) = read_story(&self.path(name)?)?;
        let binding_id = nonce();
        self.bindings.insert(
            binding_id.clone(),
            Binding {
                name: name.into(),
                project_id: project["id"].as_str().unwrap().into(),
            },
        );
        Ok(Opened {
            name: name.into(),
            text,
            stamp,
            binding_id,
        })
    }
    pub fn list(&self) -> Result<Value> {
        let mut items: Vec<Value> = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !valid_name(&name) {
                continue;
            }
            if let Ok((_, p, stamp)) = read_story(&entry.path()) {
                items.push(json!({"fileName":name,"title":p["title"],"id":p["id"],"modified":stamp.last_modified,
                    "routes":p["routes"].as_array().map_or(0,Vec::len),"chapters":p["chapters"].as_array().map_or(0,Vec::len),
                    "characters":p["characters"].as_array().map_or(0,Vec::len)}));
            }
        }
        items.sort_by_key(|p| std::cmp::Reverse(p["modified"].as_u64().unwrap_or_default()));
        items.truncate(500);
        Ok(json!({"items":items,"directory":self.root.to_string_lossy()}))
    }
    pub fn create(&mut self, text: &str) -> Result<Opened> {
        let project = validate_story(text)?;
        let title = project["title"].as_str().unwrap();
        if title.trim().is_empty() {
            return Err(Error::new(400, "项目名称不能为空"));
        }
        let name = self.unique_name(title);
        atomic_write(&self.path(&name)?, text.trim_start_matches('\u{feff}'))?;
        self.open(&name)
    }
    /// Identity checks must cover the whole library, including entries beyond its display limit.
    pub fn contains_project(&self, project_id: &str) -> Result<bool> {
        for entry in fs::read_dir(&self.root)? {
            if let Ok((_, project, _)) = read_story(&entry?.path()) {
                if project["id"].as_str() == Some(project_id) {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    pub fn save(
        &mut self,
        binding: &str,
        text: &str,
        stamp: Option<Stamp>,
        force: bool,
    ) -> Result<Opened> {
        let project = validate_story(text)?;
        let binding = self
            .bindings
            .get(binding)
            .ok_or_else(|| Error::new(409, "源文件关联已失效，请重新打开项目"))?;
        if project["id"].as_str() != Some(&binding.project_id) {
            return Err(Error::new(409, "源文件属于另一份剧本"));
        }
        let name = binding.name.clone();
        let path = self.path(&name)?;
        let (old_text, _, actual) =
            read_story(&path).map_err(|_| Error::new(409, "源文件已删除或无法读取，请另存"))?;
        if !force && stamp.as_ref() != Some(&actual) {
            return Err(Error::new(409, "源文件已在外部修改，请确认后再覆盖"));
        }
        let backups = self.subdirectory("_备份")?;
        let prefix = format!("{}-", project["id"].as_str().unwrap());
        atomic_write(
            &backups.join(format!("{prefix}{}-{}.json", millis(), nonce())),
            &old_text,
        )?;
        // Keep thirty automatic save backups per project; update snapshots are separate folders.
        let mut previous: Vec<_> = fs::read_dir(&backups)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix) && e.path().is_file())
            .collect();
        previous.sort_by_key(|e| e.file_name());
        let excess = previous.len().saturating_sub(30);
        for entry in previous.into_iter().take(excess) {
            let _ = fs::remove_file(entry.path());
        }
        atomic_write(&path, text)?;
        self.open(&name)
    }
    pub fn duplicate(&mut self, name: &str) -> Result<Opened> {
        let (_, mut project, _) = read_story(&self.path(name)?)?;
        project["id"] = json!(format!("project_{}", nonce()));
        project["title"] = json!(format!("{} 副本", project["title"].as_str().unwrap()));
        self.create(&serde_json::to_string_pretty(&project)?)
    }
    pub fn rename(&mut self, name: &str, title: &str) -> Result<Opened> {
        if title.trim().is_empty() || title.chars().count() > 200 {
            return Err(Error::new(400, "项目名称应为 1–200 个字符"));
        }
        let path = self.path(name)?;
        let (old, mut project, _) = read_story(&path)?;
        project["title"] = json!(title.trim());
        let target = self.unique_name(title);
        let destination = self.path(&target)?;
        // Copy first, then remove the old path. Failure leaves at least one complete copy.
        atomic_write(&destination, &serde_json::to_string_pretty(&project)?)?;
        if let Err(e) = fs::remove_file(&path) {
            let _ = fs::remove_file(&destination);
            return Err(e.into());
        }
        let backup =
            self.subdirectory("_备份")?
                .join(format!("rename-{}-{}.json", millis(), nonce()));
        let _ = atomic_write(&backup, &old);
        self.open(&target)
    }
    pub fn delete(&mut self, name: &str) -> Result<Value> {
        let path = self.path(name)?;
        read_story(&path)?;
        let trash = self.subdirectory("_回收站")?;
        fs::rename(
            path,
            trash.join(format!("{}-{}-{name}", millis(), &nonce()[..6])),
        )?;
        self.bindings.retain(|_, binding| binding.name != name);
        Ok(json!({"deleted":true}))
    }
    pub fn import_folder(&mut self, folder: &Path) -> Result<Value> {
        let mut imported = 0;
        let mut skipped = 0;
        let mut ids = std::collections::HashSet::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            if let Ok((_, p, _)) = read_story(&entry.path()) {
                ids.insert(p["id"].as_str().unwrap().to_owned());
            }
        }
        for entry in fs::read_dir(folder)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.to_ascii_lowercase().ends_with(".json") {
                continue;
            }
            match read_story(&entry.path()) {
                Ok((text, p, _)) if !ids.contains(p["id"].as_str().unwrap()) => {
                    self.create(&text)?;
                    ids.insert(p["id"].as_str().unwrap().to_owned());
                    imported += 1;
                }
                _ => skipped += 1,
            }
        }
        Ok(json!({"imported":imported,"skipped":skipped}))
    }
    pub fn seed_once(&mut self, examples: &[&str]) -> Result<()> {
        let marker = self.root.join(".initialized");
        if !marker.exists() {
            if self.list()?["items"].as_array().unwrap().is_empty() {
                for text in examples {
                    self.create(text)?;
                }
            }
            atomic_write(&marker, "2")?;
        }
        Ok(())
    }
    pub fn backup_all(&self, version: &str) -> Result<PathBuf> {
        let root = self.subdirectory("_备份")?;
        let version: String = version
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '.')
            .collect();
        let folder = root.join(format!("更新前-v{version}-{}-{}", millis(), &nonce()[..6]));
        fs::create_dir(&folder)?;
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let regular_json = fs::symlink_metadata(entry.path())
                .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink() && m.len() <= MAX_SIZE);
            if valid_name(&entry.file_name().to_string_lossy()) && regular_json {
                fs::copy(entry.path(), folder.join(entry.file_name()))?;
            }
        }
        Ok(folder)
    }
    pub fn source_path(&self, binding: &str) -> Result<PathBuf> {
        let binding = self
            .bindings
            .get(binding)
            .ok_or_else(|| Error::new(409, "请先保存或重新打开源文件"))?;
        let path = self.path(&binding.name)?;
        read_story(&path)?;
        Ok(path)
    }
    /// Read the currently bound file, rejecting replacement by another project.
    pub fn read_bound(&self, binding_id: &str) -> Result<Opened> {
        let binding = self
            .bindings
            .get(binding_id)
            .ok_or_else(|| Error::new(409, "请先保存或重新打开源文件"))?;
        let (text, project, stamp) = read_story(&self.path(&binding.name)?)?;
        if project["id"].as_str() != Some(&binding.project_id) {
            return Err(Error::new(409, "磁盘文件已被另一份剧本替换，请重新打开"));
        }
        Ok(Opened {
            name: binding.name.clone(),
            text,
            stamp,
            binding_id: binding_id.into(),
        })
    }
    pub fn command(&mut self, endpoint: &str, body: &Value) -> Result<Value> {
        let text = |name: &str| body[name].as_str().unwrap_or("");
        match endpoint {
            "projects/list" => self.list(),
            "projects/open" => Ok(serde_json::to_value(self.open(text("fileName"))?)?),
            "projects/create" => Ok(serde_json::to_value(self.create(text("text"))?)?),
            "projects/duplicate" => Ok(serde_json::to_value(self.duplicate(text("fileName"))?)?),
            "projects/rename" => Ok(serde_json::to_value(
                self.rename(text("fileName"), text("title"))?,
            )?),
            "projects/delete" => self.delete(text("fileName")),
            "save" => {
                let stamp = serde_json::from_value(body["stamp"].clone()).ok();
                Ok(serde_json::to_value(self.save(
                    text("bindingId"),
                    text("text"),
                    stamp,
                    body["force"].as_bool().unwrap_or(false),
                )?)?)
            }
            _ => Err(Error::new(404, "未知的本地操作")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn story(id: &str, title: &str) -> String {
        json!({"format":"xuxian.story","version":3,"id":id,"title":title,"routes":[{"id":"r1"}],"chapters":[]}).to_string()
    }
    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("projects")).unwrap();
        (dir, store)
    }
    #[test]
    fn saving_detects_external_changes_and_preserves_old_copy() {
        let (_dir, mut store) = store();
        let opened = store.create(&story("p1", "雨夜")).unwrap();
        let changed = story("p1", "外部改动");
        fs::write(store.root.join(&opened.name), &changed).unwrap();
        let edit = story("p1", "编辑中的剧本");
        assert_eq!(
            store
                .save(&opened.binding_id, &edit, Some(opened.stamp.clone()), false)
                .unwrap_err()
                .status,
            409
        );
        assert_eq!(
            fs::read_to_string(store.root.join(&opened.name)).unwrap(),
            changed
        );
        let saved = store
            .save(&opened.binding_id, &edit, Some(opened.stamp), true)
            .unwrap();
        assert_eq!(saved.text, edit);
        let backup = fs::read_dir(store.root.join("_备份"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap();
        assert_eq!(fs::read_to_string(backup.path()).unwrap(), changed);
    }
    #[test]
    fn source_location_tracks_the_bound_file_and_v4_can_be_saved() {
        let (_dir, mut store) = store();
        assert!(store.source_path("missing-binding").is_err());
        let mut project = validate_story(&story("p1", "地点剧本")).unwrap();
        project["version"] = json!(4);
        project["locations"] = json!([]);
        let opened = store.create(&project.to_string()).unwrap();
        assert_eq!(
            store.read_bound(&opened.binding_id).unwrap().text,
            opened.text
        );
        fs::write(store.root.join(&opened.name), story("foreign", "其他项目")).unwrap();
        assert!(store.read_bound(&opened.binding_id).is_err());
        fs::write(store.root.join(&opened.name), &opened.text).unwrap();
        assert_eq!(
            store.source_path(&opened.binding_id).unwrap(),
            store.root.join(&opened.name)
        );
        let copy = store.duplicate(&opened.name).unwrap();
        assert_ne!(
            store.source_path(&opened.binding_id).unwrap(),
            store.source_path(&copy.binding_id).unwrap()
        );
        store.delete(&opened.name).unwrap();
        assert!(store.source_path(&opened.binding_id).is_err());
    }
    #[test]
    fn rejects_paths_reserved_names_and_other_project_bindings() {
        let (_dir, mut store) = store();
        for name in [
            "../bad.json",
            "C:\\bad.json",
            "CON.json",
            ".hidden.json",
            "bad.json.",
            "a/b.json",
        ] {
            assert!(store.open(name).is_err());
        }
        let p = store.create(&story("p1", "项目")).unwrap();
        assert_eq!(
            store
                .save(&p.binding_id, &story("p2", "不同项目"), Some(p.stamp), true)
                .unwrap_err()
                .status,
            409
        );
    }
    #[test]
    fn rename_duplicate_delete_and_import_keep_originals() {
        let (dir, mut store) = store();
        let p = store.create(&story("p1", "原件")).unwrap();
        let renamed = store.rename(&p.name, "重命名").unwrap();
        assert!(!store.root.join(p.name).exists());
        let copy = store.duplicate(&renamed.name).unwrap();
        assert_ne!(validate_story(&copy.text).unwrap()["id"], "p1");
        store.delete(&renamed.name).unwrap();
        assert_eq!(fs::read_dir(store.root.join("_回收站")).unwrap().count(), 1);
        let old = dir.path().join("legacy");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("old.json"), story("legacy", "旧版")).unwrap();
        fs::write(old.join("bad.json"), "invalid").unwrap();
        assert_eq!(store.import_folder(&old).unwrap()["imported"], 1);
        assert_eq!(store.import_folder(&old).unwrap()["skipped"], 2);
        assert!(old.join("old.json").exists());
    }
    #[test]
    fn snapshot_and_seed_do_not_overwrite_user_data() {
        let (_dir, mut store) = store();
        store.seed_once(&[&story("p1", "示例")]).unwrap();
        store.seed_once(&[&story("p2", "新增示例")]).unwrap();
        assert_eq!(store.list().unwrap()["items"].as_array().unwrap().len(), 1);
        let snapshot = store.backup_all("2.0.0").unwrap();
        assert_eq!(fs::read_dir(snapshot).unwrap().count(), 1);
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_project_and_backup_directories() {
        let (dir, mut store) = store();
        let p = store.create(&story("p1", "项目")).unwrap();
        std::os::unix::fs::symlink(store.root.join(&p.name), store.root.join("link.json")).unwrap();
        assert!(store.open("link.json").is_err());
        std::os::unix::fs::symlink(dir.path(), store.root.join("_备份")).unwrap();
        assert!(store
            .save(&p.binding_id, &story("p1", "新标题"), Some(p.stamp), false)
            .is_err());
        assert_eq!(
            validate_story(&store.open(&p.name).unwrap().text).unwrap()["title"],
            "项目"
        );
    }
}
