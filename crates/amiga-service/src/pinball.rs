//! The Pinball ROM library: pinball ROM sets (the `.zip` files PinMAME and MAME use, named after the
//! machine, for example `tz_94h.zip`) imported into a managed folder that MAME is pointed at.
//!
//! * Imports are verified byte copies (staged, fsynced, re-hashed, renamed). The originals are only read.
//! * A set is checked structurally without being unpacked (valid zip, sane entry list, stored CRC-32s).
//! * Whether the set is **the right one** is decided by MAME itself (`-verifyroms`, `-listxml`) when MAME
//!   is installed. Without MAME the set is shown as "not checked": TiLT has no ROM database of its own
//!   and never guesses.
//! * No ROM is ever bundled, generated or downloaded.

use crate::detect::run_capture;
use amiga_core::fsutil::{copy_atomic, unix_now};
use amiga_core::hash::CancelToken;
use amiga_core::library::Library;
use amiga_core::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

const SETTING: &str = "pinball_roms";
const MAX_ZIP_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ENTRIES: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// MAME checked every file against its own database.
    Good,
    /// MAME knows the set but some files are missing or wrong.
    Bad,
    /// MAME does not know a machine with this name.
    UnknownSet,
    /// Not checked (MAME is not set up, or the check could not run).
    NotChecked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verification {
    pub status: Status,
    /// What MAME said, or why no check ran.
    pub detail: String,
    pub checked_at: i64,
    pub mame_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomSet {
    /// The set name MAME uses (file stem, lower case).
    pub name: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub entries: u32,
    pub added_at: i64,
    pub title: Option<String>,
    pub year: Option<String>,
    pub manufacturer: Option<String>,
    pub verification: Verification,
    /// The file is gone from the managed folder.
    #[serde(default)]
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZipSummary {
    pub entries: u32,
    pub uncompressed: u64,
}

pub fn rom_dir(lib: &Library) -> PathBuf {
    lib.layout.root.join("Pinball").join("roms")
}

fn load(lib: &Library) -> BTreeMap<String, RomSet> {
    lib.get_setting(SETTING).ok().flatten().and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default()
}

fn store(lib: &Library, m: &BTreeMap<String, RomSet>) -> Result<()> {
    lib.set_setting(SETTING, &serde_json::to_string(m).map_err(|e| Error::Unsafe(e.to_string()))?)
}

/// MAME set names: lower case letters, digits and underscores.
pub fn valid_set_name(n: &str) -> bool {
    (2..=32).contains(&n.len()) && n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Read the zip's central directory (nothing is decompressed) and sanity-check it.
pub fn inspect_zip(path: &Path) -> Result<ZipSummary> {
    let md = std::fs::metadata(path).map_err(|_| Error::NotFound(format!("file not found: {}", path.display())))?;
    if !md.is_file() {
        return Err(Error::InvalidRom("that is not a file".into()));
    }
    if md.len() > MAX_ZIP_BYTES {
        return Err(Error::InvalidRom("this file is larger than any pinball ROM set (512 MB limit)".into()));
    }
    let f = std::fs::File::open(path)?;
    let mut z = zip::ZipArchive::new(f).map_err(|_| {
        Error::InvalidRom("this is not a valid .zip file (MAME and PinMAME ROM sets are zip files)".into())
    })?;
    if z.is_empty() {
        return Err(Error::InvalidRom("this zip file is empty".into()));
    }
    if z.len() > MAX_ENTRIES {
        return Err(Error::InvalidRom("this zip has too many files to be a ROM set".into()));
    }
    let mut total = 0u64;
    for i in 0..z.len() {
        let e = z.by_index_raw(i).map_err(|_| Error::InvalidRom("the zip's file list is damaged".into()))?;
        if e.encrypted() {
            return Err(Error::InvalidRom("this zip is password protected, which MAME cannot read".into()));
        }
        let n = e.name();
        if n.starts_with('/') || n.starts_with('\\') || n.split(['/', '\\']).any(|p| p == "..") {
            return Err(Error::Unsafe(format!("the zip contains an unsafe file name: {n}")));
        }
        total = total.saturating_add(e.size());
    }
    Ok(ZipSummary { entries: z.len() as u32, uncompressed: total })
}

fn unchecked(why: &str) -> Verification {
    Verification { status: Status::NotChecked, detail: why.into(), checked_at: unix_now(), mame_version: None }
}

/// Import ROM set zips (files, or folders that are scanned one level deep) into the managed folder.
pub fn import(lib: &Library, inputs: &[PathBuf], overwrite: bool) -> Vec<(PathBuf, Result<RomSet>)> {
    let mut files: Vec<PathBuf> = vec![];
    for p in inputs {
        if p.is_dir() {
            if let Ok(rd) = std::fs::read_dir(p) {
                let mut v: Vec<PathBuf> = rd
                    .flatten()
                    .map(|e| e.path())
                    .filter(|f| f.is_file() && f.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip")))
                    .collect();
                v.sort();
                files.extend(v);
            }
        } else {
            files.push(p.clone());
        }
    }
    files.truncate(5000);
    files.into_iter().map(|f| (f.clone(), import_one(lib, &f, overwrite))).collect()
}

fn import_one(lib: &Library, src: &Path, overwrite: bool) -> Result<RomSet> {
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let name = stem.to_ascii_lowercase();
    if !valid_set_name(&name) {
        return Err(Error::InvalidRom(format!(
            "'{stem}' is not a ROM set name. MAME set names are lower case letters, digits and underscores (for example tz_94h), so rename the file to the set's name."
        )));
    }
    if !src.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip")) {
        return Err(Error::InvalidRom("ROM sets are .zip files".into()));
    }
    let summary = inspect_zip(src)?;
    let dir = rom_dir(lib);
    let dst = dir.join(format!("{name}.zip"));
    let mut sets = load(lib);
    if dst.exists() && !overwrite {
        return Err(Error::AlreadyExists(format!("the set '{name}'")));
    }
    // a previous version is kept as a backup next to the staging area until the new one is in place
    let staging = lib.layout.runtime().join("pinball-import");
    let r = copy_atomic(src, &dst, &staging, overwrite, true, &CancelToken::new(), None)?;
    let set = RomSet {
        name: name.clone(),
        path: dst.display().to_string(),
        size: r.size,
        sha256: r.sha256,
        entries: summary.entries,
        added_at: unix_now(),
        title: None,
        year: None,
        manufacturer: None,
        verification: unchecked("Not checked yet. Set up MAME and choose Check to have MAME confirm this set."),
        missing: false,
    };
    sets.insert(name, set.clone());
    store(lib, &sets)?;
    Ok(set)
}

pub fn list(lib: &Library) -> Vec<RomSet> {
    let mut v: Vec<RomSet> = load(lib).into_values().collect();
    for s in &mut v {
        s.missing = !Path::new(&s.path).is_file();
    }
    v
}

pub fn remove(lib: &Library, name: &str) -> Result<()> {
    let mut sets = load(lib);
    let s = sets.remove(name).ok_or_else(|| Error::NotFound(format!("no ROM set named '{name}'")))?;
    // only ever delete inside the managed folder
    let p = PathBuf::from(&s.path);
    if p.starts_with(rom_dir(lib)) && p.is_file() {
        std::fs::remove_file(&p)?;
    }
    store(lib, &sets)
}

/// Decode the five XML entities MAME uses.
fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn tag(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let a = xml.find(&open)? + open.len();
    let b = xml[a..].find(&format!("</{name}>"))? + a;
    Some(unescape(xml[a..b].trim()))
}

/// Pull title/year/manufacturer out of `mame -listxml <name>`. `None` when MAME has no such machine.
pub fn parse_listxml(xml: &str, name: &str) -> Option<(String, Option<String>, Option<String>)> {
    let needle = format!("<machine name=\"{name}\"");
    let start = xml.find(&needle)?;
    let end = xml[start..].find("</machine>").map(|e| start + e).unwrap_or(xml.len());
    let block = &xml[start..end];
    Some((tag(block, "description")?, tag(block, "year"), tag(block, "manufacturer")))
}

/// What `mame -verifyroms` said about a set.
pub fn parse_verify(out: &str, name: &str) -> (Status, String) {
    let line = out.lines().map(str::trim).find(|l| l.contains(name) && l.to_ascii_lowercase().contains("romset"));
    match line {
        Some(l) if l.contains(" is good") => (Status::Good, l.to_string()),
        Some(l) if l.contains(" is best available") => {
            (Status::Good, format!("{l} (MAME accepts it; some optional files are not in the set)"))
        }
        Some(l) if l.contains(" is bad") => (Status::Bad, l.to_string()),
        Some(l) if l.contains("not found") => {
            (Status::Bad, format!("{l} None of the files in this zip match the ROMs MAME expects for this machine, so it is the wrong set or not a real ROM set."))
        }
        Some(l) => (Status::NotChecked, l.to_string()),
        None => {
            let t = out.trim();
            let l = t.lines().next().unwrap_or("MAME gave no answer");
            // MAME 0.264: "No matching systems found for 'x'" (older versions say machines)
            if t.contains("No matching systems") || t.contains("No matching machines") {
                (Status::UnknownSet, "MAME does not know a machine with this name.".into())
            } else {
                (Status::NotChecked, l.to_string())
            }
        }
    }
}

/// Ask MAME to check one set and (if it knows the machine) describe it. Stores the result.
pub fn verify(lib: &Library, name: &str, mame: Option<&Path>) -> Result<RomSet> {
    let mut sets = load(lib);
    let mut set = sets.get(name).cloned().ok_or_else(|| Error::NotFound(format!("no ROM set named '{name}'")))?;
    if !Path::new(&set.path).is_file() {
        return Err(Error::NotFound("the ROM set's file is missing from the library".into()));
    }
    let Some(mame) = mame else {
        set.verification =
            unchecked("MAME is not set up, so this set could not be checked. Open MAME Arcade and choose the program.");
        sets.insert(name.into(), set.clone());
        store(lib, &sets)?;
        return Ok(set);
    };
    let version = crate::detect::mame_version(mame);
    let dir = rom_dir(lib);
    let dir_s = dir.to_string_lossy().into_owned();
    // MAME answers a bad or unknown set with a non-zero exit but still prints the verdict
    let verdict = run_capture(mame, &["-rompath", &dir_s, "-verifyroms", name], Duration::from_secs(120));
    let xml = run_capture(mame, &["-listxml", name], Duration::from_secs(120));
    let (status, detail) = match &verdict {
        Ok(out) => {
            let known = xml.as_ref().is_ok_and(|x| parse_listxml(x, name).is_some());
            if !known {
                (Status::UnknownSet, "MAME does not know a machine with this name. Check the file name.".into())
            } else {
                parse_verify(out, name)
            }
        }
        Err(e) => (Status::NotChecked, format!("MAME could not check the set: {e}")),
    };
    if let Ok(x) = &xml {
        if let Some((t, y, m)) = parse_listxml(x, name) {
            set.title = Some(t);
            set.year = y;
            set.manufacturer = m;
        }
    }
    set.verification = Verification { status, detail, checked_at: unix_now(), mame_version: version };
    sets.insert(name.into(), set.clone());
    store(lib, &sets)?;
    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;
    use amiga_core::library::{Layout, Library};
    use std::io::Write;

    fn lib() -> (tempfile::TempDir, Library) {
        let d = tempfile::tempdir().unwrap();
        let l = Library::open(Layout::new(d.path().join("A"))).unwrap();
        (d, l)
    }

    /// A zip with synthetic (non-ROM) members, enough to exercise the container checks.
    fn make_zip(path: &Path, names: &[&str]) {
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for n in names {
            z.start_file(*n, o).unwrap();
            z.write_all(b"synthetic test data, not a ROM").unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn set_names_follow_mame_rules() {
        for ok in ["tz_94h", "afm_113b", "ab", "t2_l8"] {
            assert!(valid_set_name(ok), "{ok}");
        }
        for bad in ["", "a", "Terminator 2", "tz-94h", "../x", "tz.94h", &"a".repeat(33)] {
            assert!(!valid_set_name(bad), "{bad}");
        }
    }

    #[test]
    fn import_copies_verifies_and_never_touches_the_original() {
        let (d, l) = lib();
        let src = d.path().join("TZ_94H.zip");
        make_zip(&src, &["u6.rom", "u7.rom"]);
        let before = std::fs::read(&src).unwrap();
        let r = import(&l, std::slice::from_ref(&src), false);
        let set = r[0].1.as_ref().unwrap();
        assert_eq!(set.name, "tz_94h");
        assert_eq!(set.entries, 2);
        assert_eq!(set.verification.status, Status::NotChecked, "never claims a set is good without MAME");
        assert_eq!(std::fs::read(&src).unwrap(), before);
        assert_eq!(std::fs::read(&set.path).unwrap(), before);
        assert!(Path::new(&set.path).starts_with(rom_dir(&l)));
        // a second import needs consent
        assert!(matches!(import(&l, std::slice::from_ref(&src), false)[0].1, Err(Error::AlreadyExists(_))));
        assert!(import(&l, &[src], true)[0].1.is_ok());
        assert_eq!(list(&l).len(), 1);
    }

    #[test]
    fn folders_are_scanned_and_bad_files_are_refused_with_a_reason() {
        let (d, l) = lib();
        let dir = d.path().join("roms");
        std::fs::create_dir_all(&dir).unwrap();
        make_zip(&dir.join("afm_113b.zip"), &["a.bin"]);
        make_zip(&dir.join("My Table.zip"), &["a.bin"]);
        std::fs::write(dir.join("fake.zip"), b"not a zip").unwrap();
        make_zip(&dir.join("evil.zip"), &["../escape.bin"]);
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        let r = import(&l, &[dir], false);
        assert_eq!(r.len(), 4, "only .zip files are considered");
        let by = |n: &str| r.iter().find(|(p, _)| p.file_name().unwrap() == n).unwrap().1.as_ref();
        assert!(by("afm_113b.zip").is_ok());
        assert!(matches!(by("My Table.zip"), Err(Error::InvalidRom(m)) if m.contains("rename")));
        assert!(matches!(by("fake.zip"), Err(Error::InvalidRom(_))));
        assert!(matches!(by("evil.zip"), Err(Error::Unsafe(_))));
        assert_eq!(list(&l).len(), 1);
    }

    #[test]
    fn remove_only_deletes_inside_the_managed_folder() {
        let (d, l) = lib();
        let src = d.path().join("tz_94h.zip");
        make_zip(&src, &["a.bin"]);
        let set = import(&l, std::slice::from_ref(&src), false).remove(0).1.unwrap();
        remove(&l, "tz_94h").unwrap();
        assert!(!Path::new(&set.path).exists());
        assert!(src.exists(), "the user's original is untouched");
        assert!(matches!(remove(&l, "tz_94h"), Err(Error::NotFound(_))));
    }

    #[test]
    fn mame_answers_are_parsed() {
        assert_eq!(parse_verify("romset tz_94h is good\n", "tz_94h").0, Status::Good);
        assert_eq!(parse_verify("romset tz_94h [tz_92] is bad\n", "tz_94h").0, Status::Bad);
        assert_eq!(parse_verify("romset tz_94h is best available\n", "tz_94h").0, Status::Good);
        assert_eq!(parse_verify("romset tz_94h not found\n", "tz_94h").0, Status::Bad);
        assert_eq!(parse_verify("No matching systems found for 'zz'\n", "zz").0, Status::UnknownSet);
        assert_eq!(parse_verify("romset \"tz_94h\" not found!\n", "tz_94h").0, Status::Bad);
        let xml = "<mame><machine name=\"tz_94h\" sourcefile=\"x\"><description>Tales &amp; Co (L-1)</description><year>1994</year><manufacturer>Williams</manufacturer></machine></mame>";
        let (t, y, m) = parse_listxml(xml, "tz_94h").unwrap();
        assert_eq!((t.as_str(), y.as_deref(), m.as_deref()), ("Tales & Co (L-1)", Some("1994"), Some("Williams")));
        assert!(parse_listxml(xml, "other").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn verify_uses_the_mame_it_is_given() {
        use std::os::unix::fs::PermissionsExt;
        let (d, l) = lib();
        let src = d.path().join("tz_94h.zip");
        make_zip(&src, &["a.bin"]);
        import(&l, &[src], false);
        // without MAME: honest "not checked"
        let s = verify(&l, "tz_94h", None).unwrap();
        assert_eq!(s.verification.status, Status::NotChecked);
        // a stand-in that behaves like MAME's CLI
        let mame = d.path().join("fakemame");
        std::fs::write(
            &mame,
            "#!/bin/sh\ncase \"$1\" in\n -version) echo '0.999 (mame0999)';;\n -listxml) echo \"<mame><machine name=\\\"$2\\\"><description>Test Machine</description><year>1994</year><manufacturer>Acme</manufacturer></machine></mame>\";;\n -rompath) echo \"romset $4 is good\";;\nesac\n",
        )
        .unwrap();
        std::fs::set_permissions(&mame, std::fs::Permissions::from_mode(0o755)).unwrap();
        let s = verify(&l, "tz_94h", Some(&mame)).unwrap();
        assert_eq!(s.verification.status, Status::Good);
        assert_eq!(s.title.as_deref(), Some("Test Machine"));
        assert_eq!(s.year.as_deref(), Some("1994"));
        assert_eq!(s.verification.mame_version.as_deref(), Some("0.999 (mame0999)"));
        assert_eq!(list(&l)[0].verification.status, Status::Good, "the result is remembered");
    }
}
