use super::*;
use amiga_core::adf;
use amiga_core::dms::test_support::synthetic as synthetic_dms;
use amiga_core::hdf::test_support::synthetic_rdb;
use amiga_core::rom::test_support::synthetic_rom;
use std::time::{Duration, Instant};

fn svc() -> (tempfile::TempDir, Arc<Service>) {
    let d = tempfile::tempdir().unwrap();
    let s = Service::new(Layout::new(d.path().join("Studio")), None).unwrap();
    (d, s)
}
fn l(p: &Path) -> String {
    p.display().to_string()
}
fn wait_job(s: &Arc<Service>, r: Value) -> Value {
    let id = r["job"].as_str().unwrap().to_string();
    let end = Instant::now() + Duration::from_secs(20);
    loop {
        let v = s.dispatch("job_get", json!({ "id": id })).unwrap();
        if v["state"] != "running" || Instant::now() > end {
            return v;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn unknown_commands_and_bad_args_are_errors_not_panics() {
    let (_d, s) = svc();
    assert_eq!(s.dispatch("rm_rf", json!({})).unwrap_err().code, "not_found");
    assert!(s.dispatch("rom_remove", json!({})).is_err());
    assert!(s.dispatch("profile_save", json!({"profile": 7})).is_err());
    // relative paths are refused for anything that touches the filesystem
    assert!(s.dispatch("hdf_import", json!({"path": "relative.hdf", "name": "x"})).is_err());
    assert!(s.dispatch("media_export", json!({"id": "x", "dest": "out.adf"})).is_err());
}

#[test]
fn rooms_and_systems_are_exposed() {
    let (_d, s) = svc();
    let rooms = s.dispatch("rooms", json!({})).unwrap();
    assert_eq!(rooms.as_array().unwrap().len(), 2);
    let sys = s.dispatch("systems_list", json!({})).unwrap();
    let ids: Vec<&str> = sys.as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap()).collect();
    for want in ["amiga", "ps2", "intellivision", "mame", "tilt-pinball"] {
        assert!(ids.contains(&want), "{want}");
    }
    let amiga = sys.as_array().unwrap().iter().find(|x| x["id"] == "amiga").unwrap();
    assert_eq!(amiga["configured"], true);
    assert!(s.dispatch("system_launch", json!({"id": "ps2"})).is_err(), "unconfigured launcher must refuse");
}

#[test]
fn rom_wizard_flow_through_dispatch() {
    let (d, s) = svc();
    let good = d.path().join("k13.rom");
    std::fs::write(&good, synthetic_rom(0x40000, 34, 5)).unwrap();
    let bad = d.path().join("bad.rom");
    std::fs::write(&bad, [1u8, 2, 3]).unwrap();
    let r = s.dispatch("rom_import", json!({"paths": [l(&good), l(&bad)], "copy": true})).unwrap();
    assert!(r[0]["ok"]["record"]["info"]["family"] == "Kickstart 1.3");
    assert_eq!(r[1]["error"]["code"], "invalid_rom");
    let list = s.dispatch("rom_list", json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    // duplicates are reported
    let again = s.dispatch("rom_import", json!({"paths": [l(&good)]})).unwrap();
    assert_eq!(again[0]["ok"]["duplicate"], true);
}

#[test]
fn media_import_runs_as_a_job_and_dms_is_converted() {
    let (d, s) = svc();
    let a = adf::create_blank("Disk", FsKind::Ffs, false, Density::Double, 1_700_000_000).unwrap();
    let dms = synthetic_dms(&adf::create_blank("Packed", FsKind::Ofs, false, Density::Double, 1_700_000_000).unwrap());
    let (pa, pd, pj) = (d.path().join("a.adf"), d.path().join("p.dms"), d.path().join("junk.adf"));
    std::fs::write(&pa, a).unwrap();
    std::fs::write(&pd, dms).unwrap();
    std::fs::write(&pj, [0u8; 5]).unwrap();
    let r = s.dispatch("media_import", json!({"paths": [l(&pa), l(&pd), l(&pj)]})).unwrap();
    let done = wait_job(&s, r);
    assert_eq!(done["state"], "done", "{done}");
    let res = done["result"].as_array().unwrap();
    assert!(res[0]["ok"].is_object());
    assert!(res[1]["ok"]["dms_record"].is_object(), "DMS archive preserved alongside the ADF");
    assert_eq!(res[2]["error"]["code"], "invalid_disk");
    assert_eq!(s.dispatch("media_list", json!({})).unwrap().as_array().unwrap().len(), 3);
}

#[test]
fn hdf_import_job_then_backup_restore_export() {
    let (d, s) = svc();
    let src = d.path().join("work.hdf");
    std::fs::write(&src, synthetic_rdb(8192, true, 0x444F5301)).unwrap();
    let est = s.dispatch("hdf_estimate", json!({"path": l(&src), "keep_pristine": true})).unwrap();
    assert_eq!(est["enough_space"], true);
    assert_eq!(est["info"]["layout"], "rdb");
    let r = s.dispatch("hdf_import", json!({"path": l(&src), "name": "Work", "keep_pristine": true})).unwrap();
    let done = wait_job(&s, r);
    assert_eq!(done["state"], "done", "{done}");
    let id = done["result"]["id"].as_str().unwrap().to_string();
    let snap = wait_job(&s, s.dispatch("hdf_backup", json!({"id": id, "kind": "snapshot", "note": "good"})).unwrap());
    assert_eq!(snap["state"], "done", "{snap}");
    let restore =
        wait_job(&s, s.dispatch("hdf_restore", json!({"id": id, "snapshot_id": snap["result"]["id"]})).unwrap());
    assert_eq!(restore["state"], "done", "{restore}");
    let out = d.path().join("export.hdf");
    let ex = wait_job(&s, s.dispatch("hdf_export", json!({"id": id, "dest": l(&out)})).unwrap());
    assert_eq!(ex["state"], "done", "{ex}");
    assert_eq!(std::fs::read(&out).unwrap(), std::fs::read(&src).unwrap());
    // the original is untouched and still a valid RDB
    assert_eq!(s.dispatch("hdf_inspect", json!({"path": l(&src)})).unwrap()["layout"], "rdb");
}

#[test]
fn profiles_validate_and_reject_impossible_combinations() {
    let (_d, s) = svc();
    let list = s.dispatch("profile_list", json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 10);
    let mut p = s.dispatch("profile_get", json!({"id": "preset-a1200_040"})).unwrap();
    let v = s.dispatch("profile_validate", json!({"profile": p})).unwrap();
    assert!(v["issues"].as_array().unwrap().iter().all(|i| i["severity"] != "error"));
    p["cpu"]["model"] = json!("68EC040");
    let v = s.dispatch("profile_validate", json!({"profile": p})).unwrap();
    let errors: Vec<_> = v["issues"].as_array().unwrap().iter().filter(|i| i["severity"] == "error").collect();
    assert!(errors.iter().any(|i| i["field"] == "cpu.fpu"), "EC040 cannot have the internal FPU");
    assert!(errors.iter().any(|i| i["field"] == "cpu.mmu"));
    assert_eq!(s.dispatch("profile_save", json!({"profile": p})).unwrap_err().code, "invalid_profile");
}

#[test]
fn session_commands_fail_cleanly_without_a_machine_or_engine() {
    let (_d, s) = svc();
    assert_eq!(s.dispatch("session_status", json!({})).unwrap()["running"], false);
    for cmd in ["session_stop", "session_drives", "session_screenshot", "session_perf"] {
        assert!(s.dispatch(cmd, json!({})).is_err(), "{cmd}");
    }
    assert!(s.dispatch("session_control", json!({"action": "pause"})).is_err());
    // no ROM selected -> friendly error, never a launch attempt
    let e = s.dispatch("session_start", json!({"profile_id": "preset-a500"})).unwrap_err();
    assert!(!e.message.is_empty());
}

#[test]
fn disk_copy_job_via_dispatch() {
    let (d, s) = svc();
    let a = adf::create_blank("Src", FsKind::Ffs, false, Density::Double, 1_700_000_000).unwrap();
    let p = d.path().join("s.adf");
    std::fs::write(&p, &a).unwrap();
    let imp = wait_job(&s, s.dispatch("media_import", json!({"paths": [l(&p)]})).unwrap());
    let id = imp["result"][0]["ok"]["record"]["id"].as_str().unwrap().to_string();
    let r = s
        .dispatch(
            "copy_disk",
            json!({"source": {"type": "library", "media_id": id}, "target": {"type": "new_library_image", "name": "Copy"}, "options": {"verify": true, "overwrite": false, "backup_existing": true}}),
        )
        .unwrap();
    let done = wait_job(&s, r);
    assert_eq!(done["state"], "done", "{done}");
    assert_eq!(done["result"]["verified"], true);
    let ops = s.dispatch("operations_list", json!({})).unwrap();
    assert_eq!(ops[0]["status"], "done");
    // copying onto the pristine original is refused
    let r = s
        .dispatch(
            "copy_disk",
            json!({"source": {"type": "library", "media_id": id}, "target": {"type": "library", "media_id": id}, "options": {"verify": true, "overwrite": true, "backup_existing": true}}),
        )
        .unwrap();
    assert_eq!(wait_job(&s, r)["state"], "failed");
}
