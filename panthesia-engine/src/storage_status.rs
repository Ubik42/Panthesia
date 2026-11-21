//! Save state shown to the interface. Files are written directly and atomically by whoever
//! changes them, so the interface only sees the operation in progress and the last error.
use serde::Serialize;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub operation: Option<StorageOperation>,
    /// An exclusive operation or closing is in progress; edits wait for it.
    pub pending: bool,
    pub error: Option<String>,
}
pub type Status = StorageStatus;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageOperation {
    Recording,
    Asset,
    Song,
    Practice,
    Closing,
    Other,
}
impl StorageOperation {
    pub(super) fn current(id: Option<&str>, closing: bool) -> Option<Self> {
        if closing {
            return Some(Self::Closing);
        }
        id.map(|id| {
            if id.starts_with("recording-") {
                Self::Recording
            } else if id.starts_with("practice-edit-") {
                Self::Practice
            } else if id.starts_with("asset-edit-") {
                Self::Asset
            } else if id.starts_with("song-switch-") {
                Self::Song
            } else {
                Self::Other
            }
        })
    }
}
