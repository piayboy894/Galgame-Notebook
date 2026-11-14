use super::*;
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    thread,
};

fn server(
    responses: Vec<(u16, Value)>,
) -> (String, Arc<Mutex<Vec<String>>>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = requests.clone();
    let handle = thread::spawn(move || {
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                request.push_str(&line);
            }
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes).unwrap();
            request.push_str(&String::from_utf8(bytes).unwrap());
            captured.lock().unwrap().push(request);
            let body = if let Value::String(raw) = body {
                raw
            } else {
                body.to_string()
            };
            write!(stream,"HTTP/1.1 {status} Status\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
    });
    (address, requests, handle)
}
fn connection() -> Connection {
    Connection {
        owner: "writer".into(),
        repo: "data".into(),
        branch: "main".into(),
        directory: "xuxian/projects".into(),
    }
}
#[test]
fn reads_raw_content_when_contents_api_omits_base64() {
    let text = "{\"title\":\"raw 剧本\"}";
    let (base, requests, handle) = server(vec![
        (
            200,
            json!({"type":"file","size":text.len(),"sha":git_blob_sha(text.as_bytes()),"encoding":"none","content":""}),
        ),
        (200, Value::String(text.into())),
    ]);
    let client = GithubClient::with_base("fixture-token", &base).unwrap();
    assert_eq!(
        client
            .file(&connection(), "xuxian/projects/p.story.json")
            .unwrap()
            .unwrap()
            .text,
        text
    );
    handle.join().unwrap();
    assert!(requests.lock().unwrap()[1].contains("application/vnd.github.raw+json"));
}
#[test]
fn authenticates_requests_decodes_content_and_uses_sha_compare_and_swap() {
    let text = "{\"title\":\"剧本\"}";
    let sha = git_blob_sha(text.as_bytes());
    let (base, requests, handle) = server(vec![
        (
            200,
            json!({"type":"file","size":text.len(),"sha":sha,"encoding":"base64","content":STANDARD.encode(text)}),
        ),
        (200, json!({"content":{"sha":"new"}})),
    ]);
    let client = GithubClient::with_base("test-secret-only", &base).unwrap();
    let c = connection();
    let file = client
        .file(&c, "xuxian/projects/project_test.story.json")
        .unwrap()
        .unwrap();
    assert_eq!(file.text, text);
    client
        .put(
            &c,
            "xuxian/projects/project_test.story.json",
            text,
            Some(&file.sha),
        )
        .unwrap();
    handle.join().unwrap();
    let requests = requests.lock().unwrap();
    assert!(requests[0]
        .contains("/repos/writer/data/contents/xuxian/projects/project_test.story.json?ref=main"));
    assert!(requests[0]
        .to_ascii_lowercase()
        .contains("authorization: bearer test-secret-only"));
    let body: Value = serde_json::from_str(requests[1].split("\r\n").last().unwrap()).unwrap();
    assert_eq!(body["sha"], sha);
    assert_eq!(body["branch"], "main");
}
#[test]
fn rejects_racing_content_and_redacts_remote_errors() {
    let (base, _, handle) = server(vec![
        (
            200,
            json!({"type":"file","size":2,"sha":"wrong","encoding":"base64","content":STANDARD.encode("{}")}),
        ),
        (401, json!({"message":"echo test-secret-only"})),
    ]);
    let client = GithubClient::with_base("test-secret-only", &base).unwrap();
    assert_eq!(
        client
            .file(&connection(), "xuxian/projects/a.story.json")
            .unwrap_err()
            .status,
        409
    );
    let error = client
        .put(&connection(), "xuxian/projects/a.story.json", "{}", None)
        .unwrap_err();
    assert_eq!(error.status, 401);
    assert!(!error.message.contains("test-secret-only"));
    handle.join().unwrap();
}
