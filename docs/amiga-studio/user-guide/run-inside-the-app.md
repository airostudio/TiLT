# Running a machine inside Amiga Studio

By default a machine opens in **Amiberry's own window**. That is the full emulator, with sound and joystick, but on
Windows it cannot be controlled from Amiga Studio (no pause, no disk swap, no screenshots).

There is a second way: Amiga Studio can load the **Amiberry libretro core** itself and draw the machine in its own
window. Then the controls on the Emulator screen work on every system, including Windows.

## Turn it on

1. Download the `amiberry-libretro` file for your system from the Amiberry release page (the same version as your
   Amiberry). Put it next to the Amiberry program, or open **Settings → Emulator engine → Run machines inside Amiga
   Studio** and give its full path.
2. On the **Emulator** screen choose **Inside TiLT** under *Where should it run?* and press **Start**.

## What you get

* The Amiga screen in the Screen panel. Click it to send your keyboard and mouse to the Amiga; press **Ctrl + Alt**
  together to get them back.
* **Pause / Resume**, **Reset** (a hard reset), **screenshots**, **swap the disk in DF0:** while it runs.
* **Saved states** for machines without hard disks.

## What you do not get (be aware)

* **No sound yet.** The core produces it; Amiga Studio does not play it yet.
* **No joystick** and no full screen; the picture refreshes about 14 times a second. It is for working, not for
  timing-sensitive games.
* **Only DF0:** can be swapped while running. DF1 to DF3 are fixed when the machine starts.
* Untouched original disks cannot be inserted while running (this mode cannot write protect them): insert a working copy.
* **No saved states for machines with hard disks.** The emulator core crashes when it restores them, so Amiga Studio
  does not offer them.
* The core runs inside the Amiga Studio program. If it ever crashes, Amiga Studio closes too (your disk safety
  backups are unaffected).
* **Not yet tested on Windows.** It has been run and measured on Linux only.
