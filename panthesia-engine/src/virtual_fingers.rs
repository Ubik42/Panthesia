//! Hands and fingering for the virtual hands where the song has none (R8). Notes whose track
//! has no hand are split by the hand planner (`hands::propose`, measure chunks of at most
//! 2000 notes); each hand's notes then go to the fingering planner with the saved fingers as
//! fixed anchors. The result only drives the animation and is never written to the song.
use crate::player::Player;
use panthesia_core::{
    fingering::{FingeringHand, FingeringNote, HandSpanProfile, suggest_fingerings_with_profile},
    practice::PracticePart,
};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFinger {
    pub track: usize,
    pub index: usize,
    /// `left` or `right`.
    pub part: String,
    pub finger: u8,
}

const CHUNK: usize = 2000;

impl Player {
    /// The hand of every pitched note: the song's own, else the planner's.
    fn planned_parts(&self, file: &panthesia_music::MidiFile) -> HashMap<(usize, usize), PracticePart> {
        let mut parts = HashMap::new();
        for track in file.tracks.iter().filter(|t| t.has_other_than_drums) {
            let mut unassigned = false;
            for (index, note) in track.notes.iter().enumerate() {
                if note.channel == 9 {
                    continue;
                }
                match crate::hands::part(&self.config, &self.note_hands, track.track_id, index) {
                    part @ (PracticePart::LeftHand | PracticePart::RightHand) => {
                        parts.insert((track.track_id, index), part);
                    }
                    _ => unassigned = true,
                }
            }
            if !unassigned {
                continue;
            }
            // Measure ranges of at most CHUNK notes each.
            let measures = &file.musical_time.measures;
            let starts: Vec<u64> = track.notes.iter().map(|n| file.tempo_track.seconds_to_pulses(n.start.as_secs_f64()) as u64).collect();
            let mut first = 1;
            while first <= measures.len() {
                let mut last = first;
                let mut count = 0;
                while last <= measures.len() {
                    let m = &measures[last - 1];
                    let inside = starts.iter().filter(|&&t| t >= m.start_tick && t < m.end_tick).count();
                    if count + inside > CHUNK && last > first {
                        break;
                    }
                    count += inside;
                    last += 1;
                }
                let range = (first, (last - 1).max(first));
                if count > 0 {
                    let profiles = [HandSpanProfile::Standard; 2];
                    let result = crate::hands::propose(file, &self.config, &self.note_hands, track.track_id, range, 60, profiles);
                    if let Ok(proposals) = result {
                        // Where the planner gives up (same-key overlaps, chords it cannot
                        // split) the user is asked; the animation splits at the midpoint
                        // between the two hands' average pitch instead.
                        let average = |hand: PracticePart| {
                            let pitches: Vec<f64> = proposals.iter().filter(|p| p.part == hand).map(|p| f64::from(p.pitch)).collect();
                            (!pitches.is_empty()).then(|| pitches.iter().sum::<f64>() / pitches.len() as f64)
                        };
                        let middle = match (average(PracticePart::LeftHand), average(PracticePart::RightHand)) {
                            (Some(l), Some(r)) => (l + r) / 2.0,
                            _ => 60.0,
                        };
                        for p in proposals {
                            let part = match p.part {
                                PracticePart::Other if f64::from(p.pitch) < middle => PracticePart::LeftHand,
                                PracticePart::Other => PracticePart::RightHand,
                                part => part,
                            };
                            parts.entry((p.track, p.index)).or_insert(part);
                        }
                    }
                }
                first = range.1 + 1;
            }
        }
        parts
    }

    /// Planned hand and finger of the notes without a saved finger.
    pub(crate) fn planned_fingers(&self, content_id: &str) -> Result<Vec<PlannedFinger>, String> {
        let file = self.file.as_ref().filter(|f| f.content_id == content_id).ok_or("曲目已切换")?;
        let parts = self.planned_parts(file);
        let mut out = Vec::new();
        for (side, hand, label) in [(PracticePart::LeftHand, FingeringHand::Left, "left"), (PracticePart::RightHand, FingeringHand::Right, "right")] {
            let mut notes: Vec<(usize, usize, &panthesia_music::MidiNote)> = file
                .tracks
                .iter()
                .flat_map(|t| t.notes.iter().enumerate().map(move |(i, n)| (t.track_id, i, n)))
                .filter(|(track, index, _)| parts.get(&(*track, *index)) == Some(&side))
                .collect();
            notes.sort_by(|a, b| a.2.start.cmp(&b.2.start).then(a.2.note.cmp(&b.2.note)));
            let saved = |track: usize, n: &panthesia_music::MidiNote| self.fingers.get(&(track, n.start, n.note)).copied();
            let inputs: Vec<FingeringNote> = notes
                .iter()
                .map(|(track, _, n)| FingeringNote { pitch: n.note, onset: n.start, end: n.end, anchored_finger: saved(*track, n) })
                .collect();
            let suggestions = suggest_fingerings_with_profile(&inputs, hand, HandSpanProfile::Standard);
            // Where the planner finds no playable fingering (wide or crowded chords), the
            // animation still needs a finger: by place in the chord, thumb toward the middle.
            let rank = |i: usize| {
                // Notes are sorted by onset, then pitch: the chord is a contiguous run.
                let onset = notes[i].2.start;
                let first = notes.partition_point(|n| n.2.start < onset);
                let size = notes[first..].partition_point(|n| n.2.start == onset);
                let spread = if size > 1 { ((i - first) * 4) / (size - 1) } else { 0 };
                (if hand == FingeringHand::Right { spread + 1 } else { 5 - spread }) as u8
            };
            for (i, ((track, index, n), suggestion)) in notes.iter().zip(suggestions).enumerate() {
                let own_part = matches!(crate::hands::part(&self.config, &self.note_hands, *track, *index), PracticePart::LeftHand | PracticePart::RightHand);
                let finger = saved(*track, n).or(suggestion.map(|s| s.finger)).or_else(|| Some(rank(i)));
                if let Some(finger) = finger.filter(|_| !own_part || saved(*track, n).is_none()) {
                    out.push(PlannedFinger { track: *track, index: *index, part: label.into(), finger });
                }
            }
        }
        Ok(out)
    }
}
