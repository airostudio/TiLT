//! Kickstart ROM inspection.
//!
//! Identification is done from the ROM *contents*, never the file name:
//!
//! * magic: `0x1111 / 0x1114` followed by `0x4EF9` (a `JMP` to the reset code)
//! * size: 256 KiB or 512 KiB (1 MiB for some extended ROMs)
//! * `exec.library` version / revision: big-endian words at offset 0x0C / 0x0E
//! * Kickstart checksum: the sum of all 32-bit words, with end-around carry,
//!   must equal `0xFFFFFFFF`
//! * ROM size recorded in the footer at `len - 0x14`
//!
//! These rules were checked against the open-source AROS ROMs shipped with
//! Amiberry. No proprietary ROM data is embedded here: only the *structure*.

use crate::error::{Error, Result};
use crate::hash::sha256_hex_bytes;
use serde::{Deserialize, Serialize};

pub const MAX_ROM_SIZE: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RomKind {
    /// Main Kickstart image.
    Kickstart,
    /// Encrypted Cloanto "Amiga Forever" image (`AMIROMTYPE1`). Needs `rom.key`.
    EncryptedCloanto,
    /// Looks like a ROM by size but has no recognisable Kickstart header.
    Unrecognised,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Chipset {
    Ocs,
    Ecs,
    Aga,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomInfo {
    pub sha256: String,
    pub size: u64,
    pub kind: RomKind,
    /// `exec.library` version, e.g. 34 for Kickstart 1.3.
    pub exec_version: Option<u16>,
    pub exec_revision: Option<u16>,
    /// Marketing name derived from the *detected* version, e.g. "Kickstart 1.3".
    pub family: Option<String>,
    /// Human label, e.g. "Kickstart 1.3 (34.5)".
    pub label: String,
    pub checksum_ok: bool,
    /// The footer size field agrees with the real size.
    pub footer_size_ok: bool,
    /// 256 KiB ROM stored twice in a 512 KiB file.
    pub mirrored_256k: bool,
    /// Open-source AROS replacement ROM (detected from an embedded marker).
    pub is_aros: bool,
    pub aga_capable: bool,
    /// Machines this ROM is commonly used with. Informational, hedged.
    pub likely_machines: Vec<String>,
    pub version_string: Option<String>,
    pub warnings: Vec<String>,
}

impl RomInfo {
    /// A ROM we are willing to hand to the emulator.
    pub fn is_usable(&self) -> bool {
        match self.kind {
            RomKind::Kickstart => self.checksum_ok,
            RomKind::EncryptedCloanto => true, // emulator decrypts with rom.key
            RomKind::Unrecognised => false,
        }
    }
}

fn be16(d: &[u8], o: usize) -> u16 {
    u16::from_be_bytes([d[o], d[o + 1]])
}
fn be32(d: &[u8], o: usize) -> u32 {
    u32::from_be_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}

/// Kickstart checksum: 32-bit big-endian word sum with end-around carry.
pub fn kickstart_sum(data: &[u8]) -> u32 {
    let mut sum: u64 = 0;
    for w in data.chunks_exact(4) {
        sum += u32::from_be_bytes([w[0], w[1], w[2], w[3]]) as u64;
        if sum > 0xFFFF_FFFF {
            sum = (sum & 0xFFFF_FFFF) + 1;
        }
    }
    sum as u32
}

/// Map an `exec` version to the user-facing Kickstart name.
pub fn family_for(version: u16, revision: u16) -> Option<&'static str> {
    Some(match version {
        30 | 31 => "Kickstart 1.0/1.1",
        33 => "Kickstart 1.2",
        34 => "Kickstart 1.3",
        35 => "Kickstart 1.4 (beta)",
        36 => "Kickstart 2.0",
        37 if (175..210).contains(&revision) => "Kickstart 2.04",
        37 => "Kickstart 2.05",
        38 => "Kickstart 2.1",
        39 => "Kickstart 3.0",
        40 => "Kickstart 3.1",
        45..=47 => "Kickstart 3.x (modern)",
        _ => return None,
    })
}

fn aga_capable(version: u16, revision: u16) -> bool {
    // 39.x (3.0) and 40.68+ (A1200/A4000 3.1) drive the AGA chipset. 40.63 is
    // the A500/A600/A2000 ROM and does not.
    version == 39 || (version == 40 && revision >= 68) || version >= 41
}

fn likely_machines(version: u16, revision: u16) -> Vec<String> {
    let v: &[&str] = match (version, revision) {
        (33, _) | (34, _) => &["Amiga 500", "Amiga 1000", "Amiga 2000"],
        (36, _) => &["Amiga 3000", "Amiga 500", "Amiga 2000"],
        (37, _) | (38, _) => &["Amiga 500+", "Amiga 600", "Amiga 3000", "Amiga 2000"],
        (39, _) => &["Amiga 1200", "Amiga 4000"],
        (40, r) if r >= 68 => &["Amiga 1200", "Amiga 3000", "Amiga 4000"],
        (40, _) => &["Amiga 500", "Amiga 600", "Amiga 2000"],
        _ => &[],
    };
    v.iter().map(|s| s.to_string()).collect()
}

fn find_ascii(data: &[u8], needle: &[u8]) -> Option<usize> {
    data.windows(needle.len()).position(|w| w == needle)
}

/// Extract an `exec x.y (date)` style version string if present.
fn version_string(data: &[u8]) -> Option<String> {
    let at = find_ascii(data, b"exec ")?;
    let s: String = data[at..].iter().take(48).take_while(|b| (0x20..0x7f).contains(*b)).map(|b| *b as char).collect();
    if s.len() > 6 && s.chars().nth(5).is_some_and(|c| c.is_ascii_digit()) {
        Some(s)
    } else {
        None
    }
}

/// Inspect ROM bytes. Never panics on malformed input.
pub fn inspect(data: &[u8]) -> Result<RomInfo> {
    let size = data.len() as u64;
    if size == 0 {
        return Err(Error::InvalidRom("file is empty".into()));
    }
    if size > MAX_ROM_SIZE {
        return Err(Error::InvalidRom(format!("{size} bytes is too large for a Kickstart ROM (limit {MAX_ROM_SIZE})")));
    }
    let sha256 = sha256_hex_bytes(data);
    let mut warnings = Vec::new();

    if data.starts_with(b"AMIROMTYPE1") {
        warnings.push(
            "Encrypted Amiga Forever ROM. A matching 'rom.key' file is needed; the real \
             version is only known to the emulator once it decrypts the ROM."
                .to_string(),
        );
        return Ok(RomInfo {
            sha256,
            size,
            kind: RomKind::EncryptedCloanto,
            exec_version: None,
            exec_revision: None,
            family: None,
            label: "Encrypted Amiga Forever ROM (version unknown until decrypted)".into(),
            checksum_ok: false,
            footer_size_ok: false,
            mirrored_256k: false,
            is_aros: false,
            aga_capable: false,
            likely_machines: vec![],
            version_string: None,
            warnings,
        });
    }

    if ![0x20000u64, 0x40000, 0x80000, 0x100000].contains(&size) {
        return Err(Error::InvalidRom(format!(
            "{size} bytes is not a Kickstart ROM size (expected 128, 256, 512 KiB or 1 MiB)"
        )));
    }

    let magic_ok = data.len() >= 16 && matches!(be16(data, 0), 0x1111 | 0x1114) && be16(data, 2) == 0x4EF9;
    if !magic_ok {
        return Ok(RomInfo {
            sha256,
            size,
            kind: RomKind::Unrecognised,
            exec_version: None,
            exec_revision: None,
            family: None,
            label: "Unrecognised file (not a Kickstart ROM)".into(),
            checksum_ok: false,
            footer_size_ok: false,
            mirrored_256k: false,
            is_aros: false,
            aga_capable: false,
            likely_machines: vec![],
            version_string: None,
            warnings: vec!["No Kickstart header found. The file may be corrupt, byte-swapped, or not a ROM.".into()],
        });
    }

    let version = be16(data, 0x0C);
    let revision = be16(data, 0x0E);
    let checksum_ok = kickstart_sum(data) == 0xFFFF_FFFF;
    let footer = be32(data, data.len() - 0x14) as u64;
    let footer_size_ok = footer == size;
    let mirrored_256k = size == 0x80000 && data[..0x40000] == data[0x40000..];
    if !checksum_ok {
        warnings.push("The Kickstart checksum does not match - the file is probably corrupt or modified.".into());
    }
    if !footer_size_ok && !mirrored_256k {
        warnings.push(format!("ROM footer says {footer} bytes but the file is {size} bytes."));
    }
    let is_aros = find_ascii(data, b"AROS").is_some();
    let fam = family_for(version, revision);
    if fam.is_none() {
        warnings.push(format!("Unknown exec version {version}.{revision}."));
    }
    let base = fam.unwrap_or("Kickstart (unknown version)");
    let label = if is_aros {
        format!("AROS open-source ROM ({version}.{revision})")
    } else {
        format!("{base} ({version}.{revision})")
    };
    Ok(RomInfo {
        sha256,
        size,
        kind: RomKind::Kickstart,
        exec_version: Some(version),
        exec_revision: Some(revision),
        family: fam.map(str::to_string),
        label,
        checksum_ok,
        footer_size_ok,
        mirrored_256k,
        is_aros,
        aga_capable: aga_capable(version, revision),
        likely_machines: likely_machines(version, revision),
        version_string: version_string(data),
        warnings,
    })
}

/// Which chipset families a ROM can initialise.
pub fn supported_chipsets(info: &RomInfo) -> Vec<Chipset> {
    let mut v = vec![Chipset::Ocs, Chipset::Ecs];
    if info.aga_capable {
        v.push(Chipset::Aga);
    }
    // Kickstart 1.x predates ECS but is routinely run on ECS Agnus; allow it.
    v
}

#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::*;

    /// Build a *synthetic* Kickstart-shaped image (valid header, footer and
    /// checksum, zero payload). Contains no Commodore/Amiga code.
    pub fn synthetic_rom(size: usize, version: u16, revision: u16) -> Vec<u8> {
        let mut d = vec![0u8; size];
        let hi = if size >= 0x80000 { 0x1114u16 } else { 0x1111 };
        d[0..2].copy_from_slice(&hi.to_be_bytes());
        d[2..4].copy_from_slice(&0x4EF9u16.to_be_bytes());
        d[4..8].copy_from_slice(&0x00F8_00D2u32.to_be_bytes());
        d[12..14].copy_from_slice(&version.to_be_bytes());
        d[14..16].copy_from_slice(&revision.to_be_bytes());
        let n = d.len();
        d[n - 0x14..n - 0x10].copy_from_slice(&(size as u32).to_be_bytes());
        // checksum word lives at len - 0x18; solve so the sum is 0xFFFFFFFF
        d[n - 0x18..n - 0x14].copy_from_slice(&0u32.to_be_bytes());
        let s = kickstart_sum(&d);
        let fix = 0xFFFF_FFFFu32.wrapping_sub(s);
        d[n - 0x18..n - 0x14].copy_from_slice(&fix.to_be_bytes());
        // end-around-carry sum can need a second pass in rare cases
        debug_assert_eq!(kickstart_sum(&d), 0xFFFF_FFFF);
        d
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::synthetic_rom;
    use super::*;

    #[test]
    fn detects_kickstart_13_from_content() {
        let rom = synthetic_rom(0x40000, 34, 5);
        let i = inspect(&rom).unwrap();
        assert_eq!(i.kind, RomKind::Kickstart);
        assert_eq!(i.family.as_deref(), Some("Kickstart 1.3"));
        assert_eq!((i.exec_version, i.exec_revision), (Some(34), Some(5)));
        assert!(i.checksum_ok && i.footer_size_ok && !i.aga_capable);
        assert!(i.is_usable());
        assert!(i.label.contains("34.5"));
    }

    #[test]
    fn detects_kickstart_2x_and_31() {
        let r204 = inspect(&synthetic_rom(0x80000, 37, 175)).unwrap();
        assert_eq!(r204.family.as_deref(), Some("Kickstart 2.04"));
        let r205 = inspect(&synthetic_rom(0x80000, 37, 299)).unwrap();
        assert_eq!(r205.family.as_deref(), Some("Kickstart 2.05"));
        let a1200 = inspect(&synthetic_rom(0x80000, 40, 68)).unwrap();
        assert_eq!(a1200.family.as_deref(), Some("Kickstart 3.1"));
        assert!(a1200.aga_capable);
        assert!(a1200.likely_machines.contains(&"Amiga 1200".to_string()));
        let a500 = inspect(&synthetic_rom(0x80000, 40, 63)).unwrap();
        assert!(!a500.aga_capable, "40.63 is the non-AGA 3.1 ROM");
    }

    #[test]
    fn revision_comes_from_content_not_name() {
        // identical bytes, "named" anything - the API never sees a name
        let a = inspect(&synthetic_rom(0x40000, 33, 180)).unwrap();
        assert_eq!(a.family.as_deref(), Some("Kickstart 1.2"));
    }

    #[test]
    fn rejects_corrupt_and_bad_inputs() {
        let mut rom = synthetic_rom(0x40000, 34, 5);
        rom[1000] ^= 0xFF;
        let i = inspect(&rom).unwrap();
        assert!(!i.checksum_ok);
        assert!(!i.is_usable());
        assert!(!i.warnings.is_empty());

        assert!(inspect(&[]).is_err());
        assert!(inspect(&[1, 2, 3]).is_err());
        let i = inspect(&vec![0u8; 0x40000]).unwrap();
        assert_eq!(i.kind, RomKind::Unrecognised);
        assert!(!i.is_usable());
        assert!(inspect(&vec![0u8; (MAX_ROM_SIZE + 4) as usize]).is_err());
    }

    #[test]
    fn detects_encrypted_rom() {
        let mut d = b"AMIROMTYPE1".to_vec();
        d.extend(vec![7u8; 0x40000]);
        let i = inspect(&d).unwrap();
        assert_eq!(i.kind, RomKind::EncryptedCloanto);
        assert!(i.is_usable());
        assert!(i.family.is_none());
    }

    #[test]
    fn duplicate_roms_share_hash() {
        let a = inspect(&synthetic_rom(0x40000, 34, 5)).unwrap();
        let b = inspect(&synthetic_rom(0x40000, 34, 5)).unwrap();
        let c = inspect(&synthetic_rom(0x40000, 34, 4)).unwrap();
        assert_eq!(a.sha256, b.sha256);
        assert_ne!(a.sha256, c.sha256);
    }

    #[test]
    fn mirrored_256k_is_flagged() {
        let half = synthetic_rom(0x40000, 34, 5);
        let mut full = half.clone();
        full.extend_from_slice(&half);
        let i = inspect(&full).unwrap();
        assert!(i.mirrored_256k);
    }

    #[test]
    fn real_aros_rom_if_available() {
        // Optional: AROS ships with Amiberry. Set AROS_ROM to its aros-rom.bin.
        let Ok(p) = std::env::var("AROS_ROM") else { return };
        let d = std::fs::read(p).unwrap();
        let i = inspect(&d).unwrap();
        assert_eq!(i.kind, RomKind::Kickstart);
        assert!(i.checksum_ok, "{:?}", i);
        assert!(i.is_aros);
    }
}
