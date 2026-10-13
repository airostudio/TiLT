// Mirrors the JSON produced by crates/amiga-core and crates/amiga-service (serde).
// Keep in sync when Rust types change; the Playwright e2e suite exercises the real backend.

export interface ErrorDto {
  code: string
  message: string
}

// ---------- ROMs ----------
export type RomKind = 'kickstart' | 'encrypted_cloanto' | 'unrecognised'
export type Chipset = 'ocs' | 'ecs' | 'aga'

export interface RomInfo {
  sha256: string
  size: number
  kind: RomKind
  exec_version: number | null
  exec_revision: number | null
  family: string | null
  label: string
  checksum_ok: boolean
  footer_size_ok: boolean
  mirrored_256k: boolean
  is_aros: boolean
  aga_capable: boolean
  likely_machines: string[]
  version_string: string | null
  warnings: string[]
}

export type StorageMode = 'managed' | 'referenced'

export interface RomRecord {
  id: string
  name: string
  storage: StorageMode
  path: string
  imported_at: number
  missing: boolean
  info: RomInfo
}

export interface RomImportResult {
  path: string
  ok?: { record: RomRecord; duplicate: boolean }
  error?: ErrorDto
}

// ---------- Floppies ----------
export type MediaKind = 'adf' | 'dms'
export type Density = 'double' | 'high'
export type FsKind = 'ofs' | 'ffs'

export interface AdfInfo {
  sha256: string
  size: number
  density: Density
  dos_bootblock: boolean
  bootblock_checksum_ok: boolean
  fs: FsKind | null
  international: boolean
  dir_cache: boolean
  root_valid: boolean
  volume_name: string | null
  has_boot_code: boolean
  non_dos: boolean
  all_zero: boolean
  summary: string
  warnings: string[]
}

export interface DmsInfo {
  creator_version: number
  first_track: number
  last_track: number
  packed_size: number
  unpacked_size: number
  disk_type: string
  encrypted: boolean
  high_density: boolean
  description: string
}

export interface MediaRecord {
  id: string
  kind: MediaKind
  name: string
  sha256: string
  size: number
  path: string
  parent_id: string | null
  source_dms_id: string | null
  pristine: boolean
  imported_at: number
  last_used: number | null
  missing: boolean
  info: { adf: AdfInfo | null; dms: DmsInfo | null; notes: string[] }
}

export interface MediaImportResult {
  path: string
  ok?: { record: MediaRecord; duplicate: boolean; dms_record: MediaRecord | null }
  error?: ErrorDto
}

export interface Queue {
  id: string
  name: string
  media_ids: string[]
}

// ---------- Workbench ----------
export type WbVersion = '2.1' | '3.1' | 'unknown'
export type DiskRole = 'workbench' | 'install' | 'extras' | 'fonts' | 'storage' | 'locale' | 'other'

export interface Classification {
  media_id: string
  volume_name: string | null
  version: WbVersion
  role: DiskRole
  detected_revision: [number, number] | null
  bootable: boolean
}

export interface WorkbenchSet {
  id: string
  name: string
  version: WbVersion
  disks: Classification[]
  missing_roles: DiskRole[]
  duplicate_roles: DiskRole[]
  warnings: string[]
  revision_confirmed: boolean
}

// ---------- Hard disks ----------
export type HdfLayout = 'rdb' | 'plain_hardfile' | 'blank' | 'unrecognised'

export interface HdfPartition {
  name: string
  dos_type: number
  dos_type_name: string
  bootable: boolean
  no_mount: boolean
  boot_priority: number
  low_cyl: number
  high_cyl: number
  surfaces: number
  blocks_per_track: number
  block_size: number
  size_bytes: number
}

export interface HdfInfo {
  size: number
  layout: HdfLayout
  block_size: number
  partitions: HdfPartition[]
  embedded_filesystems: string[]
  bootable_flagged: boolean
  plain_dos_type: string | null
  rdb_geometry: [number, number, number] | null
  summary: string
  warnings: string[]
  advice: string[]
}

export interface HdfRecord {
  id: string
  name: string
  original_path: string | null
  original_sha256: string
  size: number
  working_path: string
  pristine_path: string | null
  dirty: boolean
  unclean_shutdown: boolean
  imported_at: number
  working_missing: boolean
  info: HdfInfo
}

export type SnapshotKind = 'auto_backup' | 'backup' | 'snapshot' | 'pre_restore'

export interface SnapshotRecord {
  id: string
  hdf_id: string
  kind: SnapshotKind
  note: string
  path: string
  size: number
  sha256: string
  created_at: number
}

export interface ImportEstimate {
  source_size: number
  required_bytes: number
  free_bytes: number
  enough_space: boolean
  info: HdfInfo
}

// ---------- Profiles ----------
export type AmigaModel = 'a500' | 'a500_plus' | 'a1200' | 'a3000' | 'a4000' | 'custom'
export type CpuModel = '68000' | '68010' | '68020' | '68EC020' | '68030' | '68EC030' | '68040' | '68EC040'
export type FpuModel = 'none' | '68881' | '68882' | 'internal'
export type PerformanceMode = 'compatibility' | 'performance'
export type CpuSpeed = 'original' | 'max'
export type DriveKind = 'disabled' | 'dd35' | 'hd35'
export type HdController = 'mainboard_ide' | 'uae'
export type PortDevice = 'none' | 'mouse' | 'keyboard_joystick' | 'gamepad'

export interface DriveConfig {
  kind: DriveKind
  media_id: string | null
  write_protect: boolean
}

export interface HdAttachment {
  hdf_id: string
  controller: HdController
  read_only: boolean
  boot_priority: number
}

export interface MachineProfile {
  schema_version: number
  id: string
  name: string
  model: AmigaModel
  chipset: Chipset
  cpu: { model: CpuModel; fpu: FpuModel; mmu: boolean; speed: CpuSpeed; address_24bit: boolean; data_cache: boolean }
  memory: { chip_kb: number; slow_kb: number; fast_mb: number; accel_mb: number; z3_mb: number }
  performance: PerformanceMode
  rom_id: string | null
  ext_rom_id: string | null
  drives: [DriveConfig, DriveConfig, DriveConfig, DriveConfig]
  hard_disks: HdAttachment[]
  audio: { volume: number; muted: boolean; stereo_separation: number; sample_rate: number; buffer_ms: number }
  display: { standard: 'pal' | 'ntsc'; fullscreen: boolean; keep_aspect: boolean; window_width: number; window_height: number }
  input: { port0: PortDevice; port1: PortDevice; mouse_speed: number }
  notes: string
}

export interface Preset {
  id: string
  title: string
  description: string
}

export type Severity = 'error' | 'warning' | 'info'
export interface Issue {
  severity: Severity
  field: string
  message: string
}
export interface Validation {
  issues: Issue[]
}

// ---------- Engine / session ----------
export interface EngineInfo {
  path: string
  banner: string
  version: [number, number, number] | null
  runtime_control: boolean
  runtime_control_note: string | null
}

export interface AppInfo {
  version: string
  platform: string
  arch: string
  storage_root: string
  engine: EngineInfo | null
  runtime_control: boolean
}

export interface SessionStatus {
  running: boolean
  profile_id: string | null
  profile_name: string | null
  pid: number | null
  uptime_s: number
  runtime_control: boolean
  paused: boolean | null
  warnings: string[]
  log_path: string | null
  hard_disks: string[]
}

export interface DriveView {
  unit: number
  enabled: boolean
  path: string | null
  media_id: string | null
  media_name: string | null
  write_protected: boolean
  motor: boolean
  writing: boolean
  track: number | null
}

export interface SessionRecord {
  id: string
  profile_id: string
  profile_name: string
  started_at: number
  ended_at: number | null
  outcome: string | null
}

export interface StorageReport {
  roms: number
  workbench: number
  floppies: number
  dms: number
  hard_drives: number
  backups: number
  snapshots: number
  logs: number
  total_managed: number
  free_host: number
  root: string
}

// ---------- Disk tools ----------
export type CopySource = { type: 'library'; media_id: string } | { type: 'file'; path: string }
export type CopyTarget =
  | { type: 'new_library_image'; name: string }
  | { type: 'library'; media_id: string }
  | { type: 'file'; path: string }
export interface CopyOptions {
  verify: boolean
  overwrite: boolean
  backup_existing: boolean
}
export interface CopyReport {
  operation_id: string
  bytes: number
  source_sha256: string
  destination_sha256: string
  verified: boolean
  destination: string
  destination_media_id: string | null
  backup_path: string | null
  notes: string[]
}
export interface OperationRecord {
  id: string
  kind: string
  source: string
  destination: string
  verified: boolean
  status: string
  detail: string
  created_at: number
}

// ---------- Jobs ----------
export interface JobView<R = unknown> {
  id: string
  kind: string
  label: string
  done: number
  total: number
  state: 'running' | 'done' | 'failed' | 'cancelled'
  result: R | null
  error: ErrorDto | null
}

// ---------- Rooms / systems ----------
export interface RoomView {
  id: 'home' | 'pinball'
  name: string
  tagline: string
}

export interface SystemDef {
  id: string
  room: 'home' | 'pinball'
  name: string
  description: string
  kind: 'amiga' | 'external'
  exe?: string | null
  args: string[]
  game_dir?: string | null
  extensions: string[]
  setup_hint: string
  custom: boolean
}

export interface SystemView extends SystemDef {
  configured: boolean
  running: boolean
  game_count: number | null
}

export interface GameEntry {
  name: string
  path: string
  size: number
  favorite: boolean
  plays: number
  last_played: number | null
}
