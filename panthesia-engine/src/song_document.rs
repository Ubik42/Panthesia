//! Consistent song/state snapshots are built on the caller thread, independently of queued CPU jobs.
use crate::*;
use panthesia_core::utils::atomic_file;
impl Engine {
    /// Conversion callers need an identity and path, without serializing the song's notes.
    pub fn current_source_path(&self, content_id: &str) -> Result<PathBuf, String> {
        self.source_path_snapshot(content_id)?
            .ok_or_else(|| "当前曲目没有本地 MIDI 文件".into())
    }
    pub fn check_current_content_id(&self, content_id: &str) -> Result<(), String> {
        self.source_path_snapshot(content_id).map(|_| ())
    }
    fn source_path_snapshot(&self, content_id: &str) -> Result<Option<PathBuf>, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::CurrentSource {
                content_id: content_id.into(),
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        receiver.recv().map_err(|_| "曲目来源通道已关闭")?
    }
    pub(super) fn song_document(&self, session: bool) -> Result<serde_json::Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::DocumentContext(reply))
            .map_err(|_| "音乐引擎已关闭")?;
        let (context, state, undo) = receiver.recv().map_err(|_| "曲目快照通道已关闭")??;
        let data = self.data.clone();
        // Generated annotation caches remain virtual during this read-only request.
        atomic_file::capture_readonly(
            Arc::new(move |path: &std::path::Path| asset_storage::captures(&data, path)),
            || {
                let mut reader = context.into_player(false)?;
                let mut song = reader.command(Command::CurrentSong)?;
                if !song.is_null() {
                    song["engineId"] =
                        serde_json::json!(state.state_order.as_ref().map(|order| &order.engine_id));
                    song["fingerUndoAvailable"] = serde_json::json!(undo);
                }
                if session {
                    Ok(serde_json::json!({"song":song,"state":state}))
                } else {
                    Ok(song)
                }
            },
        )
    }
}
