# Release-readiness report

Date: 2026-10-13 · Branch `claude/upbeat-dirac-0mmphw` · Engine: Amiberry 8.4.0 · Written by the engineers who
ran the tests; nothing below is invented. **Verdict: NOT ready for a public Windows release.** A working,
well-tested foundation exists; the items in "Blocked / not done" must be closed first.

## Run it in your browser (local)

`scripts/tilt-local.sh` serves the same UI and backend to your normal browser on `127.0.0.1` only, with a per-run token
(`user-guide/run-in-browser.md`). Verified here by running the script as a user would and by e2e. The public Vercel page has no backend.

## What was run (all in a Linux container with Xvfb; no Windows machine, no authentic ROMs)

| Suite | Result |
|---|---|
| `cargo test --workspace` (core + service + CLI + libretro host) | **163 passed**, 0 failed |
| Real-engine Rust e2e (`engine_e2e`, `engine_service`) with live Amiberry 8.4.0 + AROS | **2 passed** (≈14 s each) |
| Embedded-mode Rust e2e (`core_e2e`, `embedded_service`) with the real **libretro core** 8.4.0 + AROS, no display | **2 passed** (pointer injection moves the guest pointer; pause, reset, state, DF0 swap, restart; service-level lifecycle twice in one process) |
| Engine capability matrix (`amiga-studio-cli engine-matrix`) | **44 / 44 configurations accepted** with no engine corrections |
| UI unit tests (vitest) | **37 passed** |
| Browser e2e: real UI + real backend + Chromium | **86 passed**, 0 failed, 0 retries (includes **1 live-emulator test**, **1 embedded-machine test** and **6 Pinball Arcade tests**, one of them against a real MAME 0.264 (libretro core inside the app) driving real Amiberry/AROS through the UI, and 3 tests of the local-browser mode: token/Host/Origin protection, strict cookie, in-app file browser) |
| `cargo clippy -D warnings`, `cargo fmt --check`, `tsc`, `eslint --max-warnings 0` | clean |
| `cargo deny check licenses bans sources` (both Cargo workspaces) | ok |
| Tauri 2 shell: `cargo build --release` on Linux, launched under Xvfb, UI loaded data over the real IPC | works (`compatibility/evidence/desktop-shell-linux-webkitgtk.png`) |
| Proprietary-media guard | passes; trips on a ROM-shaped file (self-tested) |

Evidence images: `compatibility/evidence/` (AROS boot logo, AROS Workbench on an A1200/AGA configuration, the TiLT UI
running a live session, and `embedded-mode-inside-tilt-linux.png`: the machine drawn inside the TiLT window by the libretro core).

## Pinball Arcade: what is real

| Claim | Status |
|---|---|
| Works without Amiberry | ✅ verified with no Amiga engine installed (rooms, scan, launch). The Amiga and Pinball code paths share nothing. |
| Shows something with no backend (static web page) | ✅ the Rooms render from a built-in preview catalogue, every action disabled and labelled "Preview"; deep links explain. A test fails if the catalogue drifts from the backend's. |
| Finds MAME / Visual Pinball / PinMAME / PCSX2 / jzIntv | 🟡 by name in the program path and usual folders. **MAME is verified by running `mame -version`** (real MAME 0.264 found at `/usr/games`); the others are found by name and never run. Not run on Windows or macOS. |
| Pinball ROM library | ✅ verified byte copies, structural zip checks, remove deletes only the library copy. **Whether a set is right is decided by MAME** (`-verifyroms`, `-listxml`), tested against real MAME 0.264: synthetic zips named after a real pinball machine (`bttf_a20`) are reported *wrong* with the real title "Back to the Future - The Pinball (2.0)", and an invented name is reported unknown. |
| A **real** pinball ROM set verified as Good | ⛔ **not done**: no authentic ROM is available to this project. The "good" path is tested only with a stand-in MAME script. |
| Playing a table | 🟡 launches whatever MAME/VPX/PinMAME you configure. `-play <table>` for Visual Pinball and PinMAME's arguments are **unverified** (the hints say so). Nothing was played here. |
| TiLT's own pinball engine | ⛔ the C++ engine in this repository is a prototype with stubbed features (`AUDIT_REPORT.md`); it cannot play tables, and the "TiLT Pinball" card says so. |
| PinMAME ROM set names with upper case or dashes | refused with advice to rename (MAME set names are lower case letters, digits, underscores). |

## Windows run-time control: what was attempted and what is true now

New this round: `crates/amiga-retro`, a minimal libretro frontend that hosts the Amiberry **libretro core** in-process
(ADR-0001, option D), plus a second session backend and UI ("Inside TiLT"). Measured on **Linux** against the
checksum-verified 8.4.0 core:

| Windows gap (before) | With the libretro core |
|---|---|
| no pause / resume | ✅ works |
| no reset | ✅ works (one reset: equivalent to a hard reset) |
| no screenshots | ✅ works (and a live in-window picture, about 14 per second) |
| no disk hot-swap | 🟡 **DF0 only** (core limit); DF1-DF3 fixed at start; originals refused (no write-protect switch) |
| no save states | 🟡 floppy-only machines. **With an IDE hard disk the core segfaults on restore**, so these are refused |
| no volume / mute | ⛔ not applicable: **no sound output at all yet** (the core produces samples, nothing plays them) |
| no embedded display | ✅ drawn in the Emulator screen, with keyboard (accepted; guest effect unverified) and mouse (verified) |
| no joystick / full screen | ⛔ not provided |
| no clean quit | ⛔ stop = unload the core; the guest is not asked to shut down. HDF bookkeeping reports a clean stop |
| crash isolation | ⛔ lost: a crash inside the core closes the app (the restore crash above proves this is real) |

**Not verified on Windows.** The Windows DLL was checksum-matched but never loaded; this whole mode is Linux-measured.
The default remains the separate-process mode. Full parity would still need option C (an `AF_UNIX` patch to the
Windows build) or a helper process hosting the core.

## Completion criteria from the brief

| # | Criterion | Status |
|---|---|---|
| 1 | An actual emulator boots using user-supplied Kickstart ROMs | 🟡 A real emulator boots from ROMs **imported through the app**, but only the open-source **AROS** ROM was available. **Authentic Kickstart 1.3/2.x/3.1 not tested.** |
| 2 | Workbench 2.1 and 3.1 work | ⛔ **Not tested** (no Workbench media). Set analysis/revision check is tested on synthetic disks only. |
| 3 | 68020/030/040 profiles function as documented | 🟡 Accepted by the real engine for every CPU incl. EC variants and JIT paths; AGA (68EC020) machine boots. 030/040 profiles not booted; no CPU-ID tool run. |
| 4 | OCS, ECS, AGA genuinely emulated | 🟡 The engine emulates them; we verified AGA boot graphics (AROS) and that OCS/ECS configs are accepted. No OCS/ECS visual test. |
| 5 | All four floppy slots work | 🟡 DF0/DF1 hot-swap verified live; DF2/DF3 verified via config and UI logic, not live. |
| 6 | ADF mounted, copied, exported | ✅ import/export/copy byte-exact (automated); mounted live in the emulator (DF0/DF1). |
| 7 | DMS converted and verified | ✅ synthetic NOCOMP archive plus a **real public-domain HEAVY2 archive matching the reference xDMS SHA-256** (optional test via `DMS_FIXTURE`; run once here, not part of default CI). QUICK/MEDIUM/DEEP lack real-world fixtures (upstream caveat). |
| 8 | XCOPY-style operations produce genuine copied media | ✅ host-side and DF0→DF1 through a running emulator (byte-exact, verified). Amiga-side XCOPY program: machine is prepared; **not run** (no program). |
| 9 | The user's 500 MB HDF imported and retained safely | 🟡 Logic and safety tested on synthetic RDB images (≈4–20 MB). **A real 500 MB image was not available**; import time, disk-space check and cancel behaviour at that size are unmeasured. |
| 10 | HDF changes persist across restarts | 🟡 Persistence of *our* bookkeeping and file state across app restarts is tested. A **guest write inside a real session** (e.g. creating a file in AmigaDOS) was not automated or run. |
| 11 | Originals never silently destroyed | ✅ tested for ROM/ADF/DMS/HDF (hash and mtime unchanged; pristine files read-only; overwrite requires consent and makes a backup). |
| 12 | Windows app installs and runs without a dev environment | ⛔ **Not built or run.** The workflow exists but has never executed; Windows is untested. |
| 13 | Interface polished, legible, intuitive | 🟡 Designed and reviewed by screenshot (dark/light, 1360 and 900 px). No user testing, no real high-DPI/screen-reader pass. |
| 14 | Third-party licensing obligations addressed | 🟡 Documented (`licensing.md`), checked by `cargo deny`; the installer's notices/source-offer files are specified in the workflow but **not yet generated or reviewed by counsel**. |
| 15 | Automated and manual tests pass | Automated: ✅ (above). Manual plan written, **0 rows executed**. |

## Blocked / not done (in priority order)

1. **Windows run-time control (🟡 partly closed, unproven on Windows).** Official Windows Amiberry builds have no
   control socket (verified in source and in the shipped binary). The in-process libretro mode above restores pause,
   reset, screenshots, DF0 swap and floppy-machine states, but **only Linux was run**; DF1-DF3 swap, sound, joystick,
   states with hard disks and crash isolation are missing. Prototype both modes on Windows (ADR-0001 Phase 2 gate).
   Own-window mode on Windows is unchanged: start/stop only.
2. **Embedded emulator display (🟡 available in the libretro mode only).** In that mode the picture is drawn in the app
   (polled PNG frames, about 14 per second, no sound). The default own-window mode still shows a 1.5 s preview image.
3. **Windows packaging never executed**: installer, portable zip, WebView2, engine bundling, SignPath/Authenticode.
   Releases would be **unsigned** unless credentials are supplied (the workflow says so and does not pretend).
4. **Authentic-media validation** (Kickstart, Workbench 2.1/3.1, 500 MB HDF, XCOPY): the owner must run
   `compatibility/test-plan.md`.
5. **GitHub Actions workflows were written but have not been observed running.** A Vercel preview exists for the branch;
   it only hosts the static "web preview" page (the app needs its native backend; use `tilt-local` instead).
6. Not implemented: keyboard-map editor, gamepad profile UI, 68060, NTSC/audio-quality evaluation, DrawBridge/real
   floppy hardware, Amiga-side disk-copy automation, moving existing data when the storage location changes
   (the location can be changed; data is not moved), live write-protect toggle on a running disk (the UI
   ejects and re-inserts), fullscreen/mouse-capture state read-back.
7. Known limits: free space *inside* an Amiga volume is not measured; Workbench revision detection is a version-string
   scan, not a filesystem read; ADF cannot preserve copy protection; save states are emulator memory only (the UI says so).

## Honest notes on test evidence

* Two floppy-UI tests and three emulator-UI tests use a **stand-in engine** that speaks Amiberry's protocol (fast,
  deterministic); the **live** UI test and both Rust e2e tests use the real emulator. The stand-in tests prove the UI
  and supervisor behave correctly against the protocol, not that Amiberry does.
* The e2e harness retries a failed test once and prints it; the final run had zero retries.
* Fixtures are synthetic; the only real ROM is AROS (open source), referenced by path, never committed.
