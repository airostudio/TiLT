//! Hard-disk image (HDF) inspection. Only a bounded number of blocks near the
//! start of the file are ever read, so a 500 MB image is analysed instantly and
//! the image is opened read-only.
//!
//! Recognised layouts:
//! * **RDB** (Rigid Disk Block, `RDSK`) with its partition list (`PART` blocks)
//! * **Plain hardfile**: a bare AmigaDOS/PFS/SFS volume with no RDB
//! * **Unrecognised / blank**: reported honestly, never silently "fixed"

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const RDB_SCAN_BLOCKS: u64 = 16;
const MAX_PARTITIONS: usize = 64;
const BLOCK: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HdfLayout {
    Rdb,
    PlainHardfile,
    Blank,
    Unrecognised,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HdfPartition {
    pub name: String,
    pub dos_type: u32,
    pub dos_type_name: String,
    pub bootable: bool,
    pub no_mount: bool,
    pub boot_priority: i32,
    pub low_cyl: u32,
    pub high_cyl: u32,
    pub surfaces: u32,
    pub blocks_per_track: u32,
    pub block_size: u32,
    /// Partition size in bytes derived from the geometry.
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HdfInfo {
    pub size: u64,
    pub layout: HdfLayout,
    pub block_size: u32,
    pub partitions: Vec<HdfPartition>,
    /// Filesystem handlers embedded in the RDB (e.g. PFS3, SFS).
    pub embedded_filesystems: Vec<String>,
    /// Some partition is flagged bootable. Boot files are *not* verified.
    pub bootable_flagged: bool,
    /// Plain hardfile: DOS type read from the first block.
    pub plain_dos_type: Option<String>,
    pub rdb_geometry: Option<(u32, u32, u32)>,
    pub summary: String,
    pub warnings: Vec<String>,
    /// Controller advice shown to the user.
    pub advice: Vec<String>,
}

fn be32(d: &[u8], o: usize) -> u32 {
    u32::from_be_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}

fn sum_ok(block: &[u8], longs: usize) -> bool {
    if longs == 0 || longs * 4 > block.len() {
        return false;
    }
    block[..longs * 4].chunks_exact(4).fold(0u32, |a, w| a.wrapping_add(u32::from_be_bytes([w[0], w[1], w[2], w[3]])))
        == 0
}

pub fn dos_type_name(t: u32) -> String {
    let b = t.to_be_bytes();
    let tag = |s: &str, n: u8| -> Option<()> { (&b[..3] == s.as_bytes() && b[3] == n).then_some(()) };
    if &b[..3] == b"DOS" && b[3] <= 7 {
        return match b[3] {
            0 => "OFS",
            1 => "FFS",
            2 => "OFS international",
            3 => "FFS international",
            4 => "OFS dir-cache",
            5 => "FFS dir-cache",
            6 => "OFS intl + dir-cache",
            _ => "FFS intl + dir-cache",
        }
        .to_string();
    }
    if &b[..3] == b"PFS" {
        return format!("PFS{}", b[3]);
    }
    if &b[..3] == b"SFS" {
        return format!("SFS{}", b[3]);
    }
    let _ = tag;
    let printable: String = b.iter().map(|c| if (0x20..0x7f).contains(c) { *c as char } else { '.' }).collect();
    format!("{printable} (0x{t:08X})")
}

fn bstr(b: &[u8]) -> String {
    let n = (b[0] as usize).min(b.len().saturating_sub(1));
    String::from_utf8_lossy(&b[1..1 + n]).into_owned()
}

/// Analyse an HDF on disk. The file is opened read-only.
pub fn inspect_file(path: &Path) -> Result<HdfInfo> {
    let mut f = std::fs::File::open(path)?;
    let size = f.metadata()?.len();
    inspect_reader(&mut f, size)
}

pub fn inspect_reader<R: Read + Seek>(r: &mut R, size: u64) -> Result<HdfInfo> {
    if size < (RDB_SCAN_BLOCKS.min(2)) * BLOCK as u64 {
        return Err(Error::InvalidHdf("file is too small to be a hard disk image".into()));
    }
    let mut warnings = Vec::new();
    let mut advice = Vec::new();
    if size % BLOCK as u64 != 0 {
        warnings.push("File size is not a multiple of 512 bytes; the end of the image may be truncated.".into());
    }

    let read_block = |r: &mut R, idx: u64, bs: usize| -> Result<Option<Vec<u8>>> {
        let off = idx.checked_mul(bs as u64).ok_or_else(|| Error::InvalidHdf("block offset overflow".into()))?;
        if off + bs as u64 > size {
            return Ok(None);
        }
        r.seek(SeekFrom::Start(off))?;
        let mut v = vec![0u8; bs];
        r.read_exact(&mut v)?;
        Ok(Some(v))
    };

    // Look for the Rigid Disk Block in the first 16 blocks.
    let mut rdb: Option<(u64, Vec<u8>)> = None;
    for i in 0..RDB_SCAN_BLOCKS {
        if let Some(b) = read_block(r, i, BLOCK)? {
            if &b[0..4] == b"RDSK" {
                rdb = Some((i, b));
                break;
            }
        }
    }

    if let Some((_idx, b)) = rdb {
        let summed = be32(&b, 4) as usize;
        let mut block_size = be32(&b, 16);
        if !(512..=65536).contains(&block_size) || !block_size.is_power_of_two() {
            warnings.push(format!("RDB reports an unusual block size ({block_size}); assuming 512."));
            block_size = 512;
        }
        if !sum_ok(&b, summed.min(BLOCK / 4)) {
            warnings.push("RDB checksum is invalid; the partition table may be damaged.".into());
        }
        let cyl = be32(&b, 64);
        let sec = be32(&b, 68);
        let heads = be32(&b, 72);
        let part_list = be32(&b, 28);
        let fs_list = be32(&b, 32);
        let bs = block_size as usize;

        let mut partitions = Vec::new();
        let mut next = part_list;
        let mut seen = std::collections::HashSet::new();
        while next != 0xFFFF_FFFF && partitions.len() < MAX_PARTITIONS {
            if !seen.insert(next) {
                warnings.push("Partition list loops back on itself; stopping.".into());
                break;
            }
            let Some(p) = read_block(r, next as u64, bs)? else {
                warnings.push("Partition list points beyond the end of the file.".into());
                break;
            };
            if &p[0..4] != b"PART" {
                warnings.push(format!("Block {next} should be a partition but is not."));
                break;
            }
            if !sum_ok(&p, (be32(&p, 4) as usize).min(bs / 4)) {
                warnings.push(format!("Partition block {next} has a bad checksum."));
            }
            let flags = be32(&p, 20);
            let env = 128usize;
            let surfaces = be32(&p, env + 3 * 4);
            let sec_per_blk = be32(&p, env + 4 * 4).max(1);
            let blocks_per_track = be32(&p, env + 5 * 4);
            let low = be32(&p, env + 9 * 4);
            let high = be32(&p, env + 10 * 4);
            let size_block = be32(&p, env + 4) * 4; // longwords -> bytes
            let dos_type = be32(&p, env + 16 * 4);
            let part_bs = if size_block == 0 { block_size } else { size_block };
            let cyls = high.saturating_sub(low) as u64 + 1;
            let size_bytes = cyls * surfaces as u64 * blocks_per_track as u64 * part_bs as u64;
            let _ = sec_per_blk;
            partitions.push(HdfPartition {
                name: bstr(&p[36..36 + 32]),
                dos_type,
                dos_type_name: dos_type_name(dos_type),
                bootable: flags & 1 != 0,
                no_mount: flags & 2 != 0,
                boot_priority: be32(&p, env + 15 * 4) as i32,
                low_cyl: low,
                high_cyl: high,
                surfaces,
                blocks_per_track,
                block_size: part_bs,
                size_bytes,
            });
            next = be32(&p, 16);
        }

        let mut embedded = Vec::new();
        let mut next = fs_list;
        let mut seen = std::collections::HashSet::new();
        while next != 0xFFFF_FFFF && embedded.len() < 16 && seen.insert(next) {
            let Some(fh) = read_block(r, next as u64, bs)? else { break };
            if &fh[0..4] != b"FSHD" {
                break;
            }
            embedded.push(dos_type_name(be32(&fh, 32)));
            next = be32(&fh, 16);
        }

        let bootable_flagged = partitions.iter().any(|p| p.bootable && !p.no_mount);
        if partitions.is_empty() {
            warnings.push("The RDB contains no partitions.".into());
        }
        for p in &partitions {
            if p.dos_type_name.contains("0x") && !embedded.contains(&p.dos_type_name) {
                warnings.push(format!("Partition {} uses an unknown filesystem ({}).", p.name, p.dos_type_name));
            }
            let needs_fs = p.dos_type_name.starts_with("PFS") || p.dos_type_name.starts_with("SFS");
            if needs_fs && embedded.is_empty() {
                warnings.push(format!(
                    "Partition {} is {} but no filesystem handler is embedded in the RDB; \
                     the Amiga must load it from the Kickstart or another disk.",
                    p.name, p.dos_type_name
                ));
            }
        }
        if bootable_flagged {
            advice.push(
                "A bootable partition is flagged. Whether the OS on it actually starts is only known by booting it."
                    .into(),
            );
        } else {
            advice.push("No partition is flagged bootable; start from a floppy and mount it, or set the boot flag with HDToolBox.".into());
        }
        advice.push("Needs a machine with an IDE (A600/A1200/A4000) or compatible emulated controller and Kickstart 2.04+ to autoboot.".into());
        let summary = format!(
            "RDB disk, {} partition(s){}",
            partitions.len(),
            if bootable_flagged { ", boot flag set" } else { "" }
        );
        return Ok(HdfInfo {
            size,
            layout: HdfLayout::Rdb,
            block_size,
            partitions,
            embedded_filesystems: embedded,
            bootable_flagged,
            plain_dos_type: None,
            rdb_geometry: Some((cyl, heads, sec)),
            summary,
            warnings,
            advice,
        });
    }

    // No RDB: look at block 0 for a bare filesystem.
    let b0 = read_block(r, 0, BLOCK)?.unwrap_or_default();
    let all_zero_head = {
        let mut z = true;
        for i in 0..RDB_SCAN_BLOCKS {
            if let Some(b) = read_block(r, i, BLOCK)? {
                if b.iter().any(|x| *x != 0) {
                    z = false;
                    break;
                }
            }
        }
        z
    };
    if b0.len() >= 4 && (&b0[0..3] == b"DOS" || &b0[0..3] == b"PFS" || &b0[0..3] == b"SFS") {
        let t = be32(&b0, 0);
        let name = dos_type_name(t);
        advice.push("A bare hardfile has no partition table. It mounts as a single volume using geometry 32 sectors / 1 head / 2 reserved blocks.".into());
        return Ok(HdfInfo {
            size,
            layout: HdfLayout::PlainHardfile,
            block_size: 512,
            partitions: vec![],
            embedded_filesystems: vec![],
            bootable_flagged: false,
            plain_dos_type: Some(name.clone()),
            rdb_geometry: None,
            summary: format!("Plain hardfile ({name}), no partition table"),
            warnings,
            advice,
        });
    }
    if all_zero_head {
        warnings.push("The start of the image is blank: it has not been partitioned or formatted.".into());
        advice.push("Attach it, boot from a Workbench install disk, partition with HDToolBox and format. Nothing is formatted without your confirmation.".into());
        return Ok(HdfInfo {
            size,
            layout: HdfLayout::Blank,
            block_size: 512,
            partitions: vec![],
            embedded_filesystems: vec![],
            bootable_flagged: false,
            plain_dos_type: None,
            rdb_geometry: None,
            summary: "Blank image (not partitioned or formatted)".into(),
            warnings,
            advice,
        });
    }
    warnings.push("No Rigid Disk Block or recognised filesystem was found at the start of the file.".into());
    advice.push("This may not be an Amiga hard disk image, or it may use an unsupported layout.".into());
    Ok(HdfInfo {
        size,
        layout: HdfLayout::Unrecognised,
        block_size: 512,
        partitions: vec![],
        embedded_filesystems: vec![],
        bootable_flagged: false,
        plain_dos_type: None,
        rdb_geometry: None,
        summary: "Unrecognised disk layout".into(),
        warnings,
        advice,
    })
}

#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::*;

    fn put(b: &mut [u8], o: usize, v: u32) {
        b[o..o + 4].copy_from_slice(&v.to_be_bytes());
    }
    fn fix(b: &mut [u8], longs: usize, chk_off: usize) {
        put(b, chk_off, 0);
        let s = b[..longs * 4]
            .chunks_exact(4)
            .fold(0u32, |a, w| a.wrapping_add(u32::from_be_bytes([w[0], w[1], w[2], w[3]])));
        put(b, chk_off, 0u32.wrapping_sub(s));
    }

    /// Synthetic RDB image with one partition "DH0" (FFS), bootable flag optional.
    pub fn synthetic_rdb(total_blocks: usize, bootable: bool, dos_type: u32) -> Vec<u8> {
        let mut d = vec![0u8; total_blocks * BLOCK];
        {
            let b = &mut d[0..BLOCK];
            b[0..4].copy_from_slice(b"RDSK");
            put(b, 4, 64);
            put(b, 12, 7);
            put(b, 16, 512);
            put(b, 20, 0x12);
            put(b, 24, 0xFFFF_FFFF);
            put(b, 28, 1); // partition list at block 1
            put(b, 32, 0xFFFF_FFFF);
            put(b, 36, 0xFFFF_FFFF);
            put(b, 64, 100);
            put(b, 68, 32);
            put(b, 72, 4);
            fix(b, 64, 8);
        }
        {
            let b = &mut d[BLOCK..2 * BLOCK];
            b[0..4].copy_from_slice(b"PART");
            put(b, 4, 64);
            put(b, 12, 7);
            put(b, 16, 0xFFFF_FFFF);
            put(b, 20, bootable as u32);
            b[36] = 3;
            b[37..40].copy_from_slice(b"DH0");
            let e = 128;
            put(b, e, 16);
            put(b, e + 4, 128); // size block in longs -> 512
            put(b, e + 12, 4); // surfaces
            put(b, e + 16, 1);
            put(b, e + 20, 32);
            put(b, e + 36, 2); // low cyl
            put(b, e + 40, 99); // high cyl
            put(b, e + 60, 0); // boot pri
            put(b, e + 64, dos_type);
            fix(b, 64, 8);
        }
        d
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::synthetic_rdb;
    use super::*;
    use std::io::Cursor;

    fn insp(d: &[u8]) -> HdfInfo {
        inspect_reader(&mut Cursor::new(d), d.len() as u64).unwrap()
    }

    #[test]
    fn parses_rdb_and_partition() {
        let d = synthetic_rdb(4096, true, 0x444F5301);
        let i = insp(&d);
        assert_eq!(i.layout, HdfLayout::Rdb);
        assert_eq!(i.partitions.len(), 1);
        let p = &i.partitions[0];
        assert_eq!(p.name, "DH0");
        assert_eq!(p.dos_type_name, "FFS");
        assert!(p.bootable && i.bootable_flagged);
        assert_eq!(p.size_bytes, 98 * 4 * 32 * 512);
        assert!(i.warnings.is_empty(), "{:?}", i.warnings);
    }

    #[test]
    fn unflagged_partition_is_not_bootable() {
        let i = insp(&synthetic_rdb(4096, false, 0x444F5303));
        assert!(!i.bootable_flagged);
        assert!(i.advice.iter().any(|a| a.contains("No partition is flagged")));
    }

    #[test]
    fn bad_checksum_warns() {
        let mut d = synthetic_rdb(4096, true, 0x444F5301);
        d[40] ^= 0xFF;
        let i = insp(&d);
        assert!(i.warnings.iter().any(|w| w.contains("checksum")));
    }

    #[test]
    fn pfs_without_embedded_handler_warns() {
        let i = insp(&synthetic_rdb(4096, true, 0x50465303));
        assert_eq!(i.partitions[0].dos_type_name, "PFS3");
        assert!(i.warnings.iter().any(|w| w.contains("no filesystem handler")));
    }

    #[test]
    fn plain_hardfile_blank_and_garbage() {
        let mut plain = vec![0u8; 8192 * 512];
        plain[0..4].copy_from_slice(&0x444F5301u32.to_be_bytes());
        assert_eq!(insp(&plain).layout, HdfLayout::PlainHardfile);

        let blank = vec![0u8; 8192 * 512];
        let i = insp(&blank);
        assert_eq!(i.layout, HdfLayout::Blank);
        assert!(i.advice.iter().any(|a| a.contains("without your confirmation")));

        let mut junk = vec![0u8; 8192 * 512];
        junk[5000] = 9;
        assert_eq!(insp(&junk).layout, HdfLayout::Unrecognised);
    }

    #[test]
    fn partition_loop_is_bounded() {
        let mut d = synthetic_rdb(4096, true, 0x444F5301);
        // make the partition's "next" point at itself
        d[512 + 16..512 + 20].copy_from_slice(&1u32.to_be_bytes());
        // fix checksum so only the loop trips
        let b = &mut d[512..1024];
        b[8..12].copy_from_slice(&0u32.to_be_bytes());
        let s =
            b[..256].chunks_exact(4).fold(0u32, |a, w| a.wrapping_add(u32::from_be_bytes([w[0], w[1], w[2], w[3]])));
        b[8..12].copy_from_slice(&0u32.wrapping_sub(s).to_be_bytes());
        let i = insp(&d);
        assert_eq!(i.partitions.len(), 1);
        assert!(i.warnings.iter().any(|w| w.contains("loops")));
    }

    #[test]
    fn tiny_file_rejected() {
        assert!(inspect_reader(&mut Cursor::new(vec![0u8; 100]), 100).is_err());
    }

    #[test]
    fn dos_type_names() {
        assert_eq!(dos_type_name(0x444F5300), "OFS");
        assert_eq!(dos_type_name(0x444F5307), "FFS intl + dir-cache");
        assert_eq!(dos_type_name(0x53465302), "SFS2");
        assert!(dos_type_name(0x12345678).contains("0x12345678"));
    }
}
