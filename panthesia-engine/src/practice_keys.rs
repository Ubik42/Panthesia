//! Effective labels, engraving and export share one projection of immutable source keys.
use crate::practice_variant::Variant;
use panthesia_music::{
    MidiFile,
    key_signature::{self, KeySignatureEvent},
};
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct KeyChange {
    pub tick: u64,
    pub at: f64,
    pub tonic: u8,
    pub fifths: i8,
    pub minor: bool,
}
pub(super) fn timeline(
    file: &MidiFile,
    variant: &Variant,
    fifths: i8,
    minor: bool,
) -> Vec<KeyChange> {
    let target = key_signature::tonic(fifths, minor);
    let original = file
        .key_signature
        .map(|(f, m)| key_signature::tonic(f, m))
        .unwrap_or(((i16::from(target) - i16::from(variant.transpose)).rem_euclid(12)) as u8);
    let shift = i16::from(target) - i16::from(original);
    let mut changes = vec![KeyChange {
        tick: 0,
        at: 0.,
        tonic: target,
        fifths,
        minor,
    }];
    for event in file.key_signatures.iter() {
        let (tonic, fifths, minor) =
            key_signature::project(event.fifths, event.minor, shift, variant.minor);
        let value = KeyChange {
            tick: event.tick,
            at: file
                .tempo_track
                .pulses_to_duration(event.tick)
                .as_secs_f64(),
            tonic,
            fifths,
            minor,
        };
        if changes.last().is_some_and(|last| last.tick == event.tick) {
            changes.pop();
        }
        if changes
            .last()
            .is_none_or(|last| last.fifths != fifths || last.minor != minor)
        {
            changes.push(value);
        }
    }
    changes
}
pub(super) fn engraving(
    file: &MidiFile,
    variant: &Variant,
    fifths: i8,
    minor: bool,
) -> Vec<KeySignatureEvent> {
    timeline(file, variant, fifths, minor)
        .into_iter()
        .map(|key| KeySignatureEvent {
            tick: key.tick,
            fifths: key.fifths,
            minor: key.minor,
        })
        .collect()
}

/// Older score-derived MIDI may omit key meta events. Read the verified score;
/// do not regenerate or rewrite the user's MIDI to recover its labels.
pub(super) fn source(file: &MidiFile, asset: Option<&crate::notation::ScoreAsset>) -> MidiFile {
    let mut source = file.clone();
    let score = asset.filter(|asset| asset.content_id == file.content_id);
    // Sequencers write one C major signature at tick 0 by default. When the notes clearly use
    // another signature, it says nothing about the key: drop it and let the estimate decide.
    // A score's signature is authored and stays.
    if score.is_none()
        && matches!(source.key_signatures.as_ref(), [only] if only.tick == 0 && only.fifths == 0 && !only.minor)
        && panthesia_analysis::main_key(&panthesia_analysis::notes(&source.source), &source.musical_time)
            .is_some_and(|key| key.fifths() != 0)
    {
        source.key_signatures = Vec::new().into();
        source.key_signature = None;
    }
    if source.key_signatures.is_empty() {
        if let Some(asset) = asset.filter(|asset| asset.content_id == file.content_id) {
            let keys = asset.source_view.key_signatures(file);
            if !keys.is_empty() {
                source.key_signature = keys.first().map(|key| (key.fifths, key.minor));
                source.key_signatures = keys.into();
            }
        }
    }
    source
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn key_changes_follow_repeats_transpose_and_legacy_score_fallback() {
        let xml=br#"<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
        <measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><barline location="left"><repeat direction="forward"/></barline><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
        <measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note><attributes><key><fifths>-2</fifths><mode>minor</mode></key></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note><barline location="right"><repeat direction="backward"/></barline></measure>
        <measure number="3"><attributes><key><fifths>-1</fifths><mode>major</mode></key></attributes><note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>"#;
        let score=panthesia_notation::musicxml::import_musicxml_document(xml).unwrap();
        let mut performance=panthesia_notation::score_performance::generate(&score,120).unwrap();
        let file=MidiFile::from_smf("keys",&performance.smf).unwrap();
        let observed:Vec<_>=file.key_signatures.iter().map(|k|(k.tick/u64::from(file.musical_time.ppq),k.fifths,k.minor)).collect();
        assert_eq!(observed,vec![(0,0,false),(6,-2,true),(8,0,false),(14,-2,true),(16,-1,false)]);
        let projected=timeline(&file,&Variant{transpose:2,..Default::default()},2,false);
        assert_eq!(projected.iter().map(|k|(k.fifths,k.minor)).collect::<Vec<_>>(),vec![(2,false),(0,true),(2,false),(0,true),(1,false)]);
        let rendered=panthesia_notation::practice_engraving::engrave_range_with_keys(&file,"keys",0,false,false,panthesia_notation::practice_engraving::MeasureRange{first:1,count:1},&|_,_,_|1,&engraving(&file,&Variant::default(),0,false),&||Ok(())).unwrap();
        let text=std::str::from_utf8(&rendered.bytes).unwrap();
        assert!(text.contains("<fifths>-2</fifths>")&&text.contains("<mode>minor</mode>"));
        assert_eq!(rendered.notes.values().map(|n|n.index).collect::<std::collections::BTreeSet<_>>(),[1,2].into_iter().collect());
        // Retain absolute event times when removing old omitted key metadata.
        for track in &mut performance.smf.tracks {let mut carry=0u32;track.retain_mut(|e|{let delta=e.delta.as_int()+carry;if matches!(e.kind,panthesia_music::midly::TrackEventKind::Meta(panthesia_music::midly::MetaMessage::KeySignature(..))){carry=delta;false}else{e.delta=delta.into();carry=0;true}});}
        let legacy=MidiFile::from_smf("legacy",&performance.smf).unwrap();
        assert!(legacy.key_signatures.is_empty());
        let original=legacy.source.original_bytes.clone();
        let asset=crate::notation::ScoreAsset::new(xml.to_vec(),"keys.musicxml".into(),&legacy).unwrap();
        let recovered=source(&legacy,Some(&asset));
        assert_eq!(recovered.key_signatures.len(),5);
        assert_eq!(legacy.source.original_bytes,original);
        assert_eq!(recovered.content_id,legacy.content_id);
        assert_eq!(recovered.note_id(0,1),legacy.note_id(0,1));
    }
}
