//! Song annotations (`SongSidecar`) stored in the layers of a `.panthesia` manifest.
//!
//! `SongSidecar` addresses notes by (track, compatibility index); the manifest addresses them
//! by `[track, onset, pitch]` (`smf-track-noteon-v1`). Both directions go through the
//! performance's note mapping. Layer entries that do not resolve against the current
//! performance are never dropped: on write they move to the layer's `unmatched` list.
use crate::library::{
    FingerAction, FingerHint, MeterCorrection, MeterMap, NoteHandHint, ScoreAssociation,
    SongMetadata, SongSidecar,
};
use crate::manifest::{FileRef, Layer, Manifest, NoteRef, Origin, Provenance, ScoreRef};
use crate::practice::PracticePart;
use crate::song_config::{NotePlaybackRule, PlayerConfig};
use panthesia_music::{NoteId, Performance};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::Path;

/// Program state that the format does not describe yet lives under `extensions.panthesia`.
const SCORE_ID: &str = "score";

struct Notes<'a> {
    source: &'a Performance,
    by_index: HashMap<(usize, usize), NoteId>,
    by_id: HashMap<NoteId, usize>,
}
impl<'a> Notes<'a> {
    fn new(source: &'a Performance) -> Self {
        let mut by_index = HashMap::new();
        let mut by_id = HashMap::new();
        for m in source.note_mapping.iter() {
            by_index.insert((m.id.track, m.compatibility_index), m.id);
            by_id.insert(m.id, m.compatibility_index);
        }
        Self { source, by_index, by_id }
    }
    /// (track, compatibility index) → `[track, onset, pitch]`.
    fn reference(&self, track: usize, index: usize) -> Option<Value> {
        let id = *self.by_index.get(&(track, index))?;
        let pitch = self.source.note(id)?.note;
        Some(json!([id.track, id.onset, pitch]))
    }
    /// `[track, onset, pitch]` → (track, compatibility index) when the pitch still matches.
    fn index(&self, value: Option<&Value>) -> Option<(usize, usize)> {
        let r: NoteRef = serde_json::from_value(value?.clone()).ok()?;
        (self.source.note(r.id())?.note == r.2).then_some(())?;
        Some((r.0, *self.by_id.get(&r.id())?))
    }
}

fn part_name(part: PracticePart) -> &'static str {
    match part {
        PracticePart::LeftHand => "left",
        PracticePart::RightHand => "right",
        PracticePart::Other => "other",
    }
}
fn part(value: Option<&Value>) -> Option<PracticePart> {
    match value?.as_str()? {
        "left" => Some(PracticePart::LeftHand),
        "right" => Some(PracticePart::RightHand),
        "other" => Some(PracticePart::Other),
        _ => None,
    }
}
fn player_name(player: PlayerConfig) -> &'static str {
    match player {
        PlayerConfig::Mute => "mute",
        PlayerConfig::Auto => "auto",
        PlayerConfig::Human => "human",
    }
}
fn player(value: Option<&Value>) -> Option<PlayerConfig> {
    match value?.as_str()? {
        "mute" => Some(PlayerConfig::Mute),
        "auto" => Some(PlayerConfig::Auto),
        "human" => Some(PlayerConfig::Human),
        _ => None,
    }
}
fn rows<'a>(layer: Option<&'a Layer>, key: &str) -> &'a [Value] {
    layer.and_then(|l| l.body.get(key)).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}
fn number<T: TryFrom<u64>>(row: &Value, key: &str) -> Option<T> {
    row.get(key)?.as_u64().and_then(|v| T::try_from(v).ok())
}

/// Annotations of `performance` as stored in the manifest. Entries that do not resolve against
/// `source` are left out (they stay in the manifest).
/// Score paths come back absolute, resolved against `manifest_dir`.
pub fn read(manifest: &Manifest, performance: &str, source: &Performance, manifest_dir: &Path) -> SongSidecar {
    let notes = Notes::new(source);
    let layer = |name: &str| manifest.layer_for(name, performance);
    let mut sidecar = SongSidecar { metadata: metadata(manifest), ..Default::default() };

    if let Some(hands) = layer("hands") {
        if let Some(tracks) = hands.body.get("tracks").and_then(Value::as_object) {
            for (track, value) in tracks {
                if let (Ok(track), Some(part)) = (track.parse::<usize>(), part(Some(value))) {
                    sidecar.track_parts.insert(track, part);
                }
            }
        }
    }
    for row in rows(layer("hands"), "notes") {
        if let (Some((track_id, note_index)), Some(part)) = (notes.index(row.get("note")), part(row.get("part"))) {
            sidecar.hands.push(NoteHandHint { track_id, note_index, part });
        }
    }
    for row in rows(layer("fingering"), "notes") {
        let finger = number::<u8>(row, "finger").filter(|f| (1..=5).contains(f));
        if let (Some((track_id, note_index)), Some(finger)) = (notes.index(row.get("note")), finger) {
            sidecar.fingerings.push(FingerHint { track_id, note_index, finger });
        }
    }
    for row in rows(layer("fingering"), "changes") {
        let (Some(a), Some(b)) = (notes.index(row.get("note")), notes.index(row.get("before"))) else { continue };
        let (Some(at_tick), Some(from), Some(to)) = (number(row, "atTick"), number(row, "from"), number(row, "to")) else { continue };
        sidecar.finger_actions.push(FingerAction {
            track_id: a.0,
            note_index: a.1,
            before_track: b.0,
            before_index: b.1,
            at_tick,
            from,
            to,
            hand: part(row.get("hand")).unwrap_or_default(),
            rate_milli: number(row, "rateMilli").unwrap_or(1000),
        });
    }
    for row in rows(layer("playback"), "notes") {
        if let (Some((track_id, note_index)), Some(mode)) = (notes.index(row.get("note")), player(row.get("player"))) {
            sidecar.note_playback.push(NotePlaybackRule { track_id, note_index, mode });
        }
    }
    if let Some(meter) = layer("meter") {
        let body = Value::Object(meter.body.clone());
        if body.get("segments").is_some() {
            sidecar.meter_map = serde_json::from_value::<MeterMapJson>(body.clone()).ok().map(Into::into);
        }
        sidecar.meter = body
            .get("correction")
            .and_then(|c| serde_json::from_value::<CorrectionJson>(c.clone()).ok())
            .map(Into::into);
    }
    if let Some(score) = manifest.scores.iter().find(|s| s.id == SCORE_ID) {
        if let Some(file) = manifest.file(&score.file) {
            if let Some(hash) = &file.blake3 {
                let path = crate::manifest_store::resolve(manifest_dir, &file.path);
                sidecar.score = Some(ScoreAssociation { path, content_id: hash.clone() });
            }
        }
        sidecar.score_analysis = score.rest.get("analysis").and_then(|v| serde_json::from_value(v.clone()).ok());
    }
    // Entries kept from earlier writes whose note is not in the performance.
    for name in ["hands", "fingering", "playback"] {
        for row in layer(name).map_or(&[][..], |l| l.unmatched.as_slice()) {
            let Some(entry) = row.get("entry").cloned() else { continue };
            match row.get("kind").and_then(Value::as_str) {
                Some("hands") => sidecar.hands.extend(serde_json::from_value::<NoteHandHint>(entry).ok()),
                Some("fingerings") => sidecar.fingerings.extend(serde_json::from_value::<FingerHint>(entry).ok()),
                Some("finger_actions") => sidecar.finger_actions.extend(serde_json::from_value::<FingerAction>(entry).ok()),
                Some("note_playback") => sidecar.note_playback.extend(serde_json::from_value::<NotePlaybackRule>(entry).ok()),
                _ => {}
            }
        }
    }
    sidecar
}

fn metadata(manifest: &Manifest) -> SongMetadata {
    let text = |key: &str| manifest.metadata.get(key).and_then(Value::as_str).map(str::to_owned);
    SongMetadata {
        title: manifest.title.clone(),
        artist: manifest.artist.clone(),
        subtitle: text("subtitle"),
        arranger: text("arranger"),
        copyright: text("copyright"),
        license: text("license"),
        composer: text("composer"),
        collection: text("collection"),
        difficulty: text("difficulty"),
        notes: text("notes"),
        tags: manifest
            .metadata
            .get("tags")
            .and_then(Value::as_array)
            .map(|t| t.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
            .unwrap_or_default(),
    }
}
fn set_metadata(manifest: &mut Manifest, value: &SongMetadata) {
    manifest.title = value.title.clone();
    manifest.artist = value.artist.clone();
    for (key, field) in [
        ("subtitle", &value.subtitle),
        ("arranger", &value.arranger),
        ("copyright", &value.copyright),
        ("license", &value.license),
        ("composer", &value.composer),
        ("collection", &value.collection),
        ("difficulty", &value.difficulty),
        ("notes", &value.notes),
    ] {
        match field {
            Some(text) => manifest.metadata.insert(key.into(), json!(text)),
            None => manifest.metadata.remove(key),
        };
    }
    if value.tags.is_empty() {
        manifest.metadata.remove("tags");
    } else {
        manifest.metadata.insert("tags".into(), json!(value.tags));
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MeterMapJson {
    #[serde(default)]
    pickup_ticks: u64,
    segments: Vec<SegmentJson>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    measure_lengths: Vec<LengthJson>,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentJson {
    measure: usize,
    numerator: u8,
    denominator: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_start: Option<i32>,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LengthJson {
    measure: usize,
    ticks: u64,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CorrectionJson {
    numerator: u8,
    denominator: u16,
    pickup_ticks: u64,
}
impl From<MeterMapJson> for MeterMap {
    fn from(v: MeterMapJson) -> Self {
        MeterMap {
            pickup_ticks: v.pickup_ticks,
            segments: v
                .segments
                .into_iter()
                .map(|s| crate::library::MeterSegment {
                    measure: s.measure,
                    numerator: s.numerator,
                    denominator: s.denominator,
                    display_start: s.display_start,
                })
                .collect(),
            measure_lengths: v
                .measure_lengths
                .into_iter()
                .map(|l| crate::library::MeasureLength { measure: l.measure, ticks: l.ticks })
                .collect(),
        }
    }
}
impl From<&MeterMap> for MeterMapJson {
    fn from(v: &MeterMap) -> Self {
        Self {
            pickup_ticks: v.pickup_ticks,
            segments: v
                .segments
                .iter()
                .map(|s| SegmentJson {
                    measure: s.measure,
                    numerator: s.numerator,
                    denominator: s.denominator,
                    display_start: s.display_start,
                })
                .collect(),
            measure_lengths: v.measure_lengths.iter().map(|l| LengthJson { measure: l.measure, ticks: l.ticks }).collect(),
        }
    }
}
impl From<CorrectionJson> for MeterCorrection {
    fn from(v: CorrectionJson) -> Self {
        MeterCorrection { numerator: v.numerator, denominator: v.denominator, pickup_ticks: v.pickup_ticks }
    }
}

/// Replace one layer's payload. Existing note rows that no longer resolve move to `unmatched`;
/// the layer is removed when it ends up empty; provenance becomes `human` when content changes.
fn put_layer(
    manifest: &mut Manifest,
    name: &str,
    performance: &str,
    body: Map<String, Value>,
    notes: &Notes,
    note_keys: &[&str],
    orphans: Vec<Value>,
) {
    let default = manifest.default.performance.clone();
    let key = manifest.layer_key(name, performance);
    let mut layer = manifest.layers.remove(&key).unwrap_or_default();
    for orphan in orphans {
        if !layer.unmatched.contains(&orphan) {
            layer.unmatched.push(orphan);
        }
    }
    for (key, value) in &layer.body {
        let Some(old) = value.as_array() else { continue };
        if !["notes", "changes"].contains(&key.as_str()) {
            continue;
        }
        for row in old {
            let resolves = note_keys.iter().all(|k| row.get(*k).is_none() || notes.index(row.get(*k)).is_some());
            if !resolves && !layer.unmatched.contains(row) {
                layer.unmatched.push(row.clone());
            }
        }
    }
    let empty = body.values().all(|v| match v {
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        Value::Null => true,
        _ => false,
    });
    if empty && layer.unmatched.is_empty() {
        return;
    }
    if empty {
        layer.body = body;
        manifest.layers.insert(key, layer);
        return;
    }
    let changed = layer.body != body;
    layer.body = body;
    if performance != default {
        layer.performance = Some(performance.into());
    }
    if changed || layer.provenance.is_none() {
        layer.provenance = Some(Provenance::new(Origin::Human, None));
        layer.status = None;
        layer.confidence = None;
    }
    manifest.layers.insert(key, layer);
}

/// Store `sidecar` as the annotations of `performance`. `music` is the performance file;
/// `manifest_dir` is the folder of the manifest. Returns an error only when the score file
/// cannot be referenced (outside the volume) or hashed.
pub fn write(
    manifest: &mut Manifest,
    performance: &str,
    sidecar: &SongSidecar,
    source: &Performance,
    music: &Path,
    manifest_dir: &Path,
) -> Result<(), String> {
    let notes = Notes::new(source);
    let note = |track: usize, index: usize| notes.reference(track, index);
    // Entries whose note is not in this performance are kept, never dropped.
    let orphan = |kind: &str, entry: &dyn erased::Entry| {
        json!({"kind": kind, "entry": entry.value(), "reason": "音符不在当前演奏中"})
    };

    let mut hands = Map::new();
    let tracks: Map<String, Value> =
        sidecar.track_parts.iter().map(|(t, p)| (t.to_string(), json!(part_name(*p)))).collect();
    if !tracks.is_empty() {
        hands.insert("tracks".into(), Value::Object(tracks));
    }
    let mut lost = Vec::new();
    let mut hand_notes = Vec::new();
    for h in &sidecar.hands {
        match note(h.track_id, h.note_index) {
            Some(n) => hand_notes.push(json!({"note": n, "part": part_name(h.part)})),
            None => lost.push(orphan("hands", h)),
        }
    }
    if !hand_notes.is_empty() {
        hands.insert("notes".into(), Value::Array(hand_notes));
    }
    put_layer(manifest, "hands", performance, hands, &notes, &["note"], lost);

    let mut fingering = Map::new();
    let mut lost = Vec::new();
    let mut finger_notes = Vec::new();
    for f in &sidecar.fingerings {
        match note(f.track_id, f.note_index) {
            Some(n) => finger_notes.push(json!({"note": n, "finger": f.finger})),
            None => lost.push(orphan("fingerings", f)),
        }
    }
    if !finger_notes.is_empty() {
        fingering.insert("notes".into(), Value::Array(finger_notes));
    }
    let mut changes = Vec::new();
    for a in &sidecar.finger_actions {
        let (Some(at), Some(before)) = (note(a.track_id, a.note_index), note(a.before_track, a.before_index)) else {
            lost.push(orphan("finger_actions", a));
            continue;
        };
        let mut row = json!({
            "note": at, "before": before,
            "atTick": a.at_tick, "from": a.from, "to": a.to, "hand": part_name(a.hand),
        });
        if a.rate_milli != 1000 {
            row["rateMilli"] = json!(a.rate_milli);
        }
        changes.push(row);
    }
    if !changes.is_empty() {
        fingering.insert("changes".into(), Value::Array(changes));
    }
    put_layer(manifest, "fingering", performance, fingering, &notes, &["note", "before"], lost);

    let mut playback = Map::new();
    let mut lost = Vec::new();
    let mut rules = Vec::new();
    for r in &sidecar.note_playback {
        match note(r.track_id, r.note_index) {
            Some(n) => rules.push(json!({"note": n, "player": player_name(r.mode)})),
            None => lost.push(orphan("note_playback", r)),
        }
    }
    if !rules.is_empty() {
        playback.insert("notes".into(), Value::Array(rules));
    }
    put_layer(manifest, "playback", performance, playback, &notes, &["note"], lost);

    let mut meter = match &sidecar.meter_map {
        Some(map) => match serde_json::to_value(MeterMapJson::from(map)) {
            Ok(Value::Object(body)) => body,
            _ => Map::new(),
        },
        None => Map::new(),
    };
    if let Some(c) = &sidecar.meter {
        meter.insert(
            "correction".into(),
            json!({"numerator": c.numerator, "denominator": c.denominator, "pickupTicks": c.pickup_ticks}),
        );
    }
    put_layer(manifest, "meter", performance, meter, &notes, &[], Vec::new());

    set_metadata(manifest, &sidecar.metadata);
    write_score(manifest, performance, sidecar, music, manifest_dir)?;
    Ok(())
}

fn write_score(
    manifest: &mut Manifest,
    performance: &str,
    sidecar: &SongSidecar,
    music: &Path,
    manifest_dir: &Path,
) -> Result<(), String> {
    let Some(association) = &sidecar.score else {
        if let Some(score) = manifest.scores.iter().position(|s| s.id == SCORE_ID) {
            let file = manifest.scores.remove(score).file;
            if !manifest.scores.iter().any(|s| s.file == file) {
                manifest.files.retain(|f| f.id != file);
            }
            if manifest.default.score.as_deref() == Some(SCORE_ID) {
                manifest.default.score = None;
            }
        }
        return Ok(());
    };
    let absolute = crate::library::resolve_score_path(music, association);
    let relative = crate::manifest_store::relative_path(manifest_dir, &absolute)
        .ok_or_else(|| format!("谱面与歌曲不在同一磁盘，无法写入清单：{}", absolute.display()))?;
    let bytes = std::fs::metadata(&absolute).map(|m| m.len()).ok();
    let file_id = manifest
        .scores
        .iter()
        .find(|s| s.id == SCORE_ID)
        .map(|s| s.file.clone())
        .unwrap_or_else(|| unique_file_id(manifest, SCORE_ID));
    let entry = FileRef {
        id: file_id.clone(),
        role: "score".into(),
        path: relative,
        blake3: Some(association.content_id.clone()),
        bytes,
        stem: None,
        range: None,
        label: None,
        rest: Map::new(),
    };
    match manifest.files.iter_mut().find(|f| f.id == file_id) {
        Some(existing) => {
            existing.path = entry.path;
            existing.blake3 = entry.blake3;
            existing.bytes = entry.bytes;
        }
        None => manifest.files.push(entry),
    }
    let analysis = sidecar.score_analysis.as_ref().and_then(|a| serde_json::to_value(a).ok());
    match manifest.scores.iter_mut().find(|s| s.id == SCORE_ID) {
        Some(score) => {
            score.performance = Some(performance.into());
            match analysis {
                Some(a) => score.rest.insert("analysis".into(), a),
                None => score.rest.remove("analysis"),
            };
        }
        None => {
            let mut rest = Map::new();
            if let Some(a) = analysis {
                rest.insert("analysis".into(), a);
            }
            manifest.scores.push(ScoreRef {
                id: SCORE_ID.into(),
                file: file_id,
                performance: Some(performance.into()),
                label: None,
                rest,
            });
        }
    }
    if manifest.default.score.is_none() {
        manifest.default.score = Some(SCORE_ID.into());
    }
    Ok(())
}

fn unique_file_id(manifest: &Manifest, base: &str) -> String {
    let taken = |id: &str| manifest.files.iter().any(|f| f.id == id);
    if !taken(base) {
        return base.into();
    }
    (2..).map(|n| format!("{base}{n}")).find(|id| !taken(id)).unwrap()
}

mod erased {
    /// Serializable sidecar entries recorded as unmatched layer rows.
    pub trait Entry {
        fn value(&self) -> serde_json::Value;
    }
    impl<T: serde::Serialize> Entry for T {
        fn value(&self) -> serde_json::Value {
            serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
        }
    }
}
