//! Explicit global GitHub library saves. Credentials never enter archive or settings JSON.
mod archives;
mod http;
pub use http::GithubClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::Write, path::PathBuf};
use uuid::Uuid;
use xuxian_story_store::{Error, Store};

pub type Result<T> = std::result::Result<T, Error>;

pub trait Credentials: Send {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, token: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}
pub trait Remote: Send {
    fn repository(&self, connection: &Connection) -> Result<RepoInfo>;
    fn file(&self, connection: &Connection, path: &str) -> Result<Option<RemoteFile>>;
    fn list(&self, connection: &Connection) -> Result<Value>;
    fn write_archive(
        &self,
        _connection: &Connection,
        _path: &str,
        _text: Option<&str>,
        _metadata: Option<Value>,
        _expected: Option<&str>,
    ) -> Result<()> {
        Err(Error::new(501, "云存档传输未实现"))
    }
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
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    connections: HashMap<String, Connection>,
    // Retain old configuration metadata on disk without using project links or baselines.
    #[serde(flatten)]
    legacy: HashMap<String, Value>,
}
pub struct Engine {
    root: PathBuf,
    settings: Settings,
    credentials: Box<dyn Credentials>,
    transport: Box<dyn Transport>,
}
fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
impl Engine {
    pub fn new(
        root: PathBuf,
        credentials: Box<dyn Credentials>,
        transport: Box<dyn Transport>,
    ) -> Result<Self> {
        fs::create_dir_all(&root)?;
        if fs::symlink_metadata(&root)?.file_type().is_symlink() {
            return Err(Error::new(400, "云存档设置目录不能是符号链接"));
        }
        let path = root.join("settings.json");
        let settings = if path.exists() {
            if fs::symlink_metadata(&path)?.file_type().is_symlink()
                || fs::metadata(&path)?.len() > 5 * 1024 * 1024
            {
                return Err(Error::new(400, "云存档设置文件无效"));
            }
            serde_json::from_str(&fs::read_to_string(path)?)
                .map_err(|_| Error::new(400, "云存档设置损坏，请恢复设置备份"))?
        } else {
            Settings::default()
        };
        Ok(Self {
            root,
            settings,
            credentials,
            transport,
        })
    }
    fn persist(&self) -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(&self.root)?;
        file.write_all(serde_json::to_string_pretty(&self.settings)?.as_bytes())?;
        file.as_file().sync_all()?;
        file.persist(self.root.join("settings.json"))
            .map_err(|error| Error::from(error.error))?;
        Ok(())
    }
    fn client(&self, key: &str) -> Result<Box<dyn Remote>> {
        let token = self
            .credentials
            .get(key)?
            .ok_or_else(|| Error::new(401, "请在全局云存档连接中填写 GitHub 访问令牌"))?;
        self.transport.connect(&token)
    }
    pub fn settings(&self, _legacy_project_id: &str) -> Result<Value> {
        let mut connections=self.settings.connections.iter().map(|(key,value)|Ok(json!({"id":key,"connection":value,"hasToken":self.credentials.get(key)?.is_some()}))).collect::<Result<Vec<_>>>()?;
        connections.sort_by_key(|item| {
            format!(
                "{}/{}/{}",
                item["connection"]["owner"],
                item["connection"]["repo"],
                item["connection"]["directory"]
            )
        });
        Ok(json!({"connections":connections,"linked":null}))
    }
    pub fn configure(
        &mut self,
        _legacy_project_id: &str,
        connection: Connection,
        token: &str,
    ) -> Result<Value> {
        connection.validate()?;
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
        self.persist()?;
        Ok(
            json!({"private":true,"connectionId":key,"path":connection.directory,"branch":connection.branch}),
        )
    }
}
fn require_private(info: RepoInfo) -> Result<()> {
    if info.private {
        Ok(())
    } else {
        Err(Error::new(
            403,
            "仓库已改为公开，已停止存档操作。请恢复私有或更换数据仓库",
        ))
    }
}
#[cfg(test)]
mod tests;
