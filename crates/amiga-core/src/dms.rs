//! DMS (Disk Masher System) support, built on the pure-Rust `xdms` crate - a port of
//! the public-domain xDMS decoder, byte-verified upstream against the reference C
//! implementation for HEAVY1/HEAVY2/RLE archives. See docs/amiga-studio/licensing.md.
//!
//! Hostile-input defences applied here (the crate itself is memory safe):
//! * input is size-capped before it is read into memory
//! * output is capped through a bounded writer (decompression-bomb protection)
//! * decoding runs under `catch_unwind` so a decoder panic becomes an error
//! * a DMS only ever yields an in-memory ADF; nothing touches the filesystem
//!   until the caller has validated the result with [`crate::adf::inspect`]
//!
//! Only decoding is provided. There is no DMS encoder.

use crate::adf;
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Write};
use std::panic::AssertUnwindSafe;

/// Largest DMS file accepted (real archives are < 1 MiB).
pub const MAX_DMS_INPUT: usize = 16 * 1024 * 1024;
/// Largest decoded image accepted (a high-density ADF).
pub const MAX_DMS_OUTPUT: usize = adf::HD_SIZE;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmsInfo {
    pub creator_version: u16,
    pub first_track: u16,
    pub last_track: u16,
    pub packed_size: u32,
    pub unpacked_size: u32,
    pub disk_type: String,
    pub encrypted: bool,
    pub high_density: bool,
    pub description: String,
}

struct BoundedWriter {
    buf: Vec<u8>,
    limit: usize,
}

impl Write for BoundedWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        if self.buf.len() + data.len() > self.limit {
            return Err(std::io::Error::other("decoded output exceeds the safety limit"));
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn looks_like_dms(data: &[u8]) -> bool {
    data.len() >= 56 && &data[0..4] == b"DMS!"
}

fn guard<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    std::panic::catch_unwind(AssertUnwindSafe(f))
        .unwrap_or_else(|_| Err(Error::Dms("the decoder crashed on this file; it is probably corrupt".into())))
}

fn check_input(data: &[u8]) -> Result<()> {
    if data.len() > MAX_DMS_INPUT {
        return Err(Error::Dms(format!("file is larger than the {MAX_DMS_INPUT} byte limit")));
    }
    if !looks_like_dms(data) {
        return Err(Error::Dms("this is not a DMS archive (missing 'DMS!' signature)".into()));
    }
    Ok(())
}

fn friendly(e: impl std::fmt::Display) -> Error {
    Error::Dms(format!("{e}"))
}

/// Read archive metadata without decoding track data.
pub fn info(data: &[u8]) -> Result<DmsInfo> {
    check_input(data)?;
    guard(|| {
        let a = xdms::DmsArchive::read(Cursor::new(data)).map_err(friendly)?;
        let i = a.info();
        Ok(DmsInfo {
            creator_version: i.creator_version,
            first_track: i.first_track,
            last_track: i.last_track,
            packed_size: i.packed_size,
            unpacked_size: i.unpacked_size,
            disk_type: i.disk_type.to_string(),
            encrypted: i.info.encrypted(),
            high_density: i.info.hd(),
            description: a.info().to_string(),
        })
    })
}

/// Test archive integrity (all header, track and data CRCs) without output.
pub fn test(data: &[u8]) -> Result<()> {
    check_input(data)?;
    guard(|| {
        let mut a = xdms::DmsArchive::read(Cursor::new(data)).map_err(friendly)?;
        if a.info().info.encrypted() {
            return Err(Error::Dms("this archive is password protected, which is not supported".into()));
        }
        a.verify().map(|_| ()).map_err(friendly)
    })
}

/// Decode to a validated ADF image held in memory.
pub fn to_adf(data: &[u8]) -> Result<Vec<u8>> {
    check_input(data)?;
    let out = guard(|| {
        let mut a = xdms::DmsArchive::read(Cursor::new(data)).map_err(friendly)?;
        if a.info().info.encrypted() {
            return Err(Error::Dms("this archive is password protected, which is not supported".into()));
        }
        let mut w = BoundedWriter { buf: Vec::with_capacity(adf::DD_SIZE), limit: MAX_DMS_OUTPUT };
        a.unpack_to(&mut w).map_err(friendly)?;
        Ok(w.buf)
    })?;
    // The result must be a standard ADF size; anything else is rejected rather
    // than padded or truncated.
    adf::inspect(&out).map_err(|_| {
        Error::Dms(format!(
            "decoded image is {} bytes, which is not a standard ADF size; the archive may be partial",
            out.len()
        ))
    })?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_dms_and_oversize() {
        assert!(to_adf(b"not a dms file at all, definitely not......................").is_err());
        assert!(info(&[]).is_err());
        let big = vec![0u8; MAX_DMS_INPUT + 1];
        assert!(matches!(to_adf(&big), Err(Error::Dms(_))));
    }

    #[test]
    fn truncated_and_garbage_never_panic() {
        let mut hdr = b"DMS!".to_vec();
        hdr.extend(vec![0xFFu8; 200]);
        assert!(to_adf(&hdr).is_err());
        assert!(test(&hdr).is_err());
        // every prefix of a header must fail cleanly
        for n in 0..hdr.len().min(120) {
            let _ = to_adf(&hdr[..n]);
        }
    }

    #[test]
    fn decodes_a_synthetic_nocomp_archive_if_format_matches() {
        // The synthetic container is hand-built from the DMS format description.
        // If xdms disagrees about a header detail this test reports it rather
        // than hiding it; real-world decoding is covered by `real_dms_fixture`.
        let adf =
            crate::adf::create_blank("Synth", crate::adf::FsKind::Ffs, false, crate::adf::Density::Double, 0).unwrap();
        let dms = test_support::synthetic(&adf);
        match to_adf(&dms) {
            Ok(out) => assert_eq!(out, adf),
            Err(e) => panic!("synthetic NOCOMP archive failed to decode: {e}"),
        }
        assert!(test(&dms).is_ok());
        let i = info(&dms).unwrap();
        assert_eq!(i.last_track, 79);
    }

    #[test]
    fn corrupted_track_is_detected() {
        let adf =
            crate::adf::create_blank("Synth", crate::adf::FsKind::Ffs, false, crate::adf::Density::Double, 0).unwrap();
        let mut dms = test_support::synthetic(&adf);
        let n = dms.len();
        dms[n / 2] ^= 0xFF;
        assert!(to_adf(&dms).is_err());
        assert!(test(&dms).is_err());
    }

    #[test]
    fn real_dms_fixture() {
        // Optional: DMS_FIXTURE=/path/to/file.dms DMS_FIXTURE_SHA256=<expected adf sha256>
        let Ok(p) = std::env::var("DMS_FIXTURE") else { return };
        let d = std::fs::read(p).unwrap();
        let adf = to_adf(&d).unwrap();
        if let Ok(want) = std::env::var("DMS_FIXTURE_SHA256") {
            assert_eq!(crate::hash::sha256_hex_bytes(&adf), want);
        }
    }
}

/// Synthetic DMS builder for tests (NOCOMP tracks; no third-party media).
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    /// Build a minimal valid DMS with NOCOMP tracks, so the container, CRC and
    /// decode path is exercised without needing any third-party media.
    pub fn synthetic(adf: &[u8]) -> Vec<u8> {
        fn crc16(data: &[u8]) -> u16 {
            let mut crc = 0u16;
            for &b in data {
                crc ^= b as u16;
                for _ in 0..8 {
                    crc = if crc & 1 != 0 { (crc >> 1) ^ 0xA001 } else { crc >> 1 };
                }
            }
            crc
        }
        let tracks = 80; // DMS "tracks" are cylinders (both heads)
        let tlen = 22 * 512;
        let mut out = vec![0u8; 56];
        out[0..4].copy_from_slice(b"DMS!");
        // layout per xdms: geninfo@10, date@12, first@16, last@18, packed@21 (24-bit),
        // unpacked@25 (24-bit), creator version@46, disk type@50, mode@52, crc@54 over [4..54]
        let total = (tracks * tlen) as u32;
        out[16..18].copy_from_slice(&0u16.to_be_bytes()); // first track
        out[18..20].copy_from_slice(&((tracks - 1) as u16).to_be_bytes()); // last track
        out[21..24].copy_from_slice(&total.to_be_bytes()[1..]); // packed
        out[25..28].copy_from_slice(&total.to_be_bytes()[1..]); // unpacked
        out[46..48].copy_from_slice(&120u16.to_be_bytes()); // creator version 1.20
        out[50..52].copy_from_slice(&2u16.to_be_bytes()); // disk type
        out[52..54].copy_from_slice(&0u16.to_be_bytes()); // compression mode: none
        let hc = crc16(&out[4..54]);
        out[54..56].copy_from_slice(&hc.to_be_bytes());
        for t in 0..tracks {
            let data = &adf[t * tlen..(t + 1) * tlen];
            let mut h = vec![0u8; 20];
            h[0..2].copy_from_slice(b"TR");
            h[2..4].copy_from_slice(&(t as u16).to_be_bytes());
            h[6..8].copy_from_slice(&(tlen as u16).to_be_bytes());
            h[8..10].copy_from_slice(&(tlen as u16).to_be_bytes());
            h[10..12].copy_from_slice(&(tlen as u16).to_be_bytes());
            h[12] = 0; // flags
            h[13] = 0; // mode none
            let sum: u16 = data.iter().fold(0u16, |a, b| a.wrapping_add(*b as u16));
            h[14..16].copy_from_slice(&sum.to_be_bytes());
            h[16..18].copy_from_slice(&crc16(data).to_be_bytes());
            let hc = crc16(&h[..18]);
            h[18..20].copy_from_slice(&hc.to_be_bytes());
            out.extend_from_slice(&h);
            out.extend_from_slice(data);
        }
        out
    }
}
