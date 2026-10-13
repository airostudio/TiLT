# Pinball Arcade

The Pinball Arcade works on its own: it does **not** need the Amiga emulator. It does need the TiLT desktop app (or
`tilt-local`) running on your computer, because starting emulators and reading your ROM folders cannot be done from a web
page. Opened as a plain web page, the Rooms show a read-only preview with everything disabled.

## What is built in, and what is not

TiLT does not play pinball itself yet: the TiLT engine in this repository is a prototype. The Pinball Arcade starts the
emulators **you install**:

* **MAME Arcade**: the best-supported route. Plays pinball and arcade ROM sets.
* **Visual Pinball X** (standalone) for `.vpx` tables.
* **PinMAME** (command line) for ROM sets.
* **TiLT Pinball**: points at the TiLT executable once the engine can play tables.

## Set up in three steps

1. Open **Pinball Arcade** and press **Find installed emulators**. TiLT looks in your program path and the usual install
   folders and fills in what it finds. MAME is confirmed by actually running `mame -version`; the others are found by name.
   Anything it does not find you choose yourself on that emulator's **Set up** page (there is also a **Find it on this
   computer** button there).
2. Open **Pinball ROMs** and import the ROM sets you own: a folder of `.zip` files, or one file. The zip must be named
   after the machine in MAME's way (lower case letters, digits, underscores, for example `tz_94h.zip`); anything else is
   refused with the reason. TiLT copies the file and checks the copy; your original is only read.
3. Press **Check all with MAME**. MAME tells TiLT whether each set is right and what machine it is. Then press **Play**.

## What the statuses mean

| Status | Meaning |
|---|---|
| **Good (MAME)** | MAME checked the set's files and accepts it. |
| **Wrong or incomplete** | MAME knows the machine but the zip does not contain the right files. |
| **MAME does not know it** | No machine by that name; check the file name. |
| **Not checked** | MAME is not set up yet. TiLT never calls a set good on its own: it has no ROM database. |

## Limits

* TiLT includes **no ROMs** and never downloads any.
* Which command-line arguments Visual Pinball and PinMAME need depends on the build; the defaults are unverified, so edit
  the argument template on the system's page if a game does not start.
* Visual Pinball tables that use PinMAME read ROMs from their own folder; copy sets there if a table asks for one.
* Tested on Linux with a stand-in emulator and a real MAME 0.264 (with synthetic zips). Not yet run on Windows or macOS, and
  not yet run with an authentic pinball ROM set.
