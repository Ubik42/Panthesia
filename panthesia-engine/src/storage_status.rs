//! Save state shown to the interface. Files are written directly and atomically by whoever
//! changes them, so the interface only sees the operation in progress and the last error.
use serde::Serialize;

/// Kept in the wire format for the interface; there is no recovery journal any more.
#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageRecovery {
    pub checked: bool,
    pub backup_import: bool,
    pub round: bool,
    pub settings: bool,
    pub assets: bool,
    pub read_error: bool,
}
impl Default for StorageRecovery {
    fn default() -> Self {
        Self { checked: true, backup_import: false, round: false, settings: false, assets: false, read_error: false }
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub version: String,
    pub operation: Option<StorageOperation>,
    pub pending: bool,
    pub writing: bool,
    pub unsaved_changes: bool,
    pub error: Option<String>,
    pub can_retry: bool,
    pub recovery: StorageRecovery,
    pub recovery_error: Option<String>,
}
pub type Status = StorageStatus;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageOperation {
    Round,
    Import,
    Recording,
    Asset,
    Library,
    Song,
    Practice,
    Closing,
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
                Self::Import
            }
        })
    }
}
