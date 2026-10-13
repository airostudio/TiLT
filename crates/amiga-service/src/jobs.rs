//! Background jobs for long operations (hashing, DMS conversion, HDF copies,
//! backups). Each job runs on its own thread, reports progress, can be
//! cancelled, and keeps its result until the UI reads it.

use amiga_core::error::ErrorDto;
use amiga_core::hash::CancelToken;
use amiga_core::Error;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
enum Status {
    Running,
    Done(Value),
    Failed(ErrorDto),
    Cancelled,
}

pub struct JobState {
    id: String,
    kind: String,
    label: String,
    done: AtomicU64,
    total: AtomicU64,
    status: Mutex<Status>,
    pub cancel: CancelToken,
}

/// Handle passed to the job body.
pub struct JobCtx {
    state: Arc<JobState>,
}

impl JobCtx {
    pub fn cancel_token(&self) -> CancelToken {
        self.state.cancel.clone()
    }
    pub fn progress(&self, done: u64, total: u64) {
        self.state.done.store(done, Ordering::Relaxed);
        self.state.total.store(total, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct JobView {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub done: u64,
    pub total: u64,
    /// running | done | failed | cancelled
    pub state: &'static str,
    pub result: Option<Value>,
    pub error: Option<ErrorDto>,
}

#[derive(Default)]
pub struct Jobs {
    map: Mutex<HashMap<String, Arc<JobState>>>,
    order: Mutex<Vec<String>>,
}

const KEEP_FINISHED: usize = 50;

impl Jobs {
    pub fn spawn<F>(&self, kind: &str, label: &str, f: F) -> String
    where
        F: FnOnce(&JobCtx) -> Result<Value, Error> + Send + 'static,
    {
        let id = amiga_core::fsutil::random_id();
        let state = Arc::new(JobState {
            id: id.clone(),
            kind: kind.into(),
            label: label.into(),
            done: AtomicU64::new(0),
            total: AtomicU64::new(0),
            status: Mutex::new(Status::Running),
            cancel: CancelToken::new(),
        });
        self.map.lock().unwrap().insert(id.clone(), state.clone());
        self.order.lock().unwrap().push(id.clone());
        let s2 = state.clone();
        std::thread::spawn(move || {
            let ctx = JobCtx { state: s2.clone() };
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&ctx)));
            let st = match r {
                Ok(Ok(v)) => Status::Done(v),
                Ok(Err(Error::Cancelled)) => Status::Cancelled,
                Ok(Err(e)) => Status::Failed(ErrorDto::from(&e)),
                Err(_) => {
                    Status::Failed(ErrorDto { code: "internal", message: "the operation crashed unexpectedly".into() })
                }
            };
            *s2.status.lock().unwrap() = st;
        });
        self.prune();
        id
    }

    fn view(s: &JobState) -> JobView {
        let st = s.status.lock().unwrap().clone();
        let (state, result, error) = match st {
            Status::Running => ("running", None, None),
            Status::Done(v) => ("done", Some(v), None),
            Status::Failed(e) => ("failed", None, Some(e)),
            Status::Cancelled => ("cancelled", None, None),
        };
        JobView {
            id: s.id.clone(),
            kind: s.kind.clone(),
            label: s.label.clone(),
            done: s.done.load(Ordering::Relaxed),
            total: s.total.load(Ordering::Relaxed),
            state,
            result,
            error,
        }
    }

    pub fn get(&self, id: &str) -> Option<JobView> {
        self.map.lock().unwrap().get(id).map(|s| Self::view(s))
    }

    pub fn list(&self) -> Vec<JobView> {
        let order = self.order.lock().unwrap().clone();
        let map = self.map.lock().unwrap();
        order.iter().rev().filter_map(|id| map.get(id)).map(|s| Self::view(s)).collect()
    }

    pub fn cancel(&self, id: &str) -> bool {
        match self.map.lock().unwrap().get(id) {
            Some(s) => {
                s.cancel.cancel();
                true
            }
            None => false,
        }
    }

    fn prune(&self) {
        let mut order = self.order.lock().unwrap();
        let mut map = self.map.lock().unwrap();
        let finished: Vec<String> = order
            .iter()
            .filter(|id| map.get(*id).is_some_and(|s| !matches!(*s.status.lock().unwrap(), Status::Running)))
            .cloned()
            .collect();
        if finished.len() > KEEP_FINISHED {
            for id in finished.iter().take(finished.len() - KEEP_FINISHED) {
                map.remove(id);
                order.retain(|o| o != id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn wait(j: &Jobs, id: &str) -> JobView {
        let end = Instant::now() + Duration::from_secs(5);
        loop {
            let v = j.get(id).unwrap();
            if v.state != "running" || Instant::now() > end {
                return v;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn completes_fails_and_cancels() {
        let j = Jobs::default();
        let a = j.spawn("t", "ok", |c| {
            c.progress(5, 10);
            Ok(serde_json::json!({"x": 1}))
        });
        let v = wait(&j, &a);
        assert_eq!((v.state, v.done, v.total), ("done", 5, 10));
        assert_eq!(v.result.unwrap()["x"], 1);

        let b = j.spawn("t", "bad", |_| Err(Error::NotFound("zzz".into())));
        let v = wait(&j, &b);
        assert_eq!(v.state, "failed");
        assert_eq!(v.error.unwrap().code, "not_found");

        let c = j.spawn("t", "slow", |ctx| {
            for _ in 0..500 {
                ctx.cancel_token().check()?;
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(Value::Null)
        });
        assert!(j.cancel(&c));
        assert_eq!(wait(&j, &c).state, "cancelled");
        assert!(!j.cancel("nope"));
    }

    #[test]
    fn panics_become_failures() {
        let j = Jobs::default();
        let id = j.spawn("t", "boom", |_| panic!("oops"));
        let v = wait(&j, &id);
        assert_eq!(v.state, "failed");
        assert_eq!(v.error.unwrap().code, "internal");
    }
}
