# Getting started with Amiga Studio

1. **Open TiLT → Home Arcade → Amiga Studio.** The first time, a short wizard asks for your Kickstart ROMs.
2. **Import Kickstart ROMs** you own (drag them in or paste their path). The version is read from inside
   each ROM. Choose *copy into the library* (recommended) or *use the file where it is*.
3. **Pick a machine** on the Dashboard (Classic A500, A500+, A1200 …). Machines without a ROM get the best
   matching one automatically; you can change it in *My Amigas*.
4. **Start.** The Amiga opens in its own window. Use *Emulator* for pause, reset, volume, mouse capture,
   fullscreen and power off (where your emulator build supports remote control).
5. **Floppies:** import ADF or DMS files in *Disk Library*; insert them in *Floppy Drives*. Originals are
   never changed: make a *working copy* if you want to save onto a disk.
6. **Workbench:** *Disk Library → Workbench* checks your install disks (2.1 revision 38.36, 3.1 revision
   40.42), lists anything missing, and can prepare a machine for installing onto a hard disk.
7. **Hard disk:** *Hard Drives → Import* copies your HDF into the library after checking free space. Your
   original file is only read. Back up or snapshot before experiments; restore any time.

What Amiga Studio does **not** include: Kickstart ROMs, Workbench, XCOPY or any Amiga software. ADF images
cannot preserve copy protection or non-standard tracks.

## Installing on Windows
Download `TiLT_<version>_x64-setup.exe` (or the portable zip) from the release page and compare its SHA-256 with `SHA256SUMS`.
The installer is **not signed yet**, so Windows SmartScreen will say "Windows protected your PC": choose *More info*, then
*Run anyway*, only if you downloaded it from the project's own release page. It installs for the current user (no
administrator rights), includes Amiberry (the emulator engine) and **no ROMs**: import your own Kickstart in the ROM Library.
It needs Microsoft Edge WebView2, which Windows 10/11 normally already has; if it is missing the installer fetches it.
The portable zip keeps all your data in its own folder (`portable.flag`). This Windows build has been verified only
structurally so far; it has not yet been run on a Windows machine by the project.
