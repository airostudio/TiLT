//! Service-level end-to-end test against the REAL Amiberry (AROS ROM). Same gating
//! as amiga-core's engine test: AMIBERRY_BIN, AROS_ROM, AROS_EXT, and a DISPLAY.
//! Drives the machine exclusively through `Service::dispatch`, i.e. exactly what
//! the UI can do.

#![cfg(unix)]

use amiga_core::adf::{self, Density, FsKind};
use amiga_service::{Service, StorageLayout};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn env(n: &str) -> Option<PathBuf> {
    std::env::var_os(n).map(PathBuf::from).filter(|p| p.exists())
}

fn wait_job(s: &Arc<Service>, r: Value) -> Value {
    let id = r["job"].as_str().unwrap().to_string();
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        let v = s.dispatch("job_get", json!({ "id": id })).unwrap();
        if v["state"] != "running" || Instant::now() > end {
            return v;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn until(what: &str, mut f: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(20);
    while Instant::now() < end {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    panic!("timed out: {what}");
}

#[test]
fn ui_level_machine_lifecycle() {
    let (Some(bin), Some(rom), Some(ext)) = (env("AMIBERRY_BIN"), env("AROS_ROM"), env("AROS_EXT")) else {
        eprintln!("SKIPPED: set AMIBERRY_BIN, AROS_ROM, AROS_EXT (and DISPLAY) to run");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let runtime = tmp.path().join("xdg");
    std::fs::create_dir_all(&runtime).unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    std::env::set_var("XDG_RUNTIME_DIR", &runtime);
    std::env::set_var("HOME", tmp.path().join("home"));
    std::env::set_var("SDL_AUDIODRIVER", "dummy");
    let s = Service::new(StorageLayout::new(tmp.path().join("Studio")), None).unwrap();
    let call = |c: &str, a: Value| s.dispatch(c, a).unwrap_or_else(|e| panic!("{c}: {} ({})", e.message, e.code));

    // engine + ROMs
    let info = call("engine_set_path", json!({ "path": bin.display().to_string() }));
    assert!(info["banner"].as_str().unwrap().starts_with("Amiberry"));
    let r =
        call("rom_import", json!({ "paths": [rom.display().to_string(), ext.display().to_string()], "copy": true }));
    let rom_id = r[0]["ok"]["record"]["id"].as_str().unwrap().to_string();
    let ext_id = r[1]["ok"]["record"]["id"].as_str().unwrap().to_string();

    // two source disks: a formatted original (pristine) and a blank working disk
    let src_adf = tmp.path().join("orig.adf");
    let mut orig_bytes = adf::create_blank("Original", FsKind::Ffs, false, Density::Double, 1_700_000_000).unwrap();
    orig_bytes[300_000..300_010].copy_from_slice(b"HELLO-AMIG");
    std::fs::write(&src_adf, &orig_bytes).unwrap();
    let imp = wait_job(&s, call("media_import", json!({ "paths": [src_adf.display().to_string()] })));
    let orig_id = imp["result"][0]["ok"]["record"]["id"].as_str().unwrap().to_string();
    let blank = call("media_create_blank", json!({"name": "Target", "fs": "ffs", "density": "double"}));
    let blank_id = blank["id"].as_str().unwrap().to_string();

    // an A1200 profile with the open-source ROM and one HDF
    let hdf_src = tmp.path().join("h.hdf");
    std::fs::write(&hdf_src, vec![0u8; 8 * 1024 * 1024]).unwrap();
    let h = wait_job(
        &s,
        call(
            "hdf_import",
            json!({"path": hdf_src.display().to_string(), "name": "Blank", "keep_pristine": false, "accept_unrecognised": false}),
        ),
    );
    assert_eq!(h["state"], "done", "{h}");
    let hdf_id = h["result"]["id"].as_str().unwrap().to_string();
    let mut p = call("profile_get", json!({"id": "preset-a1200"}));
    p["rom_id"] = json!(rom_id);
    p["ext_rom_id"] = json!(ext_id);
    p["hard_disks"] =
        json!([{"hdf_id": hdf_id, "controller": "mainboard_ide", "read_only": false, "boot_priority": 0}]);
    call("profile_save", json!({ "profile": p }));

    // start: the hard disk is locked, so backup/restore/delete must refuse while it runs
    let st = call("session_start", json!({"profile_id": "preset-a1200"}));
    assert_eq!(st["started"], true);
    let status = call("session_status", json!({}));
    assert_eq!(status["running"], true);
    assert_eq!(status["runtime_control"], true);
    assert!(
        status["warnings"].as_array().unwrap().iter().any(|w| w.as_str().unwrap().contains("safety backup")),
        "no pristine => safety backup"
    );
    assert_eq!(s.dispatch("hdf_backup", json!({"id": hdf_id, "kind": "backup"})).unwrap_err().code, "locked");
    assert_eq!(s.dispatch("hdf_delete", json!({"id": hdf_id})).unwrap_err().code, "locked");
    assert_eq!(
        s.dispatch("session_start", json!({"profile_id": "preset-a1200"})).unwrap_err().code,
        "locked",
        "second machine refused"
    );

    // floppies: insert the original into DF0 (auto write protected), blank into DF1
    call("session_insert", json!({"unit": 0, "media_id": orig_id}));
    call("session_insert", json!({"unit": 1, "media_id": blank_id}));
    until("both drives show their disks", || {
        let d = call("session_drives", json!({}));
        d[0]["media_id"] == json!(orig_id) && d[1]["media_id"] == json!(blank_id)
    });
    let d = call("session_drives", json!({}));
    assert_eq!(d[0]["write_protected"], true, "pristine original is write protected");
    assert_eq!(d[1]["write_protected"], false);
    // the same disk cannot go in two drives
    assert!(s.dispatch("session_insert", json!({"unit": 2, "media_id": orig_id})).is_err());

    // real DF0 -> DF1 duplication through the app (both ejected, copied, re-inserted)
    let job = wait_job(&s, call("session_copy_drive", json!({"src_unit": 0, "dst_unit": 1, "verify": true})));
    assert_eq!(job["state"], "done", "{job}");
    assert_eq!(job["result"]["verified"], true);
    until("disks re-inserted after the copy", || {
        let d = call("session_drives", json!({}));
        d[0]["media_id"] == json!(orig_id) && d[1]["media_id"] == json!(blank_id)
    });
    let blank_path = PathBuf::from(
        call("media_list", json!({})).as_array().unwrap().iter().find(|m| m["id"] == json!(blank_id)).unwrap()["path"]
            .as_str()
            .unwrap(),
    );
    assert_eq!(std::fs::read(&blank_path).unwrap(), d_bytes(&src_adf), "DF1 image is a byte-exact copy of DF0");
    assert!(job["result"]["backup_path"].is_string(), "the old target was backed up before overwrite");

    // runtime controls
    for a in ["pause", "resume", "toggle_mouse_grab", "toggle_mouse_grab"] {
        call("session_control", json!({ "action": a }));
    }
    call("session_control", json!({"action": "volume", "value": 55}));
    let perf = call("session_perf", json!({}));
    assert!(perf["fps"]["fps"].is_string());
    let shot = call("session_screenshot", json!({}));
    assert!(shot["png_base64"].as_str().unwrap().len() > 1000);

    // state save keeps the "memory only" warning attached
    let sv = call("session_save_state", json!({"name": "e2e"}));
    assert!(sv["note"].as_str().unwrap().contains("NOT rolled back"));

    // shut down safely: clean outcome, HDF unlocked and marked clean
    let stop = call("session_stop", json!({}));
    assert_eq!(stop["outcome"], "clean");
    assert_eq!(call("session_status", json!({}))["running"], false);
    let hd = call("hdf_list", json!({}));
    assert_eq!(hd[0]["unclean_shutdown"], false);
    let b = wait_job(&s, call("hdf_backup", json!({"id": hdf_id, "kind": "backup", "note": "after session"})));
    assert_eq!(b["state"], "done", "backup works again once the machine is off: {b}");
    let recent = call("sessions_recent", json!({}));
    assert_eq!(recent[0]["outcome"], "clean");
    // the original source disk is byte-identical to what was imported
    assert_eq!(std::fs::read(&src_adf).unwrap(), orig_bytes);
}

fn d_bytes(p: &std::path::Path) -> Vec<u8> {
    std::fs::read(p).unwrap()
}
