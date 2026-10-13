//! Pinball ROM library against the REAL MAME. Gated on MAME_BIN (any MAME 0.2xx). No ROM is involved:
//! the sets are synthetic zips named after real MAME pinball machines, so MAME must say "bad" for them,
//! which proves TiLT does not call a set good on its own.

use amiga_service::{Service, StorageLayout};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn make_zip(path: &Path) {
    let f = std::fs::File::create(path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    z.start_file("u6.rom", zip::write::SimpleFileOptions::default()).unwrap();
    z.write_all(b"synthetic, not a ROM").unwrap();
    z.finish().unwrap();
}

fn job(s: &std::sync::Arc<Service>, r: Value) -> Value {
    let id = r["job"].as_str().unwrap().to_string();
    let end = Instant::now() + Duration::from_secs(180);
    loop {
        let v = s.dispatch("job_get", json!({ "id": id })).unwrap();
        if v["state"] != "running" || Instant::now() > end {
            return v;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn rom_library_with_real_mame() {
    let Some(mame) = std::env::var_os("MAME_BIN").map(PathBuf::from).filter(|p| p.is_file()) else {
        eprintln!("SKIPPED: set MAME_BIN to run");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    std::env::set_var("HOME", tmp.path().join("home"));
    let s = Service::new(StorageLayout::new(tmp.path().join("Studio")), None).unwrap();
    let call = |c: &str, a: Value| s.dispatch(c, a).unwrap_or_else(|e| panic!("{c}: {} ({})", e.message, e.code));

    // set MAME up through the same call the UI makes
    let mut def =
        call("systems_list", json!({})).as_array().unwrap().iter().find(|x| x["id"] == "mame").unwrap().clone();
    def["exe"] = json!(mame.display().to_string());
    call("system_save", json!({ "system": def }));

    let src = tmp.path().join("in");
    std::fs::create_dir_all(&src).unwrap();
    make_zip(&src.join("bttf_a20.zip")); // a real MAME pinball machine name
    make_zip(&src.join("zzzz_nope.zip")); // a name MAME does not know
    let imp = job(&s, call("pinball_rom_import", json!({ "paths": [src.display().to_string()] })));
    assert_eq!(imp["state"], "done", "{imp}");
    assert_eq!(imp["result"].as_array().unwrap().iter().filter(|r| r["ok"].is_object()).count(), 2);

    let ver = job(&s, call("pinball_rom_verify", json!({})));
    assert_eq!(ver["state"], "done", "{ver}");
    let lib = call("pinball_roms", json!({}));
    let get = |n: &str| lib["sets"].as_array().unwrap().iter().find(|x| x["name"] == n).unwrap().clone();
    let bttf = get("bttf_a20");
    eprintln!("bttf_a20: {bttf}");
    assert_eq!(bttf["verification"]["status"], "bad", "a synthetic zip must not pass MAME's check");
    assert!(bttf["title"].as_str().unwrap().contains("Back to the Future"), "title comes from MAME");
    assert!(bttf["verification"]["mame_version"].as_str().unwrap().starts_with("0."));
    let nope = get("zzzz_nope");
    assert_eq!(nope["verification"]["status"], "unknown_set");

    // the MAME system now plays from the library folder
    let sys = call("systems_list", json!({}));
    let m = sys.as_array().unwrap().iter().find(|x| x["id"] == "mame").unwrap();
    assert_eq!(m["game_dir"], lib["folder"]);
    assert_eq!(m["game_count"], 2);

    // detection finds and verifies MAME on this machine
    let dirs = call("system_detect", json!({"id": "mame"}));
    eprintln!("detected: {dirs}");
    call("pinball_rom_remove", json!({"name": "zzzz_nope"}));
    assert_eq!(call("pinball_roms", json!({}))["sets"].as_array().unwrap().len(), 1);
}
