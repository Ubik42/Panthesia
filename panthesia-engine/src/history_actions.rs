//! Post-load history work: archive reads and note matching run in the task pool.
use crate::{
    Player,
    history_loading::{Context, Song},
    load_pipeline::Watch,
    performance_archive::{self, Archive, Reference},
};
use serde_json::Value;

#[derive(Clone, Copy)]
pub(crate) enum Action {
    Open {
        restore: bool,
    },
    ScoreReview,
    PracticeRange {
        reference: usize,
        before: u8,
        after: u8,
    },
}
impl Action {
    pub fn restore(self) -> bool {
        match self {
            Self::Open { restore } => restore,
            _ => true,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Open { .. } => "恢复历史练习",
            Self::ScoreReview => "准备历史谱面批阅",
            Self::PracticeRange { .. } => "准备历史问题重练",
        }
    }
    pub fn validate(self, player: &Player) -> Result<(), String> {
        if let Self::PracticeRange { before, after, .. } = self {
            if before > 8 || after > 8 {
                return Err("重练前后最多各选 8 小节".into());
            }
        }
        if matches!(self, Self::Open { .. }) {
            return Ok(());
        }
        if player.state.recording
            || player.routine.is_some()
            || player.ladder.as_ref().is_some_and(|l| l.active)
            || ["playing", "countIn"].contains(&player.state.status.as_str())
            || !player.state.pressed.is_empty()
        {
            return Err(match self {
                Self::ScoreReview => "请先暂停演奏、停止录音并结束计划或阶梯，再批阅历史谱面",
                _ => "请先暂停演奏、停止录音并结束计划或阶梯，再从历史选择重练",
            }
            .into());
        }
        Ok(())
    }
}
pub(crate) struct Range {
    pub reference: usize,
    pub before: u8,
    pub after: u8,
    pub target: Reference,
    pub candidates: Vec<usize>,
    pub kind: String,
}
impl Range {
    pub fn prepare(
        notes: &[crate::PracticeNote],
        archive: &Archive,
        reference: usize,
        before: u8,
        after: u8,
    ) -> Result<Self, String> {
        let target = archive
            .references
            .get(reference)
            .ok_or("这次演奏没有所选参考音，请重新读取记录")?
            .clone();
        let candidates = notes
            .iter()
            .filter(|n| {
                n.track_id == target.track
                    && n.note == target.pitch
                    && (n.start.as_secs_f64() - target.song_time).abs() < 0.001
            })
            .map(|n| n.index)
            .collect();
        let kind = archive
            .judgments
            .as_ref()
            .map(|rows| {
                rows.iter()
                    .find(|r| r.reference == Some(reference))
                    .map(|r| r.kind.as_str())
                    .unwrap_or("pending")
            })
            .unwrap_or("approximate")
            .into();
        Ok(Self {
            reference,
            before,
            after,
            target,
            candidates,
            kind,
        })
    }
}
enum Work {
    Open,
    Review(crate::history_review::HistoryScoreReview),
    Range(Range),
}
pub(crate) struct Prepared {
    work: Work,
    watch: Option<Watch>,
}
pub(crate) struct Input {
    archive: Archive,
    watch: Watch,
    source: crate::history_source::HistorySource,
}
pub(crate) struct Read {
    pub value: Value,
    watch: Watch,
}
impl Read {
    #[allow(dead_code)]
    pub fn prepare(data: &std::path::Path, context: &Context) -> Result<Self, String> {
        Self::prepare_checked(data, context, || Ok(()), false)
    }
    pub fn prepare_checked(
        data: &std::path::Path,
        context: &Context,
        check: impl Fn() -> Result<(), String>,
        with_source: bool,
    ) -> Result<Self, String> {
        check()?;
        let watch = Watch::capture(&performance_archive::path(
            data,
            &context.content_id,
            &context.id,
        ))?;
        let (archive, revision) =
            performance_archive::read_versioned(data, &context.content_id, &context.id)?;
        check()?;
        let review = archive.expression_review_rows();
        check()?;
        let value = if with_source {
            serde_json::to_value(performance_archive::HistoryPerformanceRead {
                archive,
                source: crate::history_source::HistorySource::from_context(context, Some(revision)),
                expression_review: review,
            })
            .map_err(|error| error.to_string())?
        } else {
            let mut value = serde_json::to_value(archive).map_err(|error| error.to_string())?;
            value["expressionReview"] = serde_json::json!(review);
            value
        };
        check()?;
        watch.check()?;
        Ok(Self { value, watch })
    }
    pub fn check(&self) -> Result<(), String> {
        self.watch.check()
    }
}
impl Input {
    pub fn read(data: &std::path::Path, context: &Context) -> Result<Option<Self>, String> {
        if matches!(context.action, Action::Open { .. }) {
            return Ok(None);
        }
        let watch = Watch::capture(&performance_archive::path(
            data,
            &context.content_id,
            &context.id,
        ))?;
        let (archive, revision) =
            performance_archive::read_versioned(data, &context.content_id, &context.id)?;
        if let Some(expected) = &context.expected {
            expected.check_context(context)?;
            expected.check_performance(&revision)?;
        }
        if let Action::PracticeRange { reference, .. } = context.action {
            archive
                .references
                .get(reference)
                .ok_or("这次演奏没有所选参考音，请重新读取记录")?;
        }
        watch.check()?;
        Ok(Some(Self {
            archive,
            watch,
            source: crate::history_source::HistorySource::from_context(context, Some(revision)),
        }))
    }
}
impl Prepared {
    pub fn open() -> Self {
        Self {
            work: Work::Open,
            watch: None,
        }
    }
    #[cfg(test)]
    pub fn prepare(input: Option<Input>, context: &Context, song: &Song) -> Result<Self, String> {
        Self::prepare_checked(input, context, song, || Ok(()))
    }
    pub fn prepare_checked(
        input: Option<Input>,
        context: &Context,
        song: &Song,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        if matches!(context.action, Action::Open { .. }) {
            return Ok(Self::open());
        }
        let Input {
            archive,
            watch,
            source,
        } = input.ok_or("历史演奏准备资料缺失，请重新读取记录")?;
        let notes=song.practice_notes(context)?;
        let work = match context.action {
            Action::ScoreReview => {
                let mut review = performance_archive::prepare_score_review(
                    &notes,
                    &archive,
                    performance_archive::context_note_velocity_limit(
                        context.session.context.as_ref(),
                    ),
                    context.recorded_at,
                    &check,
                )?;
                review.source = Some(source);
                Work::Review(review)
            }
            Action::PracticeRange {
                reference,
                before,
                after,
            } => Work::Range(Range::prepare(
                &notes,
                &archive,
                reference,
                before,
                after,
            )?),
            Action::Open { .. } => unreachable!(),
        };
        watch.check()?;
        check()?;
        Ok(Self {
            work,
            watch: Some(watch),
        })
    }
    pub fn check(&self) -> Result<(), String> {
        if let Some(watch) = &self.watch {
            watch.check()?;
        }
        Ok(())
    }
    pub fn finish(
        self,
        player: &mut Player,
        context: &Context,
        opened: Value,
    ) -> Result<Value, String> {
        if opened["restoreWarning"].as_str().is_some() {
            return Ok(opened);
        }
        match self.work {
            Work::Open => Ok(opened),
            Work::Review(mut review) => {
                if let Some(source) = &mut review.source {
                    source.conditions_revision = player
                        .history_source(&context.content_id, &context.id)?
                        .conditions_revision;
                }
                player.finish_history_score_review(&context.content_id, &context.id, review)
            }
            Work::Range(range) => {
                player.finish_history_practice_range(&context.content_id, &context.id, range)
            }
        }
    }
}
