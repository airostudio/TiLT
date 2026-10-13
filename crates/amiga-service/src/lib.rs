//! Command layer for Amiga Studio / TiLT front end.
//!
//! One allow-listed entry point, [`Service::dispatch`], used by both the Tauri
//! shell (`invoke("amiga", {cmd, args})`) and the development bridge. Anything not
//! matched in `dispatch` does not exist as far as the UI is concerned: the front
//! end can never run arbitrary host commands, only these operations.

mod detect;
mod fsbrowse;
mod jobs;
mod pinball;
mod session;
mod systems;

pub use amiga_core::library::Layout as StorageLayout;
pub use jobs::{JobView, Jobs};

use amiga_core::adf::{Density, FsKind};
use amiga_core::engine::{self, EngineInfo};
use amiga_core::error::ErrorDto;
use amiga_core::hash::CancelToken;
use amiga_core::library::{HdfImportOptions, Layout, Library, SnapshotKind, StorageMode};
use amiga_core::profiles::{self, MachineProfile};
use amiga_core::xcopy::{CopyOptions, CopySource, CopyTarget};
use amiga_core::{Error, Result};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct Service {
    pub lib: Arc<Library>,
    jobs: Jobs,
    systems: systems::Systems,
    sessions: Arc<session::SessionManager>,
    engine: Mutex<Option<EngineInfo>>,
    bundled_dir: Option<PathBuf>,
    /// Extra environment for emulator launches (tests/CI use this for DISPLAY).
    launch_env: Vec<(String, String)>,
    /// Folder holding the storage-location pointer (the app's config dir).
    bootstrap_dir: Option<PathBuf>,
}

fn bad(msg: impl Into<String>) -> Error {
    Error::Unsafe(msg.into())
}

fn s<'a>(a: &'a Value, k: &str) -> Result<&'a str> {
    a.get(k).and_then(Value::as_str).ok_or_else(|| bad(format!("missing text argument '{k}'")))
}
fn so<'a>(a: &'a Value, k: &str) -> Option<&'a str> {
    a.get(k).and_then(Value::as_str).filter(|s| !s.is_empty())
}
fn bo(a: &Value, k: &str, default: bool) -> bool {
    a.get(k).and_then(Value::as_bool).unwrap_or(default)
}
fn paths(a: &Value, k: &str) -> Result<Vec<PathBuf>> {
    let arr = a.get(k).and_then(Value::as_array).ok_or_else(|| bad(format!("missing list '{k}'")))?;
    arr.iter().map(|v| v.as_str().map(PathBuf::from).ok_or_else(|| bad("paths must be text"))).collect()
}
fn from<T: for<'de> Deserialize<'de>>(a: &Value, k: &str) -> Result<T> {
    serde_json::from_value(a.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| bad(format!("bad '{k}': {e}")))
}
fn j<T: serde::Serialize>(v: T) -> Result<Value> {
    serde_json::to_value(v).map_err(|e| bad(e.to_string()))
}
fn abs(p: &str) -> Result<PathBuf> {
    let p = PathBuf::from(p);
    if !p.is_absolute() {
        return Err(bad("use a full path"));
    }
    Ok(p)
}

impl Service {
    pub fn new(layout: Layout, bundled_dir: Option<PathBuf>) -> Result<Arc<Service>> {
        Self::with_env(layout, bundled_dir, vec![])
    }

    pub fn with_env(
        layout: Layout,
        bundled_dir: Option<PathBuf>,
        launch_env: Vec<(String, String)>,
    ) -> Result<Arc<Service>> {
        Self::with_options(layout, bundled_dir, launch_env, None)
    }

    pub fn with_options(
        layout: Layout,
        bundled_dir: Option<PathBuf>,
        launch_env: Vec<(String, String)>,
        bootstrap_dir: Option<PathBuf>,
    ) -> Result<Arc<Service>> {
        let lib = Arc::new(Library::open(layout)?);
        lib.ensure_default_profiles()?;
        Ok(Arc::new(Service {
            lib,
            jobs: Jobs::default(),
            systems: systems::Systems::default(),
            sessions: Arc::new(session::SessionManager::default()),
            engine: Mutex::new(None),
            bundled_dir,
            launch_env,
            bootstrap_dir,
        }))
    }

    /// The Amiberry libretro core used for embedded mode: the configured path, else a core that sits
    /// next to the bundled engine / the located engine (release assets are named
    /// `amiberry-libretro-<os>-<arch>.<ext>`).
    pub fn retro_core(&self) -> Option<PathBuf> {
        let ext = if cfg!(windows) {
            "dll"
        } else if cfg!(target_os = "macos") {
            "dylib"
        } else {
            "so"
        };
        if let Ok(Some(p)) = self.lib.get_setting("libretro_core_path") {
            let p = PathBuf::from(p);
            if p.is_file() {
                return Some(p);
            }
        }
        let mut dirs: Vec<PathBuf> = self.bundled_dir.iter().cloned().collect();
        if let Ok(e) = self.engine() {
            dirs.extend(e.path.parent().map(Path::to_path_buf));
        }
        for d in dirs {
            let Ok(rd) = std::fs::read_dir(&d) else { continue };
            let mut found: Vec<PathBuf> = rd
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
                    n.contains("libretro") && n.contains("amiberry") && n.ends_with(&format!(".{ext}"))
                })
                .collect();
            found.sort();
            if let Some(f) = found.into_iter().next() {
                return Some(f);
            }
        }
        None
    }

    fn engine(&self) -> Result<EngineInfo> {
        let mut g = self.engine.lock().unwrap();
        if g.is_none() {
            let configured = self.lib.get_setting("engine_path")?.map(PathBuf::from);
            *g = Some(engine::locate(configured.as_deref(), self.bundled_dir.as_deref())?);
        }
        Ok(g.clone().unwrap())
    }

    /// Run a command. Never panics; failures are returned as `ErrorDto`.
    pub fn dispatch(self: &Arc<Self>, cmd: &str, args: Value) -> std::result::Result<Value, ErrorDto> {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.run(cmd, &args)));
        match r {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(ErrorDto::from(&e)),
            Err(_) => Err(ErrorDto { code: "internal", message: "an internal error occurred".into() }),
        }
    }

    fn run(self: &Arc<Self>, cmd: &str, a: &Value) -> Result<Value> {
        let lib = &self.lib;
        match cmd {
            // ---------- app ----------
            "app_info" => {
                let eng = self.engine().ok();
                j(json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "platform": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                    "storage_root": lib.layout.root.display().to_string(),
                    "engine": eng,
                    "runtime_control": amiga_core::ipc::runtime_control_supported(),
                    "embedded_core": self.retro_core().map(|p| p.display().to_string()),
                    "run_mode": lib.get_setting("run_mode").ok().flatten().unwrap_or_else(|| "process".into()),
                }))
            }
            "storage_report" => j(lib.storage_report()?),
            "storage_location" => j(self.storage_location()),
            "storage_set_location" => self.storage_set_location(s(a, "path")?),
            "orphan_delete" => {
                let target = abs(s(a, "path")?)?;
                if !lib.find_orphans()?.iter().any(|o| o == &target) {
                    return Err(bad("only unreferenced library files can be deleted this way"));
                }
                std::fs::remove_file(&target)?;
                j(true)
            }
            "recover" => j(lib.recover()?),
            "fs_list" => j(fsbrowse::list(so(a, "path"))?),
            "orphans" => j(lib.find_orphans()?.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()),

            // ---------- rooms & external systems ----------
            "rooms" => j(systems::rooms()),
            "systems_list" => j(self.systems.list(lib)),
            "system_save" => {
                let d: systems::SystemDef = from(a, "system")?;
                self.systems.save(lib, d)?;
                j(self.systems.list(lib))
            }
            "system_delete" => {
                self.systems.delete_custom(lib, s(a, "id")?)?;
                j(self.systems.list(lib))
            }
            "system_games" => j(self.systems.games(lib, s(a, "id")?)?),
            "system_favorite" => j(self.systems.toggle_favorite(lib, s(a, "id")?, s(a, "game")?)?),
            "system_detect" => {
                let id = s(a, "id")?;
                if !detect::supported(id) {
                    return Err(bad("TiLT does not know where to look for that emulator"));
                }
                j(detect::detect(id))
            }
            "systems_autoconfigure" => j(self.systems.autoconfigure(lib, s(a, "room")?)?),
            "pinball_roms" => j(json!({
                "sets": pinball::list(lib),
                "folder": pinball::rom_dir(lib).display().to_string(),
                "mame": self.systems.exe_of(lib, "mame"),
            })),
            "pinball_rom_import" => {
                let ps = paths(a, "paths")?;
                let overwrite = bo(a, "overwrite", false);
                let lib = self.lib.clone();
                let id = self.jobs.spawn("pinball_import", "Importing pinball ROM sets", move |ctx| {
                    let res = pinball::import(&lib, &ps, overwrite);
                    let n = res.len() as u64;
                    ctx.progress(n, n);
                    Ok(json!(res
                        .into_iter()
                        .map(|(p, r)| match r {
                            Ok(set) => json!({"path": p.display().to_string(), "ok": set}),
                            Err(e) => json!({"path": p.display().to_string(), "error": ErrorDto::from(&e)}),
                        })
                        .collect::<Vec<_>>()))
                });
                j(json!({ "job": id }))
            }
            "pinball_rom_verify" => {
                let names: Vec<String> = match so(a, "name") {
                    Some(n) => vec![n.to_string()],
                    None => pinball::list(lib).into_iter().filter(|s| !s.missing).map(|s| s.name).collect(),
                };
                let mame = self.systems.exe_of(lib, "mame").map(PathBuf::from);
                let lib = self.lib.clone();
                let id = self.jobs.spawn("pinball_verify", "Checking ROM sets with MAME", move |ctx| {
                    let total = names.len() as u64;
                    let mut out = vec![];
                    for (i, n) in names.iter().enumerate() {
                        if ctx.cancel_token().is_cancelled() {
                            break;
                        }
                        out.push(match pinball::verify(&lib, n, mame.as_deref()) {
                            Ok(set) => json!({"name": n, "ok": set}),
                            Err(e) => json!({"name": n, "error": ErrorDto::from(&e)}),
                        });
                        ctx.progress(i as u64 + 1, total);
                    }
                    Ok(json!(out))
                });
                j(json!({ "job": id }))
            }
            "pinball_rom_remove" => {
                pinball::remove(lib, s(a, "name")?)?;
                j(true)
            }
            "system_launch" => j(self.systems.launch(lib, s(a, "id")?, so(a, "game"))?),
            "system_stop" => j(self.systems.stop(s(a, "id")?)),

            // ---------- engine ----------
            "engine_info" => j(self.engine()?),
            "engine_set_path" => {
                let p = abs(s(a, "path")?)?;
                let info = engine::probe(&p)?;
                lib.set_setting("engine_path", &p.to_string_lossy())?;
                *self.engine.lock().unwrap() = Some(info.clone());
                j(info)
            }

            "embedded_set_core" => {
                let p = abs(s(a, "path")?)?;
                if !p.is_file() {
                    return Err(Error::NotFound("that file does not exist".into()));
                }
                lib.set_setting("libretro_core_path", &p.to_string_lossy())?;
                j(json!({ "embedded_core": self.retro_core().map(|p| p.display().to_string()) }))
            }
            "run_mode_set" => {
                let m = s(a, "mode")?;
                if m != "process" && m != "embedded" {
                    return Err(bad("mode must be 'process' or 'embedded'"));
                }
                lib.set_setting("run_mode", m)?;
                j(m)
            }

            // ---------- ROMs ----------
            "rom_list" => j(lib.list_roms()?),
            "rom_import" => {
                let mode = if bo(a, "copy", true) { StorageMode::Managed } else { StorageMode::Referenced };
                let res = lib.import_roms(&paths(a, "paths")?, mode);
                j(res
                    .into_iter()
                    .map(|(p, r)| match r {
                        Ok(i) => json!({"path": p.display().to_string(), "ok": i}),
                        Err(e) => json!({"path": p.display().to_string(), "error": ErrorDto::from(&e)}),
                    })
                    .collect::<Vec<_>>())
            }
            "rom_relink" => j(lib.relink_rom(s(a, "id")?, &abs(s(a, "path")?)?)?),
            "rom_remove" => j(lib.remove_rom(s(a, "id")?)?),

            // ---------- floppies / DMS ----------
            "media_list" => j(lib.list_media()?),
            "media_recent" => j(lib.recent_media(12)?),
            "media_import" => {
                let ps = paths(a, "paths")?;
                let lib = self.lib.clone();
                let id = self.jobs.spawn("media_import", &format!("Importing {} file(s)", ps.len()), move |ctx| {
                    let total = ps.len() as u64;
                    let mut out = vec![];
                    for (i, p) in ps.iter().enumerate() {
                        ctx.progress(i as u64, total);
                        let r = lib.import_media(p, &ctx.cancel_token());
                        out.push(match r {
                            Ok(m) => json!({"path": p.display().to_string(), "ok": m}),
                            Err(Error::Cancelled) => return Err(Error::Cancelled),
                            Err(e) => json!({"path": p.display().to_string(), "error": ErrorDto::from(&e)}),
                        });
                    }
                    ctx.progress(total, total);
                    Ok(Value::Array(out))
                });
                j(json!({ "job": id }))
            }
            "media_create_blank" => {
                let fs = if s(a, "fs")? == "ofs" { FsKind::Ofs } else { FsKind::Ffs };
                let d = if s(a, "density")? == "high" { Density::High } else { Density::Double };
                j(lib.create_blank_adf(s(a, "name")?, fs, bo(a, "international", false), d)?)
            }
            "media_working_copy" => j(lib.make_working_copy(s(a, "id")?, s(a, "name")?, &CancelToken::new())?),
            "media_export" => {
                lib.export_media(s(a, "id")?, &abs(s(a, "dest")?)?, bo(a, "overwrite", false), &CancelToken::new())?;
                j(true)
            }
            "media_delete" => j(lib.delete_media(s(a, "id")?)?),
            "media_verify" => j(lib.verify_media(s(a, "id")?, &CancelToken::new())?),
            "queue_list" => j(lib.list_queues()?),
            "queue_save" => {
                let ids: Vec<String> = from(a, "media_ids")?;
                j(lib.save_queue(so(a, "id"), s(a, "name")?, &ids)?)
            }
            "queue_delete" => j(lib.delete_queue(s(a, "id")?)?),

            // ---------- Workbench ----------
            "workbench_analyse" => {
                let ids: Vec<String> = from(a, "media_ids")?;
                j(lib.analyse_workbench_set(s(a, "name")?, &ids)?)
            }
            "workbench_save" => {
                let set: amiga_core::library::WorkbenchSet = from(a, "set")?;
                lib.save_workbench_set(&set)?;
                j(true)
            }
            "workbench_list" => j(lib.list_workbench_sets()?),
            "workbench_delete" => j(lib.delete_workbench_set(s(a, "id")?)?),
            "workbench_kickstart_check" => {
                let rom = lib.get_rom(s(a, "rom_id")?)?;
                let ver: amiga_core::library::WbVersion = from(a, "version")?;
                j(rom.info.exec_version.and_then(|v| amiga_core::library::kickstart_compat_warning(ver, v)))
            }

            // ---------- hard disks ----------
            "hdf_estimate" => j(lib.estimate_hdf_import(&abs(s(a, "path")?)?, bo(a, "keep_pristine", true))?),
            "hdf_inspect" => j(amiga_core::hdf::inspect_file(&abs(s(a, "path")?)?)?),
            "hdf_import" => {
                let src = abs(s(a, "path")?)?;
                let name = s(a, "name")?.to_string();
                let opts = HdfImportOptions {
                    keep_pristine: bo(a, "keep_pristine", true),
                    accept_unrecognised: bo(a, "accept_unrecognised", false),
                };
                let lib = self.lib.clone();
                let id = self.jobs.spawn("hdf_import", &format!("Importing hard disk '{name}'"), move |ctx| {
                    let c = ctx.cancel_token();
                    let mut cb = |d: u64, t: u64| ctx.progress(d, t);
                    Ok(serde_json::to_value(lib.import_hdf(&src, &name, opts, &c, Some(&mut cb))?).unwrap())
                });
                j(json!({ "job": id }))
            }
            "hdf_list" => j(lib.list_hdfs()?),
            "hdf_snapshots" => j(lib.list_snapshots(s(a, "id")?)?),
            "hdf_backup" => {
                let kind = match s(a, "kind")? {
                    "snapshot" => SnapshotKind::Snapshot,
                    _ => SnapshotKind::Backup,
                };
                let (id, note) = (s(a, "id")?.to_string(), s(a, "note").unwrap_or("").to_string());
                self.reject_if_hdf_running(&id)?;
                let lib = self.lib.clone();
                let jid = self.jobs.spawn("hdf_backup", "Backing up hard disk", move |ctx| {
                    let c = ctx.cancel_token();
                    let mut cb = |d: u64, t: u64| ctx.progress(d, t);
                    Ok(serde_json::to_value(lib.backup_hdf(&id, kind, &note, &c, Some(&mut cb))?).unwrap())
                });
                j(json!({ "job": jid }))
            }
            "hdf_restore" => {
                let (id, snap) = (s(a, "id")?.to_string(), s(a, "snapshot_id")?.to_string());
                self.reject_if_hdf_running(&id)?;
                let lib = self.lib.clone();
                let jid = self.jobs.spawn("hdf_restore", "Restoring hard disk", move |ctx| {
                    let c = ctx.cancel_token();
                    let mut cb = |d: u64, t: u64| ctx.progress(d, t);
                    lib.restore_hdf(&id, &snap, &c, Some(&mut cb))?;
                    Ok(Value::Bool(true))
                });
                j(json!({ "job": jid }))
            }
            "hdf_export" => {
                let (id, dest, ow) = (s(a, "id")?.to_string(), abs(s(a, "dest")?)?, bo(a, "overwrite", false));
                self.reject_if_hdf_running(&id)?;
                let lib = self.lib.clone();
                let jid = self.jobs.spawn("hdf_export", "Exporting hard disk", move |ctx| {
                    let c = ctx.cancel_token();
                    let mut cb = |d: u64, t: u64| ctx.progress(d, t);
                    lib.export_hdf(&id, &dest, ow, &c, Some(&mut cb))?;
                    Ok(Value::Bool(true))
                });
                j(json!({ "job": jid }))
            }
            "hdf_delete" => {
                self.reject_if_hdf_running(s(a, "id")?)?;
                j(lib.delete_hdf(s(a, "id")?)?)
            }
            "snapshot_delete" => j(lib.delete_snapshot(s(a, "id")?)?),

            // ---------- profiles ----------
            "preset_list" => j(profiles::presets()),
            "profile_list" => j(lib.list_profiles()?),
            "profile_get" => j(lib.get_profile(s(a, "id")?)?),
            "profile_from_preset" => {
                let id = amiga_core::fsutil::random_id();
                j(profiles::from_preset(s(a, "preset_id")?, id, s(a, "name")?.to_string())
                    .ok_or_else(|| Error::NotFound("preset".into()))?)
            }
            "profile_validate" => {
                let p: MachineProfile = from(a, "profile")?;
                let rom = p.rom_id.as_ref().and_then(|id| lib.get_rom(id).ok());
                j(profiles::validate(&p, rom.as_ref().map(|r| &r.info)))
            }
            "profile_save" => {
                let p: MachineProfile = from(a, "profile")?;
                j(lib.save_profile(&p)?)
            }
            "profile_clone" => j(lib.clone_profile(s(a, "id")?, s(a, "name")?)?),
            "profile_delete" => {
                if self
                    .sessions
                    .active
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|x| x.profile.id == s(a, "id").unwrap_or(""))
                {
                    return Err(Error::Locked("this machine is running".into()));
                }
                j(lib.delete_profile(s(a, "id")?)?)
            }
            "sessions_recent" => j(lib.recent_sessions(10)?),

            // ---------- disk tools ----------
            "copy_disk" => {
                let src: CopySource = from(a, "source")?;
                let dst: CopyTarget = from(a, "target")?;
                let opts: CopyOptions = from(a, "options").unwrap_or_default();
                let in_use =
                    self.sessions.active.lock().unwrap().as_ref().map(session::inserted_paths).unwrap_or_default();
                let lib = self.lib.clone();
                let id = self.jobs.spawn("copy_disk", "Copying disk", move |ctx| {
                    let c = ctx.cancel_token();
                    let mut cb = |d: u64, t: u64| ctx.progress(d, t);
                    Ok(serde_json::to_value(lib.copy_disk(&src, &dst, &opts, &in_use, &c, Some(&mut cb))?).unwrap())
                });
                j(json!({ "job": id }))
            }
            "operations_list" => j(lib.list_operations(50)?),

            // ---------- jobs ----------
            "job_get" => j(self.jobs.get(s(a, "id")?).ok_or_else(|| Error::NotFound("job".into()))?),
            "jobs_list" => j(self.jobs.list()),
            "job_cancel" => j(self.jobs.cancel(s(a, "id")?)),

            // ---------- emulator session ----------
            "session_start" => self.session_start(s(a, "profile_id")?, so(a, "mode")),
            "session_stop" => self.session_stop(),
            "session_status" => j(session::status(&self.sessions.active, amiga_core::ipc::runtime_control_supported())),
            "session_control" => self.session_control(a),
            "session_drives" => self.with_session(|x| j(session::drives(lib, x)?)),
            "session_insert" => self.session_insert(a),
            "session_eject" => {
                let unit =
                    a.get("unit").and_then(Value::as_u64).filter(|u| *u < 4).ok_or_else(|| bad("unit must be 0-3"))?
                        as u8;
                self.with_session(|x| {
                    if let Some(e) = x.session.embedded() {
                        embedded_df0_only(unit)?;
                        e.handle.eject_df0().map_err(|e| Error::Emulator(e.to_string()))?;
                        *e.df0.lock().unwrap() = None;
                        return j(true);
                    }
                    session::control(x)?.eject_floppy(unit)?;
                    j(true)
                })
            }
            "session_screenshot" => self.session_screenshot(),
            "session_frame" => self.session_frame(a),
            "session_input" => self.session_input(a),
            "session_copy_drive" => self.session_copy_drive(a),
            "session_perf" => self.with_session(|x| {
                if let Some(e) = x.session.embedded() {
                    let st = e.handle.stats();
                    return j(json!({
                        "fps": { "emulated": format!("{:.1}", st.measured_fps), "target": format!("{:.1}", st.fps_target) },
                        "leds": {},
                        "uptime_s": x.session.started().elapsed().as_secs(),
                        "frames": st.frames_run,
                    }));
                }
                let c = session::control(x)?;
                let fps: serde_json::Map<String, Value> =
                    c.fps()?.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
                let leds: serde_json::Map<String, Value> =
                    c.led_status()?.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
                j(json!({ "fps": fps, "leds": leds, "uptime_s": x.session.started().elapsed().as_secs() }))
            }),
            "session_save_state" => self.session_state(a, true),
            "session_load_state" => self.session_state(a, false),
            _ => Err(Error::NotFound(format!("unknown command '{cmd}'"))),
        }
    }

    /// Is an emulator process currently running?
    pub fn machine_running(&self) -> bool {
        self.sessions.active.lock().unwrap().as_mut().is_some_and(|a| a.session.is_running())
    }

    /// Stop any running machine safely (clean quit, flush disks, release locks).
    /// Call from the application's exit path.
    pub fn shutdown(&self) {
        if let Some(a) = self.sessions.active.lock().unwrap().take() {
            let _ = session::stop(&self.lib, a);
        }
    }

    fn with_session<T>(&self, f: impl FnOnce(&session::ActiveSession) -> Result<T>) -> Result<T> {
        let g = self.sessions.active.lock().unwrap();
        match g.as_ref() {
            Some(x) => f(x),
            None => Err(Error::NotFound("no machine is running".into())),
        }
    }

    fn reject_if_hdf_running(&self, id: &str) -> Result<()> {
        if self.sessions.active.lock().unwrap().as_ref().is_some_and(|x| x.guards.iter().any(|g| g.hdf_id == id)) {
            return Err(Error::Locked("this hard disk is in use by the running machine; shut it down first".into()));
        }
        Ok(())
    }

    fn storage_location(&self) -> Value {
        let pointer = self.bootstrap_dir.as_deref().and_then(Layout::read_pointer);
        json!({
            "current": self.lib.layout.root.display().to_string(),
            "default": Layout::default_root(None).display().to_string(),
            "pointer": pointer.as_ref().map(|p| p.display().to_string()),
            "can_change": self.bootstrap_dir.is_some(),
            "restart_required": pointer.as_ref().is_some_and(|p| p != &self.lib.layout.root),
        })
    }

    /// Remember a new storage location; it takes effect after a restart. Existing
    /// data is NOT moved or deleted - the old folder stays exactly as it is.
    fn storage_set_location(&self, path: &str) -> Result<Value> {
        let boot = self
            .bootstrap_dir
            .as_deref()
            .ok_or_else(|| Error::Unsupported("this build cannot change the storage location".into()))?;
        let p = abs(path)?;
        if p.to_string_lossy().contains(',') {
            return Err(bad(
                "choose a folder whose path has no commas (the emulator's hard disk syntax cannot express them)",
            ));
        }
        if p.starts_with(&self.lib.layout.root) && p != self.lib.layout.root {
            return Err(bad("choose a folder outside the current library"));
        }
        std::fs::create_dir_all(&p)?;
        let probe = p.join(".amiga-studio-write-test");
        std::fs::write(&probe, b"ok").map_err(|_| bad("that folder is not writable"))?;
        let _ = std::fs::remove_file(&probe);
        Layout::write_pointer(boot, &p)?;
        j(self.storage_location())
    }

    fn session_start(self: &Arc<Self>, profile_id: &str, mode: Option<&str>) -> Result<Value> {
        {
            let mut g = self.sessions.active.lock().unwrap();
            if let Some(x) = g.as_mut() {
                if x.session.is_running() {
                    return Err(Error::Locked("a machine is already running; shut it down first".into()));
                }
            }
            if let Some(dead) = g.take() {
                let clean = false;
                session::finish(&self.lib, dead, clean);
            }
        }
        let mode = match mode {
            Some(m) => m.to_string(),
            None => self.lib.get_setting("run_mode")?.unwrap_or_else(|| "process".into()),
        };
        let eng = self.engine();
        let core = match mode.as_str() {
            "embedded" => Some(self.retro_core().ok_or_else(|| {
                Error::NotFound(
                    "The Amiberry libretro core was not found. Put it next to the emulator or set its location in Settings."
                        .into(),
                )
            })?),
            "process" => None,
            other => return Err(bad(format!("unknown run mode '{other}'"))),
        };
        let eng_ref = match (&eng, &core) {
            (Ok(e), _) => Some(e),
            (Err(_), Some(_)) => None,
            (Err(e), None) => return Err(Error::NotFound(e.to_string())),
        };
        let ctx = session::StartContext {
            lib: &self.lib,
            engine: eng_ref,
            env: &self.launch_env,
            embedded_core: core.as_deref(),
        };
        let active = session::start(&ctx, profile_id)?;
        let warnings = active.warnings.clone();
        *self.sessions.active.lock().unwrap() = Some(active);
        // supervisor: finish bookkeeping if the user closes the emulator window
        let me = self.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            let mut g = me.sessions.active.lock().unwrap();
            match g.as_mut() {
                None => return,
                Some(x) => {
                    if let Some(ok) = x.session.exited() {
                        let a = g.take().unwrap();
                        drop(g);
                        session::finish(&me.lib, a, ok);
                        return;
                    }
                }
            }
        });
        j(json!({ "started": true, "warnings": warnings }))
    }

    fn session_stop(&self) -> Result<Value> {
        let a = self
            .sessions
            .active
            .lock()
            .unwrap()
            .take()
            .ok_or_else(|| Error::NotFound("no machine is running".into()))?;
        let outcome = session::stop(&self.lib, a);
        j(json!({ "outcome": outcome }))
    }

    fn session_control(&self, a: &Value) -> Result<Value> {
        let action = s(a, "action")?.to_string();
        self.with_session(|x| {
            if let Some(e) = x.session.embedded() {
                match action.as_str() {
                    "pause" => e.handle.pause(),
                    "resume" => e.handle.resume(),
                    // libretro exposes one reset; it is the equivalent of the emulator's hard reset.
                    "reset_soft" | "reset_hard" => e.handle.reset().map_err(|e| Error::Emulator(e.to_string()))?,
                    "toggle_fullscreen" | "toggle_mouse_grab" | "mute" | "volume" => {
                        return Err(Error::Unsupported(
                            "This control is not available when the machine runs inside Amiga Studio.".into(),
                        ))
                    }
                    other => return Err(bad(format!("unknown action '{other}'"))),
                }
                return j(true);
            }
            let c = session::control(x)?;
            match action.as_str() {
                "pause" => c.pause()?,
                "resume" => c.resume()?,
                "reset_soft" => c.reset(false)?,
                "reset_hard" => c.reset(true)?,
                "toggle_fullscreen" => c.toggle_fullscreen()?,
                "toggle_mouse_grab" => c.toggle_mouse_grab()?,
                "mute" => c.mute()?,
                "volume" => {
                    let v = a
                        .get("value")
                        .and_then(Value::as_u64)
                        .filter(|v| *v <= 100)
                        .ok_or_else(|| bad("volume must be 0-100"))?;
                    c.set_volume(v as u32)?
                }
                other => return Err(bad(format!("unknown action '{other}'"))),
            }
            j(true)
        })
    }

    fn session_insert(&self, a: &Value) -> Result<Value> {
        let unit =
            a.get("unit").and_then(Value::as_u64).filter(|u| *u < 4).ok_or_else(|| bad("unit must be 0-3"))? as u8;
        let m = self.lib.get_media(s(a, "media_id")?)?;
        if m.missing {
            return Err(Error::NotFound("that disk's file is missing from the library".into()));
        }
        if m.kind != amiga_core::library::MediaKind::Adf {
            return Err(bad("only disk images (ADF) can be inserted"));
        }
        self.with_session(|x| {
            if let Some(e) = x.session.embedded() {
                embedded_df0_only(unit)?;
                // The libretro disk interface has no write-protect switch, so an untouched original could
                // be modified by the guest. Refuse instead of risking it.
                if m.pristine || bo(a, "write_protect", false) {
                    return Err(bad(
                        "This mode cannot write protect a disk. Insert a working copy (Make working copy in Disks) instead.",
                    ));
                }
                if session::inserted_paths(x).contains(&m.path) {
                    return Err(bad("that disk is already in a drive; use a working copy for a second drive"));
                }
                e.handle.insert_df0(&m.path).map_err(|e| Error::Emulator(e.to_string()))?;
                *e.df0.lock().unwrap() = Some(m.path.clone());
                let _ = self.lib.touch_media(&m.id);
                return j(true);
            }
            let c = session::control(x)?;
            let busy = session::inserted_paths(x);
            if busy.contains(&m.path) {
                return Err(bad("that disk is already in a drive; use a working copy for a second drive"));
            }
            c.insert_floppy(unit, &m.path)?;
            if m.pristine || bo(a, "write_protect", false) {
                c.set_write_protect(unit, true)?;
            }
            let _ = self.lib.touch_media(&m.id);
            j(true)
        })
    }

    fn session_screenshot(&self) -> Result<Value> {
        if let Some(png) = self.with_session(|x| {
            Ok(match x.session.embedded() {
                Some(e) => Some(e.handle.screenshot_png().ok_or_else(|| Error::Emulator("no picture yet".into()))?),
                None => None,
            })
        })? {
            return j(json!({ "png_base64": base64::engine::general_purpose::STANDARD.encode(png) }));
        }
        let path = self.lib.layout.runtime().join(format!("shot-{}.png", amiga_core::fsutil::random_id()));
        self.with_session(|x| session::control(x)?.screenshot(&path))?;
        let end = std::time::Instant::now() + Duration::from_secs(4);
        while !path.exists() && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(50));
        }
        std::thread::sleep(Duration::from_millis(100));
        let bytes =
            std::fs::read(&path).map_err(|_| Error::Emulator("the emulator did not produce a screenshot".into()))?;
        let _ = std::fs::remove_file(&path);
        j(json!({ "png_base64": base64::engine::general_purpose::STANDARD.encode(bytes) }))
    }

    /// Latest picture of an embedded machine; `{ "unchanged": true }` if nothing new since `since`.
    fn session_frame(&self, a: &Value) -> Result<Value> {
        let since = a.get("since").and_then(Value::as_u64).unwrap_or(u64::MAX);
        self.with_session(|x| {
            let e = x.session.embedded().ok_or_else(|| {
                Error::Unsupported("The picture is only available when the machine runs inside Amiga Studio.".into())
            })?;
            let seq = e.handle.frame_seq();
            if seq == since || seq == 0 {
                return j(json!({ "unchanged": true, "seq": seq }));
            }
            let f = e.handle.frame().ok_or_else(|| Error::Emulator("no picture yet".into()))?;
            let png = e.handle.screenshot_png().ok_or_else(|| Error::Emulator("no picture yet".into()))?;
            j(json!({
                "seq": f.seq,
                "width": f.width,
                "height": f.height,
                "png_base64": base64::engine::general_purpose::STANDARD.encode(png),
            }))
        })
    }

    /// Keyboard / mouse / joystick events for an embedded machine.
    fn session_input(&self, a: &Value) -> Result<Value> {
        let events = a.get("events").and_then(Value::as_array).ok_or_else(|| bad("missing list 'events'"))?;
        if events.len() > 256 {
            return Err(bad("too many input events in one call"));
        }
        self.with_session(|x| {
            let e = x.session.embedded().ok_or_else(|| {
                Error::Unsupported("Input is only injected when the machine runs inside Amiga Studio.".into())
            })?;
            let n = |v: &Value, k: &str| {
                v.get(k).and_then(Value::as_i64).ok_or_else(|| bad(format!("missing number '{k}'")))
            };
            for ev in events {
                let down = ev.get("down").and_then(Value::as_bool).unwrap_or(true);
                match ev.get("kind").and_then(Value::as_str).unwrap_or("") {
                    "key" => e.handle.key(u32::try_from(n(ev, "code")?).map_err(|_| bad("bad key code"))?, down),
                    "mouse_move" => e
                        .handle
                        .mouse_move(n(ev, "dx")?.clamp(-4096, 4096) as i32, n(ev, "dy")?.clamp(-4096, 4096) as i32),
                    "mouse_button" => e.handle.mouse_button(n(ev, "button")?.clamp(0, 2) as usize, down),
                    "joypad" => {
                        e.handle.joypad(n(ev, "port")?.clamp(0, 1) as usize, n(ev, "id")?.clamp(0, 15) as usize, down)
                    }
                    other => return Err(bad(format!("unknown input kind '{other}'"))),
                }
            }
            j(true)
        })
    }

    fn session_state(&self, a: &Value, save: bool) -> Result<Value> {
        let name: String = s(a, "name")?
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
            .collect();
        if name.is_empty() {
            return Err(bad("give the saved state a name (letters and numbers)"));
        }
        let dir = self.lib.layout.snapshots().join("states");
        std::fs::create_dir_all(&dir)?;
        let state = dir.join(format!("{name}.uss"));
        let cfg = dir.join(format!("{name}.uae"));
        let rstate = dir.join(format!("{name}.retrostate"));
        let note = "A saved state captures the emulator's memory only. Hard disk and floppy contents are NOT rolled back; restoring a state after the disk changed can corrupt it. Take a hard-disk snapshot first if you need both.";
        if self.with_session(|x| Ok(x.session.embedded().is_some()))? {
            // States made by the embedded core are in the core's own format (different from the standalone
            // emulator's .uss), so they carry their own extension.
            self.with_session(|x| {
                let e = x.session.embedded().unwrap();
                // Verified against the Amiberry 8.4.0 libretro core: restoring a state of a machine with an
                // IDE hard disk crashes inside the core (SIGSEGV in restore_gayle_ide), which would take the
                // whole app down. So states are refused for such machines instead of offered and lost.
                if !x.profile.hard_disks.is_empty() {
                    return Err(Error::Unsupported(
                        "Saved states are not available for machines with hard disks in this mode (the emulator core crashes when restoring them). Use the machine's own window mode, or a floppy-only machine.".into(),
                    ));
                }
                if save {
                    let data = e.handle.save_state().map_err(|e| Error::Emulator(e.to_string()))?;
                    amiga_core::fsutil::write_atomic(&rstate, &dir, &data, true)?;
                } else {
                    if !rstate.exists() {
                        return Err(Error::NotFound("no saved state with that name (made in this mode)".into()));
                    }
                    if std::fs::metadata(&rstate)?.len() > 512 * 1024 * 1024 {
                        return Err(bad("that saved state is implausibly large"));
                    }
                    e.handle.load_state(std::fs::read(&rstate)?).map_err(|e| Error::Emulator(e.to_string()))?;
                }
                Ok(())
            })?;
            return j(json!({ "path": rstate.display().to_string(), "note": note }));
        }
        self.with_session(|x| {
            let c = session::control(x)?;
            if save {
                if x.guards.iter().any(|g| !g.working_path.as_os_str().is_empty()) {
                    // A state captures emulator memory only. Make that explicit.
                }
                c.save_state(&state, &cfg)?;
            } else {
                if !state.exists() {
                    return Err(Error::NotFound("no saved state with that name".into()));
                }
                c.load_state(&state)?;
            }
            Ok(())
        })?;
        j(json!({
            "path": state.display().to_string(),
            "note": "A saved state captures the emulator's memory only. Hard disk and floppy contents are NOT rolled back; restoring a state after the disk changed can corrupt it. Take a hard-disk snapshot first if you need both."
        }))
    }

    /// Real DFx -> DFy duplication on the host with both images safely flushed.
    fn session_copy_drive(self: &Arc<Self>, a: &Value) -> Result<Value> {
        let su =
            a.get("src_unit").and_then(Value::as_u64).filter(|u| *u < 4).ok_or_else(|| bad("src_unit must be 0-3"))?
                as u8;
        let du =
            a.get("dst_unit").and_then(Value::as_u64).filter(|u| *u < 4).ok_or_else(|| bad("dst_unit must be 0-3"))?
                as u8;
        if su == du {
            return Err(bad("choose two different drives"));
        }
        if self.with_session(|x| Ok(x.session.embedded().is_some()))? {
            return Err(Error::Unsupported(
                "Drive-to-drive copying needs to read which disk is in each drive, which this mode cannot do. Use Disks > Copy, or run the machine in its own window."
                    .into(),
            ));
        }
        let new_name = so(a, "new_name").map(str::to_string);
        let verify = bo(a, "verify", true);
        let me = self.clone();
        let id = self.jobs.spawn("copy_drive", &format!("Copying DF{su}: to DF{du}:"), move |ctx| {
            let c = ctx.cancel_token();
            let (src_path, dst_path) = me.with_session(|x| {
                let st = session::control(x)?.drive_state()?;
                let get = |u: u8| st.iter().find(|(k, _)| *k == format!("DF{u}_disk")).map(|(_, v)| v.clone()).filter(|v| v != "<empty>");
                Ok((get(su), get(du)))
            })?;
            let src_path = src_path.ok_or_else(|| Error::NotFound(format!("DF{su}: is empty")))?;
            let media = me.lib.list_media()?;
            let src_rec = media.iter().find(|m| m.path.to_string_lossy() == src_path).ok_or_else(|| bad("the disk in the source drive is not from the library"))?.clone();
            let target = match &dst_path {
                Some(p) => {
                    let rec = media.iter().find(|m| m.path.to_string_lossy() == *p).ok_or_else(|| bad("the disk in the destination drive is not from the library"))?;
                    if rec.pristine {
                        return Err(bad("the destination disk is an untouched original. Eject it, or insert a working copy or blank disk."));
                    }
                    CopyTarget::Library { media_id: rec.id.clone() }
                }
                None => CopyTarget::NewLibraryImage { name: new_name.unwrap_or_else(|| format!("Copy of {}", src_rec.name)) },
            };
            // eject both so the emulator flushes them, copy on the host, put them back
            me.with_session(|x| {
                let c = session::control(x)?;
                c.eject_floppy(su)?;
                if dst_path.is_some() {
                    c.eject_floppy(du)?;
                }
                Ok(())
            })?;
            std::thread::sleep(Duration::from_millis(1500));
            let mut cb = |d: u64, t: u64| ctx.progress(d, t);
            let rep = me.lib.copy_disk(
                &CopySource::Library { media_id: src_rec.id.clone() },
                &target,
                &CopyOptions { verify, overwrite: dst_path.is_some(), backup_existing: true },
                &Default::default(),
                &c,
                Some(&mut cb),
            );
            // always re-insert, even if the copy failed
            let dest_media = rep.as_ref().ok().and_then(|r| r.destination_media_id.clone());
            let reinsert = me.with_session(|x| {
                let ctl = session::control(x)?;
                ctl.insert_floppy(su, std::path::Path::new(&src_path))?;
                if src_rec.pristine {
                    ctl.set_write_protect(su, true)?;
                }
                let back = match (&dest_media, &dst_path) {
                    (Some(id), _) => Some(me.lib.get_media(id)?.path),
                    (None, Some(p)) => Some(PathBuf::from(p)),
                    _ => None,
                };
                if let Some(p) = back {
                    ctl.insert_floppy(du, &p)?;
                }
                Ok(())
            });
            let rep = rep?;
            reinsert?;
            Ok(serde_json::to_value(rep).unwrap())
        });
        j(json!({ "job": id }))
    }
}

fn embedded_df0_only(unit: u8) -> Result<()> {
    if unit == 0 {
        Ok(())
    } else {
        Err(Error::Unsupported(
            "In this mode only DF0: can be swapped while the machine runs (a limit of the emulator core). Use the machine's own window mode to swap DF1-DF3.".into(),
        ))
    }
}

/// Helper for tests/CLI: is this path inside the library root?
pub fn inside(root: &Path, p: &Path) -> bool {
    p.starts_with(root)
}

#[cfg(test)]
mod tests;
