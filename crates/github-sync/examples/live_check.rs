//! Opt-in verification on a disposable branch. Uses existing GH_TOKEN only in memory.
use serde_json::{json, Value};
use xuxian_github_sync::{
    Connection, Credentials, Engine, GithubClient, GithubTransport, Remote, Result,
};
use xuxian_story_store::Store;

struct TestCredential;
impl Credentials for TestCredential {
    fn get(&self, _: &str) -> Result<Option<String>> {
        Ok(std::env::var("GH_TOKEN").ok())
    }
    fn set(&self, _: &str, _: &str) -> Result<()> {
        Ok(())
    }
    fn delete(&self, _: &str) -> Result<()> {
        Ok(())
    }
}
fn main() {
    let repository =
        std::env::var("XUXIAN_TEST_REPOSITORY").expect("Set a disposable private test repository");
    let branch = std::env::var("XUXIAN_TEST_BRANCH").expect("Set a disposable test branch");
    assert!(
        branch.starts_with("verify/"),
        "Only a disposable verify/ branch is allowed"
    );
    let (owner, repo) = repository.split_once('/').unwrap();
    let connection = Connection {
        owner: owner.into(),
        repo: repo.into(),
        branch,
        directory: "xuxian/projects".into(),
    };
    let token =
        std::env::var("GH_TOKEN").expect("GH_TOKEN is required; never pass a token in arguments");
    let remote = GithubClient::new(&token).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let mut local = Store::new(directory.path().join("local")).unwrap();
    let story = json!({"format":"xuxian.story","version":4,"id":"project_sync_verification_2_2","title":"叙线同步协议测试","routes":[{"id":"r"}],"chapters":[]});
    let mut opened = local.create(&story.to_string()).unwrap();
    let mut engine = Engine::new(
        directory.path().join("settings"),
        Box::new(TestCredential),
        Box::new(GithubTransport),
    )
    .unwrap();
    let configured = engine
        .configure("project_sync_verification_2_2", connection.clone(), &token)
        .unwrap();
    let path = "xuxian/projects/project_sync_verification_2_2.story.json";
    let plan = engine
        .inspect(&local, &opened.binding_id, &opened.stamp)
        .unwrap();
    assert_eq!(plan["action"], "upload");
    engine
        .execute(&mut local, plan["planId"].as_str().unwrap(), "")
        .unwrap();
    let plan = engine
        .inspect(&local, &opened.binding_id, &opened.stamp)
        .unwrap();
    assert_eq!(plan["action"], "current");
    engine
        .execute(&mut local, plan["planId"].as_str().unwrap(), "")
        .unwrap();
    let file = remote.file(&connection, path).unwrap().unwrap();
    let mut changed: Value = serde_json::from_str(&file.text).unwrap();
    changed["title"] = json!("模拟另一台设备的更新");
    remote
        .put(&connection, path, &changed.to_string(), Some(&file.sha))
        .unwrap();
    let plan = engine
        .inspect(&local, &opened.binding_id, &opened.stamp)
        .unwrap();
    assert_eq!(plan["action"], "download");
    let result = engine
        .execute(&mut local, plan["planId"].as_str().unwrap(), "")
        .unwrap();
    opened = local
        .open(result["opened"]["name"].as_str().unwrap())
        .unwrap();
    assert!(opened.text.contains("模拟另一台设备"));
    changed["title"] = json!("本地并行修改");
    opened = local
        .save(
            &opened.binding_id,
            &changed.to_string(),
            Some(opened.stamp),
            false,
        )
        .unwrap();
    let file = remote.file(&connection, path).unwrap().unwrap();
    changed["title"] = json!("远端并行修改");
    remote
        .put(&connection, path, &changed.to_string(), Some(&file.sha))
        .unwrap();
    let plan = engine
        .inspect(&local, &opened.binding_id, &opened.stamp)
        .unwrap();
    assert_eq!(plan["action"], "conflict");
    let result = engine
        .execute(&mut local, plan["planId"].as_str().unwrap(), "local")
        .unwrap();
    assert!(result["conflictCopy"].is_string());
    let key = configured["connectionId"].as_str().unwrap();
    let preview = engine
        .preview(key, "project_sync_verification_2_2.story.json")
        .unwrap();
    let mut other = Store::new(directory.path().join("other-device")).unwrap();
    engine
        .restore(
            &mut other,
            key,
            "project_sync_verification_2_2.story.json",
            preview["sha"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(other.list().unwrap()["items"].as_array().unwrap().len(), 1);
    println!("PASS: real private GitHub upload, unchanged detection, remote pull, two-sided conflict preservation and device restoration");
}
