use crate::{Connection, Remote, RemoteFile, RepoInfo, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{
    blocking::{Client, Response},
    Method, Url,
};
use serde_json::{json, Value};
use std::{io::Read, time::Duration};
use xuxian_story_store::Error;

const LIMIT: u64 = 50 * 1024 * 1024;

pub struct GithubClient {
    client: Client,
    token: String,
    base: Url,
}
impl GithubClient {
    pub fn new(token: &str) -> Result<Self> {
        Self::with_base(token, "https://api.github.com/")
    }
    fn with_base(token: &str, base: &str) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(40))
            .connect_timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Xuxian-Desktop-GitHub-Sync")
            .build()
            .map_err(|_| Error::new(500, "无法初始化 GitHub 连接"))?;
        Ok(Self {
            client,
            token: token.into(),
            base: Url::parse(base).unwrap(),
        })
    }
    fn request(
        &self,
        method: Method,
        connection: &Connection,
        suffix: &[&str],
        raw: bool,
        body: Option<Value>,
    ) -> Result<Response> {
        let mut url = self.base.clone();
        {
            let mut path = url.path_segments_mut().unwrap();
            path.pop_if_empty()
                .extend(["repos", &connection.owner, &connection.repo]);
            path.extend(suffix);
        }
        if suffix.first() == Some(&"contents") && method == Method::GET {
            url.query_pairs_mut().append_pair("ref", &connection.branch);
        }
        let mut request = self
            .client
            .request(method, url)
            .bearer_auth(&self.token)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header(
                "Accept",
                if raw {
                    "application/vnd.github.raw+json"
                } else if suffix.first() == Some(&"contents") {
                    "application/vnd.github.object+json"
                } else {
                    "application/vnd.github+json"
                },
            );
        if let Some(body) = body {
            request = request.json(&body);
        }
        request
            .send()
            .map_err(|_| Error::new(503, "无法连接 GitHub，请检查网络后重试；本地剧本已保留"))
    }
    fn checked(response: Response) -> Result<Response> {
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status().as_u16();
        let message = match status {
            401 => "GitHub 令牌无效或已过期，请重新配置",
            403 | 429 => {
                "GitHub 拒绝访问或请求达到限制；请检查令牌的仓库 Contents 读写权限，稍后重试"
            }
            404 => {
                "无法访问仓库或分支，请检查地址和令牌授权；新仓库需先添加 README，创建 main 分支"
            }
            409 | 422 => "GitHub 文件已改变或分支禁止直接提交，请重新同步；双方内容已保留",
            _ => "GitHub 服务暂时不可用，请稍后重试",
        };
        Err(Error::new(status, message))
    }
    fn json(response: Response) -> Result<Value> {
        let response = Self::checked(response)?;
        let mut bytes = Vec::new();
        response
            .take((LIMIT * 2) + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::new(503, "GitHub 响应中断，请重试"))?;
        if bytes.len() as u64 > LIMIT * 2 {
            return Err(Error::new(413, "GitHub 响应过大"));
        }
        serde_json::from_slice(&bytes).map_err(|_| Error::new(502, "GitHub 返回了无效数据"))
    }
    fn file_parts<'a>(path: &'a str) -> Vec<&'a str> {
        std::iter::once("contents").chain(path.split('/')).collect()
    }
}
impl Remote for GithubClient {
    fn repository(&self, connection: &Connection) -> Result<RepoInfo> {
        let metadata = Self::json(self.request(Method::GET, connection, &[], false, None)?)?;
        let default_branch = metadata["default_branch"]
            .as_str()
            .unwrap_or("main")
            .to_owned();
        // A populated branch is required, so configuration never creates surprise commits.
        Self::checked(self.request(
            Method::GET,
            connection,
            &["branches", &connection.branch],
            false,
            None,
        )?)?;
        Ok(RepoInfo {
            private: metadata["private"].as_bool().unwrap_or(false),
            default_branch,
        })
    }
    fn file(&self, connection: &Connection, path: &str) -> Result<Option<RemoteFile>> {
        let parts = Self::file_parts(path);
        let response = self.request(Method::GET, connection, &parts, false, None)?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        let metadata = Self::json(response)?;
        if metadata["type"] != "file" || metadata["submodule_git_url"].is_string() {
            return Err(Error::new(400, "GitHub 目标必须是普通剧本 JSON 文件"));
        }
        if metadata["size"].as_u64().unwrap_or(LIMIT + 1) > LIMIT {
            return Err(Error::new(413, "远端存档超过 50 MB"));
        }
        let sha = metadata["sha"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| Error::new(502, "GitHub 未返回文件版本"))?
            .to_owned();
        let bytes = if metadata["encoding"] == "base64" {
            let encoded: String = metadata["content"]
                .as_str()
                .unwrap_or("")
                .split_whitespace()
                .collect();
            STANDARD
                .decode(encoded)
                .map_err(|_| Error::new(502, "GitHub 文件编码无效"))?
        } else {
            let response =
                Self::checked(self.request(Method::GET, connection, &parts, true, None)?)?;
            let mut bytes = Vec::new();
            response
                .take(LIMIT + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| Error::new(503, "下载剧本中断，请重试"))?;
            // Raw requests can race with metadata reads. Check the blob hash below.
            bytes
        };
        if bytes.len() as u64 > LIMIT {
            return Err(Error::new(413, "远端存档超过 50 MB"));
        }
        if git_blob_sha(&bytes) != sha {
            return Err(Error::new(409, "GitHub 剧本在读取时改变，请重新同步"));
        }
        let text =
            String::from_utf8(bytes).map_err(|_| Error::new(400, "远端剧本不是 UTF-8 文本"))?;
        Ok(Some(RemoteFile { sha, text }))
    }
    fn write_archive(
        &self,
        connection: &Connection,
        path: &str,
        text: Option<&str>,
        metadata: Option<Value>,
        expected: Option<&str>,
    ) -> Result<()> {
        // Commit the save and its small index together. Fast-forward-only refs protect every
        // other application sharing the repository; a race never creates a partial visible slot.
        let branch: Vec<_> = connection.branch.split('/').collect();
        let mut read_ref = vec!["git", "ref", "heads"];
        read_ref.extend(&branch);
        let reference =
            Self::json(self.request(Method::GET, connection, &read_ref, false, None)?)?;
        let head = reference["object"]["sha"]
            .as_str()
            .ok_or_else(|| Error::new(502, "GitHub 分支版本无效"))?;
        let commit = Self::json(self.request(
            Method::GET,
            connection,
            &["git", "commits", head],
            false,
            None,
        )?)?;
        let tree = commit["tree"]["sha"]
            .as_str()
            .ok_or_else(|| Error::new(502, "GitHub 目录版本无效"))?;
        let mut pinned = connection.clone();
        pinned.branch = head.into();
        let response = self.request(Method::GET, &pinned, &Self::file_parts(path), false, None)?;
        let current = if response.status().as_u16() == 404 {
            None
        } else {
            let value = Self::json(response)?;
            if value["type"] != "file" {
                return Err(Error::new(400, "云存档目标必须是普通文件"));
            }
            Some(
                value["sha"]
                    .as_str()
                    .ok_or_else(|| Error::new(502, "云存档缺少版本标识"))?
                    .to_owned(),
            )
        };
        if current.as_deref() != expected {
            return Err(Error::new(409, "目标云存档已变化，请刷新预览后手动重试"));
        }
        let index_path = path.trim_end_matches(".json").to_owned() + ".meta.json";
        let mut entries = Vec::new();
        if let Some(text) = text {
            if text.len() as u64 > LIMIT {
                return Err(Error::new(413, "整个项目库存档超过 50 MB"));
            }
            let blob = Self::json(self.request(
                Method::POST,
                connection,
                &["git", "blobs"],
                false,
                Some(json!({"encoding":"base64","content":STANDARD.encode(text)})),
            )?)?;
            let sha = blob["sha"]
                .as_str()
                .ok_or_else(|| Error::new(502, "GitHub 存档版本无效"))?;
            if sha != git_blob_sha(text.as_bytes()) {
                return Err(Error::new(502, "上传存档校验失败，未修改云存档"));
            }
            let mut index = metadata.ok_or_else(|| Error::new(400, "云存档索引缺失"))?;
            index["dataSha"] = json!(sha);
            entries.push(json!({"path":path,"mode":"100644","type":"blob","sha":sha}));
            entries.push(json!({"path":index_path,"mode":"100644","type":"blob","content":serde_json::to_string(&index)?}));
        } else {
            entries.push(json!({"path":path,"mode":"100644","type":"blob","sha":null}));
            let response = self.request(
                Method::GET,
                &pinned,
                &Self::file_parts(&index_path),
                false,
                None,
            )?;
            if response.status().as_u16() != 404 {
                Self::checked(response)?;
                entries.push(json!({"path":index_path,"mode":"100644","type":"blob","sha":null}));
            }
        }
        let next = Self::json(self.request(
            Method::POST,
            connection,
            &["git", "trees"],
            false,
            Some(json!({"base_tree":tree,"tree":entries})),
        )?)?;
        let next_tree = next["sha"]
            .as_str()
            .ok_or_else(|| Error::new(502, "GitHub 未返回新目录版本"))?;
        let next=Self::json(self.request(Method::POST,connection,&["git","commits"],false,Some(json!({"message":if text.is_some(){"叙线：手动存档全部项目"}else{"叙线：手动删除全局云存档"},"tree":next_tree,"parents":[head]})))?)?;
        let next_commit = next["sha"]
            .as_str()
            .ok_or_else(|| Error::new(502, "GitHub 未返回存档提交"))?;
        let mut write_ref = vec!["git", "refs", "heads"];
        write_ref.extend(branch);
        let response = self.request(
            Method::PATCH,
            connection,
            &write_ref,
            false,
            Some(json!({"sha":next_commit,"force":false})),
        )?;
        if matches!(response.status().as_u16(), 409 | 422) {
            return Err(Error::new(
                409,
                "仓库刚有其他提交，请刷新后手动重试；没有覆盖其他软件的数据",
            ));
        }
        Self::checked(response)?;
        Ok(())
    }
    fn list(&self, connection: &Connection) -> Result<Value> {
        let response = self.request(
            Method::GET,
            connection,
            &Self::file_parts(&connection.directory),
            false,
            None,
        )?;
        if response.status().as_u16() == 404 {
            return Ok(json!([]));
        }
        let entries = Self::json(response)?;
        let entries = entries
            .as_array()
            .or_else(|| entries["entries"].as_array())
            .ok_or_else(|| Error::new(400, "配置的数据目录在 GitHub 上不是文件夹"))?;
        if entries.len() >= 1000 {
            return Err(Error::new(
                413,
                "存档目录达到 GitHub 的 1000 项限制，请在 GitHub 手动清理或改用其他目录",
            ));
        }
        Ok(Value::Array(
            entries
                .iter()
                .filter(|item| {
                    item["type"] == "file"
                        && item["name"]
                            .as_str()
                            .is_some_and(|n| n.ends_with(".story.json") || n.ends_with(".xuxian-save.json") || n.ends_with(".xuxian-save.meta.json"))
                })
                .map(|item| json!({"name":item["name"],"path":item["path"],"size":item["size"],"sha":item["sha"]}))
                .collect(),
        ))
    }
}

fn git_blob_sha(bytes: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let mut digest = Sha1::new();
    digest.update(format!("blob {}\0", bytes.len()));
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

#[cfg(test)]
mod tests;
