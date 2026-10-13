//! Service-level end-to-end test of the **embedded** (libretro) machine mode against the real
//! Amiberry libretro core and the AROS ROM. No standalone Amiberry, no display and no control
//! socket are involved - this is the path that gives Windows run-time control.
//!
//! Gated: LIBRETRO_CORE, AROS_ROM, AROS_EXT (skipped loudly otherwise).

use amiga_service::{Service, StorageLayout};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn env(n: &str) -> Option<PathBuf> {
    std::env::var_os(n).map(PathBuf::from).filter(|p| p.exists())
}

fn until(what: &str, secs: u64, mut f: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < end {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("timed out: {what}");
}

#[test]
fn embedded_machine_lifecycle() {
    let (Some(core), Some(rom), Some(ext)) = (env("LIBRETRO_CORE"), env("AROS_ROM"), env("AROS_EXT")) else {
        eprintln!("SKIPPED: set LIBRETRO_CORE, AROS_ROM and AROS_EXT to run");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let s = Service::new(StorageLayout::new(tmp.path().join("Studio")), None).unwrap();
    let call = |c: &str, a: Value| s.dispatch(c, a).unwrap_or_else(|e| panic!("{c}: {} ({})", e.message, e.code));
    let code = |c: &str, a: Value| s.dispatch(c, a).unwrap_err().code;

    call("embedded_set_core", json!({ "path": core.display().to_string() }));
    let info = call("app_info", json!({}));
    assert_eq!(info["embedded_core"], core.display().to_string());

    let r =
        call("rom_import", json!({ "paths": [rom.display().to_string(), ext.display().to_string()], "copy": true }));
    let rom_id = r[0]["ok"]["record"]["id"].as_str().unwrap().to_string();
    let ext_id = r[1]["ok"]["record"]["id"].as_str().unwrap().to_string();

    let blank = call("media_create_blank", json!({"name": "Work", "fs": "ofs", "density": "double"}));
    let work_id = blank["id"].as_str().unwrap().to_string();
    let hdf_src = tmp.path().join("h.hdf");
    std::fs::write(&hdf_src, vec![0u8; 8 * 1024 * 1024]).unwrap();
    let h = {
        let r = call(
            "hdf_import",
            json!({"path": hdf_src.display().to_string(), "name": "Blank", "keep_pristine": false, "accept_unrecognised": false}),
        );
        let id = r["job"].as_str().unwrap().to_string();
        until("hdf import", 60, || call("job_get", json!({ "id": id }))["state"] != "running");
        call("job_get", json!({ "id": id }))
    };
    assert_eq!(h["state"], "done", "{h}");
    let hdf_id = h["result"]["id"].as_str().unwrap().to_string();

    let mut p = call("profile_get", json!({"id": "preset-a1200"}));
    p["rom_id"] = json!(rom_id);
    p["ext_rom_id"] = json!(ext_id);

    // round 0: machine with an IDE hard disk (states must be refused - the core crashes restoring them);
    // round 1: floppy-only machine (states work). Both rounds also prove stop -> start in one process.
    for round in 0..2 {
        p["hard_disks"] = if round == 0 {
            json!([{"hdf_id": hdf_id, "controller": "mainboard_ide", "read_only": false, "boot_priority": 0}])
        } else {
            json!([])
        };
        call("profile_save", json!({ "profile": p }));
        // ---- start inside the app ----
        call("session_start", json!({"profile_id": "preset-a1200", "mode": "embedded"}));
        let st = call("session_status", json!({}));
        assert_eq!(st["running"], true);
        assert_eq!(st["mode"], "embedded");
        assert_eq!(st["runtime_control"], true);
        assert!(st["pid"].is_null(), "no child process in embedded mode");

        // ---- picture ----
        let mut seq = 0u64;
        until("a frame arrives", 30, || {
            let f = call("session_frame", json!({}));
            seq = f["seq"].as_u64().unwrap();
            f["png_base64"].is_string()
        });
        let f = call("session_frame", json!({}));
        assert!(f["width"].as_u64().unwrap() >= 320 && f["height"].as_u64().unwrap() >= 200);
        let png = base64_decode(f["png_base64"].as_str().unwrap());
        assert_eq!(&png[1..4], b"PNG");
        until("the picture keeps updating", 10, || call("session_frame", json!({ "since": seq }))["unchanged"] != true);
        let shot = call("session_screenshot", json!({}));
        assert!(shot["png_base64"].as_str().unwrap().len() > 100);

        // ---- the hard disk stays locked while the machine runs ----
        if round == 0 {
            assert_eq!(code("hdf_delete", json!({"id": hdf_id})), "locked");
        }
        assert_eq!(code("session_start", json!({"profile_id": "preset-a1200", "mode": "embedded"})), "locked");

        // ---- pause / resume ----
        call("session_control", json!({"action": "pause"}));
        assert_eq!(call("session_status", json!({}))["paused"], true);
        std::thread::sleep(Duration::from_millis(400));
        let a = call("session_frame", json!({}))["seq"].as_u64().unwrap();
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(call("session_frame", json!({}))["seq"].as_u64().unwrap(), a, "frozen while paused");
        call("session_control", json!({"action": "resume"}));
        until("running again", 5, || call("session_frame", json!({ "since": a }))["unchanged"] != true);
        assert_eq!(code("session_control", json!({"action": "volume", "value": 50})), "unsupported");

        // ---- floppy: DF0 only ----
        assert_eq!(code("session_insert", json!({"unit": 1, "media_id": work_id})), "unsupported");
        call("session_insert", json!({"unit": 0, "media_id": work_id}));
        let d = call("session_drives", json!({}));
        assert_eq!(d[0]["media_id"], work_id);
        assert_eq!(d[0]["swappable"], true);
        assert_eq!(d[1]["swappable"], false);
        assert_eq!(d[0]["live_state"], false);
        assert_eq!(code("session_insert", json!({"unit": 0, "media_id": work_id})), "unsafe", "already inserted");
        call("session_eject", json!({"unit": 0}));
        assert!(call("session_drives", json!({}))[0]["media_id"].is_null());
        assert_eq!(code("session_eject", json!({"unit": 2})), "unsupported");
        assert_eq!(code("session_copy_drive", json!({"src_unit": 0, "dst_unit": 1})), "unsupported");

        // ---- saved state ----
        if round == 0 {
            assert_eq!(code("session_save_state", json!({"name": "t1"})), "unsupported");
            assert_eq!(code("session_load_state", json!({"name": "t1"})), "unsupported");
        } else {
            let sv = call("session_save_state", json!({"name": "t1"}));
            assert!(std::fs::metadata(sv["path"].as_str().unwrap()).unwrap().len() > 1_000_000);
            call("session_load_state", json!({"name": "t1"}));
            assert_eq!(code("session_load_state", json!({"name": "nope"})), "not_found");
        }

        // ---- input + perf ----
        call(
            "session_input",
            json!({"events": [
                {"kind":"key","code":97,"down":true},{"kind":"key","code":97,"down":false},
                {"kind":"mouse_move","dx":4,"dy":-2},{"kind":"mouse_button","button":0,"down":true},
                {"kind":"mouse_button","button":0,"down":false},{"kind":"joypad","port":1,"id":8,"down":true}
            ]}),
        );
        assert_eq!(code("session_input", json!({"events": [{"kind":"bogus"}]})), "unsafe");
        let perf = call("session_perf", json!({}));
        assert!(perf["frames"].as_u64().unwrap() > 0);

        // ---- stop: clean, locks released, restartable in the same process ----
        let out = call("session_stop", json!({}));
        assert_eq!(out["outcome"], "clean");
        assert_eq!(call("session_status", json!({}))["running"], false);
        let hdfs = call("hdf_list", json!({}));
        assert_eq!(hdfs[0]["unclean_shutdown"], false, "clean stop => no unclean flag");
        assert_eq!(code("hdf_delete", json!({"id": "does-not-exist"})), "not_found");
        eprintln!("round {round} ok");
    }
}

fn base64_decode(s: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}
