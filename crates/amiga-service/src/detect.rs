//! Find emulators the user has already installed, so the Rooms do not start out as "choose a program".
//!
//! Only well-known program names are looked for, in the program path and in a short list of usual
//! install folders (one level of sub-folders). Nothing is executed except `mame -version`, which is the
//! one probe that is safe (it prints a line and exits); other emulators open windows, so they are
//! reported as "found, not run".

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Candidate {
    pub path: String,
    /// Output of the safe version probe, when there is one (MAME).
    pub version: Option<String>,
    /// The program answered the probe like the real emulator. `false` means "found by name only".
    pub verified: bool,
}

fn names_for(system: &str) -> &'static [&'static str] {
    match system {
        "mame" => &["mame", "mame64", "mame.exe", "mame64.exe"],
        "vpx" => {
            &["VPinballX_GL", "VPinballX_BGFX", "VPinballX_GL.exe", "VPinballX64.exe", "VPinballX.exe", "VPinballX"]
        }
        "pinmame" => &["pinmame", "PinMAME", "PinMAME32.exe", "PinMAME.exe"],
        "ps2" => &["pcsx2-qt", "pcsx2", "pcsx2-qt.exe", "pcsx2.exe", "pcsx2-qtx64.exe"],
        "intellivision" => &["jzintv", "jzintv.exe", "jzIntv.exe"],
        _ => &[],
    }
}

/// Whether TiLT knows how to look for this system's emulator.
pub fn supported(system: &str) -> bool {
    !names_for(system).is_empty()
}

/// The usual places an emulator lives, in the order they are searched. Each is checked directly and one
/// folder level down (for example `C:\Program Files\MAME\mame.exe`).
pub fn search_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = vec![];
    if let Some(p) = std::env::var_os("PATH") {
        v.extend(std::env::split_paths(&p));
    }
    let env_dir = |k: &str| std::env::var_os(k).map(PathBuf::from);
    if cfg!(windows) {
        for k in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "USERPROFILE"] {
            if let Some(d) = env_dir(k) {
                v.push(d.clone());
                v.push(d.join("Programs"));
            }
        }
        for d in ["C:\\MAME", "C:\\Visual Pinball", "C:\\vPinball", "C:\\Pinball", "C:\\Emulators"] {
            v.push(PathBuf::from(d));
        }
    } else {
        for d in [
            "/usr/games",
            "/usr/local/games",
            "/usr/local/bin",
            "/usr/bin",
            "/opt",
            "/opt/homebrew/bin",
            "/snap/bin",
            "/Applications",
        ] {
            v.push(PathBuf::from(d));
        }
        if let Some(h) = env_dir("HOME") {
            v.extend([h.join(".local/bin"), h.join("Applications"), h.join("bin"), h.join("Emulators")]);
        }
    }
    v
}

fn is_program(p: &Path) -> bool {
    let Ok(md) = std::fs::metadata(p) else { return false };
    if !md.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        md.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Look for `system`'s emulator in `dirs`. Results are de-duplicated by real path and capped.
pub fn find_in(system: &str, dirs: &[PathBuf]) -> Vec<PathBuf> {
    let names = names_for(system);
    let mut out: Vec<PathBuf> = vec![];
    let mut seen = std::collections::HashSet::new();
    let mut push = |p: PathBuf, out: &mut Vec<PathBuf>| {
        if is_program(&p) {
            let key = p.canonicalize().unwrap_or_else(|_| p.clone());
            if seen.insert(key) && out.len() < 8 {
                out.push(p);
            }
        }
    };
    for d in dirs {
        for n in names {
            push(d.join(n), &mut out);
        }
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        let mut subs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).take(400).collect();
        subs.sort();
        for s in subs {
            for n in names {
                push(s.join(n), &mut out);
                // macOS application bundles
                push(s.join("Contents/MacOS").join(n), &mut out);
            }
        }
    }
    out
}

/// Run a program and capture stdout+stderr, killing it after `timeout`. Output is read on threads so a
/// chatty program cannot fill a pipe and hang.
pub fn run_capture(exe: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start {}: {e}", exe.display()))?;
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let ho = std::thread::spawn(move || {
        let mut b = vec![];
        let _ = so.by_ref().take(8 * 1024 * 1024).read_to_end(&mut b);
        b
    });
    let he = std::thread::spawn(move || {
        let mut b = vec![];
        let _ = se.by_ref().take(1024 * 1024).read_to_end(&mut b);
        b
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("the program did not finish in time".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let mut text = String::from_utf8_lossy(&ho.join().unwrap_or_default()).into_owned();
    text.push_str(&String::from_utf8_lossy(&he.join().unwrap_or_default()));
    Ok(text)
}

/// `mame -version` prints e.g. `0.264 (mame0264)`.
pub fn mame_version(exe: &Path) -> Option<String> {
    let out = run_capture(exe, &["-version"], Duration::from_secs(10)).ok()?;
    let line = out.lines().map(str::trim).find(|l| !l.is_empty())?;
    let first = line.split_whitespace().next()?;
    (first.chars().next()?.is_ascii_digit() && first.contains('.')).then(|| line.to_string())
}

pub fn detect_in(system: &str, dirs: &[PathBuf]) -> Vec<Candidate> {
    let mut v: Vec<Candidate> = find_in(system, dirs)
        .into_iter()
        .map(|p| {
            let version = (system == "mame").then(|| mame_version(&p)).flatten();
            Candidate { path: p.display().to_string(), verified: version.is_some(), version }
        })
        .collect();
    // verified first, otherwise keep search order
    v.sort_by_key(|c| !c.verified);
    v
}

pub fn detect(system: &str) -> Vec<Candidate> {
    detect_in(system, &search_dirs())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(p: &Path, body: &str) {
        std::fs::write(p, body).unwrap();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn finds_by_name_one_level_down_and_verifies_mame_by_running_it() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("MAME")).unwrap();
        script(&d.path().join("MAME/mame"), "#!/bin/sh\necho '0.999 (mame0999)'\n");
        script(&d.path().join("VPinballX_GL"), "#!/bin/sh\nexit 0\n");
        // not executable: must not be offered
        std::fs::write(d.path().join("mame64"), "x").unwrap();
        let dirs = vec![d.path().to_path_buf()];
        let m = detect_in("mame", &dirs);
        assert_eq!(m.len(), 1);
        assert!(m[0].verified && m[0].version.as_deref() == Some("0.999 (mame0999)"), "{m:?}");
        let v = detect_in("vpx", &dirs);
        assert_eq!(v.len(), 1);
        assert!(!v[0].verified, "other emulators are found but never run");
        assert!(detect_in("ps2", &dirs).is_empty());
        assert!(detect_in("nonsense", &dirs).is_empty());
    }

    #[test]
    fn a_program_named_mame_that_is_not_mame_is_not_verified() {
        let d = tempfile::tempdir().unwrap();
        script(&d.path().join("mame"), "#!/bin/sh\necho 'hello world'\n");
        let m = detect_in("mame", &[d.path().to_path_buf()]);
        assert_eq!(m.len(), 1);
        assert!(!m[0].verified);
    }

    #[test]
    fn a_hanging_probe_is_killed() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("x");
        script(&p, "#!/bin/sh\nsleep 30\n");
        let t = Instant::now();
        assert!(run_capture(&p, &[], Duration::from_millis(300)).is_err());
        assert!(t.elapsed() < Duration::from_secs(5));
    }
}
