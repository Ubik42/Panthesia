//! Calendar projections use the immutable history snapshot, including retained timing evidence.
use panthesia_core::practice_history::{
    PracticeHistoryStore, PracticeTimeEntry, SongPracticeHistory,
};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInterval {
    pub content_id: String,
    pub title: String,
    pub save_id: String,
    pub from: u64,
    pub to: u64,
    pub running_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSave {
    pub content_id: String,
    pub save_id: String,
    pub saved_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCalendar {
    pub from: u64,
    pub to: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    pub intervals: Vec<CalendarInterval>,
    pub saves: Vec<CalendarSave>,
    pub total_ms: u64,
    pub legacy_sessions: usize,
    pub legacy_timed_ms: u64,
    pub untracked_ms: u64,
    pub earliest_interval_at: Option<u64>,
    pub coverage: &'static str,
}

pub(super) fn read(
    history: &PracticeHistoryStore,
    from: u64,
    to: u64,
    content_id: Option<&str>,
    check: impl Fn() -> Result<(), String>,
) -> Result<HistoryCalendar, String> {
    if from >= to
        || to > 9_000_000_000_000_000
        || to - from > 366 * 86_400_000
        || content_id.is_some_and(|id| id.trim().is_empty() || id.len() > 160)
    {
        return Err("练习日历需选择不超过 366 天的有效日期范围".into());
    }
    check()?;
    let mut calendar = HistoryCalendar {
        from,
        to,
        content_id: content_id.map(str::to_owned),
        intervals: Vec::new(),
        saves: Vec::new(),
        total_ms: 0,
        legacy_sessions: 0,
        legacy_timed_ms: 0,
        untracked_ms: 0,
        earliest_interval_at: None,
        coverage: "saved-running-ledger",
    };
    // A single-piece visit reads its ledger directly instead of walking every other piece.
    let ledger: Box<dyn Iterator<Item = (&str, &BTreeMap<String, PracticeTimeEntry>)> + '_> =
        if let Some(id) = content_id {
            Box::new(
                history
                    .time_ledger()
                    .get(id)
                    .map(|entries| (id, entries))
                    .into_iter(),
            )
        } else {
            Box::new(
                history
                    .time_ledger()
                    .iter()
                    .map(|(id, entries)| (id.as_str(), entries)),
            )
        };
    for (cid, entries) in ledger {
        check()?;
        let title = history
            .song(cid)
            .map_or("练习记录", |song| song.display_name.as_str());
        for (id, entry) in entries {
            check()?;
            if entry.saved_at_unix_ms >= from && entry.saved_at_unix_ms < to {
                calendar.saves.push(CalendarSave {
                    content_id: cid.into(),
                    save_id: id.clone(),
                    saved_at: entry.saved_at_unix_ms,
                });
                calendar.untracked_ms = calendar.untracked_ms.saturating_add(entry.untracked_ms);
            }
            if calendar.saves.len() > 100_000 {
                return Err("该日期范围的保存记录过多，请缩小日期范围".into());
            }
            if calendar.intervals.len() + calendar.saves.len() > 100_000 {
                return Err("该日期范围的计时记录过多，请缩小日期范围".into());
            }
            for slice in &entry.slices {
                check()?;
                calendar.earliest_interval_at = Some(
                    calendar
                        .earliest_interval_at
                        .map_or(slice.from, |old| old.min(slice.from)),
                );
                let ms = slice.intersection_ms(from, to);
                if ms > 0 {
                    calendar.total_ms = calendar.total_ms.saturating_add(ms);
                    calendar.intervals.push(CalendarInterval {
                        content_id: cid.into(),
                        title: title.into(),
                        save_id: id.clone(),
                        from: slice.from.max(from),
                        to: slice.to.min(to),
                        running_ms: ms,
                    });
                }
                if calendar.intervals.len() + calendar.saves.len() > 100_000 {
                    return Err("该日期范围的计时记录过多，请缩小日期范围".into());
                }
            }
        }
    }
    let songs: Box<dyn Iterator<Item = (&str, &SongPracticeHistory)> + '_> =
        if let Some(id) = content_id {
            Box::new(history.song(id).map(|song| (id, song)).into_iter())
        } else {
            Box::new(history.iter_songs())
        };
    for (cid, song) in songs {
        check()?;
        let ledger = history.time_ledger().get(cid);
        for session in &song.sessions {
            check()?;
            if session.recorded_at_unix_ms >= from
                && session.recorded_at_unix_ms < to
                && !ledger.is_some_and(|entries| entries.contains_key(&session.stable_id()))
            {
                calendar.legacy_sessions += 1;
                calendar.legacy_timed_ms = calendar
                    .legacy_timed_ms
                    .saturating_add(session.playing_ms.unwrap_or(0));
            }
        }
    }
    check()?;
    Ok(calendar)
}
