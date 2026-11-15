use crate::AppStore;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
#[cfg(not(target_os = "android"))]
use xuxian_github_sync::Credentials;
use xuxian_github_sync::{Connection, Engine, GithubTransport};
use xuxian_story_store::Error;

#[derive(Default)]
pub struct SyncState(Mutex<Option<Engine>>);
#[cfg(not(target_os = "android"))]
struct SystemCredentials;
#[cfg(windows)]
fn entry(key: &str) -> Result<keyring::Entry, Error> {
    keyring::Entry::new("com.xuxian.desktop.github-sync", key)
        .map_err(|_| Error::new(500, "无法访问 Windows 凭据管理器"))
}
#[cfg(not(target_os = "android"))]
impl Credentials for SystemCredentials {
    fn get(&self, key: &str) -> Result<Option<String>, Error> {
        #[cfg(windows)]
        {
            match entry(key)?.get_password() {
                Ok(token) => Ok(Some(token)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(_) => Err(Error::new(500, "无法读取 Windows 凭据，请重新配置同步令牌")),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = key;
            Err(Error::new(
                501,
                "当前发行版的 GitHub 凭据存储仅支持 Windows 桌面版",
            ))
        }
    }
    fn set(&self, key: &str, token: &str) -> Result<(), Error> {
        #[cfg(windows)]
        {
            entry(key)?
                .set_password(token)
                .map_err(|_| Error::new(500, "Windows 凭据保存失败，令牌未写入普通文件"))
        }
        #[cfg(not(windows))]
        {
            let _ = (key, token);
            Err(Error::new(501, "请使用 Windows 桌面版配置同步"))
        }
    }
    fn delete(&self, key: &str) -> Result<(), Error> {
        #[cfg(windows)]
        {
            match entry(key)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(Error::new(500, "无法删除 Windows 中的同步令牌")),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = key;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn github_sync_command(
    app: tauri::AppHandle,
    endpoint: String,
    body: Value,
) -> Result<Value, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        if endpoint == "sync/open-token-page" {
            let owner = body["owner"].as_str().unwrap_or("");
            if owner.is_empty() || !owner.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c)) {
                return Err(Error::new(400, "请先填写正确的仓库所有者"));
            }
            let url = format!("https://github.com/settings/personal-access-tokens/new?name=Xuxian%20Sync&target_name={owner}&expires_in=30&contents=write");
            app.opener().open_url(url, None::<&str>).map_err(|_| Error::new(500,"无法打开 GitHub 授权页"))?;
            return Ok(json!({"opened":true}));
        }
        let state = app.state::<SyncState>();
        let mut guard = state.0.lock().map_err(|_| Error::new(500, "同步服务忙，请重试"))?;
        if guard.is_none() {
            let root = app.path().app_config_dir().map_err(|_| Error::new(500, "无法获取本机设置目录"))?.join("github-sync");
            #[cfg(target_os="android")]
            let credentials=Box::new(crate::mobile::AndroidCredentials(app.clone()));
            #[cfg(not(target_os="android"))]
            let credentials=Box::new(SystemCredentials);
            *guard = Some(Engine::new(root, credentials, Box::new(GithubTransport))?);
        }
        let engine = guard.as_mut().unwrap();
        let text = |key: &str| body[key].as_str().unwrap_or("");
        match endpoint.as_str() {
            "sync/settings" => engine.settings(""),
            "sync/configure" => {
                let connection: Connection = serde_json::from_value(body["connection"].clone()).map_err(|_| Error::new(400, "同步配置不完整"))?;
                engine.configure("", connection, text("token"))
            }
            "sync/archive-list" => engine.archive_list(text("connectionId")),
            "sync/archive-preview" => engine.archive_preview(text("connectionId"),text("fileName")),
            "sync/archive-delete" => engine.archive_delete(text("connectionId"),text("fileName"),text("sha")),
            "sync/archive-save" | "sync/archive-load" => {
                let store = app.state::<AppStore>();
                let mut store=store.0.lock().map_err(|_| Error::new(500,"项目库忙，请重试"))?;
                if endpoint=="sync/archive-save" {
                    engine.archive_save(&store,text("connectionId"),text("fileName"),text("sha"),text("name"),text("note"))
                } else {
                    engine.archive_load(&mut store,text("connectionId"),text("fileName"),text("sha"))
                }
            }
            "sync/inspect" | "sync/execute" | "sync/restore" => Err(Error::new(410,"旧版逐项目同步已停用，请在项目库中使用全局云存档")),
            _ => Err(Error::new(404, "未知同步操作")),
        }
    }).await.map_err(|_| Error::new(500, "同步任务未完成，请重试"))?
}
