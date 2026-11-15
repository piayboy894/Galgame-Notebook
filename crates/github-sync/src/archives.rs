//! Explicit, global save slots. Reading a list never chooses or performs an upload/download.
use super::*;
use xuxian_story_store::{validate_library_entries, LibraryProject, MAX_LIBRARY_BYTES};
const SUFFIX: &str = ".xuxian-save.json";
fn archive_name(name: &str) -> bool {
    name.strip_prefix("library-")
        .and_then(|v| v.strip_suffix(SUFFIX))
        .is_some_and(|v| v.len() == 32 && v.bytes().all(|c| c.is_ascii_hexdigit()))
}
fn archive_path(connection: &Connection, name: &str) -> Result<String> {
    if !archive_name(name) {
        return Err(Error::new(400, "云存档标识无效"));
    }
    Ok(format!("{}/{name}", connection.directory))
}
fn metadata_name(name: &str) -> String {
    name.trim_end_matches(".json").to_owned() + ".meta.json"
}
fn summary(value: &Value) -> Result<Value> {
    let entries: Vec<LibraryProject> = serde_json::from_value(value["projects"].clone())
        .map_err(|_| Error::new(400, "不是完整的项目库存档"))?;
    if value["format"] != "xuxian.library-save" || value["version"] != 1 {
        return Err(Error::new(400, "云存档格式不受支持"));
    }
    if !value["name"]
        .as_str()
        .is_some_and(|name| !name.trim().is_empty() && name.len() <= 160)
        || !value["note"]
            .as_str()
            .is_some_and(|note| note.len() <= 4000)
        || !(value["savedAt"].is_null() || value["savedAt"].is_u64())
    {
        return Err(Error::new(400, "云存档信息无效"));
    }
    validate_library_entries(&entries)?;
    Ok(
        json!({"name":value["name"],"note":value["note"],"savedAt":value["savedAt"],"projectCount":entries.len(),"projects":entries.iter().map(|item|json!({"fileName":item.file_name,"title":item.project["title"]})).collect::<Vec<_>>()}),
    )
}
impl Engine {
    fn archive_connection(&self, id: &str) -> Result<(&Connection, Box<dyn Remote>)> {
        let connection = self
            .settings
            .connections
            .get(id)
            .ok_or_else(|| Error::new(400, "请先配置全局云存档连接"))?;
        connection.validate()?;
        if connection.key() != id {
            return Err(Error::new(400, "云存档连接标识不匹配，请重新配置"));
        }
        let client = self.client(id)?;
        require_private(client.repository(connection)?)?;
        Ok((connection, client))
    }
    pub fn archive_list(&self, id: &str) -> Result<Value> {
        let (connection, client) = self.archive_connection(id)?;
        let files = client.list(connection)?;
        let mut slots = Vec::new();
        for file in files
            .as_array()
            .ok_or_else(|| Error::new(502, "云端目录无效"))?
        {
            let name = file["name"].as_str().unwrap_or("");
            if !archive_name(name) {
                continue;
            }
            let mut item =
                json!({"fileName":name,"sha":file["sha"],"name":"未命名存档","projectCount":null});
            match client.file(
                connection,
                &format!("{}/{}", connection.directory, metadata_name(name)),
            ) {
                Ok(Some(metadata)) => {
                    if let Ok(value) = serde_json::from_str::<Value>(&metadata.text) {
                        if value["format"] == "xuxian.library-slot"
                            && value["version"] == 1
                            && value["dataSha"] == file["sha"]
                            && value["name"].as_str().is_some_and(|v| v.len() <= 160)
                            && value["note"].as_str().is_some_and(|v| v.len() <= 4000)
                            && value["projectCount"].as_u64().is_some_and(|v| v <= 5000)
                        {
                            for key in ["name", "note", "savedAt", "projectCount"] {
                                item[key] = value[key].clone();
                            }
                        } else {
                            item["warning"] = json!("索引需要核对，请先预览存档");
                        }
                    } else {
                        item["warning"] = json!("索引格式无效，请先预览存档");
                    }
                }
                Ok(None) => item["warning"] = json!("缺少索引，请先预览存档"),
                Err(error) => return Err(error),
            }
            slots.push(item);
        }
        slots.sort_by_key(|value| std::cmp::Reverse(value["savedAt"].as_u64()));
        Ok(json!({"slots":slots}))
    }
    fn archive_document(&self, id: &str, name: &str) -> Result<(Value, String)> {
        let (connection, client) = self.archive_connection(id)?;
        let file = client
            .file(connection, &archive_path(connection, name)?)?
            .ok_or_else(|| Error::new(404, "云存档已删除，请刷新列表"))?;
        if file.text.len() > MAX_LIBRARY_BYTES {
            return Err(Error::new(413, "整个项目库存档超过 50 MB"));
        }
        let value: Value = serde_json::from_str(&file.text)?;
        summary(&value)?;
        Ok((value, file.sha))
    }
    pub fn archive_preview(&self, id: &str, name: &str) -> Result<Value> {
        let (document, sha) = self.archive_document(id, name)?;
        let mut result = summary(&document)?;
        result["sha"] = json!(sha);
        result["fileName"] = json!(name);
        Ok(result)
    }
    pub fn archive_save(
        &self,
        store: &Store,
        id: &str,
        file_name: &str,
        expected: &str,
        name: &str,
        note: &str,
    ) -> Result<Value> {
        let name = name.trim();
        if name.is_empty() || name.len() > 160 || note.len() > 4000 {
            return Err(Error::new(
                400,
                "请填写存档名称（不超过 160 字节），备注不超过 4000 字节",
            ));
        }
        let filename = if file_name.is_empty() {
            format!("library-{}{SUFFIX}", Uuid::new_v4().simple())
        } else {
            file_name.into()
        };
        if !file_name.is_empty() && expected.is_empty() {
            return Err(Error::new(409, "覆盖前请先预览目标云存档"));
        }
        let (connection, client) = self.archive_connection(id)?;
        let projects = store.capture_library()?;
        let count = projects.len();
        let saved_at = now();
        let document = json!({"format":"xuxian.library-save","version":1,"name":name,"note":note,"savedAt":saved_at,"projects":projects});
        let text = serde_json::to_string(&document)?;
        if text.len() > MAX_LIBRARY_BYTES {
            return Err(Error::new(413, "整个项目库存档超过 50 MB"));
        }
        let metadata = json!({"format":"xuxian.library-slot","version":1,"name":name,"note":note,"savedAt":saved_at,"projectCount":count});
        client.write_archive(
            connection,
            &archive_path(connection, &filename)?,
            Some(&text),
            Some(metadata),
            if expected.is_empty() {
                None
            } else {
                Some(expected)
            },
        )?;
        Ok(json!({"fileName":filename,"projectCount":count,"name":name,"savedAt":saved_at}))
    }
    pub fn archive_load(
        &self,
        store: &mut Store,
        id: &str,
        name: &str,
        expected: &str,
    ) -> Result<Value> {
        let (document, sha) = self.archive_document(id, name)?;
        if expected.is_empty() || sha != expected {
            return Err(Error::new(409, "云存档在预览后发生变化，请刷新后再读档"));
        }
        let entries: Vec<LibraryProject> = serde_json::from_value(document["projects"].clone())?;
        store.restore_library(&entries)
    }
    pub fn archive_delete(&self, id: &str, name: &str, expected: &str) -> Result<Value> {
        if expected.is_empty() {
            return Err(Error::new(409, "删除前请先预览云存档"));
        }
        let (connection, client) = self.archive_connection(id)?;
        client.write_archive(
            connection,
            &archive_path(connection, name)?,
            None,
            None,
            Some(expected),
        )?;
        Ok(json!({"deleted":true}))
    }
}
