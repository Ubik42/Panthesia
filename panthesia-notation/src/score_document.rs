//! Immutable source-document inspection, separate from practice semantics and rendering.
use crate::musicxml::{Score, ScoreEvent, import_musicxml_document};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotationCapabilities {
    pub fingerprint: String,
    pub format: String,
    pub title: Option<String>,
    pub exporter: Option<String>,
    pub written_notes: usize,
    pub parts: usize,
    pub display: String,
    pub analysis: String,
    pub playback: String,
    pub editing: String,
    pub export: String,
    pub issues: Vec<String>,
    pub identity: String,
    pub preserved_only: Vec<String>,
    pub format_changes: Vec<String>,
}
pub fn inspect(bytes: &[u8]) -> Result<NotationCapabilities, String> {
    let score = import_musicxml_document(bytes).map_err(|e| e.to_string())?;
    let mut issues: Vec<String> = score
        .warnings
        .iter()
        .map(|w| format!("{}：{}", w.location, w.message))
        .collect();
    let playback = match crate::score_performance::generate(&score, 120) {
        Ok(performance) => {
            issues.extend(performance.warnings);
            if issues.is_empty() {
                "支持当前练习语义；原演奏速度另存"
            } else {
                "部分支持；请核对诊断与原谱"
            }
        }
        Err(error) => {
            issues.push(error);
            "当前谱面演奏转换不可用；原文件可保留"
        }
    };
    let source = crate::musicxml::partwise_musicxml_source(bytes).map_err(|e| e.to_string())?;
    let mut reader = quick_xml::Reader::from_reader(source.as_slice());
    let mut exporter = None;
    let mut preserved_only = std::collections::BTreeSet::new();
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            quick_xml::events::Event::Start(tag) if tag.name().as_ref() == b"software" => {
                exporter = Some(
                    reader
                        .read_text(tag.name())
                        .map_err(|e| e.to_string())?
                        .decode()
                        .map_err(|e| e.to_string())?
                        .into_owned(),
                );
            }
            quick_xml::events::Event::Eof => break,
            quick_xml::events::Event::Start(tag) | quick_xml::events::Event::Empty(tag) => {
                let description = match tag.name().as_ref() {
                    b"lyric" => Some("歌词：来源文档保留，练习语义不编辑歌词"),
                    b"beam" | b"stem" => Some("符杠与符干：来源文档保留，排版由显示器负责"),
                    b"print" | b"defaults" | b"credit" => {
                        Some("版式与题注：来源文档保留，显示器可能重新排版")
                    }
                    b"transpose" => Some("移调声明：来源文档保留，播放音高须核对解析诊断"),
                    b"wedge" => Some("渐强渐弱线：来源文档保留，练习演奏不据此生成完整力度曲线"),
                    b"harmony" => Some("和弦标记：来源文档保留，练习演奏不自动实现伴奏"),
                    _ => None,
                };
                if let Some(description) = description {
                    preserved_only.insert(description.into());
                }
            }
            _ => {}
        }
    }
    Ok(NotationCapabilities {
        fingerprint: blake3::hash(bytes).to_hex().to_string(), format: if bytes.starts_with(b"PK") { "MXL" } else { "MusicXML" }.into(),
        written_notes: score.parts.iter().flat_map(|p|&p.measures).flat_map(|m|&m.events).filter(|e|matches!(e,ScoreEvent::Note(n) if n.pitch.is_some())).count(),
        parts: score.parts.len(), title: score.title.clone(), exporter,
        display: "保留来源文档，交由 Verovio 排版；具体显示以谱页为准".into(),
        analysis: "音高、拍位、声部、谱表及已支持记号；诊断所列内容需核对".into(),
        playback: playback.into(), editing: "受控修改个人指法、手别和持音换指；完整记谱编辑使用 MuseScore".into(),
        export: "在来源副本上改写个人标记并输出 MusicXML；MXL/timewise 会展开，原压缩包与排版由原文件保留".into(),
        identity: "来源指纹＋part/小节序号/事件序号；反复另加 occurrence。来源变化后旧音符编号仅作候选，需重新核对映射".into(), issues,
        preserved_only: preserved_only.into_iter().collect(),
        format_changes: if bytes.starts_with(b"PK") { vec!["MXL 个人标记导出为展开的 MusicXML；压缩包内其他文件继续保留在原始 MXL".into()] } else if bytes.windows(b"<score-timewise".len()).any(|w|w==b"<score-timewise") { vec!["score-timewise 个人标记导出为 score-partwise；原始文档单独保留".into()] } else { vec![] },
    })
}
/// Annotation export must preserve every supported musical semantic outside personal marks.
pub fn musical_semantics(mut score: Score) -> Score {
    score.warnings.clear();
    for part in &mut score.parts {
        for measure in &mut part.measures {
            for event in &mut measure.events {
                if let ScoreEvent::Note(note) = event {
                    note.fingering = None;
                }
            }
        }
    }
    score
}
