# Amiga Studio architecture

```
┌────────────────────────────── TiLT desktop (Tauri 2) ───────────────────────────────┐
│  Web view: React + TypeScript UI                                                     │
│    Rooms (Home Arcade, Pinball Arcade) · Amiga Studio (10 screens)                   │
│                      │  invoke('amiga', {cmd, args})   — the ONLY exposed command    │
│  Rust shell ─────────▼──────────────────────────────────────────────────────────────│
│    amiga-service  — allow-listed dispatch(cmd,args), jobs, session supervision,       │
│                     rooms/launchers                                                   │
│       │                                                                               │
│    amiga-core     — ROM/ADF/DMS/HDF analysis · library (SQLite + managed files) ·     │
│                     machine profiles & validation · Amiberry config generation ·     │
│                     control-socket client · XCOPY-style copy                          │
└───────┬──────────────────────────────────────────────────────────────────────────────┘
        │ child process, own window            ┌─ Linux/macOS: control socket (Unix domain)
        ▼                                      │  Windows (official build): none (ADR-0001)
   Amiberry 8.4.0 (GPL-3.0, WinUAE core) ◄─────┘
```

## Repository map

| Path | Purpose |
|---|---|
| `crates/amiga-core` | All Amiga logic. Pure Rust, no UI, no Tauri. 145 tests + env-gated real-engine tests. |
| `crates/amiga-service` | One entry point `Service::dispatch(cmd, args)`; background jobs; session supervisor; Rooms/launcher registry. |
| `crates/amiga-retro` | A minimal libretro frontend: loads the Amiberry libretro core in-process and exposes frames, input, pause/reset, states and DF0 swap. One core per process; contains the only `unsafe` FFI in the workspace. |
| `crates/amiga-cli` | `amiga-studio-cli`: inspect ROM/ADF/DMS/HDF, probe the engine, generate the engine matrix. |
| `crates/tilt-local` | Run the UI in a normal browser on the same machine: 127.0.0.1-only server, per-run token + Host/Origin checks, in-app file browser. Also the harness for browser e2e. Not a hosted service. |
| `apps/desktop` | React/Vite UI (`src`), Playwright-style e2e (`e2e`), Tauri shell (`src-tauri`, its own workspace). |
| `docs/amiga-studio` | ADRs, licensing, plan, readiness report, compatibility evidence, guides. |
| `scripts` | Guards and packaging helpers. |

The brief's suggested layout (`packages/*`, `native/*`) maps onto this as: *emulator-adapter* =
`amiga-core::{emu_config, engine, ipc}`, *hardware-profiles* = `amiga-core::profiles`, *disk-image-tools* =
`adf/dms/hdf/xcopy`, *media-validation* = `rom/adf/hdf/fsutil`, *common-types* = `apps/desktop/src/api/types.ts`.
Logic lives in Rust (not TypeScript) because it handles 500 MB images, needs real locking and fsync, and
must be shared by the app, the CLI and CI.

## Storage layout (user-relocatable)

```
AmigaStudio/            Windows %LOCALAPPDATA%\AmigaStudio · macOS ~/Library/Application Support · Linux $XDG_DATA_HOME
  ROMs/  Workbench/  Floppies/  DMS/  HardDrives/<id>/{working.hdf,pristine.hdf,.lock}
  Profiles/  Snapshots/  Backups/  Logs/
  .partial/   staging for atomic writes (same volume ⇒ atomic rename)
  runtime/    generated emulator configs, screenshots
  library.db  SQLite (WAL, synchronous=FULL): roms, media, hdfs, snapshots, profiles, queues,
              workbench_sets, sessions, operations, journal, settings
```
The location is changed by a pointer file in the app config dir (`storage-root.txt`); a `portable.flag`
next to the executable selects `./AmigaStudio`. Existing data is never moved or deleted by a change.

## Data-integrity rules (enforced in code, covered by tests)

1. **Originals are only read.** Imports hash while copying, fsync, re-read and verify, then atomically
   rename into place (`fsutil::copy_atomic`). Failure or cancel removes the partial file.
2. **The emulator only sees managed copies.** HDF: `working.hdf` (+ optional read-only `pristine.hdf`).
   Floppies: untouched originals are read-only on disk *and* inserted write-protected; writing requires
   an explicit working copy.
3. **One writer.** Every HDF has an exclusive advisory lock held for the whole session and for every
   backup/restore/export/delete. A second emulator, or a backup during a session, is refused (`locked`).
4. **Backups before change.** A writable session first makes an automatic backup unless a restore point
   (pristine copy or snapshot) already covers the current state; auto-backups are pruned, user snapshots
   never are.
5. **Restore is journalled.** Stage + verify the snapshot, then swap with the old image preserved as a
   "before restore" backup. An interrupted swap is rolled forward or back on next start.
6. **Identity by file, not name.** XCOPY-style duplication compares file identity (inode / file id), so
   hard links, symlinks and aliases cannot defeat the same-file check.
7. **Untrusted names never become paths.** Managed files are named by random id; display names live in
   the database. Config values and control-socket arguments reject control characters (no key injection).
8. **Hostile archives.** DMS input and output are size-capped; decoding is panic-guarded; results must be
   a standard ADF size.
9. **Least privilege UI.** The web view can call exactly one Tauri command, which matches an allow-list.
   External-emulator launches use argv arrays (no shell) and must stay inside the configured game folder.

## Run-time control and honesty

`engine::probe` reports `runtime_control`. Where it is false, `session_*` control commands return
`unsupported` and the UI explains it. Preview screenshots are labelled as previews. A "forced" stop is
reported as such and flagged on the disk (`unclean_shutdown`).
