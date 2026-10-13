//! End-to-end test of the libretro host against the **real** Amiberry libretro core.
//!
//! Env-gated (skipped, loudly, when unset) because it needs third-party binaries:
//!   LIBRETRO_CORE=/path/to/amiberry_libretro.so|.dll   (checksum-verified release asset)
//!   AROS_ROM=/path/to/aros-rom.bin  AROS_EXT=/path/to/aros-ext.bin   (freely redistributable AROS)
//!
//! One test function on purpose: the host supports a single core per process.

use amiga_core::emu_config::{build_config, ResolvedMedia};
use amiga_core::profiles::from_preset;
use amiga_retro::{RetroConfig, RetroHandle};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn env(k: &str) -> Option<PathBuf> {
    std::env::var_os(k).map(PathBuf::from)
}

fn wait_for(what: &str, secs: u64, mut f: impl FnMut() -> bool) {
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(secs) {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out after {secs}s waiting for: {what}");
}

fn distinct_colours(rgba: &[u8]) -> usize {
    rgba.chunks_exact(4).map(|p| [p[0], p[1], p[2]]).collect::<HashSet<_>>().len()
}

#[test]
fn drives_the_real_core() {
    let (Some(core), Some(rom), Some(ext)) = (env("LIBRETRO_CORE"), env("AROS_ROM"), env("AROS_EXT")) else {
        eprintln!("SKIPPED: set LIBRETRO_CORE, AROS_ROM and AROS_EXT to run this test");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let system = tmp.path().join("system");
    let saves = tmp.path().join("saves");
    std::fs::create_dir_all(&system).unwrap();
    std::fs::create_dir_all(&saves).unwrap();

    // Unformatted DF0 (an all-zero disk gives the guest nothing to run).
    let blank = tmp.path().join("blank.adf");
    std::fs::write(&blank, vec![0u8; 901_120]).unwrap();
    let second = tmp.path().join("second.adf");
    std::fs::write(&second, vec![0u8; 901_120]).unwrap();

    let mut profile = from_preset("a1200", "t".into(), "T".into()).unwrap();
    // RETRO_WITH_HDF=1 attaches an IDE hard disk (used to reproduce the core's state-restore crash).
    let with_hdf = std::env::var_os("RETRO_WITH_HDF").is_some();
    let mut hard_disks = vec![];
    if with_hdf {
        let hdf = tmp.path().join("h.hdf");
        std::fs::write(&hdf, vec![0u8; 8 * 1024 * 1024]).unwrap();
        let att = amiga_core::profiles::HdAttachment {
            hdf_id: "x".into(),
            controller: amiga_core::profiles::HdController::MainboardIde,
            read_only: false,
            boot_priority: 0,
        };
        profile.hard_disks.push(att.clone());
        hard_disks.push((att, hdf));
    }
    let media = ResolvedMedia {
        rom: Some(rom),
        ext_rom: Some(ext),
        floppies: [Some(blank.clone()), None, None, None],
        hard_disks,
    };
    let uae = tmp.path().join("a1200.uae");
    std::fs::write(&uae, build_config(&profile, &media).unwrap()).unwrap();

    let h =
        RetroHandle::start(RetroConfig { core, system_dir: system, save_dir: saves, content: uae, options: vec![] })
            .expect("core starts");

    // ---- video + input ----
    // AROS's picture changes a few seconds after boot (it goes dark when there is nothing to boot),
    // so everything that needs the boot picture happens in this first window, pointer test first.
    wait_for("first frame", 20, || h.frame_seq() > 0);
    let centroid = |f: &amiga_retro::Frame| -> Option<(f64, f64)> {
        let (mut n, mut sx, mut sy) = (0f64, 0f64, 0f64);
        for (i, p) in f.rgba.chunks_exact(4).enumerate() {
            if p[0] > 150 && p[1] < 60 && p[2] < 60 {
                n += 1.0;
                sx += (i as u32 % f.width) as f64;
                sy += (i as u32 / f.width) as f64;
            }
        }
        (n >= 10.0).then(|| (sx / n, sy / n))
    };
    let mut boot = None;
    wait_for("the guest pointer to appear", 30, || match h.frame() {
        Some(f) => match centroid(&f) {
            Some(p) => {
                boot = Some((f, p));
                true
            }
            None => false,
        },
        None => false,
    });
    let (boot_frame, p0) = boot.unwrap();
    for _ in 0..10 {
        h.mouse_move(8, 6);
        std::thread::sleep(Duration::from_millis(40));
    }
    wait_for("the pointer moved right/down", 10, || {
        h.frame()
            .and_then(|f| centroid(&f))
            .is_some_and(|p| p.0 > p0.0 + 40.0 && p.1 > p0.1 + 30.0 && p.0 < p0.0 + 400.0)
    });
    let after = h.frame().unwrap();
    let p1 = centroid(&after).unwrap();
    eprintln!("pointer moved from {p0:?} to {p1:?} after 10 x (8,6) host units");
    if let Some(dir) = env("RETRO_SHOT_DIR") {
        std::fs::write(dir.join("retro-after-mouse.png"), h.screenshot_png().unwrap()).unwrap();
    }
    eprintln!(
        "frame {}x{} seq={} colours={}",
        boot_frame.width,
        boot_frame.height,
        boot_frame.seq,
        distinct_colours(&boot_frame.rgba)
    );
    assert!(boot_frame.width >= 320 && boot_frame.height >= 200);
    assert!(distinct_colours(&boot_frame.rgba) >= 4, "the boot picture has several colours");
    let png = h.screenshot_png().expect("screenshot");
    assert_eq!(&png[1..4], b"PNG");

    // ---- audio ----
    wait_for("audio samples", 10, || h.stats().audio_frames > 0);
    let st = h.stats();
    eprintln!("stats {st:?}");
    assert!(st.sample_rate > 8000.0);
    assert!(!h.take_audio(4096).is_empty());

    // ---- pause / resume ----
    h.pause();
    std::thread::sleep(Duration::from_millis(300));
    let s1 = h.frame_seq();
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(h.frame_seq(), s1, "no new frames while paused");
    assert!(h.is_paused());
    h.resume();
    wait_for("frames after resume", 5, || h.frame_seq() > s1 + 2);

    // ---- save state / load state round trip ----
    let state = h.save_state().expect("save state");
    eprintln!("state bytes: {}", state.len());
    assert!(state.len() > 1_000_000, "an A1200 state includes at least 2 MB chip RAM");
    if std::env::var_os("RETRO_SKIP_LOAD").is_none() {
        h.load_state(state.clone()).expect("load state");
    }
    wait_for("frames after load", 5, || h.stats().frames_run > 0);

    // ---- floppy swap (DF0 only) ----
    h.eject_df0().expect("eject");
    h.insert_df0(&second).expect("insert");
    std::thread::sleep(Duration::from_millis(500));
    let msgs = h.messages();
    eprintln!("core messages: {msgs:?}");

    // ---- more input must be accepted without disturbing the core ----
    h.key(0x61, true);
    h.key(0x61, false);
    h.mouse_button(0, true);
    h.mouse_button(0, false);
    h.joypad(1, amiga_retro::joypad::FIRE1 as usize, true);
    h.joypad(1, amiga_retro::joypad::FIRE1 as usize, false);

    // ---- reset keeps the core alive and drawing ----
    let before = h.frame_seq();
    h.reset().expect("reset");
    wait_for("frames after reset", 20, || h.frame_seq() > before + 10);

    h.stop();

    // ---- the same process can run a second machine afterwards ----
    let h2 = RetroHandle::start(RetroConfig {
        core: env("LIBRETRO_CORE").unwrap(),
        system_dir: tmp.path().join("system"),
        save_dir: tmp.path().join("saves"),
        content: tmp.path().join("a1200.uae"),
        options: vec![],
    })
    .expect("core restarts in the same process");
    wait_for("second run: the guest pointer appears again", 30, || h2.frame().and_then(|f| centroid(&f)).is_some());
    h2.stop();
}
