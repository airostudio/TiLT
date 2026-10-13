# ADR-0001: Emulator engine and integration model

* Status: **accepted** (2026-10-13), to be revisited at the Phase 2 gate below
* Context: Amiga Studio is the first built-in system in the TiLT "Home Arcade". It must run real
  Amiga hardware configurations (68000 to 68040, OCS/ECS/AGA) with user-supplied Kickstart, Workbench
  and hard disk images, on Windows 10/11 x64 first, with a path to macOS/Linux.

## Decision

1. **Engine: Amiberry 8.4.0** (WinUAE-derived, GPL-3.0). We do not write a CPU/chipset core.
2. **Integration model (today): a separate native process.** Amiga Studio generates a `.uae`
   configuration from a validated machine profile, starts `amiberry -G -f <config>`, supervises the
   process, and controls it at run time through Amiberry's control socket **where the build has one**
   (Linux, macOS). Amiberry opens its own SDL window; the authentic Amiga display is **not** embedded
   in the TiLT window. The Emulator screen shows a periodically refreshed *preview image* and says so.
3. **The configuration is verified by the engine itself.** Before every start (and in CI) the generated
   config is fed to `amiberry --dump-config`; any value the engine changes is reported to the user.
   `amiga-studio-cli engine-matrix` renders the result into `compatibility/engine-capability-matrix.md`.

4. **Second run mode (added, see "Update: option D" below): the Amiberry libretro core hosted in-process
   by `crates/amiga-retro`.** It gives run-time control, an in-window display and input on every platform,
   including Windows, at the cost of the limits listed below. It is opt-in; the separate-process mode
   stays the default because it is the full emulator (sound, joystick, full screen, DF0-DF3 hot swap on
   Linux/macOS).

## What was verified (and how)

| Claim | Evidence |
|---|---|
| Amiberry 8.4.0 ships Windows x64 (and ARM64) builds, signed through SignPath | release page + `SHA256SUMS`; we downloaded `amiberry-v8.4.0-windows-x64-portable.zip` and matched its SHA-256 (`c615e921…d0f1`) |
| Windows builds have **no** control channel | `CMakeLists.txt` forces `USE_IPC_SOCKET=OFF` for `WIN32` ("Unix sockets not available on Windows"); `strings` on the shipped `Amiberry.exe` finds no `amiberry.sock` / `INSERTFLOPPY` / IPC strings |
| Linux build exposes a control socket and it works | `docs/ipc.md` upstream; our end-to-end tests drive `PING`, `GET_*`, `INSERTFLOPPY`, `EJECT_FLOPPY`, `DISK_WRITE_PROTECT`, `PAUSE/RESUME`, `RESET`, `SET_VOLUME`, `SCREENSHOT`, `SAVESTATE`, `QUIT` against a live Amiberry 8.4.0 (see `crates/amiga-core/tests/engine_e2e.rs`, `crates/amiga-service/tests/engine_service.rs`) |
| 68000, 68010, 68020, 68EC020, 68030, 68EC030, 68040, 68EC040 configurations are accepted without engine corrections, with and without JIT where valid | `compatibility/engine-capability-matrix.md` (generated, 44/44 accepted) |
| AGA boots a real ROM | open-source AROS ROM (shipped with Amiberry) boots an A1200/AGA configuration to its Workbench screen under Xvfb: `compatibility/evidence/aros-a1200-boot.png` |
| `SET_VOLUME` is an attenuation | source: `sound_volume_master` is used as `(100 - v)/100` gain; our client inverts it (unit-tested) |

**Not verified here:** anything on real Windows hardware, 68060, boot of authentic Kickstart/Workbench
(no proprietary files available to this project), cycle accuracy, audio quality, gamepad/joystick routing,
NTSC timing, JIT *performance*. These are tracked in `RELEASE_READINESS.md` and `compatibility/test-plan.md`.

## Alternatives considered

| Option | Verdict |
|---|---|
| **WinUAE** | The reference core and Windows-only. No external control API and no macOS/Linux path. Amiberry carries the same core and builds everywhere. |
| **FS-UAE / PUAE** | Capable but less actively maintained; no control API on Windows either. Not evaluated hands-on. |
| **vAmiga** | Excellent cycle-exact OCS/ECS, but per its documentation it emulates 68000 machines without AGA, so it cannot cover A1200/A4000/accelerators. *Not re-verified in this repo.* |
| **WebAssembly cores in the web view** | Would embed the display trivially but cannot meet 68040/AGA/accuracy goals and would blur the UI/emulator split. |
| **Write our own core** | Out of scope and strictly worse than a proven core. |

Integration alternatives:

| Option | Verdict |
|---|---|
| **A. Link Amiberry as a library** | Amiberry is an application, not a library. |
| **B. Separate process + config + control socket** | **Chosen.** Works today, keeps GPL boundaries clean, isolates crashes, trivially upgradable. Windows lacks run-time control. |
| **C. Patch Amiberry to enable `AF_UNIX` on Windows** | Windows 10 1803+ supports `AF_UNIX` sockets, so the upstream protocol could be enabled with a small patch (CMake flag + path handling). Needs a Windows build and a maintained fork; fork source must be published under GPL-3.0. **Candidate for closing the Windows gap.** |
| **D. Amiberry libretro core (`amiberry-libretro-win-x86_64.dll`, published on every release) hosted by a small libretro frontend** | Would give an *embedded* authentic display (frames come to us), audio/input callbacks, a standard disk-control interface for floppy swapping and `retro_serialize` save states, on Windows, without patching Amiberry. Larger engineering item (video/audio/input frontend). Core-option coverage for 68040/AGA/hardfiles must be verified. **Candidate for the embedded-display requirement.** |
| **E. Re-parent Amiberry's SDL window into ours (Win32 `SetParent`)** | Brittle (focus, DPI, input capture, full-screen). Rejected. |

## Update: option D implemented and measured on Linux (2026-10-13)

`crates/amiga-retro` is a minimal libretro **frontend** (about 750 lines of Rust, `libloading` + `png`). It
loads `amiberry-libretro-<os>-<arch>.{so,dll,dylib}` (a release asset, SHA-256-checked against the
release `SHA256SUMS`), runs `retro_run` on a dedicated thread at the core's frame rate, and exposes video
frames (XRGB8888 / RGB565 / 0RGB1555 converted to RGBA), audio batches, keyboard/mouse/joypad injection,
pause, reset, `retro_serialize`/`unserialize`, the disk-control interface and the core's own on-screen
messages. `amiga-service` exposes it as a second session backend (`mode: "embedded"`), and the UI draws the
frames in the Emulator screen.

**Measured against the real Linux core 8.4.0 with the AROS ROM** (`crates/amiga-retro/tests/core_e2e.rs`,
`crates/amiga-service/tests/embedded_service.rs`, `apps/desktop/e2e/embedded.spec.mjs`):

| What | Result |
|---|---|
| A generated `.uae` (A1200/AGA, ROMs, hard disk) is accepted as libretro content | works; AROS boots, 756x576 RGBA frames at 48.7 fps measured against 50 target |
| Mouse injection | works: 10 x (8, 6) host units moved the guest's pointer from (86, 49) to about (230, 157) |
| Keyboard injection | **accepted without error; its effect inside the guest is not verified** (AROS has no text input to observe on this boot screen) |
| Pause / resume | works (frame counter stops, then resumes) |
| Reset | works (core resets and keeps drawing) |
| Save state | works (10 MiB state for an A1200) |
| **Load state** | works for a floppy-only machine; **crashes the whole process (SIGSEGV in `restore_gayle_ide`) when the machine has an IDE hard disk.** Reproduced in isolation (save alone is fine). The service therefore refuses save/load for such machines. |
| Floppy swap | `disk_control` swaps **DF0 only** (verified in the core source and live: "Disk ejected", "Disk 1: ... inserted"). DF1-DF3 are fixed at start. |
| Write-protect a disk | **not possible** through libretro, so untouched originals are refused in this mode (a working copy must be inserted) |
| Drive state read-back (motor, track, which disk) | **not available**; the UI shows only what Amiga Studio itself last inserted |
| `SET_VOLUME` / mute | not applicable; **audio is produced by the core (503 k frames in 10 s) but no sound is played yet** because the host has no audio output. The peak sample during the AROS boot is 0, so audible output was not verified either. |
| Restart | start, stop, start again in one process works (the core stays mapped; libretro cores are not designed to be unloaded) |
| Log callback | not implemented (`GET_LOG_INTERFACE` returns false): the callback is C-variadic, which stable Rust cannot define |
| One core per process | the callbacks are plain C pointers without user data, so state lives in one global; a second concurrent machine is refused |

**Robustness trade-off.** The core runs inside the Amiga Studio process. A crash in the core (the load-state
crash above is a real example) takes the app down, whereas the separate-process mode isolates it. The
better long-term shape is the same host in a small helper process (`amiga-retro-host`) streaming frames to
the UI; that is not built. Until then the UI states the trade-off, the default stays "own window", and a
hard disk is never put at risk by the guard that refuses states.

**Not verified: Windows.** Everything above ran on Linux. `amiberry-libretro-win-x86_64.dll` was downloaded
and checksum-matched but **never loaded**. The host uses only portable libretro API and `libloading`, so
it should work, but "should" is not evidence: the Phase 2 gate below still applies to Windows.

**Verdict.** Option D closes most of the Windows run-time-control gap (pause, reset, DF0 swap, screenshots,
saved states for floppy machines, an in-window display, mouse/keyboard) **without patching Amiberry**.
It does not close: DF1-DF3 hot swap, sound, joystick, states with hard disks, clean-quit semantics
beyond "unload the core" (the guest is not asked to shut down), and process isolation. Option C (patch
`AF_UNIX` into the Windows build) would give the full control set with the full emulator, but needs a
maintained fork and a Windows toolchain; it remains the candidate for full parity.

## Consequences

* **Windows today (own-window mode):** start, stop (graceful close is not possible; a stop is a forced
  termination and is reported as such, disks are flushed by Amiberry only on a clean exit), profile-time
  floppy/HDF configuration. **No** hot disk swap, pause, reset, save states, screenshots or volume from
  Amiga Studio. The UI detects this (`runtime_control = false`) and explains it; it never pretends.
  **Windows with the libretro core ("inside Amiga Studio" mode):** the controls listed in the update
  above, *untested on Windows*.
* **Linux/macOS today:** full run-time control. Used for all automated end-to-end tests.
* **Single instance:** Amiberry's socket names are global per user, so Amiga Studio refuses to start a
  second emulator while any Amiberry answers on a socket. This also protects disk images.
* **Phase 2 gate (decide before claiming Windows parity):** prototype **C** and **D** on a Windows
  machine; choose the smaller reliable one. Acceptance: hot-swap DF0–DF3, clean quit with HDF flush,
  pause/reset, save/load state, and (for D) the display inside the TiLT window at the correct aspect
  ratio on a high-DPI monitor.
* **Engine upgrades** are a re-run of the capability matrix plus the end-to-end tests.
