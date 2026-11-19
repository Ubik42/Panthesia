//! A keyboard switch keeps the old live port until the new connection is ready.
use crate::*;
impl Engine {
    pub(super) fn change_input(&self, name: Option<String>) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        self.tasks.run("连接 MIDI 键盘", None, move |token| {
            let _pending = engine.pending_operation()?;
            token.stage("connectingInput")?;
            token.check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::InputContext {
                    name: name.clone(),
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            let revision = receiver.recv().map_err(|_| "键盘连接条件通道已关闭")??;
            let prepared = engine.input.prepare(name, token.clone())?;
            token.check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::InputCommit {
                    revision,
                    prepared,
                    token,
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            receiver.recv().map_err(|_| "键盘设置保存结果通道已关闭")?
        })
    }
}
impl Player {
    pub(super) fn input_context(&self, name: Option<&str>) -> Result<u64, String> {
        if name != self.state.input.as_deref() && !self.recorder.is_recording() && !self.state.saved
        {
            let score = self.matcher.snapshot();
            if score.matched_notes + score.missed_notes + score.wrong_notes > 0 {
                return Err("本轮结果尚未保存，请先保存本轮结果，再更换 MIDI 输入".into());
            }
        }
        Ok(self.input_revision)
    }
    pub(super) fn install_input(
        &mut self,
        revision: u64,
        prepared: input_runtime::Prepared,
        token: &background_tasks::TaskToken,
    ) -> Result<serde_json::Value, String> {
        // Process already-arrived notes before deciding whether a different input
        // would cross an unsaved attempt. This also preserves the recording tail.
        for _ in 0..4096 {
            match self.input_rx.try_recv() {
                Ok(event) => self.input_event(event),
                Err(_) => break,
            }
        }
        self.input_context(prepared.name.as_deref())?;
        if self.input_revision != revision {
            return Err("键盘选择已改变，请重新选择".into());
        }
        token.begin_commit()?;
        let generation = prepared.generation;
        let name = prepared.name.clone();
        self.panic();
        prepared.activate()?;
        self.input_generation = generation;
        self.input_revision = self.input_revision.wrapping_add(1);
        self.input_disconnects = self
            .input_client
            .as_ref()
            .and_then(input_runtime::Client::status)
            .map_or(self.input_disconnects, |status| status.disconnects);
        if matches!(self.state.status.as_str(), "playing" | "countIn") {
            self.state.status = "paused".into();
            self.state.count_remaining = 0.;
        }
        self.state.input = name.clone();
        self.preferences.input = name;
        self.preferences.input_configured = true;
        self.clear_input_error();
        self.restore_latency();
        self.persist()?;
        Ok(serde_json::json!({"ok":true}))
    }
    pub(super) fn input_event(&mut self, event: input_runtime::Event) {
        if self
            .input_client
            .as_ref()
            .is_some_and(|client| !client.accepts(&event, self.input_generation))
        {
            return;
        }
        self.midi(event.bytes());
    }
    pub(super) fn poll_input_owner(&mut self) {
        let Some(status) = self
            .input_client
            .as_ref()
            .and_then(input_runtime::Client::status)
        else {
            return;
        };
        if status.selection != self.input_generation {
            return;
        }
        if status.disconnects != self.input_disconnects {
            self.input_disconnects = status.disconnects;
            self.panic();
            self.state.status = "paused".into();
            self.state.count_remaining = 0.;
        }
        if let Some(error) = status.error {
            self.report_input_error(error);
        } else if status.connected || self.state.input.is_none() {
            self.clear_input_error();
        }
    }
    pub(super) fn input_connected(&self) -> bool {
        if let Some(client) = &self.input_client {
            client.connected(self.input_generation)
        } else {
            self.input_connection.is_some()
        }
    }
}
