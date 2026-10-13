//! Machine profiles: a versioned, serialisable description of one emulated Amiga
//! plus a validator that rejects physically impossible combinations.
//!
//! The validator encodes hardware facts (what a 68EC040 lacks, which machines
//! have AGA, ...). It is a *first line* of defence; the emulator engine is also
//! asked to resolve the final configuration (see `emu_config` / `engine`) and
//! any correction it applies is surfaced to the user.
//!
//! Presets describe an *emulated configuration*. They deliberately do not claim
//! to emulate a specific named accelerator board.

use crate::rom::{Chipset, RomInfo};
use serde::{Deserialize, Serialize};

pub const PROFILE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmigaModel {
    A500,
    A500Plus,
    A1200,
    A3000,
    A4000,
    Custom,
}

impl AmigaModel {
    /// Amiberry `chipset_compatible` / QuickStart name.
    pub fn compat_name(self) -> &'static str {
        match self {
            AmigaModel::A500 => "A500",
            AmigaModel::A500Plus => "A500+",
            AmigaModel::A1200 => "A1200",
            AmigaModel::A3000 => "A3000",
            AmigaModel::A4000 => "A4000",
            AmigaModel::Custom => "Generic",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CpuModel {
    #[serde(rename = "68000")]
    M68000,
    #[serde(rename = "68010")]
    M68010,
    #[serde(rename = "68020")]
    M68020,
    #[serde(rename = "68EC020")]
    M68EC020,
    #[serde(rename = "68030")]
    M68030,
    #[serde(rename = "68EC030")]
    M68EC030,
    #[serde(rename = "68040")]
    M68040,
    #[serde(rename = "68EC040")]
    M68EC040,
}

impl CpuModel {
    pub const ALL: [CpuModel; 8] = [
        CpuModel::M68000,
        CpuModel::M68010,
        CpuModel::M68020,
        CpuModel::M68EC020,
        CpuModel::M68030,
        CpuModel::M68EC030,
        CpuModel::M68040,
        CpuModel::M68EC040,
    ];
    pub fn name(self) -> &'static str {
        match self {
            CpuModel::M68000 => "68000",
            CpuModel::M68010 => "68010",
            CpuModel::M68020 => "68020",
            CpuModel::M68EC020 => "68EC020",
            CpuModel::M68030 => "68030",
            CpuModel::M68EC030 => "68EC030",
            CpuModel::M68040 => "68040",
            CpuModel::M68EC040 => "68EC040",
        }
    }
    /// Core family number (68000 -> 68000, 68EC030 -> 68030, ...).
    pub fn family(self) -> u32 {
        match self {
            CpuModel::M68000 => 68000,
            CpuModel::M68010 => 68010,
            CpuModel::M68020 | CpuModel::M68EC020 => 68020,
            CpuModel::M68030 | CpuModel::M68EC030 => 68030,
            CpuModel::M68040 | CpuModel::M68EC040 => 68040,
        }
    }
    /// 24-bit address bus only (68000/68010/68EC020).
    pub fn forced_24bit(self) -> bool {
        matches!(self, CpuModel::M68000 | CpuModel::M68010 | CpuModel::M68EC020)
    }
    pub fn is_32bit_capable(self) -> bool {
        self.family() >= 68020
    }
    pub fn has_internal_mmu(self) -> bool {
        matches!(self, CpuModel::M68030 | CpuModel::M68040)
    }
    pub fn has_internal_fpu(self) -> bool {
        matches!(self, CpuModel::M68040)
    }
    pub fn has_data_cache(self) -> bool {
        self.family() >= 68030
    }
    /// Supports an external 68881/68882 over the coprocessor interface.
    pub fn accepts_external_fpu(self) -> bool {
        matches!(self, CpuModel::M68020 | CpuModel::M68EC020 | CpuModel::M68030 | CpuModel::M68EC030)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FpuModel {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "68881")]
    M68881,
    #[serde(rename = "68882")]
    M68882,
    /// The FPU built into a full 68040.
    #[serde(rename = "internal")]
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PerformanceMode {
    /// Cycle-exact CPU + chipset timing. Best compatibility.
    Compatibility,
    /// Faster, cycle-approximate; enables the JIT where valid.
    Performance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CpuSpeed {
    /// Original machine speed (7.09/7.16 MHz style timing).
    Original,
    /// As fast as the host allows.
    Max,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CpuConfig {
    pub model: CpuModel,
    pub fpu: FpuModel,
    pub mmu: bool,
    pub speed: CpuSpeed,
    /// Force 24-bit addressing on a 32-bit capable CPU (needed by some old software).
    pub address_24bit: bool,
    pub data_cache: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemoryConfig {
    /// Chip RAM in KiB: 256, 512, 1024, 2048.
    pub chip_kb: u32,
    /// "Slow"/trapdoor RAM in KiB (OCS/ECS machines): multiples of 256, max 1792.
    pub slow_kb: u32,
    /// Zorro II Fast RAM in MiB: 0,1,2,4,8.
    pub fast_mb: u32,
    /// Accelerator / motherboard 32-bit RAM in MiB (needs a 32-bit CPU).
    pub accel_mb: u32,
    /// Zorro III RAM in MiB (needs a 32-bit CPU and a Zorro III machine).
    pub z3_mb: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DriveKind {
    Disabled,
    Dd35,
    Hd35,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DriveConfig {
    pub kind: DriveKind,
    /// Library media id inserted at start-up (never a raw path).
    pub media_id: Option<String>,
    pub write_protect: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HdController {
    /// Emulated mainboard IDE (A600/A1200/A4000 style).
    MainboardIde,
    /// UAE built-in hardfile controller (works on any model with autoconfig).
    Uae,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HdAttachment {
    pub hdf_id: String,
    pub controller: HdController,
    pub read_only: bool,
    pub boot_priority: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioConfig {
    /// 0 (silent) .. 100.
    pub volume: u32,
    pub muted: bool,
    /// 0..10 (0 = mono, 10 = full separation).
    pub stereo_separation: u32,
    pub sample_rate: u32,
    /// Output buffer in milliseconds (lower = less latency, more risk of crackle).
    pub buffer_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoStandard {
    Pal,
    Ntsc,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DisplayConfig {
    pub standard: VideoStandard,
    pub fullscreen: bool,
    pub keep_aspect: bool,
    pub window_width: u32,
    pub window_height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortDevice {
    None,
    Mouse,
    /// Cursor keys + right Ctrl/Alt as a joystick.
    KeyboardJoystick,
    /// First connected USB gamepad.
    Gamepad,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InputConfig {
    pub port0: PortDevice,
    pub port1: PortDevice,
    /// 10..200 percent.
    pub mouse_speed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MachineProfile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub model: AmigaModel,
    pub chipset: Chipset,
    pub cpu: CpuConfig,
    pub memory: MemoryConfig,
    pub performance: PerformanceMode,
    pub rom_id: Option<String>,
    pub ext_rom_id: Option<String>,
    pub drives: [DriveConfig; 4],
    pub hard_disks: Vec<HdAttachment>,
    pub audio: AudioConfig,
    pub display: DisplayConfig,
    pub input: InputConfig,
    /// Free text shown on the profile card.
    pub notes: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Issue {
    pub severity: Severity,
    /// Dotted path of the offending setting, e.g. `cpu.fpu`.
    pub field: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Validation {
    pub issues: Vec<Issue>,
}

impl Validation {
    pub fn has_errors(&self) -> bool {
        self.issues.iter().any(|i| i.severity == Severity::Error)
    }
    fn push(&mut self, sev: Severity, field: &str, msg: impl Into<String>) {
        self.issues.push(Issue { severity: sev, field: field.into(), message: msg.into() });
    }
    fn err(&mut self, f: &str, m: impl Into<String>) {
        self.push(Severity::Error, f, m)
    }
    fn warn(&mut self, f: &str, m: impl Into<String>) {
        self.push(Severity::Warning, f, m)
    }
    fn info(&mut self, f: &str, m: impl Into<String>) {
        self.push(Severity::Info, f, m)
    }
}

pub fn default_audio() -> AudioConfig {
    AudioConfig { volume: 80, muted: false, stereo_separation: 7, sample_rate: 44100, buffer_ms: 40 }
}

fn default_display() -> DisplayConfig {
    DisplayConfig {
        standard: VideoStandard::Pal,
        fullscreen: false,
        keep_aspect: true,
        window_width: 960,
        window_height: 720,
    }
}

fn default_input() -> InputConfig {
    InputConfig { port0: PortDevice::Mouse, port1: PortDevice::KeyboardJoystick, mouse_speed: 100 }
}

fn drives(n: usize, kind: DriveKind) -> [DriveConfig; 4] {
    let mk = |i: usize| DriveConfig {
        kind: if i < n { kind } else { DriveKind::Disabled },
        media_id: None,
        write_protect: false,
    };
    [mk(0), mk(1), mk(2), mk(3)]
}

/// Curated presets. `id` is stable and documented in the UI as "emulated
/// configuration" - none of these claim to be a specific board.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
}

pub fn presets() -> Vec<Preset> {
    vec![
        Preset { id: "a500", title: "Classic Amiga 500", description: "68000, OCS chipset, 512 KB Chip + 512 KB Slow RAM, Kickstart 1.3. Boots from floppy." },
        Preset { id: "a500_020", title: "A500 with 68020 accelerator", description: "A 68000 machine upgraded with an emulated 68EC020-class accelerator (24-bit) and 4 MB Fast RAM. A generic configuration, not a specific board." },
        Preset { id: "a500_030", title: "A500 with 68030 accelerator", description: "An emulated 68030 accelerator with 8 MB 32-bit RAM on an OCS A500. A generic configuration, not a specific board." },
        Preset { id: "a500plus", title: "Amiga 500+", description: "68000, ECS chipset, 1 MB Chip RAM, Kickstart 2.x." },
        Preset { id: "a1200", title: "Amiga 1200", description: "68EC020, AGA chipset, 2 MB Chip RAM, Kickstart 3.1." },
        Preset { id: "a1200_030", title: "A1200 with 68030 accelerator", description: "68030 with FPU and 16 MB Fast RAM, AGA. A generic emulated accelerator, not a specific board." },
        Preset { id: "a1200_040", title: "A1200 with 68040 accelerator", description: "68040 (built-in FPU and MMU), 32 MB Fast RAM, AGA. A generic emulated accelerator, not a specific board." },
        Preset { id: "a3000", title: "Amiga 3000", description: "68030 with 68882 FPU, ECS chipset, 2 MB Chip + 8 MB motherboard RAM, Kickstart 2.x/3.1." },
        Preset { id: "a4000_040", title: "Amiga 4000/040", description: "68040, AGA chipset, 2 MB Chip + 16 MB motherboard RAM, Kickstart 3.1." },
        Preset { id: "custom", title: "Custom Amiga", description: "Choose every part yourself. Invalid combinations are flagged." },
    ]
}

pub fn from_preset(preset_id: &str, id: String, name: String) -> Option<MachineProfile> {
    let base = |model, chipset, cpu: CpuConfig, memory: MemoryConfig, drv: [DriveConfig; 4]| MachineProfile {
        schema_version: PROFILE_SCHEMA_VERSION,
        id: id.clone(),
        name: name.clone(),
        model,
        chipset,
        cpu,
        memory,
        performance: PerformanceMode::Compatibility,
        rom_id: None,
        ext_rom_id: None,
        drives: drv,
        hard_disks: vec![],
        audio: default_audio(),
        display: default_display(),
        input: default_input(),
        notes: String::new(),
    };
    let cpu = |model: CpuModel, fpu, mmu| CpuConfig {
        model,
        fpu,
        mmu,
        speed: CpuSpeed::Original,
        address_24bit: model.forced_24bit(),
        data_cache: false,
    };
    let mem = |chip_kb, slow_kb, fast_mb, accel_mb, z3_mb| MemoryConfig { chip_kb, slow_kb, fast_mb, accel_mb, z3_mb };
    use AmigaModel as M;
    use CpuModel as C;
    Some(match preset_id {
        "a500" => base(
            M::A500,
            Chipset::Ocs,
            cpu(C::M68000, FpuModel::None, false),
            mem(512, 512, 0, 0, 0),
            drives(2, DriveKind::Dd35),
        ),
        "a500_020" => base(
            M::A500,
            Chipset::Ocs,
            cpu(C::M68EC020, FpuModel::None, false),
            mem(512, 512, 4, 0, 0),
            drives(2, DriveKind::Dd35),
        ),
        "a500_030" => {
            let mut c = cpu(C::M68030, FpuModel::None, false);
            c.address_24bit = false;
            base(M::A500, Chipset::Ocs, c, mem(1024, 0, 0, 8, 0), drives(2, DriveKind::Dd35))
        }
        "a500plus" => base(
            M::A500Plus,
            Chipset::Ecs,
            cpu(C::M68000, FpuModel::None, false),
            mem(1024, 0, 0, 0, 0),
            drives(2, DriveKind::Dd35),
        ),
        "a1200" => base(
            M::A1200,
            Chipset::Aga,
            cpu(C::M68EC020, FpuModel::None, false),
            mem(2048, 0, 0, 0, 0),
            drives(2, DriveKind::Dd35),
        ),
        "a1200_030" => {
            let mut c = cpu(C::M68030, FpuModel::M68882, true);
            c.address_24bit = false;
            base(M::A1200, Chipset::Aga, c, mem(2048, 0, 0, 16, 0), drives(2, DriveKind::Dd35))
        }
        "a1200_040" => {
            let mut c = cpu(C::M68040, FpuModel::Internal, true);
            c.address_24bit = false;
            base(M::A1200, Chipset::Aga, c, mem(2048, 0, 0, 32, 0), drives(2, DriveKind::Dd35))
        }
        "a3000" => {
            let mut c = cpu(C::M68030, FpuModel::M68882, true);
            c.address_24bit = false;
            base(M::A3000, Chipset::Ecs, c, mem(2048, 0, 0, 8, 0), drives(2, DriveKind::Dd35))
        }
        "a4000_040" => {
            let mut c = cpu(C::M68040, FpuModel::Internal, true);
            c.address_24bit = false;
            base(M::A4000, Chipset::Aga, c, mem(2048, 0, 0, 16, 0), drives(2, DriveKind::Dd35))
        }
        "custom" => base(
            M::Custom,
            Chipset::Ecs,
            cpu(C::M68000, FpuModel::None, false),
            mem(1024, 0, 0, 0, 0),
            drives(2, DriveKind::Dd35),
        ),
        _ => return None,
    })
}

/// Machines whose motherboard provides a 32-bit memory bus / Zorro III.
fn zorro3_machine(m: AmigaModel) -> bool {
    matches!(m, AmigaModel::A3000 | AmigaModel::A4000 | AmigaModel::Custom)
}

fn aga_machine(m: AmigaModel) -> bool {
    matches!(m, AmigaModel::A1200 | AmigaModel::A4000)
}

/// Validate a profile. `rom` is the selected Kickstart (if known).
pub fn validate(p: &MachineProfile, rom: Option<&RomInfo>) -> Validation {
    let mut v = Validation::default();
    let cpu = &p.cpu;
    let m = cpu.model;

    // --- schema ---
    if p.schema_version != PROFILE_SCHEMA_VERSION {
        v.err(
            "schema_version",
            format!("Unsupported profile version {} (expected {PROFILE_SCHEMA_VERSION}).", p.schema_version),
        );
    }
    if p.name.trim().is_empty() {
        v.err("name", "Give the machine a name.");
    }

    // --- CPU / FPU / MMU: hardware facts ---
    match (m, cpu.fpu) {
        (_, FpuModel::None) => {}
        (CpuModel::M68040, FpuModel::Internal) => {}
        (CpuModel::M68040, _) => {
            v.err("cpu.fpu", "A 68040 has its own built-in FPU; external 68881/68882 chips are not used with it.")
        }
        (CpuModel::M68EC040, _) => v.err("cpu.fpu", "The 68EC040 has no FPU. Choose a full 68040 for floating point."),
        (_, FpuModel::Internal) => v.err("cpu.fpu", format!("The {} has no built-in FPU.", m.name())),
        (c, _) if !c.accepts_external_fpu() => {
            v.err("cpu.fpu", format!("A {} cannot be paired with a 68881/68882 FPU.", c.name()))
        }
        _ => {}
    }
    if m == CpuModel::M68040 && cpu.fpu == FpuModel::None {
        v.info("cpu.fpu", "A full 68040 always includes its FPU; it will be enabled.");
    }
    if cpu.mmu && !m.has_internal_mmu() {
        let why = match m {
            CpuModel::M68EC030 => "The 68EC030 has no MMU.",
            CpuModel::M68EC040 => "The 68EC040 has no MMU.",
            _ => "This processor has no MMU.",
        };
        v.err("cpu.mmu", why);
    }
    if cpu.data_cache && !m.has_data_cache() {
        v.err("cpu.data_cache", format!("The {} has no data cache.", m.name()));
    }
    if m.forced_24bit() && !cpu.address_24bit {
        v.err("cpu.address_24bit", format!("The {} only has a 24-bit address bus.", m.name()));
    }

    // --- chipset vs machine ---
    if p.chipset == Chipset::Aga && !aga_machine(p.model) && p.model != AmigaModel::Custom {
        v.err("chipset", "The AGA chipset only exists in the Amiga 1200 and 4000 families.");
    }
    if p.model == AmigaModel::A500 && p.chipset != Chipset::Ocs && p.chipset != Chipset::Ecs {
        v.err("chipset", "The Amiga 500 uses the OCS (or ECS-upgraded) chipset.");
    }
    if aga_machine(p.model) && p.chipset != Chipset::Aga {
        v.warn("chipset", "This machine normally has the AGA chipset; software may expect it.");
    }
    if p.model == AmigaModel::A3000 && p.chipset == Chipset::Ocs {
        v.err("chipset", "The Amiga 3000 has the ECS chipset.");
    }

    // --- CPU vs machine presets ---
    if matches!(p.model, AmigaModel::A1200 | AmigaModel::A3000 | AmigaModel::A4000) && m.family() == 68000 {
        v.err("cpu.model", format!("The {} uses a 32-bit processor (68EC020 or better).", p.model.compat_name()));
    }
    if p.model == AmigaModel::A4000 && !matches!(m.family(), 68030 | 68040) && m != CpuModel::M68EC020 {
        v.warn("cpu.model", "The Amiga 4000 shipped with a 68030 or 68040.");
    }

    // --- memory ---
    let mem = &p.memory;
    if ![256, 512, 1024, 2048].contains(&mem.chip_kb) {
        v.err("memory.chip_kb", "Chip RAM must be 256 KB, 512 KB, 1 MB or 2 MB.");
    }
    if p.chipset == Chipset::Ocs && mem.chip_kb > 1024 {
        v.err(
            "memory.chip_kb",
            "OCS Agnus can address at most 1 MB of Chip RAM (the original A500 shipped with 512 KB).",
        );
    }
    if p.chipset != Chipset::Aga && mem.chip_kb == 2048 && p.chipset != Chipset::Ecs {
        v.err("memory.chip_kb", "2 MB Chip RAM needs ECS or AGA.");
    }
    if p.chipset == Chipset::Aga && mem.chip_kb < 1024 {
        v.warn("memory.chip_kb", "AGA software expects at least 1 MB, usually 2 MB, of Chip RAM.");
    }
    if mem.slow_kb % 256 != 0 || mem.slow_kb > 1792 {
        v.err("memory.slow_kb", "Slow RAM must be a multiple of 256 KB, up to 1.75 MB.");
    }
    if mem.slow_kb > 0 && p.chipset == Chipset::Aga {
        v.err("memory.slow_kb", "AGA machines have no trapdoor/Slow RAM; use Fast RAM instead.");
    }
    if ![0, 1, 2, 4, 8].contains(&mem.fast_mb) {
        v.err("memory.fast_mb", "Zorro II Fast RAM can be 0, 1, 2, 4 or 8 MB.");
    }
    if mem.accel_mb > 0 && !m.is_32bit_capable() {
        v.err("memory.accel_mb", "32-bit accelerator RAM needs a 68020 or better.");
    }
    if mem.accel_mb > 0 && cpu.address_24bit {
        v.err("memory.accel_mb", "32-bit RAM above 16 MB is unreachable with 24-bit addressing. Turn 24-bit addressing off or remove the RAM.");
    }
    if ![0, 1, 2, 4, 8, 16, 32, 64, 128].contains(&mem.accel_mb) {
        v.err("memory.accel_mb", "Accelerator RAM must be 0, 1, 2, 4, 8, 16, 32, 64 or 128 MB.");
    }
    if mem.z3_mb > 0 {
        if !m.is_32bit_capable() || cpu.address_24bit {
            v.err("memory.z3_mb", "Zorro III RAM needs a 32-bit processor with 24-bit addressing off.");
        }
        if !zorro3_machine(p.model) {
            v.warn(
                "memory.z3_mb",
                "Zorro III exists in the A3000/A4000; on other models it is a non-authentic extension.",
            );
        }
        if mem.z3_mb > 1024 {
            v.err("memory.z3_mb", "Zorro III RAM is limited to 1024 MB.");
        }
    }
    if mem.fast_mb > 0 && mem.accel_mb > 0 && p.chipset == Chipset::Aga {
        v.info("memory", "Both Zorro II and accelerator RAM are set; most AGA systems only need accelerator RAM.");
    }

    // --- performance / JIT ---
    if p.performance == PerformanceMode::Performance {
        if m.family() == 68000 || m.family() == 68010 {
            v.warn(
                "performance",
                "JIT acceleration needs a 68020 or better; the 68000 will run interpreted at maximum speed.",
            );
        }
        if cpu.mmu {
            v.warn(
                "performance",
                "The JIT is disabled when the MMU is enabled; the engine will fall back to the interpreter.",
            );
        }
        v.info("performance", "Performance mode is not cycle-exact. Timing-sensitive software (some games and demos) may misbehave. Use Compatibility mode for those.");
    }

    // --- drives ---
    if p.drives[0].kind == DriveKind::Disabled {
        v.warn("drives.0", "DF0: is disabled; you cannot boot from a floppy.");
    }
    for (i, d) in p.drives.iter().enumerate() {
        if d.kind == DriveKind::Hd35
            && !(p.model == AmigaModel::A4000 || p.model == AmigaModel::A3000 || p.model == AmigaModel::Custom)
        {
            v.warn(
                &format!("drives.{i}"),
                "High-density drives were only fitted by default to the A4000 (and A3000 with a modification).",
            );
        }
        if d.kind == DriveKind::Disabled && d.media_id.is_some() {
            v.err(&format!("drives.{i}"), format!("DF{i}: is disabled but a disk is assigned to it."));
        }
    }
    if p.drives.iter().skip(1).any(|d| d.kind != DriveKind::Disabled)
        && p.drives.iter().take_while(|d| d.kind != DriveKind::Disabled).count()
            < p.drives.iter().filter(|d| d.kind != DriveKind::Disabled).count()
    {
        v.err("drives", "Drives must be enabled in order: DF1: needs DF0:, DF2: needs DF1:, and so on.");
    }
    let mut seen = std::collections::HashSet::new();
    for (i, d) in p.drives.iter().enumerate() {
        if let Some(id) = &d.media_id {
            if !seen.insert(id.clone()) {
                v.err(
                    &format!("drives.{i}"),
                    "The same disk image is inserted in two drives. Make a copy for the second drive.",
                );
            }
        }
    }

    // --- hard disks ---
    for (i, h) in p.hard_disks.iter().enumerate() {
        if h.controller == HdController::MainboardIde
            && !matches!(p.model, AmigaModel::A1200 | AmigaModel::A4000 | AmigaModel::Custom)
        {
            v.err(
                &format!("hard_disks.{i}"),
                "Mainboard IDE exists on the A600/A1200/A4000. Use the UAE controller on this model.",
            );
        }
    }
    if p.hard_disks.len() > 4 {
        v.err("hard_disks", "At most 4 hard disks can be attached.");
    }

    // --- audio / input ---
    if p.audio.volume > 100 {
        v.err("audio.volume", "Volume must be 0-100.");
    }
    if p.audio.stereo_separation > 10 {
        v.err("audio.stereo_separation", "Stereo separation must be 0-10.");
    }
    if ![22050, 44100, 48000].contains(&p.audio.sample_rate) {
        v.err("audio.sample_rate", "Sample rate must be 22050, 44100 or 48000 Hz.");
    }
    if !(10..=200).contains(&p.audio.buffer_ms) {
        v.err("audio.buffer_ms", "Audio buffer must be 10-200 ms.");
    }
    if !(10..=200).contains(&p.input.mouse_speed) {
        v.err("input.mouse_speed", "Mouse speed must be 10-200%.");
    }
    if p.input.port0 == p.input.port1 && matches!(p.input.port0, PortDevice::Mouse | PortDevice::Gamepad) {
        v.warn("input", "Both ports use the same device.");
    }

    // --- Kickstart compatibility ---
    match (p.rom_id.is_some(), rom) {
        (false, _) => v.warn("rom_id", "No Kickstart ROM is selected. Import one in the ROM Library."),
        (true, None) => v.err("rom_id", "The selected Kickstart ROM is missing from the library."),
        (true, Some(r)) => {
            if !r.is_usable() {
                v.err("rom_id", "The selected ROM failed validation and cannot be used.");
            }
            if let Some(ver) = r.exec_version {
                if p.chipset == Chipset::Aga && !r.aga_capable {
                    v.err(
                        "rom_id",
                        format!("{} cannot drive the AGA chipset. Use Kickstart 3.0/3.1 for AGA machines.", r.label),
                    );
                }
                if matches!(p.model, AmigaModel::A3000) && ver < 36 {
                    v.err("rom_id", "The Amiga 3000 needs Kickstart 2.0 or newer.");
                }
                if matches!(p.model, AmigaModel::A500Plus) && ver < 37 {
                    v.warn(
                        "rom_id",
                        "The Amiga 500+ shipped with Kickstart 2.04 or newer; older ROMs may behave differently.",
                    );
                }
                if m.family() >= 68030 && ver < 36 {
                    v.warn("rom_id", "Kickstart 1.x predates the 68030/68040 and may be unstable with them.");
                }
                if m.family() == 68040 && ver < 37 {
                    v.warn("rom_id", "The 68040 needs Kickstart 2.04 or newer to be useful.");
                }
                if p.hard_disks.iter().any(|_| true) && ver < 36 {
                    v.warn(
                        "hard_disks",
                        "Kickstart 1.x cannot autoboot from a hard disk; boot from floppy and mount it.",
                    );
                }
                if p.model == AmigaModel::A500 && ver >= 39 && !r.aga_capable {
                    // 40.63 on an A500 is fine
                }
            }
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rom::{inspect, test_support::synthetic_rom};

    fn p(id: &str) -> MachineProfile {
        from_preset(id, "x".into(), "Test".into()).unwrap()
    }
    fn errs(v: &Validation) -> Vec<&str> {
        v.issues.iter().filter(|i| i.severity == Severity::Error).map(|i| i.field.as_str()).collect()
    }
    fn rom(ver: u16, rev: u16) -> RomInfo {
        inspect(&synthetic_rom(0x80000, ver, rev)).unwrap()
    }

    #[test]
    fn all_presets_validate_without_errors_given_matching_rom() {
        for pr in presets() {
            let mut prof = p(pr.id);
            prof.rom_id = Some("r".into());
            let r = match prof.chipset {
                Chipset::Aga => rom(40, 68),
                Chipset::Ecs => rom(40, 63),
                Chipset::Ocs => rom(34, 5),
            };
            let v = validate(&prof, Some(&r));
            assert!(!v.has_errors(), "preset {} has errors: {:?}", pr.id, v.issues);
        }
    }

    #[test]
    fn preset_ids_unique_and_resolvable() {
        let mut s = std::collections::HashSet::new();
        for pr in presets() {
            assert!(s.insert(pr.id));
            assert!(from_preset(pr.id, "i".into(), "n".into()).is_some());
        }
        assert!(from_preset("nope", "i".into(), "n".into()).is_none());
    }

    #[test]
    fn ec_variants_lack_fpu_and_mmu() {
        let mut x = p("custom");
        x.cpu.model = CpuModel::M68EC040;
        x.cpu.address_24bit = false;
        x.cpu.fpu = FpuModel::Internal;
        x.cpu.mmu = true;
        let val = validate(&x, None);
        let e = errs(&val);
        assert!(e.contains(&"cpu.fpu") && e.contains(&"cpu.mmu"), "{e:?}");
        x.cpu.fpu = FpuModel::None;
        x.cpu.mmu = false;
        assert!(!errs(&validate(&x, None)).contains(&"cpu.fpu"));

        x.cpu.model = CpuModel::M68EC030;
        x.cpu.mmu = true;
        assert!(errs(&validate(&x, None)).contains(&"cpu.mmu"));
    }

    #[test]
    fn full_040_has_internal_fpu_and_mmu_only() {
        let mut x = p("a4000_040");
        assert!(!validate(&x, None).has_errors());
        x.cpu.fpu = FpuModel::M68882;
        assert!(errs(&validate(&x, None)).contains(&"cpu.fpu"));
        x.cpu.fpu = FpuModel::Internal;
        x.cpu.model = CpuModel::M68030;
        assert!(errs(&validate(&x, None)).contains(&"cpu.fpu"));
        x.cpu.model = CpuModel::M68000;
        x.cpu.address_24bit = true;
        assert!(errs(&validate(&x, None)).contains(&"cpu.fpu"));
    }

    #[test]
    fn external_fpu_only_on_020_030() {
        let mut x = p("custom");
        x.cpu.fpu = FpuModel::M68881;
        assert!(errs(&validate(&x, None)).contains(&"cpu.fpu"), "68000 + FPU is impossible");
        x.cpu.model = CpuModel::M68030;
        x.cpu.address_24bit = false;
        assert!(!errs(&validate(&x, None)).contains(&"cpu.fpu"));
    }

    #[test]
    fn address_bus_and_ram_rules() {
        let mut x = p("custom");
        x.memory.accel_mb = 8;
        assert!(errs(&validate(&x, None)).contains(&"memory.accel_mb"), "68000 cannot use 32-bit RAM");
        x.cpu.model = CpuModel::M68030;
        assert!(
            errs(&validate(&x, None)).contains(&"cpu.address_24bit")
                || errs(&validate(&x, None)).contains(&"memory.accel_mb")
        );
        x.cpu.address_24bit = false;
        assert!(!validate(&x, None).has_errors(), "{:?}", validate(&x, None).issues);
        x.cpu.model = CpuModel::M68EC020;
        assert!(errs(&validate(&x, None)).contains(&"cpu.address_24bit"));
    }

    #[test]
    fn chip_ram_limits_follow_chipset() {
        let mut x = p("a500");
        x.memory.chip_kb = 2048;
        assert!(errs(&validate(&x, None)).contains(&"memory.chip_kb"));
        x.memory.chip_kb = 333;
        assert!(errs(&validate(&x, None)).contains(&"memory.chip_kb"));
    }

    #[test]
    fn aga_needs_aga_machine_and_rom() {
        let mut x = p("a500");
        x.chipset = Chipset::Aga;
        assert!(errs(&validate(&x, None)).contains(&"chipset"));
        let mut a = p("a1200");
        a.rom_id = Some("r".into());
        assert!(errs(&validate(&a, Some(&rom(40, 63)))).contains(&"rom_id"), "40.63 is not AGA");
        assert!(!validate(&a, Some(&rom(40, 68))).has_errors());
        assert!(!validate(&a, Some(&rom(39, 106))).has_errors());
        assert!(errs(&validate(&a, Some(&rom(34, 5)))).contains(&"rom_id"));
    }

    #[test]
    fn a3000_requires_kickstart_2_or_newer() {
        let mut a = p("a3000");
        a.rom_id = Some("r".into());
        assert!(errs(&validate(&a, Some(&rom(34, 5)))).contains(&"rom_id"));
        assert!(!validate(&a, Some(&rom(37, 175))).has_errors());
    }

    #[test]
    fn drives_must_be_contiguous_and_unique() {
        let mut x = p("a500");
        x.drives = drives(0, DriveKind::Dd35);
        x.drives[2].kind = DriveKind::Dd35;
        assert!(errs(&validate(&x, None)).contains(&"drives"));
        let mut y = p("a500");
        y.drives = drives(4, DriveKind::Dd35);
        y.drives[0].media_id = Some("same".into());
        y.drives[3].media_id = Some("same".into());
        assert!(errs(&validate(&y, None)).contains(&"drives.3"));
        assert!(!errs(&validate(&p("a500"), None)).contains(&"drives"));
    }

    #[test]
    fn missing_or_corrupt_rom_is_an_error() {
        let mut x = p("a500");
        x.rom_id = Some("gone".into());
        assert!(errs(&validate(&x, None)).contains(&"rom_id"));
        let bad = inspect(&vec![0u8; 0x40000]).unwrap();
        assert!(errs(&validate(&x, Some(&bad))).contains(&"rom_id"));
        x.rom_id = None;
        assert!(validate(&x, None).issues.iter().any(|i| i.field == "rom_id" && i.severity == Severity::Warning));
    }

    #[test]
    fn schema_version_enforced_and_json_roundtrip() {
        let mut x = p("a1200_040");
        let j = serde_json::to_string(&x).unwrap();
        let back: MachineProfile = serde_json::from_str(&j).unwrap();
        assert_eq!(x, back);
        x.schema_version = 99;
        assert!(errs(&validate(&x, None)).contains(&"schema_version"));
        assert!(j.contains("\"68040\""), "cpu serialises as its marketing name");
    }

    #[test]
    fn jit_with_mmu_warns() {
        let mut x = p("a1200_040");
        x.performance = PerformanceMode::Performance;
        let v = validate(&x, None);
        assert!(v.issues.iter().any(|i| i.field == "performance" && i.message.contains("MMU")));
    }

    #[test]
    fn mainboard_ide_only_where_it_exists() {
        let mut x = p("a500");
        x.hard_disks.push(HdAttachment {
            hdf_id: "h".into(),
            controller: HdController::MainboardIde,
            read_only: false,
            boot_priority: 0,
        });
        assert!(errs(&validate(&x, None)).contains(&"hard_disks.0"));
        x.hard_disks[0].controller = HdController::Uae;
        assert!(!errs(&validate(&x, None)).contains(&"hard_disks.0"));
    }
}
