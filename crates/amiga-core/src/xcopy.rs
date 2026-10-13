//! XCOPY-style disk duplication (host side).
//!
//! This module copies **disk image files** byte for byte. It is deliberately
//! separate from "real" Amiga-side copying (an Amiga XCOPY program running in
//! the emulator against emulated drives), which the app exposes as a distinct
//! workflow. Host-side copy preserves every sector of a valid ADF but, like ADF
//! itself, cannot reproduce non-standard tracks or copy protection.
//!
//! Safety rules
//! * the source is only read; a pristine library image is never a destination
//! * source and destination are compared by *file identity* (inode / file id),
//!   not by name, so links and aliases cannot defeat the check
//! * an image that is inserted in a running emulator is refused (`in_use`)
//! * the destination is written to staging, verified by re-hash, then renamed
//!   over the old file; with `backup_existing` the old content is saved first

use crate::adf;
use crate::error::{Error, Result};
use crate::fsutil::{self, unix_now};
use crate::hash::{sha256_file, CancelToken, Progress};
use crate::library::{Library, MediaKind};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CopySource {
    /// An image already in the library (ADF).
    Library { media_id: String },
    /// A file on disk: ADF, or a DMS that is decompressed in memory first.
    File { path: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CopyTarget {
    /// A brand-new writable library image.
    NewLibraryImage { name: String },
    /// An existing writable (non-pristine) library image, overwritten.
    Library { media_id: String },
    /// Export to a file outside the library.
    File { path: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyOptions {
    pub verify: bool,
    /// Allow replacing an existing destination.
    pub overwrite: bool,
    /// Keep a backup of the destination's old content before replacing it.
    pub backup_existing: bool,
}

impl Default for CopyOptions {
    fn default() -> Self {
        CopyOptions { verify: true, overwrite: false, backup_existing: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyReport {
    pub operation_id: String,
    pub bytes: u64,
    pub source_sha256: String,
    pub destination_sha256: String,
    pub verified: bool,
    pub destination: String,
    pub destination_media_id: Option<String>,
    pub backup_path: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationRecord {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub destination: String,
    pub verified: bool,
    pub status: String,
    pub detail: String,
    pub created_at: i64,
}

struct Resolved {
    bytes: Vec<u8>,
    label: String,
    file: Option<PathBuf>,
    media_id: Option<String>,
}

fn resolve_source(lib: &Library, s: &CopySource) -> Result<Resolved> {
    match s {
        CopySource::Library { media_id } => {
            let m = lib.get_media(media_id)?;
            if m.kind != MediaKind::Adf {
                return Err(Error::InvalidDisk("pick a disk image (ADF) as the source".into()));
            }
            if m.missing {
                return Err(Error::NotFound(format!("the file for '{}' is missing from the library", m.name)));
            }
            let bytes = std::fs::read(&m.path)?;
            Ok(Resolved { bytes, label: m.name, file: Some(m.path), media_id: Some(m.id) })
        }
        CopySource::File { path } => {
            let md = std::fs::metadata(path)
                .map_err(|e| Error::InvalidDisk(format!("cannot read {}: {e}", path.display())))?;
            if md.len() > crate::dms::MAX_DMS_INPUT as u64 {
                return Err(Error::InvalidDisk("file is too large for a floppy image".into()));
            }
            let raw = std::fs::read(path)?;
            let bytes = if crate::dms::looks_like_dms(&raw) { crate::dms::to_adf(&raw)? } else { raw };
            adf::inspect(&bytes)?; // must be a standard-size image
            Ok(Resolved {
                bytes,
                label: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                file: Some(path.clone()),
                media_id: None,
            })
        }
    }
}

impl Library {
    /// Host-side duplicate. `in_use` lists image files currently inserted in a running emulator.
    pub fn copy_disk(
        &self,
        src: &CopySource,
        dst: &CopyTarget,
        opts: &CopyOptions,
        in_use: &HashSet<PathBuf>,
        cancel: &CancelToken,
        progress: Option<Progress<'_>>,
    ) -> Result<CopyReport> {
        let op_id = fsutil::random_id();
        let desc_src = format!("{src:?}");
        let desc_dst = format!("{dst:?}");
        let r = self.copy_disk_inner(&op_id, src, dst, opts, in_use, cancel, progress);
        let (status, detail, verified) = match &r {
            Ok(rep) => ("done".to_string(), format!("{} bytes", rep.bytes), rep.verified),
            Err(Error::Cancelled) => ("cancelled".into(), "cancelled by the user".into(), false),
            Err(e) => ("failed".into(), e.to_string(), false),
        };
        let _ = self.db().execute(
            "INSERT INTO operations(id,kind,source,destination,verified,status,detail,created_at) VALUES(?1,'copy',?2,?3,?4,?5,?6,?7)",
            params![op_id, desc_src, desc_dst, verified as i64, status, detail, unix_now()],
        );
        r
    }

    #[allow(clippy::too_many_arguments)]
    fn copy_disk_inner(
        &self,
        op_id: &str,
        src: &CopySource,
        dst: &CopyTarget,
        opts: &CopyOptions,
        in_use: &HashSet<PathBuf>,
        cancel: &CancelToken,
        mut progress: Option<Progress<'_>>,
    ) -> Result<CopyReport> {
        let source = resolve_source(self, src)?;
        let mut notes = vec![];
        let src_sha = crate::hash::sha256_hex_bytes(&source.bytes);

        // ---- resolve destination ----
        let (dest_path, dest_media, create_new): (PathBuf, Option<String>, Option<String>) = match dst {
            CopyTarget::NewLibraryImage { name } => {
                let id = fsutil::random_id();
                (self.layout.floppies().join(format!("{id}.adf")), None, Some(name.clone()))
            }
            CopyTarget::Library { media_id } => {
                let m = self.get_media(media_id)?;
                if m.pristine {
                    return Err(Error::Unsafe(
                        "that disk is an untouched original. Make a working copy and write to that instead.".into(),
                    ));
                }
                if m.kind != MediaKind::Adf {
                    return Err(Error::InvalidDisk("the destination must be a disk image (ADF)".into()));
                }
                if source.media_id.as_deref() == Some(media_id.as_str()) {
                    return Err(Error::Unsafe("the source and destination are the same disk".into()));
                }
                (m.path, Some(media_id.clone()), None)
            }
            CopyTarget::File { path } => {
                if path.starts_with(&self.layout.root) {
                    return Err(Error::Unsafe(
                        "export outside the library folder, or copy into the library instead".into(),
                    ));
                }
                (path.clone(), None, None)
            }
        };
        if let Some(sp) = &source.file {
            if dest_path.exists() && fsutil::same_file(sp, &dest_path) {
                return Err(Error::Unsafe("the source and destination are the same file".into()));
            }
        }
        for p in [source.file.as_ref(), Some(&dest_path)].into_iter().flatten() {
            if in_use.iter().any(|u| fsutil::same_file(u, p) || u == p) {
                return Err(Error::Unsafe(
                    "a disk in the copy is currently inserted in a running Amiga. Eject it first.".into(),
                ));
            }
        }
        let dest_exists = dest_path.exists();
        if dest_exists && !opts.overwrite && create_new.is_none() {
            return Err(Error::AlreadyExists(dest_path.display().to_string()));
        }

        // ---- backup old destination ----
        let mut backup_path = None;
        if dest_exists && opts.backup_existing {
            let dir = self.layout.backups().join("xcopy");
            let b = dir.join(format!("{}-{}.adf", unix_now(), op_id));
            fsutil::copy_atomic(&dest_path, &b, &self.layout.partial(), false, true, cancel, None)?;
            notes.push("The previous contents of the destination were backed up first.".into());
            backup_path = Some(b.display().to_string());
        }

        // ---- write via staging + rename ----
        fsutil::ensure_space(&self.layout.partial(), source.bytes.len() as u64)?;
        let staged = self.layout.partial().join(format!("xcopy-{op_id}.adf"));
        std::fs::write(&staged, &source.bytes)?;
        let write_result = (|| -> Result<(String, u64)> {
            cancel.check()?;
            if let Some(p) = progress.as_mut() {
                p(source.bytes.len() as u64 / 2, source.bytes.len() as u64);
            }
            let f = std::fs::OpenOptions::new().write(true).open(&staged)?;
            f.sync_all()?;
            drop(f);
            let (staged_sha, n) = sha256_file(&staged, cancel, None)?;
            if staged_sha != src_sha {
                return Err(Error::Unsafe("verification failed before commit; nothing was changed".into()));
            }
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            // `rename` replaces atomically; the old destination is never half-written.
            let _ = fsutil::set_readonly(&dest_path, false);
            std::fs::rename(&staged, &dest_path).or_else(|_| {
                // cross-volume export: copy then remove the staging file
                fsutil::copy_atomic(
                    &staged,
                    &dest_path,
                    &dest_path.parent().unwrap().join(".amiga-studio-export"),
                    true,
                    true,
                    cancel,
                    None,
                )
                .map(|_| ())
                .map(|_| {
                    let _ = std::fs::remove_file(&staged);
                    let _ = std::fs::remove_dir(dest_path.parent().unwrap().join(".amiga-studio-export"));
                })
            })?;
            Ok((staged_sha, n))
        })();
        if write_result.is_err() {
            let _ = std::fs::remove_file(&staged);
        }
        let (_sha, n) = write_result?;
        if let Some(p) = progress.as_mut() {
            p(n, n);
        }

        // ---- verify the committed destination ----
        let (dest_sha, _) = sha256_file(&dest_path, cancel, None)?;
        let verified = opts.verify && dest_sha == src_sha;
        if opts.verify && !verified {
            return Err(Error::Unsafe("verification failed: the destination does not match the source".into()));
        }

        // ---- catalogue a new library image ----
        let mut dest_media_id = dest_media;
        if let Some(name) = create_new {
            let info = adf::inspect(&source.bytes)?;
            let id = dest_path.file_stem().unwrap().to_string_lossy().into_owned();
            let mi = crate::library::MediaInfo {
                adf: Some(info.clone()),
                notes: vec![format!("Copy of {}", source.label)],
                dms: None,
            };
            self.db().execute(
                "INSERT INTO media(id,kind,name,sha256,size,path,parent_id,source_dms_id,pristine,imported_at,last_used,info)
                 VALUES(?1,'adf',?2,?3,?4,?5,?6,NULL,0,?7,NULL,?8)",
                params![id, name, dest_sha, n as i64, dest_path.to_string_lossy(), source.media_id, unix_now(), serde_json::to_string(&mi).unwrap()],
            )?;
            dest_media_id = Some(id);
        } else if let Some(id) = &dest_media_id {
            // keep the catalogue hash in step with the new contents
            self.db().execute("UPDATE media SET sha256=?2, size=?3 WHERE id=?1", params![id, dest_sha, n as i64])?;
        }
        Ok(CopyReport {
            operation_id: op_id.to_string(),
            bytes: n,
            source_sha256: src_sha,
            destination_sha256: dest_sha,
            verified,
            destination: dest_path.display().to_string(),
            destination_media_id: dest_media_id,
            backup_path,
            notes,
        })
    }

    pub fn list_operations(&self, limit: u32) -> Result<Vec<OperationRecord>> {
        let db = self.db();
        let mut st = db.prepare("SELECT id,kind,source,destination,verified,status,detail,created_at FROM operations ORDER BY created_at DESC, rowid DESC LIMIT ?1")?;
        let v = st
            .query_map([limit], |r| {
                Ok(OperationRecord {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    source: r.get(2)?,
                    destination: r.get(3)?,
                    verified: r.get::<_, i64>(4)? != 0,
                    status: r.get(5)?,
                    detail: r.get(6)?,
                    created_at: r.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }
}

/// Image files currently inserted in drives of a running session (helper for callers).
pub fn paths_from_drive_state(state: &[(String, String)]) -> HashSet<PathBuf> {
    state
        .iter()
        .filter(|(k, v)| k.ends_with("_disk") && v != "<empty>" && !v.is_empty())
        .map(|(_, v)| PathBuf::from(v))
        .collect()
}

#[allow(dead_code)]
fn _assert_path(_: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adf::{Density, FsKind};
    use crate::library::test_library;

    fn blank(name: &str) -> Vec<u8> {
        adf::create_blank(name, FsKind::Ffs, false, Density::Double, 1_700_000_000).unwrap()
    }
    fn import(lib: &Library, dir: &Path, name: &str, bytes: &[u8]) -> String {
        let p = dir.join(format!("{name}.adf"));
        std::fs::write(&p, bytes).unwrap();
        lib.import_media(&p, &CancelToken::new()).unwrap().record.id
    }
    fn none() -> HashSet<PathBuf> {
        HashSet::new()
    }

    #[test]
    fn adf_to_new_image_is_byte_exact_and_verified() {
        let (d, lib) = test_library();
        let bytes = blank("Src");
        let src = import(&lib, d.path(), "src", &bytes);
        let r = lib
            .copy_disk(
                &CopySource::Library { media_id: src.clone() },
                &CopyTarget::NewLibraryImage { name: "Copy".into() },
                &CopyOptions::default(),
                &none(),
                &CancelToken::new(),
                None,
            )
            .unwrap();
        assert!(r.verified);
        assert_eq!(r.source_sha256, r.destination_sha256);
        let new = lib.get_media(r.destination_media_id.as_ref().unwrap()).unwrap();
        assert_eq!(std::fs::read(&new.path).unwrap(), bytes);
        assert!(!new.pristine);
        assert_eq!(new.parent_id.as_deref(), Some(src.as_str()));
        assert!(lib.verify_media(&src, &CancelToken::new()).unwrap(), "source untouched");
        assert_eq!(lib.list_operations(5).unwrap()[0].status, "done");
    }

    #[test]
    fn nonstandard_raw_sectors_are_preserved() {
        let (d, lib) = test_library();
        let mut weird = vec![0u8; adf::DD_SIZE];
        weird[0..4].copy_from_slice(b"KICK");
        for (i, b) in weird.iter_mut().enumerate().skip(1000) {
            *b = (i * 31 % 251) as u8;
        }
        let src = import(&lib, d.path(), "weird", &weird);
        let r = lib
            .copy_disk(
                &CopySource::Library { media_id: src },
                &CopyTarget::NewLibraryImage { name: "w2".into() },
                &CopyOptions::default(),
                &none(),
                &CancelToken::new(),
                None,
            )
            .unwrap();
        assert_eq!(std::fs::read(&r.destination).unwrap(), weird);
    }

    #[test]
    fn pristine_images_can_never_be_destinations() {
        let (d, lib) = test_library();
        let a = import(&lib, d.path(), "a", &blank("A"));
        let b = import(&lib, d.path(), "b", &blank("B"));
        let before = std::fs::read(lib.get_media(&b).unwrap().path).unwrap();
        let e = lib.copy_disk(
            &CopySource::Library { media_id: a },
            &CopyTarget::Library { media_id: b.clone() },
            &CopyOptions { overwrite: true, ..Default::default() },
            &none(),
            &CancelToken::new(),
            None,
        );
        assert!(matches!(e, Err(Error::Unsafe(_))));
        assert_eq!(std::fs::read(lib.get_media(&b).unwrap().path).unwrap(), before);
        assert_eq!(lib.list_operations(5).unwrap()[0].status, "failed");
    }

    #[test]
    fn same_disk_same_file_and_aliases_are_rejected() {
        let (d, lib) = test_library();
        let a = import(&lib, d.path(), "a", &blank("A"));
        let w = lib.make_working_copy(&a, "W", &CancelToken::new()).unwrap();
        // same media id
        assert!(matches!(
            lib.copy_disk(
                &CopySource::Library { media_id: w.id.clone() },
                &CopyTarget::Library { media_id: w.id.clone() },
                &CopyOptions { overwrite: true, ..Default::default() },
                &none(),
                &CancelToken::new(),
                None
            ),
            Err(Error::Unsafe(_))
        ));
        // different name, same file (hard link outside the library as File source)
        #[cfg(unix)]
        {
            let alias = d.path().join("alias.adf");
            std::fs::hard_link(&w.path, &alias).unwrap();
            let r = lib.copy_disk(
                &CopySource::File { path: alias },
                &CopyTarget::Library { media_id: w.id.clone() },
                &CopyOptions { overwrite: true, ..Default::default() },
                &none(),
                &CancelToken::new(),
                None,
            );
            assert!(matches!(r, Err(Error::Unsafe(_))), "{r:?}");
        }
    }

    #[test]
    fn overwrite_needs_consent_and_backs_up_first() {
        let (d, lib) = test_library();
        let a = import(&lib, d.path(), "a", &blank("A"));
        let w = lib.make_working_copy(&a, "W", &CancelToken::new()).unwrap();
        let src = import(&lib, d.path(), "other", &blank("Other"));
        let old = std::fs::read(&w.path).unwrap();
        let tgt = CopyTarget::Library { media_id: w.id.clone() };
        assert!(matches!(
            lib.copy_disk(
                &CopySource::Library { media_id: src.clone() },
                &tgt,
                &CopyOptions::default(),
                &none(),
                &CancelToken::new(),
                None
            ),
            Err(Error::AlreadyExists(_))
        ));
        assert_eq!(std::fs::read(&w.path).unwrap(), old, "unchanged without consent");
        let r = lib
            .copy_disk(
                &CopySource::Library { media_id: src.clone() },
                &tgt,
                &CopyOptions { overwrite: true, ..Default::default() },
                &none(),
                &CancelToken::new(),
                None,
            )
            .unwrap();
        assert_eq!(std::fs::read(r.backup_path.as_ref().unwrap()).unwrap(), old, "backup holds the previous contents");
        assert_eq!(std::fs::read(&w.path).unwrap(), std::fs::read(lib.get_media(&src).unwrap().path).unwrap());
        assert!(lib.verify_media(&w.id, &CancelToken::new()).unwrap(), "catalogue hash updated");
    }

    #[test]
    fn disks_inserted_in_a_running_emulator_are_refused() {
        let (d, lib) = test_library();
        let a = import(&lib, d.path(), "a", &blank("A"));
        let w = lib.make_working_copy(&a, "W", &CancelToken::new()).unwrap();
        let mut busy = HashSet::new();
        busy.insert(w.path.clone());
        let r = lib.copy_disk(
            &CopySource::Library { media_id: a },
            &CopyTarget::Library { media_id: w.id.clone() },
            &CopyOptions { overwrite: true, ..Default::default() },
            &busy,
            &CancelToken::new(),
            None,
        );
        assert!(matches!(r, Err(Error::Unsafe(m)) if m.contains("inserted")));
    }

    #[test]
    fn dms_to_adf_export_and_source_protection() {
        let (d, lib) = test_library();
        let adf_bytes = blank("D");
        let dms = crate::dms::test_support::synthetic(&adf_bytes);
        let p = d.path().join("d.dms");
        std::fs::write(&p, &dms).unwrap();
        let out = d.path().join("out/d.adf");
        let r = lib
            .copy_disk(
                &CopySource::File { path: p.clone() },
                &CopyTarget::File { path: out.clone() },
                &CopyOptions::default(),
                &none(),
                &CancelToken::new(),
                None,
            )
            .unwrap();
        assert!(r.verified);
        assert_eq!(std::fs::read(&out).unwrap(), adf_bytes);
        assert_eq!(std::fs::read(&p).unwrap(), dms, "DMS preserved");
        // corrupt DMS is rejected and writes nothing
        let mut bad = dms.clone();
        bad[2000] ^= 1;
        let bp = d.path().join("bad.dms");
        std::fs::write(&bp, bad).unwrap();
        let out2 = d.path().join("out/bad.adf");
        assert!(lib
            .copy_disk(
                &CopySource::File { path: bp },
                &CopyTarget::File { path: out2.clone() },
                &CopyOptions::default(),
                &none(),
                &CancelToken::new(),
                None
            )
            .is_err());
        assert!(!out2.exists());
    }

    #[test]
    fn export_into_library_folder_is_blocked_and_cancel_leaves_no_debris() {
        let (d, lib) = test_library();
        let a = import(&lib, d.path(), "a", &blank("A"));
        let r = lib.copy_disk(
            &CopySource::Library { media_id: a.clone() },
            &CopyTarget::File { path: lib.layout.roms().join("x.adf") },
            &CopyOptions::default(),
            &none(),
            &CancelToken::new(),
            None,
        );
        assert!(matches!(r, Err(Error::Unsafe(_))));
        let c = CancelToken::new();
        c.cancel();
        let r = lib.copy_disk(
            &CopySource::Library { media_id: a },
            &CopyTarget::NewLibraryImage { name: "n".into() },
            &CopyOptions::default(),
            &none(),
            &c,
            None,
        );
        assert!(matches!(r, Err(Error::Cancelled)));
        assert_eq!(std::fs::read_dir(lib.layout.partial()).unwrap().count(), 0);
        assert_eq!(lib.list_operations(5).unwrap()[0].status, "cancelled");
    }

    #[test]
    fn drive_state_paths() {
        let s = vec![
            ("DF0_disk".into(), "/a/x.adf".into()),
            ("DF1_disk".into(), "<empty>".into()),
            ("DF0_motor".into(), "1".into()),
        ];
        let p = paths_from_drive_state(&s);
        assert_eq!(p.len(), 1);
        assert!(p.contains(&PathBuf::from("/a/x.adf")));
    }
}
