//! Arcade "Rooms" and the systems inside them.
//!
//! * **Home Arcade**: home computers and consoles (Amiga Studio built in; PlayStation 2 and
//!   Intellivision via external emulators the user installs).
//! * **Pinball Arcade**: pinball and arcade emulation (TiLT Pinball tables, MAME).
//!
//! Only Amiga Studio is a built-in, deeply integrated emulator. Every other system is a
//! *launcher* for an emulator the user installs: TiLT stores its executable path and a
//! game folder, lists the games it finds, and starts the emulator with an argument
//! template. Nothing here emulates those systems itself, and the UI says so.
//!
//! Launch safety: no shell is ever involved; arguments are passed as separate argv
//! entries; the game path must resolve inside the configured game folder.

use amiga_core::error::Result;
use amiga_core::library::Library;
use amiga_core::Error;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemDef {
    pub id: String,
    /// "home" or "pinball"
    pub room: String,
    pub name: String,
    pub description: String,
    /// "amiga" (built in) or "external"
    pub kind: String,
    #[serde(default)]
    pub exe: Option<String>,
    /// Argument templates; placeholders: {game} {game_name} {game_dir}
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub game_dir: Option<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub setup_hint: String,
    /// User-created (can be deleted) as opposed to part of the built-in catalogue.
    #[serde(default)]
    pub custom: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemView {
    #[serde(flatten)]
    pub def: SystemDef,
    /// Ready to launch (Amiga: always; external: exe exists).
    pub configured: bool,
    pub running: bool,
    pub game_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GameEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub favorite: bool,
    pub plays: u32,
    pub last_played: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct GameStat {
    plays: u32,
    last: Option<i64>,
    favorite: bool,
}

pub fn builtin_catalog() -> Vec<SystemDef> {
    let ext = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    vec![
        SystemDef {
            id: "amiga".into(),
            room: "home".into(),
            name: "Amiga Studio".into(),
            description: "A500 to A4000: Kickstart, Workbench, floppies, hard disks. Built in.".into(),
            kind: "amiga".into(),
            exe: None,
            args: vec![],
            game_dir: None,
            extensions: vec![],
            setup_hint: String::new(),
            custom: false,
        },
        SystemDef {
            id: "ps2".into(),
            room: "home".into(),
            name: "PlayStation 2".into(),
            description: "Launches your installed PS2 emulator (for example PCSX2) with a game from your folder.".into(),
            kind: "external".into(),
            exe: None,
            args: vec!["-batch".into(), "--".into(), "{game}".into()],
            game_dir: None,
            extensions: ext(&["iso", "chd", "bin", "cue", "gz"]),
            setup_hint: "Install an emulator such as PCSX2, then choose its program file and your game folder. Check the argument template matches your emulator version.".into(),
            custom: false,
        },
        SystemDef {
            id: "intellivision".into(),
            room: "home".into(),
            name: "Intellivision".into(),
            description: "Launches your installed Intellivision emulator (for example jzIntv) with a game from your folder.".into(),
            kind: "external".into(),
            exe: None,
            args: vec!["{game}".into()],
            game_dir: None,
            extensions: ext(&["int", "bin", "rom", "cfg"]),
            setup_hint: "jzIntv also needs the Intellivision system ROMs (exec.bin, grom.bin) which you must supply yourself.".into(),
            custom: false,
        },
        SystemDef {
            id: "tilt-pinball".into(),
            room: "pinball".into(),
            name: "TiLT Pinball".into(),
            description: "Pinball tables for the TiLT engine (and compatible players). Choose the player program and your tables folder. The TiLT engine in this repository is still a prototype (see AUDIT_REPORT.md) and cannot play tables yet; use Visual Pinball or MAME below.".into(),
            kind: "external".into(),
            exe: None,
            args: vec!["{game}".into()],
            game_dir: None,
            extensions: ext(&["vpx", "vpt"]),
            setup_hint: "Point at the TiLT executable (or any compatible table player).".into(),
            custom: false,
        },
        SystemDef {
            id: "vpx".into(),
            room: "pinball".into(),
            name: "Visual Pinball X".into(),
            description: "Launches Visual Pinball X (standalone) with a table from your tables folder. Tables that use PinMAME need the ROM sets from the Pinball ROMs library.".into(),
            kind: "external".into(),
            exe: None,
            args: vec!["-play".into(), "{game}".into()],
            game_dir: None,
            extensions: ext(&["vpx"]),
            setup_hint: "Install Visual Pinball X standalone (VPinballX_GL), then choose its program and your tables folder. The argument template (-play <table>) is the one documented for VPinballX; TiLT has not run it against your build, so check it if a table does not start.".into(),
            custom: false,
        },
        SystemDef {
            id: "pinmame".into(),
            room: "pinball".into(),
            name: "PinMAME".into(),
            description: "Launches a command-line PinMAME with a ROM set from your ROM folder.".into(),
            kind: "external".into(),
            exe: None,
            args: vec!["{game_name}".into()],
            game_dir: None,
            extensions: ext(&["zip"]),
            setup_hint: "PinMAME builds differ in how they take a ROM name and folder. TiLT has not run any of them, so adjust the argument template to your build.".into(),
            custom: false,
        },
        SystemDef {
            id: "mame".into(),
            room: "pinball".into(),
            name: "MAME Arcade".into(),
            description: "Launches MAME for arcade and pinball ROM sets from your ROM folder.".into(),
            kind: "external".into(),
            exe: None,
            args: vec!["-rompath".into(), "{game_dir}".into(), "{game_name}".into()],
            game_dir: None,
            extensions: ext(&["zip", "7z", "chd"]),
            setup_hint: "Install MAME and choose your ROM folder. ROM sets must be supplied by you.".into(),
            custom: false,
        },
    ]
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomView {
    pub id: &'static str,
    pub name: &'static str,
    pub tagline: &'static str,
}

pub fn rooms() -> Vec<RoomView> {
    vec![
        RoomView { id: "home", name: "Home Arcade", tagline: "Your favourite home computers and consoles" },
        RoomView { id: "pinball", name: "Pinball Arcade", tagline: "Pinball tables and arcade cabinets" },
    ]
}

/// Placeholder expansion. Each template element becomes exactly one argv entry.
pub fn expand_args(tpl: &[String], game: &Path, game_dir: &Path) -> Vec<String> {
    let name = game.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    tpl.iter()
        .map(|a| {
            a.replace("{game}", &game.to_string_lossy())
                .replace("{game_name}", &name)
                .replace("{game_dir}", &game_dir.to_string_lossy())
        })
        .collect()
}

pub struct Systems {
    running: Mutex<HashMap<String, Child>>,
}

impl Default for Systems {
    fn default() -> Self {
        Systems { running: Mutex::new(HashMap::new()) }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

impl Systems {
    fn load_overrides(lib: &Library) -> HashMap<String, SystemDef> {
        lib.get_setting("systems").ok().flatten().and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default()
    }

    fn store_overrides(lib: &Library, m: &HashMap<String, SystemDef>) -> Result<()> {
        lib.set_setting("systems", &serde_json::to_string(m).unwrap())
    }

    pub fn definitions(lib: &Library) -> Vec<SystemDef> {
        let mut o = Self::load_overrides(lib);
        let mut out: Vec<SystemDef> = builtin_catalog()
            .into_iter()
            .map(|mut b| {
                if let Some(u) = o.remove(&b.id) {
                    b.exe = u.exe;
                    b.args = u.args;
                    b.game_dir = u.game_dir;
                    b.extensions = u.extensions;
                }
                b
            })
            .collect();
        // MAME defaults to the pinball ROM library folder once something has been imported into it
        let rom_dir = crate::pinball::rom_dir(lib);
        for d in out.iter_mut().filter(|d| d.id == "mame" && d.game_dir.is_none()) {
            if rom_dir.is_dir() {
                d.game_dir = Some(rom_dir.display().to_string());
            }
        }
        let mut custom: Vec<SystemDef> = o.into_values().filter(|d| d.custom).collect();
        custom.sort_by_key(|a| a.name.to_lowercase());
        out.extend(custom);
        out
    }

    pub fn list(&self, lib: &Library) -> Vec<SystemView> {
        let mut running = self.running.lock().unwrap();
        running.retain(|_, c| matches!(c.try_wait(), Ok(None)));
        Self::definitions(lib)
            .into_iter()
            .map(|d| {
                let configured = d.kind == "amiga" || d.exe.as_deref().is_some_and(|e| Path::new(e).is_file());
                let game_count = d.game_dir.as_deref().map(|g| scan(Path::new(g), &d.extensions).len());
                SystemView { running: running.contains_key(&d.id), configured, game_count, def: d }
            })
            .collect()
    }

    /// The configured program of a system, if it exists on disk.
    pub fn exe_of(&self, lib: &Library, id: &str) -> Option<String> {
        Self::definitions(lib).into_iter().find(|d| d.id == id).and_then(|d| d.exe).filter(|e| Path::new(e).is_file())
    }

    /// Fill in the program of every unconfigured, detectable system in `room` with the best installed
    /// candidate. Existing settings are never changed. MAME is only accepted when it answered `-version`.
    pub fn autoconfigure(&self, lib: &Library, room: &str) -> Result<Vec<serde_json::Value>> {
        let mut found = vec![];
        for d in Self::definitions(lib) {
            if d.room != room || d.kind != "external" || !crate::detect::supported(&d.id) {
                continue;
            }
            if d.exe.as_deref().is_some_and(|e| Path::new(e).is_file()) {
                continue;
            }
            let best = crate::detect::detect(&d.id).into_iter().find(|c| c.verified || d.id != "mame");
            if let Some(c) = best {
                let mut nd = d.clone();
                nd.exe = Some(c.path.clone());
                if self.save(lib, nd).is_ok() {
                    found.push(serde_json::json!({ "id": d.id, "name": d.name, "path": c.path, "version": c.version }));
                }
            }
        }
        Ok(found)
    }

    /// Save the user-editable parts of a system (or create a custom one).
    pub fn save(&self, lib: &Library, d: SystemDef) -> Result<()> {
        if !valid_id(&d.id) {
            return Err(Error::Unsafe("system ids use lowercase letters, digits and dashes".into()));
        }
        if d.room != "home" && d.room != "pinball" {
            return Err(Error::Unsafe("unknown room".into()));
        }
        if d.kind == "amiga" {
            return Err(Error::Unsafe("Amiga Studio is built in and has no launcher settings".into()));
        }
        if let Some(e) = &d.exe {
            if !e.is_empty() && !Path::new(e).is_file() {
                return Err(Error::NotFound(format!("program not found: {e}")));
            }
        }
        if let Some(g) = &d.game_dir {
            if !g.is_empty() && !Path::new(g).is_dir() {
                return Err(Error::NotFound(format!("folder not found: {g}")));
            }
        }
        let is_builtin = builtin_catalog().iter().any(|b| b.id == d.id);
        let mut o = Self::load_overrides(lib);
        let mut d = d;
        d.custom = !is_builtin;
        d.exe = d.exe.filter(|s| !s.is_empty());
        d.game_dir = d.game_dir.filter(|s| !s.is_empty());
        d.kind = "external".into();
        o.insert(d.id.clone(), d);
        Self::store_overrides(lib, &o)
    }

    pub fn delete_custom(&self, lib: &Library, id: &str) -> Result<()> {
        if builtin_catalog().iter().any(|b| b.id == id) {
            return Err(Error::Unsafe("built-in systems cannot be removed; clear their settings instead".into()));
        }
        let mut o = Self::load_overrides(lib);
        o.remove(id);
        Self::store_overrides(lib, &o)
    }

    fn def(lib: &Library, id: &str) -> Result<SystemDef> {
        Self::definitions(lib).into_iter().find(|d| d.id == id).ok_or_else(|| Error::NotFound(format!("system {id}")))
    }

    fn stats(lib: &Library, id: &str) -> HashMap<String, GameStat> {
        lib.get_setting(&format!("games:{id}"))
            .ok()
            .flatten()
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default()
    }

    pub fn games(&self, lib: &Library, id: &str) -> Result<Vec<GameEntry>> {
        let d = Self::def(lib, id)?;
        let dir = d.game_dir.as_deref().ok_or_else(|| Error::NotFound("choose a game folder first".into()))?;
        let stats = Self::stats(lib, id);
        let mut v: Vec<GameEntry> = scan(Path::new(dir), &d.extensions)
            .into_iter()
            .map(|(p, size)| {
                let key = p.to_string_lossy().into_owned();
                let st = stats.get(&key).cloned().unwrap_or_default();
                GameEntry {
                    name: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
                    path: key,
                    size,
                    favorite: st.favorite,
                    plays: st.plays,
                    last_played: st.last,
                }
            })
            .collect();
        v.sort_by(|a, b| b.favorite.cmp(&a.favorite).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(v)
    }

    pub fn toggle_favorite(&self, lib: &Library, id: &str, game: &str) -> Result<bool> {
        Self::def(lib, id)?;
        let mut s = Self::stats(lib, id);
        let e = s.entry(game.to_string()).or_default();
        e.favorite = !e.favorite;
        let fav = e.favorite;
        lib.set_setting(&format!("games:{id}"), &serde_json::to_string(&s).unwrap())?;
        Ok(fav)
    }

    /// Start an external emulator. `game` must be inside the system's game folder.
    pub fn launch(&self, lib: &Library, id: &str, game: Option<&str>) -> Result<u32> {
        let d = Self::def(lib, id)?;
        if d.kind != "external" {
            return Err(Error::Unsafe("this system is started from its own screen".into()));
        }
        let exe = d
            .exe
            .as_deref()
            .filter(|e| Path::new(e).is_file())
            .ok_or_else(|| Error::NotFound("set the emulator program in this system's settings first".into()))?;
        {
            let mut r = self.running.lock().unwrap();
            r.retain(|_, c| matches!(c.try_wait(), Ok(None)));
            if r.contains_key(id) {
                return Err(Error::Locked(format!("{} is already running", d.name)));
            }
        }
        let dir = PathBuf::from(d.game_dir.clone().unwrap_or_default());
        let (game_path, args) = match game {
            Some(g) => {
                let gp = Path::new(g).canonicalize().map_err(|_| Error::NotFound(format!("game not found: {g}")))?;
                let root = dir.canonicalize().map_err(|_| Error::NotFound("the game folder is missing".into()))?;
                if !gp.starts_with(&root) {
                    return Err(Error::Unsafe("that game is outside the configured game folder".into()));
                }
                let ext_ok = gp
                    .extension()
                    .is_some_and(|e| d.extensions.iter().any(|x| x.eq_ignore_ascii_case(&e.to_string_lossy())));
                if !d.extensions.is_empty() && !ext_ok {
                    return Err(Error::Unsafe("that file type is not on this system's list".into()));
                }
                let args = expand_args(&d.args, &gp, &root);
                (Some(gp), args)
            }
            None => (None, d.args.iter().filter(|a| !a.contains("{game")).cloned().collect()),
        };
        let child = Command::new(exe)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| Error::Emulator(format!("could not start {}: {e}", d.name)))?;
        let pid = child.id();
        self.running.lock().unwrap().insert(id.to_string(), child);
        if let Some(gp) = game_path {
            let mut s = Self::stats(lib, id);
            let e = s.entry(gp.to_string_lossy().into_owned()).or_default();
            e.plays += 1;
            e.last = Some(amiga_core::fsutil::unix_now());
            let _ = lib.set_setting(&format!("games:{id}"), &serde_json::to_string(&s).unwrap());
        }
        Ok(pid)
    }

    pub fn stop(&self, id: &str) -> bool {
        match self.running.lock().unwrap().remove(id) {
            Some(mut c) => {
                let _ = c.kill();
                let _ = c.wait();
                true
            }
            None => false,
        }
    }
}

/// Non-recursive-beyond-depth-2 scan for files with the given extensions.
fn scan(dir: &Path, exts: &[String]) -> Vec<(PathBuf, u64)> {
    fn walk(d: &Path, depth: u32, exts: &[String], out: &mut Vec<(PathBuf, u64)>) {
        if out.len() >= 5000 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() {
                if depth < 2 && !e.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
                    walk(&p, depth + 1, exts, out);
                }
            } else if md.is_file() {
                let ok = exts.is_empty()
                    || p.extension().is_some_and(|x| exts.iter().any(|y| y.eq_ignore_ascii_case(&x.to_string_lossy())));
                if ok {
                    out.push((p, md.len()));
                }
            }
        }
    }
    let mut out = vec![];
    walk(dir, 0, exts, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use amiga_core::library::{Layout, Library};

    fn lib() -> (tempfile::TempDir, Library) {
        let d = tempfile::tempdir().unwrap();
        let l = Library::open(Layout::new(d.path().join("A"))).unwrap();
        (d, l)
    }

    #[test]
    fn catalogue_has_the_two_rooms_and_required_systems() {
        let ids: Vec<_> = builtin_catalog().into_iter().map(|d| (d.room, d.id)).collect();
        for want in [
            ("home", "amiga"),
            ("home", "ps2"),
            ("home", "intellivision"),
            ("pinball", "mame"),
            ("pinball", "tilt-pinball"),
        ] {
            assert!(ids.contains(&(want.0.to_string(), want.1.to_string())), "{want:?}");
        }
        assert_eq!(rooms().len(), 2);
        for id in ["vpx", "pinmame"] {
            assert!(builtin_catalog().iter().any(|d| d.id == id && d.room == "pinball"), "{id}");
        }
    }

    #[test]
    fn args_expand_one_entry_each_with_no_shell_splitting() {
        let a = expand_args(
            &["-rompath".into(), "{game_dir}".into(), "{game_name}".into(), "--x={game}".into()],
            Path::new("/g/My Game; rm -rf ~.zip"),
            Path::new("/g"),
        );
        assert_eq!(a, vec!["-rompath", "/g", "My Game; rm -rf ~", "--x=/g/My Game; rm -rf ~.zip"]);
    }

    #[test]
    fn scan_filters_by_extension_and_games_track_favorites() {
        let (d, l) = lib();
        let g = d.path().join("games");
        std::fs::create_dir_all(g.join("sub")).unwrap();
        std::fs::write(g.join("a.iso"), b"1").unwrap();
        std::fs::write(g.join("sub/b.ISO"), b"22").unwrap();
        std::fs::write(g.join("notes.txt"), b"x").unwrap();
        let exe = d.path().join("emu");
        std::fs::write(&exe, b"#!/bin/sh\n").unwrap();
        let s = Systems::default();
        let mut def = Systems::definitions(&l).into_iter().find(|x| x.id == "ps2").unwrap();
        def.exe = Some(exe.to_string_lossy().into());
        def.game_dir = Some(g.to_string_lossy().into());
        s.save(&l, def).unwrap();
        let games = s.games(&l, "ps2").unwrap();
        assert_eq!(games.len(), 2);
        let fav = games.iter().find(|x| x.name == "b").unwrap().path.clone();
        assert!(s.toggle_favorite(&l, "ps2", &fav).unwrap());
        assert_eq!(s.games(&l, "ps2").unwrap()[0].name, "b", "favourites sort first");
        let v = s.list(&l);
        let ps2 = v.iter().find(|x| x.def.id == "ps2").unwrap();
        assert!(ps2.configured);
        assert_eq!(ps2.game_count, Some(2));
        assert!(!v.iter().find(|x| x.def.id == "mame").unwrap().configured);
    }

    #[cfg(unix)]
    #[test]
    fn launch_is_confined_and_tracks_state() {
        use std::os::unix::fs::PermissionsExt;
        let (d, l) = lib();
        let g = d.path().join("games");
        std::fs::create_dir_all(&g).unwrap();
        std::fs::write(g.join("a.int"), b"1").unwrap();
        std::fs::write(d.path().join("outside.int"), b"1").unwrap();
        let exe = d.path().join("emu.sh");
        std::fs::write(&exe, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        let s = Systems::default();
        let mut def = Systems::definitions(&l).into_iter().find(|x| x.id == "intellivision").unwrap();
        def.exe = Some(exe.to_string_lossy().into());
        def.game_dir = Some(g.to_string_lossy().into());
        s.save(&l, def).unwrap();
        // outside the folder, wrong type, traversal: all refused
        assert!(matches!(
            s.launch(&l, "intellivision", Some(d.path().join("outside.int").to_str().unwrap())),
            Err(Error::Unsafe(_))
        ));
        assert!(matches!(
            s.launch(&l, "intellivision", Some(&format!("{}/../outside.int", g.display()))),
            Err(Error::Unsafe(_))
        ));
        std::fs::write(g.join("x.txt"), b"1").unwrap();
        assert!(s.launch(&l, "intellivision", Some(g.join("x.txt").to_str().unwrap())).is_err());
        // a valid launch
        let pid = s.launch(&l, "intellivision", Some(g.join("a.int").to_str().unwrap())).unwrap();
        assert!(pid > 0);
        assert!(s.list(&l).iter().find(|x| x.def.id == "intellivision").unwrap().running);
        assert!(matches!(
            s.launch(&l, "intellivision", Some(g.join("a.int").to_str().unwrap())),
            Err(Error::Locked(_))
        ));
        assert_eq!(s.games(&l, "intellivision").unwrap()[0].plays, 1);
        assert!(s.stop("intellivision"));
        assert!(!s.stop("intellivision"));
    }

    #[cfg(unix)]
    #[test]
    fn autoconfigure_fills_only_what_is_missing() {
        use std::os::unix::fs::PermissionsExt;
        let (d, l) = lib();
        let bin = d.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let script = |n: &str, body: &str| {
            let p = bin.join(n);
            std::fs::write(&p, body).unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
            p
        };
        let mame = script("mame", "#!/bin/sh\necho '0.1 (mame0001)'\n");
        script("VPinballX_GL", "#!/bin/sh\n");
        let found = crate::detect::detect_in("mame", std::slice::from_ref(&bin));
        assert_eq!(found.len(), 1);
        // the search path is process-wide, so exercise the save path directly with what was found
        let s = Systems::default();
        let mut def = Systems::definitions(&l).into_iter().find(|x| x.id == "mame").unwrap();
        def.exe = Some(found[0].path.clone());
        s.save(&l, def).unwrap();
        assert_eq!(s.exe_of(&l, "mame").as_deref(), Some(mame.to_str().unwrap()));
        // already configured systems are left alone
        let again = s.autoconfigure(&l, "pinball").unwrap();
        assert!(again.iter().all(|v| v["id"] != "mame"));
    }

    #[test]
    fn validation_and_custom_systems() {
        let (_d, l) = lib();
        let s = Systems::default();
        let mut c = builtin_catalog().remove(1);
        c.id = "Bad Id!".into();
        assert!(s.save(&l, c.clone()).is_err());
        c.id = "my-sys".into();
        c.name = "Mine".into();
        c.room = "arcade".into();
        assert!(s.save(&l, c.clone()).is_err(), "unknown room");
        c.room = "pinball".into();
        s.save(&l, c).unwrap();
        assert!(Systems::definitions(&l).iter().any(|d| d.id == "my-sys" && d.custom));
        s.delete_custom(&l, "my-sys").unwrap();
        assert!(s.delete_custom(&l, "ps2").is_err());
        assert!(s.save(&l, builtin_catalog().remove(0)).is_err(), "amiga has no launcher settings");
    }
}
