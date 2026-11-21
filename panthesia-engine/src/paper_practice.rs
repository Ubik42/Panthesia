use crate::{preferences, score_attachments, Player};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperPracticeRequest {
    pub content_id: String,
    pub book: String,
    pub measure: usize,
    pub proof: String,
    pub start: usize,
    pub end: usize,
    pub name: String,
    pub notes: String,
    pub speed: f64,
    pub rounds: usize,
    #[serde(default)]
    pub confirm_only: bool,
}
pub type Request = PaperPracticeRequest;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperPracticeReview {
    pub proof: String,
    pub content_id: String,
    pub book: String,
    pub measure: usize,
    pub page: usize,
    pub measures: usize,
    pub start: usize,
    pub end: usize,
    pub name: String,
    pub speed: f64,
    pub rounds: usize,
    pub settings: preferences::SessionSettings,
}
impl Player {
    fn paper_practice_settings(&self) -> preferences::SessionSettings {
        preferences::SessionSettings {
            tracks: self.config.practice_track_setup(),
            parts: self
                .config
                .tracks
                .iter()
                .map(|t| (t.track_id, t.practice_part))
                .collect(),
            mode: Some(self.state.mode.clone()),
            count_in: self.state.count_in,
            metronome: self.state.metronome,
            latency: self.state.latency,
            rounds: self.state.rounds,
            hands: self.state.hands.clone(),
        }
    }
    pub(super) fn preview_paper_practice(
        &self,
        cid: &str,
        book: &str,
        measure: usize,
    ) -> Result<Value, String> {
        let file = self
            .file
            .as_ref()
            .filter(|f| f.content_id == cid)
            .ok_or("曲目已切换，请重新打开谱页")?;
        let papers = score_attachments::list(&self.data, cid)?;
        let attachment = papers["attachments"]
            .as_array()
            .and_then(|v| v.iter().find(|a| a["id"].as_str() == Some(book)))
            .ok_or("谱面版本已移除")?;
        let mapping: score_attachments::Mapping =
            serde_json::from_value(attachment["mapping"].clone())
                .map_err(|_| "请先保存谱页小节对应")?;
        let grid = self.grid_signature();
        if mapping.grid != grid || measure == 0 || measure > file.musical_time.measures.len() {
            return Err("小节网格已变化，请重新确认谱页对应".into());
        }
        let anchor = mapping
            .anchors
            .iter()
            .find(|a| a.measure == measure)
            .ok_or("此小节对应已移除，请重新选择")?;
        let end = mapping
            .anchors
            .iter()
            .find(|a| a.measure > measure)
            .map_or(measure, |a| a.measure - 1)
            .min(file.musical_time.measures.len());
        let settings = self.paper_practice_settings();
        let proof = blake3::hash(
            &serde_json::to_vec(&json!([
                cid,
                book,
                measure,
                grid,
                attachment["name"],
                mapping,
                settings,
                self.state.speed,
                self.saved_hints()?
            ]))
            .map_err(|e| e.to_string())?,
        )
        .to_hex()
        .to_string();
        serde_json::to_value(PaperPracticeReview {
            proof, content_id: cid.into(), book: book.into(), measure, page: anchor.page,
            measures: file.musical_time.measures.len(), start: measure, end,
            name: format!("纸谱第 {} 页 · {}～{} 小节", anchor.page, measure, end),
            speed: self.state.speed, rounds: if self.state.rounds == 0 { 3 } else { self.state.rounds }, settings,
        }).map_err(|error| error.to_string())
    }
    pub(super) fn save_paper_practice(&mut self, r: Request) -> Result<Value, String> {
        if r.proof.len() != 64 || !r.proof.bytes().all(|byte| byte.is_ascii_hexdigit()) ||
            r.name.chars().count() > 80 || r.notes.len() > 8192 {
            return Err("练习段保存编号或文字无效".into());
        }
        let hash = blake3::hash(
            &serde_json::to_vec(&json!([&r.proof, r.start, r.end, r.name.trim(), &r.notes, r.speed, r.rounds]))
                .map_err(|error| error.to_string())?,
        ).to_hex().to_string();
        let id = format!("paper-practice-{hash}");
        if r.confirm_only {
            // Receipt reconciliation must never create a second passage or reapply old settings.
            let saved = self.preferences.passages.get(&r.content_id).and_then(|rows| rows.iter().find(|row| row.id == id));
            return Ok(json!({"id":id,"saved":false,"existing":saved.is_some(),"found":saved.is_some(),
                "changed":saved.is_some_and(|row| row.name != r.name.trim() || row.start != r.start || row.end != r.end ||
                    row.notes != r.notes || row.speed != r.speed || row.settings.rounds != r.rounds)}));
        }
        let review = self.preview_paper_practice(&r.content_id, &r.book, r.measure)?;
        if review["proof"].as_str() != Some(&r.proof) {
            return Err("谱页对应、指法或练习条件已改变，请重新核对后保存".into());
        }
        if r.start == 0
            || r.start > r.measure
            || r.end < r.measure
            || r.end > review["measures"].as_u64().unwrap_or(0) as usize
            || r.start > r.end
        {
            return Err("练习范围需包含所选纸谱小节，且不能超出曲目".into());
        }
        if r.name.trim().is_empty()
            || r.name.chars().count() > 80
            || r.notes.len() > 8192
            || !r.speed.is_finite()
            || !(0.25..=2.).contains(&r.speed)
            || !(1..=99).contains(&r.rounds)
        {
            return Err("名称、小节、速度、重复次数或备注无效，未保存".into());
        }
        let mut prefs = self.preferences.clone();
        let rows = prefs.passages.entry(r.content_id.clone()).or_default();
        let mut settings = self.paper_practice_settings();
        settings.rounds = r.rounds;
        let preset = preferences::PassagePreset { practice: Some(self.passage_practice_snapshot()?),
            id: id.clone(),
            name: r.name.trim().into(),
            start: r.start,
            end: r.end,
            notes: r.notes,
            speed: r.speed,
            settings,
            grid: Some(self.grid_signature()),
            score_range: None,
            precise_range: None,
        };
        if let Some(old) = rows.iter().find(|p| p.id == id) {
            if !crate::finger_practice::same_passage_content(old, &preset)? {
                return Err("同一纸谱练习段已修改，请保留现有内容或改变新段名称".into());
            }
            return Ok(json!({"saved":false,"existing":true,"id":id}));
        }
        if rows.len() >= 200 {
            return Err("每首曲目最多保存 200 个练习段".into());
        }
        rows.push(preset);
        prefs.save(&self.preferences_path)?;
        self.preferences = prefs;
        Ok(json!({"saved":true,"existing":false,"id":id}))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Command, ExerciseSpec};
    use std::path::PathBuf;
    #[test]
    fn paper_practice_keeps_conditions_deduplicates_and_rejects_stale() {
        let data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/cycle196-unit")
            .join(format!(
                "{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        let mut p = Player::new(data.clone(), PathBuf::new(), true);
        p.command(Command::Generate {
            spec: ExerciseSpec::default(),
        })
        .unwrap();
        let cid = p.file.as_ref().unwrap().content_id.clone();
        let papers = score_attachments::add(
            &data,
            &cid,
            "教师谱",
            b"\x89PNG\r\n\x1a\nfirst".to_vec(),
            None,
        )
        .unwrap();
        let book = papers["active"].as_str().unwrap().to_owned();
        let mapping = score_attachments::Mapping {
            grid: p.grid_signature(),
            enabled: false,
            anchors: vec![score_attachments::PageAnchor {
                measure: 1,
                page: 1,
                region: Some(score_attachments::PageRegion {
                    x: 0.1,
                    y: 0.2,
                    width: 0.4,
                    height: 0.1,
                }),
            }],
        };
        score_attachments::set_mapping(&data, &cid, &book, Some(mapping.clone())).unwrap();
        let review = p.preview_paper_practice(&cid, &book, 1).unwrap();
        let r = Request {
            confirm_only: false,
            content_id: cid.clone(),
            book: book.clone(),
            measure: 1,
            proof: review["proof"].as_str().unwrap().into(),
            start: 1,
            end: 1,
            name: "纸谱慢练".into(),
            notes: "连奏".into(),
            speed: 0.6,
            rounds: 3,
        };
        let before = p.snapshot();
        let original = p.preferences_path.clone();
        p.preferences_path = data.clone();
        assert!(p.save_paper_practice(r.clone()).is_err());
        assert!(!p.preferences.passages.contains_key(&cid));
        p.preferences_path = original;
        let saved = p.save_paper_practice(r.clone()).unwrap();
        assert_eq!(p.snapshot().position, before.position);
        assert_eq!(p.snapshot().speed, before.speed);
        assert_eq!(p.save_paper_practice(r.clone()).unwrap()["existing"], true);
        assert_eq!(p.preferences.passages[&cid].len(), 1);
        assert_eq!(p.preferences.passages[&cid][0].speed, 0.6);
        assert_eq!(p.preferences.passages[&cid][0].settings.rounds, 3);
        let mut changed = mapping.clone();
        changed.anchors[0].region.as_mut().unwrap().x = 0.2;
        score_attachments::set_mapping(&data, &cid, &book, Some(changed)).unwrap();
        assert!(p.save_paper_practice(r.clone()).is_err());
        score_attachments::set_mapping(&data, &cid, &book, Some(mapping)).unwrap();
        p.command(Command::OpenPassage {
            id: saved["id"].as_str().unwrap().into(),
        })
        .unwrap();
        assert_eq!(p.state.speed, 0.6);
        assert_eq!(p.state.rounds, 3);
        assert!(p.state.passage.is_some());
        assert!(p.save_paper_practice(r).is_err());
    }
}
