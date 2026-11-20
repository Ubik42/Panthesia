//! Independent, bounded read-only score sessions. No player or persistence is involved.
use panthesia_core::source_score_window::{ASSET_LIMIT, SourceDocument};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
const CHUNK: usize = 524_288;
const TOTAL: usize = 128 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(600);
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Request {
    Begin {
        id: String,
        size: usize,
    },
    Append {
        id: String,
        offset: usize,
        bytes: Vec<u8>,
    },
    Prepare {
        id: String,
    },
    Window {
        id: String,
        first: usize,
    },
    Touch {
        id: String,
    },
    Release {
        id: String,
    },
}
enum Content {
    Upload(Vec<u8>),
    Preparing,
    Ready(Arc<SourceDocument>),
}
struct Entry {
    size: usize,
    content: Content,
    cancel: Arc<AtomicBool>,
    touched: Instant,
}
#[derive(Clone, Default)]
pub(crate) struct Store(Arc<Mutex<HashMap<String, Entry>>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Scope {
    first: usize,
    count: usize,
    total: usize,
    previous: Option<usize>,
    next: Option<usize>,
    first_number: String,
    last_number: String,
}
fn check(cancel: &AtomicBool, closing: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) || closing.load(Ordering::Acquire) {
        Err("谱面阅读已关闭".into())
    } else {
        Ok(())
    }
}
fn window(
    id: &str,
    document: &SourceDocument,
    first: usize,
    cancel: &AtomicBool,
    closing: &AtomicBool,
) -> Result<serde_json::Value, String> {
    if first >= document.total() {
        return Err("原谱小节范围无效".into());
    }
    let range = document.range_at(first);
    let prepared = document.window(range, &|| check(cancel, closing))?;
    let scope = Scope {
        first: range.first,
        count: range.count,
        total: document.total(),
        previous: document.previous(range.first),
        next: (range.first + range.count < document.total()).then_some(range.first + range.count),
        first_number: document.measure_number(range.first),
        last_number: document.measure_number(range.first + range.count - 1),
    };
    check(cancel, closing)?;
    Ok(serde_json::json!({"readerId":id,"range":scope,"bytes":prepared.bytes,"compressed":false}))
}
impl Store {
    pub(crate) fn request(
        &self,
        request: Request,
        closing: &AtomicBool,
    ) -> Result<serde_json::Value, String> {
        let id = match &request {
            Request::Begin { id, .. }
            | Request::Append { id, .. }
            | Request::Prepare { id }
            | Request::Window { id, .. }
            | Request::Touch { id }
            | Request::Release { id } => id,
        };
        if id.len() < 16
            || id.len() > 96
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("谱面阅读身份无效".into());
        }
        if closing.load(Ordering::Acquire) && !matches!(&request, Request::Release { .. }) {
            return Err("正在关闭谱面阅读".into());
        }
        let mut all = self.0.lock().map_err(|_| "谱面阅读状态不可用")?;
        all.retain(|_, entry| {
            let alive = entry.touched.elapsed() < TTL;
            if !alive {
                entry.cancel.store(true, Ordering::Release);
            }
            alive
        });
        match request {
            Request::Release { id } => {
                if let Some(entry) = all.remove(&id) {
                    entry.cancel.store(true, Ordering::Release);
                }
                Ok(serde_json::json!({"ok":true}))
            }
            Request::Begin { id, size } => {
                if size == 0 || size > ASSET_LIMIT {
                    return Err("原谱文件为空或超过 64 MiB".into());
                }
                if all.contains_key(&id) {
                    return Err("这次谱面阅读已经开始".into());
                }
                if all.len() >= 4
                    || all
                        .values()
                        .map(|entry| entry.size)
                        .sum::<usize>()
                        .saturating_add(size)
                        > TOTAL
                {
                    return Err("当前打开的谱面较多，请先关闭一个查看窗口".into());
                }
                all.insert(
                    id,
                    Entry {
                        size,
                        content: Content::Upload(Vec::new()),
                        cancel: Arc::new(AtomicBool::new(false)),
                        touched: Instant::now(),
                    },
                );
                Ok(serde_json::json!({"ok":true,"received":0}))
            }
            Request::Append { id, offset, bytes } => {
                let entry = all.get_mut(&id).ok_or("谱面阅读已关闭")?;
                entry.touched = Instant::now();
                check(&entry.cancel, closing)?;
                let Content::Upload(buffer) = &mut entry.content else {
                    return Err("这份谱面已开始整理，请重新读取后更换文件".into());
                };
                if bytes.is_empty()
                    || bytes.len() > CHUNK
                    || offset != buffer.len()
                    || buffer.len().saturating_add(bytes.len()) > entry.size
                {
                    return Err("谱面分块位置或大小不一致".into());
                }
                buffer.extend(bytes);
                Ok(serde_json::json!({"ok":true,"received":buffer.len()}))
            }
            Request::Touch { id } => {
                let entry = all.get_mut(&id).ok_or("谱面阅读已关闭")?;
                entry.touched = Instant::now();
                Ok(serde_json::json!({"ok":true}))
            }
            Request::Prepare { id } => {
                let entry = all.get_mut(&id).ok_or("谱面阅读已关闭")?;
                entry.touched = Instant::now();
                let Content::Upload(buffer) = &mut entry.content else {
                    return Err("谱面已经开始整理".into());
                };
                if buffer.len() != entry.size {
                    return Err("谱面文件尚未完整读取".into());
                }
                let bytes = std::mem::take(buffer);
                let cancel = entry.cancel.clone();
                entry.content = Content::Preparing;
                drop(all);
                let prepared = SourceDocument::new(&bytes, &|| check(&cancel, closing));
                drop(bytes);
                let mut all = self.0.lock().map_err(|_| "谱面阅读状态不可用")?;
                let current = all
                    .get(&id)
                    .is_some_and(|entry| Arc::ptr_eq(&entry.cancel, &cancel));
                if !current || check(&cancel, closing).is_err() {
                    return Err("谱面阅读已关闭".into());
                }
                let document = match prepared {
                    Ok(doc) => Arc::new(doc),
                    Err(error) => {
                        all.remove(&id);
                        return Err(error);
                    }
                };
                let entry = all.get_mut(&id).unwrap();
                entry.content = Content::Ready(document.clone());
                entry.touched = Instant::now();
                drop(all);
                window(&id, &document, 0, &cancel, closing)
            }
            Request::Window { id, first } => {
                let entry = all.get_mut(&id).ok_or("谱面阅读已关闭")?;
                entry.touched = Instant::now();
                let Content::Ready(document) = &entry.content else {
                    return Err("谱面正在整理".into());
                };
                let document = document.clone();
                let cancel = entry.cancel.clone();
                drop(all);
                window(&id, &document, first, &cancel, closing)
            }
        }
    }
}
impl crate::Engine {
    pub fn read_notation(&self, request: Request) -> Result<serde_json::Value, String> {
        self.notation_readers.request(request, &self.closing)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reader_chunks_cancel_and_release_are_independent() {
        let store=Store::default(); let closing=AtomicBool::new(false);
        let xml=b"<score-partwise version=\"4.0\"><part-list><score-part id=\"P1\"><part-name>Piano</part-name></score-part></part-list><part id=\"P1\"><measure number=\"9\"><attributes><divisions>1</divisions></attributes><note><rest/><duration>4</duration></note></measure></part></score-partwise>";
        let id="reader-contract-0001".to_owned();
        store.request(Request::Begin{id:id.clone(),size:xml.len()},&closing).unwrap();
        assert!(store.request(Request::Append{id:id.clone(),offset:1,bytes:xml.to_vec()},&closing).is_err());
        store.request(Request::Append{id:id.clone(),offset:0,bytes:xml.to_vec()},&closing).unwrap();
        let prepared=store.request(Request::Prepare{id:id.clone()},&closing).unwrap();
        assert_eq!(prepared["range"]["firstNumber"],"9");
        assert_eq!(prepared["range"]["total"],1);
        assert!(store.request(Request::Window{id:id.clone(),first:1},&closing).is_err());
        store.request(Request::Release{id:id.clone()},&closing).unwrap();
        assert!(store.0.lock().unwrap().is_empty());
        assert!(store.request(Request::Window{id:id.clone(),first:0},&closing).is_err());
        for n in 0..4 {store.request(Request::Begin{id:format!("reader-contract-{n}"),size:1},&closing).unwrap();}
        assert!(store.request(Request::Begin{id:"reader-contract-over".into(),size:1},&closing).is_err());
        closing.store(true,Ordering::Release);
        store.request(Request::Release{id:"reader-contract-0".into()},&closing).unwrap();
        assert_eq!(store.0.lock().unwrap().len(),3);
    }
}
