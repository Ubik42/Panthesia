//! Renderer MIDI decoding and note correlation never run on the playback thread.
use crate::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub content_id: String,
    #[serde(default)]
    pub score_revision: Option<u64>,
    #[serde(default)]
    pub source_fingerprint: Option<String>,
    pub midi: Vec<u8>,
    pub notes: Vec<notation::RenderNote>,
    #[serde(default)]
    pub practice_notation: bool,
}
pub(crate) struct Origin {
    content_id: String,
    revision: u64,
    fingerprint: String,
    epoch: u64,
}
pub(crate) struct Context {
    origin: Origin,
    file: SongFile,
    asset: Option<Arc<notation::ScoreAsset>>,
    transpose: i8,
    quantize: u8,
}
pub(crate) struct Installation {
    origin: Origin,
    located: Option<Arc<LocatedScoreMap>>,
}
impl Context {
    fn practice_mapping(
        &self,
        notes: Vec<notation::RenderNote>,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<notation::MappingResult, String> {
        if notes.len() > 100_000 {
            return Err("练习谱映射超过十万个音符".into());
        }
        let engraving =
            panthesia_core::practice_engraving::engrave(&self.file, "", 0, false, check)?;
        let tracks: HashMap<_, _> = self
            .file
            .tracks
            .iter()
            .map(|track| (track.track_id, track))
            .collect();
        let mut mapping = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut ambiguities = 0;
        for rendered in notes {
            check()?;
            let Some(source) = engraving.notes.get(&rendered.renderer_id) else {
                continue;
            };
            if !seen.insert(rendered.renderer_id.clone()) {
                ambiguities += 1;
                continue;
            }
            let Some(note) = tracks
                .get(&source.track)
                .and_then(|track| track.notes.get(source.index))
            else {
                continue;
            };
            if note.note != rendered.pitch || rendered.page_index >= 300 {
                seen.remove(&rendered.renderer_id);
                continue;
            }
            mapping.push(notation::MappingRow {
                id: rendered.renderer_id,
                page: rendered.page_index,
                start: self
                    .file
                    .tempo_track
                    .pulses_to_duration(source.start_tick)
                    .as_secs_f64(),
                end: self
                    .file
                    .tempo_track
                    .pulses_to_duration(source.end_tick)
                    .as_secs_f64(),
                pitch: note.note,
                track: source.track,
                index: source.index,
                score_finger: None,
            });
        }
        let unmapped = engraving.notes.len().saturating_sub(seen.len());
        let following = !mapping.is_empty() && ambiguities == 0 && unmapped == 0;
        Ok(notation::MappingResult {
            mapping,
            ambiguities,
            unmapped,
            following,
            mapping_token: None,
        })
    }
    fn prepare(
        self,
        mut input: Input,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<(Installation, serde_json::Value), String> {
        check()?;
        // The displayed score is transposed. Correlate against source semantics,
        // then use stable track/note identities to follow the effective MIDI timing.
        for note in &mut input.notes.iter_mut().filter(|_| !input.practice_notation) {
            note.pitch = (i16::from(note.pitch) - i16::from(self.transpose)).clamp(0, 127) as u8;
        }
        let mut result = if input.practice_notation {
            if self.quantize == 0 {
                return Err("量化条件已改变，请重新读取练习谱".into());
            }
            self.practice_mapping(input.notes, &check)?
        } else {
            self.asset
                .as_ref()
                .ok_or("当前没有所选原谱，请使用量化练习谱")?
                .map_notes_checked(&self.file, &input.midi, input.notes, &check)?
        };
        check()?;
        let mut trusted = HashMap::new();
        let mut conflicting = std::collections::HashSet::new();
        if result.following {
            for row in &result.mapping {
                check()?;
                if row.id.is_empty() {
                    continue;
                }
                let key = (row.track, row.index);
                let target = (row.id.clone(), row.page);
                if trusted
                    .get(&key)
                    .is_some_and(|previous| previous != &target)
                {
                    conflicting.insert(key);
                }
                trusted.insert(key, target);
            }
        }
        trusted.retain(|key, _| !conflicting.contains(key));
        let located = if trusted.is_empty() {
            None
        } else {
            let grid = practice_conditions::grid(&self.file);
            let rows = serde_json::to_string(&result.mapping).map_err(|error| error.to_string())?;
            let hash = blake3::hash(
                format!(
                    "located-score-map:{}:{}:{}:{}",
                    self.origin.fingerprint, self.origin.revision, grid, rows
                )
                .as_bytes(),
            )
            .to_hex()
            .to_string();
            result.mapping_token = Some(hash.clone());
            Some(Arc::new(LocatedScoreMap {
                content_id: self.origin.content_id.clone(),
                score_revision: self.origin.revision,
                source_fingerprint: self.origin.fingerprint.clone(),
                token: hash,
                grid,
                notes: trusted,
            }))
        };
        check()?;
        let value = serde_json::to_value(result).map_err(|error| error.to_string())?;
        Ok((
            Installation {
                origin: self.origin,
                located,
            },
            value,
        ))
    }
}
impl Player {
    pub(super) fn capture_score_mapping(
        &mut self,
        content_id: &str,
        revision: Option<u64>,
        fingerprint: Option<&str>,
    ) -> Result<Context, String> {
        let file = self.file.as_ref().ok_or("请先打开 MIDI")?;
        if self.notation.is_none() && self.variant().quantize == 0 {
            return Err("尚未配对乐谱或启用量化练习谱".into());
        }
        let display_origin = self.score_display_origin();
        if file.content_id != content_id
            || revision.is_some_and(|revision| revision != self.score_revision)
            || fingerprint.is_some_and(|fingerprint| fingerprint != display_origin)
        {
            return Err("曲目或谱面已切换，请重新加载乐谱".into());
        }
        self.score_mapping_epoch = self.score_mapping_epoch.wrapping_add(1);
        Ok(Context {
            origin: Origin {
                content_id: content_id.into(),
                revision: self.score_revision,
                fingerprint: display_origin,
                epoch: self.score_mapping_epoch,
            },
            file: file.clone(),
            asset: self.notation.clone(),
            transpose: self.variant().transpose,
            quantize: self.variant().quantize,
        })
    }
    pub(super) fn install_score_mapping(
        &mut self,
        prepared: Installation,
        token: &background_tasks::TaskToken,
    ) -> Result<(), String> {
        self.check_score_mapping(&prepared.origin)?;
        token.begin_commit()?;
        token.stage("mappingScore")?;
        self.located_score_map = prepared.located;
        Ok(())
    }
    fn check_score_mapping(&self, origin: &Origin) -> Result<(), String> {
        if self.score_mapping_epoch != origin.epoch
            || self.score_revision != origin.revision
            || self.file.as_ref().map(|file| &file.content_id) != Some(&origin.content_id)
            || self.score_display_origin() != origin.fingerprint
        {
            return Err("乐谱对应结果已过期，请重新加载当前谱面".into());
        }
        Ok(())
    }
    // Preserve existing direct owned-reader calls without maintaining a second mapping algorithm.
    pub(super) fn map_score_owned(&mut self, input: Input) -> Result<serde_json::Value, String> {
        let context = self.capture_score_mapping(
            &input.content_id,
            input.score_revision,
            input.source_fingerprint.as_deref(),
        )?;
        let (prepared, result) = context.prepare(input, || Ok(()))?;
        self.check_score_mapping(&prepared.origin)?;
        self.located_score_map = prepared.located;
        Ok(result)
    }
}
impl Engine {
    pub fn map_score(&self, input: Input) -> Result<serde_json::Value, String> {
        if input.midi.len() > 4_000_000 || input.notes.len() > 100_000 {
            return Err("乐谱映射数据过大".into());
        }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::ScoreMappingContext {
                content_id: input.content_id.clone(),
                revision: input.score_revision,
                fingerprint: input.source_fingerprint.clone(),
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "乐谱对应快照通道已关闭")??;
        let engine = self.clone();
        self.tasks.run_latest(
            format!("score-map:{}", context.origin.content_id),
            context.origin.epoch,
            "对应乐谱音符",
            Some(input.content_id.clone()),
            move |token| {
                token.stage("mappingScore")?;
                token.source(
                    context.origin.content_id.clone(),
                    context.origin.fingerprint.clone(),
                )?;
                let (prepared, result) = context.prepare(input, || token.check())?;
                token.check()?;
                let (reply, receiver) = mpsc::sync_channel(1);
                engine
                    .tx
                    .send(runtime_request::Request::ScoreMappingInstall {
                        prepared,
                        token,
                        reply,
                    })
                    .map_err(|_| "音乐引擎已关闭")?;
                receiver.recv().map_err(|_| "乐谱对应安装通道已关闭")??;
                Ok(result)
            },
        )
    }
}
