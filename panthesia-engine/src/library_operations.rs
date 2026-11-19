//! Open the requested location, score and loop as one prepared song replacement.
use crate::{
    Engine, Player,
    background_tasks::TaskToken,
    operation_journal::{Operation, PreparationOrigin, PreparationPhase},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryScoreKind {
    Notation,
    Paper,
}
impl LibraryScoreKind {
    fn name(self) -> &'static str {
        match self {
            Self::Notation => "notation",
            Self::Paper => "paper",
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryRangeMode {
    Loop,
    Range,
}
#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryRouteVisit {
    pub ordinal: u32,
    pub measure: usize,
    pub start: f64,
    pub end: f64,
}
#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryScoreSelection {
    pub first: LibraryRouteVisit,
    pub last: LibraryRouteVisit,
    pub mode: LibraryRangeMode,
    pub fingerprint: String,
}
#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum LibraryOpenSource {
    OriginalScore {
        path: String,
        #[serde(rename = "defaultBpm")]
        default_bpm: u16,
    },
    File {
        path: String,
        title: String,
        #[serde(rename = "contentId")]
        content_id: Option<String>,
    },
    Recent {
        #[serde(rename = "contentId")]
        content_id: String,
    },
    Relocated {
        path: String,
        title: String,
        #[serde(rename = "contentId")]
        content_id: String,
        // Omitting an absent origin preserves hashes of previously retained open requests.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
    },
    Recording {
        path: String,
    },
    Score {
        path: String,
        #[serde(rename = "contentId")]
        content_id: String,
        #[serde(rename = "scoreKind")]
        score_kind: LibraryScoreKind,
        id: String,
        selection: Option<LibraryScoreSelection>,
    },
}
#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryOpenRequest {
    pub engine_id: String,
    pub id: String,
    pub created_at_ms: u64,
    pub origin: PreparationOrigin,
    pub source: LibraryOpenSource,
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryOpenView {
    Practice,
    Notation,
    Paper,
    Range,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPrepared {
    pub source: LibraryOpenSource,
    pub content_id: String,
    pub score_revision: u64,
    pub source_path: Option<String>,
    pub view: LibraryOpenView,
    #[serde(default)]
    pub import_warnings: Vec<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryOpenResult {
    pub library_prepared: LibraryPrepared,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryOpenReceipt {
    pub request: LibraryOpenRequest,
    pub phase: PreparationPhase,
    pub stage: String,
    pub task_id: Option<String>,
    pub result: Option<LibraryOpenResult>,
    pub has_result: bool,
    pub error: Option<String>,
    pub warning: Option<String>,
    pub cancellable: bool,
}
pub(crate) type Store = crate::operation_journal::Store<LibraryOpenRequest>;
crate::operation_journal::receipt_wire!(LibraryOpenRequest, LibraryOpenReceipt);
impl LibraryOpenSource {
    fn validate(&self) -> Result<(), String> {
        let identity = |value: &str| {
            !value.is_empty() && value.len() <= 160 && !value.chars().any(char::is_control)
        };
        let path = |value: &str| {
            !value.is_empty() && value.len() <= 32768 && !value.chars().any(char::is_control)
        };
        let valid = match self {
            Self::OriginalScore {
                path: value,
                default_bpm,
            } => {
                path(value)
                    && (20..=400).contains(default_bpm)
                    && std::path::Path::new(value)
                        .extension()
                        .is_some_and(|extension| {
                            extension.eq_ignore_ascii_case("xml")
                                || extension.eq_ignore_ascii_case("musicxml")
                                || extension.eq_ignore_ascii_case("mxl")
                        })
            }
            Self::File {
                path: value,
                title,
                content_id,
            } => path(value) && title.len() <= 4096 && content_id.as_deref().is_none_or(identity),
            Self::Recent { content_id } => identity(content_id),
            Self::Relocated {
                path: value,
                title,
                content_id,
                from,
            } => {
                path(value)
                    && title.len() <= 4096
                    && identity(content_id)
                    && from.as_deref().is_none_or(path)
                    && std::path::Path::new(value)
                        .extension()
                        .is_some_and(|extension| {
                            extension.eq_ignore_ascii_case("mid")
                                || extension.eq_ignore_ascii_case("midi")
                        })
            }
            Self::Recording { path: value } => path(value),
            Self::Score {
                path: value,
                content_id,
                id,
                score_kind,
                selection,
            } => {
                path(value)
                    && identity(content_id)
                    && identity(id)
                    && selection.as_ref().is_none_or(|selection| {
                        let visit = |value: &LibraryRouteVisit| {
                            value.ordinal < 20000
                                && value.measure < 20000
                                && value.start.is_finite()
                                && value.end.is_finite()
                                && value.start >= 0.
                                && value.end > value.start
                        };
                        *score_kind == LibraryScoreKind::Notation
                            && visit(&selection.first)
                            && visit(&selection.last)
                            && selection.first.ordinal <= selection.last.ordinal
                            && selection.fingerprint.len() == 64
                            && selection
                                .fingerprint
                                .bytes()
                                .all(|byte| byte.is_ascii_hexdigit())
                    })
            }
        };
        if !valid {
            return Err("打开曲目的来源或小节位置无效，请重新读取曲库。".into());
        }
        Ok(())
    }
    fn expected_content(&self) -> Option<&str> {
        match self {
            Self::File { content_id, .. } => content_id.as_deref(),
            Self::Recent { content_id }
            | Self::Relocated { content_id, .. }
            | Self::Score { content_id, .. } => Some(content_id),
            Self::Recording { .. } | Self::OriginalScore { .. } => None,
        }
    }
}
impl Operation for LibraryOpenRequest {
    type Output = LibraryOpenResult;
    const FOLDER: &'static str = "library-open-results";
    fn id(&self) -> &str {
        &self.id
    }
    fn engine_id(&self) -> &str {
        &self.engine_id
    }
    fn created_at_ms(&self) -> u64 {
        self.created_at_ms
    }
    fn validate(&self) -> Result<(), String> {
        self.source.validate()
    }
    fn label(&self) -> &'static str {
        match self.source {
            LibraryOpenSource::Score { .. } => "打开曲库谱面与小节",
            _ => "打开曲库曲目",
        }
    }
    fn run(self, engine: &Engine, token: TaskToken) -> Result<Self::Output, String> {
        token.check()?;
        let (reply, receive) = std::sync::mpsc::sync_channel(1);
        engine
            .tx
            .send(crate::runtime_request::Request::PreparationContext {
                current: self.origin,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let origin = receive.recv().map_err(|_| "曲目打开准备通道已关闭")??;
        serde_json::from_value(engine.commit_song_switch(
            origin,
            crate::song_switch::Input::LibraryOpen(self.source),
            token,
        )?)
        .map_err(|_| "曲目已经处理，打开结果尚未确认，请先核对当前练习".into())
    }
}
impl Engine {
    pub(crate) fn start_library_open(
        &self,
        request: LibraryOpenRequest,
    ) -> Result<LibraryOpenReceipt, String> {
        self.library_opens.start(self, request).map(Into::into)
    }
    pub(crate) fn read_library_open(
        &self,
        id: &str,
        metadata_only: bool,
    ) -> Result<Option<LibraryOpenReceipt>, String> {
        self.library_opens
            .read(self, id, metadata_only)
            .map(|value| value.map(Into::into))
    }
    pub(crate) fn cancel_library_open(
        &self,
        id: &str,
    ) -> Result<Option<LibraryOpenReceipt>, String> {
        self.library_opens
            .cancel(self, id)
            .map(|value| value.map(Into::into))
    }
    pub(crate) fn release_library_open(
        &self,
        id: &str,
    ) -> Result<Option<LibraryOpenReceipt>, String> {
        self.library_opens
            .release(self, id)
            .map(|value| value.map(Into::into))
    }
}
impl Player {
    pub(crate) fn apply_library_open(
        &mut self,
        source: LibraryOpenSource,
        token: &TaskToken,
    ) -> Result<Value, String> {
        source.validate()?;
        token.check()?;
        let expected = source.expected_content().map(str::to_owned);
        let view = match &source {
            LibraryOpenSource::Score {
                score_kind: LibraryScoreKind::Paper,
                ..
            } => LibraryOpenView::Paper,
            LibraryOpenSource::Score {
                selection: Some(selection),
                ..
            } if selection.mode == LibraryRangeMode::Range => LibraryOpenView::Range,
            LibraryOpenSource::Score { .. } => LibraryOpenView::Notation,
            _ => LibraryOpenView::Practice,
        };
        let mut import_warnings = Vec::new();
        match &source {
            LibraryOpenSource::OriginalScore { path, default_bpm } => {
                let result = crate::song_switch::Input::CompactImport(
                    crate::import_pipeline::Input::Original {
                        path: path.into(),
                        bpm: *default_bpm,
                    },
                )
                .apply(self, token)?;
                import_warnings = result["importWarnings"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .collect();
            }
            LibraryOpenSource::Relocated {
                path,
                title,
                content_id,
                from,
            } => {
                let absolute = std::path::absolute(path).map_err(|error| error.to_string())?;
                let destination = absolute.as_path();
                let watch = crate::load_pipeline::Watch::capture(destination)?;
                let file = crate::library::read_midi(destination)?;
                if file.content_id != *content_id {
                    return Err("所选文件与原曲目内容不同，请重新定位同一份 MIDI。".into());
                }
                token.check()?;
                let original = from.as_ref().map(std::path::PathBuf::from).or_else(|| {
                    self.history.song(content_id).and_then(|record| {
                        record.library.source_path.clone().or_else(|| {
                            record
                                .setup
                                .as_ref()
                                .and_then(|setup| setup.source_path.clone())
                        })
                    })
                });
                let original = match original {
                    Some(path) => Some(path),
                    None => crate::library_workspace::Workspace::load(&self.data)?
                        .entries
                        .values()
                        .find(|entry| entry.content_id.as_deref() == Some(content_id.as_str()))
                        .map(|entry| entry.path.clone()),
                };
                if let Some(original) = original.filter(|original| original != destination) {
                    if let Some(detail) = crate::library::recover_annotations_report(
                        &original, destination, content_id,
                    )? {
                        import_warnings.push(detail);
                    }
                }
                token.check()?;
                let versions = self
                    .preferences
                    .score_versions
                    .get(content_id)
                    .cloned()
                    .unwrap_or_default();
                let prepared = crate::load_pipeline::Prepared::from_verified_checked(
                    file,
                    title.clone(),
                    watch,
                    |_| Ok(versions),
                    &|| token.check(),
                )?;
                crate::song_switch::Input::install_prepared_file(self, prepared, token)?;
            }
            LibraryOpenSource::File {
                path,
                title,
                content_id,
            } => {
                crate::song_switch::Input::File(crate::load_pipeline::Input::File {
                    path: path.into(),
                    title: title.clone(),
                    expected: content_id.clone(),
                })
                .apply_silent(self, token)?;
            }
            LibraryOpenSource::Recording { path } => {
                crate::song_switch::Input::Recording(path.into()).apply_silent(self, token)?;
            }
            LibraryOpenSource::Recent { content_id } => {
                let record = self
                    .history
                    .song(content_id)
                    .ok_or("原曲目记录暂时不在本机，请重新读取曲库")?;
                let input = if let Some(spec) =
                    record.setup.as_ref().and_then(|setup| setup.exercise_spec)
                {
                    crate::song_switch::Input::Exercise(spec)
                } else {
                    crate::song_switch::Input::File(crate::load_pipeline::Input::Recent {
                        content_id: content_id.clone(),
                        title: record.display_name.clone(),
                        paths: record
                            .setup
                            .as_ref()
                            .and_then(|setup| setup.source_path.clone())
                            .into_iter()
                            .chain(record.library.source_path.clone())
                            .collect(),
                    })
                };
                input.apply_silent(self, token)?;
            }
            LibraryOpenSource::Score {
                path,
                content_id,
                score_kind,
                id,
                selection,
            } => {
                crate::song_switch::Input::Library {
                    path: path.into(),
                    content_id: content_id.clone(),
                    kind: score_kind.name().into(),
                    id: id.clone(),
                }
                .apply_silent(self, token)?;
                token.check()?;
                if self.state.mode == "memory"
                    || selection.is_some() && crate::is_recital_mode(&self.state.mode)
                {
                    self.command(crate::Command::Mode {
                        value: "flow".into(),
                    })?;
                }
                if let Some(selection) = selection {
                    let score = self.notation.as_ref().ok_or("所选曲目尚未建立可定位乐谱")?;
                    if score.source_fingerprint != selection.fingerprint {
                        return Err("谱面版本已变化，请重新预览小节位置。".into());
                    }
                    let route = score.route_payload(self.file.as_deref());
                    let matches = |expected: &LibraryRouteVisit| {
                        route["route"]["visits"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .any(|actual| {
                                actual["ordinal"].as_u64() == Some(u64::from(expected.ordinal))
                                    && actual["measure"].as_u64() == Some(expected.measure as u64)
                                    && actual["start"].as_f64().is_some_and(|value| {
                                        (value - expected.start).abs() <= 0.001
                                    })
                                    && actual["end"]
                                        .as_f64()
                                        .is_some_and(|value| (value - expected.end).abs() <= 0.001)
                            })
                    };
                    if route["route"]["complete"] != true
                        || !matches(&selection.first)
                        || !matches(&selection.last)
                    {
                        return Err("曲目网格或演奏顺序已变化，请重新预览原谱小节。".into());
                    }
                    if selection.mode == LibraryRangeMode::Loop {
                        self.command(crate::Command::Loop {
                            start: selection.first.start,
                            end: selection.first.end,
                            enabled: true,
                        })?;
                    }
                }
            }
        }
        token.check()?;
        let file = self.file.as_ref().ok_or("打开结果缺少当前曲目")?;
        if expected
            .as_ref()
            .is_some_and(|expected| expected != &file.content_id)
        {
            return Err("打开结果与所选曲目不一致，请重新读取曲库。".into());
        }
        let prepared = LibraryPrepared {
            source,
            content_id: file.content_id.clone(),
            score_revision: self.score_revision,
            source_path: file
                .source_path
                .as_ref()
                .map(|path| path.to_string_lossy().into()),
            view,
            import_warnings,
        };
        Ok(serde_json::json!({"libraryPrepared":prepared}))
    }
}
