# Service command reference

The UI talks to the backend through **one** allow-listed entry point:
`Service::dispatch(cmd, args) -> Result<Value, {code, message}>`
(`crates/amiga-service/src/lib.rs`). In the desktop app it is the single Tauri command
`amiga({cmd, args})`; in a browser (dev / e2e) it is `POST /api/<cmd>` on `tilt-local` (token required).
TypeScript wrappers: `apps/desktop/src/api/client.ts` (`call`, `runJob`, `waitForJob`, `cancelJob`),
types: `apps/desktop/src/api/types.ts`.

Anything not listed here does not exist for the front end. Paths that touch the filesystem must be
**absolute**. Long operations return `{ "job": "<id>" }`; poll with `job_get` (use `runJob`).
Errors carry a stable `code`: `io database invalid_rom invalid_disk invalid_hdf dms invalid_profile
insufficient_space locked unsafe not_found already_exists cancelled emulator unsupported internal offline`.

## App / storage
| command | args | result |
|---|---|---|
| `app_info` | – | `AppInfo` (version, platform, storage_root, engine, runtime_control) |
| `storage_report` | – | `StorageReport` (bytes per area, total, free host space) |
| `recover` | – | `{partial_files_removed, operations_rolled_forward, operations_rolled_back}` |
| `orphans` | – | `string[]` files in managed folders no catalogue row owns (reported, never auto-deleted) |
| `storage_location` | – | `{current, default, pointer, can_change, restart_required}` |
| `storage_set_location` | `path` (absolute, no commas, writable) | location info; takes effect after restart, existing data is NOT moved or deleted |
| `orphan_delete` | `path` (must be one of `orphans`) | `true` |
| `engine_info` | – | `EngineInfo` (path, banner, version, runtime_control, runtime_control_note); error `not_found` if Amiberry is missing |
| `engine_set_path` | `path` | `EngineInfo` (probes the executable first) |

## Rooms / external systems
`rooms`, `systems_list` → `SystemView[]`, `system_save {system: SystemDef}`, `system_delete {id}`,
`system_games {id}` → `GameEntry[]`, `system_favorite {id, game}`, `system_launch {id, game?}`, `system_stop {id}`.

## ROMs
| `rom_list` | – | `RomRecord[]` |
| `rom_import` | `paths[]`, `copy` (default true; false = reference in place) | `RomImportResult[]` (per-file `ok` or `error`) |
| `rom_relink` | `id`, `path` | `RomRecord` (refused if the file is a different ROM) |
| `rom_remove` | `id` | – (refused while a machine uses it; referenced originals are never deleted) |

## Floppies / DMS / queue
| `media_list` / `media_recent` | – | `MediaRecord[]` |
| `media_import` | `paths[]` | **job** → `MediaImportResult[]` (ADF or DMS by content; DMS archive preserved + ADF created) |
| `media_create_blank` | `name`, `fs` (`ofs`/`ffs`), `density` (`double`/`high`), `international?` | `MediaRecord` |
| `media_working_copy` | `id`, `name` | `MediaRecord` (writable copy; originals stay read-only/pristine) |
| `media_export` | `id`, `dest`, `overwrite?` | `true` |
| `media_delete` | `id` | – (refused while inserted in a machine / queued) |
| `media_verify` | `id` | `bool` (stored hash still matches) |
| `queue_list` / `queue_save {id?, name, media_ids[]}` / `queue_delete {id}` | | `Queue` |

## Workbench
`workbench_analyse {name, media_ids[]}` → `WorkbenchSet` (classification, missing/duplicate roles, revision check, warnings),
`workbench_save {set}`, `workbench_list`, `workbench_delete {id}`,
`workbench_kickstart_check {rom_id, version}` → `string | null` (mismatch warning).

## Hard disks
| `hdf_estimate` | `path`, `keep_pristine?` | `ImportEstimate` (needed vs free space, structure) – call before importing |
| `hdf_inspect` | `path` | `HdfInfo` (read-only analysis of any file) |
| `hdf_import` | `path`, `name`, `keep_pristine?`, `accept_unrecognised?` | **job** → `HdfRecord` |
| `hdf_list` | – | `HdfRecord[]` |
| `hdf_snapshots` | `id` | `SnapshotRecord[]` |
| `hdf_backup` | `id`, `kind` (`backup`/`snapshot`), `note?` | **job** → `SnapshotRecord` (refused with `locked` while the machine runs) |
| `hdf_restore` | `id`, `snapshot_id` | **job** (journalled; current state is kept as a pre-restore backup) |
| `hdf_export` | `id`, `dest`, `overwrite?` | **job** |
| `hdf_delete` | `id` | – |
| `snapshot_delete` | `id` | – |

## Machine profiles
`preset_list` → `Preset[]`, `profile_list`, `profile_get {id}`, `profile_from_preset {preset_id, name}` (unsaved),
`profile_validate {profile}` → `Validation` (errors block saving; warnings do not),
`profile_save {profile}` → `Validation` or `invalid_profile`, `profile_clone {id, name}`, `profile_delete {id}`,
`sessions_recent`.

## Disk tools
| `copy_disk` | `source: CopySource`, `target: CopyTarget`, `options: CopyOptions` | **job** → `CopyReport` |
| `operations_list` | – | `OperationRecord[]` history |

## Emulator session
| `session_start` | `profile_id`, `mode?` `process\|embedded` (default: the saved `run_mode`, else `process`) | `{started, warnings[]}` (locks disks, safety-backs-up HDFs, asks the engine to check the config; `embedded` hosts the libretro core in-process) |
| `session_stop` | – | `{outcome: clean\|forced\|already_exited}` |
| `session_status` | – | `SessionStatus` |
| `session_control` | `action`: `pause resume reset_soft reset_hard toggle_fullscreen toggle_mouse_grab mute volume{value 0-100}` | `true` |
| `session_drives` | – | `DriveView[]` (DF0-DF3: inserted image, protection, motor/activity) |
| `session_insert` | `unit` 0-3, `media_id`, `write_protect?` | `true` |
| `session_eject` | `unit` | `true` |
| `session_copy_drive` | `src_unit`, `dst_unit`, `new_name?`, `verify?` | **job** → `CopyReport` (both disks ejected, copied on the host, re-inserted) |
| `session_screenshot` | – | `{png_base64}` |
| `session_perf` | – | `{fps: {...}, leds: {...}, uptime_s}` |
| `session_save_state` / `session_load_state` | `name` | `{path, note}` – a state is emulator memory only, never disks |

### Embedded (libretro) mode
`SessionStatus.mode` is `process` or `embedded`. Extra commands: `session_frame {since?}` → `{unchanged:true,seq}` or
`{seq,width,height,png_base64}` (poll about 14 times a second), `session_input {events[]}` with events
`{kind:"key",code,down}` (libretro `RETROK_*` code), `{kind:"mouse_move",dx,dy}`, `{kind:"mouse_button",button 0-2,down}`,
`{kind:"joypad",port,id,down}`. Settings: `embedded_set_core {path}`, `run_mode_set {mode}`; `app_info` reports
`embedded_core` and `run_mode`. Differences from `process` mode, all returned as `unsupported` with a reason:
`session_insert`/`session_eject` work for **DF0 only** and refuse untouched originals (no write-protect switch),
`session_drives` marks DF1-DF3 `swappable:false` and has no motor/track read-back (`live_state:false`),
`session_control` has `pause resume reset_soft reset_hard` (both resets are the core's one reset) but not fullscreen,
mouse grab, mute or volume, `session_copy_drive` is unavailable, and `session_save_state`/`session_load_state` are
refused for machines with hard disks (the core crashes restoring them). States are written as `<name>.retrostate`
(the core's own format, not Amiberry's `.uss`).

`session_*` control commands return `unsupported` on builds without a control channel (official
Windows builds of Amiberry: see ADR-0001). The UI must then explain and fall back to "restart to apply".

## Local web mode only
`fs_list {path?}` → `{path, parent, home, roots, entries[{name,is_dir,size}], truncated}`: folder listing for the in-app file browser (names and sizes only).

## Jobs
`job_get {id}` → `JobView`, `jobs_list`, `job_cancel {id}`.
