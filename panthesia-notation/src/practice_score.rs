//! Disposable MusicXML display transposition.
pub use crate::practice_transpose::transpose;
#[cfg(test)]
mod tests {
    #[test]
    fn keys_harmony_and_ornament_accidentals_follow_each_part_and_staff() {
        let xml=br#"<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Other</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><key number="2"><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><harmony><root><root-step text="C">C</root-step></root><kind>major</kind><bass><bass-step>G</bass-step></bass></harmony><note id="source-note"><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note><note><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration><staff>2</staff><notations><ornaments><trill-mark/><accidental-mark placement="below">natural</accidental-mark></ornaments></notations></note></measure></part><part id="P2"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>"#;
        let output = super::transpose(xml, 1).unwrap();
        let text = String::from_utf8(output.clone()).unwrap();
        assert!(text.contains("<fifths>-5</fifths>") && text.contains("<fifths>-6</fifths>"));
        assert!(text.contains("<root-step>D</root-step><root-alter>-1</root-alter>"));
        assert!(text.contains("<bass-step>A</bass-step><bass-alter>-1</bass-alter>"));
        assert!(text.contains("<step>C</step><alter>0</alter><octave>5</octave>"));
        assert!(text.contains("<step>F</step><alter>-1</alter><octave>4</octave>"));
        assert!(text.contains("placement=\"below\">flat</accidental-mark>"));
        assert!(text.contains("id=\"source-note\""));
        crate::musicxml::import_musicxml_document(&output).unwrap();
        let octave = String::from_utf8(super::transpose(xml, 12).unwrap()).unwrap();
        assert!(octave.contains("<fifths>0</fifths>") && octave.contains("<fifths>-1</fifths>"));
        assert!(octave.contains("<step>E</step><alter>-1</alter><octave>5</octave>"));
    }
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
