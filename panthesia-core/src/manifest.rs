//! `.panthesia` song manifest, version 1 (docs/development/panthesia-format.md).
//! Pure data: parsing, validation, serialization and note-reference checks. No file IO.
use panthesia_music::{NoteId, Performance};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const FORMAT: &str = "panthesia-song";
pub const VERSION: u32 = 1;
pub const NOTE_IDENTITY: &str = "smf-track-noteon-v1";
pub const EXTENSION: &str = "panthesia";
pub const FOLDER_NAME: &str = "song.panthesia";
pub const MAX_BYTES: usize = 32_000_000;

/// Unknown fields of every object are kept in `rest` and written back unchanged.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub metadata: Map<String, Value>,
    #[serde(default)]
    pub files: Vec<FileRef>,
    #[serde(default)]
    pub performances: Vec<PerformanceRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scores: Vec<ScoreRef>,
    pub default: Defaults,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub layers: BTreeMap<String, Layer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub settings: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alignments: Vec<Value>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub extensions: Map<String, Value>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub id: String,
    pub role: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blake3: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stem: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceRef {
    pub id: String,
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default = "note_identity")]
    pub note_identity: String,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}
fn note_identity() -> String {
    NOTE_IDENTITY.into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreRef {
    pub id: String,
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub performance: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub performance: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Human,
    Imported,
    Generated,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub origin: Origin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}
impl Provenance {
    pub fn new(origin: Origin, tool: Option<&str>) -> Self {
        Self { origin, tool: tool.map(Into::into), tool_version: None, params_hash: None, created_at: None, rest: Map::new() }
    }
}

/// Shared layer fields; the layer payload (tracks, notes, items …) stays as JSON in `body`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub performance: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unmatched: Vec<Value>,
    #[serde(flatten)]
    pub body: Map<String, Value>,
}

/// A note reference `[track, onset, pitch]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NoteRef(pub usize, pub usize, pub u8);
impl NoteRef {
    pub fn id(self) -> NoteId {
        NoteId { track: self.0, onset: self.1 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ManifestError {
    Syntax(String),
    Invalid(String),
    /// A newer format this program can read but must not write.
    Newer(u32),
}
impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Syntax(e) => write!(f, "歌曲清单无法读取：{e}"),
            Self::Invalid(e) => write!(f, "歌曲清单内容无效：{e}"),
            Self::Newer(v) => write!(f, "歌曲清单版本 {v} 比当前程序新，只读打开"),
        }
    }
}

fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
/// Relative, `/`-separated, no drive letter, no root, no empty or `.` segments.
pub fn valid_relative_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.contains('\\')
        && !path.starts_with('/')
        && !path.as_bytes().get(1).is_some_and(|b| *b == b':')
        && path.split('/').all(|part| !part.is_empty() && part != "." && !part.contains('\0'))
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl Manifest {
    /// A new manifest for one performance file referenced by its relative path.
    pub fn for_performance(path: &str, blake3: &str, bytes: u64, title: Option<String>) -> Self {
        Self {
            format: FORMAT.into(),
            version: VERSION,
            title,
            files: vec![FileRef {
                id: "perf".into(),
                role: "performance".into(),
                path: path.into(),
                blake3: Some(blake3.into()),
                bytes: Some(bytes),
                stem: None,
                range: None,
                label: None,
                rest: Map::new(),
            }],
            performances: vec![PerformanceRef {
                id: "main".into(),
                file: "perf".into(),
                label: None,
                note_identity: NOTE_IDENTITY.into(),
                rest: Map::new(),
            }],
            default: Defaults { performance: "main".into(), ..Default::default() },
            ..Default::default()
        }
    }

    /// Parse and validate. A newer version is returned with `ManifestError::Newer` only when
    /// the caller asks for writable access; see [`Manifest::parse_read_only`].
    pub fn parse(bytes: &[u8]) -> Result<Self, ManifestError> {
        let manifest = Self::parse_read_only(bytes)?;
        if manifest.version > VERSION {
            return Err(ManifestError::Newer(manifest.version));
        }
        Ok(manifest)
    }
    pub fn parse_read_only(bytes: &[u8]) -> Result<Self, ManifestError> {
        if bytes.len() > MAX_BYTES {
            return Err(ManifestError::Invalid("文件超过 32 MB".into()));
        }
        let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        let manifest: Self = serde_json::from_slice(bytes).map_err(|e| ManifestError::Syntax(e.to_string()))?;
        manifest.validate()?;
        Ok(manifest)
    }
    pub fn to_bytes(&self) -> Result<Vec<u8>, ManifestError> {
        self.validate()?;
        let mut bytes = serde_json::to_vec_pretty(self).map_err(|e| ManifestError::Syntax(e.to_string()))?;
        bytes.push(b'\n');
        Ok(bytes)
    }

    pub fn validate(&self) -> Result<(), ManifestError> {
        let bad = |m: String| Err(ManifestError::Invalid(m));
        if self.format != FORMAT {
            return bad(format!("format 应为 {FORMAT}"));
        }
        if self.version == 0 {
            return bad("version 应为正整数".into());
        }
        let mut files = BTreeSet::new();
        for file in &self.files {
            if !valid_id(&file.id) || !files.insert(file.id.as_str()) {
                return bad(format!("文件编号无效或重复：{}", file.id));
            }
            if file.role.is_empty() {
                return bad(format!("文件 {} 缺少 role", file.id));
            }
            if !valid_relative_path(&file.path) {
                return bad(format!("文件 {} 的路径须为相对路径并用 / 分隔：{}", file.id, file.path));
            }
            if file.blake3.as_deref().is_some_and(|h| !valid_hash(h)) {
                return bad(format!("文件 {} 的 blake3 无效", file.id));
            }
            if file.role == "stem" && file.stem.as_deref().is_none_or(str::is_empty) {
                return bad(format!("音轨文件 {} 缺少 stem", file.id));
            }
            if let Some([start, end]) = file.range {
                if !(start.is_finite() && end.is_finite() && start >= 0. && end > start) {
                    return bad(format!("文件 {} 的 range 无效", file.id));
                }
            }
        }
        if self.performances.is_empty() {
            return bad("至少需要一项 performances".into());
        }
        let mut performances = BTreeSet::new();
        for p in &self.performances {
            if !valid_id(&p.id) || !performances.insert(p.id.as_str()) {
                return bad(format!("演奏编号无效或重复：{}", p.id));
            }
            if !files.contains(p.file.as_str()) {
                return bad(format!("演奏 {} 引用的文件 {} 不存在", p.id, p.file));
            }
        }
        let mut scores = BTreeSet::new();
        for s in &self.scores {
            if !valid_id(&s.id) || !scores.insert(s.id.as_str()) {
                return bad(format!("谱面编号无效或重复：{}", s.id));
            }
            if !files.contains(s.file.as_str()) {
                return bad(format!("谱面 {} 引用的文件 {} 不存在", s.id, s.file));
            }
            if s.performance.as_deref().is_some_and(|p| !performances.contains(p)) {
                return bad(format!("谱面 {} 对应的演奏不存在", s.id));
            }
        }
        if !performances.contains(self.default.performance.as_str()) {
            return bad("default.performance 不存在".into());
        }
        if self.default.score.as_deref().is_some_and(|s| !scores.contains(s)) {
            return bad("default.score 不存在".into());
        }
        let variants: BTreeSet<_> = self.variants.iter().filter_map(|v| v.get("id")?.as_str()).collect();
        if variants.len() != self.variants.len() {
            return bad("派生版本缺少编号或编号重复".into());
        }
        if self.default.variant.as_deref().is_some_and(|v| !variants.contains(v)) {
            return bad("default.variant 不存在".into());
        }
        for (name, layer) in &self.layers {
            if name.is_empty() || name.len() > 64 {
                return bad(format!("图层名无效：{name}"));
            }
            if layer.performance.as_deref().is_some_and(|p| !performances.contains(p)) {
                return bad(format!("图层 {name} 对应的演奏不存在"));
            }
            if layer.confidence.is_some_and(|c| !(0.0..=1.0).contains(&c)) {
                return bad(format!("图层 {name} 的 confidence 应在 0–1"));
            }
            if layer.status.as_deref().is_some_and(|s| !["draft", "accepted"].contains(&s)) {
                return bad(format!("图层 {name} 的 status 应为 draft 或 accepted"));
            }
            if let Some(notes) = layer.body.get("notes") {
                let Some(rows) = notes.as_array() else { return bad(format!("图层 {name} 的 notes 应为数组")) };
                if rows.iter().any(|row| row.get("note").is_none_or(|n| serde_json::from_value::<NoteRef>(n.clone()).is_err())) {
                    return bad(format!("图层 {name} 中有无效的音符引用"));
                }
            }
        }
        Ok(())
    }

    pub fn file(&self, id: &str) -> Option<&FileRef> {
        self.files.iter().find(|f| f.id == id)
    }
    pub fn performance(&self, id: &str) -> Option<&PerformanceRef> {
        self.performances.iter().find(|p| p.id == id)
    }
    pub fn default_performance_file(&self) -> Option<&FileRef> {
        self.performance(&self.default.performance).and_then(|p| self.file(&p.file))
    }
    /// The performance id a layer belongs to.
    pub fn layer_performance<'a>(&'a self, layer: &'a Layer) -> &'a str {
        layer.performance.as_deref().unwrap_or(&self.default.performance)
    }
    pub fn references(&self, relative: &str) -> bool {
        self.files.iter().any(|f| f.path == relative)
    }

    /// Check every note reference of the layers bound to `performance_id` against the current
    /// performance. Entries whose note no longer exists or whose pitch differs move to the
    /// layer's `unmatched` list; nothing is discarded. Returns how many entries moved.
    pub fn reconcile_notes(&mut self, performance_id: &str, performance: &Performance) -> usize {
        let default = self.default.performance.clone();
        let mut moved = 0;
        for layer in self.layers.values_mut() {
            if layer.performance.as_deref().unwrap_or(&default) != performance_id {
                continue;
            }
            let Some(Value::Array(rows)) = layer.body.get_mut("notes") else { continue };
            let mut kept = Vec::with_capacity(rows.len());
            for row in rows.drain(..) {
                let current = row
                    .get("note")
                    .and_then(|n| serde_json::from_value::<NoteRef>(n.clone()).ok())
                    .is_some_and(|r| performance.note(r.id()).is_some_and(|n| n.note == r.2));
                if current {
                    kept.push(row);
                } else {
                    moved += 1;
                    layer.unmatched.push(row);
                }
            }
            *rows = kept;
        }
        moved
    }
}

/// Manifest file name for a single music file: `七里香.mid` → `七里香.panthesia`.
pub fn sibling_name(file_name: &str) -> String {
    let stem = file_name.rsplit_once('.').map_or(file_name, |(stem, _)| stem);
    format!("{stem}.{EXTENSION}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Manifest {
        let mut m = Manifest::for_performance("Oz.mid", &"a".repeat(64), 10, Some("Oz".into()));
        m.layers.insert(
            "hands".into(),
            Layer {
                provenance: Some(Provenance::new(Origin::Human, None)),
                body: serde_json::from_value(serde_json::json!({
                    "tracks": {"0": "right", "1": "left"},
                    "notes": [{"note": [0, 0, 60], "part": "left"}, {"note": [0, 1, 99], "part": "right"}]
                }))
                .unwrap(),
                ..Default::default()
            },
        );
        m
    }

    #[test]
    fn round_trip_keeps_unknown_fields_everywhere() {
        let text = br#"{"format":"panthesia-song","version":1,"future":{"a":1},
            "files":[{"id":"perf","role":"performance","path":"a/b.mid","x":true},
                     {"id":"v","role":"stem","stem":"vocals","path":"../v.wav","range":[1.5,30]}],
            "performances":[{"id":"main","file":"perf","y":2}],
            "default":{"performance":"main","z":3},
            "layers":{"chords":{"items":[{"tick":0,"chord":"C:maj"}],"provenance":{"origin":"generated","tool":"t","w":1},"confidence":0.8},
                      "mystery":{"anything":[1,2]}},
            "extensions":{"tool":{"k":"v"}}}"#;
        let m = Manifest::parse(text).unwrap();
        assert_eq!(m.performances[0].note_identity, NOTE_IDENTITY);
        let again = Manifest::parse(&m.to_bytes().unwrap()).unwrap();
        assert_eq!(m, again);
        let value: Value = serde_json::from_slice(&again.to_bytes().unwrap()).unwrap();
        assert_eq!(value["future"]["a"], 1);
        assert_eq!(value["files"][0]["x"], true);
        assert_eq!(value["performances"][0]["y"], 2);
        assert_eq!(value["default"]["z"], 3);
        assert_eq!(value["layers"]["chords"]["provenance"]["w"], 1);
        assert_eq!(value["layers"]["mystery"]["anything"][1], 2);
        assert_eq!(value["extensions"]["tool"]["k"], "v");
    }

    #[test]
    fn rejects_invalid_references_and_paths() {
        let base = sample();
        let mut m = base.clone();
        m.files[0].path = "C:/music/a.mid".into();
        assert!(m.validate().is_err());
        let mut m = base.clone();
        m.files[0].path = "a\\b.mid".into();
        assert!(m.validate().is_err());
        let mut m = base.clone();
        m.files[0].path = "/abs.mid".into();
        assert!(m.validate().is_err());
        let mut m = base.clone();
        m.default.performance = "missing".into();
        assert!(m.validate().is_err());
        let mut m = base.clone();
        m.files.push(m.files[0].clone());
        assert!(m.validate().is_err());
        let mut m = base.clone();
        m.files[0].role = "stem".into();
        assert!(m.validate().is_err());
        let mut m = base.clone();
        m.layers.get_mut("hands").unwrap().body.insert("notes".into(), serde_json::json!([{"note": [0, 0]}]));
        assert!(m.validate().is_err());
        assert!(valid_relative_path("../#1 AUDIO/Oz_人声.wav"));
        assert!(base.validate().is_ok());
    }

    #[test]
    fn newer_version_is_read_only_and_bom_is_accepted() {
        let mut m = sample();
        m.version = 2;
        let bytes = serde_json::to_vec(&m).unwrap();
        assert_eq!(Manifest::parse(&bytes), Err(ManifestError::Newer(2)));
        assert_eq!(Manifest::parse_read_only(&bytes).unwrap().version, 2);
        let mut bom = b"\xEF\xBB\xBF".to_vec();
        bom.extend(sample().to_bytes().unwrap());
        assert!(Manifest::parse(&bom).is_ok());
    }

    #[test]
    fn reconcile_moves_changed_notes_to_unmatched() {
        let midi = include_bytes!("../../panthesia-engine/assets/five-finger.mid");
        let file = panthesia_music::MidiFile::from_bytes_checked("five-finger", midi, &|| Ok(())).unwrap();
        let performance = file.source.clone();
        let first = performance.notes[0].clone();
        let mut m = sample();
        m.layers.get_mut("hands").unwrap().body.insert(
            "notes".into(),
            serde_json::json!([
                {"note": [first.id.track, first.id.onset, first.note], "part": "left"},
                {"note": [first.id.track, first.id.onset, (first.note + 1) % 128], "part": "right"},
                {"note": [99, 0, 60], "part": "right"}
            ]),
        );
        assert_eq!(m.reconcile_notes("main", &performance), 2);
        let layer = &m.layers["hands"];
        assert_eq!(layer.body["notes"].as_array().unwrap().len(), 1);
        assert_eq!(layer.unmatched.len(), 2);
        assert!(m.validate().is_ok());
    }

    #[test]
    fn sibling_names() {
        assert_eq!(sibling_name("七里香.mid"), "七里香.panthesia");
        assert_eq!(sibling_name("yama - Oz - BPM76 - Gmajor.mid"), "yama - Oz - BPM76 - Gmajor.panthesia");
        assert_eq!(sibling_name("noext"), "noext.panthesia");
    }
}
