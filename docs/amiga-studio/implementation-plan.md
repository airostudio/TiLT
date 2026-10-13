# Implementation plan and status

Legend: ✅ done and verified here · 🟡 partly done (see note) · ⛔ blocked (reason) · ⬜ not started.
"Verified" means a test in this repository exercised it; see `RELEASE_READINESS.md` for evidence and for
what has **not** been verified (notably anything on real Windows hardware or with authentic ROMs).

## Phase 1: architecture and emulator validation
| Item | Status | Notes |
|---|---|---|
| Evaluate engines, licences, control paths | ✅ | ADR-0001, `licensing.md` |
| Confirm Windows build, CPU range, chipsets, 4 drives, HDF | 🟡 | Windows build exists and is checksum-verified; CPU/chipset acceptance verified through the engine (`engine-capability-matrix.md`); AGA boot verified on Linux with AROS. Windows execution not tested here. 68060 not tested. |
| Working emulator smoke test | ✅ | AROS boots under Amiberry 8.4.0 (`evidence/`), automated in `engine_e2e.rs` |

## Phase 2: native emulator integration
| Start/stop real emulator, controls, ROM loading | ✅ (Linux/macOS) / 🟡 (Windows: start/stop only in own-window mode; pause/reset/DF0/screenshot via the libretro mode, untested there) | ADR-0001 consequences and update |
| Display embedded in app window | 🟡 | Own-window mode: engine opens its own window. **Inside-TiLT mode** (`amiga-retro`, libretro core, ADR-0001 option D): picture, mouse and keyboard in the app, Linux-measured, no sound/joystick, not run on Windows |
| Keyboard/mouse/audio routing | 🟡 | Handled by the engine's own window (SDL); mouse grab toggle via control socket. Gamepad mapping not verified |
| Reliable cleanup | ✅ | clean quit, forced stop reporting, no orphan process (`Drop`), single-instance guard |

## Phase 3: media import and persistence
| ROM library (import copy/reference, hash, duplicates, relink, associate) | ✅ | |
| ADF / DMS library, working copies, export | ✅ | DMS verified byte-exact vs reference xDMS on a public-domain archive |
| HDF import with managed working copy, locks, backups, snapshots, restore, export | ✅ | Guest write persistence through a real emulator session is **not** automated (see readiness) |
| SQLite metadata, storage manager, safe deletion with reference checks | ✅ | |

## Phase 4: machine profiles and accelerators
| Profiles A500…A4000, presets incl. 68020/68030 accelerators, custom, validation | ✅ | Presets are generic emulated configurations, not named boards |
| Validate against engine capabilities | ✅ | engine `--dump-config` preflight + generated matrix |

## Phase 5: floppies and disk tools
| Four-drive UI, runtime insert/eject, write protection | ✅ (Linux/macOS) | Windows: profile-time only |
| XCOPY-style host copy with verify, backup, overwrite protection | ✅ | |
| DF0→DFn copy while running | ✅ (Linux/macOS) | verified byte-exact in `engine_service.rs` |
| Real Amiga-side XCOPY | 🟡 | App builds the 4-drive "disk copy station" machine; the copy program is user-supplied; not bundled; not tested (no program available) |

## Phase 6: hard disk and Workbench
| Import 500 MB HDF safely | 🟡 | Logic tested on synthetic RDB images (incl. cancel, locks, space check). A real 500 MB image was not available; performance on it not measured |
| Workbench set analysis (2.1/3.1, revision check, missing/duplicate disks) | ✅ synthetic / ⬜ authentic | revision detection is a version-string scan, labelled as such |
| Guided Workbench install | 🟡 | App prepares the install machine; the install itself is manual inside the Amiga |
| Boot an authentic Workbench 2.1/3.1 | ⛔ | proprietary media not available to this project: must be verified by the owner (test plan T-WB-*) |

## Phase 7: polish
| Dark/light theme, accessibility basics, help, diagnostics | ✅ | automated e2e + screenshots |
| Keyboard map editor, joystick/gamepad profiles | ⬜ | profile has port assignments only |
| Audio latency/sample-rate settings | 🟡 | passed to the engine; audio quality not evaluated |

## Phase 8: production hardening
| CI (lint, types, tests, e2e, licence checks) | 🟡 | workflows written; **first run on GitHub not yet observed** |
| Windows NSIS installer + portable zip | 🟡 | built and structurally verified (cross-compiled on Linux, `scripts/package-windows.sh`); never executed on Windows; unsigned |
| Code signing | ⬜ | only when credentials exist; releases are labelled unsigned otherwise |
| Release-readiness report | ✅ | `RELEASE_READINESS.md` (candid) |
