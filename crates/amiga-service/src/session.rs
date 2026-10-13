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
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

pub struct ActiveSession {
    pub session: Session,
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
}

#[derive(Default)]
pub struct SessionManager {
    pub active: Mutex<Option<ActiveSession>>,
}

pub struct StartContext<'a> {
    pub lib: &'a Library,
    pub engine: &'a EngineInfo,
    pub env: &'a [(String, String)],
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
    // let the real engine check the configuration first
    match engine::dump_config(ctx.engine, &cfg, &lib.layout.runtime()) {
        Ok(r) => warnings.extend(r.corrections.iter().map(|c| format!("The emulator adjusted the configuration: {c}"))),
        Err(e) => {
            for g in guards {
                let _ = lib.end_hdf_session(g, true);
            }
            return Err(e);
        }
    }

    let launched = Session::launch(LaunchRequest {
        engine: ctx.engine,
        profile_id: &profile.id,
        config_text: &cfg,
        runtime_dir: &lib.layout.runtime(),
        log_dir: &lib.layout.logs(),
        locks: vec![],
        env: ctx.env.to_vec(),
    });
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
            let paused = a
                .session
                .control()
                .and_then(|c| c.request(&["GET_STATUS"]).ok())
                .and_then(|f| f.iter().find_map(|x| x.strip_prefix("Paused=").map(|v| v == "true")));
            SessionStatus {
                running: a.session.is_running(),
                profile_id: Some(a.profile.id.clone()),
                profile_name: Some(a.profile.name.clone()),
                pid: Some(a.session.pid()),
                uptime_s: a.session.started.elapsed().as_secs(),
                runtime_control,
                paused,
                warnings: a.warnings.clone(),
                log_path: Some(a.session.log_path.display().to_string()),
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
        });
    }
    Ok(out)
}

pub fn inserted_paths(a: &ActiveSession) -> HashSet<PathBuf> {
    a.session
        .control()
        .and_then(|c| c.drive_state().ok())
        .map(|s| amiga_core::xcopy::paths_from_drive_state(&s))
        .unwrap_or_default()
}
