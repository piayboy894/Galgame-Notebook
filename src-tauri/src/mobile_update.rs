//! Android updates use the same pinned Minisign public key as desktop; Android additionally verifies the APK signer.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;
use xuxian_story_store::Error;

#[derive(Clone, Deserialize, Serialize)]
struct Manifest {
    version: String,
    notes: String,
    url: String,
    signature: String,
    sha256: String,
}
#[derive(Default)]
pub struct UpdateCache(Mutex<Option<Manifest>>);
const RELEASES: &str = "https://github.com/piayboy894/Galgame-Notebook/releases/";
fn client() -> Result<reqwest::blocking::Client, Error> {
    reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Xuxian-Android-Updater")
        .build()
        .map_err(|_| Error::new(500, "无法初始化更新连接"))
}
pub fn check(app: &tauri::AppHandle) -> Result<Value, Error> {
    let response = client()?
        .get(format!("{RELEASES}latest/download/android-latest.json"))
        .timeout(Duration::from_secs(30))
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|_| Error::new(503, "无法获取 Android 更新，请检查网络或打开下载页面"))?;
    let mut bytes = Vec::new();
    response
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::new(503, "更新清单下载中断"))?;
    if bytes.len() > 65536 {
        return Err(Error::new(400, "更新清单过大"));
    }
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| Error::new(400, "Android 更新清单无效"))?;
    let version =
        semver::Version::parse(&manifest.version).map_err(|_| Error::new(400, "更新版本号无效"))?;
    let expected = format!(
        "{RELEASES}download/v{}/Xuxian_{}_android.apk",
        manifest.version, manifest.version
    );
    if manifest.url != expected
        || manifest.sha256.len() != 64
        || !manifest.sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(Error::new(400, "Android 更新来源或校验值无效"));
    }
    let state = app.state::<UpdateCache>();
    let mut cache = state.0.lock().map_err(|_| Error::new(500, "更新服务忙"))?;
    if version <= semver::Version::parse(&app.package_info().version.to_string()).unwrap() {
        *cache = None;
        return Ok(Value::Null);
    }
    let result = json!({"version":manifest.version,"notes":manifest.notes});
    *cache = Some(manifest);
    Ok(result)
}
pub fn install(app: &tauri::AppHandle) -> Result<Value, Error> {
    let manifest = app
        .state::<UpdateCache>()
        .0
        .lock()
        .map_err(|_| Error::new(500, "更新服务忙"))?
        .clone()
        .ok_or_else(|| Error::new(409, "请先检测 Android 更新"))?;
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|_| Error::new(500, "无法获取更新缓存目录"))?
        .join("updates");
    std::fs::create_dir_all(&root)?;
    let response = client()?
        .get(&manifest.url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|_| Error::new(503, "安装包下载失败，请重试"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(&root)?;
    let mut reader = response.take(100 * 1024 * 1024 + 1);
    let mut hash = Sha256::new();
    let mut count = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let size = reader
            .read(&mut buffer)
            .map_err(|_| Error::new(503, "安装包下载中断"))?;
        if size == 0 {
            break;
        }
        count += size as u64;
        if count > 100 * 1024 * 1024 {
            return Err(Error::new(413, "安装包超过大小限制"));
        }
        hash.update(&buffer[..size]);
        temporary.write_all(&buffer[..size])?;
    }
    if format!("{:x}", hash.finalize()) != manifest.sha256.to_ascii_lowercase() {
        return Err(Error::new(400, "安装包校验失败，已停止更新"));
    }
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let key_text = String::from_utf8(
        STANDARD
            .decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())
            .map_err(|_| Error::new(500, "更新公钥无效"))?,
    )
    .map_err(|_| Error::new(500, "更新公钥无效"))?;
    let signature_text = String::from_utf8(
        STANDARD
            .decode(manifest.signature.trim())
            .map_err(|_| Error::new(400, "更新签名无效"))?,
    )
    .map_err(|_| Error::new(400, "更新签名无效"))?;
    let key = PublicKey::decode(&key_text).map_err(|_| Error::new(500, "更新公钥无效"))?;
    let signature =
        Signature::decode(&signature_text).map_err(|_| Error::new(400, "更新签名无效"))?;
    key.verify(&std::fs::read(temporary.path())?, &signature, true)
        .map_err(|_| Error::new(400, "更新包签名验证失败，已停止安装"))?;
    if !signature
        .trusted_comment()
        .split('\t')
        .any(|field| field == format!("version:{}", manifest.version))
    {
        return Err(Error::new(400, "更新清单版本与签名版本不一致"));
    }
    temporary.as_file().sync_all()?;
    temporary
        .persist(root.join("Xuxian-update.apk"))
        .map_err(|e| Error::from(e.error))?;
    crate::mobile::call(app, "installUpdate", json!({}))
}
