# Manual compatibility test plan

Automated tests cover structure, safety and engine acceptance. The following need **authentic media owned by
the tester** or real hardware. Record results in `compatibility/results/YYYY-MM-DD-<tester>.md`; never commit
ROMs or disks. Mark each row Pass / Fail / Not run. *Nothing below has been run by the project yet.*

| ID | Test | Expected |
|---|---|---|
| T-ROM-1 | Import Kickstart 1.3 | detected as 1.3 (34.x), checksum valid |
| T-ROM-2 | Import Kickstart 2.04 and 2.05 | detected as 2.04 / 2.05 |
| T-ROM-3 | Import Kickstart 3.1 (40.63 and 40.68) | 40.63 non-AGA, 40.68 AGA |
| T-ROM-4 | Import a corrupt copy (flip a byte) | rejected with a readable reason |
| T-WB-1 | Boot WB 2.1 (38.36) floppy set on A500+ with KS 2.04 | Workbench appears |
| T-WB-2 | Boot WB 3.1 (40.42) on A1200 with KS 3.1 | Workbench appears |
| T-WB-3 | Run the guided Workbench install to a blank HDF | installs, reboots from HDF |
| T-HW-1 | A500/KS1.3 boots a floppy game | boots, sound and disk activity |
| T-HW-2 | A1200/030, A1200/040, A3000, A4000/040 profiles | boot; SysInfo-style tool reports expected CPU/FPU/MMU (use a tool the tester legally owns) |
| T-HW-3 | OCS/ECS/AGA graphics, copper/blitter/sprites demos | visually correct |
| T-HW-4 | PAL and NTSC | correct timing |
| T-DISK-1 | Four floppies DF0–DF3 mounted independently | each readable |
| T-DISK-2 | XCOPY (user-supplied) copying DF0→DF1 inside the Amiga | result disk boots/reads |
| T-HDF-1 | Import the owner's ~500 MB HDF | original checksum unchanged; boots if bootable |
| T-HDF-2 | Create a file inside the Amiga, power off, restart app, reopen | file persists |
| T-HDF-3 | Kill the emulator process mid-session | next start reports unclean shutdown; AmigaDOS validates; restore from backup works |
| T-WIN-1 | Install and run on Windows 10 and 11 x64 (installer and portable) | starts without a dev environment |
| T-WIN-2 | High-DPI (150%, 200%) and two monitors | UI legible; emulator window correct |
| T-WIN-3 | Mouse capture/release, fullscreen enter/leave | user can always get the mouse back (UI button; emulator key) |
| T-IN-1 | USB gamepad as joystick | works in a game |
