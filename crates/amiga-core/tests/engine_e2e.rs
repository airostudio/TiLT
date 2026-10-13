//! End-to-end test against the REAL Amiberry engine, booting the open-source
//! AROS ROM (no proprietary files). Skipped unless these are set:
//!
//!   AMIBERRY_BIN  path to the amiberry executable (Linux/macOS: control socket available)
//!   AROS_ROM      path to aros-rom.bin   (ships with Amiberry)
//!   AROS_EXT      path to aros-ext.bin   (ships with Amiberry)
//!
//! A display is required (use `xvfb-run` on headless CI). Audio uses SDL's dummy driver.

#![cfg(unix)]

use amiga_core::adf::{self, Density, FsKind};
use amiga_core::emu_config::{build_config, ResolvedMedia};
use amiga_core::engine::{self, LaunchRequest, Session, StopOutcome};
use amiga_core::hash::CancelToken;
use amiga_core::library::{HdfImportOptions, Layout, Library, StorageMode};
use amiga_core::profiles::{self, DriveKind, HdAttachment, HdController};
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn env(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from).filter(|p| p.exists())
}

#[test]
fn boots_aros_a1200_and_controls_it() {
    let (Some(bin), Some(rom), Some(ext)) = (env("AMIBERRY_BIN"), env("AROS_ROM"), env("AROS_EXT")) else {
        eprintln!("SKIPPED: set AMIBERRY_BIN, AROS_ROM and AROS_EXT to run the real-engine test");
        return;
    };
    let keep = std::env::var_os("E2E_KEEP").is_some();
    let tmp = tempfile::Builder::new().disable_cleanup(keep).tempdir().unwrap();
    if keep {
        eprintln!("E2E_KEEP: working directory is {}", tmp.path().display());
    }
    // private runtime dir for the control socket + settings (never the user's real ones)
    let runtime = tmp.path().join("xdg");
    std::fs::create_dir_all(&runtime).unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    std::env::set_var("XDG_RUNTIME_DIR", &runtime);
    std::env::set_var("HOME", tmp.path().join("home"));
    std::env::set_var("SDL_AUDIODRIVER", "dummy");

    // ---- library: import ROMs, a blank HDF and two floppies ----
    let lib = Library::open(Layout::new(tmp.path().join("AmigaStudio"))).unwrap();
    lib.ensure_default_profiles().unwrap();
    let rom_rec = lib.import_rom(&rom, StorageMode::Managed).unwrap().record;
    let ext_rec = lib.import_rom(&ext, StorageMode::Managed).unwrap().record;
    assert!(rom_rec.info.checksum_ok && rom_rec.info.is_aros);

    let hdf_src = tmp.path().join("blank.hdf");
    std::fs::write(&hdf_src, vec![0u8; 8 * 1024 * 1024]).unwrap();
    let hdf = lib
        .import_hdf(
            &hdf_src,
            "Blank",
            HdfImportOptions { keep_pristine: false, accept_unrecognised: false },
            &CancelToken::new(),
            None,
        )
        .unwrap();

    // DF0: an unformatted (all-zero) disk, so the guest has nothing to execute.
    // (A formatted-but-not-installed disk makes AROS run its empty boot block and
    // raise a Software Failure - correct guest behaviour, but not what we test here.)
    let zero = tmp.path().join("blank.adf");
    std::fs::write(&zero, vec![0u8; adf::DD_SIZE]).unwrap();
    let df0 = lib.import_media(&zero, &CancelToken::new()).unwrap().record;
    let df1 = lib.create_blank_adf("Second", FsKind::Ofs, false, Density::Double).unwrap();

    // ---- profile: A1200, AROS ROM, DF0 disk, one HDF ----
    let mut p = lib.get_profile("preset-a1200").unwrap();
    p.rom_id = Some(rom_rec.id.clone());
    p.ext_rom_id = Some(ext_rec.id.clone());
    p.drives[0].media_id = Some(df0.id.clone());
    p.drives[0].kind = DriveKind::Dd35;
    p.hard_disks.push(HdAttachment {
        hdf_id: hdf.id.clone(),
        controller: HdController::MainboardIde,
        read_only: false,
        boot_priority: 0,
    });
    let v = lib.save_profile(&p).unwrap();
    assert!(!v.has_errors(), "{:?}", v.issues);

    let guard = lib.begin_hdf_session(&hdf.id, false, &CancelToken::new()).unwrap();
    let media = ResolvedMedia {
        rom: Some(lib.rom_path(&rom_rec.id).unwrap()),
        ext_rom: Some(lib.rom_path(&ext_rec.id).unwrap()),
        floppies: [Some(df0.path.clone()), None, None, None],
        hard_disks: vec![(p.hard_disks[0].clone(), guard.working_path.clone())],
    };
    let cfg = build_config(&p, &media).unwrap();

    // ---- engine: probe + let the engine itself check the config ----
    let info = engine::probe(&bin).unwrap();
    assert!(info.runtime_control);
    let resolved = engine::dump_config(&info, &cfg, &tmp.path().join("scratch")).unwrap();
    assert!(resolved.corrections.is_empty(), "engine corrected the config: {:?}", resolved.corrections);
    assert_eq!(resolved.get("cpu_model"), Some("68020"));
    assert_eq!(resolved.get("chipset"), Some("aga"));

    // ---- launch the real emulator ----
    let mut s = Session::launch(LaunchRequest {
        engine: &info,
        profile_id: &p.id,
        config_text: &cfg,
        runtime_dir: &lib.layout.runtime(),
        log_dir: &lib.layout.logs(),
        locks: vec![],
        env: std::env::var("DISPLAY").ok().map(|d| vec![("DISPLAY".to_string(), d)]).unwrap_or_default(),
    })
    .expect("emulator launched");
    let c = s.control().expect("control channel").clone();

    // hardware as configured
    let cpu = c.cpu_model().unwrap();
    assert!(cpu.contains(&("model".into(), "68020".into())), "{cpu:?}");
    let mem = c.memory_config().unwrap();
    assert!(mem.contains(&("chip".into(), "2048KB".into())), "{mem:?}");
    let chipset = c.request(&["GET_CHIPSET"]).unwrap().join(" ");
    assert!(chipset.contains("AGA"), "{chipset}");

    // DF0 holds our disk; hot-swap DF1 in and out through the control channel
    let fl = c.list_floppies().unwrap();
    assert!(
        fl.iter().any(|(k, v)| k == "DF0" && v.contains(df0.path.file_name().unwrap().to_str().unwrap())),
        "{fl:?}"
    );
    c.insert_floppy(1, &df1.path).unwrap();
    wait_for(
        || {
            c.list_floppies()
                .unwrap()
                .iter()
                .any(|(k, v)| k == "DF1" && v.contains(df1.path.file_name().unwrap().to_str().unwrap()))
        },
        "DF1 insert",
    );
    c.eject_floppy(1).unwrap();
    wait_for(|| c.list_floppies().unwrap().iter().any(|(k, v)| k == "DF1" && v == "<empty>"), "DF1 eject");

    // the hard disk is mounted
    let hds = c.request(&["LIST_HARDDRIVES"]).unwrap().join(" ");
    assert!(hds.contains("working.hdf"), "{hds}");

    // emulation is actually running at PAL speed
    std::thread::sleep(Duration::from_secs(4));
    let fps = c.fps().unwrap();
    let f: f32 = fps.iter().find(|(k, _)| k == "fps").unwrap().1.parse().unwrap();
    assert!((40.0..=60.0).contains(&f), "fps {f}");

    // pause / resume / volume / screenshot
    c.pause().unwrap();
    c.resume().unwrap();
    c.set_volume(60).unwrap();
    // Poll until the emulated screen shows real graphics (the AROS boot logo),
    // not just a black/blank frame: count distinct colours in the PNG.
    let shot = tmp.path().join("shot.png");
    let end = Instant::now() + Duration::from_secs(45);
    let mut colours = 0;
    while Instant::now() < end {
        let _ = std::fs::remove_file(&shot);
        c.screenshot(&shot).unwrap();
        wait_for(|| shot.exists(), "screenshot");
        std::thread::sleep(Duration::from_millis(300));
        colours = distinct_colours(&shot);
        if colours >= 4 {
            break;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    assert!(colours >= 4, "the emulated screen never showed graphics (only {colours} colours)");
    if let Some(dir) = std::env::var_os("E2E_ARTIFACT_DIR") {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::copy(&shot, PathBuf::from(dir).join("aros-a1200-boot.png"));
    }

    // a second emulator must be refused while this one is alive
    let again = Session::launch(LaunchRequest {
        engine: &info,
        profile_id: &p.id,
        config_text: &cfg,
        runtime_dir: &lib.layout.runtime(),
        log_dir: &lib.layout.logs(),
        locks: vec![],
        env: vec![],
    });
    assert!(again.is_err(), "second instance must be refused");

    // clean shutdown through the control channel, then flush bookkeeping
    let outcome = s.stop(Duration::from_secs(15)).unwrap();
    assert_eq!(outcome, StopOutcome::Clean);
    lib.end_hdf_session(guard, outcome == StopOutcome::Clean).unwrap();
    assert!(!lib.get_hdf(&hdf.id).unwrap().unclean_shutdown);
    drop(s);

    // ADF host-side validation of what the guest saw is covered elsewhere; here
    // just confirm the floppies are still valid disks and the HDF is intact in size.
    for m in [&df0, &df1] {
        adf::inspect(&std::fs::read(&m.path).unwrap()).unwrap();
    }
    assert_eq!(std::fs::metadata(&lib.get_hdf(&hdf.id).unwrap().working_path).unwrap().len(), 8 * 1024 * 1024);
    let _ = profiles::PROFILE_SCHEMA_VERSION;
}

fn wait_for(mut f: impl FnMut() -> bool, what: &str) {
    let end = Instant::now() + Duration::from_secs(15);
    while Instant::now() < end {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("timed out waiting for {what}");
}

fn distinct_colours(path: &std::path::Path) -> usize {
    let dec = png::Decoder::new(std::fs::File::open(path).unwrap());
    let mut reader = match dec.read_info() {
        Ok(r) => r,
        Err(_) => return 0,
    };
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let Ok(info) = reader.next_frame(&mut buf) else { return 0 };
    let bpp = info.color_type.samples() * (info.bit_depth as usize / 8).max(1);
    let mut set = std::collections::HashSet::new();
    for px in buf[..info.buffer_size()].chunks_exact(bpp) {
        set.insert(px.to_vec());
        if set.len() > 64 {
            break;
        }
    }
    set.len()
}
