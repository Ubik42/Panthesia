use crate::Player;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackAppearance {
    pub name: Option<String>,
    pub color: Option<String>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub hand_colors: Option<BTreeMap<String, PartColor>>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PartColor { pub color:Option<String>, pub visible:bool }
fn valid_color(color:&Option<String>)->bool {
    color.as_ref().is_none_or(|c|c.len()==7&&c.starts_with('#')&&c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit))
}
impl TrackAppearance {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.as_ref().is_some_and(|n| {
            n.trim().is_empty() || n.chars().count() > 80 || n.chars().any(char::is_control)
        }) {
            return Err("音轨名称须为 1–80 个字符，不能包含换行或控制符".into());
        }
        if self.color.as_ref().is_some_and(|c| {
            c.len() != 7
                || !c.starts_with('#')
                || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        }) {
            return Err("音轨颜色无效".into());
        }
        if self.hand_colors.as_ref().is_some_and(|colors|colors.len()>3||colors.iter().any(|(key,value)|!matches!(key.as_str(),"left"|"right"|"other")||!valid_color(&value.color))) {
            return Err("声部配色无效".into());
        }
        Ok(())
    }
}
impl Player {
    pub(crate) fn track_appearances(&self) -> BTreeMap<usize, TrackAppearance> {
        let mut map = self
            .file
            .as_ref()
            .and_then(|f| self.preferences.track_appearances.get(&f.content_id))
            .cloned()
            .unwrap_or_default();
        map.retain(|id, a| {
            a.validate().is_ok()
                && self.file.as_ref().is_some_and(|f| {
                    f.tracks
                        .iter()
                        .any(|t| t.track_id == *id && !t.notes.is_empty())
                })
        });
        map
    }
    pub(crate) fn set_track_appearance(
        &mut self,
        id: usize,
        appearance: Option<TrackAppearance>,
    ) -> Result<serde_json::Value, String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        if !file
            .tracks
            .iter()
            .any(|t| t.track_id == id && !t.notes.is_empty())
        {
            return Err("找不到音轨".into());
        }
        let cid = file.content_id.clone();
        let previous=self.preferences.track_appearances.get(&cid).and_then(|m|m.get(&id)).cloned();
        let appearance = appearance.map(|mut a| {
            if a.hand_colors.is_none() { a.hand_colors=previous.as_ref().and_then(|p|p.hand_colors.clone()); }
            if let Some(colors)=a.hand_colors.as_mut() {
                if let Some(track)=self.config.tracks.iter().find(|t|t.track_id==id) {
                    colors.insert(crate::hands::label(track.practice_part).into(),PartColor{color:a.color.clone(),visible:track.visible});
                }
            }
            a.name = a.name.map(|n| n.trim().to_string());
            a.color = a.color.map(|c| c.to_ascii_lowercase());
            a
        });
        if let Some(a) = &appearance {
            a.validate()?;
        }
        let old = self.preferences.clone();
        let rows = self
            .preferences
            .track_appearances
            .entry(cid.clone())
            .or_default();
        if let Some(a) = appearance.filter(|a| a.name.is_some() || a.color.is_some() || a.hand_colors.as_ref().is_some_and(|m|!m.is_empty())) {
            rows.insert(id, a);
        } else {
            rows.remove(&id);
        }
        if rows.is_empty() {
            self.preferences.track_appearances.remove(&cid);
        }
        if let Err(e) = self.preferences.save(&self.preferences_path) {
            self.preferences = old;
            return Err(e);
        }
        Ok(serde_json::json!({"ok":true}))
    }
    /// Remember display choices separately for each hand; the same song remains one asset.
    pub(crate) fn switch_part_color(&mut self,id:usize,next:panthesia_core::practice::PracticePart,visible:bool)->Result<bool,String> {
        let cid=self.file.as_ref().ok_or("请先选择曲目")?.content_id.clone();
        let track=self.config.tracks.iter().find(|t|t.track_id==id).ok_or("找不到声部")?;
        let old=crate::hands::label(track.practice_part);
        let key=crate::hands::label(next);
        let a=self.preferences.track_appearances.entry(cid).or_default().entry(id).or_default();
        let colors=a.hand_colors.get_or_insert_with(BTreeMap::new);
        colors.insert(old.into(),PartColor{color:a.color.clone(),visible:track.visible});
        let value=if old==key {PartColor{color:a.color.clone(),visible}} else {colors.get(key).cloned().unwrap_or(PartColor{color:None,visible})};
        a.color=value.color.clone();colors.insert(key.into(),value.clone());
        Ok(value.visible)
    }
    pub(crate) fn decorate_tracks(&self, v: &mut serde_json::Value) {
        let map = self.track_appearances();
        if let Some(tracks) = v["tracks"].as_array_mut() {
            for t in tracks {
                if let Some(a) = t["id"].as_u64().and_then(|id| map.get(&(id as usize))) {
                    if let Some(name) = &a.name {
                        t["name"] = serde_json::json!(name)
                    }
                    t["color"] = serde_json::json!(a.color);
                    t["appearanceCustom"] = serde_json::json!(true);
                } else {
                    t["color"] = serde_json::Value::Null;
                    t["appearanceCustom"] = serde_json::json!(false);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Command;
    #[test]
    fn per_hand_colors_roundtrip_and_part_reset_preserve_finger_annotations() {
        use crate::Command;
        let (mut p,_,_)=crate::history_loading::tests::seeded(true,false);
        let file=p.file.as_ref().unwrap();let cid=file.content_id.clone();
        let id=file.tracks.iter().find(|t|!t.notes.is_empty()).unwrap().track_id;
        let fingers=(*p.fingers).clone();
        p.command(Command::Track{id,mode:"human".into(),part:"left".into(),visible:true}).unwrap();
        p.set_track_appearance(id,Some(TrackAppearance{name:None,color:Some("#123456".into()),hand_colors:None})).unwrap();
        p.command(Command::Track{id,mode:"auto".into(),part:"other".into(),visible:false}).unwrap();
        assert_eq!(p.track_appearances()[&id].color,None);
        p.set_track_appearance(id,Some(TrackAppearance{name:None,color:Some("#abcdef".into()),hand_colors:None})).unwrap();
        p.command(Command::Track{id,mode:"human".into(),part:"left".into(),visible:true}).unwrap();
        assert_eq!(p.track_appearances()[&id].color.as_deref(),Some("#123456"));
        assert!(p.config.tracks.iter().find(|t|t.track_id==id).unwrap().visible);
        p.command(Command::Track{id,mode:"auto".into(),part:"other".into(),visible:true}).unwrap();
        assert_eq!(p.track_appearances()[&id].color.as_deref(),Some("#abcdef"));
        assert!(!p.config.tracks.iter().find(|t|t.track_id==id).unwrap().visible);
        let bytes=p.export_piece_package(false).unwrap();let bytes:Vec<u8>=serde_json::from_value(bytes["bytes"].clone()).unwrap();
        let decoded=crate::piece_package::Package::decode(&bytes).unwrap();
        assert_eq!(decoded.manifest.track_appearances[&id],p.track_appearances()[&id]);
        let proof=p.hand_suggestion_proof().unwrap();
        p.command(Command::ResetPartSettings{content_id:cid,track:id,proof}).unwrap();
        assert_eq!(*p.fingers,fingers);
        assert!(p.track_appearances()[&id].color.is_none());
        assert!(!p.note_hands.keys().any(|(t,_)|*t==id));
    }
    #[test]
    fn source_names_appearance_persistence_and_no_transport_reset() {
        use panthesia_music::midly::{
            Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind,
        };
        let smf = Smf {
            header: Header {
                format: Format::SingleTrack,
                timing: Timing::Metrical(480.into()),
            },
            tracks: vec![vec![
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::TrackName("钢琴右手".as_bytes())),
                },
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Midi {
                        channel: 0.into(),
                        message: MidiMessage::NoteOn {
                            key: 60.into(),
                            vel: 80.into(),
                        },
                    },
                },
                TrackEvent {
                    delta: 480.into(),
                    kind: TrackEventKind::Midi {
                        channel: 0.into(),
                        message: MidiMessage::NoteOff {
                            key: 60.into(),
                            vel: 0.into(),
                        },
                    },
                },
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
                },
            ]],
        };
        let file = panthesia_music::MidiFile::from_smf("test", &smf).unwrap();
        assert_eq!(file.tracks[0].name.as_deref(), Some("钢琴右手"));
        let data = std::env::temp_dir().join(format!(
            "neothesia-appearance-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut p = Player::new(data.clone(), std::path::PathBuf::new(), true);
        p.command(Command::Generate {
            spec: Default::default(),
        })
        .unwrap();
        let id = p
            .file
            .as_ref()
            .unwrap()
            .tracks
            .iter()
            .find(|t| !t.notes.is_empty())
            .unwrap()
            .track_id;
        p.state.status = "playing".into();
        p.state.position = 0.25;
        let a = TrackAppearance {
            name: Some("旋律练习".into()),
            color: Some("#f1ad67".into()),
            hand_colors:None,
        };
        p.command(Command::TrackAppearance {
            id,
            appearance: Some(a.clone()),
        })
        .unwrap();
        assert_eq!(p.state.status, "playing");
        assert_eq!(p.state.position, 0.25);
        let song = p.command(Command::CurrentSong).unwrap();
        let t = song["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == id)
            .unwrap();
        assert_eq!(t["name"], "旋律练习");
        assert_eq!(t["color"], "#f1ad67");
        assert!(t["sourceName"].as_str().is_some());
        let mut reopened = Player::new(data, std::path::PathBuf::new(), true);
        reopened.restore();
        assert_eq!(reopened.track_appearances()[&id], a);
        p.state.status = "paused".into();
        let package = p.export_piece_package(false).unwrap();
        let bytes: Vec<u8> = serde_json::from_value(package["bytes"].clone()).unwrap();
        let decoded = crate::piece_package::Package::decode(&bytes).unwrap();
        assert_eq!(decoded.manifest.track_appearances[&id], a);
        let before = p.track_appearances();
        assert!(
            p.command(Command::TrackAppearance {
                id,
                appearance: Some(TrackAppearance {
                    name: Some("bad\nname".into()),
                    color: None, hand_colors:None
                })
            })
            .is_err()
        );
        assert!(
            p.command(Command::TrackAppearance {
                id,
                appearance: Some(TrackAppearance {
                    name: None,
                    color: Some("red".into()), hand_colors:None
                })
            })
            .is_err()
        );
        assert_eq!(p.track_appearances(), before);
        p.command(Command::TrackSound {
            id,
            sound: Some(crate::track_sound::TrackSound {
                volume: 35,
                pan: None,
                program: None,
            }),
        })
        .unwrap();
        let backup = p.practice_backup_snapshot(&Default::default()).unwrap();
        let import:Command=serde_json::from_value(serde_json::json!({"type":"applyPracticeBackup","backup":backup,"selection":{"plans":false,"records":false,"presets":true,"days":0},"policy":"backup"})).unwrap();
        p.command(Command::TrackAppearance {
            id,
            appearance: None,
        })
        .unwrap();
        assert!(p.track_appearances().is_empty());
        if let Command::ApplyPracticeBackup { backup, selection, policy } = import {
            p.apply_practice_backup(backup, selection, policy).unwrap();
        } else { panic!("expected practice backup import"); }
        assert_eq!(p.track_appearances()[&id], a);
        assert_eq!(p.track_sound_settings()[&id].volume, 35);
    }
}
