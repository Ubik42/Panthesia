//! Fixed request lanes keep status and control independent of business uploads.
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    thread,
};
use tiny_http::{Header, Request, Response};

pub struct Lane {
    sender: mpsc::SyncSender<Request>,
}
impl Lane {
    pub fn new(
        name: &str,
        workers: usize,
        capacity: usize,
        activity: Arc<AtomicUsize>,
        handler: impl Fn(Request) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel::<Request>(capacity);
        let receiver = Arc::new(Mutex::new(receiver));
        let handler = Arc::new(handler);
        for index in 0..workers {
            let receiver = receiver.clone();
            let handler = handler.clone();
            let activity = activity.clone();
            thread::Builder::new()
                .name(format!("{name}-{index}"))
                .spawn(move || {
                    loop {
                        let request = match receiver.lock().unwrap().recv() {
                            Ok(request) => request,
                            Err(_) => break,
                        };
                        let _active = ActiveRequest::new(activity.clone());
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            handler(request)
                        }));
                    }
                })
                .map_err(|error| error.to_string())?;
        }
        Ok(Self { sender })
    }
    pub fn dispatch(&self, request: Request) {
        if let Err(error) = self.sender.try_send(request) {
            let request = match error {
                mpsc::TrySendError::Full(request) | mpsc::TrySendError::Disconnected(request) => {
                    request
                }
            };
            let origin = request
                .headers()
                .iter()
                .find(|header| header.field.equiv("Origin"))
                .map(|header| header.value.as_str().to_owned());
            let mut response = Response::from_string("{\"error\":\"服务请求已满，请稍后重试\"}")
                .with_status_code(503)
                .with_header(
                    Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap(),
                );
            if let Some(origin) = origin.filter(|origin| {
                ["http://127.0.0.1:5173", "http://localhost:5173"].contains(&origin.as_str())
            }) {
                response
                    .add_header(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
            }
            let _ = request.respond(response);
        }
    }
}
struct ActiveRequest(Arc<AtomicUsize>);
impl ActiveRequest {
    fn new(activity: Arc<AtomicUsize>) -> Self {
        activity.fetch_add(1, Ordering::Relaxed);
        Self(activity)
    }
}
impl Drop for ActiveRequest {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
