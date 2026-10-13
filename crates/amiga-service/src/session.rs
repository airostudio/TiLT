//! Emulator session supervision: start from a machine profile, keep the disk
//! locks for the session's lifetime, expose runtime control, and finish the
//! bookkeeping (HDF dirty/unclean flags, session history) however the emulator ends.

use amiga_core::emu_config::{build_config, ResolvedMedia};
use amiga_core::engine::{self, EngineInfo, LaunchRequest, Session, StopOutcome};
use amiga_core::hash::CancelToken;
use amiga_core::ipc::IpcClient;
use amiga_core::library::{HdfSessionGuard, Library, MediaRecord};
use amiga_core::profiles::{self, DriveKind, MachineProfile, Severity};
use amiga_core::{Error, Result};
use amiga_retro::{RetroConfig, RetroHandle};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How a machine is run.
///
/// * `Process` - the standalone Amiberry in its own window, controlled over its socket where the build
///   has one (Linux/macOS; **not** official Windows builds).
/// * `Embedded` - the Amiberry *libretro core* hosted in this process by `amiga-retro`. Works the same on
///   every platform, so it is how run-time control reaches Windows. Trade-offs are documented in ADR-0001
///   (floppy hot-swap is DF0 only; no drive-state read-back).
pub enum Backend {
    Process(Session),
    Embedded(Embedded),
}

pub struct Embedded {
    pub handle: RetroHandle,
    pub started: Instant,
    pub log_path: PathBuf,
    /// What we last put in DF0 (the core has no read-back).
    pub df0: Mutex<Option<PathBuf>>,
    /// Disks the machine was configured with at start (DF1-DF3 cannot change while it runs).
    pub floppies: [Option<PathBuf>; 4],
}

impl Backend {
    pub fn is_running(&mut self) -> bool {
        match self {
            Backend::Process(s) => s.is_running(),
            Backend::Embedded(e) => !e.handle.shutdown_requested(),
        }
    }
    /// `Some(clean)` once the machine has ended.
    pub fn exited(&mut self) -> Option<bool> {
        match self {
            Backend::Process(s) => s.exited(),
            Backend::Embedded(e) => e.handle.shutdown_requested().then_some(true),
        }
    }
    pub fn started(&self) -> Instant {
        match self {
            Backend::Process(s) => s.started,
            Backend::Embedded(e) => e.started,
        }
    }
    pub fn pid(&self) -> Option<u32> {
        match self {
            Backend::Process(s) => Some(s.pid()),
            Backend::Embedded(_) => None,
        }
    }
    pub fn log_path(&self) -> &Path {
        match self {
            Backend::Process(s) => &s.log_path,
            Backend::Embedded(e) => &e.log_path,
        }
    }
    pub fn mode(&self) -> &'static str {
        match self {
            Backend::Process(_) => "process",
            Backend::Embedded(_) => "embedded",
        }
    }
    pub fn embedded(&self) -> Option<&Embedded> {
        match self {
            Backend::Embedded(e) => Some(e),
            _ => None,
        }
    }
    /// The standalone emulator's socket, if this backend has one.
    pub fn control(&self) -> Option<&IpcClient> {
        match self {
            Backend::Process(s) => s.control(),
            Backend::Embedded(_) => None,
        }
    }
    pub fn stop(&mut self, grace: Duration) -> Result<StopOutcome> {
        match self {
            Backend::Process(s) => s.stop(grace),
            // Dropping the handle runs unload_game/deinit on the core thread.
            Backend::Embedded(_) => Ok(StopOutcome::Clean),
        }
    }
}

pub struct ActiveSession {
    pub session: Backend,
    pub record_id: String,
    pub profile: MachineProfile,
    pub guards: Vec<HdfSessionGuard>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionStatus {
    pub running: bool,
    pub profile_id: Option<String>,
    pub profile_name: Option<String>,
    pub pid: Option<u32>,
    pub uptime_s: u64,
    pub runtime_control: bool,
    /// "process" (standalone emulator window) or "embedded" (libretro core drawn inside the app).
    pub mode: Option<&'static str>,
    pub paused: Option<bool>,
    pub warnings: Vec<String>,
    pub log_path: Option<String>,
    pub hard_disks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriveView {
    pub unit: u8,
    pub enabled: bool,
    pub path: Option<String>,
    pub media_id: Option<String>,
    pub media_name: Option<String>,
    pub write_protected: bool,
    pub motor: bool,
    pub writing: bool,
    pub track: Option<i64>,
    /// Can a disk be inserted/ejected in this drive while the machine runs? (Embedded mode: DF0 only.)
    pub swappable: bool,
    /// Does `motor`/`writing`/`track` carry real data? (Embedded mode has no drive read-back.)
    pub live_state: bool,
}

#[derive(Default)]
pub struct SessionManager {
    pub active: Mutex<Option<ActiveSession>>,
}

pub struct StartContext<'a> {
    pub lib: &'a Library,
    /// Needed for process mode; in embedded mode it is only used for the optional config pre-check.
    pub engine: Option<&'a EngineInfo>,
    pub env: &'a [(String, String)],
    /// `Some(core)` runs the machine inside this process through the libretro core.
    pub embedded_core: Option<&'a Path>,
}

pub fn start(ctx: &StartContext<'_>, profile_id: &str) -> Result<ActiveSession> {
    let lib = ctx.lib;
    let mut profile = lib.get_profile(profile_id)?;
    let rom = match &profile.rom_id {
        Some(id) => Some(lib.get_rom(id)?),
        None => None,
    };
    let v = profiles::validate(&profile, rom.as_ref().map(|r| &r.info));
    if let Some(e) = v.issues.iter().find(|i| i.severity == Severity::Error) {
        return Err(Error::InvalidProfile(e.message.clone()));
    }
    let mut warnings: Vec<String> =
        v.issues.iter().filter(|i| i.severity == Severity::Warning).map(|i| i.message.clone()).collect();
    let rom = rom
        .ok_or_else(|| Error::InvalidProfile("Choose a Kickstart ROM for this machine first (ROM Library).".into()))?;
    let mut media = ResolvedMedia { rom: Some(lib.rom_path(&rom.id)?), ..Default::default() };
    if let Some(e) = &profile.ext_rom_id {
        media.ext_rom = Some(lib.rom_path(e)?);
    }

    // floppies: originals are always write protected for the emulator
    for i in 0..4 {
        if profile.drives[i].kind == DriveKind::Disabled {
            continue;
        }
        if let Some(mid) = profile.drives[i].media_id.clone() {
            let m: MediaRecord = lib.get_media(&mid)?;
            if m.missing {
                return Err(Error::NotFound(format!("The disk '{}' in DF{i}: is missing from the library.", m.name)));
            }
            if m.pristine && !profile.drives[i].write_protect {
                profile.drives[i].write_protect = true;
                warnings.push(format!("'{}' in DF{i}: is an untouched original, so it is write protected. Make a working copy to save changes.", m.name));
            }
            media.floppies[i] = Some(m.path);
            let _ = lib.touch_media(&mid);
        }
    }

    // hard disks: lock + safety backup via the library
    let mut guards: Vec<HdfSessionGuard> = vec![];
    let cancel = CancelToken::new();
    let result = (|| -> Result<()> {
        for att in &profile.hard_disks {
            let g = lib.begin_hdf_session(&att.hdf_id, att.read_only, &cancel)?;
            if g.auto_backup.is_some() {
                warnings.push("A safety backup of the hard disk was made before starting.".into());
            }
            if lib.get_hdf(&att.hdf_id)?.unclean_shutdown {
                warnings.push("The last session did not shut down cleanly. AmigaDOS may validate the disk on boot; consider restoring a backup if you see errors.".into());
            }
            media.hard_disks.push((att.clone(), g.working_path.clone()));
            guards.push(g);
        }
        Ok(())
    })();
    if let Err(e) = result {
        for g in guards {
            let _ = lib.end_hdf_session(g, true);
        }
        return Err(e);
    }

    let cfg = match build_config(&profile, &media) {
        Ok(c) => c,
        Err(e) => {
            for g in guards {
                let _ = lib.end_hdf_session(g, true);
            }
            return Err(e);
        }
    };
    // let the real engine check the configuration first (when a standalone engine is installed)
    match ctx.engine {
        Some(eng) => match engine::dump_config(eng, &cfg, &lib.layout.runtime()) {
            Ok(r) => {
                warnings.extend(r.corrections.iter().map(|c| format!("The emulator adjusted the configuration: {c}")))
            }
            Err(e) => {
                for g in guards {
                    let _ = lib.end_hdf_session(g, true);
                }
                return Err(e);
            }
        },
        None => warnings.push(
            "The standalone emulator is not installed, so this configuration could not be pre-checked by it.".into(),
        ),
    }

    let launched: Result<Backend> = match (ctx.embedded_core, ctx.engine) {
        (Some(core), _) => start_embedded(lib, core, &profile, &cfg, media.floppies.clone()),
        (None, Some(eng)) => Session::launch(LaunchRequest {
            engine: eng,
            profile_id: &profile.id,
            config_text: &cfg,
            runtime_dir: &lib.layout.runtime(),
            log_dir: &lib.layout.logs(),
            locks: vec![],
            env: ctx.env.to_vec(),
        })
        .map(Backend::Process),
        (None, None) => Err(Error::NotFound(
            "The Amiga emulator engine (Amiberry) was not found. Install it or set its location in Settings.".into(),
        )),
    };
    let session = match launched {
        Ok(s) => s,
        Err(e) => {
            for g in guards {
                let _ = lib.end_hdf_session(g, true);
            }
            return Err(e);
        }
    };
    let record_id = lib.begin_session(&profile)?;
    Ok(ActiveSession { session, record_id, profile, guards, warnings })
}

fn start_embedded(
    lib: &Library,
    core: &Path,
    profile: &MachineProfile,
    config_text: &str,
    floppies: [Option<PathBuf>; 4],
) -> Result<Backend> {
    let dir = lib.layout.runtime().join("retro");
    let system = dir.join("system");
    let saves = dir.join("saves");
    std::fs::create_dir_all(&system)?;
    std::fs::create_dir_all(&saves)?;
    let uae = dir.join(format!("{}.uae", profile.id));
    amiga_core::fsutil::write_atomic(&uae, &dir, config_text.as_bytes(), true)?;
    let handle = RetroHandle::start(RetroConfig {
        core: core.to_path_buf(),
        system_dir: system,
        save_dir: saves,
        content: uae,
        options: vec![],
    })
    .map_err(|e| Error::Emulator(e.to_string()))?;
    let log_path = lib.layout.logs().join(format!("embedded-{}.log", profile.id));
    Ok(Backend::Embedded(Embedded {
        handle,
        started: Instant::now(),
        log_path,
        df0: Mutex::new(floppies[0].clone()),
        floppies,
    }))
}

/// End bookkeeping for a session that is already stopped.
pub fn finish(lib: &Library, a: ActiveSession, clean: bool) {
    let ActiveSession { session, record_id, guards, .. } = a;
    drop(session);
    for g in guards {
        let _ = lib.end_hdf_session(g, clean);
    }
    let _ = lib.end_session(&record_id, if clean { "clean" } else { "unclean" });
}

pub fn stop(lib: &Library, mut a: ActiveSession) -> StopOutcome {
    let outcome = a.session.stop(Duration::from_secs(15)).unwrap_or(StopOutcome::Forced);
    let clean = matches!(outcome, StopOutcome::Clean)
        || (outcome == StopOutcome::AlreadyExited && a.session.exited().unwrap_or(false));
    finish(lib, a, clean);
    outcome
}

pub fn control(a: &ActiveSession) -> Result<&IpcClient> {
    a.session.control().ok_or_else(|| {
        Error::Unsupported("This emulator build cannot be controlled while it runs. Use the emulator's own menu (F12), or restart the machine to apply changes.".into())
    })
}

pub fn status(m: &Mutex<Option<ActiveSession>>, runtime_control: bool) -> SessionStatus {
    let mut g = m.lock().unwrap();
    match g.as_mut() {
        Some(a) => {
            let paused = match a.session.embedded() {
                Some(e) => Some(e.handle.is_paused()),
                None => a
                    .session
                    .control()
                    .and_then(|c| c.request(&["GET_STATUS"]).ok())
                    .and_then(|f| f.iter().find_map(|x| x.strip_prefix("Paused=").map(|v| v == "true"))),
            };
            SessionStatus {
                running: a.session.is_running(),
                profile_id: Some(a.profile.id.clone()),
                profile_name: Some(a.profile.name.clone()),
                pid: a.session.pid(),
                uptime_s: a.session.started().elapsed().as_secs(),
                runtime_control: runtime_control || a.session.embedded().is_some(),
                mode: Some(a.session.mode()),
                paused,
                warnings: a.warnings.clone(),
                log_path: Some(a.session.log_path().display().to_string()),
                hard_disks: a.guards.iter().map(|g| g.hdf_id.clone()).collect(),
            }
        }
        None => SessionStatus {
            running: false,
            profile_id: None,
            profile_name: None,
            pid: None,
            uptime_s: 0,
            runtime_control,
            mode: None,
            paused: None,
            warnings: vec![],
            log_path: None,
            hard_disks: vec![],
        },
    }
}

fn kv_get<'a>(kv: &'a [(String, String)], k: &str) -> Option<&'a str> {
    kv.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str())
}

pub fn drives(lib: &Library, a: &ActiveSession) -> Result<Vec<DriveView>> {
    if let Some(e) = a.session.embedded() {
        let media = lib.list_media()?;
        let df0 = e.df0.lock().unwrap().clone();
        return Ok((0..4u8)
            .map(|unit| {
                let d = &a.profile.drives[unit as usize];
                let path = if unit == 0 { df0.clone() } else { e.floppies[unit as usize].clone() };
                let rec = path.as_ref().and_then(|p| media.iter().find(|m| &m.path == p));
                DriveView {
                    unit,
                    enabled: d.kind != DriveKind::Disabled,
                    media_id: rec.map(|m| m.id.clone()),
                    media_name: rec.map(|m| m.name.clone()),
                    write_protected: d.write_protect || rec.is_some_and(|m| m.pristine),
                    motor: false,
                    writing: false,
                    track: None,
                    path: path.map(|p| p.display().to_string()),
                    swappable: unit == 0 && d.kind != DriveKind::Disabled,
                    live_state: false,
                }
            })
            .collect());
    }
    let c = control(a)?;
    let state = c.drive_state()?;
    let media = lib.list_media()?;
    let mut out = vec![];
    for unit in 0..4u8 {
        let p =
            kv_get(&state, &format!("DF{unit}_disk")).filter(|v| *v != "<empty>" && !v.is_empty()).map(str::to_string);
        let rec = p.as_ref().and_then(|p| media.iter().find(|m| m.path.to_string_lossy() == *p));
        out.push(DriveView {
            unit,
            enabled: kv_get(&state, &format!("DF{unit}_disabled")) != Some("1"),
            media_id: rec.map(|m| m.id.clone()),
            media_name: rec.map(|m| m.name.clone()),
            write_protected: kv_get(&state, &format!("DF{unit}_protected")) == Some("1"),
            motor: kv_get(&state, &format!("DF{unit}_motor")) == Some("1"),
            writing: kv_get(&state, &format!("DF{unit}_writing")) == Some("1"),
            track: kv_get(&state, &format!("DF{unit}_track")).and_then(|t| t.parse().ok()),
            path: p,
            swappable: true,
            live_state: true,
        });
    }
    Ok(out)
}

pub fn inserted_paths(a: &ActiveSession) -> HashSet<PathBuf> {
    if let Some(e) = a.session.embedded() {
        let mut s: HashSet<PathBuf> = e.df0.lock().unwrap().iter().cloned().collect();
        s.extend(e.floppies.iter().skip(1).flatten().cloned());
        return s;
    }
    a.session
        .control()
        .and_then(|c| c.drive_state().ok())
        .map(|s| amiga_core::xcopy::paths_from_drive_state(&s))
        .unwrap_or_default()
}
