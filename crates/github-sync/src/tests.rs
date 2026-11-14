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
    fn put(&self, _: &Connection, path: &str, text: &str, sha: Option<&str>) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        if state.fail_put {
            return Err(Error::new(503, "network failed"));
        }
        if state.files.get(path).map(|file| file.sha.as_str()) != sha {
            return Err(Error::new(409, "changed"));
        }
        state.files.insert(
            path.into(),
            RemoteFile {
                sha: hash(text),
                text: text.into(),
            },
        );
        state.puts += 1;
        Ok(())
    }
    fn list(&self, c: &Connection) -> Result<Value> {
        Ok(Value::Array(
            self.0
                .lock()
                .unwrap()
                .files
                .keys()
                .filter(|path| path.starts_with(&(c.directory.clone() + "/")))
                .map(|path| json!({"name":path.rsplit('/').next().unwrap(),"path":path}))
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
    opened: Opened,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path().join("projects")).unwrap();
        let opened = store.create(&story("local")).unwrap();
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
            .configure("project_test", connection(), "fake-token-never-persist")
            .unwrap();
        Self {
            _dir: dir,
            store,
            engine,
            remote,
            opened,
        }
    }
    fn inspect(&mut self) -> Value {
        self.engine
            .inspect(&self.store, &self.opened.binding_id, &self.opened.stamp)
            .unwrap()
    }
    fn execute(&mut self, plan: &Value, choice: &str) -> Value {
        let result = self
            .engine
            .execute(&mut self.store, plan["planId"].as_str().unwrap(), choice)
            .unwrap();
        self.opened = self
            .store
            .open(result["opened"]["name"].as_str().unwrap())
            .unwrap();
        result
    }
    fn set_remote(&self, title: &str) {
        let text = story(title);
        self.remote.0.lock().unwrap().files.insert(
            connection().path("project_test").unwrap(),
            RemoteFile {
                sha: hash(&text),
                text,
            },
        );
    }
    fn save_local(&mut self, title: &str) {
        self.opened = self
            .store
            .save(
                &self.opened.binding_id,
                &story(title),
                Some(self.opened.stamp.clone()),
                false,
            )
            .unwrap();
    }
    fn first_sync(&mut self) {
        let plan = self.inspect();
        self.execute(&plan, "");
    }
}

#[test]
fn decision_handles_both_sides_and_first_sync_without_guessing() {
    assert_eq!(decide("a", None, None), "upload");
    assert_eq!(decide("a", None, Some("a")), "deleted");
    assert_eq!(decide("a", Some("a"), None), "current");
    assert_eq!(decide("a", Some("b"), None), "conflict");
    assert_eq!(decide("b", Some("a"), Some("a")), "upload");
    assert_eq!(decide("a", Some("b"), Some("a")), "download");
    assert_eq!(decide("b", Some("c"), Some("a")), "conflict");
}
#[test]
fn uploads_then_skips_unchanged_and_does_not_persist_the_token() {
    let mut f = Fixture::new();
    f.first_sync();
    let plan = f.inspect();
    assert_eq!(plan["action"], "current");
    f.execute(&plan, "");
    assert_eq!(f.remote.0.lock().unwrap().puts, 1);
    let disk = fs::read_to_string(f.engine.root.join("settings.json")).unwrap();
    assert!(!disk.contains("fake-token"));
    assert!(!f.opened.text.contains("token"));
    assert!(f.engine.settings("project_test").unwrap()["linked"]["lastSync"].is_number());
}
#[test]
fn remote_only_edits_are_downloaded_with_backup() {
    let mut f = Fixture::new();
    f.first_sync();
    f.set_remote("remote");
    let plan = f.inspect();
    assert_eq!(plan["action"], "download");
    f.execute(&plan, "");
    assert_eq!(validate_story(&f.opened.text).unwrap()["title"], "remote");
    assert!(fs::read_dir(f.store.root().join("_备份"))
        .unwrap()
        .next()
        .is_some());
}
#[test]
fn conflicts_require_choice_and_keep_remote_copy_before_upload() {
    let mut f = Fixture::new();
    f.first_sync();
    f.save_local("new local");
    f.set_remote("new remote");
    let plan = f.inspect();
    assert_eq!(plan["action"], "conflict");
    let result = f.execute(&plan, "local");
    assert!(result["conflictCopy"]
        .as_str()
        .unwrap()
        .contains("GitHub 冲突副本"));
    let copy = fs::read_to_string(
        f.store
            .root()
            .join(result["conflictCopy"].as_str().unwrap()),
    )
    .unwrap();
    assert!(copy.contains("new remote"));
    assert_ne!(validate_story(&copy).unwrap()["id"], "project_test");
    assert!(f.opened.text.contains("new local"));
}
#[test]
fn choosing_remote_keeps_local_in_automatic_backup() {
    let mut f = Fixture::new();
    f.first_sync();
    f.save_local("new local");
    f.set_remote("new remote");
    let plan = f.inspect();
    f.execute(&plan, "remote");
    assert!(f.opened.text.contains("new remote"));
    assert!(fs::read_dir(f.store.root().join("_备份"))
        .unwrap()
        .any(|entry| fs::read_to_string(entry.unwrap().path())
            .unwrap()
            .contains("new local")));
}
#[test]
fn remote_change_after_inspection_or_local_external_edit_stops_execution() {
    let mut f = Fixture::new();
    f.first_sync();
    f.save_local("change");
    let plan = f.inspect();
    f.set_remote("racing");
    assert_eq!(
        f.engine
            .execute(&mut f.store, plan["planId"].as_str().unwrap(), "")
            .unwrap_err()
            .status,
        409
    );
    let plan = f.inspect();
    fs::write(f.store.root().join(&f.opened.name), story("external")).unwrap();
    assert_eq!(
        f.engine
            .execute(&mut f.store, plan["planId"].as_str().unwrap(), "remote")
            .unwrap_err()
            .status,
        409
    );
}
#[test]
fn remote_deletion_is_not_silently_recreated() {
    let mut f = Fixture::new();
    f.first_sync();
    f.remote.0.lock().unwrap().files.clear();
    let plan = f.inspect();
    assert_eq!(plan["action"], "deleted");
    assert!(f
        .engine
        .execute(&mut f.store, plan["planId"].as_str().unwrap(), "")
        .is_err());
    assert!(f.remote.0.lock().unwrap().files.is_empty());
    let plan = f.inspect();
    f.execute(&plan, "local");
    assert!(!f.remote.0.lock().unwrap().files.is_empty());
}
#[test]
fn changing_visibility_stops_sync_and_configuration_rejects_public() {
    let mut f = Fixture::new();
    let plan = f.inspect();
    f.remote.0.lock().unwrap().private = false;
    assert!(f
        .engine
        .execute(&mut f.store, plan["planId"].as_str().unwrap(), "")
        .is_err());
    assert!(f
        .engine
        .configure("project_test", connection(), "another-token")
        .is_err());
    assert_eq!(f.remote.0.lock().unwrap().puts, 0);
}
#[test]
fn invalid_remote_story_or_other_project_is_never_applied() {
    let mut f = Fixture::new();
    let path = connection().path("project_test").unwrap();
    for text in [
        "not json".to_owned(),
        story("remote").replace("project_test", "other_project"),
    ] {
        f.remote.0.lock().unwrap().files.insert(
            path.clone(),
            RemoteFile {
                sha: hash(&text),
                text,
            },
        );
        assert!(f
            .engine
            .inspect(&f.store, &f.opened.binding_id, &f.opened.stamp)
            .is_err());
        assert!(f.opened.text.contains("local"));
    }
}
#[test]
fn restore_is_scoped_to_directory_and_does_not_duplicate_existing_projects() {
    let mut f = Fixture::new();
    f.first_sync();
    let key = connection().key();
    assert!(f
        .engine
        .restore(&mut f.store, &key, "../outside.story.json", "")
        .is_err());
    let preview = f.engine.preview(&key, "project_test.story.json").unwrap();
    assert!(f
        .engine
        .restore(
            &mut f.store,
            &key,
            "project_test.story.json",
            preview["sha"].as_str().unwrap()
        )
        .is_err());
    let dir = tempfile::tempdir().unwrap();
    let mut other = Store::new(dir.path().into()).unwrap();
    let restored = f
        .engine
        .restore(
            &mut other,
            &key,
            "project_test.story.json",
            preview["sha"].as_str().unwrap(),
        )
        .unwrap();
    assert!(restored["opened"]["text"]
        .as_str()
        .unwrap()
        .contains("local"));
}
#[test]
fn failed_upload_preserves_local_and_does_not_advance_baseline() {
    let mut f = Fixture::new();
    f.first_sync();
    f.save_local("pending");
    f.remote.0.lock().unwrap().fail_put = true;
    let plan = f.inspect();
    assert!(f
        .engine
        .execute(&mut f.store, plan["planId"].as_str().unwrap(), "")
        .is_err());
    assert_eq!(f.inspect()["action"], "upload");
    assert!(f.opened.text.contains("pending"));
}
#[test]
fn canonical_hash_ignores_only_updated_time_and_formatting() {
    let a = story("same");
    let mut b: Value = serde_json::from_str(&a).unwrap();
    b["updatedAt"] = json!("later");
    assert_eq!(
        content_hash(&a).unwrap(),
        content_hash(&serde_json::to_string_pretty(&b).unwrap()).unwrap()
    );
    b["title"] = json!("different");
    assert_ne!(
        content_hash(&a).unwrap(),
        content_hash(&b.to_string()).unwrap()
    );
}
#[test]
fn unsafe_paths_are_rejected() {
    let mut first = connection();
    first.branch = "a/b".into();
    first.directory = "c".into();
    let mut second = connection();
    second.branch = "a".into();
    second.directory = "b/c".into();
    assert_ne!(first.key(), second.key());
    for path in [
        "../other",
        "/absolute",
        "xuxian//projects",
        "xuxian/../../code",
        ".github/workflows",
        "xuxian\\projects",
    ] {
        let mut c = connection();
        c.directory = path.into();
        assert!(c.validate().is_err(), "{path}");
    }
}
