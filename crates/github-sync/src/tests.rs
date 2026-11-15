use super::*;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct MemoryCredentials(Mutex<HashMap<String, String>>);
impl Credentials for Arc<MemoryCredentials> {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
    fn set(&self, key: &str, token: &str) -> Result<()> {
        self.0.lock().unwrap().insert(key.into(), token.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.0.lock().unwrap().remove(key);
        Ok(())
    }
}
struct Data {
    files: HashMap<String, RemoteFile>,
    private: bool,
    puts: usize,
    fail_put: bool,
}
#[derive(Clone)]
struct MemoryRemote(Arc<Mutex<Data>>);
impl Remote for MemoryRemote {
    fn repository(&self, _: &Connection) -> Result<RepoInfo> {
        Ok(RepoInfo {
            private: self.0.lock().unwrap().private,
            default_branch: "main".into(),
        })
    }
    fn file(&self, _: &Connection, path: &str) -> Result<Option<RemoteFile>> {
        Ok(self.0.lock().unwrap().files.get(path).cloned())
    }
    fn write_archive(
        &self,
        _: &Connection,
        path: &str,
        text: Option<&str>,
        metadata: Option<Value>,
        expected: Option<&str>,
    ) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        if state.fail_put {
            return Err(Error::new(503, "network failed"));
        }
        if state.files.get(path).map(|file| file.sha.as_str()) != expected {
            return Err(Error::new(409, "changed"));
        }
        let index = path.trim_end_matches(".json").to_owned() + ".meta.json";
        if let Some(text) = text {
            let sha = hash(text);
            let mut meta = metadata.unwrap();
            meta["dataSha"] = json!(sha);
            let metadata = meta.to_string();
            state.files.insert(
                path.into(),
                RemoteFile {
                    sha,
                    text: text.into(),
                },
            );
            state.files.insert(
                index,
                RemoteFile {
                    sha: hash(&metadata),
                    text: metadata,
                },
            );
        } else {
            state.files.remove(path);
            state.files.remove(&index);
        }
        state.puts += 1;
        Ok(())
    }
    fn list(&self, c: &Connection) -> Result<Value> {
        Ok(Value::Array(
            self.0
                .lock()
                .unwrap()
                .files
                .iter()
                .filter(|(path,_)| path.starts_with(&(c.directory.clone() + "/")))
                .map(|(path,file)| json!({"name":path.rsplit('/').next().unwrap(),"path":path,"sha":file.sha}))
                .collect(),
        ))
    }
}
impl Transport for MemoryRemote {
    fn connect(&self, _: &str) -> Result<Box<dyn Remote>> {
        Ok(Box::new(self.clone()))
    }
}
fn connection() -> Connection {
    Connection {
        owner: "writer".into(),
        repo: "shared-data".into(),
        branch: "main".into(),
        directory: "xuxian/projects".into(),
    }
}
fn story(title: &str) -> String {
    json!({"format":"xuxian.story","version":4,"id":"project_test","title":title,"routes":[{"id":"r"}],"chapters":[],"updatedAt":"first"}).to_string()
}
struct Fixture {
    _dir: tempfile::TempDir,
    store: Store,
    engine: Engine,
    remote: MemoryRemote,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path().join("projects")).unwrap();
        store.create(&story("local")).unwrap();
        let remote = MemoryRemote(Arc::new(Mutex::new(Data {
            files: HashMap::new(),
            private: true,
            puts: 0,
            fail_put: false,
        })));
        let mut engine = Engine::new(
            dir.path().join("sync"),
            Box::new(Arc::new(MemoryCredentials::default())),
            Box::new(remote.clone()),
        )
        .unwrap();
        engine
            .configure("", connection(), "fake-token-never-persist")
            .unwrap();
        Self {
            _dir: dir,
            store,
            engine,
            remote,
        }
    }
}
#[test]
fn manual_archives_always_save_every_project_and_never_choose_a_direction() {
    let mut f = Fixture::new();
    let mut second: Value = serde_json::from_str(&story("第二个项目")).unwrap();
    second["id"] = json!("project_two");
    f.store.create(&second.to_string()).unwrap();
    let id = connection().key();
    let saved = f
        .engine
        .archive_save(&f.store, &id, "", "", "全库存档", "章节完成")
        .unwrap();
    let name = saved["fileName"].as_str().unwrap();
    let preview = f.engine.archive_preview(&id, name).unwrap();
    assert_eq!(preview["projectCount"], 2);
    let count = f.remote.0.lock().unwrap().puts;
    let listing = f.engine.archive_list(&id).unwrap();
    assert_eq!(listing["slots"][0]["name"], "全库存档");
    assert_eq!(f.remote.0.lock().unwrap().puts, count);
    f.engine
        .archive_save(
            &f.store,
            &id,
            name,
            preview["sha"].as_str().unwrap(),
            "我选的覆盖名称",
            "备注",
        )
        .unwrap();
    assert_eq!(f.remote.0.lock().unwrap().puts, count + 1); // Equal content is still an explicit save.
    assert!(!fs::read_to_string(f.engine.root.join("settings.json"))
        .unwrap()
        .contains("fake-token-never-persist"));
}
#[test]
fn manual_load_replaces_the_whole_library_without_retaining_a_backup() {
    let mut f = Fixture::new();
    let id = connection().key();
    let saved = f
        .engine
        .archive_save(&f.store, &id, "", "", "读取目标", "")
        .unwrap();
    let preview = f
        .engine
        .archive_preview(&id, saved["fileName"].as_str().unwrap())
        .unwrap();
    let mut extra: Value = serde_json::from_str(&story("仅本机存在")).unwrap();
    extra["id"] = json!("extra");
    f.store.create(&extra.to_string()).unwrap();
    assert_eq!(f.store.capture_library().unwrap().len(), 2);
    let result = f
        .engine
        .archive_load(
            &mut f.store,
            &id,
            preview["fileName"].as_str().unwrap(),
            preview["sha"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(f.store.capture_library().unwrap().len(), 1);
    assert!(result.get("backupName").is_none());
    assert_eq!(result["cleanupPending"], false);
    assert_eq!(fs::read_dir(f._dir.path()).unwrap().count(), 2); // projects and connection settings only.
}
#[test]
fn overwrite_and_delete_require_the_previewed_slot_and_leave_other_software_untouched() {
    let f = Fixture::new();
    let id = connection().key();
    f.remote.0.lock().unwrap().files.insert(
        "other-app/settings.json".into(),
        RemoteFile {
            sha: "other".into(),
            text: "keep".into(),
        },
    );
    let saved = f
        .engine
        .archive_save(&f.store, &id, "", "", "A", "")
        .unwrap();
    let name = saved["fileName"].as_str().unwrap();
    let preview = f.engine.archive_preview(&id, name).unwrap();
    assert_eq!(
        f.engine
            .archive_save(&f.store, &id, name, "stale", "B", "")
            .unwrap_err()
            .status,
        409
    );
    assert_eq!(
        f.engine
            .archive_delete(&id, name, "stale")
            .unwrap_err()
            .status,
        409
    );
    assert!(f
        .engine
        .archive_delete(&id, "../other-app/settings.json", "other")
        .is_err());
    f.engine
        .archive_delete(&id, name, preview["sha"].as_str().unwrap())
        .unwrap();
    assert_eq!(f.remote.0.lock().unwrap().files.len(), 1);
    assert_eq!(f.store.capture_library().unwrap().len(), 1);
}
#[test]
fn archive_errors_and_public_repositories_do_not_modify_local_or_cloud_data() {
    let f = Fixture::new();
    let id = connection().key();
    f.remote.0.lock().unwrap().fail_put = true;
    assert!(f
        .engine
        .archive_save(&f.store, &id, "", "", "A", "")
        .is_err());
    assert!(f.remote.0.lock().unwrap().files.is_empty());
    assert_eq!(f.store.capture_library().unwrap().len(), 1);
    f.remote.0.lock().unwrap().private = false;
    assert_eq!(f.engine.archive_list(&id).unwrap_err().status, 403);
}
#[test]
fn old_project_files_are_ignored_and_the_legacy_slot_cannot_be_loaded() {
    let mut f = Fixture::new();
    let id = connection().key();
    let text = story("旧版云端");
    f.remote.0.lock().unwrap().files.insert(
        format!("{}/project_test.story.json", connection().directory),
        RemoteFile {
            sha: hash(&text),
            text,
        },
    );
    let list = f.engine.archive_list(&id).unwrap();
    assert!(list["slots"].as_array().unwrap().is_empty());
    assert!(list.get("legacyCount").is_none());
    assert_eq!(
        f.engine.archive_preview(&id, "legacy").unwrap_err().status,
        400
    );
    assert_eq!(
        f.engine
            .archive_load(&mut f.store, &id, "legacy", "unused")
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        f.store.capture_library().unwrap()[0].project["title"],
        "local"
    );
    assert_eq!(f.remote.0.lock().unwrap().files.len(), 1);
}

#[test]
fn configuration_is_global_private_and_preserves_legacy_metadata_without_using_it() {
    let mut f = Fixture::new();
    f.engine.settings.legacy.insert(
        "projects".into(),
        json!({"old":{"connection":"old-key","baseHash":"unused"}}),
    );
    f.engine
        .configure("ignored-project", connection(), "")
        .unwrap();
    assert!(f.engine.settings("ignored-project").unwrap()["linked"].is_null());
    let saved: Value =
        serde_json::from_str(&fs::read_to_string(f.engine.root.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(saved["projects"]["old"]["baseHash"], "unused");
    f.remote.0.lock().unwrap().private = false;
    assert_eq!(
        f.engine
            .configure("", connection(), "another-fixture")
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        f.engine
            .credentials
            .get(&connection().key())
            .unwrap()
            .as_deref(),
        Some("fake-token-never-persist")
    );
}
#[test]
fn rejects_unsafe_shared_repository_paths_before_any_configuration_write() {
    let mut f = Fixture::new();
    for directory in [
        "../other",
        "xuxian/../other",
        ".github/workflows",
        "xuxian//projects",
        "/absolute",
        "xuxian\\projects",
    ] {
        let mut c = connection();
        c.directory = directory.into();
        assert_eq!(
            f.engine.configure("", c, "fixture").unwrap_err().status,
            400
        );
    }
    assert!(f.remote.0.lock().unwrap().files.is_empty());
}
