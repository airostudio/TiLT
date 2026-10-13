//! The managed local library: SQLite catalogue + files under one storage root.
//!
//! ```text
//! AmigaStudio/
//!   ROMs/ Workbench/ Floppies/ DMS/ HardDrives/<id>/ Profiles/ Snapshots/ Backups/ Logs/
//!   .partial/   staging area for atomic writes (same volume => atomic rename)
//!   runtime/    generated emulator configs, sockets, screenshots
//!   library.db  catalogue (SQLite, WAL)
//! ```
//! Nothing in this module ever opens a user-supplied source file for writing,
//! and every managed write goes through [`crate::fsutil`]'s stage+verify+rename.

mod hdfs;
mod media;
mod roms;
mod workbench;

pub use hdfs::*;
pub use media::*;
pub use roms::*;
pub use workbench::*;

use crate::error::{Error, Result};
use crate::fsutil::{self, unix_now};
use crate::profiles::{self, MachineProfile};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub const DB_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone)]
pub struct Layout {
    pub root: PathBuf,
}

impl Layout {
    pub fn new(root: impl Into<PathBuf>) -> Layout {
        Layout { root: root.into() }
    }
    pub fn roms(&self) -> PathBuf {
        self.root.join("ROMs")
    }
    pub fn workbench(&self) -> PathBuf {
        self.root.join("Workbench")
    }
    pub fn floppies(&self) -> PathBuf {
        self.root.join("Floppies")
    }
    pub fn dms(&self) -> PathBuf {
        self.root.join("DMS")
    }
    pub fn hard_drives(&self) -> PathBuf {
        self.root.join("HardDrives")
    }
    pub fn profiles(&self) -> PathBuf {
        self.root.join("Profiles")
    }
    pub fn snapshots(&self) -> PathBuf {
        self.root.join("Snapshots")
    }
    pub fn backups(&self) -> PathBuf {
        self.root.join("Backups")
    }
    pub fn logs(&self) -> PathBuf {
        self.root.join("Logs")
    }
    pub fn partial(&self) -> PathBuf {
        self.root.join(".partial")
    }
    pub fn runtime(&self) -> PathBuf {
        self.root.join("runtime")
    }
    pub fn db_path(&self) -> PathBuf {
        self.root.join("library.db")
    }

    pub fn ensure(&self) -> Result<()> {
        for d in [
            self.roms(),
            self.workbench(),
            self.floppies(),
            self.dms(),
            self.hard_drives(),
            self.profiles(),
            self.snapshots(),
            self.backups(),
            self.logs(),
            self.partial(),
            self.runtime(),
        ] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }

    /// Per-user config folder (holds only the storage-location pointer), e.g. `~/.config/amiga-studio`.
    pub fn default_config_dir() -> PathBuf {
        #[cfg(windows)]
        {
            if let Some(p) = std::env::var_os("APPDATA") {
                return PathBuf::from(p).join("AmigaStudio");
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(h) = std::env::var_os("HOME") {
                return PathBuf::from(h).join("Library/Application Support/AmigaStudio-config");
            }
        }
        if let Some(x) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(x).join("amiga-studio");
        }
        if let Some(h) = std::env::var_os("HOME") {
            return PathBuf::from(h).join(".config/amiga-studio");
        }
        PathBuf::from(".amiga-studio-config")
    }

    const POINTER_FILE: &'static str = "storage-root.txt";

    /// Where the user-chosen storage location is remembered (outside the library itself,
    /// because the library cannot be opened before its location is known).
    pub fn pointer_path(bootstrap_dir: &Path) -> PathBuf {
        bootstrap_dir.join(Self::POINTER_FILE)
    }

    pub fn read_pointer(bootstrap_dir: &Path) -> Option<PathBuf> {
        let t = std::fs::read_to_string(Self::pointer_path(bootstrap_dir)).ok()?;
        let p = PathBuf::from(t.trim());
        (p.is_absolute() && !t.trim().is_empty()).then_some(p)
    }

    pub fn write_pointer(bootstrap_dir: &Path, root: &Path) -> Result<()> {
        std::fs::create_dir_all(bootstrap_dir)?;
        crate::fsutil::write_atomic(
            &Self::pointer_path(bootstrap_dir),
            bootstrap_dir,
            root.to_string_lossy().as_bytes(),
            true,
        )
    }

    /// The storage root to use at start-up: pointer file, else portable, else OS default.
    pub fn resolve(bootstrap_dir: Option<&Path>, portable_dir: Option<&Path>) -> PathBuf {
        if let Some(p) = bootstrap_dir.and_then(Self::read_pointer) {
            return p;
        }
        Self::default_root(portable_dir)
    }

    /// Default root for this OS (Windows: %LOCALAPPDATA%, macOS: Application
    /// Support, Linux: XDG data dir). `portable_dir` wins when it contains a
    /// `portable.flag` file (portable install).
    pub fn default_root(portable_dir: Option<&Path>) -> PathBuf {
        if let Some(d) = portable_dir {
            if d.join("portable.flag").is_file() {
                return d.join("AmigaStudio");
            }
        }
        #[cfg(windows)]
        {
            if let Some(p) = std::env::var_os("LOCALAPPDATA") {
                return PathBuf::from(p).join("AmigaStudio");
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(h) = std::env::var_os("HOME") {
                return PathBuf::from(h).join("Library/Application Support/AmigaStudio");
            }
        }
        if let Some(x) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(x).join("AmigaStudio");
        }
        if let Some(h) = std::env::var_os("HOME") {
            return PathBuf::from(h).join(".local/share/AmigaStudio");
        }
        PathBuf::from("AmigaStudio")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageReport {
    pub roms: u64,
    pub workbench: u64,
    pub floppies: u64,
    pub dms: u64,
    pub hard_drives: u64,
    pub backups: u64,
    pub snapshots: u64,
    pub logs: u64,
    pub total_managed: u64,
    pub free_host: u64,
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub profile_id: String,
    pub profile_name: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub outcome: Option<String>,
}

pub struct Library {
    pub layout: Layout,
    db: Mutex<Connection>,
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let v: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if v > DB_SCHEMA_VERSION {
        return Err(Error::Unsupported(format!(
            "the library was created by a newer Amiga Studio (schema {v}); update the application"
        )));
    }
    if v < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE roms(
              id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, name TEXT NOT NULL, size INTEGER NOT NULL,
              storage TEXT NOT NULL, path TEXT NOT NULL, imported_at INTEGER NOT NULL, info TEXT NOT NULL);
            CREATE TABLE media(
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
              path TEXT NOT NULL, parent_id TEXT, source_dms_id TEXT, pristine INTEGER NOT NULL,
              imported_at INTEGER NOT NULL, last_used INTEGER, info TEXT NOT NULL);
            CREATE INDEX media_sha ON media(sha256);
            CREATE TABLE hdfs(
              id TEXT PRIMARY KEY, name TEXT NOT NULL, original_path TEXT, original_sha256 TEXT NOT NULL,
              size INTEGER NOT NULL, dirname TEXT NOT NULL, has_pristine INTEGER NOT NULL,
              dirty INTEGER NOT NULL DEFAULT 0, unclean INTEGER NOT NULL DEFAULT 0,
              imported_at INTEGER NOT NULL, info TEXT NOT NULL);
            CREATE TABLE snapshots(
              id TEXT PRIMARY KEY, hdf_id TEXT NOT NULL REFERENCES hdfs(id) ON DELETE CASCADE,
              kind TEXT NOT NULL, note TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL,
              sha256 TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE profiles(
              id TEXT PRIMARY KEY, name TEXT NOT NULL, schema_version INTEGER NOT NULL,
              json TEXT NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE queues(id TEXT PRIMARY KEY, name TEXT NOT NULL, media_ids TEXT NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE workbench_sets(id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE sessions(
              id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, profile_name TEXT NOT NULL,
              started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT);
            CREATE TABLE operations(
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL,
              verified INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE journal(
              id TEXT PRIMARY KEY, op TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            "#,
        )?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    Ok(())
}

impl Library {
    /// Open (creating if needed) the library at `layout`, then run crash recovery.
    pub fn open(layout: Layout) -> Result<Library> {
        layout.ensure()?;
        let conn = Connection::open(layout.db_path())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(&conn)?;
        let lib = Library { layout, db: Mutex::new(conn) };
        lib.recover()?;
        Ok(lib)
    }

    pub(crate) fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|p| p.into_inner())
    }

    // ---------- settings ----------
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self.db().query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional()?)
    }
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.db().execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [key, value],
        )?;
        Ok(())
    }

    // ---------- profiles ----------
    /// Seed the predefined systems once (idempotent; never overwrites edits).
    pub fn ensure_default_profiles(&self) -> Result<()> {
        for pr in profiles::presets() {
            let id = format!("preset-{}", pr.id);
            let exists: bool = self
                .db()
                .query_row("SELECT 1 FROM profiles WHERE id=?1", [&id], |_| Ok(true))
                .optional()?
                .unwrap_or(false);
            if !exists {
                if let Some(p) = profiles::from_preset(pr.id, id, pr.title.to_string()) {
                    self.write_profile(&p)?;
                }
            }
        }
        Ok(())
    }

    fn write_profile(&self, p: &MachineProfile) -> Result<()> {
        let json = serde_json::to_string(p).map_err(|e| Error::InvalidProfile(e.to_string()))?;
        self.db().execute(
            "INSERT INTO profiles(id,name,schema_version,json,updated_at) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, schema_version=excluded.schema_version,
             json=excluded.json, updated_at=excluded.updated_at",
            params![p.id, p.name, p.schema_version, json, unix_now()],
        )?;
        Ok(())
    }

    /// Save after validation. Profiles with *errors* are rejected; warnings are fine.
    pub fn save_profile(&self, p: &MachineProfile) -> Result<profiles::Validation> {
        let rom = match &p.rom_id {
            Some(id) => self.get_rom(id).ok(),
            None => None,
        };
        let v = profiles::validate(p, rom.as_ref().map(|r| &r.info));
        if v.has_errors() {
            let first = v.issues.iter().find(|i| i.severity == profiles::Severity::Error).unwrap();
            return Err(Error::InvalidProfile(first.message.clone()));
        }
        self.write_profile(p)?;
        Ok(v)
    }

    pub fn get_profile(&self, id: &str) -> Result<MachineProfile> {
        let json: String = self
            .db()
            .query_row("SELECT json FROM profiles WHERE id=?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("machine profile {id}")))?;
        serde_json::from_str(&json).map_err(|e| Error::InvalidProfile(format!("stored profile is unreadable: {e}")))
    }

    pub fn list_profiles(&self) -> Result<Vec<MachineProfile>> {
        let rows: Vec<String> = {
            let db = self.db();
            let mut st = db.prepare("SELECT json FROM profiles ORDER BY name COLLATE NOCASE")?;
            let v = st.query_map([], |r| r.get::<_, String>(0))?.collect::<std::result::Result<_, _>>()?;
            v
        };
        Ok(rows.iter().filter_map(|j| serde_json::from_str(j).ok()).collect())
    }

    pub fn delete_profile(&self, id: &str) -> Result<()> {
        self.db().execute("DELETE FROM profiles WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn clone_profile(&self, id: &str, new_name: &str) -> Result<MachineProfile> {
        let mut p = self.get_profile(id)?;
        p.id = fsutil::random_id();
        p.name = new_name.to_string();
        self.write_profile(&p)?;
        Ok(p)
    }

    /// Profiles that reference a ROM / media / HDF id (for safe deletion).
    pub(crate) fn profiles_using(&self, pred: impl Fn(&MachineProfile) -> bool) -> Result<Vec<String>> {
        Ok(self.list_profiles()?.into_iter().filter(|p| pred(p)).map(|p| p.name).collect())
    }

    // ---------- sessions ----------
    pub fn begin_session(&self, p: &MachineProfile) -> Result<String> {
        let id = fsutil::random_id();
        self.db().execute(
            "INSERT INTO sessions(id,profile_id,profile_name,started_at) VALUES(?1,?2,?3,?4)",
            params![id, p.id, p.name, unix_now()],
        )?;
        Ok(id)
    }
    pub fn end_session(&self, id: &str, outcome: &str) -> Result<()> {
        self.db()
            .execute("UPDATE sessions SET ended_at=?2, outcome=?3 WHERE id=?1", params![id, unix_now(), outcome])?;
        Ok(())
    }
    pub fn recent_sessions(&self, limit: u32) -> Result<Vec<SessionRecord>> {
        let db = self.db();
        let mut st = db.prepare(
            "SELECT id,profile_id,profile_name,started_at,ended_at,outcome FROM sessions ORDER BY started_at DESC LIMIT ?1",
        )?;
        let v = st
            .query_map([limit], |r| {
                Ok(SessionRecord {
                    id: r.get(0)?,
                    profile_id: r.get(1)?,
                    profile_name: r.get(2)?,
                    started_at: r.get(3)?,
                    ended_at: r.get(4)?,
                    outcome: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    // ---------- storage ----------
    pub fn storage_report(&self) -> Result<StorageReport> {
        let l = &self.layout;
        let (roms, wb, fl, dms, hd, bk, sn, lg) = (
            fsutil::dir_size(&l.roms()),
            fsutil::dir_size(&l.workbench()),
            fsutil::dir_size(&l.floppies()),
            fsutil::dir_size(&l.dms()),
            fsutil::dir_size(&l.hard_drives()),
            fsutil::dir_size(&l.backups()),
            fsutil::dir_size(&l.snapshots()),
            fsutil::dir_size(&l.logs()),
        );
        Ok(StorageReport {
            roms,
            workbench: wb,
            floppies: fl,
            dms,
            hard_drives: hd,
            backups: bk,
            snapshots: sn,
            logs: lg,
            total_managed: roms + wb + fl + dms + hd + bk + sn + lg,
            free_host: fsutil::available_space(&l.root)?,
            root: l.root.display().to_string(),
        })
    }

    // ---------- crash recovery ----------
    /// Called on every open: discards staging debris and finishes or rolls back
    /// any journalled multi-step operation that was interrupted.
    pub fn recover(&self) -> Result<RecoveryReport> {
        let mut rep = RecoveryReport::default();
        if let Ok(rd) = std::fs::read_dir(self.layout.partial()) {
            for e in rd.flatten() {
                if std::fs::remove_file(e.path()).is_ok() {
                    rep.partial_files_removed += 1;
                }
            }
        }
        let pending: Vec<(String, String, String)> = {
            let db = self.db();
            let mut st = db.prepare("SELECT id,op,data FROM journal")?;
            let v = st
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            v
        };
        for (id, op, data) in pending {
            if op == "hdf_swap" {
                if self.recover_hdf_swap(&data)? {
                    rep.operations_rolled_forward += 1;
                } else {
                    rep.operations_rolled_back += 1;
                }
            }
            self.db().execute("DELETE FROM journal WHERE id=?1", [id])?;
        }
        Ok(rep)
    }

    pub(crate) fn journal_begin(&self, op: &str, data: &serde_json::Value) -> Result<String> {
        let id = fsutil::random_id();
        self.db().execute(
            "INSERT INTO journal(id,op,data,created_at) VALUES(?1,?2,?3,?4)",
            params![id, op, data.to_string(), unix_now()],
        )?;
        Ok(id)
    }
    pub(crate) fn journal_end(&self, id: &str) -> Result<()> {
        self.db().execute("DELETE FROM journal WHERE id=?1", [id])?;
        Ok(())
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct RecoveryReport {
    pub partial_files_removed: u32,
    pub operations_rolled_forward: u32,
    pub operations_rolled_back: u32,
}

#[cfg(test)]
pub(crate) fn test_library() -> (tempfile::TempDir, Library) {
    let d = tempfile::tempdir().unwrap();
    let lib = Library::open(Layout::new(d.path().join("AmigaStudio"))).unwrap();
    (d, lib)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_creates_layout_and_is_reopenable() {
        let (d, lib) = test_library();
        for n in ["ROMs", "Workbench", "Floppies", "DMS", "HardDrives", "Profiles", "Snapshots", "Backups", "Logs"] {
            assert!(lib.layout.root.join(n).is_dir(), "{n}");
        }
        lib.set_setting("engine_path", "/x/amiberry").unwrap();
        drop(lib);
        let lib = Library::open(Layout::new(d.path().join("AmigaStudio"))).unwrap();
        assert_eq!(lib.get_setting("engine_path").unwrap().as_deref(), Some("/x/amiberry"));
    }

    #[test]
    fn default_profiles_are_seeded_once_and_not_overwritten() {
        let (_d, lib) = test_library();
        lib.ensure_default_profiles().unwrap();
        let n = lib.list_profiles().unwrap().len();
        assert_eq!(n, profiles::presets().len());
        let mut p = lib.get_profile("preset-a500").unwrap();
        p.name = "My A500".into();
        lib.save_profile(&p).unwrap();
        lib.ensure_default_profiles().unwrap();
        assert_eq!(lib.get_profile("preset-a500").unwrap().name, "My A500");
        assert_eq!(lib.list_profiles().unwrap().len(), n);
    }

    #[test]
    fn profiles_with_errors_are_rejected_and_clones_are_independent() {
        let (_d, lib) = test_library();
        lib.ensure_default_profiles().unwrap();
        let mut p = lib.get_profile("preset-a500").unwrap();
        p.cpu.fpu = profiles::FpuModel::M68881; // impossible on a 68000
        assert!(matches!(lib.save_profile(&p), Err(Error::InvalidProfile(_))));
        let c = lib.clone_profile("preset-a1200", "A1200 copy").unwrap();
        assert_ne!(c.id, "preset-a1200");
        lib.delete_profile(&c.id).unwrap();
        assert!(lib.get_profile("preset-a1200").is_ok());
    }

    #[test]
    fn newer_schema_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let layout = Layout::new(d.path().join("A"));
        layout.ensure().unwrap();
        let c = Connection::open(layout.db_path()).unwrap();
        c.pragma_update(None, "user_version", 99).unwrap();
        drop(c);
        assert!(matches!(Library::open(layout), Err(Error::Unsupported(_))));
    }

    #[test]
    fn sessions_history() {
        let (_d, lib) = test_library();
        lib.ensure_default_profiles().unwrap();
        let p = lib.get_profile("preset-a500").unwrap();
        let s = lib.begin_session(&p).unwrap();
        lib.end_session(&s, "clean").unwrap();
        let r = lib.recent_sessions(5).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].outcome.as_deref(), Some("clean"));
    }

    #[test]
    fn pointer_file_selects_the_root() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(Layout::read_pointer(d.path()), None);
        let chosen = d.path().join("elsewhere");
        Layout::write_pointer(d.path(), &chosen).unwrap();
        assert_eq!(Layout::read_pointer(d.path()), Some(chosen.clone()));
        assert_eq!(Layout::resolve(Some(d.path()), None), chosen);
        std::fs::write(Layout::pointer_path(d.path()), "relative/path").unwrap();
        assert_eq!(Layout::read_pointer(d.path()), None, "relative pointers are ignored");
    }

    #[test]
    fn portable_root_requires_flag() {
        let d = tempfile::tempdir().unwrap();
        assert_ne!(Layout::default_root(Some(d.path())), d.path().join("AmigaStudio"));
        std::fs::write(d.path().join("portable.flag"), "").unwrap();
        assert_eq!(Layout::default_root(Some(d.path())), d.path().join("AmigaStudio"));
    }
}
