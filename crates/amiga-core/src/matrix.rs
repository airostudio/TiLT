//! Engine capability matrix: feed generated configurations to the *real*
//! emulator (`--dump-config`) and record what it accepted, normalised or
//! corrected. This is how "supported CPU/chipset" claims are verified instead of
//! asserted. Output is rendered to docs/amiga-studio/compatibility/.

use crate::emu_config::{build_config, ResolvedConfig, ResolvedMedia};
use crate::engine::{dump_config, EngineInfo};
use crate::error::Result;
use crate::profiles::*;
use crate::rom::Chipset;
use serde::Serialize;
use std::path::Path;

/// Keys whose value we emit and expect the engine to echo unchanged.
const CHECKED_KEYS: &[&str] = &[
    "chipset",
    "cpu_model",
    "fpu_model",
    "mmu_model",
    "cpu_24bit_addressing",
    "cpu_data_cache",
    "chipmem_size",
    "bogomem_size",
    "fastmem_size",
    "mem25bit_size",
    "mbresmem_size",
    "z3mem_size",
    "nr_floppies",
    "cachesize",
    "cpu_compatible",
    "cpu_memory_cycle_exact",
    "ntsc",
    "sound_volume",
];

#[derive(Debug, Clone, Serialize)]
pub struct MatrixRow {
    pub name: String,
    /// Emitted keys the engine reported with a different value.
    pub mismatches: Vec<String>,
    /// Corrections the engine said it applied.
    pub corrections: Vec<String>,
    pub accepted: bool,
}

fn kv_map(text: &str) -> Vec<(String, String)> {
    text.lines().filter_map(|l| l.split_once('=')).map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

pub fn check(engine: &EngineInfo, name: &str, p: &MachineProfile, scratch: &Path) -> Result<MatrixRow> {
    let text = build_config(p, &ResolvedMedia::default())?;
    let resolved: ResolvedConfig = dump_config(engine, &text, scratch)?;
    let mut mismatches = vec![];
    for (k, v) in kv_map(&text) {
        if !CHECKED_KEYS.contains(&k.as_str()) {
            continue;
        }
        match resolved.get(&k) {
            Some(got) if got == v => {}
            Some(got) => mismatches.push(format!("{k}: sent {v}, engine resolved {got}")),
            // The engine omits keys that sit at their disabled default.
            None if v == "0" => {}
            None => mismatches.push(format!("{k}: sent {v}, engine reported nothing")),
        }
    }
    Ok(MatrixRow {
        name: name.to_string(),
        accepted: mismatches.is_empty() && resolved.corrections.is_empty(),
        mismatches,
        corrections: resolved.corrections,
    })
}

/// Every CPU model x compatibility/performance mode, plus every preset.
pub fn run(engine: &EngineInfo, scratch: &Path) -> Result<Vec<MatrixRow>> {
    let mut rows = vec![];
    for cpu in CpuModel::ALL {
        for perf in [PerformanceMode::Compatibility, PerformanceMode::Performance] {
            let mut p = from_preset("custom", "m".into(), "matrix".into()).unwrap();
            p.cpu.model = cpu;
            p.cpu.address_24bit = cpu.forced_24bit();
            p.cpu.fpu = match cpu {
                CpuModel::M68040 => FpuModel::Internal,
                CpuModel::M68020 | CpuModel::M68030 => FpuModel::M68882,
                _ => FpuModel::None,
            };
            p.cpu.mmu = matches!(cpu, CpuModel::M68030 | CpuModel::M68040);
            p.performance = perf;
            if cpu.is_32bit_capable() && !cpu.forced_24bit() {
                p.memory.accel_mb = 16;
            }
            rows.push(check(engine, &format!("CPU {} / {:?}", cpu.name(), perf), &p, scratch)?);
        }
    }
    // JIT is only requested when there is no MMU: exercise exactly that path.
    for cpu in [CpuModel::M68020, CpuModel::M68030, CpuModel::M68040] {
        let mut p = from_preset("custom", "m".into(), "matrix".into()).unwrap();
        p.cpu.model = cpu;
        p.cpu.address_24bit = false;
        p.cpu.fpu = if cpu == CpuModel::M68040 { FpuModel::Internal } else { FpuModel::M68882 };
        p.cpu.mmu = false;
        p.memory.accel_mb = 16;
        p.performance = PerformanceMode::Performance;
        rows.push(check(engine, &format!("CPU {} / JIT (no MMU)", cpu.name()), &p, scratch)?);
    }
    for chipset in [Chipset::Ocs, Chipset::Ecs, Chipset::Aga] {
        let mut p = from_preset("custom", "m".into(), "matrix".into()).unwrap();
        p.chipset = chipset;
        p.memory.chip_kb = if chipset == Chipset::Ocs { 512 } else { 2048 };
        rows.push(check(engine, &format!("Chipset {chipset:?}"), &p, scratch)?);
    }
    for ntsc in [false, true] {
        let mut p = from_preset("a500", "m".into(), "matrix".into()).unwrap();
        p.display.standard = if ntsc { VideoStandard::Ntsc } else { VideoStandard::Pal };
        rows.push(check(engine, if ntsc { "Video NTSC" } else { "Video PAL" }, &p, scratch)?);
    }
    for pr in presets() {
        let p = from_preset(pr.id, "m".into(), pr.title.into()).unwrap();
        rows.push(check(engine, &format!("Preset {}", pr.title), &p, scratch)?);
        let mut perf = p.clone();
        perf.performance = PerformanceMode::Performance;
        rows.push(check(engine, &format!("Preset {} (performance)", pr.title), &perf, scratch)?);
    }
    Ok(rows)
}

pub fn render_markdown(engine: &EngineInfo, rows: &[MatrixRow]) -> String {
    let mut s = String::new();
    s.push_str("# Engine capability matrix (generated)\n\n");
    s.push_str(&format!(
        "Generated by `amiga-studio-cli engine-matrix` against **{}**.\n\n\
         Each row feeds a configuration produced by Amiga Studio to the engine's own \
         `--dump-config` and compares what we sent with what the engine resolved. \
         *Accepted* = every checked key echoed unchanged and the engine applied no correction. \
         This proves the configuration is *accepted*; it does **not** prove boot or timing accuracy \
         (see the boot test log).\n\n",
        engine.banner
    ));
    s.push_str("| Configuration | Result | Details |\n|---|---|---|\n");
    for r in rows {
        let mut d = r.mismatches.clone();
        d.extend(r.corrections.iter().map(|c| format!("engine: {c}")));
        s.push_str(&format!(
            "| {} | {} | {} |\n",
            r.name,
            if r.accepted { "accepted" } else { "adjusted" },
            if d.is_empty() { "".into() } else { d.join("<br>") }
        ));
    }
    s
}
