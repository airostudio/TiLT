//! Translate a validated [`MachineProfile`] into an Amiberry `.uae` configuration.
//!
//! Every key emitted here was checked against Amiberry 8.4.0 by feeding the
//! generated file through `amiberry --dump-config` (see the env-gated
//! integration test `tests/engine.rs` and `docs/amiga-studio/compatibility/`).
//! Units follow Amiberry/UAE conventions: `chipmem_size` is in 512 KiB blocks,
//! `bogomem_size` in 256 KiB blocks, Fast/accelerator RAM in MiB, and
//! `sound_volume` is an *attenuation* (0 = full volume, 100 = silent).

use crate::error::{Error, Result};
use crate::profiles::*;
use crate::rom::Chipset;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Library items resolved to concrete host paths by the caller.
#[derive(Debug, Clone, Default)]
pub struct ResolvedMedia {
    pub rom: Option<PathBuf>,
    pub ext_rom: Option<PathBuf>,
    pub floppies: [Option<PathBuf>; 4],
    /// `(attachment, working copy path)` in unit order.
    pub hard_disks: Vec<(HdAttachment, PathBuf)>,
}

/// A path is only emitted when it cannot break out of its config line or the
/// comma-separated hardfile syntax.
fn safe_path(p: &Path, allow_comma: bool) -> Result<String> {
    let s = p.to_str().ok_or_else(|| Error::Unsafe(format!("path is not valid UTF-8: {}", p.display())))?;
    if s.contains(['\n', '\r', '\0']) {
        return Err(Error::Unsafe("path contains a control character".into()));
    }
    if !allow_comma && s.contains(',') {
        return Err(Error::Unsafe(format!(
            "the path '{s}' contains a comma, which the emulator's hard disk syntax cannot express. \
             Move the Amiga Studio storage folder to a path without commas."
        )));
    }
    Ok(s.to_string())
}

pub fn build_config(p: &MachineProfile, media: &ResolvedMedia) -> Result<String> {
    let mut c = String::with_capacity(2048);
    let mut kv = |k: &str, v: &str| {
        let _ = writeln!(c, "{k}={v}");
    };
    let b = |x: bool| if x { "true" } else { "false" };

    kv("config_description", &format!("Amiga Studio: {}", p.name.replace(['\n', '\r'], " ")));
    kv("use_gui", "no");

    // --- ROMs ---
    if let Some(r) = &media.rom {
        kv("kickstart_rom_file", &safe_path(r, true)?);
    }
    if let Some(r) = &media.ext_rom {
        kv("kickstart_ext_rom_file", &safe_path(r, true)?);
    }

    // --- chipset / model ---
    kv(
        "chipset",
        match p.chipset {
            Chipset::Ocs => "ocs",
            Chipset::Ecs => "ecs",
            Chipset::Aga => "aga",
        },
    );
    kv("chipset_compatible", p.model.compat_name());
    kv("ntsc", b(p.display.standard == VideoStandard::Ntsc));

    // --- CPU ---
    let cpu = &p.cpu;
    kv("cpu_model", &cpu.model.family().to_string());
    let (fpu, mmu) = match cpu.model {
        CpuModel::M68040 => ("68040", if cpu.mmu { "68040" } else { "0" }),
        CpuModel::M68EC040 => ("0", "0"),
        CpuModel::M68030 => (fpu_key(cpu.fpu), if cpu.mmu { "68030" } else { "0" }),
        CpuModel::M68EC030 => (fpu_key(cpu.fpu), "0"),
        _ => (fpu_key(cpu.fpu), "0"),
    };
    kv("fpu_model", fpu);
    kv("mmu_model", mmu);
    kv("cpu_24bit_addressing", b(cpu.model.forced_24bit() || cpu.address_24bit));
    kv("cpu_data_cache", b(cpu.data_cache && cpu.model.has_data_cache()));

    match p.performance {
        PerformanceMode::Compatibility => {
            kv("cpu_speed", if cpu.speed == CpuSpeed::Max { "max" } else { "real" });
            kv("cpu_compatible", "true");
            kv("cpu_memory_cycle_exact", "true");
            kv("blitter_cycle_exact", "true");
            kv("cachesize", "0");
        }
        PerformanceMode::Performance => {
            kv("cpu_speed", "max");
            kv("cpu_compatible", "false");
            kv("cpu_memory_cycle_exact", "false");
            kv("blitter_cycle_exact", "false");
            // JIT needs a 68020+ and is incompatible with an emulated MMU.
            let jit = cpu.model.family() >= 68020 && mmu == "0";
            kv("cachesize", if jit { "8192" } else { "0" });
            kv("compfpu", b(jit));
        }
    }

    // --- memory ---
    let m = &p.memory;
    kv("chipmem_size", &(m.chip_kb / 512).max(1).to_string());
    kv("bogomem_size", &(m.slow_kb / 256).to_string());
    kv("fastmem_size", &m.fast_mb.to_string());
    if m.accel_mb > 0 {
        // A1200-style accelerators use the 25-bit/32-bit "mem25bit" window; the
        // A3000/A4000 use their motherboard RAM; Custom uses the 32-bit bus.
        let key = match p.model {
            AmigaModel::A3000 | AmigaModel::A4000 => "mbresmem_size",
            _ => "mem25bit_size",
        };
        kv(key, &m.accel_mb.to_string());
    }
    if m.z3_mb > 0 {
        kv("z3mem_size", &m.z3_mb.to_string());
    }

    // --- floppies ---
    let enabled = p.drives.iter().filter(|d| d.kind != DriveKind::Disabled).count();
    kv("nr_floppies", &enabled.to_string());
    for (i, d) in p.drives.iter().enumerate() {
        let ty = match d.kind {
            DriveKind::Disabled => "-1",
            DriveKind::Dd35 => "0",
            DriveKind::Hd35 => "1",
        };
        kv(&format!("floppy{i}type"), ty);
        if d.kind != DriveKind::Disabled {
            if let Some(path) = &media.floppies[i] {
                kv(&format!("floppy{i}"), &safe_path(path, true)?);
            }
            kv(&format!("floppy{i}wp"), b(d.write_protect));
        }
    }

    // --- hard disks ---
    for (i, (att, path)) in media.hard_disks.iter().enumerate() {
        let ctrl = match att.controller {
            HdController::MainboardIde => format!("ide{}_mainboard", i.min(1)),
            HdController::Uae => "uae".to_string(),
        };
        let mode = if att.read_only { "ro" } else { "rw" };
        // geometry 0,0,0 lets an RDB define it; block size 512.
        kv("hardfile2", &format!("{mode},DH{i}:{},0,0,0,512,{},,{ctrl}", safe_path(path, false)?, att.boot_priority));
    }

    // --- audio ---
    let a = &p.audio;
    kv("sound_output", "exact");
    kv("sound_channels", "stereo");
    kv("sound_stereo_separation", &a.stereo_separation.to_string());
    kv("sound_frequency", &a.sample_rate.to_string());
    kv("sound_max_buff", &(a.buffer_ms * a.sample_rate / 1000 * 4).to_string());
    kv("sound_volume", &attenuation(if a.muted { 0 } else { a.volume }).to_string());

    // --- display ---
    let d = &p.display;
    kv("gfx_fullscreen_amiga", if d.fullscreen { "fullwindow" } else { "false" });
    kv("gfx_keep_aspect", b(d.keep_aspect));
    kv("gfx_width_windowed", &d.window_width.to_string());
    kv("gfx_height_windowed", &d.window_height.to_string());

    // --- input ---
    kv("joyport0", port_key(p.input.port0, true));
    kv("joyport1", port_key(p.input.port1, false));
    kv("input.mouse_speed", &p.input.mouse_speed.to_string());

    Ok(c)
}

fn fpu_key(f: FpuModel) -> &'static str {
    match f {
        FpuModel::None => "0",
        FpuModel::M68881 => "68881",
        FpuModel::M68882 => "68882",
        FpuModel::Internal => "68040",
    }
}

/// UI volume (0 silent .. 100 loud) -> Amiberry attenuation (100 silent .. 0 loud).
pub fn attenuation(volume: u32) -> u32 {
    100 - volume.min(100)
}

fn port_key(d: PortDevice, first: bool) -> &'static str {
    match d {
        PortDevice::None => "none",
        PortDevice::Mouse => "mouse",
        PortDevice::KeyboardJoystick => {
            if first {
                "kbd2"
            } else {
                "kbd1"
            }
        }
        PortDevice::Gamepad => {
            if first {
                "joy1"
            } else {
                "joy0"
            }
        }
    }
}

/// Parsed result of `amiberry --dump-config`.
#[derive(Debug, Clone, Default)]
pub struct ResolvedConfig {
    pub values: Vec<(String, String)>,
    /// Corrections the engine applied (e.g. "JIT and cycle-exact can't be enabled simultaneously").
    pub corrections: Vec<String>,
}

impl ResolvedConfig {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
}

pub fn parse_dump_config(out: &str) -> ResolvedConfig {
    let mut r = ResolvedConfig::default();
    let mut in_corrections = false;
    for line in out.lines() {
        let l = line.trim_end();
        if let Some(rest) = l.strip_prefix(';') {
            in_corrections = rest.trim_start().starts_with("corrections applied");
            continue;
        }
        if l.is_empty() {
            continue;
        }
        if in_corrections {
            r.corrections.push(l.to_string());
            continue;
        }
        if let Some((k, v)) = l.split_once('=') {
            r.values.push((k.trim().to_string(), v.to_string()));
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::from_preset;

    fn cfg(preset: &str) -> String {
        let p = from_preset(preset, "i".into(), "N".into()).unwrap();
        build_config(&p, &ResolvedMedia::default()).unwrap()
    }
    fn has(c: &str, line: &str) -> bool {
        c.lines().any(|l| l == line)
    }

    #[test]
    fn a500_config() {
        let c = cfg("a500");
        for l in [
            "chipset=ocs",
            "cpu_model=68000",
            "cpu_24bit_addressing=true",
            "chipmem_size=1",
            "bogomem_size=2",
            "fpu_model=0",
            "nr_floppies=2",
            "floppy2type=-1",
            "use_gui=no",
        ] {
            assert!(has(&c, l), "missing {l} in:\n{c}");
        }
    }

    #[test]
    fn a1200_040_config_has_internal_fpu_and_mmu() {
        let c = cfg("a1200_040");
        for l in [
            "chipset=aga",
            "cpu_model=68040",
            "fpu_model=68040",
            "mmu_model=68040",
            "mem25bit_size=32",
            "cpu_24bit_addressing=false",
            "chipmem_size=4",
        ] {
            assert!(has(&c, l), "missing {l}");
        }
    }

    #[test]
    fn ec_variants_emit_no_fpu_or_mmu() {
        let mut p = from_preset("custom", "i".into(), "N".into()).unwrap();
        p.cpu.model = CpuModel::M68EC040;
        p.cpu.address_24bit = false;
        let c = build_config(&p, &ResolvedMedia::default()).unwrap();
        assert!(has(&c, "cpu_model=68040") && has(&c, "fpu_model=0") && has(&c, "mmu_model=0"));
        p.cpu.model = CpuModel::M68EC020;
        p.cpu.address_24bit = true;
        let c = build_config(&p, &ResolvedMedia::default()).unwrap();
        assert!(has(&c, "cpu_model=68020") && has(&c, "cpu_24bit_addressing=true"));
    }

    #[test]
    fn performance_mode_enables_jit_only_when_valid() {
        let mut p = from_preset("a1200_030", "i".into(), "N".into()).unwrap();
        p.performance = PerformanceMode::Performance;
        let with_mmu = build_config(&p, &ResolvedMedia::default()).unwrap();
        assert!(has(&with_mmu, "cachesize=0"), "MMU on => no JIT");
        p.cpu.mmu = false;
        let jit = build_config(&p, &ResolvedMedia::default()).unwrap();
        assert!(has(&jit, "cachesize=8192") && has(&jit, "cpu_memory_cycle_exact=false"));
        let mut q = from_preset("a500", "i".into(), "N".into()).unwrap();
        q.performance = PerformanceMode::Performance;
        assert!(has(&build_config(&q, &ResolvedMedia::default()).unwrap(), "cachesize=0"), "68000 has no JIT");
    }

    #[test]
    fn compatibility_mode_is_cycle_exact_without_jit() {
        let c = cfg("a1200");
        assert!(has(&c, "cpu_memory_cycle_exact=true") && has(&c, "cachesize=0") && has(&c, "cpu_compatible=true"));
    }

    #[test]
    fn volume_is_attenuation() {
        assert_eq!(attenuation(100), 0);
        assert_eq!(attenuation(0), 100);
        assert_eq!(attenuation(80), 20);
        let mut p = from_preset("a500", "i".into(), "N".into()).unwrap();
        p.audio.volume = 70;
        assert!(has(&build_config(&p, &ResolvedMedia::default()).unwrap(), "sound_volume=30"));
        p.audio.muted = true;
        assert!(has(&build_config(&p, &ResolvedMedia::default()).unwrap(), "sound_volume=100"));
    }

    #[test]
    fn floppy_and_hdf_lines() {
        let mut p = from_preset("a1200", "i".into(), "N".into()).unwrap();
        p.drives[0].write_protect = true;
        p.hard_disks.push(HdAttachment {
            hdf_id: "h".into(),
            controller: HdController::MainboardIde,
            read_only: false,
            boot_priority: 0,
        });
        let media = ResolvedMedia {
            rom: Some("/roms/kick.rom".into()),
            floppies: [Some("/f/a.adf".into()), None, None, None],
            hard_disks: vec![(p.hard_disks[0].clone(), "/hd/working.hdf".into())],
            ..Default::default()
        };
        let c = build_config(&p, &media).unwrap();
        assert!(has(&c, "kickstart_rom_file=/roms/kick.rom"));
        assert!(has(&c, "floppy0=/f/a.adf") && has(&c, "floppy0wp=true") && has(&c, "floppy1wp=false"));
        assert!(has(&c, "hardfile2=rw,DH0:/hd/working.hdf,0,0,0,512,0,,ide0_mainboard"), "{c}");
    }

    #[test]
    fn hostile_paths_are_rejected() {
        let p = from_preset("a500", "i".into(), "N".into()).unwrap();
        let bad = ResolvedMedia { rom: Some("/x\nuse_gui=yes".into()), ..Default::default() };
        assert!(build_config(&p, &bad).is_err(), "newline injection");
        let mut q = from_preset("a1200", "i".into(), "N".into()).unwrap();
        q.hard_disks.push(HdAttachment {
            hdf_id: "h".into(),
            controller: HdController::MainboardIde,
            read_only: false,
            boot_priority: 0,
        });
        let m =
            ResolvedMedia { hard_disks: vec![(q.hard_disks[0].clone(), "/a,b/c.hdf".into())], ..Default::default() };
        assert!(build_config(&q, &m).is_err(), "comma breaks hardfile syntax");
    }

    #[test]
    fn name_cannot_inject_keys() {
        let mut p = from_preset("a500", "i".into(), "N".into()).unwrap();
        p.name = "evil\nuse_gui=yes".into();
        let c = build_config(&p, &ResolvedMedia::default()).unwrap();
        assert_eq!(c.lines().filter(|l| l.starts_with("use_gui=")).count(), 1);
    }

    #[test]
    fn parses_dump_config_with_corrections() {
        let out = "; header\nchipset=aga\ncpu_model=68030\n; corrections applied to the resolved configuration:\nJIT and cycle-exact can't be enabled simultaneously.\n";
        let r = parse_dump_config(out);
        assert_eq!(r.get("cpu_model"), Some("68030"));
        assert_eq!(r.corrections, vec!["JIT and cycle-exact can't be enabled simultaneously."]);
    }
}
