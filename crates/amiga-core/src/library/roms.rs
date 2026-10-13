//! ROM library: import (copy or reference), duplicates, relink, safe removal.

use super::Library;
use crate::error::{Error, Result};
use crate::fsutil::{self, unix_now};
use crate::rom::{self, RomInfo};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMode {
    /// A copy lives in the managed library.
    Managed,
    /// The original file is used in place.
    Referenced,
}

impl StorageMode {
    pub fn as_str(self) -> &'static str {
        match self {
            StorageMode::Managed => "managed",
            StorageMode::Referenced => "referenced",
        }
    }
    fn parse(s: &str) -> StorageMode {
        if s == "referenced" {
            StorageMode::Referenced
        } else {
            StorageMode::Managed
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomRecord {
    pub id: String,
    pub name: String,
    pub storage: StorageMode,
    pub path: PathBuf,
    pub imported_at: i64,
    /// A referenced ROM whose file can no longer be found (offer relink).
    pub missing: bool,
    pub info: RomInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomImport {
    pub record: RomRecord,
    /// The ROM was already in the library; nothing new was stored.
    pub duplicate: bool,
}

impl Library {
    fn rom_from_row(
        id: String,
        name: String,
        storage: String,
        path: String,
        at: i64,
        info: String,
    ) -> Result<RomRecord> {
        let info: RomInfo = serde_json::from_str(&info).map_err(|e| Error::InvalidRom(e.to_string()))?;
        let path = PathBuf::from(path);
        Ok(RomRecord {
            missing: !path.is_file(),
            id,
            name,
            storage: StorageMode::parse(&storage),
            path,
            imported_at: at,
            info,
        })
    }

    /// Import one ROM file. Invalid files are rejected and nothing is stored.
    pub fn import_rom(&self, src: &Path, mode: StorageMode) -> Result<RomImport> {
        let md =
            std::fs::metadata(src).map_err(|e| Error::InvalidRom(format!("cannot read {}: {e}", src.display())))?;
        if !md.is_file() {
            return Err(Error::InvalidRom("not a file".into()));
        }
        if md.len() > rom::MAX_ROM_SIZE {
            return Err(Error::InvalidRom(format!("{} bytes is too large for a ROM", md.len())));
        }
        let data = std::fs::read(src)?;
        let info = rom::inspect(&data)?;
        if !info.is_usable() {
            let why = info.warnings.first().cloned().unwrap_or_else(|| "not a valid Kickstart ROM".into());
            return Err(Error::InvalidRom(why));
        }
        if let Some(existing) = self.find_rom_by_hash(&info.sha256)? {
            return Ok(RomImport { record: existing, duplicate: true });
        }
        let id = fsutil::random_id();
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "rom".into());
        let path = match mode {
            StorageMode::Managed => {
                fsutil::ensure_space(&self.layout.roms(), data.len() as u64)?;
                let dst = self.layout.roms().join(format!("{}.rom", &info.sha256[..16]));
                fsutil::write_atomic(&dst, &self.layout.partial(), &data, false).or_else(|e| match e {
                    Error::AlreadyExists(_) => Ok(()), // identical bytes already stored under this name
                    o => Err(o),
                })?;
                dst
            }
            StorageMode::Referenced => src.canonicalize()?,
        };
        let info_json = serde_json::to_string(&info).unwrap();
        self.db().execute(
            "INSERT INTO roms(id,sha256,name,size,storage,path,imported_at,info) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![id, info.sha256, name, info.size, mode.as_str(), path.to_string_lossy(), unix_now(), info_json],
        )?;
        Ok(RomImport { record: self.get_rom(&id)?, duplicate: false })
    }

    /// Import many files; each outcome is independent so one bad file never blocks the rest.
    pub fn import_roms(&self, srcs: &[PathBuf], mode: StorageMode) -> Vec<(PathBuf, Result<RomImport>)> {
        srcs.iter().map(|p| (p.clone(), self.import_rom(p, mode))).collect()
    }

    pub fn find_rom_by_hash(&self, sha: &str) -> Result<Option<RomRecord>> {
        let row = self
            .db()
            .query_row("SELECT id,name,storage,path,imported_at,info FROM roms WHERE sha256=?1", [sha], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })
            .optional()?;
        row.map(|(a, b, c, d, e, f)| Self::rom_from_row(a, b, c, d, e, f)).transpose()
    }

    pub fn get_rom(&self, id: &str) -> Result<RomRecord> {
        let row = self
            .db()
            .query_row("SELECT id,name,storage,path,imported_at,info FROM roms WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("ROM {id}")))?;
        Self::rom_from_row(row.0, row.1, row.2, row.3, row.4, row.5)
    }

    pub fn list_roms(&self) -> Result<Vec<RomRecord>> {
        let rows: Vec<_> = {
            let db = self.db();
            let mut st = db.prepare("SELECT id,name,storage,path,imported_at,info FROM roms ORDER BY imported_at")?;
            let v = st
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            v
        };
        rows.into_iter().map(|(a, b, c, d, e, f)| Self::rom_from_row(a, b, c, d, e, f)).collect()
    }

    /// Point a moved referenced ROM at its new location. The new file must be
    /// the same ROM (same SHA-256) - a different file is refused.
    pub fn relink_rom(&self, id: &str, new_path: &Path) -> Result<RomRecord> {
        let rec = self.get_rom(id)?;
        let data = std::fs::read(new_path)?;
        if data.len() as u64 > rom::MAX_ROM_SIZE {
            return Err(Error::InvalidRom("too large".into()));
        }
        let info = rom::inspect(&data)?;
        if info.sha256 != rec.info.sha256 {
            return Err(Error::InvalidRom("that file is a different ROM from the one being relinked".into()));
        }
        self.db().execute(
            "UPDATE roms SET path=?2, storage='referenced' WHERE id=?1",
            params![id, new_path.canonicalize()?.to_string_lossy()],
        )?;
        self.get_rom(id)
    }

    /// Resolve the host path the emulator should load, verifying it still exists.
    pub fn rom_path(&self, id: &str) -> Result<PathBuf> {
        let r = self.get_rom(id)?;
        if r.missing {
            return Err(Error::NotFound(format!(
                "The ROM file for '{}' has moved. Use Relink in the ROM Library.",
                r.name
            )));
        }
        Ok(r.path)
    }

    /// Remove a ROM from the library. Refused while any machine uses it. A
    /// managed copy is deleted; a referenced original is never touched.
    pub fn remove_rom(&self, id: &str) -> Result<()> {
        let rec = self.get_rom(id)?;
        let used = self.profiles_using(|p| p.rom_id.as_deref() == Some(id) || p.ext_rom_id.as_deref() == Some(id))?;
        if !used.is_empty() {
            return Err(Error::Unsafe(format!(
                "this ROM is used by: {}. Pick another ROM for those machines first.",
                used.join(", ")
            )));
        }
        self.db().execute("DELETE FROM roms WHERE id=?1", [id])?;
        if rec.storage == StorageMode::Managed {
            let _ = std::fs::remove_file(&rec.path);
        }
        Ok(())
    }

    /// Best ROM for a machine: first one that is usable and capable.
    pub fn suggest_rom(&self, needs_aga: bool, min_exec_version: u16) -> Result<Option<RomRecord>> {
        let mut roms: Vec<RomRecord> = self
            .list_roms()?
            .into_iter()
            .filter(|r| !r.missing && r.info.is_usable())
            .filter(|r| !needs_aga || r.info.aga_capable)
            .filter(|r| r.info.exec_version.is_none_or(|v| v >= min_exec_version))
            .collect();
        roms.sort_by_key(|r| (r.info.is_aros, std::cmp::Reverse(r.info.exec_version)));
        Ok(roms.into_iter().next())
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_library;
    use super::*;
    use crate::rom::test_support::synthetic_rom;

    fn write(dir: &Path, name: &str, data: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, data).unwrap();
        p
    }

    #[test]
    fn import_managed_detects_version_from_content_and_dedups() {
        let (d, lib) = test_library();
        // deliberately misleading file name
        let p = write(d.path(), "kick31.rom", &synthetic_rom(0x40000, 34, 5));
        let r = lib.import_rom(&p, StorageMode::Managed).unwrap();
        assert!(!r.duplicate);
        assert_eq!(r.record.info.family.as_deref(), Some("Kickstart 1.3"));
        assert!(r.record.path.starts_with(lib.layout.roms()));
        assert!(r.record.path.is_file());
        // same content under another name is a duplicate
        let p2 = write(d.path(), "other.bin", &synthetic_rom(0x40000, 34, 5));
        let r2 = lib.import_rom(&p2, StorageMode::Managed).unwrap();
        assert!(r2.duplicate);
        assert_eq!(r2.record.id, r.record.id);
        assert_eq!(lib.list_roms().unwrap().len(), 1);
    }

    #[test]
    fn invalid_roms_are_rejected_and_nothing_is_stored() {
        let (d, lib) = test_library();
        let mut bad = synthetic_rom(0x40000, 34, 5);
        bad[100] ^= 1;
        for (name, data) in [("c.rom", bad), ("z.rom", vec![0u8; 0x40000]), ("e.rom", vec![]), ("s.rom", vec![1u8; 77])]
        {
            let p = write(d.path(), name, &data);
            assert!(matches!(lib.import_rom(&p, StorageMode::Managed), Err(Error::InvalidRom(_))), "{name}");
        }
        assert!(lib.list_roms().unwrap().is_empty());
        assert_eq!(std::fs::read_dir(lib.layout.roms()).unwrap().count(), 0);
        assert!(lib.import_rom(&d.path().join("missing.rom"), StorageMode::Managed).is_err());
    }

    #[test]
    fn batch_import_isolates_failures() {
        let (d, lib) = test_library();
        let good = write(d.path(), "g.rom", &synthetic_rom(0x80000, 40, 68));
        let bad = write(d.path(), "b.rom", &[1, 2, 3]);
        let res = lib.import_roms(&[bad, good], StorageMode::Managed);
        assert!(res[0].1.is_err() && res[1].1.is_ok());
    }

    #[test]
    fn referenced_rom_relink_workflow() {
        let (d, lib) = test_library();
        let bytes = synthetic_rom(0x80000, 40, 68);
        let orig = write(d.path(), "kick.rom", &bytes);
        let r = lib.import_rom(&orig, StorageMode::Referenced).unwrap().record;
        assert_eq!(r.storage, StorageMode::Referenced);
        assert!(!r.missing);
        assert_eq!(std::fs::read_dir(lib.layout.roms()).unwrap().count(), 0, "no copy made");
        // user moves the file
        let moved = d.path().join("elsewhere");
        std::fs::create_dir_all(&moved).unwrap();
        std::fs::rename(&orig, moved.join("kick.rom")).unwrap();
        assert!(lib.get_rom(&r.id).unwrap().missing);
        assert!(matches!(lib.rom_path(&r.id), Err(Error::NotFound(_))));
        // relinking to a different ROM is refused
        let other = write(&moved, "other.rom", &synthetic_rom(0x80000, 37, 175));
        assert!(lib.relink_rom(&r.id, &other).is_err());
        let fixed = lib.relink_rom(&r.id, &moved.join("kick.rom")).unwrap();
        assert!(!fixed.missing);
        assert!(lib.rom_path(&r.id).is_ok());
    }

    #[test]
    fn remove_respects_references_and_never_deletes_originals() {
        let (d, lib) = test_library();
        lib.ensure_default_profiles().unwrap();
        let orig = write(d.path(), "k.rom", &synthetic_rom(0x40000, 34, 5));
        let rec = lib.import_rom(&orig, StorageMode::Referenced).unwrap().record;
        let mut p = lib.get_profile("preset-a500").unwrap();
        p.rom_id = Some(rec.id.clone());
        lib.save_profile(&p).unwrap();
        assert!(matches!(lib.remove_rom(&rec.id), Err(Error::Unsafe(_))));
        p.rom_id = None;
        lib.save_profile(&p).unwrap();
        lib.remove_rom(&rec.id).unwrap();
        assert!(orig.exists(), "referenced original must survive");
        // managed copy is removed
        let rec2 = lib.import_rom(&orig, StorageMode::Managed).unwrap().record;
        let managed = rec2.path.clone();
        lib.remove_rom(&rec2.id).unwrap();
        assert!(!managed.exists() && orig.exists());
    }

    #[test]
    fn suggest_prefers_real_roms_and_capability() {
        let (d, lib) = test_library();
        let k13 = write(d.path(), "a", &synthetic_rom(0x40000, 34, 5));
        let k31 = write(d.path(), "b", &synthetic_rom(0x80000, 40, 68));
        lib.import_rom(&k13, StorageMode::Managed).unwrap();
        lib.import_rom(&k31, StorageMode::Managed).unwrap();
        let aga = lib.suggest_rom(true, 0).unwrap().unwrap();
        assert_eq!(aga.info.exec_version, Some(40));
        let old = lib.suggest_rom(false, 0).unwrap().unwrap();
        assert_eq!(old.info.exec_version, Some(40), "newest wins when several fit");
        assert!(lib.suggest_rom(true, 41).unwrap().is_none());
    }
}
