//! Replaced musical data is released away from MIDI scheduling.
use std::{sync::mpsc, thread};

type Retired = Box<dyn Send>;

#[derive(Clone)]
pub(super) struct Reclaimer(mpsc::Sender<Retired>);
impl Reclaimer {
    pub(super) fn start() -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel::<Retired>();
        thread::Builder::new()
            .name("neothesia-musical-data-release".into())
            .spawn(move || {
                while let Ok(value) = receiver.recv() {
                    drop(value);
                }
            })
            .map_err(|error| format!("无法启动曲目资源整理：{error}"))?;
        Ok(Self(sender))
    }

    pub(super) fn release<T: Send + 'static>(&self, value: T) {
        // This receiver only destroys plain musical data, never drivers or native resources.
        // It drains at shutdown after the last playback-side sender has gone away.
        let _ = self.0.send(Box::new(value));
    }
}

impl crate::Player {
    pub(super) fn retire<T: Send + 'static>(&self, value: T) {
        if let Some(reclaimer) = &self.reclaimer {
            reclaimer.release(value);
        }
    }
}
