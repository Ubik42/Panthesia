//! Idempotent directory publication after a portable song file transaction.
use super::*;
impl SongRepository {
    pub(crate) fn apply_song_archive(
        &mut self,
        receipt_id: &str,
        receipt: &crate::portable_song::ImportReceipt,
    ) -> Result<(), String> {
        let marker = format!("song-import:{receipt_id}");
        if self
            .db
            .query_row("SELECT 1 FROM settings WHERE key=?1", [&marker], |_| Ok(()))
            .optional()
            .map_err(error)?
            .is_some()
        {
            return Ok(());
        }
        if !valid_id(receipt_id)
            || !["keep", "merge", "replace"].contains(&receipt.policy.as_str())
            || receipt.performances.is_empty()
            || receipt.performances.len() > 128
        {
            return Err("歌曲恢复回执无效".into());
        }
        let mut imported = RepertoireRegistry::default();
        imported
            .works
            .insert(receipt.work.id.clone(), receipt.work.clone());
        let mut assets = Vec::new();
        for performance in &receipt.performances {
            if !valid_id(&performance.content_id)
                || performance.label.chars().count() > 300
                || imported.performances.contains_key(&performance.content_id)
            {
                return Err("歌曲恢复演奏身份无效".into());
            }
            let cid = &performance.content_id;
            let path = crate::import_storage::planned_annotations(
                &self.data.join("library/assets/midi"),
                cid,
                cid,
                cid,
                |_| Ok(()),
            )?
            .0;
            let bytes = panthesia_core::utils::atomic_file::read_dependency(&path, 32_000_000)
                .map_err(error)?;
            if blake3::hash(&bytes).to_hex().as_str() != cid {
                return Err("歌曲恢复的演奏副本缺失或改变".into());
            }
            let annotations =
                panthesia_core::library::load_song_sidecar(&path, cid).map_err(error)?;
            imported.performances.insert(
                cid.clone(),
                PerformanceEdition {
                    content_id: cid.clone(),
                    work_id: receipt.work.id.clone(),
                    label: performance.label.clone(),
                    locations: vec![],
                },
            );
            let row = SongRow {
                arranger: None,
                id: format!("owned/{cid}"),
                title: annotations.metadata.title.unwrap_or_else(|| {
                    if performance.label.is_empty() {
                        receipt.work.title.clone()
                    } else {
                        performance.label.clone()
                    }
                }),
                composer: annotations
                    .metadata
                    .composer
                    .unwrap_or_else(|| receipt.work.composer.clone()),
                source: "我的曲目".into(),
                category: String::new(),
                license: String::new(),
                source_url: String::new(),
                path: path.clone(),
                content_id: Some(cid.clone()),
                tags: vec![],
                difficulty: None,
                rating: 0,
            };
            assets.push((cid.clone(), path, bytes.len() as i64, row));
        }
        for notation in &receipt.notations {
            let mut notation = notation.clone();
            let path = crate::notation_assets::resolve(&self.data, &notation.content_id)
                .ok_or("歌曲恢复的谱面副本缺失或改变")?;
            notation.path = path.to_string_lossy().into_owned();
            if imported
                .notations
                .insert(notation.id.clone(), notation)
                .is_some()
            {
                return Err("歌曲恢复包含重复谱面身份".into());
            }
        }
        imported.validate()?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(error)?;
        if receipt.policy == "replace" {
            tx.execute("INSERT INTO songs(id,title,composer,catalogue) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title,composer=excluded.composer,catalogue=excluded.catalogue",params![receipt.work.id,receipt.work.title,receipt.work.composer,receipt.work.catalogue]).map_err(error)?;
        } else {
            tx.execute("INSERT INTO songs(id,title,composer,catalogue) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING",params![receipt.work.id,receipt.work.title,receipt.work.composer,receipt.work.catalogue]).map_err(error)?;
        }
        for performance in &receipt.performances {
            if receipt.policy == "replace" {
                tx.execute("INSERT INTO performances(id,song_id,label,group_locked) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET song_id=excluded.song_id,label=excluded.label,group_locked=excluded.group_locked",params![performance.content_id,receipt.work.id,performance.label,performance.locked]).map_err(error)?;
            } else {
                tx.execute("INSERT INTO performances(id,song_id,label,group_locked) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING",params![performance.content_id,receipt.work.id,performance.label,performance.locked]).map_err(error)?;
            }
        }
        for (cid, path, size, row) in assets {
            tx.execute("INSERT INTO assets(content_id,path,bytes,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(content_id) DO UPDATE SET path=excluded.path",params![cid,path.to_string_lossy(),size,now()]).map_err(error)?;
            tx.execute("INSERT INTO locations(path_key,path,performance_id,last_seen) VALUES(?1,?2,?3,?4) ON CONFLICT(path_key) DO UPDATE SET path=excluded.path,performance_id=excluded.performance_id,last_seen=excluded.last_seen",params![key(&path),path.to_string_lossy(),cid,now()]).map_err(error)?;
            tx.execute("INSERT INTO catalog_rows(content_id,row_json) VALUES(?1,?2) ON CONFLICT(content_id) DO NOTHING",params![cid,serde_json::to_string(&row).map_err(error)?]).map_err(error)?;
        }
        for notation in imported.notations.values() {
            let sql = if receipt.policy == "replace" {
                "INSERT INTO notation_editions(id,document) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET document=excluded.document"
            } else {
                "INSERT INTO notation_editions(id,document) VALUES(?1,?2) ON CONFLICT(id) DO NOTHING"
            };
            tx.execute(
                sql,
                params![notation.id, serde_json::to_string(notation).map_err(error)?],
            )
            .map_err(error)?;
        }
        tx.execute(
            "DELETE FROM songs WHERE NOT EXISTS(SELECT 1 FROM performances WHERE song_id=songs.id)",
            [],
        )
        .map_err(error)?;
        tx.execute(
            "INSERT INTO settings(key,value) VALUES(?1,'applied')",
            [marker],
        )
        .map_err(error)?;
        tx.commit().map_err(error)
    }
}
