//! Project-scoped GitHub synchronization. Credentials never enter project JSON or settings files.
mod http;
pub use http::GithubClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::Write, path::PathBuf};
use uuid::Uuid;
use xuxian_story_store::{validate_story, Error, Opened, Stamp, Store};

pub type Result<T> = std::result::Result<T, Error>;

pub trait Credentials: Send {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, token: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}
pub trait Remote: Send {
    fn repository(&self, connection: &Connection) -> Result<RepoInfo>;
    fn file(&self, connection: &Connection, path: &str) -> Result<Option<RemoteFile>>;
    fn put(&self, connection: &Connection, path: &str, text: &str, sha: Option<&str>)
        -> Result<()>;
    fn list(&self, connection: &Connection) -> Result<Value>;
}
pub trait Transport: Send {
    fn connect(&self, token: &str) -> Result<Box<dyn Remote>>;
}
pub struct GithubTransport;
impl Transport for GithubTransport {
    fn connect(&self, token: &str) -> Result<Box<dyn Remote>> {
        Ok(Box::new(GithubClient::new(token)?))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub directory: String,
}
impl Connection {
    pub fn validate(&self) -> Result<()> {
        let part = |s: &str| {
            !s.is_empty()
                && s.len() <= 100
                && s != "."
                && s != ".."
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        };
        let safe_path = |s: &str| {
            !s.is_empty()
                && s.len() <= 240
                && s.split('/').all(|p| {
                    !p.is_empty()
                        && p != "."
                        && p != ".."
                        && !p.starts_with('.')
                        && !p.ends_with('.')
                        && !p
                            .chars()
                            .any(|c| c.is_control() || "\\:*?\"<>|".contains(c))
                })
        };
        if !part(&self.owner)
            || !part(&self.repo)
            || !safe_path(&self.branch)
            || !safe_path(&self.directory)
            || self
                .directory
                .split('/')
                .any(|p| p.eq_ignore_ascii_case(".github") || p.eq_ignore_ascii_case(".git"))
        {
            return Err(Error::new(
                400,
                "仓库、分支或数据目录格式无效；目录应为相对路径，例如 xuxian/projects",
            ));
        }
        Ok(())
    }
    fn key(&self) -> String {
        hash(
            &serde_json::to_string(&(
                self.owner.to_ascii_lowercase(),
                self.repo.to_ascii_lowercase(),
                &self.branch,
                &self.directory,
            ))
            .unwrap(),
        )
    }
    fn path(&self, project_id: &str) -> Result<String> {
        if project_id.is_empty()
            || project_id.len() > 100
            || !project_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
        {
            return Err(Error::new(400, "剧本标识无效"));
        }
        Ok(format!("{}/{project_id}.story.json", self.directory))
    }
}
#[derive(Clone, Debug)]
pub struct RepoInfo {
    pub private: bool,
    pub default_branch: String,
}
#[derive(Clone, Debug)]
pub struct RemoteFile {
    pub sha: String,
    pub text: String,
}
#[derive(Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Link {
    connection: String,
    base_hash: Option<String>,
    last_sync: Option<u64>,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    connections: HashMap<String, Connection>,
    projects: HashMap<String, Link>,
}
struct Plan {
    local: Opened,
    connection: Connection,
    link: Link,
    remote: Option<RemoteFile>,
    action: String,
}
pub struct Engine {
    root: PathBuf,
    settings: Settings,
    credentials: Box<dyn Credentials>,
    transport: Box<dyn Transport>,
    plans: HashMap<String, Plan>,
}
fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn content_hash(text: &str) -> Result<String> {
    let mut value = validate_story(text)?;
    value.as_object_mut().unwrap().remove("updatedAt");
    Ok(hash(&serde_json::to_string(&value)?))
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Three-way comparison; absence after a previous sync is a deletion conflict.
pub fn decide(local: &str, remote: Option<&str>, base: Option<&str>) -> &'static str {
    let Some(remote) = remote else {
        return if base.is_some() { "deleted" } else { "upload" };
    };
    if local == remote {
        return "current";
    }
    match base {
        Some(base) if remote == base => "upload",
        Some(base) if local == base => "download",
        _ => "conflict",
    }
}

impl Engine {
    pub fn new(
        root: PathBuf,
        credentials: Box<dyn Credentials>,
        transport: Box<dyn Transport>,
    ) -> Result<Self> {
        fs::create_dir_all(&root)?;
        if fs::symlink_metadata(&root)?.file_type().is_symlink() {
            return Err(Error::new(400, "同步设置目录不能是符号链接"));
        }
        let path = root.join("settings.json");
        let settings = if path.exists() {
            if fs::symlink_metadata(&path)?.file_type().is_symlink()
                || fs::metadata(&path)?.len() > 5 * 1024 * 1024
            {
                return Err(Error::new(400, "同步设置文件无效"));
            }
            serde_json::from_str(&fs::read_to_string(path)?)
                .map_err(|_| Error::new(400, "同步设置损坏，请恢复设置备份"))?
        } else {
            Settings::default()
        };
        Ok(Self {
            root,
            settings,
            credentials,
            transport,
            plans: HashMap::new(),
        })
    }
    fn persist(&self) -> Result<()> {
        let text = serde_json::to_string_pretty(&self.settings)?;
        let mut file = tempfile::NamedTempFile::new_in(&self.root)?;
        file.write_all(text.as_bytes())?;
        file.as_file().sync_all()?;
        file.persist(self.root.join("settings.json"))
            .map_err(|e| Error::from(e.error))?;
        Ok(())
    }
    fn client(&self, key: &str) -> Result<Box<dyn Remote>> {
        let token = self
            .credentials
            .get(key)?
            .ok_or_else(|| Error::new(401, "请在同步设置中填写 GitHub 访问令牌"))?;
        self.transport.connect(&token)
    }
    pub fn settings(&self, project_id: &str) -> Result<Value> {
        let linked = self.settings.projects.get(project_id);
        let connections: Vec<Value> = self.settings.connections.iter().map(|(key, value)| {
            Ok(json!({"id":key,"connection":value,"hasToken":self.credentials.get(key)?.is_some()}))
        }).collect::<Result<_>>()?;
        Ok(
            json!({"connections":connections,"linked":linked.map(|link| json!({"connectionId":link.connection,"lastSync":link.last_sync}))}),
        )
    }
    pub fn configure(
        &mut self,
        project_id: &str,
        connection: Connection,
        token: &str,
    ) -> Result<Value> {
        connection.validate()?;
        if !project_id.is_empty() {
            connection.path(project_id)?;
        }
        let key = connection.key();
        let existing = self.credentials.get(&key)?;
        let token = if token.trim().is_empty() {
            existing
                .as_deref()
                .ok_or_else(|| Error::new(401, "请输入 GitHub 访问令牌"))?
        } else {
            token.trim()
        };
        if token.len() > 4096 || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(Error::new(400, "访问令牌格式无效"));
        }
        let remote = self.transport.connect(token)?;
        let info = remote.repository(&connection)?;
        if !info.private {
            return Err(Error::new(400, "该仓库是公开仓库，请选择私有数据仓库"));
        }
        self.credentials.set(&key, token)?;
        self.settings
            .connections
            .insert(key.clone(), connection.clone());
        let old = self
            .settings
            .projects
            .get(project_id)
            .filter(|link| link.connection == key)
            .cloned();
        if !project_id.is_empty() {
            self.settings.projects.insert(
                project_id.into(),
                old.unwrap_or(Link {
                    connection: key.clone(),
                    ..Link::default()
                }),
            );
        }
        self.persist()?;
        self.plans.clear();
        Ok(
            json!({"private":info.private,"connectionId":key,"path":if project_id.is_empty() {connection.directory.clone()} else {connection.path(project_id)?},"branch":connection.branch}),
        )
    }
    pub fn disconnect(&mut self, project_id: &str, forget_token: bool) -> Result<Value> {
        if let Some(link) = self.settings.projects.remove(project_id) {
            if forget_token {
                self.credentials.delete(&link.connection)?;
            }
        }
        self.plans.clear();
        self.persist()?;
        Ok(json!({"disconnected":true}))
    }
    pub fn inspect(&mut self, store: &Store, binding: &str, expected: &Stamp) -> Result<Value> {
        let local = store.read_bound(binding)?;
        if &local.stamp != expected {
            return Err(Error::new(409, "本地源文件已改变，请重新打开并同步"));
        }
        let project = validate_story(&local.text)?;
        let project_id = project["id"].as_str().unwrap();
        let link = self
            .settings
            .projects
            .get(project_id)
            .cloned()
            .ok_or_else(|| Error::new(428, "请先配置这个项目的 GitHub 同步"))?;
        let connection = self
            .settings
            .connections
            .get(&link.connection)
            .cloned()
            .ok_or_else(|| Error::new(400, "同步配置不存在"))?;
        let client = self.client(&link.connection)?;
        require_private(client.repository(&connection)?)?;
        let remote = client.file(&connection, &connection.path(project_id)?)?;
        let remote_hash = if let Some(file) = &remote {
            let value = validate_story(&file.text)?;
            if value["id"] != project["id"] {
                return Err(Error::new(409, "远端文件属于另一份剧本，已停止同步"));
            }
            Some(content_hash(&file.text)?)
        } else {
            None
        };
        let action = decide(
            &content_hash(&local.text)?,
            remote_hash.as_deref(),
            link.base_hash.as_deref(),
        )
        .to_owned();
        let id = Uuid::new_v4().simple().to_string();
        let result = json!({"planId":id,"action":action,"remoteText":remote.as_ref().map(|file| &file.text),"path":connection.path(project_id)?,"connection":connection,"lastSync":link.last_sync});
        self.plans.clear();
        self.plans.insert(
            id,
            Plan {
                local,
                connection,
                link,
                remote,
                action,
            },
        );
        Ok(result)
    }
    pub fn execute(&mut self, store: &mut Store, plan_id: &str, resolution: &str) -> Result<Value> {
        let plan = self
            .plans
            .remove(plan_id)
            .ok_or_else(|| Error::new(409, "同步检查已失效，请重新同步"))?;
        let current = store.read_bound(&plan.local.binding_id)?;
        if current.stamp != plan.local.stamp {
            return Err(Error::new(409, "本地剧本在同步期间发生改变，请重新同步"));
        }
        let project = validate_story(&current.text)?;
        let project_id = project["id"].as_str().unwrap();
        let link = self
            .settings
            .projects
            .get(project_id)
            .ok_or_else(|| Error::new(409, "同步配置已改变"))?;
        if link.connection != plan.link.connection {
            return Err(Error::new(409, "同步目标已改变，请重新同步"));
        }
        let client = self.client(&plan.link.connection)?;
        require_private(client.repository(&plan.connection)?)?;
        let path = plan.connection.path(project_id)?;
        let latest = client.file(&plan.connection, &path)?;
        if latest.as_ref().map(|f| &f.sha) != plan.remote.as_ref().map(|f| &f.sha) {
            return Err(Error::new(409, "GitHub 剧本在确认期间发生改变，请重新同步"));
        }
        let action = match plan.action.as_str() {
            "conflict" | "deleted" if resolution == "local" => "upload",
            "conflict" if resolution == "remote" => "download",
            "conflict" | "deleted" => {
                return Err(Error::new(409, "双方有改动，请先选择要保留的版本"))
            }
            action => action,
        };
        let mut conflict_copy = None;
        let opened = match action {
            "upload" => {
                if plan.action == "conflict" {
                    let mut copy = validate_story(&plan.remote.as_ref().unwrap().text)?;
                    copy["id"] = json!(format!("project_{}", Uuid::new_v4().simple()));
                    copy["title"] = json!(format!(
                        "{} · GitHub 冲突副本",
                        copy["title"].as_str().unwrap_or("剧本")
                    ));
                    conflict_copy = Some(store.create(&serde_json::to_string_pretty(&copy)?)?.name);
                }
                // GitHub enforces compare-and-swap through the current blob SHA.
                client.put(
                    &plan.connection,
                    &path,
                    &current.text,
                    plan.remote.as_ref().map(|f| f.sha.as_str()),
                )?;
                current
            }
            "download" => store.save(
                &current.binding_id,
                &plan.remote.as_ref().unwrap().text,
                Some(current.stamp.clone()),
                false,
            )?,
            "current" => current,
            _ => return Err(Error::new(400, "无效同步状态")),
        };
        let link = self.settings.projects.get_mut(project_id).unwrap();
        link.base_hash = Some(content_hash(&opened.text)?);
        link.last_sync = Some(now());
        let last_sync = link.last_sync;
        self.persist()?;
        Ok(
            json!({"action":action,"opened":opened,"conflictCopy":conflict_copy,"lastSync":last_sync}),
        )
    }
    pub fn list(&self, connection_id: &str) -> Result<Value> {
        let connection = self
            .settings
            .connections
            .get(connection_id)
            .ok_or_else(|| Error::new(400, "请先配置 GitHub 连接"))?;
        let client = self.client(connection_id)?;
        require_private(client.repository(connection)?)?;
        client.list(connection)
    }
    pub fn preview(&self, connection_id: &str, file_name: &str) -> Result<Value> {
        let connection = self
            .settings
            .connections
            .get(connection_id)
            .ok_or_else(|| Error::new(400, "请先配置 GitHub 连接"))?;
        let project_id = file_name
            .strip_suffix(".story.json")
            .ok_or_else(|| Error::new(400, "请选择叙线剧本"))?;
        let path = connection.path(project_id)?;
        let client = self.client(connection_id)?;
        require_private(client.repository(connection)?)?;
        let file = client
            .file(connection, &path)?
            .ok_or_else(|| Error::new(404, "GitHub 文件已删除，请刷新列表"))?;
        let project = validate_story(&file.text)?;
        if project["id"].as_str() != Some(project_id) {
            return Err(Error::new(400, "远端文件名与剧本标识不匹配"));
        }
        Ok(json!({"text":file.text,"sha":file.sha}))
    }
    pub fn restore(
        &mut self,
        store: &mut Store,
        connection_id: &str,
        file_name: &str,
        expected_sha: &str,
    ) -> Result<Value> {
        let connection = self
            .settings
            .connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| Error::new(400, "请先配置 GitHub 连接"))?;
        let project_id = file_name
            .strip_suffix(".story.json")
            .ok_or_else(|| Error::new(400, "请选择叙线剧本"))?;
        let path = connection.path(project_id)?;
        let client = self.client(connection_id)?;
        require_private(client.repository(&connection)?)?;
        let file = client
            .file(&connection, &path)?
            .ok_or_else(|| Error::new(404, "GitHub 文件已删除，请刷新列表"))?;
        if file.sha != expected_sha {
            return Err(Error::new(409, "GitHub 剧本已更新，请重新预览后恢复"));
        }
        let project = validate_story(&file.text)?;
        if project["id"].as_str() != Some(project_id) {
            return Err(Error::new(400, "远端文件名与剧本标识不匹配"));
        }
        if store.contains_project(project_id)? {
            return Err(Error::new(409, "本地已有这个项目，请打开该项目并一键同步"));
        }
        let opened = store.create(&file.text)?;
        self.settings.projects.insert(
            project_id.into(),
            Link {
                connection: connection_id.into(),
                base_hash: Some(content_hash(&file.text)?),
                last_sync: Some(now()),
            },
        );
        self.persist()?;
        Ok(json!({"opened":opened}))
    }
}

fn require_private(info: RepoInfo) -> Result<()> {
    if info.private {
        Ok(())
    } else {
        Err(Error::new(
            403,
            "仓库已改为公开，已停止同步。请恢复私有或更换数据仓库",
        ))
    }
}

#[cfg(test)]
mod tests;
