use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use xuxian_story_store::{Error, Store};
mod github_sync;
#[cfg(target_os = "android")]
mod mobile;
#[cfg(target_os = "android")]
mod mobile_update;

struct AppStore(Mutex<Store>);
fn lock<'a>(store: &'a State<'_, AppStore>) -> Result<std::sync::MutexGuard<'a, Store>, Error> {
    store
        .0
        .lock()
        .map_err(|_| Error::new(500, "项目服务忙，请重新启动叙线"))
}

#[tauri::command]
fn project_command(
    app: tauri::AppHandle,
    store: State<'_, AppStore>,
    endpoint: String,
    body: Value,
) -> Result<Value, Error> {
    let mut store = lock(&store)?;
    if endpoint == "updates/open-download-page" {
        app.opener()
            .open_url(
                "https://github.com/piayboy894/Galgame-Notebook/releases/latest",
                None::<&str>,
            )
            .map_err(|e| Error::new(500, e.to_string()))?;
        return Ok(json!({"opened":true}));
    }
    if endpoint == "projects/reveal-source" {
        #[cfg(target_os = "android")]
        return Err(Error::new(
            400,
            "Android 项目保存在应用内，请使用「导出源文件」选择保存位置",
        ));
        #[cfg(not(target_os = "android"))]
        {
            let path = store.source_path(body["bindingId"].as_str().unwrap_or(""))?;
            app.opener()
                .reveal_item_in_dir(&path)
                .map_err(|e| Error::new(500, e.to_string()))?;
            return Ok(json!({"opened": true}));
        }
    }
    if endpoint == "projects/open-folder" {
        #[cfg(target_os = "android")]
        return Err(Error::new(
            400,
            "Android 请在项目列表管理文件，或导出到系统文件夹",
        ));
        #[cfg(not(target_os = "android"))]
        {
            app.opener()
                .open_path(store.root().to_string_lossy().into_owned(), None::<&str>)
                .map_err(|e| Error::new(500, e.to_string()))?;
            return Ok(json!({"opened":true}));
        }
    }
    store.command(&endpoint, &body)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn import_folder(app: tauri::AppHandle) -> Result<Value, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("选择旧版的「剧本项目」文件夹")
            .blocking_pick_folder()
        else {
            return Ok(json!({"cancelled":true}));
        };
        let path = folder
            .into_path()
            .map_err(|_| Error::new(400, "请选择本地文件夹"))?;
        let state = app.state::<AppStore>();
        let result = lock(&state)?.import_folder(&path);
        result
    })
    .await
    .map_err(|e| Error::new(500, e.to_string()))?
}

#[tauri::command]
#[cfg(target_os = "android")]
async fn import_folder() -> Result<Value, Error> {
    Err(Error::new(
        400,
        "Android 请通过系统文件选择器导入 JSON，或从 GitHub 恢复项目",
    ))
}

#[tauri::command]
async fn export_file(app: tauri::AppHandle, name: String, text: String) -> Result<Value, Error> {
    if text.len() > 50 * 1024 * 1024 {
        return Err(Error::new(413, "导出文件过大"));
    }
    let name = std::path::Path::new(&name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("剧本.story.json")
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("导出文件")
            .set_file_name(&name)
            .blocking_save_file()
        else {
            return Ok(json!({"cancelled":true}));
        };
        let path = file
            .into_path()
            .map_err(|_| Error::new(400, "请选择本地文件"))?;
        std::fs::write(path, text)?;
        Ok(json!({"saved":true}))
    })
    .await
    .map_err(|e| Error::new(500, e.to_string()))?
}

#[tauri::command]
fn backup_before_update(app: tauri::AppHandle, store: State<'_, AppStore>) -> Result<(), Error> {
    lock(&store)?.backup_all(&app.package_info().version.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(mobile::init())
        .manage(mobile_update::UpdateCache::default());
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(not(target_os = "android"))]
            let root = app.path().document_dir()?.join("叙线").join("剧本项目");
            #[cfg(target_os = "android")]
            let root = app.path().app_data_dir()?.join("projects");
            let mut store = Store::new(root).map_err(|e| std::io::Error::other(e.message))?;
            // Migrate a portable predecessor only by copying its adjacent project folder.
            #[cfg(desktop)]
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    let legacy = parent.join("剧本项目");
                    if legacy.is_dir() {
                        let _ = store.import_folder(&legacy);
                    }
                }
            }
            store
                .seed_once(&[include_str!("../../examples/三线交汇_示例.story.json")])
                .map_err(|e| std::io::Error::other(e.message))?;
            app.manage(AppStore(Mutex::new(store)));
            app.manage(github_sync::SyncState::default());
            Ok(())
        });
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        project_command,
        import_folder,
        export_file,
        backup_before_update,
        github_sync::github_sync_command,
        mobile::mobile_command
    ]);
    #[cfg(not(target_os = "android"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        project_command,
        import_folder,
        export_file,
        backup_before_update,
        github_sync::github_sync_command
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("无法启动叙线桌面版");
}
