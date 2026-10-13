//! Client for Amiberry's line-oriented control socket (`docs/ipc.md` upstream).
//!
//! Wire format: one request per line, fields separated by TAB; the reply is one
//! line starting with `OK` or `ERROR`, followed by TAB separated fields.
//!
//! PLATFORM LIMITATION (verified against Amiberry 8.4.0 `CMakeLists.txt`): the
//! socket is compiled in on Linux and macOS only. Official Windows builds set
//! `USE_IPC_SOCKET=OFF`, so on Windows [`IpcClient::connect`] returns
//! [`Error::Unsupported`] and the UI falls back to restart-to-apply. See
//! docs/amiga-studio/adr/0001-emulator-integration.md.

use crate::error::{Error, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const IO_TIMEOUT: Duration = Duration::from_secs(5);

fn check_arg(a: &str) -> Result<()> {
    if a.contains(['\t', '\n', '\r', '\0']) {
        return Err(Error::Unsafe("control characters are not allowed in emulator commands".into()));
    }
    Ok(())
}

/// Encode a request line. Exposed for tests.
pub fn encode(args: &[&str]) -> Result<String> {
    if args.is_empty() {
        return Err(Error::Emulator("empty command".into()));
    }
    for a in args {
        check_arg(a)?;
    }
    Ok(format!("{}\n", args.join("\t")))
}

/// Decode a reply line into its fields (without the leading `OK`).
pub fn decode(line: &str) -> Result<Vec<String>> {
    let line = line.trim_end_matches(['\n', '\r']);
    let mut it = line.split('\t');
    match it.next() {
        Some("OK") => Ok(it.map(str::to_string).collect()),
        Some("ERROR") => Err(Error::Emulator(it.collect::<Vec<_>>().join(": "))),
        _ => Err(Error::Emulator(format!("unexpected reply from emulator: {line:?}"))),
    }
}

/// Candidate socket paths for instance `n` (0 = first). Mirrors upstream.
pub fn socket_path(n: u32) -> PathBuf {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    if n == 0 {
        dir.join("amiberry.sock")
    } else {
        dir.join(format!("amiberry_{n}.sock"))
    }
}

#[derive(Debug, Clone)]
pub struct IpcClient {
    path: PathBuf,
}

#[cfg(unix)]
impl IpcClient {
    pub fn connect(path: &Path) -> Result<IpcClient> {
        let c = IpcClient { path: path.to_path_buf() };
        c.request(&["PING"])?;
        Ok(c)
    }

    pub fn request(&self, args: &[&str]) -> Result<Vec<String>> {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixStream;
        let line = encode(args)?;
        let mut s = UnixStream::connect(&self.path)?;
        s.set_read_timeout(Some(IO_TIMEOUT))?;
        s.set_write_timeout(Some(IO_TIMEOUT))?;
        s.write_all(line.as_bytes())?;
        let mut reply = String::new();
        BufReader::new(&s).read_line(&mut reply)?;
        if reply.is_empty() {
            return Err(Error::Emulator("the emulator closed the control connection".into()));
        }
        decode(&reply)
    }
}

#[cfg(not(unix))]
impl IpcClient {
    pub fn connect(_path: &Path) -> Result<IpcClient> {
        Err(Error::Unsupported(
            "Amiberry's control socket is not available in Windows builds; settings apply on restart".into(),
        ))
    }
    pub fn request(&self, _args: &[&str]) -> Result<Vec<String>> {
        let _ = &self.path;
        Err(Error::Unsupported("control socket unavailable on this platform".into()))
    }
}

pub fn runtime_control_supported() -> bool {
    cfg!(unix)
}

/// Is *any* Amiberry already answering on a control socket? (Used to refuse to
/// start a second instance that could touch the same disks.)
pub fn foreign_instance_active() -> Option<PathBuf> {
    for n in 0..10 {
        let p = socket_path(n);
        if p.exists() && IpcClient::connect(&p).is_ok() {
            return Some(p);
        }
    }
    None
}

/// Typed helpers over the raw protocol.
impl IpcClient {
    pub fn ping(&self) -> Result<()> {
        self.request(&["PING"]).map(|_| ())
    }
    pub fn version(&self) -> Result<String> {
        Ok(self.request(&["GET_VERSION"])?.join(" "))
    }
    pub fn pause(&self) -> Result<()> {
        self.request(&["PAUSE"]).map(|_| ())
    }
    pub fn resume(&self) -> Result<()> {
        self.request(&["RESUME"]).map(|_| ())
    }
    pub fn reset(&self, hard: bool) -> Result<()> {
        self.request(&["RESET", if hard { "HARD" } else { "SOFT" }]).map(|_| ())
    }
    /// Ask the emulator to exit cleanly (it flushes disks on its way out).
    pub fn quit(&self) -> Result<()> {
        self.request(&["QUIT"]).map(|_| ())
    }
    pub fn screenshot(&self, path: &Path) -> Result<()> {
        let p = path.to_str().ok_or_else(|| Error::Unsafe("non UTF-8 path".into()))?;
        self.request(&["SCREENSHOT", p]).map(|_| ())
    }
    pub fn insert_floppy(&self, unit: u8, path: &Path) -> Result<()> {
        if unit > 3 {
            return Err(Error::Emulator("drive must be DF0:-DF3:".into()));
        }
        let p = path.to_str().ok_or_else(|| Error::Unsafe("non UTF-8 path".into()))?;
        self.request(&["INSERTFLOPPY", p, &unit.to_string()]).map(|_| ())
    }
    pub fn eject_floppy(&self, unit: u8) -> Result<()> {
        if unit > 3 {
            return Err(Error::Emulator("drive must be DF0:-DF3:".into()));
        }
        self.request(&["EJECT_FLOPPY", &unit.to_string()]).map(|_| ())
    }
    pub fn set_write_protect(&self, unit: u8, protect: bool) -> Result<()> {
        self.request(&["DISK_WRITE_PROTECT", &unit.to_string(), if protect { "1" } else { "0" }]).map(|_| ())
    }
    /// `volume` is the *user* volume 0 (silent) .. 100 (full). Amiberry's
    /// `SET_VOLUME` takes an attenuation, so it is inverted here.
    pub fn set_volume(&self, volume: u32) -> Result<()> {
        let att = crate::emu_config::attenuation(volume);
        self.request(&["SET_VOLUME", &att.to_string()]).map(|_| ())
    }
    pub fn mute(&self) -> Result<()> {
        self.request(&["MUTE"]).map(|_| ())
    }
    pub fn toggle_fullscreen(&self) -> Result<()> {
        self.request(&["TOGGLE_FULLSCREEN"]).map(|_| ())
    }
    pub fn toggle_mouse_grab(&self) -> Result<()> {
        self.request(&["TOGGLE_MOUSE_GRAB"]).map(|_| ())
    }
    pub fn save_state(&self, state: &Path, config: &Path) -> Result<()> {
        let s = state.to_str().ok_or_else(|| Error::Unsafe("non UTF-8 path".into()))?;
        let c = config.to_str().ok_or_else(|| Error::Unsafe("non UTF-8 path".into()))?;
        self.request(&["SAVESTATE", s, c]).map(|_| ())
    }
    pub fn load_state(&self, state: &Path) -> Result<()> {
        let s = state.to_str().ok_or_else(|| Error::Unsafe("non UTF-8 path".into()))?;
        self.request(&["LOADSTATE", s]).map(|_| ())
    }
    pub fn fps(&self) -> Result<Vec<(String, String)>> {
        Ok(kv(self.request(&["GET_FPS"])?))
    }
    pub fn led_status(&self) -> Result<Vec<(String, String)>> {
        Ok(kv(self.request(&["GET_LED_STATUS"])?))
    }
    pub fn drive_state(&self) -> Result<Vec<(String, String)>> {
        Ok(kv(self.request(&["GET_DRIVE_STATE"])?))
    }
    pub fn list_floppies(&self) -> Result<Vec<(String, String)>> {
        Ok(kv(self.request(&["LIST_FLOPPIES"])?))
    }
    pub fn cpu_model(&self) -> Result<Vec<(String, String)>> {
        Ok(kv(self.request(&["GET_CPU_MODEL"])?))
    }
    pub fn memory_config(&self) -> Result<Vec<(String, String)>> {
        Ok(kv(self.request(&["GET_MEMORY_CONFIG"])?))
    }
}

fn kv(fields: Vec<String>) -> Vec<(String, String)> {
    fields.into_iter().filter_map(|f| f.split_once('=').map(|(a, b)| (a.to_string(), b.to_string()))).collect()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixListener;

    #[test]
    fn encode_rejects_injection() {
        assert_eq!(encode(&["PING"]).unwrap(), "PING\n");
        assert_eq!(encode(&["INSERTFLOPPY", "/a b/c.adf", "1"]).unwrap(), "INSERTFLOPPY\t/a b/c.adf\t1\n");
        assert!(encode(&["INSERTFLOPPY", "/a\tb", "1"]).is_err());
        assert!(encode(&["X", "a\nQUIT"]).is_err());
        assert!(encode(&[]).is_err());
    }

    #[test]
    fn decode_ok_and_error() {
        assert_eq!(decode("OK\tPONG\n").unwrap(), vec!["PONG"]);
        assert_eq!(decode("OK\n").unwrap(), Vec::<String>::new());
        match decode("ERROR\tDrive number must be 0-3\n") {
            Err(Error::Emulator(m)) => assert!(m.contains("0-3")),
            o => panic!("{o:?}"),
        }
        assert!(decode("garbage").is_err());
    }

    /// A fake Amiberry: records every request line and answers canned replies.
    fn fake_server(dir: &Path) -> (PathBuf, std::sync::mpsc::Receiver<String>) {
        let sock = dir.join("amiberry.sock");
        let l = UnixListener::bind(&sock).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for s in l.incoming().flatten() {
                let mut line = String::new();
                BufReader::new(&s).read_line(&mut line).unwrap();
                tx.send(line.clone()).ok();
                let reply = match line.split('\t').next().unwrap().trim() {
                    "PING" => "OK\tPONG\n",
                    "GET_FPS" => "OK\tfps=50\tidle=21%\n",
                    "INSERTFLOPPY" if line.contains("\t9") => "ERROR\tDrive number must be 0-3\n",
                    _ => "OK\n",
                };
                (&s).write_all(reply.as_bytes()).unwrap();
            }
        });
        (sock, rx)
    }

    #[test]
    fn client_speaks_the_protocol() {
        let d = tempfile::tempdir().unwrap();
        let (sock, rx) = fake_server(d.path());
        let c = IpcClient::connect(&sock).unwrap();
        assert_eq!(rx.recv().unwrap(), "PING\n");
        c.insert_floppy(1, Path::new("/x/disk.adf")).unwrap();
        assert_eq!(rx.recv().unwrap(), "INSERTFLOPPY\t/x/disk.adf\t1\n");
        c.eject_floppy(3).unwrap();
        assert_eq!(rx.recv().unwrap(), "EJECT_FLOPPY\t3\n");
        c.reset(true).unwrap();
        assert_eq!(rx.recv().unwrap(), "RESET\tHARD\n");
        c.reset(false).unwrap();
        assert_eq!(rx.recv().unwrap(), "RESET\tSOFT\n");
        c.save_state(Path::new("/s/a.uss"), Path::new("/s/a.uae")).unwrap();
        assert_eq!(rx.recv().unwrap(), "SAVESTATE\t/s/a.uss\t/s/a.uae\n");
        assert_eq!(c.fps().unwrap(), vec![("fps".into(), "50".into()), ("idle".into(), "21%".into())]);
        let _ = rx.recv().unwrap();
        // drive range is checked client-side too
        assert!(c.insert_floppy(4, Path::new("/x")).is_err());
        assert!(c.eject_floppy(4).is_err());
    }

    #[test]
    fn volume_is_inverted_to_attenuation() {
        let d = tempfile::tempdir().unwrap();
        let (sock, rx) = fake_server(d.path());
        let c = IpcClient::connect(&sock).unwrap();
        let _ = rx.recv().unwrap();
        c.set_volume(100).unwrap();
        assert_eq!(rx.recv().unwrap(), "SET_VOLUME\t0\n");
        c.set_volume(25).unwrap();
        assert_eq!(rx.recv().unwrap(), "SET_VOLUME\t75\n");
        c.set_volume(0).unwrap();
        assert_eq!(rx.recv().unwrap(), "SET_VOLUME\t100\n");
    }

    #[test]
    fn missing_socket_is_an_error_not_a_hang() {
        let d = tempfile::tempdir().unwrap();
        assert!(IpcClient::connect(&d.path().join("nope.sock")).is_err());
    }
}
