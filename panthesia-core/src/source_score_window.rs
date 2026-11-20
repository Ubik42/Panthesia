//! Indexed display copies of authored MusicXML. Source bytes and written order stay immutable.
use crate::{
    musicxml::{self, ScoreEventId, ScoreEventKind},
    practice_engraving::MeasureRange,
};
use quick_xml::{
    Reader, Writer,
    events::{BytesStart, Event},
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ops::Range,
    sync::Arc,
};

pub const ASSET_LIMIT: usize = 64 * 1024 * 1024;
pub const WINDOW_LIMIT: usize = 4_000_000;
#[derive(Clone, Default)]
struct Context {
    attributes: BTreeMap<(String, String), Vec<u8>>,
    spans: BTreeMap<(String, String, String), Vec<u8>>,
    tempo: Option<f64>,
}
impl Context {
    fn write(&self, out: &mut Vec<u8>) {
        if !self.attributes.is_empty() {
            out.extend_from_slice(b"<attributes>");
            // MusicXML schema order, independent of the order of earlier updates.
            for name in [
                "footnote",
                "level",
                "divisions",
                "key",
                "time",
                "staves",
                "part-symbol",
                "instruments",
                "clef",
                "staff-details",
                "transpose",
                "directive",
                "measure-style",
            ] {
                for ((kind, _), value) in &self.attributes {
                    if kind == name {
                        out.extend_from_slice(value);
                    }
                }
            }
            out.extend_from_slice(b"</attributes>");
        }
        if let Some(bpm) = self.tempo {
            out.extend_from_slice(format!("<direction><direction-type><words/></direction-type><sound tempo=\"{bpm:.8}\"/></direction>").as_bytes());
        }
        for span in self.spans.values() {
            out.extend_from_slice(span);
        }
    }
    fn size(&self) -> usize {
        let mut bytes = Vec::new();
        self.write(&mut bytes);
        bytes.len()
    }
}
struct NoteIdentity {
    id: ScoreEventId,
    renderer: String,
}
struct Measure {
    bytes: Range<usize>,
    context: Arc<Context>,
    notes: Vec<NoteIdentity>,
}
struct Part {
    header: Range<usize>,
    measures: Vec<Measure>,
}
pub struct SourceDocument {
    xml: Arc<[u8]>,
    header: Range<usize>,
    suffix: Range<usize>,
    parts: Vec<Part>,
    ranges: Vec<MeasureRange>,
    pub render_ids: HashMap<String, ScoreEventId>,
}
pub struct Window {
    pub bytes: Vec<u8>,
    pub render_ids: HashMap<String, ScoreEventId>,
}
fn err(value: impl std::fmt::Display) -> String {
    value.to_string()
}
fn attr(tag: &BytesStart, name: &[u8]) -> Result<Option<String>, String> {
    for field in tag.attributes() {
        let field = field.map_err(err)?;
        if field.key.as_ref() == name {
            return quick_xml::escape::unescape(std::str::from_utf8(&field.value).map_err(err)?)
                .map(|v| Some(v.into_owned()))
                .map_err(err);
        }
    }
    Ok(None)
}
fn update_attributes(context: &mut Context, xml: &[u8]) -> Result<(), String> {
    let mut reader = Reader::from_reader(xml);
    let mut depth = 0;
    let mut field = None;
    loop {
        let before = reader.buffer_position() as usize;
        match reader.read_event().map_err(err)? {
            Event::Start(tag) => {
                if depth == 1 {
                    field = Some((
                        before,
                        String::from_utf8_lossy(tag.name().as_ref()).into_owned(),
                        attr(&tag, b"number")?.unwrap_or_default(),
                    ));
                }
                depth += 1;
            }
            Event::Empty(tag) if depth == 1 => {
                context.attributes.insert(
                    (
                        String::from_utf8_lossy(tag.name().as_ref()).into_owned(),
                        attr(&tag, b"number")?.unwrap_or_default(),
                    ),
                    xml[before..reader.buffer_position() as usize].to_vec(),
                );
            }
            Event::End(_) => {
                depth -= 1;
                if depth == 1 {
                    if let Some((start, name, number)) = field.take() {
                        context.attributes.insert(
                            (name, number),
                            xml[start..reader.buffer_position() as usize].to_vec(),
                        );
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(())
}
fn update_direction(context: &mut Context, xml: &[u8]) -> Result<(), String> {
    let mut reader = Reader::from_reader(xml);
    let mut spans = Vec::new();
    let mut staff = "1".to_string();
    loop {
        match reader.read_event().map_err(err)? {
            Event::Start(tag) if tag.name().as_ref() == b"staff" => {
                staff = reader
                    .read_text(tag.name())
                    .map_err(err)?
                    .decode()
                    .map_err(err)?
                    .into_owned();
            }
            Event::Start(tag) | Event::Empty(tag) => {
                let name = String::from_utf8_lossy(tag.name().as_ref()).into_owned();
                if name == "sound" {
                    if let Some(bpm) = attr(&tag, b"tempo")?
                        .and_then(|v| v.parse::<f64>().ok())
                        .filter(|v| v.is_finite() && *v > 0.)
                    {
                        context.tempo = Some(bpm);
                    }
                }
                if ["wedge", "octave-shift", "pedal"].contains(&name.as_str()) {
                    let mut out = Writer::new(Vec::new());
                    out.write_event(Event::Empty(tag.clone().into_owned()))
                        .map_err(err)?;
                    spans.push((
                        name,
                        attr(&tag, b"number")?.unwrap_or_else(|| "1".into()),
                        attr(&tag, b"type")?.unwrap_or_default(),
                        out.into_inner(),
                    ));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    for (name, number, kind, tag) in spans {
        let key = (name, number, staff.clone());
        if ["stop", "discontinue"].contains(&kind.as_str()) {
            context.spans.remove(&key);
        } else if kind != "continue" {
            let mut direction = b"<direction><direction-type>".to_vec();
            direction.extend(tag);
            direction.extend_from_slice(b"</direction-type>");
            if !staff.is_empty() {
                direction.extend_from_slice(
                    format!("<staff>{}</staff>", quick_xml::escape::escape(&staff)).as_bytes(),
                );
            }
            direction.extend_from_slice(b"</direction>");
            context.spans.insert(key, direction);
        }
    }
    Ok(())
}
impl SourceDocument {
    pub fn new(bytes: &[u8], check: &impl Fn() -> Result<(), String>) -> Result<Self, String> {
        check()?;
        if bytes.len() > ASSET_LIMIT {
            return Err("原谱资产超过 64 MiB".into());
        }
        let xml = musicxml::partwise_musicxml_source(bytes).map_err(err)?;
        let mut reader = Reader::from_reader(xml.as_slice());
        let mut ids = HashMap::<String, usize>::new();
        let mut serial = 0usize;
        loop {
            serial += 1;
            if serial % 1024 == 0 {
                check()?;
            }
            match reader.read_event().map_err(err)? {
                Event::Start(tag) | Event::Empty(tag) => {
                    for name in [b"id".as_slice(), b"xml:id".as_slice()] {
                        if let Some(id) = attr(&tag, name)? {
                            *ids.entry(id).or_default() += 1;
                        }
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
        let mut occupied: HashSet<_> = ids.keys().cloned().collect();
        let hash = blake3::hash(&xml).to_hex().to_string();
        let mut reader = Reader::from_reader(xml.as_slice());
        let mut depth = 0usize;
        let mut parts: Vec<Part> = vec![];
        let mut context = Arc::new(Context::default());
        let mut measure: Option<Measure> = None;
        let mut part_id = String::new();
        let mut attribute_start = None;
        let mut direction_start = None;
        let mut header_end = 0;
        let mut suffix_start = 0;
        let mut render_ids = HashMap::new();
        serial = 0;
        loop {
            let before = reader.buffer_position() as usize;
            serial += 1;
            if serial % 1024 == 0 {
                check()?;
            }
            let event = reader.read_event().map_err(err)?;
            let after = reader.buffer_position() as usize;
            match event {
                Event::Start(tag) => {
                    if depth == 1 && tag.name().as_ref() == b"part" {
                        if parts.is_empty() {
                            header_end = before;
                        }
                        part_id = attr(&tag, b"id")?.unwrap_or_default();
                        parts.push(Part {
                            header: before..after,
                            measures: vec![],
                        });
                        context = Arc::new(Context::default());
                    } else if depth == 2 && tag.name().as_ref() == b"measure" {
                        measure = Some(Measure {
                            bytes: before..0,
                            context: context.clone(),
                            notes: vec![],
                        });
                    } else if depth == 3 && tag.name().as_ref() == b"attributes" {
                        attribute_start = Some(before);
                    } else if depth == 3 && tag.name().as_ref() == b"direction" {
                        direction_start = Some(before);
                    }
                    if depth == 3 && tag.name().as_ref() == b"note" {
                        let m = measure.as_mut().ok_or("原谱音符缺少小节")?;
                        let id = ScoreEventId {
                            part_id: part_id.clone(),
                            measure_ordinal: parts.last().ok_or("原谱缺少声部")?.measures.len()
                                as u32,
                            kind: ScoreEventKind::Note,
                            ordinal: m.notes.len() as u32,
                        };
                        let original = attr(&tag, b"id")?.or(attr(&tag, b"xml:id")?);
                        let renderer = if let Some(id) =
                            original.filter(|id| !id.is_empty() && ids.get(id) == Some(&1))
                        {
                            id
                        } else {
                            let mut id = format!(
                                "panthesia-source-{}-p{}-m{}-n{}",
                                &hash[..16],
                                parts.len() - 1,
                                id.measure_ordinal,
                                id.ordinal
                            );
                            while occupied.contains(&id) {
                                id.push('x');
                            }
                            occupied.insert(id.clone());
                            id
                        };
                        render_ids.insert(renderer.clone(), id.clone());
                        m.notes.push(NoteIdentity { id, renderer });
                    }
                    if depth >= 3 && tag.name().as_ref() == b"sound" {
                        if let Some(bpm) = attr(&tag, b"tempo")?
                            .and_then(|v| v.parse::<f64>().ok())
                            .filter(|v| v.is_finite() && *v > 0.)
                        {
                            Arc::make_mut(&mut context).tempo = Some(bpm);
                        }
                    }
                    depth += 1;
                }
                Event::Empty(tag) => {
                    if depth >= 3 && tag.name().as_ref() == b"sound" {
                        if let Some(bpm) = attr(&tag, b"tempo")?
                            .and_then(|v| v.parse::<f64>().ok())
                            .filter(|v| v.is_finite() && *v > 0.)
                        {
                            Arc::make_mut(&mut context).tempo = Some(bpm);
                        }
                    }
                }
                Event::End(tag) => {
                    depth = depth.checked_sub(1).ok_or("原谱 XML 层级无效")?;
                    if depth == 3 && tag.name().as_ref() == b"attributes" {
                        if let Some(start) = attribute_start.take() {
                            update_attributes(Arc::make_mut(&mut context), &xml[start..after])?;
                        }
                    }
                    if depth == 3 && tag.name().as_ref() == b"direction" {
                        if let Some(start) = direction_start.take() {
                            update_direction(Arc::make_mut(&mut context), &xml[start..after])?;
                        }
                    }
                    if depth == 2 && tag.name().as_ref() == b"measure" {
                        let mut m = measure.take().ok_or("原谱小节无法读取")?;
                        m.bytes.end = after;
                        parts.last_mut().ok_or("原谱缺少声部")?.measures.push(m);
                    }
                    if depth == 1 && tag.name().as_ref() == b"part" {
                        suffix_start = after;
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
        let total = parts.iter().map(|p| p.measures.len()).max().unwrap_or(0);
        if total == 0 {
            return Err("原谱没有可显示的小节".into());
        }
        let mut context_sizes = HashMap::new();
        let overhead = header_end + xml.len() - suffix_start
            + parts
                .iter()
                .map(|p| {
                    p.header.len()
                        + 7
                        + p.measures
                            .iter()
                            .map(|m| {
                                *context_sizes
                                    .entry(Arc::as_ptr(&m.context))
                                    .or_insert_with(|| m.context.size())
                            })
                            .max()
                            .unwrap_or(0)
                })
                .sum::<usize>();
        let mut ranges = vec![];
        let mut first = 0;
        let mut count = 0;
        let mut size = overhead;
        for ordinal in 0..total {
            let cost = parts
                .iter()
                .filter_map(|p| p.measures.get(ordinal))
                .map(|m| m.bytes.len() + m.notes.len() * 128)
                .sum::<usize>();
            if count > 0 && (count == 32 || size.saturating_add(cost) > WINDOW_LIMIT) {
                ranges.push(MeasureRange { first, count });
                first = ordinal;
                count = 0;
                size = overhead;
            }
            if size.saturating_add(cost) > WINDOW_LIMIT {
                return Err(format!(
                    "原谱第 {} 小节及其谱面上下文超过单次容量",
                    ordinal + 1
                ));
            }
            size += cost;
            count += 1;
        }
        if count > 0 {
            ranges.push(MeasureRange { first, count });
        }
        check()?;
        let length = xml.len();
        Ok(Self {
            xml: xml.into(),
            header: 0..header_end,
            suffix: suffix_start..length,
            parts,
            ranges,
            render_ids,
        })
    }
    pub fn total(&self) -> usize {
        self.parts
            .iter()
            .map(|p| p.measures.len())
            .max()
            .unwrap_or(0)
    }
    pub fn measure_number(&self,ordinal:usize)->String {
        let Some(part)=self.parts.iter().enumerate().max_by_key(|(i,p)|(p.measures.len(),usize::MAX-i)).map(|(_,part)|part) else{return (ordinal+1).to_string();};
        if let Some(measure)=part.measures.get(ordinal){
            let mut reader=Reader::from_reader(&self.xml[measure.bytes.clone()]);
            if let Ok(Event::Start(tag))=reader.read_event(){if let Ok(Some(number))=attr(&tag,b"number"){if !number.is_empty(){return number;}}}
        }
        (ordinal+1).to_string()
    }
    pub fn range_at(&self, measure: usize) -> MeasureRange {
        self.ranges[self
            .ranges
            .partition_point(|r| r.first <= measure.min(self.total() - 1))
            .saturating_sub(1)]
    }
    pub fn previous(&self, first: usize) -> Option<usize> {
        let i = self.ranges.partition_point(|r| r.first < first);
        i.checked_sub(1).map(|i| self.ranges[i].first)
    }
    pub fn window(
        &self,
        range: MeasureRange,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Window, String> {
        let end = range.end(self.total())?;
        let mut out = Writer::new(Vec::new());
        out.get_mut()
            .extend_from_slice(&self.xml[self.header.clone()]);
        let mut render_ids = HashMap::new();
        for part in &self.parts {
            check()?;
            if range.first >= part.measures.len() {
                continue;
            }
            out.get_mut()
                .extend_from_slice(&self.xml[part.header.clone()]);
            for (ordinal, m) in part.measures.iter().enumerate().take(end).skip(range.first) {
                check()?;
                let mut reader = Reader::from_reader(&self.xml[m.bytes.clone()]);
                let mut notes = 0;
                loop {
                    let event = reader.read_event().map_err(err)?;
                    match event {
                        Event::Start(tag) if tag.name().as_ref() == b"measure" => {
                            out.write_event(Event::Start(tag.into_owned()))
                                .map_err(err)?;
                            if ordinal == range.first {
                                m.context.write(out.get_mut());
                            }
                        }
                        Event::Start(tag) if tag.name().as_ref() == b"note" => {
                            let note = m.notes.get(notes).ok_or("原谱音符索引发生变化")?;
                            notes += 1;
                            let original = tag;
                            let mut tag = original.clone().into_owned();
                            tag.clear_attributes();
                            for field in original.attributes() {
                                let field = field.map_err(err)?;
                                if ![b"id".as_slice(), b"xml:id".as_slice()]
                                    .contains(&field.key.as_ref())
                                {
                                    tag.push_attribute(field);
                                }
                            }
                            tag.push_attribute(("id", note.renderer.as_str()));
                            render_ids.insert(note.renderer.clone(), note.id.clone());
                            out.write_event(Event::Start(tag)).map_err(err)?;
                        }
                        Event::Eof => break,
                        other => out.write_event(other.into_owned()).map_err(err)?,
                    }
                    if out.get_ref().len() > WINDOW_LIMIT {
                        return Err("当前原谱范围超过 4 MB，请缩小范围".into());
                    }
                }
                if notes != m.notes.len() {
                    return Err("原谱音符索引不完整".into());
                }
            }
            out.get_mut().extend_from_slice(b"</part>");
        }
        out.get_mut()
            .extend_from_slice(&self.xml[self.suffix.clone()]);
        check()?;
        Ok(Window {
            bytes: out.into_inner(),
            render_ids,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_window_keeps_authored_marks_and_restores_prior_attributes_and_spans() {
        let mut xml = String::from(
            "<score-partwise version=\"4.0\"><part-list><score-part id=\"P1\"><part-name>Piano</part-name></score-part></part-list><part id=\"P1\">",
        );
        for m in 0..70 {
            xml.push_str(&format!("<measure number=\"{}\">", m + 1));
            if m == 0 {
                xml.push_str("<attributes><divisions>4</divisions><key><fifths>-2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>");
            }
            if m == 20 {
                xml.push_str("<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>");
            }
            if m == 30 {
                xml.push_str("<direction><direction-type><wedge type=\"crescendo\" number=\"1\"></wedge><pedal type=\"start\" line=\"yes\"/></direction-type><sound tempo=\"90\"/></direction>");
            }
            if m == 40 {
                xml.push_str("<direction><direction-type><wedge type=\"stop\" number=\"1\"/><pedal type=\"stop\"/></direction-type></direction>");
            }
            if m == 32 {
                xml.push_str(
                    "<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>",
                );
            }
            xml.push_str(&format!("<note id=\"written-{m}\"><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/><notations><technical><fingering>3</fingering></technical><articulations><staccato/></articulations></notations></note></measure>"));
        }
        xml.push_str("</part></score-partwise>");
        let original = xml.clone();
        let doc = SourceDocument::new(xml.as_bytes(), &|| Ok(())).unwrap();
        let selected = doc.window(doc.range_at(32), &|| Ok(())).unwrap();
        let text = std::str::from_utf8(&selected.bytes).unwrap();
        assert!(text.contains("<measure number=\"33\"") && !text.contains("<measure number=\"1\""));
        for marker in [
            "<fifths>-2</fifths>",
            "<beats>3</beats>",
            "<divisions>4</divisions>",
            "<clef>",
            "tempo=\"90.00000000\"",
            "<harmony>",
            "<fingering>3</fingering>",
            "<staccato/>",
            "type=\"crescendo\"",
            "type=\"start\" line=\"yes\"",
        ] {
            assert!(text.contains(marker), "{marker}");
        }
        musicxml::import_musicxml_document(&selected.bytes).unwrap();
        assert_eq!(selected.render_ids["written-32"].measure_ordinal, 32);
        let later = doc
            .window(
                MeasureRange {
                    first: 64,
                    count: 6,
                },
                &|| Ok(()),
            )
            .unwrap();
        let text = std::str::from_utf8(&later.bytes).unwrap();
        assert!(!text.contains("crescendo") && !text.contains("<pedal"));
        assert_eq!(xml, original);
        assert_eq!(doc.previous(32), Some(0));
    }
    #[test]
    fn timewise_display_ids_are_stable_for_duplicate_and_anonymous_note_ids() {
        let xml=br#"<score-timewise version="4.0"><part-list><score-part id="P1"><part-name>One</part-name></score-part><score-part id="P2"><part-name>Two</part-name></score-part></part-list><measure number="A"><part id="P1"><attributes><divisions>1</divisions></attributes><note id="duplicate"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></part><part id="P2"><attributes><divisions>1</divisions></attributes><note id="duplicate"><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note></part></measure><measure number="B"><part id="P1"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note></part><part id="P2"><note id="keep-this-id"><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note></part></measure></score-timewise>"#;
        let doc = SourceDocument::new(xml, &|| Ok(())).unwrap();
        let a = doc
            .window(MeasureRange { first: 0, count: 2 }, &|| Ok(()))
            .unwrap();
        let b = doc
            .window(MeasureRange { first: 1, count: 1 }, &|| Ok(()))
            .unwrap();
        assert_eq!(a.render_ids.len(), 4);
        assert_eq!(b.render_ids.len(), 2);
        assert!(b.render_ids.contains_key("keep-this-id"));
        assert!(!a.render_ids.contains_key("duplicate"));
        for (id, source) in b.render_ids {
            assert_eq!(a.render_ids.get(&id), Some(&source));
        }
        let score = musicxml::import_musicxml_document(&b.bytes).unwrap();
        assert_eq!(score.parts.len(), 2);
        assert!(score.parts.iter().all(|p| p.measures[0].number == "B"));
    }
}
