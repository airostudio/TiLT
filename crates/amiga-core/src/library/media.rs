//! Floppy media library: ADF/DMS import, blank disks, writable working copies,
//! export, queues and safe deletion.

use super::Library;
use crate::adf::{self, AdfInfo};
use crate::dms::{self, DmsInfo};
use crate::error::{Error, Result};
use crate::fsutil::{self, unix_now};
use crate::hash::{sha256_hex_bytes, CancelToken};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Adf,
    Dms,
}

impl MediaKind {
    fn as_str(self) -> &'static str {
        match self {
            MediaKind::Adf => "adf",
            MediaKind::Dms => "dms",
        }
    }
    fn parse(s: &str) -> Self {
        if s == "dms" {
            MediaKind::Dms
        } else {
            MediaKind::Adf
        }
    }
}

/// Detail stored as JSON next to each media row.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaInfo {
    pub adf: Option<AdfInfo>,
    pub dms: Option<DmsInfo>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaRecord {
    pub id: String,
    pub kind: MediaKind,
    pub name: String,
    pub sha256: String,
    pub size: u64,
    pub path: PathBuf,
    /// This item is a writable copy of another library item.
    pub parent_id: Option<String>,
    /// For an ADF produced from a DMS: the archive it came from.
    pub source_dms_id: Option<String>,
    /// Untouched import: stored read-only and never modified.
    pub pristine: bool,
    pub imported_at: i64,
    pub last_used: Option<i64>,
    pub missing: bool,
    pub info: MediaInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaImport {
    pub record: MediaRecord,
    pub duplicate: bool,
    /// For a DMS import: the DMS archive row (preserved) alongside the ADF.
    pub dms_record: Option<MediaRecord>,
}

type Row = (String, String, String, String, i64, String, Option<String>, Option<String>, i64, i64, Option<i64>, String);

const COLS: &str = "id,kind,name,sha256,size,path,parent_id,source_dms_id,pristine,imported_at,last_used,info";

fn display_name(src: &Path) -> String {
    src.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "disk".into())
}

impl Library {
    fn media_from_row(r: Row) -> Result<MediaRecord> {
        let path = PathBuf::from(&r.5);
        Ok(MediaRecord {
            id: r.0,
            kind: MediaKind::parse(&r.1),
            name: r.2,
            sha256: r.3,
            size: r.4 as u64,
            missing: !path.is_file(),
            path,
            parent_id: r.6,
            source_dms_id: r.7,
            pristine: r.8 != 0,
            imported_at: r.9,
            last_used: r.10,
            info: serde_json::from_str(&r.11).unwrap_or_default(),
        })
    }

    fn q_media(&self, sql: &str, p: impl rusqlite::Params) -> Result<Vec<MediaRecord>> {
        let rows: Vec<Row> = {
            let db = self.db();
            let mut st = db.prepare(sql)?;
            let v = st
                .query_map(p, |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                        r.get(11)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            v
        };
        rows.into_iter().map(Self::media_from_row).collect()
    }

    pub fn get_media(&self, id: &str) -> Result<MediaRecord> {
        self.q_media(&format!("SELECT {COLS} FROM media WHERE id=?1"), [id])?
            .into_iter()
            .next()
            .ok_or_else(|| Error::NotFound(format!("disk {id}")))
    }

    pub fn list_media(&self) -> Result<Vec<MediaRecord>> {
        self.q_media(&format!("SELECT {COLS} FROM media ORDER BY name COLLATE NOCASE, imported_at"), [])
    }

    fn find_pristine(&self, sha: &str, kind: MediaKind) -> Result<Option<MediaRecord>> {
        Ok(self
            .q_media(
                &format!("SELECT {COLS} FROM media WHERE sha256=?1 AND kind=?2 AND pristine=1"),
                params![sha, kind.as_str()],
            )?
            .into_iter()
            .next())
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_media(
        &self,
        id: &str,
        kind: MediaKind,
        name: &str,
        sha: &str,
        size: u64,
        path: &Path,
        parent: Option<&str>,
        dms: Option<&str>,
        pristine: bool,
        info: &MediaInfo,
    ) -> Result<()> {
        self.db().execute(
            &format!("INSERT INTO media({COLS}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,?11)"),
            params![
                id,
                kind.as_str(),
                name,
                sha,
                size as i64,
                path.to_string_lossy(),
                parent,
                dms,
                pristine as i64,
                unix_now(),
                serde_json::to_string(info).unwrap()
            ],
        )?;
        Ok(())
    }

    /// Import an ADF or DMS. The source is only read. Format is detected from
    /// content, never from the extension.
    pub fn import_media(&self, src: &Path, cancel: &CancelToken) -> Result<MediaImport> {
        let md =
            std::fs::metadata(src).map_err(|e| Error::InvalidDisk(format!("cannot read {}: {e}", src.display())))?;
        if !md.is_file() {
            return Err(Error::InvalidDisk("not a file".into()));
        }
        if md.len() > dms::MAX_DMS_INPUT as u64 {
            return Err(Error::InvalidDisk(format!("{} bytes is too large for a floppy image", md.len())));
        }
        cancel.check()?;
        let data = std::fs::read(src)?;
        if dms::looks_like_dms(&data) {
            self.import_dms_bytes(&data, src)
        } else {
            self.import_adf_bytes(&data, src, None)
        }
    }

    fn import_adf_bytes(&self, data: &[u8], src: &Path, source_dms: Option<&str>) -> Result<MediaImport> {
        let info = adf::inspect(data)?;
        if let Some(existing) = self.find_pristine(&info.sha256, MediaKind::Adf)? {
            return Ok(MediaImport { record: existing, duplicate: true, dms_record: None });
        }
        fsutil::ensure_space(&self.layout.floppies(), data.len() as u64)?;
        let id = fsutil::random_id();
        let dst = self.layout.floppies().join(format!("{id}.adf"));
        fsutil::write_atomic(&dst, &self.layout.partial(), data, false)?;
        fsutil::set_readonly(&dst, true)?;
        let mi = MediaInfo { notes: info.warnings.clone(), adf: Some(info.clone()), dms: None };
        let name = info.volume_name.clone().filter(|n| !n.is_empty()).unwrap_or_else(|| display_name(src));
        self.insert_media(
            &id,
            MediaKind::Adf,
            &name,
            &info.sha256,
            data.len() as u64,
            &dst,
            None,
            source_dms,
            true,
            &mi,
        )?;
        Ok(MediaImport { record: self.get_media(&id)?, duplicate: false, dms_record: None })
    }

    fn import_dms_bytes(&self, data: &[u8], src: &Path) -> Result<MediaImport> {
        let dinfo = dms::info(data)?;
        dms::test(data)?;
        let adf_bytes = dms::to_adf(data)?;
        let sha = sha256_hex_bytes(data);
        // preserve the original archive exactly as supplied
        let dms_rec = match self.find_pristine(&sha, MediaKind::Dms)? {
            Some(r) => r,
            None => {
                fsutil::ensure_space(&self.layout.dms(), data.len() as u64 + adf_bytes.len() as u64)?;
                let id = fsutil::random_id();
                let dst = self.layout.dms().join(format!("{id}.dms"));
                fsutil::write_atomic(&dst, &self.layout.partial(), data, false)?;
                fsutil::set_readonly(&dst, true)?;
                let mi = MediaInfo { dms: Some(dinfo), adf: None, notes: vec![] };
                self.insert_media(
                    &id,
                    MediaKind::Dms,
                    &display_name(src),
                    &sha,
                    data.len() as u64,
                    &dst,
                    None,
                    None,
                    true,
                    &mi,
                )?;
                self.get_media(&id)?
            }
        };
        let mut imp = self.import_adf_bytes(&adf_bytes, src, Some(&dms_rec.id))?;
        imp.dms_record = Some(dms_rec);
        Ok(imp)
    }

    /// Batch import (e.g. a folder of DMS/ADF files). One bad file never stops the rest.
    pub fn import_media_batch(&self, srcs: &[PathBuf], cancel: &CancelToken) -> Vec<(PathBuf, Result<MediaImport>)> {
        let mut out = vec![];
        for s in srcs {
            if cancel.is_cancelled() {
                out.push((s.clone(), Err(Error::Cancelled)));
                continue;
            }
            out.push((s.clone(), self.import_media(s, cancel)));
        }
        out
    }

    /// New, formatted, writable blank disk.
    pub fn create_blank_adf(
        &self,
        name: &str,
        fs: adf::FsKind,
        intl: bool,
        density: adf::Density,
    ) -> Result<MediaRecord> {
        let data = adf::create_blank(name, fs, intl, density, unix_now() as u64)?;
        let info = adf::inspect(&data)?;
        fsutil::ensure_space(&self.layout.floppies(), data.len() as u64)?;
        let id = fsutil::random_id();
        let dst = self.layout.floppies().join(format!("{id}.adf"));
        fsutil::write_atomic(&dst, &self.layout.partial(), &data, false)?;
        let mi = MediaInfo { adf: Some(info.clone()), ..Default::default() };
        self.insert_media(&id, MediaKind::Adf, name, &info.sha256, data.len() as u64, &dst, None, None, false, &mi)?;
        self.get_media(&id)
    }

    /// Writable duplicate of any ADF; the original is never modified.
    pub fn make_working_copy(&self, id: &str, new_name: &str, cancel: &CancelToken) -> Result<MediaRecord> {
        let src = self.get_media(id)?;
        if src.kind != MediaKind::Adf {
            return Err(Error::InvalidDisk("only disk images (ADF) can be copied for writing".into()));
        }
        if src.missing {
            return Err(Error::NotFound("the library file for this disk is missing".into()));
        }
        let nid = fsutil::random_id();
        let dst = self.layout.floppies().join(format!("{nid}.adf"));
        let r = fsutil::copy_atomic(&src.path, &dst, &self.layout.partial(), false, true, cancel, None)?;
        let mi =
            MediaInfo { adf: src.info.adf.clone(), notes: vec![format!("Working copy of {}", src.name)], dms: None };
        self.insert_media(
            &nid,
            MediaKind::Adf,
            new_name,
            &r.sha256,
            r.size,
            &dst,
            Some(id),
            src.source_dms_id.as_deref(),
            false,
            &mi,
        )?;
        self.get_media(&nid)
    }

    /// Verify the stored file still matches its recorded hash (pristine items).
    pub fn verify_media(&self, id: &str, cancel: &CancelToken) -> Result<bool> {
        let r = self.get_media(id)?;
        let (sha, _) = crate::hash::sha256_file(&r.path, cancel, None)?;
        Ok(sha == r.sha256)
    }

    /// Copy a disk out of the library. Never overwrites unless asked.
    pub fn export_media(&self, id: &str, dest: &Path, overwrite: bool, cancel: &CancelToken) -> Result<()> {
        let r = self.get_media(id)?;
        let staging =
            dest.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new(".")).join(".amiga-studio-export");
        let res = fsutil::copy_atomic(&r.path, dest, &staging, overwrite, true, cancel, None).map(|_| ());
        let _ = std::fs::remove_dir(&staging);
        res
    }

    pub fn touch_media(&self, id: &str) -> Result<()> {
        self.db().execute("UPDATE media SET last_used=?2 WHERE id=?1", params![id, unix_now()])?;
        Ok(())
    }

    pub fn recent_media(&self, limit: u32) -> Result<Vec<MediaRecord>> {
        self.q_media(
            &format!("SELECT {COLS} FROM media WHERE last_used IS NOT NULL ORDER BY last_used DESC LIMIT ?1"),
            [limit],
        )
    }

    /// Delete a library copy. Refused while a machine or queue uses it, or
    /// while a derived item depends on it. User-owned originals are never touched.
    pub fn delete_media(&self, id: &str) -> Result<()> {
        let r = self.get_media(id)?;
        let used = self.profiles_using(|p| p.drives.iter().any(|d| d.media_id.as_deref() == Some(id)))?;
        if !used.is_empty() {
            return Err(Error::Unsafe(format!("this disk is inserted in: {}. Eject it there first.", used.join(", "))));
        }
        let queues: Vec<String> =
            self.list_queues()?.into_iter().filter(|q| q.media_ids.iter().any(|m| m == id)).map(|q| q.name).collect();
        if !queues.is_empty() {
            return Err(Error::Unsafe(format!("this disk is in the disk queue: {}.", queues.join(", "))));
        }
        let dependents: i64 =
            self.db().query_row("SELECT COUNT(*) FROM media WHERE source_dms_id=?1", [id], |r| r.get(0))?;
        if dependents > 0 && r.kind == MediaKind::Dms {
            return Err(Error::Unsafe(
                "a disk image converted from this archive is still in the library; delete that first.".into(),
            ));
        }
        self.db().execute("DELETE FROM media WHERE id=?1", [id])?;
        let _ = fsutil::set_readonly(&r.path, false);
        let _ = std::fs::remove_file(&r.path);
        Ok(())
    }

    /// Files in the managed folders that no catalogue row owns (left by a crash).
    pub fn find_orphans(&self) -> Result<Vec<PathBuf>> {
        let known: std::collections::HashSet<PathBuf> = self.list_media()?.into_iter().map(|m| m.path).collect();
        let mut out = vec![];
        for dir in [self.layout.floppies(), self.layout.dms()] {
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    if e.path().is_file() && !known.contains(&e.path()) {
                        out.push(e.path());
                    }
                }
            }
        }
        Ok(out)
    }

    // ---------- disk queue ----------
    pub fn save_queue(&self, id: Option<&str>, name: &str, media_ids: &[String]) -> Result<Queue> {
        for m in media_ids {
            self.get_media(m)?;
        }
        let id = id.map(str::to_string).unwrap_or_else(fsutil::random_id);
        self.db().execute(
            "INSERT INTO queues(id,name,media_ids,updated_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, media_ids=excluded.media_ids, updated_at=excluded.updated_at",
            params![id, name, serde_json::to_string(media_ids).unwrap(), unix_now()],
        )?;
        Ok(Queue { id, name: name.to_string(), media_ids: media_ids.to_vec() })
    }

    pub fn list_queues(&self) -> Result<Vec<Queue>> {
        let db = self.db();
        let mut st = db.prepare("SELECT id,name,media_ids FROM queues ORDER BY name COLLATE NOCASE")?;
        let v = st
            .query_map([], |r| {
                let ids: String = r.get(2)?;
                Ok(Queue { id: r.get(0)?, name: r.get(1)?, media_ids: serde_json::from_str(&ids).unwrap_or_default() })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    pub fn delete_queue(&self, id: &str) -> Result<()> {
        self.db().execute("DELETE FROM queues WHERE id=?1", [id])?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Queue {
    pub id: String,
    pub name: String,
    pub media_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::super::test_library;
    use super::*;
    use crate::adf::{Density, FsKind};

    fn write(dir: &Path, name: &str, data: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, data).unwrap();
        p
    }
    fn blank(name: &str) -> Vec<u8> {
        adf::create_blank(name, FsKind::Ffs, false, Density::Double, 1_700_000_000).unwrap()
    }

    #[test]
    fn adf_import_preserves_original_and_dedups() {
        let (d, lib) = test_library();
        let bytes = blank("Game");
        let src = write(d.path(), "game.adf", &bytes);
        let mtime = std::fs::metadata(&src).unwrap().modified().unwrap();
        let r = lib.import_media(&src, &CancelToken::new()).unwrap();
        assert!(!r.duplicate);
        assert_eq!(r.record.name, "Game", "volume label from the disk itself");
        assert!(r.record.pristine);
        assert_eq!(std::fs::read(&r.record.path).unwrap(), bytes);
        assert!(std::fs::metadata(&r.record.path).unwrap().permissions().readonly());
        assert_eq!(std::fs::read(&src).unwrap(), bytes);
        assert_eq!(std::fs::metadata(&src).unwrap().modified().unwrap(), mtime);
        let again = lib.import_media(&write(d.path(), "copy.adf", &bytes), &CancelToken::new()).unwrap();
        assert!(again.duplicate);
        assert_eq!(lib.list_media().unwrap().len(), 1);
    }

    #[test]
    fn format_detected_from_content_not_extension() {
        let (d, lib) = test_library();
        // an ADF named .dms and junk named .adf
        let a = write(d.path(), "really_an_adf.dms", &blank("X"));
        assert_eq!(lib.import_media(&a, &CancelToken::new()).unwrap().record.kind, MediaKind::Adf);
        let j = write(d.path(), "junk.adf", &[1u8; 1000]);
        assert!(matches!(lib.import_media(&j, &CancelToken::new()), Err(Error::InvalidDisk(_))));
    }

    #[test]
    fn dms_import_preserves_archive_and_creates_adf() {
        let (d, lib) = test_library();
        let adf_bytes = blank("FromDms");
        let dms_bytes = crate::dms::test_support::synthetic(&adf_bytes);
        let src = write(d.path(), "disk.dms", &dms_bytes);
        let r = lib.import_media(&src, &CancelToken::new()).unwrap();
        assert_eq!(r.record.kind, MediaKind::Adf);
        assert_eq!(std::fs::read(&r.record.path).unwrap(), adf_bytes);
        let dr = r.dms_record.unwrap();
        assert_eq!(std::fs::read(&dr.path).unwrap(), dms_bytes, "original archive preserved byte for byte");
        assert_eq!(r.record.source_dms_id.as_deref(), Some(dr.id.as_str()));
        // re-import dedups both
        let r2 = lib.import_media(&src, &CancelToken::new()).unwrap();
        assert!(r2.duplicate);
        assert_eq!(lib.list_media().unwrap().len(), 2);
        // archive cannot be deleted while its ADF exists
        assert!(lib.delete_media(&dr.id).is_err());
        assert_eq!(std::fs::read(&src).unwrap(), dms_bytes, "source untouched");
    }

    #[test]
    fn corrupt_dms_is_rejected_cleanly() {
        let (d, lib) = test_library();
        let mut dms_bytes = crate::dms::test_support::synthetic(&blank("Z"));
        let n = dms_bytes.len();
        dms_bytes[n / 3] ^= 0xFF;
        let src = write(d.path(), "bad.dms", &dms_bytes);
        assert!(matches!(lib.import_media(&src, &CancelToken::new()), Err(Error::Dms(_))));
        assert!(lib.list_media().unwrap().is_empty());
        assert_eq!(std::fs::read_dir(lib.layout.dms()).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(lib.layout.floppies()).unwrap().count(), 0);
    }

    #[test]
    fn batch_import_continues_after_failures() {
        let (d, lib) = test_library();
        let a = write(d.path(), "a.adf", &blank("A"));
        let b = write(d.path(), "b.adf", &[0u8; 10]);
        let c = write(d.path(), "c.adf", &blank("C"));
        let res = lib.import_media_batch(&[a, b, c], &CancelToken::new());
        assert_eq!(res.iter().filter(|r| r.1.is_ok()).count(), 2);
    }

    #[test]
    fn working_copy_is_writable_and_independent() {
        let (d, lib) = test_library();
        let r = lib.import_media(&write(d.path(), "g.adf", &blank("G")), &CancelToken::new()).unwrap().record;
        let w = lib.make_working_copy(&r.id, "G (work)", &CancelToken::new()).unwrap();
        assert!(!w.pristine && w.parent_id.as_deref() == Some(r.id.as_str()));
        assert!(!std::fs::metadata(&w.path).unwrap().permissions().readonly());
        let mut f = std::fs::read(&w.path).unwrap();
        f[2000] = 0xAB;
        std::fs::write(&w.path, &f).unwrap();
        assert!(lib.verify_media(&r.id, &CancelToken::new()).unwrap(), "pristine unaffected");
        assert!(!lib.verify_media(&w.id, &CancelToken::new()).unwrap(), "working copy changed");
    }

    #[test]
    fn blank_disk_and_export_safety() {
        let (d, lib) = test_library();
        let b = lib.create_blank_adf("Scratch", FsKind::Ofs, false, Density::Double).unwrap();
        assert!(!b.pristine);
        let out = d.path().join("export/scratch.adf");
        std::fs::create_dir_all(out.parent().unwrap()).unwrap();
        lib.export_media(&b.id, &out, false, &CancelToken::new()).unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), std::fs::read(&b.path).unwrap());
        assert!(matches!(lib.export_media(&b.id, &out, false, &CancelToken::new()), Err(Error::AlreadyExists(_))));
        // exporting onto the library's own file is blocked even with overwrite
        assert!(matches!(lib.export_media(&b.id, &b.path, true, &CancelToken::new()), Err(Error::Unsafe(_))));
        assert!(!out.parent().unwrap().join(".amiga-studio-export").exists());
    }

    #[test]
    fn delete_checks_references() {
        let (d, lib) = test_library();
        lib.ensure_default_profiles().unwrap();
        let r = lib.import_media(&write(d.path(), "g.adf", &blank("G")), &CancelToken::new()).unwrap().record;
        let mut p = lib.get_profile("preset-a500").unwrap();
        p.drives[0].media_id = Some(r.id.clone());
        lib.save_profile(&p).unwrap();
        assert!(matches!(lib.delete_media(&r.id), Err(Error::Unsafe(_))));
        p.drives[0].media_id = None;
        lib.save_profile(&p).unwrap();
        let q = lib.save_queue(None, "Game disks", std::slice::from_ref(&r.id)).unwrap();
        assert!(matches!(lib.delete_media(&r.id), Err(Error::Unsafe(_))));
        lib.delete_queue(&q.id).unwrap();
        lib.delete_media(&r.id).unwrap();
        assert!(!r.path.exists());
    }

    #[test]
    fn queue_order_persists_and_validates_ids() {
        let (d, lib) = test_library();
        let a = lib.import_media(&write(d.path(), "a.adf", &blank("A")), &CancelToken::new()).unwrap().record;
        let b = lib.import_media(&write(d.path(), "b.adf", &blank("B")), &CancelToken::new()).unwrap().record;
        let q = lib.save_queue(None, "Q", &[b.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(lib.list_queues().unwrap()[0].media_ids, vec![b.id.clone(), a.id.clone()]);
        assert!(lib.save_queue(Some(&q.id), "Q", &["nope".into()]).is_err());
    }

    #[test]
    fn orphans_are_found_not_deleted() {
        let (_d, lib) = test_library();
        std::fs::write(lib.layout.floppies().join("stray.adf"), b"x").unwrap();
        assert_eq!(lib.find_orphans().unwrap().len(), 1);
        assert!(lib.layout.floppies().join("stray.adf").exists());
    }

    #[test]
    fn recent_media_orders_by_last_use() {
        let (d, lib) = test_library();
        let a = lib.import_media(&write(d.path(), "a.adf", &blank("A")), &CancelToken::new()).unwrap().record;
        assert!(lib.recent_media(5).unwrap().is_empty());
        lib.touch_media(&a.id).unwrap();
        assert_eq!(lib.recent_media(5).unwrap()[0].id, a.id);
    }
}
