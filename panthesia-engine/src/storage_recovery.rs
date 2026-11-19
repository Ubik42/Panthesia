//! Storage workers inspect recovery files; playback reads one atomic observation.
use serde::Serialize;
use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

const CHECKED: u64 = 1;
const IMPORT: u64 = 2;
const ROUND: u64 = 4;
const SETTINGS: u64 = 8;
const ASSETS: u64 = 16;
const READ_ERROR: u64 = 32;

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRecovery {
    pub checked: bool,
    pub backup_import: bool,
    pub round: bool,
    pub settings: bool,
    pub assets: bool,
    pub read_error: bool,
}
pub type Status = StorageRecovery;
impl StorageRecovery {
    pub fn required(self) -> bool {
        self.backup_import || self.round || self.settings || self.assets
    }
    pub fn blocked(self) -> bool {
        !self.checked || self.read_error || self.required()
    }
    pub fn hard(self) -> bool {
        !self.checked || self.read_error || self.backup_import || self.round || self.assets
    }
    pub(super) fn read(data: &Path) -> Self {
        Self::inspect(data).0
    }
    fn inspect(data: &Path) -> (Self, Option<String>) {
        let mut errors = Vec::new();
        let mut pending = |label: &str, result: std::io::Result<bool>| match result {
            Ok(pending) => pending,
            Err(error) => {
                errors.push(format!("{label}：{error}"));
                false
            }
        };
        let backup_import = pending(
            "练习资料导入",
            data.join("practice-import-journal.json").try_exists(),
        );
        let round = pending("本轮成绩", crate::round_storage::pending_checked(data));
        let settings = pending("练习设置", crate::settings_storage::pending_checked(data));
        let assets = pending("曲目与谱面", crate::asset_storage::pending_checked(data));
        let read_error = !errors.is_empty();
        let detail = read_error.then(|| {
            format!(
                "资料恢复记录读取失败：{}。现有资料未被重置，请检查资料位置是否可访问。",
                errors.join("；")
            )
        });
        (
            Self {
                checked: true,
                backup_import,
                round,
                settings,
                assets,
                read_error,
            },
            detail,
        )
    }
    fn bits(self) -> u64 {
        u64::from(self.checked) * CHECKED
            | u64::from(self.backup_import) * IMPORT
            | u64::from(self.round) * ROUND
            | u64::from(self.settings) * SETTINGS
            | u64::from(self.assets) * ASSETS
            | u64::from(self.read_error) * READ_ERROR
    }
    fn from_bits(bits: u64) -> Self {
        Self {
            checked: bits & CHECKED != 0,
            backup_import: bits & IMPORT != 0,
            round: bits & ROUND != 0,
            settings: bits & SETTINGS != 0,
            assets: bits & ASSETS != 0,
            read_error: bits & READ_ERROR != 0,
        }
    }
    pub fn message(self) -> Option<&'static str> {
        if !self.checked {
            None
        } else if self.read_error {
            Some(
                "资料恢复记录暂时无法读取，已暂停修改。请检查资料位置是否可访问后重新启动，现有资料未被重置。",
            )
        } else if self.backup_import {
            Some("练习资料导入尚待恢复。请保留现有文件与恢复资料，重新启动后接续处理。")
        } else if self.round {
            Some("本轮成绩保存尚待恢复。请保留现有文件与恢复资料，重新启动后接续处理。")
        } else if self.assets {
            Some("曲目或谱面保存尚待恢复。请保留现有文件与恢复资料，重新启动后接续处理。")
        } else if self.settings {
            Some("练习设置保存尚待恢复，请重试原保存；没有可重试任务时请重新启动。")
        } else {
            None
        }
    }
}
#[derive(Default)]
struct State {
    sequence: AtomicU64,
    observation: AtomicU64,
    diagnostic: Mutex<Diagnostic>,
}
#[derive(Default)]
struct Diagnostic {
    sequence: u64,
    detail: Option<String>,
}
#[derive(Clone, Default)]
pub(crate) struct Monitor(Arc<State>);
impl Monitor {
    pub fn status(&self) -> Status {
        Status::from_bits(self.0.observation.load(Ordering::Acquire))
    }
    pub fn diagnostic(&self) -> Option<String> {
        let observation = self.0.observation.load(Ordering::Acquire);
        if observation & READ_ERROR == 0 {
            return None;
        }
        let diagnostic = self.0.diagnostic.lock().ok()?;
        (diagnostic.sequence == observation >> 8)
            .then(|| diagnostic.detail.clone())
            .flatten()
    }
    /// Call on workers before acknowledging a completed or abandoned storage operation.
    pub fn observe(&self, data: &Path) -> Status {
        let sequence = self.0.sequence.fetch_add(1, Ordering::AcqRel) + 1;
        let (status, detail) = Status::inspect(data);
        let packed = (sequence << 8) | status.bits();
        // A slow older scan cannot replace a newer observation.
        let updated = self
            .0
            .observation
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |old| {
                ((old >> 8) <= sequence).then_some(packed)
            });
        if updated.is_ok() {
            // No filesystem work runs while holding this small diagnostic lock.
            if let Ok(mut diagnostic) = self.0.diagnostic.lock() {
                if sequence >= diagnostic.sequence {
                    *diagnostic = Diagnostic { sequence, detail };
                }
            }
        }
        self.status()
    }
}
