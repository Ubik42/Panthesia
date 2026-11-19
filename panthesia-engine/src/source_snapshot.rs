//! Capture shared roots on playback; select and serialize one source on its worker.
use crate::{Player, preferences::Preferences};
use panthesia_core::practice_history::SongPracticeHistory;
use serde::{Serialize, Serializer};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

pub(crate) struct SourceSnapshot {
    pub preferences: Preferences,
    content_id: String,
    history: panthesia_core::practice_history::PracticeHistoryStore,
}
impl SourceSnapshot {
    pub fn capture(player: &Player, cid: &str) -> Self {
        Self {
            preferences: player.preferences.clone(),
            content_id: cid.into(),
            history: player.history.clone(),
        }
    }
    fn scoped_preferences(&self) -> Preferences {
        let cid = &self.content_id;
        let mut preferences = Preferences {
            exercise: self.preferences.exercise,
            hand_span_defaults: self.preferences.hand_span_defaults.clone(),
            ..Default::default()
        };
        macro_rules! copy_song {
            ($($field:ident),*) => { $(if let Some(value)=self.preferences.$field.get(cid) { preferences.$field.insert(cid.clone(),value.clone()); })* };
        }
        copy_song!(
            passages,
            songs,
            score_versions,
            exercise_layouts,
            track_sounds,
            track_appearances,
            fingering_profiles,
            hand_span_profiles
        );
        preferences
    }
    fn history_header(&self) -> Option<SongPracticeHistory> {
        self.history
            .song(&self.content_id)
            .map(|h| SongPracticeHistory {
                display_name: h.display_name.clone(),
                setup: h.setup.clone(),
                library: h.library.clone(),
                sessions: Vec::new(),
            })
    }
    pub fn reader(&self, data: &Path, cid: &str) -> Player {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut reader = Player::empty(
            data.join(format!("readonly-source-{nonce}")),
            PathBuf::new(),
            true,
        );
        reader.restoring = true;
        reader.data = data.into();
        reader.preferences = self.scoped_preferences();
        if let Some(history) = self.history_header() {
            reader
                .history
                .replace_snapshot(BTreeMap::from([(cid.into(), history)]));
        }
        reader
    }
}
impl Serialize for SourceSnapshot {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Preserve the former scoped fingerprint structure and exclude unrelated songs/sessions.
        #[derive(Serialize)]
        struct Scoped {
            preferences: Preferences,
            history: Option<SongPracticeHistory>,
        }
        Scoped {
            preferences: self.scoped_preferences(),
            history: self.history_header(),
        }
        .serialize(serializer)
    }
}
