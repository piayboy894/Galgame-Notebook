use serde_json::{json, Value};
use std::io::Write;
use std::sync::Mutex;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager,
};
use xuxian_story_store::{validate_story, Error};

pub struct Mobile(pub PluginHandle<tauri::Wry>);
struct DraftOrder(Mutex<(u64, u64)>);
pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("xuxian-mobile")
        .js_init_script("Object.defineProperty(window,'__XUXIAN_ANDROID__',{value:true});")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("io.github.piayboy894.xuxian", "MobilePlugin")?;
            app.manage(Mobile(handle));
            app.manage(DraftOrder(Mutex::new((0, 0))));
            Ok(())
        })
        .build()
}
pub fn call(app: &tauri::AppHandle, command: &str, body: Value) -> Result<Value, Error> {
    app.state::<Mobile>()
        .0
        .run_mobile_plugin(command, body)
        .map_err(|_| Error::new(500, "Android 系统操作失败，请重试；凭据未写入普通文件"))
}
fn draft_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, Error> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| Error::new(500, "无法获取本机项目目录"))?;
    std::fs::create_dir_all(&root)?;
    Ok(root.join("editor-draft.json"))
}
#[tauri::command]
pub async fn mobile_command(
    app: tauri::AppHandle,
    endpoint: String,
    body: Value,
) -> Result<Value, Error> {
    match endpoint.as_str() {
        "mobile/check-update" | "mobile/install-update" => {
            tauri::async_runtime::spawn_blocking(move || {
                if endpoint == "mobile/check-update" {
                    crate::mobile_update::check(&app)
                } else {
                    crate::mobile_update::install(&app)
                }
            })
            .await
            .map_err(|_| Error::new(500, "Android 更新任务未完成"))?
        }
        "mobile/save-draft" => {
            let serialized = serde_json::to_string(&body)?;
            if serialized.len() > 30 * 1024 * 1024 {
                return Err(Error::new(413, "草稿超过大小限制"));
            }
            validate_story(&serde_json::to_string(&body["project"])?)?;
            tauri::async_runtime::spawn_blocking(move || {
                let state = app.state::<DraftOrder>();
                let mut last = state
                    .0
                    .lock()
                    .map_err(|_| Error::new(500, "草稿服务忙，请重试"))?;
                let sequence = body["sequence"]
                    .as_u64()
                    .ok_or_else(|| Error::new(400, "无效草稿顺序"))?;
                if body["epoch"].as_u64() != Some(last.0) || sequence <= last.1 {
                    return Ok(json!({"saved":false,"skipped":true}));
                }
                let path = draft_path(&app)?;
                let mut temporary = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
                temporary.write_all(serialized.as_bytes())?;
                temporary.as_file().sync_all()?;
                temporary.persist(path).map_err(|e| Error::from(e.error))?;
                last.1 = sequence;
                Ok(json!({"saved":true}))
            })
            .await
            .map_err(|_| Error::new(500, "草稿暂存失败"))?
        }
        "mobile/read-draft" => {
            let state = app.state::<DraftOrder>();
            let mut order = state.0.lock().map_err(|_| Error::new(500, "草稿服务忙"))?;
            order.0 += 1;
            order.1 = 0;
            let path = draft_path(&app)?;
            let draft = (|| -> Result<Value, Error> {
                if !path.exists() {
                    return Ok(Value::Null);
                }
                if std::fs::metadata(&path)?.len() > 30 * 1024 * 1024 {
                    return Err(Error::new(413, "草稿过大"));
                }
                let value: Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
                validate_story(&serde_json::to_string(&value["project"])?)?;
                Ok(value)
            })();
            Ok(match draft {
                Ok(value) => json!({"epoch":order.0,"draft":value}),
                Err(_) => {
                    json!({"epoch":order.0,"draft":null,"warning":"本机草稿无法读取，请从项目库或 GitHub 恢复"})
                }
            })
        }
        "mobile/import"
        | "mobile/export"
        | "mobile/background"
        | "mobile/input-state"
        | "mobile/hide-keyboard" => {
            let command = match endpoint.as_str() {
                "mobile/import" => "importProject",
                "mobile/export" => "exportFile",
                "mobile/input-state" => "inputState",
                "mobile/hide-keyboard" => "hideKeyboard",
                _ => "background",
            };
            if endpoint == "mobile/export"
                && body["text"].as_str().unwrap_or("").len() > 50 * 1024 * 1024
            {
                return Err(Error::new(413, "导出文件过大"));
            }
            app.state::<Mobile>()
                .0
                .run_mobile_plugin_async(command, body)
                .await
                .map_err(|_| Error::new(500, "Android 文件操作失败，请重试"))
        }
        _ => Err(Error::new(404, "未知 Android 操作")),
    }
}

pub struct AndroidCredentials(pub tauri::AppHandle);
impl xuxian_github_sync::Credentials for AndroidCredentials {
    fn get(&self, key: &str) -> Result<Option<String>, Error> {
        let response = call(&self.0, "secretGet", json!({"key":key}))?;
        Ok(response["value"].as_str().map(str::to_owned))
    }
    fn set(&self, key: &str, token: &str) -> Result<(), Error> {
        call(&self.0, "secretSet", json!({"key":key,"value":token}))?;
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), Error> {
        call(&self.0, "secretDelete", json!({"key":key}))?;
        Ok(())
    }
}
