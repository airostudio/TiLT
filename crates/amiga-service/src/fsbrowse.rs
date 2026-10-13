//! Directory listing for the in-app file browser used when the UI runs in a normal browser
//! (the desktop app uses native dialogs instead). It only lists names, kinds and sizes; it never
//! reads file contents. The caller is the local, authenticated user of this computer.

use amiga_core::{Error, Result};
use serde::Serialize;
use std::path::PathBuf;

const MAX_ENTRIES: usize = 4000;

#[derive(Debug, Serialize)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct Listing {
    pub path: String,
    pub parent: Option<String>,
    pub home: Option<String>,
    /// Drive letters on Windows, `/` elsewhere.
    pub roots: Vec<String>,
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).filter(|p| p.is_dir())
}

fn roots() -> Vec<String> {
    #[cfg(windows)]
    {
        ('A'..='Z').map(|c| format!("{c}:\\")).filter(|p| std::path::Path::new(p).exists()).collect()
    }
    #[cfg(not(windows))]
    {
        vec!["/".to_string()]
    }
}

pub fn list(path: Option<&str>) -> Result<Listing> {
    let p = match path {
        Some(p) => PathBuf::from(p),
        None => home().unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "C:\\" } else { "/" })),
    };
    if !p.is_absolute() {
        return Err(Error::Unsafe("use a full path".into()));
    }
    let p = p.canonicalize().map_err(|_| Error::NotFound(format!("folder not found: {}", p.display())))?;
    if !p.is_dir() {
        return Err(Error::NotFound(format!("not a folder: {}", p.display())));
    }
    let rd = std::fs::read_dir(&p).map_err(|e| Error::Unsafe(format!("cannot open that folder: {e}")))?;
    let mut entries = vec![];
    let mut truncated = false;
    for e in rd.flatten() {
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(md) = std::fs::metadata(e.path()) else { continue }; // follows links; broken ones are skipped
        entries.push(Entry { name, is_dir: md.is_dir(), size: if md.is_file() { md.len() } else { 0 } });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let strip = |s: String| s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s);
    Ok(Listing {
        parent: p.parent().map(|x| strip(x.display().to_string())),
        path: strip(p.display().to_string()),
        home: home().map(|h| h.display().to_string()),
        roots: roots(),
        entries,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_folders_first_hides_dotfiles_and_rejects_bad_paths() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir(d.path().join("Zdir")).unwrap();
        std::fs::write(d.path().join("a.rom"), b"123").unwrap();
        std::fs::write(d.path().join(".hidden"), b"x").unwrap();
        let l = list(Some(d.path().to_str().unwrap())).unwrap();
        let names: Vec<_> = l.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Zdir", "a.rom"]);
        assert_eq!(l.entries[1].size, 3);
        assert!(l.parent.is_some());
        assert!(list(Some("relative")).is_err());
        assert!(list(Some(d.path().join("a.rom").to_str().unwrap())).is_err());
        assert!(list(Some(d.path().join("missing").to_str().unwrap())).is_err());
        assert!(list(None).is_ok(), "defaults to the home folder");
    }
}
