//! A display-only MusicXML transposition. Source assets and written rhythm stay intact.
use quick_xml::{
    Reader, Writer,
    events::{BytesText, Event},
};

fn text_value(source: &[u8], name: &[u8]) -> Result<String, String> {
    let mut reader = Reader::from_reader(source);
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(start) if start.name().as_ref() == name => {
                return reader
                    .read_text(start.name())
                    .and_then(|s| {
                        s.decode()
                            .map(|v| v.into_owned())
                            .map_err(quick_xml::Error::from)
                    })
                    .map_err(|e| e.to_string());
            }
            Event::Eof => return Err("谱面音高字段不完整".into()),
            _ => {}
        }
    }
}

pub fn transpose(source: &[u8], semitones: i8) -> Result<Vec<u8>, String> {
    if semitones == 0 {
        return Ok(source.to_vec());
    }
    if !(-24..=24).contains(&semitones) {
        return Err("谱面转调超出两个八度".into());
    }
    let source = crate::musicxml::musicxml_source(source).map_err(|e| e.to_string())?;
    let mut reader = Reader::from_reader(source.as_slice());
    let mut writer = Writer::new(Vec::with_capacity(source.len()));
    let mut fifths = 0;
    loop {
        let event = reader.read_event().map_err(|e| e.to_string())?;
        match event {
            Event::Eof => break,
            Event::Start(start) if start.name().as_ref() == b"pitch" => {
                let inner = reader.read_text(start.name()).map_err(|e| e.to_string())?;
                let step = text_value(inner.as_ref(), b"step")?;
                let base = match step.as_str() {
                    "C" => 0,
                    "D" => 2,
                    "E" => 4,
                    "F" => 5,
                    "G" => 7,
                    "A" => 9,
                    "B" => 11,
                    _ => return Err("谱面音名无效".into()),
                };
                let alter = text_value(inner.as_ref(), b"alter")
                    .ok()
                    .map(|v| {
                        v.parse::<i16>()
                            .map_err(|_| "谱面使用尚未支持的微分音".to_string())
                    })
                    .transpose()?
                    .unwrap_or(0);
                let octave = text_value(inner.as_ref(), b"octave")?
                    .parse::<i16>()
                    .map_err(|e| e.to_string())?;
                let midi = ((octave + 1) * 12 + base + alter + i16::from(semitones)).clamp(0, 127);
                let pc = midi.rem_euclid(12) as usize;
                let names = if fifths < 0 {
                    [
                        ("C", 0),
                        ("D", -1),
                        ("D", 0),
                        ("E", -1),
                        ("E", 0),
                        ("F", 0),
                        ("G", -1),
                        ("G", 0),
                        ("A", -1),
                        ("A", 0),
                        ("B", -1),
                        ("B", 0),
                    ]
                } else {
                    [
                        ("C", 0),
                        ("C", 1),
                        ("D", 0),
                        ("D", 1),
                        ("E", 0),
                        ("F", 0),
                        ("F", 1),
                        ("G", 0),
                        ("G", 1),
                        ("A", 0),
                        ("A", 1),
                        ("B", 0),
                    ]
                };
                let (step, alter) = names[pc];
                let xml = format!(
                    "<pitch><step>{step}</step><alter>{alter}</alter><octave>{}</octave></pitch>",
                    midi / 12 - 1
                );
                writer.get_mut().extend_from_slice(xml.as_bytes());
            }
            Event::Start(start) if start.name().as_ref() == b"fifths" => {
                let original = reader
                    .read_text(start.name())
                    .map_err(|e| e.to_string())?
                    .decode()
                    .map_err(|e| e.to_string())?
                    .parse::<i16>()
                    .map_err(|e| e.to_string())?;
                fifths = (original + i16::from(semitones) * 7 + 6).rem_euclid(12) - 6;
                writer
                    .write_event(Event::Start(start.to_owned()))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(&fifths.to_string())))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(start.to_end()))
                    .map_err(|e| e.to_string())?;
            }
            // Engraving derives accidentals from the new pitch and key.
            Event::Start(start) if start.name().as_ref() == b"accidental" => {
                reader
                    .read_to_end(start.name())
                    .map_err(|e| e.to_string())?;
            }
            Event::Empty(start) if start.name().as_ref() == b"accidental" => {}
            event => writer.write_event(event).map_err(|e| e.to_string())?,
        }
    }
    Ok(writer.into_inner())
}

#[cfg(test)]
mod tests {
    #[test]
    fn transposition_keeps_source_rhythm_and_updates_key_and_octave() {
        let xml=br#"<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><accidental>natural</accidental><type>quarter</type></note></measure></part></score-partwise>"#;
        let output = super::transpose(xml, 2).unwrap();
        let text = String::from_utf8(output.clone()).unwrap();
        assert!(text.contains("<fifths>2</fifths>"));
        assert!(text.contains("<octave>5</octave>"));
        assert!(text.contains("<alter>1</alter>"));
        assert!(text.contains("<duration>1</duration>"));
        assert!(!text.contains("<accidental>"));
        crate::musicxml::import_musicxml_document(&output).unwrap();
    }
}
