//! Renderer MIDI decoding and note correlation never run on the playback thread.
use crate::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub content_id: String,
    #[serde(default)]
    pub measure_range: Option<panthesia_core::practice_engraving::MeasureRange>,
    #[serde(default)]
    pub display_fingerprint: Option<String>,
    #[serde(default)]
    pub page_count: Option<usize>,
    #[serde(default)]
    pub score_revision: Option<u64>,
    #[serde(default)]
    pub source_fingerprint: Option<String>,
    pub midi: Vec<u8>,
    pub notes: Vec<notation::RenderNote>,
    #[serde(default)]
    pub practice_notation: bool,
}
impl Input {
    fn validate(&self) -> Result<(), String> {
        if self.measure_range.is_some()
            && (!self.practice_notation
                || self
                    .display_fingerprint
                    .as_ref()
                    .is_none_or(|s| s.len() != 64))
        {
            return Err("谱面范围缺少当前显示身份".into());
        }
        let count = self.page_count.unwrap_or(300);
        if count == 0 || self.notes.iter().any(|note| note.page_index >= count) {
            return Err("谱页范围与当前排版不同".into());
        }
        if self.midi.len() > 4_000_000 || self.notes.len() > 100_000 {
            return Err("乐谱映射数据过大".into());
        }
        Ok(())
    }
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
    title: String,
    fifths: i8,
    minor: bool,
    config: SongConfig,
    hands: HandAssignments,
}
pub(crate) struct Installation {
    origin: Origin,
    located: Option<Arc<LocatedScoreMap>>,
}
impl Context {
    fn practice_mapping(
        &self,
        notes: Vec<notation::RenderNote>,
        page_count: usize,
        range: Option<panthesia_core::practice_engraving::MeasureRange>,
        display_fingerprint: Option<&str>,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<notation::MappingResult, String> {
        if notes.len() > 100_000 {
            return Err("练习谱映射超过十万个音符".into());
        }
        let engraving = if let Some(range) = range {
            let staff = |track, index, pitch| match crate::hands::part(
                &self.config,
                &self.hands,
                track,
                index,
            ) {
                PracticePart::LeftHand => 2,
                PracticePart::RightHand => 1,
                _ => {
                    if pitch >= 60 {
                        1
                    } else {
                        2
                    }
                }
            };
            panthesia_core::practice_engraving::engrave_range(
                &self.file,
                &self.title,
                self.fifths,
                self.minor,
                self.quantize == 0,
                range,
                &staff,
                check,
            )
        } else if self.quantize == 0 {
            panthesia_core::practice_engraving::engrave_simplified(&self.file, "", 0, false, check)
        } else {
            panthesia_core::practice_engraving::engrave(&self.file, "", 0, false, check)
        }?;
        if range.is_some()
            && display_fingerprint != Some(blake3::hash(&engraving.bytes).to_hex().as_str())
        {
            return Err("练习谱范围或显示条件已改变，请重新读取".into());
        }
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
            if note.note != rendered.pitch || rendered.page_index >= page_count {
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
        let following =
            (range.is_some() || !mapping.is_empty()) && ambiguities == 0 && unmapped == 0;
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
        input.validate()?;
        check()?;
        // The displayed score is transposed. Correlate against source semantics,
        // then use stable track/note identities to follow the effective MIDI timing.
        for note in &mut input.notes.iter_mut().filter(|_| !input.practice_notation) {
            note.pitch = (i16::from(note.pitch) - i16::from(self.transpose)).clamp(0, 127) as u8;
        }
        let mut result = if input.practice_notation {
            if self.quantize == 0 && self.asset.is_some() {
                return Err("谱面条件已改变，请重新读取当前谱面".into());
            }
            self.practice_mapping(
                input.notes,
                input.page_count.unwrap_or(300),
                input.measure_range,
                input.display_fingerprint.as_deref(),
                &check,
            )?
        } else {
            self.asset
                .as_ref()
                .ok_or("当前没有所选原谱，请使用量化练习谱")?
                .map_notes_for_pages(
                    &self.file,
                    &input.midi,
                    input.notes,
                    input.page_count.unwrap_or(300),
                    &check,
                )?
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
                    "located-score-map:{}:{}:{}:{}:{:?}",
                    self.origin.fingerprint, self.origin.revision, grid, rows, input.measure_range
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
            title: self.title.clone(),
            fifths: self.practice_key().0,
            minor: self.practice_key().1,
            config: self.config.clone(),
            hands: self.note_hands.clone(),
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
        input.validate()?;
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

#[cfg(test)]
mod paged_tests {
    use super::*;
    #[test]
    fn practice_window_maps_only_current_display_and_rejects_changed_fingerprint() {
        let root = std::env::temp_dir().join(format!(
            "panthesia-window-map-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("own.mid");
        std::fs::write(&path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut player = Player::new(root.join("profile"), PathBuf::new(), true);
        player
            .command(Command::Load {
                path,
                title: "Own window".into(),
            })
            .unwrap();
        let view = player.score_view_payload(Some(0), None, false).unwrap();
        let file = player.file.as_ref().unwrap();
        let range = panthesia_core::practice_engraving::MeasureRange {
            first: 0,
            count: view["window"]["count"].as_u64().unwrap() as usize,
        };
        let (fifths, minor) = player.practice_key();
        let staff = |track, index, pitch| match crate::hands::part(
            &player.config,
            &player.note_hands,
            track,
            index,
        ) {
            PracticePart::LeftHand => 2,
            PracticePart::RightHand => 1,
            _ => {
                if pitch >= 60 {
                    1
                } else {
                    2
                }
            }
        };
        let engraving = panthesia_core::practice_engraving::engrave_range(
            file,
            "Own window",
            fifths,
            minor,
            true,
            range,
            &staff,
            &|| Ok(()),
        )
        .unwrap();
        let request = |fingerprint: String| Input {
            content_id: file.content_id.clone(),
            score_revision: Some(player.score_revision),
            source_fingerprint: Some(player.score_display_origin()),
            measure_range: Some(range),
            display_fingerprint: Some(fingerprint),
            practice_notation: true,
            page_count: Some(1),
            midi: vec![],
            notes: engraving
                .notes
                .iter()
                .map(|(id, source)| notation::RenderNote {
                    renderer_id: id.clone(),
                    page_index: 0,
                    onset_millis: 0.,
                    duration_millis: 0.,
                    pitch: file
                        .tracks
                        .iter()
                        .find(|t| t.track_id == source.track)
                        .unwrap()
                        .notes[source.index]
                        .note,
                })
                .collect(),
        };
        let current = request(view["displayFingerprint"].as_str().unwrap().into());
        let changed = request("0".repeat(64));
        let result = player.map_score_owned(current).unwrap();
        assert_eq!(
            result["mapping"].as_array().unwrap().len(),
            engraving.notes.len()
        );
        assert_eq!(result["unmapped"], 0);
        assert_eq!(result["following"], true);
        assert!(result["mappingToken"].as_str().is_some());
        assert!(
            player
                .map_score_owned(changed)
                .unwrap_err()
                .contains("显示条件")
        );
    }
    #[test]
    fn source_identity_maps_late_pages_and_rejects_wrong_layout_bounds() {
        let root = std::env::temp_dir().join(format!(
            "panthesia-page-map-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("own.mid");
        std::fs::write(&path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut p = Player::new(root.join("profile"), PathBuf::new(), true);
        p.command(Command::Load {
            path,
            title: "Page mapping".into(),
        })
        .unwrap();
        let file = p.file.as_ref().unwrap();
        let engraving =
            panthesia_core::practice_engraving::engrave_simplified(file, "", 0, false, &|| Ok(()))
                .unwrap();
        let (id, note) = engraving.notes.iter().next().unwrap();
        let pitch = file
            .tracks
            .iter()
            .find(|t| t.track_id == note.track)
            .unwrap()
            .notes[note.index]
            .note;
        let request = |count| Input {
            measure_range: None,
            display_fingerprint: None,
            content_id: file.content_id.clone(),
            score_revision: Some(p.score_revision),
            source_fingerprint: Some(p.score_display_origin()),
            midi: vec![],
            practice_notation: true,
            page_count: count,
            notes: vec![notation::RenderNote {
                renderer_id: id.clone(),
                page_index: 350,
                onset_millis: 0.,
                pitch,
                duration_millis: 1.,
            }],
        };
        let input = request(Some(400));
        let old = request(None);
        let result = p.map_score_owned(input).unwrap();
        assert_eq!(result["mapping"][0]["page"], 350);
        assert!(p.map_score_owned(old).is_err());
    }
}
