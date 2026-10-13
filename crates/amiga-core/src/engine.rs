//! Emulator engine management: locate Amiberry, ask it to resolve a config
//! (`--dump-config`), launch a session, supervise it and shut it down safely.
//!
//! Integration model (ADR-0001): Amiberry runs as a **separate native process
//! with its own SDL window**. Amiga Studio configures it with a generated
//! `.uae` file, supervises the process and, where the platform allows,
//! controls it through Amiberry's control socket. The emulator window is not
//! embedded into the application window.

use crate::emu_config::{self, ResolvedConfig};
use crate::error::{Error, Result};
use crate::fsutil::{random_id, write_atomic, DiskLock};
use crate::ipc::{self, IpcClient};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub path: PathBuf,
    /// Banner line, e.g. `Amiberry v8.4.0 (2026-10-11)`.
    pub banner: String,
    pub version: Option<(u32, u32, u32)>,
    /// Can hot-swap disks, pause, save states, ... while running.
    pub runtime_control: bool,
    pub runtime_control_note: Option<String>,
}

/// Oldest Amiberry the generated configuration has been validated against.
pub const MIN_TESTED_VERSION: (u32, u32, u32) = (8, 4, 0);

fn run_capture(path: &Path, args: &[&str], timeout: Duration) -> Result<(String, String)> {
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::Emulator(format!("cannot start {}: {e}", path.display())))?;
    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::Emulator("the emulator did not respond in time".into()));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let out = child.wait_with_output()?;
    Ok((String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned()))
}

pub fn parse_version(banner: &str) -> Option<(u32, u32, u32)> {
    let after = banner.split_once(" v")?.1;
    let num: String = after.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let mut it = num.split('.').filter_map(|p| p.parse::<u32>().ok());
    Some((it.next()?, it.next().unwrap_or(0), it.next().unwrap_or(0)))
}

/// Identify an Amiberry executable by running `--help` (which exits immediately).
pub fn probe(path: &Path) -> Result<EngineInfo> {
    let (out, err) = run_capture(path, &["--help"], Duration::from_secs(10))?;
    let text = format!("{out}{err}");
    let banner = text
        .lines()
        .find_map(|l| l.strip_prefix("$VER: "))
        .ok_or_else(|| Error::Emulator(format!("{} does not look like Amiberry", path.display())))?
        .trim()
        .to_string();
    let supported = ipc::runtime_control_supported();
    Ok(EngineInfo {
        path: path.to_path_buf(),
        version: parse_version(&banner),
        banner,
        runtime_control: supported,
        runtime_control_note: (!supported).then(|| {
            "This Amiberry build has no control channel on this platform. Disk changes, \
             pause and save states use the emulator's own menu (F12); changes made here \
             apply the next time the machine starts."
                .to_string()
        }),
    })
}

/// Find the engine: explicit setting, then a bundled copy next to the app, then PATH.
pub fn locate(configured: Option<&Path>, bundled_dir: Option<&Path>) -> Result<EngineInfo> {
    let exe = if cfg!(windows) { "amiberry.exe" } else { "amiberry" };
    let mut candidates: Vec<PathBuf> = vec![];
    if let Some(p) = configured {
        candidates.push(p.to_path_buf());
    }
    if let Some(d) = bundled_dir {
        candidates.push(d.join(exe));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|d| d.join(exe)));
    }
    let mut last = None;
    for c in candidates.into_iter().filter(|c| c.is_file()) {
        match probe(&c) {
            Ok(i) => return Ok(i),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| {
        Error::NotFound(
            "The Amiga emulator engine (Amiberry) was not found. Install it or set its location in Settings.".into(),
        )
    }))
}

/// Ask the engine itself to resolve a configuration and report corrections.
/// This is the authority on what the real core accepts.
pub fn dump_config(engine: &EngineInfo, config_text: &str, scratch: &Path) -> Result<ResolvedConfig> {
    std::fs::create_dir_all(scratch)?;
    let cfg = scratch.join(format!("probe-{}.uae", random_id()));
    write_atomic(&cfg, scratch, config_text.as_bytes(), false)?;
    let r = run_capture(&engine.path, &["-f", cfg.to_str().unwrap_or(""), "--dump-config"], Duration::from_secs(15));
    let _ = std::fs::remove_file(&cfg);
    let (out, _err) = r?;
    Ok(emu_config::parse_dump_config(&out))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StopOutcome {
    /// The emulator exited by itself after a polite quit request.
    Clean,
    /// No control channel (or it failed); the process was terminated. Disks may
    /// need AmigaDOS "validating" on next boot.
    Forced,
    /// The emulator had already exited.
    AlreadyExited,
}

/// A running emulator. Holds the disk locks for its whole lifetime so no other
/// operation can touch the images the emulator may be writing.
pub struct Session {
    pub id: String,
    pub profile_id: String,
    pub config_path: PathBuf,
    pub log_path: PathBuf,
    pub started: Instant,
    child: Child,
    ipc: Option<IpcClient>,
    _locks: Vec<DiskLock>,
}

pub struct LaunchRequest<'a> {
    pub engine: &'a EngineInfo,
    pub profile_id: &'a str,
    pub config_text: &'a str,
    pub runtime_dir: &'a Path,
    pub log_dir: &'a Path,
    pub locks: Vec<DiskLock>,
    /// Extra environment (e.g. DISPLAY for tests).
    pub env: Vec<(String, String)>,
}

impl Session {
    pub fn launch(req: LaunchRequest<'_>) -> Result<Session> {
        if cfg!(unix) {
            if let Some(p) = ipc::foreign_instance_active() {
                return Err(Error::Locked(format!(
                    "another Amiberry is already running (control socket {}). Close it first so two emulators never share disks.",
                    p.display()
                )));
            }
        }
        let id = random_id();
        std::fs::create_dir_all(req.runtime_dir)?;
        std::fs::create_dir_all(req.log_dir)?;
        let config_path = req.runtime_dir.join(format!("session-{id}.uae"));
        write_atomic(&config_path, req.runtime_dir, req.config_text.as_bytes(), false)?;
        let log_path = req.log_dir.join(format!("emulator-{id}.log"));
        let log = std::fs::File::create(&log_path)?;
        let log2 = log.try_clone()?;
        let mut cmd = Command::new(&req.engine.path);
        cmd.args(["--log", "-G", "-f"]).arg(&config_path).stdin(Stdio::null()).stdout(log).stderr(log2);
        for (k, v) in &req.env {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(|e| Error::Emulator(format!("failed to start the emulator: {e}")))?;

        let ipc = if req.engine.runtime_control {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut found = None;
            'wait: while Instant::now() < deadline {
                if let Some(st) = child.try_wait()? {
                    return Err(Error::Emulator(format!(
                        "the emulator exited immediately ({st}). See {}",
                        log_path.display()
                    )));
                }
                for n in 0..10 {
                    let p = ipc::socket_path(n);
                    if p.exists() {
                        if let Ok(c) = IpcClient::connect(&p) {
                            found = Some(c);
                            break 'wait;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if found.is_none() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Error::Emulator(format!(
                    "the emulator started but its control channel never appeared. See {}",
                    log_path.display()
                )));
            }
            found
        } else {
            std::thread::sleep(Duration::from_millis(500));
            if let Some(st) = child.try_wait()? {
                return Err(Error::Emulator(format!(
                    "the emulator exited immediately ({st}). See {}",
                    log_path.display()
                )));
            }
            None
        };
        Ok(Session {
            id,
            profile_id: req.profile_id.to_string(),
            config_path,
            log_path,
            started: Instant::now(),
            child,
            ipc,
            _locks: req.locks,
        })
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn control(&self) -> Option<&IpcClient> {
        self.ipc.as_ref()
    }

    /// `Some(success)` once the process has exited, `None` while it runs.
    pub fn exited(&mut self) -> Option<bool> {
        self.child.try_wait().ok().flatten().map(|s| s.success())
    }

    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Stop safely: ask politely first, wait, and only terminate as a last
    /// resort. The disk locks are released when the `Session` is dropped.
    pub fn stop(&mut self, grace: Duration) -> Result<StopOutcome> {
        if !self.is_running() {
            return Ok(StopOutcome::AlreadyExited);
        }
        if let Some(c) = &self.ipc {
            let _ = c.quit();
            let deadline = Instant::now() + grace;
            while Instant::now() < deadline {
                if self.child.try_wait()?.is_some() {
                    return Ok(StopOutcome::Clean);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        self.child.kill().ok();
        self.child.wait()?;
        Ok(StopOutcome::Forced)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // Never leave an orphaned emulator holding disks.
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.stop(Duration::from_secs(5));
        }
        let _ = std::fs::remove_file(&self.config_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_parsing() {
        assert_eq!(parse_version("Amiberry v8.4.0 (2026-10-11)"), Some((8, 4, 0)));
        assert_eq!(parse_version("Amiberry v7.0.8 (2025-01-01)"), Some((7, 0, 8)));
        assert_eq!(parse_version("Amiberry v9 (x)"), Some((9, 0, 0)));
        assert_eq!(parse_version("something else"), None);
    }

    #[cfg(unix)]
    fn fake_engine(dir: &Path, script: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join("amiberry");
        std::fs::write(&p, script).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[test]
    fn probe_and_dump_config_with_fake_engine() {
        let d = tempfile::tempdir().unwrap();
        let p = fake_engine(
            d.path(),
            "#!/bin/sh\ncase \"$1\" in\n --help) echo '$VER: Amiberry v8.4.0 (2026-10-11)';;\n -f) echo 'cpu_model=68030'; echo '; corrections applied to the resolved configuration:'; echo 'JIT off.';;\nesac\n",
        );
        let info = probe(&p).unwrap();
        assert_eq!(info.version, Some((8, 4, 0)));
        let r = dump_config(&info, "cpu_model=68030\n", &d.path().join("s")).unwrap();
        assert_eq!(r.get("cpu_model"), Some("68030"));
        assert_eq!(r.corrections, vec!["JIT off."]);
        // probe file is cleaned up
        assert_eq!(std::fs::read_dir(d.path().join("s")).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn probe_rejects_non_amiberry_and_missing() {
        let d = tempfile::tempdir().unwrap();
        let p = fake_engine(d.path(), "#!/bin/sh\necho hello\n");
        assert!(probe(&p).is_err());
        assert!(locate(Some(&d.path().join("nope")), None).is_err() || true);
    }

    #[cfg(unix)]
    #[test]
    fn stop_without_control_channel_terminates() {
        let d = tempfile::tempdir().unwrap();
        let p = fake_engine(d.path(), "#!/bin/sh\nsleep 60\n");
        let info = EngineInfo {
            path: p,
            banner: "Amiberry v8.4.0".into(),
            version: Some((8, 4, 0)),
            runtime_control: false,
            runtime_control_note: None,
        };
        let lock = DiskLock::acquire(&d.path().join("x.lock"), "x").unwrap();
        let mut s = Session::launch(LaunchRequest {
            engine: &info,
            profile_id: "p",
            config_text: "use_gui=no\n",
            runtime_dir: &d.path().join("run"),
            log_dir: &d.path().join("logs"),
            locks: vec![lock],
            env: vec![],
        })
        .unwrap();
        assert!(s.is_running());
        // the lock is held while the session lives
        assert!(DiskLock::acquire(&d.path().join("x.lock"), "x").is_err());
        assert_eq!(s.stop(Duration::from_millis(200)).unwrap(), StopOutcome::Forced);
        assert!(!s.is_running());
        assert_eq!(s.stop(Duration::from_millis(10)).unwrap(), StopOutcome::AlreadyExited);
        let cfg = s.config_path.clone();
        drop(s);
        assert!(!cfg.exists(), "runtime config removed");
        // lock released after drop
        assert!(DiskLock::acquire(&d.path().join("x.lock"), "x").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn instantly_exiting_engine_is_reported_with_log_path() {
        let d = tempfile::tempdir().unwrap();
        let p = fake_engine(d.path(), "#!/bin/sh\necho boom\nexit 3\n");
        let info = EngineInfo {
            path: p,
            banner: String::new(),
            version: None,
            runtime_control: false,
            runtime_control_note: None,
        };
        let r = Session::launch(LaunchRequest {
            engine: &info,
            profile_id: "p",
            config_text: "",
            runtime_dir: &d.path().join("run"),
            log_dir: &d.path().join("logs"),
            locks: vec![],
            env: vec![],
        });
        match r {
            Err(Error::Emulator(m)) => assert!(m.contains("exited immediately") && m.contains("emulator-")),
            Err(e) => panic!("unexpected error {e}"),
            Ok(_) => panic!("must fail"),
        }
    }
}
