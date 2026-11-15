//! Whole-library snapshots and crash-recoverable directory swaps. No merge or version selection.
use super::*;
use std::collections::HashSet;

pub const MAX_LIBRARY_BYTES: usize = 50 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryProject {
    pub file_name: String,
    pub project: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Swap {
    root: String,
    stage: String,
    backup: String,
    // Old releases retained this directory. New loads only keep it until commit/rollback.
    #[serde(default)]
    discard_previous: bool,
}
fn root_name(root: &Path) -> Result<String> {
    root.file_name()
        .and_then(|v| v.to_str())
        .map(str::to_owned)
        .ok_or_else(|| Error::new(400, "项目库目录无效"))
}
fn journal(root: &Path) -> Result<PathBuf> {
    let key = format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()));
    Ok(root
        .parent()
        .ok_or_else(|| Error::new(400, "项目库目录无效"))?
        .join(format!(".xuxian-library-swap-{}.json", &key[..20])))
}
fn safe_child(name: &str, prefix: &str) -> bool {
    name.strip_prefix(prefix).is_some_and(|tail| {
        !tail.is_empty()
            && tail.len() <= 100
            && tail.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    })
}
fn regular_directory(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(Error::new(400, "项目库事务目录必须是本机普通目录"));
    }
    Ok(())
}
fn remove_stage(path: &Path) -> Result<()> {
    if path.exists() {
        regular_directory(path)?;
        fs::remove_dir_all(path)?;
    }
    Ok(())
}
pub(super) fn recover(root: &Path) -> Result<()> {
    let journal = journal(root)?;
    if !journal.exists() {
        return Ok(());
    }
    let meta = fs::symlink_metadata(&journal)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 4096 {
        return Err(Error::new(400, "项目库恢复记录无效"));
    }
    let swap: Swap = serde_json::from_slice(&fs::read(&journal)?)?;
    if swap.root != root_name(root)?
        || !safe_child(&swap.stage, ".xuxian-library-stage-")
        || !safe_child(
            &swap.backup,
            if swap.discard_previous {
                ".xuxian-library-previous-"
            } else {
                "项目库备份-"
            },
        )
    {
        return Err(Error::new(400, "项目库恢复记录路径无效"));
    }
    let parent = root.parent().unwrap();
    let backup = parent.join(&swap.backup);
    let stage = parent.join(&swap.stage);
    if root.exists() {
        regular_directory(root)?;
    } else {
        regular_directory(&backup)?;
        fs::rename(&backup, root)?;
    }
    // Once the new root is present, dispose of the replaced library. An interrupted pre-commit
    // swap rolls back above. Existing journals from older releases retain their historical backup.
    remove_stage(&stage)?;
    if swap.discard_previous {
        remove_stage(&backup)?;
    }
    fs::remove_file(journal)?;
    Ok(())
}
pub fn validate_library_entries(entries: &[LibraryProject]) -> Result<()> {
    if entries.len() > 5000 {
        return Err(Error::new(413, "项目库超过 5000 个项目"));
    }
    let mut names = HashSet::new();
    let mut bytes = 0usize;
    for entry in entries {
        if !valid_name(&entry.file_name) || !names.insert(entry.file_name.to_lowercase()) {
            return Err(Error::new(400, "存档中有无效或重复的项目文件名"));
        }
        let text = serde_json::to_string(&entry.project)?;
        validate_story(&text)?;
        bytes += text.len() + entry.file_name.len();
        if bytes > MAX_LIBRARY_BYTES {
            return Err(Error::new(413, "整个项目库存档超过 50 MB"));
        }
    }
    Ok(())
}
fn fingerprint(entries: &[LibraryProject]) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(entries)?)
    ))
}
impl Store {
    pub fn library_revision(&self) -> Result<String> {
        let path = self.root.join(".library-revision");
        if !path.exists() {
            return Ok("legacy".into());
        }
        let meta = fs::symlink_metadata(&path)?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 100 {
            return Err(Error::new(400, "项目库版本记录无效"));
        }
        Ok(fs::read_to_string(path)?)
    }
    pub fn capture_library(&self) -> Result<Vec<LibraryProject>> {
        let mut entries = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !valid_name(&name) {
                continue;
            }
            let (_, project, _) = read_story(&entry.path())?;
            entries.push(LibraryProject {
                file_name: name,
                project,
            });
        }
        entries.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        validate_library_entries(&entries)?;
        Ok(entries)
    }
    pub fn restore_library(&mut self, entries: &[LibraryProject]) -> Result<Value> {
        validate_library_entries(entries)?;
        recover(&self.root)?;
        let before = fingerprint(&self.capture_library()?)?;
        let parent = self
            .root
            .parent()
            .ok_or_else(|| Error::new(400, "项目库目录无效"))?;
        let stage = tempfile::Builder::new()
            .prefix(".xuxian-library-stage-")
            .tempdir_in(parent)?;
        for entry in entries {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(stage.path().join(&entry.file_name))?;
            file.write_all(serde_json::to_string_pretty(&entry.project)?.as_bytes())?;
            file.sync_all()?;
        }
        atomic_write(&stage.path().join(".initialized"), "2")?;
        let revision = nonce();
        atomic_write(&stage.path().join(".library-revision"), &revision)?;
        if fingerprint(&self.capture_library()?)? != before {
            return Err(Error::new(
                409,
                "本机项目库刚被其他程序修改，请重新确认读档",
            ));
        }
        let backup_name = format!(".xuxian-library-previous-{}", nonce());
        let backup = parent.join(&backup_name);
        let swap = Swap {
            root: root_name(&self.root)?,
            stage: root_name(stage.path())?,
            backup: backup_name.clone(),
            discard_previous: true,
        };
        let record = journal(&self.root)?;
        atomic_write(&record, &serde_json::to_string(&swap)?)?;
        fs::rename(&self.root, &backup)?;
        if let Err(error) = fs::rename(stage.path(), &self.root) {
            if fs::rename(&backup, &self.root).is_err() {
                return Err(Error::new(
                    500,
                    "项目库替换未完成，重启后会恢复，请勿删除事务临时文件",
                ));
            }
            let _ = fs::remove_file(&record);
            return Err(error.into());
        }
        self.bindings.clear();
        // A cleanup failure must not report a failed load after the library has already changed.
        // Retain the journal so startup can finish deleting the temporary previous directory.
        let cleanup_pending = recover(&self.root).is_err();
        let opened: Option<Opened> = None;
        Ok(
            json!({"opened":opened,"projectCount":entries.len(),"cleanupPending":cleanup_pending,"revision":revision}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project(id: &str, title: &str) -> Value {
        json!({"format":"xuxian.story","version":4,"id":id,"title":title,"routes":[{"id":"r"}],"chapters":[]})
    }
    fn entry(name: &str, id: &str, title: &str) -> LibraryProject {
        LibraryProject {
            file_name: name.into(),
            project: project(id, title),
        }
    }
    #[test]
    fn replaces_the_entire_library_without_retaining_old_projects_or_backups() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::new(temp.path().join("projects")).unwrap();
        let opened = store.create(&project("old", "旧项目").to_string()).unwrap();
        fs::create_dir(store.root.join("_备份")).unwrap();
        fs::write(store.root.join("_备份/history.txt"), "keep").unwrap();
        let result = store
            .restore_library(&[
                entry("A.story.json", "a", "甲"),
                entry("B.story.json", "b", "乙"),
            ])
            .unwrap();
        assert_eq!(store.capture_library().unwrap().len(), 2);
        assert!(store.read_bound(&opened.binding_id).is_err());
        assert!(result.get("backupName").is_none());
        assert_eq!(result["cleanupPending"], false);
        assert!(!store.root.join("_备份").exists());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }
    #[test]
    fn rejects_malformed_paths_duplicates_and_corrupt_entries_without_touching_local_data() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::new(temp.path().join("projects")).unwrap();
        store.create(&project("old", "旧项目").to_string()).unwrap();
        for entries in [
            vec![entry("../outside.json", "a", "甲")],
            vec![entry("A.json", "a", "甲"), entry("a.json", "b", "乙")],
            vec![LibraryProject {
                file_name: "x.json".into(),
                project: json!({"id":"invalid"}),
            }],
        ] {
            assert!(store.restore_library(&entries).is_err());
            assert_eq!(store.capture_library().unwrap()[0].project["id"], "old");
        }
    }
    #[test]
    fn empty_saves_remain_empty_on_restart_and_change_the_draft_generation() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("projects");
        let mut store = Store::new(root.clone()).unwrap();
        let old = store.library_revision().unwrap();
        store.restore_library(&[]).unwrap();
        assert_ne!(store.library_revision().unwrap(), old);
        drop(store);
        let mut reopened = Store::new(root).unwrap();
        reopened
            .seed_once(&[&project("demo", "示例").to_string()])
            .unwrap();
        assert!(reopened.capture_library().unwrap().is_empty());
    }
    #[test]
    fn loaded_projects_persist_across_full_store_restarts_and_do_not_reseed_the_demo() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("projects");
        let demo = project("demo", "默认演示项目").to_string();
        let mut expected = vec![
            entry("云端甲.story.json", "cloud-a", "云端内容甲"),
            entry("云端乙.story.json", "cloud-b", "云端内容乙"),
        ];
        expected.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        let mut store = Store::new(root.clone()).unwrap();
        store.seed_once(&[&demo]).unwrap();
        let result = store.restore_library(&expected).unwrap();
        let revision = result["revision"].as_str().unwrap().to_owned();
        drop(store);
        for _ in 0..3 {
            let mut reopened = Store::new(root.clone()).unwrap();
            reopened.seed_once(&[&demo]).unwrap();
            assert_eq!(reopened.library_revision().unwrap(), revision);
            assert_eq!(
                serde_json::to_value(reopened.capture_library().unwrap()).unwrap(),
                serde_json::to_value(&expected).unwrap()
            );
            assert_eq!(
                serde_json::from_str::<Value>(&reopened.open("云端甲.story.json").unwrap().text)
                    .unwrap()["title"],
                "云端内容甲"
            );
            assert!(!reopened.contains_project("demo").unwrap());
        }
    }
    #[test]
    fn recovers_if_the_process_stops_between_directory_renames() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("projects");
        let mut store = Store::new(root.clone()).unwrap();
        store.create(&project("old", "原件").to_string()).unwrap();
        drop(store);
        let stage_name = ".xuxian-library-stage-fixture";
        let backup_name = ".xuxian-library-previous-fixture";
        fs::create_dir(temp.path().join(stage_name)).unwrap();
        fs::write(
            journal(&root).unwrap(),
            serde_json::to_vec(&Swap {
                root: "projects".into(),
                stage: stage_name.into(),
                backup: backup_name.into(),
                discard_previous: true,
            })
            .unwrap(),
        )
        .unwrap();
        fs::rename(&root, temp.path().join(backup_name)).unwrap();
        let recovered = Store::new(root.clone()).unwrap();
        assert_eq!(recovered.capture_library().unwrap()[0].project["id"], "old");
        assert!(!journal(&root).unwrap().exists());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }
    #[test]
    fn completes_cleanup_after_a_committed_load_and_preserves_old_release_backups() {
        for old_release in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("projects");
            let mut store = Store::new(root.clone()).unwrap();
            store
                .create(&project("new", "读入的项目").to_string())
                .unwrap();
            let previous = if old_release {
                "项目库备份-1-existing"
            } else {
                ".xuxian-library-previous-fixture"
            };
            fs::create_dir(temp.path().join(previous)).unwrap();
            fs::write(
                temp.path().join(previous).join("old.json"),
                project("old", "原来的项目").to_string(),
            )
            .unwrap();
            // An old-release journal has no discard_previous field.
            let mut record = json!({"root":"projects","stage":".xuxian-library-stage-fixture","backup":previous});
            if !old_release {
                record["discardPrevious"] = json!(true);
            }
            fs::write(journal(&root).unwrap(), record.to_string()).unwrap();
            drop(store);
            let recovered = Store::new(root.clone()).unwrap();
            assert_eq!(recovered.capture_library().unwrap()[0].project["id"], "new");
            assert_eq!(temp.path().join(previous).exists(), old_release);
            assert!(!journal(&root).unwrap().exists());
        }
    }
}
