//! Streaming SHA-256 with progress reporting and cooperative cancellation.
//! Used for ROM/disk identity, copy verification and integrity checks. All
//! heavy callers are expected to run this on a worker thread.

use crate::error::{Error, Result};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

const CHUNK: usize = 1024 * 1024;

/// Progress callback: `(bytes_done, bytes_total)`.
pub type Progress<'a> = &'a mut dyn FnMut(u64, u64);

#[derive(Clone, Default)]
pub struct CancelToken(std::sync::Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
    pub fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }
}

pub fn sha256_hex_bytes(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

pub fn hex(bytes: &[u8]) -> String {
    const T: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(T[(b >> 4) as usize] as char);
        s.push(T[(b & 15) as usize] as char);
    }
    s
}

/// Hash a whole file. Returns `(sha256_hex, size)`.
pub fn sha256_file(path: &Path, cancel: &CancelToken, mut progress: Option<Progress<'_>>) -> Result<(String, u64)> {
    let mut f = std::fs::File::open(path)?;
    let total = f.metadata()?.len();
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    let mut done = 0u64;
    loop {
        cancel.check()?;
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        done += n as u64;
        if let Some(p) = progress.as_mut() {
            p(done, total);
        }
    }
    Ok((hex(&hasher.finalize()), done))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector() {
        assert_eq!(sha256_hex_bytes(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn file_hash_matches_and_cancels() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.bin");
        std::fs::write(&p, b"abc").unwrap();
        let (h, n) = sha256_file(&p, &CancelToken::new(), None).unwrap();
        assert_eq!(n, 3);
        assert_eq!(h, sha256_hex_bytes(b"abc"));
        let c = CancelToken::new();
        c.cancel();
        assert!(matches!(sha256_file(&p, &c, None), Err(Error::Cancelled)));
    }
}
