//! ADF (Amiga Disk File) validation, inspection and creation.
//!
//! An ADF is a raw sector dump: 80 cylinders x 2 heads x 11 sectors x 512 bytes
//! = 901,120 bytes (880 KiB, double density) or twice that for high density.
//! ADF cannot represent copy-protected / non-standard tracks; this module never
//! claims otherwise and never rewrites sectors it did not create.

use crate::error::{Error, Result};
use crate::hash::sha256_hex_bytes;
use serde::{Deserialize, Serialize};

pub const SECTOR: usize = 512;
pub const DD_SIZE: usize = 80 * 2 * 11 * SECTOR; // 901,120
pub const HD_SIZE: usize = DD_SIZE * 2; // 1,802,240

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Density {
    Double,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FsKind {
    Ofs,
    Ffs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdfInfo {
    pub sha256: String,
    pub size: usize,
    pub density: Density,
    /// `DOS\x` boot block signature present.
    pub dos_bootblock: bool,
    /// Boot block checksum is valid (only meaningful when `dos_bootblock`).
    pub bootblock_checksum_ok: bool,
    pub fs: Option<FsKind>,
    pub international: bool,
    pub dir_cache: bool,
    /// Root block parsed and its checksum verified.
    pub root_valid: bool,
    pub volume_name: Option<String>,
    /// Boot block contains executable code after the header.
    pub has_boot_code: bool,
    /// True when the disk uses a custom/non-DOS boot block (typical trackloader).
    pub non_dos: bool,
    pub all_zero: bool,
    /// Plain-language classification for the UI.
    pub summary: String,
    pub warnings: Vec<String>,
}

fn be32(d: &[u8], o: usize) -> u32 {
    u32::from_be_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}

/// Boot block checksum: carry-wrapped sum of all 256 longwords must be 0xFFFFFFFF.
fn bootblock_sum(block: &[u8]) -> u32 {
    let mut sum: u64 = 0;
    for w in block.chunks_exact(4) {
        sum += u32::from_be_bytes([w[0], w[1], w[2], w[3]]) as u64;
        if sum > 0xFFFF_FFFF {
            sum = (sum & 0xFFFF_FFFF) + 1;
        }
    }
    sum as u32
}

/// Normal block checksum: wrapping sum of every longword must be 0.
fn block_sum(block: &[u8]) -> u32 {
    block.chunks_exact(4).fold(0u32, |a, w| a.wrapping_add(u32::from_be_bytes([w[0], w[1], w[2], w[3]])))
}

pub fn density_for(len: usize) -> Option<Density> {
    match len {
        DD_SIZE => Some(Density::Double),
        HD_SIZE => Some(Density::High),
        _ => None,
    }
}

/// Validate and describe an ADF held in memory. A wrong length is a hard error;
/// everything else is reported through [`AdfInfo`] so non-DOS disks are still
/// accepted as valid raw images.
pub fn inspect(data: &[u8]) -> Result<AdfInfo> {
    let density = density_for(data.len()).ok_or_else(|| {
        Error::InvalidDisk(format!("{} bytes is not a standard ADF size (expected {DD_SIZE} or {HD_SIZE})", data.len()))
    })?;
    let total_sectors = data.len() / SECTOR;
    let boot = &data[..2 * SECTOR];
    let mut warnings = Vec::new();

    let all_zero = data.iter().all(|b| *b == 0);
    let dos_bootblock = &boot[0..3] == b"DOS";
    let flags = boot[3];
    let bootblock_checksum_ok = dos_bootblock && bootblock_sum(boot) == 0xFFFF_FFFF;
    let (fs, international, dir_cache) = if dos_bootblock && flags <= 7 {
        (Some(if flags & 1 == 1 { FsKind::Ffs } else { FsKind::Ofs }), flags & 2 != 0, flags & 4 != 0)
    } else {
        (None, false, false)
    };

    // Root block sits in the middle of the volume.
    let root_idx = total_sectors / 2;
    let root = &data[root_idx * SECTOR..(root_idx + 1) * SECTOR];
    let root_valid = be32(root, 0) == 2 && be32(root, 508) == 1 && block_sum(root) == 0;
    let volume_name = if root_valid {
        let len = (root[432] as usize).min(30);
        Some(String::from_utf8_lossy(&root[433..433 + len]).into_owned())
    } else {
        None
    };

    // Boot code: anything non-zero after the 12 byte header.
    let has_boot_code = boot[12..].iter().any(|b| *b != 0);
    let non_dos = !all_zero && !dos_bootblock;

    if dos_bootblock && !bootblock_checksum_ok {
        warnings.push("Boot block checksum is invalid; the disk will not boot.".into());
    }
    if dos_bootblock && !root_valid {
        warnings.push("DOS boot block but the root block is damaged or missing.".into());
    }
    if non_dos {
        warnings.push(
            "Not a standard AmigaDOS disk (likely a game/demo trackloader). It is kept as a raw \
             image. ADF cannot preserve copy-protection or non-standard tracks."
                .into(),
        );
    }
    if all_zero {
        warnings.push("The image is completely blank (unformatted).".into());
    }

    let summary = if all_zero {
        "Blank, unformatted disk".to_string()
    } else if root_valid {
        let fs_name = match fs {
            Some(FsKind::Ffs) => "FFS",
            Some(FsKind::Ofs) => "OFS",
            None => "AmigaDOS",
        };
        let boot_note = if bootblock_checksum_ok && has_boot_code { "bootable" } else { "not bootable (data disk)" };
        format!("AmigaDOS {fs_name} disk \"{}\", {boot_note}", volume_name.clone().unwrap_or_default())
    } else if non_dos {
        "Non-standard disk (trackloader / custom format)".to_string()
    } else {
        "Damaged AmigaDOS disk".to_string()
    };

    Ok(AdfInfo {
        sha256: sha256_hex_bytes(data),
        size: data.len(),
        density,
        dos_bootblock,
        bootblock_checksum_ok,
        fs,
        international,
        dir_cache,
        root_valid,
        volume_name,
        has_boot_code,
        non_dos,
        all_zero,
        summary,
        warnings,
    })
}

/// Days since 1978-01-01 plus minutes and ticks (1/50 s) for AmigaDOS stamps.
fn amiga_datestamp(unix_secs: u64) -> (u32, u32, u32) {
    const AMIGA_EPOCH_OFFSET: u64 = 252_460_800; // 1978-01-01 in Unix seconds
    let s = unix_secs.saturating_sub(AMIGA_EPOCH_OFFSET);
    let days = (s / 86_400) as u32;
    let rem = s % 86_400;
    (days, (rem / 60) as u32, ((rem % 60) * 50) as u32)
}

fn put32(b: &mut [u8], o: usize, v: u32) {
    b[o..o + 4].copy_from_slice(&v.to_be_bytes());
}

/// Create a freshly formatted, empty, non-bootable AmigaDOS disk.
/// `unix_secs` is injected so output is deterministic in tests.
pub fn create_blank(
    volume: &str,
    fs: FsKind,
    international: bool,
    density: Density,
    unix_secs: u64,
) -> Result<Vec<u8>> {
    let name: String = volume.chars().filter(|c| c.is_ascii() && !matches!(c, '/' | ':')).collect();
    if name.is_empty() || name.len() > 30 {
        return Err(Error::InvalidDisk(
            "Disk names must be 1-30 ASCII characters and cannot contain '/' or ':'.".into(),
        ));
    }
    let size = match density {
        Density::Double => DD_SIZE,
        Density::High => HD_SIZE,
    };
    let total = size / SECTOR;
    let root_idx = total / 2;
    let bitmap_idx = root_idx + 1;
    let mut d = vec![0u8; size];

    // Boot block: "DOS" + flags, checksum, root block pointer.
    let flags = (fs == FsKind::Ffs) as u8 | ((international as u8) << 1);
    d[0..3].copy_from_slice(b"DOS");
    d[3] = flags;
    put32(&mut d, 8, root_idx as u32);
    let sum = bootblock_sum(&d[..2 * SECTOR]);
    put32(&mut d, 4, !sum);
    debug_assert_eq!(bootblock_sum(&d[..2 * SECTOR]), 0xFFFF_FFFF);

    let (days, mins, ticks) = amiga_datestamp(unix_secs);
    {
        let r = &mut d[root_idx * SECTOR..(root_idx + 1) * SECTOR];
        put32(r, 0, 2); // T_HEADER
        put32(r, 12, 72); // hash table size
        put32(r, 312, 0xFFFF_FFFF); // bitmap valid
        put32(r, 316, bitmap_idx as u32); // bm_pages[0]
        for (o, v) in [
            (420, days),
            (424, mins),
            (428, ticks),
            (472, days),
            (476, mins),
            (480, ticks),
            (484, days),
            (488, mins),
            (492, ticks),
        ] {
            put32(r, o, v);
        }
        r[432] = name.len() as u8;
        r[433..433 + name.len()].copy_from_slice(name.as_bytes());
        put32(r, 508, 1); // ST_ROOT
        let s = block_sum(r);
        put32(r, 20, 0u32.wrapping_sub(s));
    }
    {
        // Bitmap: bit set = block free. Block 2.. are tracked (0/1 are boot).
        let b = &mut d[bitmap_idx * SECTOR..(bitmap_idx + 1) * SECTOR];
        for blk in 2..total {
            if blk == root_idx || blk == bitmap_idx {
                continue;
            }
            let i = blk - 2;
            let long = 1 + i / 32;
            let bit = i % 32;
            let off = long * 4;
            let cur = u32::from_be_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]]);
            put32(b, off, cur | (1 << bit));
        }
        let s = block_sum(b);
        put32(b, 0, 0u32.wrapping_sub(s));
    }
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrong_size_rejected() {
        assert!(inspect(&[0u8; 1000]).is_err());
        assert!(inspect(&vec![0u8; DD_SIZE + 512]).is_err());
    }

    #[test]
    fn blank_adf_roundtrip_ffs() {
        let d = create_blank("Work", FsKind::Ffs, true, Density::Double, 1_700_000_000).unwrap();
        assert_eq!(d.len(), DD_SIZE);
        let i = inspect(&d).unwrap();
        assert_eq!(i.density, Density::Double);
        assert!(i.dos_bootblock && i.bootblock_checksum_ok);
        assert_eq!(i.fs, Some(FsKind::Ffs));
        assert!(i.international && !i.dir_cache);
        assert!(i.root_valid);
        assert_eq!(i.volume_name.as_deref(), Some("Work"));
        assert!(!i.has_boot_code);
        assert!(i.summary.contains("not bootable"));
    }

    #[test]
    fn blank_adf_ofs_and_high_density() {
        let d = create_blank("HD", FsKind::Ofs, false, Density::High, 1_700_000_000).unwrap();
        assert_eq!(d.len(), HD_SIZE);
        let i = inspect(&d).unwrap();
        assert_eq!(i.density, Density::High);
        assert_eq!(i.fs, Some(FsKind::Ofs));
        assert!(i.root_valid);
    }

    #[test]
    fn creation_is_deterministic_and_bitmap_consistent() {
        let a = create_blank("X", FsKind::Ofs, false, Density::Double, 1_700_000_000).unwrap();
        let b = create_blank("X", FsKind::Ofs, false, Density::Double, 1_700_000_000).unwrap();
        assert_eq!(a, b);
        // 1758 data blocks (2..1760) minus root and bitmap = 1756 free bits
        let bm = &a[881 * SECTOR..882 * SECTOR];
        let free: u32 = (1..128)
            .map(|i| u32::from_be_bytes([bm[i * 4], bm[i * 4 + 1], bm[i * 4 + 2], bm[i * 4 + 3]]).count_ones())
            .sum();
        assert_eq!(free, 1756);
        assert_eq!(block_sum(bm), 0);
    }

    #[test]
    fn bad_names_rejected() {
        assert!(create_blank("", FsKind::Ofs, false, Density::Double, 0).is_err());
        assert!(create_blank(&"a".repeat(31), FsKind::Ofs, false, Density::Double, 0).is_err());
        // ':' and '/' are stripped; nothing left -> error
        assert!(create_blank(":/", FsKind::Ofs, false, Density::Double, 0).is_err());
    }

    #[test]
    fn blank_zero_disk_and_nondos_disk() {
        let z = inspect(&vec![0u8; DD_SIZE]).unwrap();
        assert!(z.all_zero && !z.non_dos);
        assert_eq!(z.summary, "Blank, unformatted disk");

        let mut nd = vec![0u8; DD_SIZE];
        nd[0..4].copy_from_slice(b"KICK");
        nd[100] = 0x4E;
        let i = inspect(&nd).unwrap();
        assert!(i.non_dos && !i.dos_bootblock);
        assert!(i.warnings.iter().any(|w| w.contains("copy-protection")));
    }

    #[test]
    fn corrupted_bootblock_checksum_detected() {
        let mut d = create_blank("Boot", FsKind::Ofs, false, Density::Double, 0).unwrap();
        d[600] = 1;
        let i = inspect(&d).unwrap();
        assert!(!i.bootblock_checksum_ok);
        assert!(i.warnings.iter().any(|w| w.contains("checksum")));
    }

    #[test]
    fn corrupted_root_detected() {
        let mut d = create_blank("Root", FsKind::Ofs, false, Density::Double, 0).unwrap();
        d[880 * SECTOR + 100] ^= 1;
        let i = inspect(&d).unwrap();
        assert!(!i.root_valid);
    }

    #[test]
    fn datestamp_epoch() {
        assert_eq!(amiga_datestamp(252_460_800), (0, 0, 0));
        assert_eq!(amiga_datestamp(252_460_800 + 86_400 + 120 + 1), (1, 2, 50));
    }
}
