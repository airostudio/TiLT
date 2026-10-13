//! Workbench installation sets: classify imported ADFs, group them into a set,
//! report what looks missing, and warn about Kickstart mismatches.
//!
//! Disk identity comes from the volume label read out of the disk's own root
//! block plus `$VER:` version strings found in the image. Version detection is a
//! *heuristic scan*, not a filesystem read, and is labelled that way in the UI.
//! Expected label lists come from the common Commodore-Amiga release labels and
//! are used only to hint at missing disks, never to reject anything.

use super::Library;
use crate::error::{Error, Result};
use crate::fsutil::{self, unix_now};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WbVersion {
    #[serde(rename = "2.1")]
    V21,
    #[serde(rename = "3.1")]
    V31,
    #[serde(rename = "unknown")]
    Unknown,
}

impl WbVersion {
    /// `(workbench.library version, revision)` the supported release should carry.
    pub fn expected_revision(self) -> Option<(u16, u16)> {
        match self {
            WbVersion::V21 => Some((38, 36)),
            WbVersion::V31 => Some((40, 42)),
            WbVersion::Unknown => None,
        }
    }
    /// Kickstart exec version range this Workbench is meant for.
    pub fn kickstart_range(self) -> Option<(u16, u16)> {
        match self {
            WbVersion::V21 => Some((37, 38)),
            WbVersion::V31 => Some((40, 40)),
            WbVersion::Unknown => None,
        }
    }
    fn expected_disks(self) -> &'static [&'static str] {
        match self {
            WbVersion::V21 => &["Workbench", "Install", "Extras", "Fonts", "Storage", "Locale"],
            WbVersion::V31 => &["Workbench", "Install", "Extras", "Fonts", "Storage", "Locale"],
            WbVersion::Unknown => &[],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiskRole {
    Workbench,
    Install,
    Extras,
    Fonts,
    Storage,
    Locale,
    Other,
}

impl DiskRole {
    fn name(self) -> &'static str {
        match self {
            DiskRole::Workbench => "Workbench",
            DiskRole::Install => "Install",
            DiskRole::Extras => "Extras",
            DiskRole::Fonts => "Fonts",
            DiskRole::Storage => "Storage",
            DiskRole::Locale => "Locale",
            DiskRole::Other => "Other",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Classification {
    pub media_id: String,
    pub volume_name: Option<String>,
    pub version: WbVersion,
    pub role: DiskRole,
    /// `workbench.library` revision found in the image, if any.
    pub detected_revision: Option<(u16, u16)>,
    pub bootable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkbenchSet {
    pub id: String,
    pub name: String,
    pub version: WbVersion,
    pub disks: Vec<Classification>,
    pub missing_roles: Vec<DiskRole>,
    pub duplicate_roles: Vec<DiskRole>,
    pub warnings: Vec<String>,
    /// Detected `workbench.library` revision matches the supported release.
    pub revision_confirmed: bool,
}

/// Find `$VER: <name> <major>.<minor>` for `name` anywhere in the image.
pub fn find_version(image: &[u8], name: &str) -> Option<(u16, u16)> {
    let needle = format!("$VER: {name} ");
    let n = needle.as_bytes();
    let mut i = 0;
    while let Some(off) = image[i..].windows(n.len()).position(|w| w.eq_ignore_ascii_case(n)) {
        let start = i + off + n.len();
        let tail = &image[start..(start + 12).min(image.len())];
        let s: String = tail.iter().take_while(|b| b.is_ascii_digit() || **b == b'.').map(|b| *b as char).collect();
        if let Some((a, b)) = s.split_once('.') {
            if let (Ok(a), Ok(b)) = (a.parse(), b.parse()) {
                return Some((a, b));
            }
        }
        i = start;
    }
    None
}

pub fn classify_label(label: &str) -> (DiskRole, WbVersion) {
    let l = label.to_ascii_lowercase().replace(' ', "");
    let version = if l.contains("3.1") {
        WbVersion::V31
    } else if l.contains("2.1") {
        WbVersion::V21
    } else {
        WbVersion::Unknown
    };
    let role = [
        ("workbench", DiskRole::Workbench),
        ("install", DiskRole::Install),
        ("extras", DiskRole::Extras),
        ("fonts", DiskRole::Fonts),
        ("storage", DiskRole::Storage),
        ("locale", DiskRole::Locale),
    ]
    .iter()
    .find(|(k, _)| l.starts_with(k))
    .map(|(_, r)| *r)
    .unwrap_or(DiskRole::Other);
    (role, version)
}

impl Library {
    /// Classify one library ADF as part of a Workbench release.
    pub fn classify_disk(&self, media_id: &str) -> Result<Classification> {
        let m = self.get_media(media_id)?;
        let info = m.info.adf.as_ref().ok_or_else(|| Error::InvalidDisk("not a disk image".into()))?;
        let label = info.volume_name.clone();
        let (role, mut version) = label.as_deref().map(classify_label).unwrap_or((DiskRole::Other, WbVersion::Unknown));
        let image = std::fs::read(&m.path)?;
        let detected = find_version(&image, "workbench.library");
        if version == WbVersion::Unknown {
            version = match detected {
                Some((38, _)) => WbVersion::V21,
                Some((40, _)) => WbVersion::V31,
                _ => WbVersion::Unknown,
            };
        }
        Ok(Classification {
            media_id: media_id.to_string(),
            volume_name: label,
            version,
            role,
            detected_revision: detected,
            bootable: info.bootblock_checksum_ok && info.has_boot_code,
        })
    }

    /// Group disks into a set, describe gaps and mismatches. Does not save.
    pub fn analyse_workbench_set(&self, name: &str, media_ids: &[String]) -> Result<WorkbenchSet> {
        let mut disks = vec![];
        let mut seen_media = std::collections::HashSet::new();
        let mut warnings = vec![];
        for id in media_ids {
            if !seen_media.insert(id.clone()) {
                warnings.push("The same disk image was added twice.".to_string());
                continue;
            }
            disks.push(self.classify_disk(id)?);
        }
        // majority version wins; conflicts are reported
        let (n21, n31) = (
            disks.iter().filter(|d| d.version == WbVersion::V21).count(),
            disks.iter().filter(|d| d.version == WbVersion::V31).count(),
        );
        let version = if n31 > n21 {
            WbVersion::V31
        } else if n21 > 0 {
            WbVersion::V21
        } else {
            WbVersion::Unknown
        };
        if n21 > 0 && n31 > 0 {
            warnings.push(
                "These disks come from different Workbench releases (2.1 and 3.1). Use one release per set.".into(),
            );
        }
        let mut dups = vec![];
        let mut have = std::collections::HashMap::<&'static str, u32>::new();
        for d in &disks {
            if d.role != DiskRole::Other {
                *have.entry(d.role.name()).or_default() += 1;
            }
        }
        let roles = [
            DiskRole::Workbench,
            DiskRole::Install,
            DiskRole::Extras,
            DiskRole::Fonts,
            DiskRole::Storage,
            DiskRole::Locale,
        ];
        for r in roles {
            if have.get(r.name()).copied().unwrap_or(0) > 1 {
                dups.push(r);
            }
        }
        let missing: Vec<DiskRole> = if version == WbVersion::Unknown {
            vec![]
        } else {
            roles
                .into_iter()
                .filter(|r| version.expected_disks().contains(&r.name()) && !have.contains_key(r.name()))
                .collect()
        };
        if !missing.is_empty() {
            warnings.push(format!(
                "Possibly missing: {}. (Based on the usual release disk labels; some releases omit disks.)",
                missing.iter().map(|r| r.name()).collect::<Vec<_>>().join(", ")
            ));
        }
        let wb_disk = disks.iter().find(|d| d.role == DiskRole::Workbench);
        let revision_confirmed = match (version.expected_revision(), wb_disk.and_then(|d| d.detected_revision)) {
            (Some(want), Some(got)) => want == got,
            _ => false,
        };
        if let (Some(want), Some(got)) = (version.expected_revision(), wb_disk.and_then(|d| d.detected_revision)) {
            if want != got {
                warnings.push(format!(
                    "The Workbench disk reports workbench.library {}.{}, but Workbench {} should be {}.{}.",
                    got.0,
                    got.1,
                    serde_json::to_string(&version).unwrap().trim_matches('"'),
                    want.0,
                    want.1
                ));
            }
        }
        if wb_disk.is_some_and(|d| !d.bootable) {
            warnings.push("The Workbench disk has no valid boot block; it cannot start the machine by itself.".into());
        }
        Ok(WorkbenchSet {
            id: fsutil::random_id(),
            name: name.to_string(),
            version,
            disks,
            missing_roles: missing,
            duplicate_roles: dups,
            warnings,
            revision_confirmed,
        })
    }

    pub fn save_workbench_set(&self, set: &WorkbenchSet) -> Result<()> {
        self.db().execute(
            "INSERT INTO workbench_sets(id,name,json,created_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, json=excluded.json",
            params![set.id, set.name, serde_json::to_string(set).unwrap(), unix_now()],
        )?;
        Ok(())
    }

    pub fn list_workbench_sets(&self) -> Result<Vec<WorkbenchSet>> {
        let db = self.db();
        let mut st = db.prepare("SELECT json FROM workbench_sets ORDER BY created_at")?;
        let v = st.query_map([], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v.iter().filter_map(|j| serde_json::from_str(j).ok()).collect())
    }

    pub fn delete_workbench_set(&self, id: &str) -> Result<()> {
        self.db().execute("DELETE FROM workbench_sets WHERE id=?1", [id])?;
        Ok(())
    }
}

/// Warn when a Kickstart and Workbench release do not belong together.
pub fn kickstart_compat_warning(wb: WbVersion, exec_version: u16) -> Option<String> {
    let (lo, hi) = wb.kickstart_range()?;
    if exec_version < lo {
        return Some(format!(
            "Workbench {} needs a newer Kickstart (exec {lo}+). This Kickstart is too old and the install will likely fail.",
            serde_json::to_string(&wb).unwrap().trim_matches('"')
        ));
    }
    if exec_version > hi + 1 {
        return Some(
            "This Kickstart is much newer than the Workbench release; some Workbench programs may misbehave.".into(),
        );
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::test_library;
    use super::*;
    use crate::adf::{self, Density, FsKind};
    use crate::hash::CancelToken;

    /// Synthetic disk: bootable-looking DOS disk with a label and an embedded version string.
    fn disk(label: &str, ver: Option<&str>) -> Vec<u8> {
        let mut d = adf::create_blank(label, FsKind::Ffs, true, Density::Double, 1_700_000_000).unwrap();
        // fake boot code so the disk reports as bootable
        d[12..16].copy_from_slice(&[0x43, 0xFA, 0x00, 0x18]);
        // fix boot block checksum
        d[4..8].copy_from_slice(&[0, 0, 0, 0]);
        let mut sum: u64 = 0;
        for w in d[..1024].chunks_exact(4) {
            sum += u32::from_be_bytes([w[0], w[1], w[2], w[3]]) as u64;
            if sum > 0xFFFF_FFFF {
                sum = (sum & 0xFFFF_FFFF) + 1;
            }
        }
        d[4..8].copy_from_slice(&(!(sum as u32)).to_be_bytes());
        if let Some(v) = ver {
            let s = format!("$VER: workbench.library {v} (01.01.99)");
            d[100_000..100_000 + s.len()].copy_from_slice(s.as_bytes());
        }
        d
    }

    fn import(lib: &Library, dir: &std::path::Path, label: &str, ver: Option<&str>) -> String {
        let p = dir.join(format!("{label}.adf"));
        std::fs::write(&p, disk(label, ver)).unwrap();
        lib.import_media(&p, &CancelToken::new()).unwrap().record.id
    }

    #[test]
    fn labels_classify() {
        assert_eq!(classify_label("Workbench3.1"), (DiskRole::Workbench, WbVersion::V31));
        assert_eq!(classify_label("Install 3.1"), (DiskRole::Install, WbVersion::V31));
        assert_eq!(classify_label("Extras2.1"), (DiskRole::Extras, WbVersion::V21));
        assert_eq!(classify_label("GameDisk"), (DiskRole::Other, WbVersion::Unknown));
    }

    #[test]
    fn version_scan_finds_revision_and_ignores_noise() {
        let mut img = vec![0u8; 5000];
        let s = b"$VER: workbench.library 40.42 (3.9.93)";
        img[300..300 + s.len()].copy_from_slice(s);
        assert_eq!(find_version(&img, "workbench.library"), Some((40, 42)));
        assert_eq!(find_version(&img, "icon.library"), None);
        let bad = b"$VER: workbench.library abc";
        img[1000..1000 + bad.len()].copy_from_slice(bad);
        assert_eq!(find_version(&img[900..], "workbench.library"), None);
    }

    #[test]
    fn full_31_set_is_confirmed() {
        let (d, lib) = test_library();
        let ids: Vec<String> = [
            ("Workbench3.1", Some("40.42")),
            ("Install3.1", None),
            ("Extras3.1", None),
            ("Fonts3.1", None),
            ("Storage3.1", None),
            ("Locale3.1", None),
        ]
        .iter()
        .map(|(l, v)| import(&lib, d.path(), l, *v))
        .collect();
        let set = lib.analyse_workbench_set("My WB 3.1", &ids).unwrap();
        assert_eq!(set.version, WbVersion::V31);
        assert!(set.missing_roles.is_empty() && set.duplicate_roles.is_empty());
        assert!(set.revision_confirmed, "{:?}", set.warnings);
        assert!(set.warnings.is_empty(), "{:?}", set.warnings);
        lib.save_workbench_set(&set).unwrap();
        assert_eq!(lib.list_workbench_sets().unwrap().len(), 1);
        lib.delete_workbench_set(&set.id).unwrap();
        assert!(lib.list_workbench_sets().unwrap().is_empty());
    }

    #[test]
    fn missing_disks_wrong_revision_and_mixed_releases_are_reported() {
        let (d, lib) = test_library();
        let wb = import(&lib, d.path(), "Workbench3.1", Some("40.40"));
        let ex = import(&lib, d.path(), "Extras3.1", None);
        let set = lib.analyse_workbench_set("partial", &[wb.clone(), ex]).unwrap();
        assert!(set.missing_roles.contains(&DiskRole::Install) && set.missing_roles.contains(&DiskRole::Fonts));
        assert!(!set.revision_confirmed);
        assert!(set.warnings.iter().any(|w| w.contains("40.40") && w.contains("40.42")));

        let old = import(&lib, d.path(), "Workbench2.1", Some("38.36"));
        let mixed = lib.analyse_workbench_set("mixed", &[wb.clone(), old.clone()]).unwrap();
        assert!(mixed.warnings.iter().any(|w| w.contains("different Workbench releases")));
        let w21 = lib.analyse_workbench_set("wb21", &[old]).unwrap();
        assert_eq!(w21.version, WbVersion::V21);
        assert!(w21.revision_confirmed);
        let dup = lib.analyse_workbench_set("dup", &[wb.clone(), wb]).unwrap();
        assert!(dup.warnings.iter().any(|w| w.contains("twice")));
    }

    #[test]
    fn same_role_from_two_images_is_a_duplicate() {
        let (d, lib) = test_library();
        let a = import(&lib, d.path(), "Workbench3.1", Some("40.42"));
        let p = d.path().join("wb-b.adf");
        let mut other = disk("Workbench3.1", Some("40.42"));
        other[200_000] = 1; // different bytes => different image
        std::fs::write(&p, other).unwrap();
        let b = lib.import_media(&p, &CancelToken::new()).unwrap().record.id;
        let set = lib.analyse_workbench_set("d", &[a, b]).unwrap();
        assert!(set.duplicate_roles.contains(&DiskRole::Workbench));
    }

    #[test]
    fn kickstart_mismatch_warnings() {
        assert!(kickstart_compat_warning(WbVersion::V31, 34).is_some());
        assert!(kickstart_compat_warning(WbVersion::V31, 40).is_none());
        assert!(kickstart_compat_warning(WbVersion::V21, 37).is_none());
        assert!(kickstart_compat_warning(WbVersion::V21, 34).is_some());
        assert!(kickstart_compat_warning(WbVersion::Unknown, 34).is_none());
    }
}
