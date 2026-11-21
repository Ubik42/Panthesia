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
    
    
}
