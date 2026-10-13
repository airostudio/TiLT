//! Safe file primitives: atomic streaming copies, same-file detection, name
//! sanitising, free-space checks and exclusive disk locks.
//!
//! Rules enforced here for every caller:
//! * data is written to a hidden `.partial` area on the *same volume* and only
//!   `rename`d into place after its hash has been verified and it was fsync'd
//! * untrusted names never become path components (see [`sanitize_file_name`])
//! * a source and destination that resolve to the same file are rejected, no
//!   matter what they are called (hard links, symlinks, case differences)

use crate::error::{Error, Result};
use crate::hash::{hex, CancelToken};
use fs4::fs_std::FileExt;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const CHUNK: usize = 1024 * 1024;
/// Head-room kept free after any large write.
pub const SPACE_MARGIN: u64 = 64 * 1024 * 1024;

pub fn random_id() -> String {
    let mut b = [0u8; 12];
    getrandom::fill(&mut b).expect("system random source unavailable");
    hex(&b)
}

pub fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Reduce an untrusted display name to a safe single path component.
/// Strips directories, control characters and Windows-reserved characters/names.
pub fn sanitize_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let mut s: String = base
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') { '_' } else { c })
        .collect();
    s = s.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
        "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        s.insert(0, '_');
    }
    if s.is_empty() {
        s = "unnamed".into();
    }
    if s.len() > 120 {
        let mut cut = 120;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
    }
    s
}

pub fn same_file(a: &Path, b: &Path) -> bool {
    same_file::is_same_file(a, b).unwrap_or(false)
}

pub fn available_space(path: &Path) -> Result<u64> {
    let probe = path.ancestors().find(|p| p.exists()).unwrap_or(Path::new("."));
    Ok(fs4::available_space(probe)?)
}

pub fn ensure_space(dir: &Path, needed: u64) -> Result<()> {
    let available = available_space(dir)?;
    let needed = needed.saturating_add(SPACE_MARGIN);
    if available < needed {
        return Err(Error::InsufficientSpace { needed, available });
    }
    Ok(())
}

pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    let Ok(rd) = fs::read_dir(path) else { return 0 };
    for e in rd.flatten() {
        let Ok(md) = e.metadata() else { continue };
        if md.is_dir() {
            total += dir_size(&e.path());
        } else {
            total += md.len();
        }
    }
    total
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
}
#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// Result of an atomic copy.
#[derive(Debug, Clone)]
pub struct CopyResult {
    pub sha256: String,
    pub size: u64,
}

/// Copy `src` to `dst` atomically. Data is streamed into `staging_dir`, hashed
/// while copying, fsync'd, the destination is re-read and re-hashed to *verify*
/// it, and only then renamed to `dst`. `dst` must not already exist unless
/// `overwrite` is set. The source is only ever read.
pub fn copy_atomic(
    src: &Path,
    dst: &Path,
    staging_dir: &Path,
    overwrite: bool,
    verify: bool,
    cancel: &CancelToken,
    mut progress: Option<&mut dyn FnMut(u64, u64)>,
) -> Result<CopyResult> {
    if dst.exists() {
        if same_file(src, dst) {
            return Err(Error::Unsafe("source and destination are the same file".into()));
        }
        if !overwrite {
            return Err(Error::AlreadyExists(dst.display().to_string()));
        }
    }
    fs::create_dir_all(staging_dir)?;
    if let Some(p) = dst.parent() {
        fs::create_dir_all(p)?;
    }
    let mut input = File::open(src)?;
    let total = input.metadata()?.len();
    ensure_space(staging_dir, total)?;
    let tmp = staging_dir.join(format!("{}.part", random_id()));
    let result = (|| -> Result<CopyResult> {
        let mut out = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; CHUNK];
        let mut done = 0u64;
        loop {
            cancel.check()?;
            let n = input.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            out.write_all(&buf[..n])?;
            done += n as u64;
            if let Some(p) = progress.as_mut() {
                p(done, total);
            }
        }
        out.flush()?;
        out.sync_all()?;
        drop(out);
        let sha = hex(&hasher.finalize());
        if verify {
            let (again, n) = crate::hash::sha256_file(&tmp, cancel, None)?;
            if again != sha || n != done {
                return Err(Error::Unsafe("verification failed: the copy does not match the source".into()));
            }
        }
        fs::rename(&tmp, dst)?;
        if let Some(p) = dst.parent() {
            sync_dir(p);
        }
        Ok(CopyResult { sha256: sha, size: done })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Write `data` to `dst` atomically (stage + fsync + rename).
pub fn write_atomic(dst: &Path, staging_dir: &Path, data: &[u8], overwrite: bool) -> Result<()> {
    if dst.exists() && !overwrite {
        return Err(Error::AlreadyExists(dst.display().to_string()));
    }
    fs::create_dir_all(staging_dir)?;
    let tmp = staging_dir.join(format!("{}.part", random_id()));
    let r = (|| -> Result<()> {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, dst)?;
        Ok(())
    })();
    if r.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    r
}

pub fn set_readonly(path: &Path, ro: bool) -> Result<()> {
    let mut perm = fs::metadata(path)?.permissions();
    perm.set_readonly(ro);
    fs::set_permissions(path, perm)?;
    Ok(())
}

/// Exclusive advisory lock on a disk image. Held while an emulator session or
/// maintenance operation uses the image; released on drop (or process exit).
#[derive(Debug)]
pub struct DiskLock {
    file: File,
    path: PathBuf,
}

impl DiskLock {
    /// Try to take the lock without waiting. Fails with [`Error::Locked`] when
    /// another process or thread holds it.
    pub fn acquire(lock_path: &Path, label: &str) -> Result<DiskLock> {
        if let Some(p) = lock_path.parent() {
            fs::create_dir_all(p)?;
        }
        let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(lock_path)?;
        match file.try_lock_exclusive() {
            Ok(true) => {}
            Ok(false) => return Err(Error::Locked(label.to_string())),
            Err(e) => return Err(Error::Io(e)),
        }
        let _ = file.set_len(0);
        let _ = writeln!(&file, "pid={}", std::process::id());
        Ok(DiskLock { file, path: lock_path.to_path_buf() })
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for DiskLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_blocks_traversal_and_reserved() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("..\\..\\win.ini"), "win.ini");
        assert_eq!(sanitize_file_name("a:b*c?.adf"), "a_b_c_.adf");
        assert_eq!(sanitize_file_name("CON.adf"), "_CON.adf");
        assert_eq!(sanitize_file_name("..."), "unnamed");
        assert_eq!(sanitize_file_name(""), "unnamed");
        assert!(sanitize_file_name(&"x".repeat(500)).len() <= 120);
        assert_eq!(sanitize_file_name("tab\there.adf"), "tab_here.adf");
    }

    #[test]
    fn atomic_copy_verifies_and_protects() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src.bin");
        std::fs::write(&src, vec![7u8; 3_000_000]).unwrap();
        let dst = d.path().join("out/dst.bin");
        let stage = d.path().join(".partial");
        let r = copy_atomic(&src, &dst, &stage, false, true, &CancelToken::new(), None).unwrap();
        assert_eq!(r.size, 3_000_000);
        assert_eq!(std::fs::read(&dst).unwrap(), std::fs::read(&src).unwrap());
        // no staging litter
        assert_eq!(std::fs::read_dir(&stage).unwrap().count(), 0);
        // refuses to overwrite by default
        assert!(matches!(
            copy_atomic(&src, &dst, &stage, false, true, &CancelToken::new(), None),
            Err(Error::AlreadyExists(_))
        ));
        // same file is rejected even with overwrite
        assert!(matches!(
            copy_atomic(&src, &src, &stage, true, true, &CancelToken::new(), None),
            Err(Error::Unsafe(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn hardlink_and_symlink_are_same_file() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        std::fs::write(&a, b"x").unwrap();
        let h = d.path().join("hard");
        std::fs::hard_link(&a, &h).unwrap();
        let s = d.path().join("sym");
        std::os::unix::fs::symlink(&a, &s).unwrap();
        let stage = d.path().join(".p");
        for other in [&h, &s] {
            assert!(same_file(&a, other));
            assert!(matches!(
                copy_atomic(&a, other, &stage, true, true, &CancelToken::new(), None),
                Err(Error::Unsafe(_))
            ));
        }
        assert_eq!(std::fs::read(&a).unwrap(), b"x");
    }

    #[test]
    fn cancelled_copy_leaves_nothing_behind() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("s");
        std::fs::write(&src, vec![1u8; 5_000_000]).unwrap();
        let dst = d.path().join("dst");
        let stage = d.path().join(".p");
        let c = CancelToken::new();
        let c2 = c.clone();
        let mut cb = move |done: u64, _t: u64| {
            if done > 1_000_000 {
                c2.cancel();
            }
        };
        let r = copy_atomic(&src, &dst, &stage, false, true, &c, Some(&mut cb));
        assert!(matches!(r, Err(Error::Cancelled)));
        assert!(!dst.exists());
        assert_eq!(std::fs::read_dir(&stage).unwrap().count(), 0);
    }

    #[test]
    fn locks_are_exclusive_and_released() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("x.lock");
        let l1 = DiskLock::acquire(&p, "disk").unwrap();
        assert!(matches!(DiskLock::acquire(&p, "disk"), Err(Error::Locked(_))));
        drop(l1);
        let _l2 = DiskLock::acquire(&p, "disk").unwrap();
    }

    #[test]
    fn space_check_rejects_absurd_requests() {
        let d = tempfile::tempdir().unwrap();
        assert!(matches!(ensure_space(d.path(), u64::MAX / 2), Err(Error::InsufficientSpace { .. })));
        assert!(ensure_space(d.path(), 1024).is_ok());
    }

    #[test]
    fn write_atomic_no_overwrite() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("f");
        write_atomic(&p, &d.path().join(".s"), b"1", false).unwrap();
        assert!(write_atomic(&p, &d.path().join(".s"), b"2", false).is_err());
        write_atomic(&p, &d.path().join(".s"), b"2", true).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"2");
    }
}
