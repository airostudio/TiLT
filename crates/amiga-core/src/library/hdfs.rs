//! Hard-disk library: import with a managed working copy, locking, backups,
//! snapshots, journalled restore, export and session preparation.
//!
//! Integrity model
//! * The user's original HDF is only ever *read*. Its SHA-256 is recorded.
//! * The emulator only ever sees `HardDrives/<id>/working.hdf`.
//! * Optionally a read-only `pristine.hdf` keeps the as-imported state.
//! * Every maintenance operation and every emulator session takes the image's
//!   exclusive [`DiskLock`], so a backup can never race a running emulator and
//!   two emulators can never write the same image.
//! * Restore is journalled: staged + verified first, then swapped, with the old
//!   working copy preserved as a "pre-restore" backup. Interrupted swaps are
//!   rolled forward or back on the next start.

use super::Library;
use crate::error::{Error, Result};
use crate::fsutil::{self, unix_now, DiskLock};
use crate::hash::{CancelToken, Progress};
use crate::hdf::{self, HdfInfo, HdfLayout};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotKind {
    /// Taken automatically before a session that will write.
    AutoBackup,
    /// Taken by the user on request.
    Backup,
    /// Named restore point.
    Snapshot,
    /// The working copy as it was just before a restore replaced it.
    PreRestore,
}

impl SnapshotKind {
    fn as_str(self) -> &'static str {
        match self {
            SnapshotKind::AutoBackup => "auto_backup",
            SnapshotKind::Backup => "backup",
            SnapshotKind::Snapshot => "snapshot",
            SnapshotKind::PreRestore => "pre_restore",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "auto_backup" => SnapshotKind::AutoBackup,
            "snapshot" => SnapshotKind::Snapshot,
            "pre_restore" => SnapshotKind::PreRestore,
            _ => SnapshotKind::Backup,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotRecord {
    pub id: String,
    pub hdf_id: String,
    pub kind: SnapshotKind,
    pub note: String,
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HdfRecord {
    pub id: String,
    pub name: String,
    pub original_path: Option<String>,
    pub original_sha256: String,
    pub size: u64,
    pub working_path: PathBuf,
    pub pristine_path: Option<PathBuf>,
    /// The emulator may have written since the last backup.
    pub dirty: bool,
    /// The last session ended without a clean emulator shutdown.
    pub unclean_shutdown: bool,
    pub imported_at: i64,
    pub working_missing: bool,
    pub info: HdfInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportEstimate {
    pub source_size: u64,
    pub required_bytes: u64,
    pub free_bytes: u64,
    pub enough_space: bool,
    pub info: HdfInfo,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct HdfImportOptions {
    /// Keep an untouched read-only copy of the import (costs one extra image of disk space).
    pub keep_pristine: bool,
    /// Import even if no Amiga disk layout was recognised.
    pub accept_unrecognised: bool,
}

impl Default for HdfImportOptions {
    fn default() -> Self {
        HdfImportOptions { keep_pristine: true, accept_unrecognised: false }
    }
}

/// Held while an emulator session uses an HDF. Dropping releases the lock.
#[derive(Debug)]
pub struct HdfSessionGuard {
    pub hdf_id: String,
    pub working_path: PathBuf,
    pub lock: DiskLock,
    pub auto_backup: Option<SnapshotRecord>,
}

/// Auto-backups kept per disk; user backups/snapshots are never auto-deleted.
pub const AUTO_BACKUPS_KEPT: usize = 2;

#[derive(Serialize, Deserialize)]
struct SwapJournal {
    hdf_id: String,
    working: PathBuf,
    staged: PathBuf,
    saved_old: PathBuf,
}

type HRow = (String, String, Option<String>, String, i64, String, i64, i64, i64, i64, String);
const HCOLS: &str = "id,name,original_path,original_sha256,size,dirname,has_pristine,dirty,unclean,imported_at,info";

impl Library {
    pub fn hdf_dir(&self, id: &str) -> PathBuf {
        self.layout.hard_drives().join(id)
    }

    fn hdf_from_row(&self, r: HRow) -> Result<HdfRecord> {
        let dir = self.layout.hard_drives().join(&r.5);
        let working = dir.join("working.hdf");
        Ok(HdfRecord {
            working_missing: !working.is_file(),
            id: r.0,
            name: r.1,
            original_path: r.2,
            original_sha256: r.3,
            size: r.4 as u64,
            working_path: working,
            pristine_path: (r.6 != 0).then(|| dir.join("pristine.hdf")),
            dirty: r.7 != 0,
            unclean_shutdown: r.8 != 0,
            imported_at: r.9,
            info: serde_json::from_str(&r.10).map_err(|e| Error::InvalidHdf(e.to_string()))?,
        })
    }

    fn q_hdfs(&self, sql: &str, p: impl rusqlite::Params) -> Result<Vec<HdfRecord>> {
        let rows: Vec<HRow> = {
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
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            v
        };
        rows.into_iter().map(|r| self.hdf_from_row(r)).collect()
    }

    pub fn get_hdf(&self, id: &str) -> Result<HdfRecord> {
        self.q_hdfs(&format!("SELECT {HCOLS} FROM hdfs WHERE id=?1"), [id])?
            .into_iter()
            .next()
            .ok_or_else(|| Error::NotFound(format!("hard disk {id}")))
    }

    pub fn list_hdfs(&self) -> Result<Vec<HdfRecord>> {
        self.q_hdfs(&format!("SELECT {HCOLS} FROM hdfs ORDER BY name COLLATE NOCASE"), [])
    }

    /// Inspect a candidate and say how much space importing it needs.
    pub fn estimate_hdf_import(&self, src: &Path, keep_pristine: bool) -> Result<ImportEstimate> {
        let info = hdf::inspect_file(src)?;
        let required = info.size * if keep_pristine { 2 } else { 1 } + fsutil::SPACE_MARGIN;
        let free = fsutil::available_space(&self.layout.hard_drives())?;
        Ok(ImportEstimate {
            source_size: info.size,
            required_bytes: required,
            free_bytes: free,
            enough_space: free >= required,
            info,
        })
    }

    /// Import an HDF as a managed working copy. The source is opened read-only.
    pub fn import_hdf(
        &self,
        src: &Path,
        name: &str,
        opts: HdfImportOptions,
        cancel: &CancelToken,
        progress: Option<Progress<'_>>,
    ) -> Result<HdfRecord> {
        let src = src.canonicalize().map_err(|e| Error::InvalidHdf(format!("cannot read {}: {e}", src.display())))?;
        if src.starts_with(self.layout.hard_drives()) {
            return Err(Error::Unsafe("that file is already inside the Amiga Studio library".into()));
        }
        let est = self.estimate_hdf_import(&src, opts.keep_pristine)?;
        if matches!(est.info.layout, HdfLayout::Unrecognised) && !opts.accept_unrecognised {
            return Err(Error::InvalidHdf(format!(
                "{} (import anyway only if you are sure this is an Amiga disk)",
                est.info.summary
            )));
        }
        if !est.enough_space {
            return Err(Error::InsufficientSpace { needed: est.required_bytes, available: est.free_bytes });
        }
        let id = fsutil::random_id();
        let dir = self.hdf_dir(&id);
        std::fs::create_dir_all(&dir)?;
        let result = (|| -> Result<HdfRecord> {
            let working = dir.join("working.hdf");
            let mut progress = progress;
            let copy = fsutil::copy_atomic(
                &src,
                &working,
                &self.layout.partial(),
                false,
                true,
                cancel,
                progress.as_mut().map(|p| &mut **p as &mut dyn FnMut(u64, u64)),
            )?;
            if opts.keep_pristine {
                let pristine = dir.join("pristine.hdf");
                fsutil::copy_atomic(&working, &pristine, &self.layout.partial(), false, true, cancel, None)?;
                fsutil::set_readonly(&pristine, true)?;
            }
            let info = hdf::inspect_file(&working)?;
            self.db().execute(
                &format!("INSERT INTO hdfs({HCOLS}) VALUES(?1,?2,?3,?4,?5,?6,?7,0,0,?8,?9)"),
                params![
                    id,
                    name,
                    src.to_string_lossy(),
                    copy.sha256,
                    copy.size as i64,
                    id,
                    opts.keep_pristine as i64,
                    unix_now(),
                    serde_json::to_string(&info).unwrap()
                ],
            )?;
            self.get_hdf(&id)
        })();
        if result.is_err() {
            // roll back: nothing half-imported is left behind
            let _ = fsutil::set_readonly(&dir.join("pristine.hdf"), false);
            let _ = std::fs::remove_dir_all(&dir);
        }
        result
    }

    fn lock_path(&self, id: &str) -> PathBuf {
        self.hdf_dir(id).join(".lock")
    }

    /// Take the exclusive lock for maintenance or an emulator session.
    pub fn lock_hdf(&self, id: &str) -> Result<DiskLock> {
        let rec = self.get_hdf(id)?;
        DiskLock::acquire(&self.lock_path(id), &rec.name)
    }

    fn snapshot_dir(&self, kind: SnapshotKind, hdf_id: &str) -> PathBuf {
        match kind {
            SnapshotKind::Snapshot => self.layout.snapshots().join(hdf_id),
            _ => self.layout.backups().join(hdf_id),
        }
    }

    fn store_snapshot(
        &self,
        hdf: &HdfRecord,
        kind: SnapshotKind,
        note: &str,
        _lock: &DiskLock,
        cancel: &CancelToken,
        progress: Option<Progress<'_>>,
    ) -> Result<SnapshotRecord> {
        let sid = fsutil::random_id();
        let dir = self.snapshot_dir(kind, &hdf.id);
        let dst = dir.join(format!("{sid}.hdf"));
        let mut progress = progress;
        let r = fsutil::copy_atomic(
            &hdf.working_path,
            &dst,
            &self.layout.partial(),
            false,
            true,
            cancel,
            progress.as_mut().map(|p| &mut **p as &mut dyn FnMut(u64, u64)),
        )?;
        fsutil::set_readonly(&dst, true)?;
        self.db().execute(
            "INSERT INTO snapshots(id,hdf_id,kind,note,path,size,sha256,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![sid, hdf.id, kind.as_str(), note, dst.to_string_lossy(), r.size as i64, r.sha256, unix_now()],
        )?;
        self.db().execute("UPDATE hdfs SET dirty=0 WHERE id=?1", [&hdf.id])?;
        self.get_snapshot(&sid)
    }

    /// Backup (or named snapshot) of the working copy. Fails with `Locked` if an
    /// emulator is using the disk.
    pub fn backup_hdf(
        &self,
        id: &str,
        kind: SnapshotKind,
        note: &str,
        cancel: &CancelToken,
        progress: Option<Progress<'_>>,
    ) -> Result<SnapshotRecord> {
        let hdf = self.get_hdf(id)?;
        if hdf.working_missing {
            return Err(Error::NotFound("the working copy of this disk is missing".into()));
        }
        let lock = self.lock_hdf(id)?;
        fsutil::ensure_space(&self.layout.backups(), hdf.size)?;
        self.store_snapshot(&hdf, kind, note, &lock, cancel, progress)
    }

    pub fn get_snapshot(&self, id: &str) -> Result<SnapshotRecord> {
        self.q_snaps("SELECT id,hdf_id,kind,note,path,size,sha256,created_at FROM snapshots WHERE id=?1", [id])?
            .into_iter()
            .next()
            .ok_or_else(|| Error::NotFound(format!("snapshot {id}")))
    }

    pub fn list_snapshots(&self, hdf_id: &str) -> Result<Vec<SnapshotRecord>> {
        self.q_snaps("SELECT id,hdf_id,kind,note,path,size,sha256,created_at FROM snapshots WHERE hdf_id=?1 ORDER BY created_at DESC, rowid DESC", [hdf_id])
    }

    fn q_snaps(&self, sql: &str, p: impl rusqlite::Params) -> Result<Vec<SnapshotRecord>> {
        let db = self.db();
        let mut st = db.prepare(sql)?;
        let v = st
            .query_map(p, |r| {
                let k: String = r.get(2)?;
                let path: String = r.get(4)?;
                Ok(SnapshotRecord {
                    id: r.get(0)?,
                    hdf_id: r.get(1)?,
                    kind: SnapshotKind::parse(&k),
                    note: r.get(3)?,
                    path: PathBuf::from(path),
                    size: r.get::<_, i64>(5)? as u64,
                    sha256: r.get(6)?,
                    created_at: r.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    pub fn delete_snapshot(&self, id: &str) -> Result<()> {
        let s = self.get_snapshot(id)?;
        self.db().execute("DELETE FROM snapshots WHERE id=?1", [id])?;
        let _ = fsutil::set_readonly(&s.path, false);
        let _ = std::fs::remove_file(&s.path);
        Ok(())
    }

    /// Replace the working copy with a snapshot, journalled and reversible.
    pub fn restore_hdf(
        &self,
        hdf_id: &str,
        snapshot_id: &str,
        cancel: &CancelToken,
        progress: Option<Progress<'_>>,
    ) -> Result<()> {
        let hdf = self.get_hdf(hdf_id)?;
        let snap = self.get_snapshot(snapshot_id)?;
        if snap.hdf_id != hdf_id {
            return Err(Error::Unsafe("that snapshot belongs to a different disk".into()));
        }
        let lock = self.lock_hdf(hdf_id)?;
        // verify the snapshot is intact BEFORE touching anything
        let (sha, _) = crate::hash::sha256_file(&snap.path, cancel, None)?;
        if sha != snap.sha256 {
            return Err(Error::Unsafe(
                "the snapshot file is damaged (checksum mismatch); the working copy was not changed".into(),
            ));
        }
        fsutil::ensure_space(&self.layout.partial(), snap.size * 2)?;
        let staged = self.layout.partial().join(format!("restore-{}.hdf", fsutil::random_id()));
        let mut progress = progress;
        // stage + verify a full copy first
        fsutil::copy_atomic(
            &snap.path,
            &staged,
            &self.layout.partial(),
            false,
            true,
            cancel,
            progress.as_mut().map(|p| &mut **p as &mut dyn FnMut(u64, u64)),
        )?;
        let saved_old =
            self.snapshot_dir(SnapshotKind::PreRestore, hdf_id).join(format!("{}.hdf", fsutil::random_id()));
        std::fs::create_dir_all(saved_old.parent().unwrap())?;
        let jid = self.journal_begin(
            "hdf_swap",
            &serde_json::to_value(SwapJournal {
                hdf_id: hdf_id.into(),
                working: hdf.working_path.clone(),
                staged: staged.clone(),
                saved_old: saved_old.clone(),
            })
            .unwrap(),
        )?;
        std::fs::rename(&hdf.working_path, &saved_old)?;
        std::fs::rename(&staged, &hdf.working_path)?;
        let (osha, osize) = crate::hash::sha256_file(&saved_old, cancel, None).unwrap_or_default();
        fsutil::set_readonly(&saved_old, true)?;
        self.db().execute(
            "INSERT INTO snapshots(id,hdf_id,kind,note,path,size,sha256,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                fsutil::random_id(),
                hdf_id,
                SnapshotKind::PreRestore.as_str(),
                format!("Before restoring snapshot {snapshot_id}"),
                saved_old.to_string_lossy(),
                osize as i64,
                osha,
                unix_now()
            ],
        )?;
        self.db().execute("UPDATE hdfs SET dirty=0, unclean=0 WHERE id=?1", [hdf_id])?;
        self.journal_end(&jid)?;
        drop(lock);
        Ok(())
    }

    /// Finish an interrupted swap. Returns true if rolled forward, false if rolled back.
    pub(super) fn recover_hdf_swap(&self, data: &str) -> Result<bool> {
        let j: SwapJournal = serde_json::from_str(data).map_err(|e| Error::InvalidHdf(e.to_string()))?;
        let working_ok = j.working.is_file();
        if !working_ok {
            if j.staged.is_file() {
                std::fs::rename(&j.staged, &j.working)?; // roll forward
                return Ok(true);
            }
            if j.saved_old.is_file() {
                let _ = fsutil::set_readonly(&j.saved_old, false);
                std::fs::rename(&j.saved_old, &j.working)?; // roll back
                return Ok(false);
            }
            return Err(Error::InvalidHdf("interrupted restore left no usable disk image".into()));
        }
        let _ = std::fs::remove_file(&j.staged);
        Ok(j.saved_old.is_file())
    }

    /// Copy the complete, current disk out to `dest`.
    pub fn export_hdf(
        &self,
        id: &str,
        dest: &Path,
        overwrite: bool,
        cancel: &CancelToken,
        progress: Option<Progress<'_>>,
    ) -> Result<()> {
        let hdf = self.get_hdf(id)?;
        let _lock = self.lock_hdf(id)?;
        if fsutil::same_file(&hdf.working_path, dest) || dest.starts_with(self.hdf_dir(id)) {
            return Err(Error::Unsafe("choose a location outside the library".into()));
        }
        let staging =
            dest.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new(".")).join(".amiga-studio-export");
        let mut progress = progress;
        let r = fsutil::copy_atomic(
            &hdf.working_path,
            dest,
            &staging,
            overwrite,
            true,
            cancel,
            progress.as_mut().map(|p| &mut **p as &mut dyn FnMut(u64, u64)),
        )
        .map(|_| ());
        let _ = std::fs::remove_dir(&staging);
        r
    }

    /// Prepare to run an emulator on this disk: take the lock, make a safety
    /// backup when the previous session may have written, and mark it dirty.
    pub fn begin_hdf_session(&self, id: &str, read_only: bool, cancel: &CancelToken) -> Result<HdfSessionGuard> {
        let hdf = self.get_hdf(id)?;
        if hdf.working_missing {
            return Err(Error::NotFound("the working copy of this disk is missing; restore it from a backup".into()));
        }
        let lock = self.lock_hdf(id)?;
        let mut auto = None;
        if !read_only {
            let have_any_restore_point = hdf.pristine_path.is_some() || !self.list_snapshots(id)?.is_empty();
            let needs = hdf.dirty || !have_any_restore_point;
            if needs {
                fsutil::ensure_space(&self.layout.backups(), hdf.size)?;
                auto = Some(self.store_snapshot(
                    &hdf,
                    SnapshotKind::AutoBackup,
                    "Automatic backup before a session",
                    &lock,
                    cancel,
                    None,
                )?);
                self.prune_auto_backups(id)?;
            }
            self.db().execute("UPDATE hdfs SET dirty=1 WHERE id=?1", [id])?;
        }
        Ok(HdfSessionGuard { hdf_id: id.to_string(), working_path: hdf.working_path, lock, auto_backup: auto })
    }

    pub fn end_hdf_session(&self, guard: HdfSessionGuard, clean: bool) -> Result<()> {
        self.db().execute("UPDATE hdfs SET unclean=?2 WHERE id=?1", params![guard.hdf_id, (!clean) as i64])?;
        drop(guard);
        Ok(())
    }

    fn prune_auto_backups(&self, id: &str) -> Result<()> {
        let autos: Vec<SnapshotRecord> =
            self.list_snapshots(id)?.into_iter().filter(|s| s.kind == SnapshotKind::AutoBackup).collect();
        for old in autos.into_iter().skip(AUTO_BACKUPS_KEPT) {
            self.delete_snapshot(&old.id)?;
        }
        Ok(())
    }

    /// Remove a disk from the library. Refused while a machine uses it or an
    /// emulator holds it. Never touches the user's original file.
    pub fn delete_hdf(&self, id: &str) -> Result<()> {
        let hdf = self.get_hdf(id)?;
        let used = self.profiles_using(|p| p.hard_disks.iter().any(|h| h.hdf_id == id))?;
        if !used.is_empty() {
            return Err(Error::Unsafe(format!(
                "this disk is attached to: {}. Detach it there first.",
                used.join(", ")
            )));
        }
        let lock = self.lock_hdf(id)?;
        for s in self.list_snapshots(id)? {
            self.delete_snapshot(&s.id)?;
        }
        self.db().execute("DELETE FROM hdfs WHERE id=?1", [id])?;
        drop(lock);
        let dir = self.hdf_dir(&hdf.id);
        let _ = fsutil::set_readonly(&dir.join("pristine.hdf"), false);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(self.layout.backups().join(id));
        let _ = std::fs::remove_dir_all(self.layout.snapshots().join(id));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_library;
    use super::*;
    use crate::hash::sha256_file;
    use crate::hdf::test_support::synthetic_rdb;

    fn make_src(dir: &Path) -> PathBuf {
        let p = dir.join("work.hdf");
        std::fs::write(&p, synthetic_rdb(4096, true, 0x444F5301)).unwrap();
        p
    }
    fn sha(p: &Path) -> String {
        sha256_file(p, &CancelToken::new(), None).unwrap().0
    }

    #[test]
    fn import_preserves_original_and_makes_working_and_pristine() {
        let (d, lib) = test_library();
        let src = make_src(d.path());
        let before = sha(&src);
        let mtime = std::fs::metadata(&src).unwrap().modified().unwrap();
        let rec = lib.import_hdf(&src, "Work", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        assert_eq!(rec.original_sha256, before);
        assert_eq!(sha(&rec.working_path), before);
        assert_eq!(sha(rec.pristine_path.as_ref().unwrap()), before);
        assert!(std::fs::metadata(rec.pristine_path.as_ref().unwrap()).unwrap().permissions().readonly());
        assert_eq!(sha(&src), before, "original untouched");
        assert_eq!(std::fs::metadata(&src).unwrap().modified().unwrap(), mtime);
        assert_eq!(rec.info.layout, HdfLayout::Rdb);
        assert!(rec.info.bootable_flagged);
    }

    #[test]
    fn import_without_pristine_uses_one_image_of_space() {
        let (d, lib) = test_library();
        let src = make_src(d.path());
        let e1 = lib.estimate_hdf_import(&src, true).unwrap();
        let e2 = lib.estimate_hdf_import(&src, false).unwrap();
        assert_eq!(e1.required_bytes - e2.required_bytes, e1.source_size);
        let rec = lib
            .import_hdf(
                &src,
                "W",
                HdfImportOptions { keep_pristine: false, accept_unrecognised: false },
                &CancelToken::new(),
                None,
            )
            .unwrap();
        assert!(rec.pristine_path.is_none());
    }

    #[test]
    fn unrecognised_images_need_explicit_acceptance_and_failed_imports_leave_nothing() {
        let (d, lib) = test_library();
        let p = d.path().join("junk.hdf");
        let mut junk = vec![0u8; 4096 * 512];
        junk[100] = 7;
        std::fs::write(&p, &junk).unwrap();
        assert!(matches!(
            lib.import_hdf(&p, "J", HdfImportOptions::default(), &CancelToken::new(), None),
            Err(Error::InvalidHdf(_))
        ));
        assert_eq!(std::fs::read_dir(lib.layout.hard_drives()).unwrap().count(), 0);
        let ok = lib
            .import_hdf(
                &p,
                "J",
                HdfImportOptions { keep_pristine: false, accept_unrecognised: true },
                &CancelToken::new(),
                None,
            )
            .unwrap();
        assert_eq!(ok.info.layout, HdfLayout::Unrecognised);
        assert!(!ok.info.warnings.is_empty());
    }

    #[test]
    fn cancelled_import_cleans_up_completely() {
        let (d, lib) = test_library();
        let p = d.path().join("big.hdf");
        std::fs::write(&p, synthetic_rdb(40_000, true, 0x444F5301)).unwrap(); // ~20 MB
        let c = CancelToken::new();
        let c2 = c.clone();
        let mut cb = move |done: u64, _t: u64| {
            if done > 3_000_000 {
                c2.cancel();
            }
        };
        let r = lib.import_hdf(&p, "Big", HdfImportOptions::default(), &c, Some(&mut cb));
        assert!(matches!(r, Err(Error::Cancelled)));
        assert!(lib.list_hdfs().unwrap().is_empty());
        assert_eq!(std::fs::read_dir(lib.layout.hard_drives()).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(lib.layout.partial()).unwrap().count(), 0);
    }

    #[test]
    fn cannot_import_from_inside_the_library() {
        let (d, lib) = test_library();
        let rec =
            lib.import_hdf(&make_src(d.path()), "W", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        assert!(matches!(
            lib.import_hdf(&rec.working_path, "again", HdfImportOptions::default(), &CancelToken::new(), None),
            Err(Error::Unsafe(_))
        ));
    }

    #[test]
    fn concurrent_unsafe_access_is_rejected() {
        let (d, lib) = test_library();
        let rec =
            lib.import_hdf(&make_src(d.path()), "W", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        let guard = lib.begin_hdf_session(&rec.id, false, &CancelToken::new()).unwrap();
        // a second emulator, a backup, a restore, an export and a delete all fail while the session runs
        assert!(matches!(lib.begin_hdf_session(&rec.id, false, &CancelToken::new()), Err(Error::Locked(_))));
        assert!(matches!(
            lib.backup_hdf(&rec.id, SnapshotKind::Backup, "", &CancelToken::new(), None),
            Err(Error::Locked(_))
        ));
        assert!(matches!(
            lib.export_hdf(&rec.id, &d.path().join("o.hdf"), false, &CancelToken::new(), None),
            Err(Error::Locked(_))
        ));
        assert!(matches!(lib.delete_hdf(&rec.id), Err(Error::Locked(_))));
        lib.end_hdf_session(guard, true).unwrap();
        lib.backup_hdf(&rec.id, SnapshotKind::Backup, "after", &CancelToken::new(), None).unwrap();
    }

    #[test]
    fn writes_persist_and_auto_backup_protects_previous_state() {
        let (d, lib) = test_library();
        let src = make_src(d.path());
        let original = sha(&src);
        let rec = lib.import_hdf(&src, "W", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();

        // session 1: pristine exists, so no auto backup is needed yet
        let g = lib.begin_hdf_session(&rec.id, false, &CancelToken::new()).unwrap();
        assert!(g.auto_backup.is_none());
        let mut bytes = std::fs::read(&g.working_path).unwrap();
        bytes[1_000_000] = 0x5A; // the "emulator" writes
        std::fs::write(&g.working_path, &bytes).unwrap();
        lib.end_hdf_session(g, true).unwrap();
        assert!(lib.get_hdf(&rec.id).unwrap().dirty);

        // "restart the application": reopen the library from disk
        let root = lib.layout.root.clone();
        drop(lib);
        let lib = crate::library::Library::open(crate::library::Layout::new(root)).unwrap();
        let after = lib.get_hdf(&rec.id).unwrap();
        assert_eq!(std::fs::read(&after.working_path).unwrap()[1_000_000], 0x5A, "change persisted across restart");
        assert_eq!(sha(&src), original, "source never modified");
        assert_eq!(sha(after.pristine_path.as_ref().unwrap()), original, "pristine never modified");

        // session 2: previous session wrote => auto backup of THAT state is taken first
        let g = lib.begin_hdf_session(&rec.id, false, &CancelToken::new()).unwrap();
        let ab = g.auto_backup.clone().expect("auto backup");
        assert_eq!(std::fs::read(&ab.path).unwrap()[1_000_000], 0x5A);
        lib.end_hdf_session(g, true).unwrap();
    }

    #[test]
    fn read_only_session_changes_nothing_and_takes_no_backup() {
        let (d, lib) = test_library();
        let rec = lib
            .import_hdf(
                &make_src(d.path()),
                "W",
                HdfImportOptions { keep_pristine: false, accept_unrecognised: false },
                &CancelToken::new(),
                None,
            )
            .unwrap();
        let g = lib.begin_hdf_session(&rec.id, true, &CancelToken::new()).unwrap();
        assert!(g.auto_backup.is_none());
        lib.end_hdf_session(g, true).unwrap();
        assert!(!lib.get_hdf(&rec.id).unwrap().dirty);
    }

    #[test]
    fn without_pristine_first_writable_session_makes_a_backup_and_prunes() {
        let (d, lib) = test_library();
        let rec = lib
            .import_hdf(
                &make_src(d.path()),
                "W",
                HdfImportOptions { keep_pristine: false, accept_unrecognised: false },
                &CancelToken::new(),
                None,
            )
            .unwrap();
        for i in 0..4 {
            let g = lib.begin_hdf_session(&rec.id, false, &CancelToken::new()).unwrap();
            assert!(g.auto_backup.is_some(), "session {i}");
            lib.end_hdf_session(g, i % 2 == 0).unwrap();
        }
        let autos =
            lib.list_snapshots(&rec.id).unwrap().into_iter().filter(|s| s.kind == SnapshotKind::AutoBackup).count();
        assert_eq!(autos, AUTO_BACKUPS_KEPT);
        assert!(lib.get_hdf(&rec.id).unwrap().unclean_shutdown, "last session (i=3) was unclean");
    }

    #[test]
    fn backup_snapshot_restore_roundtrip() {
        let (d, lib) = test_library();
        let rec =
            lib.import_hdf(&make_src(d.path()), "W", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        let good = sha(&rec.working_path);
        let snap = lib.backup_hdf(&rec.id, SnapshotKind::Snapshot, "known good", &CancelToken::new(), None).unwrap();
        assert!(snap.path.starts_with(lib.layout.snapshots()));
        // damage the working copy
        let mut b = std::fs::read(&rec.working_path).unwrap();
        b[500_000] ^= 0xFF;
        std::fs::write(&rec.working_path, &b).unwrap();
        assert_ne!(sha(&rec.working_path), good);
        lib.restore_hdf(&rec.id, &snap.id, &CancelToken::new(), None).unwrap();
        assert_eq!(sha(&rec.working_path), good, "restored");
        let pre: Vec<_> =
            lib.list_snapshots(&rec.id).unwrap().into_iter().filter(|s| s.kind == SnapshotKind::PreRestore).collect();
        assert_eq!(pre.len(), 1, "damaged state kept as pre-restore backup");
        assert_ne!(sha(&pre[0].path), good);
        // the journal is clear
        assert_eq!(lib.recover().unwrap().operations_rolled_forward + lib.recover().unwrap().operations_rolled_back, 0);
    }

    #[test]
    fn corrupt_snapshot_is_refused_without_touching_working_copy() {
        let (d, lib) = test_library();
        let rec =
            lib.import_hdf(&make_src(d.path()), "W", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        let snap = lib.backup_hdf(&rec.id, SnapshotKind::Backup, "", &CancelToken::new(), None).unwrap();
        fsutil::set_readonly(&snap.path, false).unwrap();
        let mut b = std::fs::read(&snap.path).unwrap();
        b[12345] ^= 1;
        std::fs::write(&snap.path, b).unwrap();
        let before = sha(&rec.working_path);
        assert!(matches!(lib.restore_hdf(&rec.id, &snap.id, &CancelToken::new(), None), Err(Error::Unsafe(_))));
        assert_eq!(sha(&rec.working_path), before);
    }

    #[test]
    fn restore_rejects_snapshot_of_another_disk() {
        let (d, lib) = test_library();
        let a =
            lib.import_hdf(&make_src(d.path()), "A", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        let b =
            lib.import_hdf(&make_src(d.path()), "B", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        let sb = lib.backup_hdf(&b.id, SnapshotKind::Backup, "", &CancelToken::new(), None).unwrap();
        assert!(matches!(lib.restore_hdf(&a.id, &sb.id, &CancelToken::new(), None), Err(Error::Unsafe(_))));
    }

    #[test]
    fn interrupted_restore_is_recovered_on_next_open() {
        for scenario in ["after_rename_old", "after_both"] {
            let (d, lib) = test_library();
            let rec = lib
                .import_hdf(&make_src(d.path()), "W", HdfImportOptions::default(), &CancelToken::new(), None)
                .unwrap();
            let good = sha(&rec.working_path);
            let snap = lib.backup_hdf(&rec.id, SnapshotKind::Snapshot, "", &CancelToken::new(), None).unwrap();
            // simulate a crash part-way through the swap
            let staged = lib.layout.partial().join("restore-x.hdf");
            std::fs::copy(&snap.path, &staged).unwrap();
            let saved_old = lib.layout.backups().join(&rec.id).join("old.hdf");
            std::fs::create_dir_all(saved_old.parent().unwrap()).unwrap();
            lib.journal_begin(
                "hdf_swap",
                &serde_json::to_value(SwapJournal {
                    hdf_id: rec.id.clone(),
                    working: rec.working_path.clone(),
                    staged: staged.clone(),
                    saved_old: saved_old.clone(),
                })
                .unwrap(),
            )
            .unwrap();
            std::fs::rename(&rec.working_path, &saved_old).unwrap();
            if scenario == "after_both" {
                std::fs::rename(&staged, &rec.working_path).unwrap();
            }
            let root = lib.layout.root.clone();
            drop(lib);
            let lib = crate::library::Library::open(crate::library::Layout::new(root)).unwrap();
            let r = lib.get_hdf(&rec.id).unwrap();
            assert!(!r.working_missing, "{scenario}: a working disk exists again");
            assert_eq!(sha(&r.working_path), good, "{scenario}");
        }
    }

    #[test]
    fn export_writes_complete_valid_image_and_refuses_unsafe_targets() {
        let (d, lib) = test_library();
        let rec =
            lib.import_hdf(&make_src(d.path()), "W", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        let out = d.path().join("out/export.hdf");
        std::fs::create_dir_all(out.parent().unwrap()).unwrap();
        lib.export_hdf(&rec.id, &out, false, &CancelToken::new(), None).unwrap();
        assert_eq!(sha(&out), sha(&rec.working_path));
        assert_eq!(hdf::inspect_file(&out).unwrap().layout, HdfLayout::Rdb);
        assert!(lib.export_hdf(&rec.id, &out, false, &CancelToken::new(), None).is_err());
        assert!(matches!(
            lib.export_hdf(&rec.id, &rec.working_path, true, &CancelToken::new(), None),
            Err(Error::Unsafe(_))
        ));
    }

    #[test]
    fn delete_requires_detach_and_never_deletes_the_original() {
        let (d, lib) = test_library();
        lib.ensure_default_profiles().unwrap();
        let src = make_src(d.path());
        let rec = lib.import_hdf(&src, "W", HdfImportOptions::default(), &CancelToken::new(), None).unwrap();
        let mut p = lib.get_profile("preset-a1200").unwrap();
        p.hard_disks.push(crate::profiles::HdAttachment {
            hdf_id: rec.id.clone(),
            controller: crate::profiles::HdController::MainboardIde,
            read_only: false,
            boot_priority: 0,
        });
        lib.save_profile(&p).unwrap();
        assert!(matches!(lib.delete_hdf(&rec.id), Err(Error::Unsafe(_))));
        p.hard_disks.clear();
        lib.save_profile(&p).unwrap();
        lib.backup_hdf(&rec.id, SnapshotKind::Backup, "", &CancelToken::new(), None).unwrap();
        lib.delete_hdf(&rec.id).unwrap();
        assert!(src.exists(), "user's original is never deleted");
        assert!(!rec.working_path.exists());
        assert!(lib.list_hdfs().unwrap().is_empty());
    }
}
