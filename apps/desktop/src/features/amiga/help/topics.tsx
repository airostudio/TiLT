import type { ReactNode } from 'react'

export interface Topic {
  id: string
  title: string
  body: ReactNode
}

const L = ({ to, children }: { to: string; children: ReactNode }) => <a href={`#/amiga/${to}`}>{children}</a>

export const TOPICS: Topic[] = [
  {
    id: 'rom',
    title: 'Import a Kickstart ROM',
    body: (
      <>
        <p>The Kickstart ROM is the Amiga's built-in system software. An Amiga cannot start without one, and Amiga Studio does not include any, so you need a ROM file you are licensed to use (for example a dump from your own Amiga).</p>
        <ol>
          <li>
            Open the <L to="roms">ROM Library</L> and add the file (drag it in, or choose it).
          </li>
          <li>The version is read from inside the file, so the name does not matter. The library tells you which machines it suits and whether it works with the AGA chipset.</li>
          <li>
            Open <L to="machines">My Amigas</L>, edit a machine and pick the ROM under Kickstart. Machines and ROMs that do not belong together are flagged before you can save.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: 'workbench',
    title: 'Set up Workbench',
    body: (
      <>
        <p>Workbench is the Amiga desktop. It comes on a set of floppy disks you must supply yourself.</p>
        <ol>
          <li>
            Import all of the disks (ADF or DMS files) into the <L to="disks">Disk Library</L>.
          </li>
          <li>The Workbench tools there check which disk is which, tell you if one is missing or duplicated, and can prepare a machine for installing onto a hard disk.</li>
          <li>
            Insert the install disk in DF0 in <L to="floppies">Floppy Drives</L>, start the machine and follow the Amiga's installer.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: 'floppies',
    title: 'Insert floppy disks',
    body: (
      <>
        <p>
          Put disks in the drives from <L to="floppies">Floppy Drives</L> before you start, or from the <L to="emulator">Emulator</L> screen while the machine runs (when your emulator build allows live control).
        </p>
        <p>Your original disk images are never changed. They are inserted write protected; make a working copy if you want to save onto a disk. A disk can only be in one drive at a time.</p>
      </>
    ),
  },
  {
    id: 'hdf',
    title: 'Import your hard disk file (HDF) safely',
    body: (
      <>
        <ol>
          <li>
            In <L to="harddrives">Hard Drives</L>, choose your .hdf file. TiLT first shows what is in it and how much space the import needs, before copying anything.
          </li>
          <li>Importing makes a managed copy. Your original file is only read, never written.</li>
          <li>Attach the imported disk to a machine in My Amigas (or from Hard Drives). A machine only writes to the managed working copy.</li>
        </ol>
        <p>Free space inside an Amiga disk cannot be measured from outside, because only the Amiga knows its filesystem.</p>
      </>
    ),
  },
  {
    id: 'backups',
    title: 'Backups and snapshots',
    body: (
      <>
        <p>Before a machine starts with a hard disk attached, TiLT makes an automatic safety backup. You can add your own backups and snapshots at any time from Hard Drives, and restore one later. Restoring keeps the disk's current state as a "before restore" backup, so it can be undone.</p>
        <p>
          Disks that a running machine uses are locked: back them up after you power the machine off. <strong>Saved states in the Emulator capture memory only, not disks.</strong> Take a hard disk snapshot as well if you want to be able to go back to both.
        </p>
      </>
    ),
  },
  {
    id: 'copy',
    title: 'Copy disks',
    body: (
      <>
        <p>
          <L to="tools">XCOPY / Disk Tools</L> duplicates floppy disks by copying disk image files on your computer, then checks the copy against the original. It never overwrites an untouched original. It is TiLT's own tool; the Amiga program called XCOPY is not included.
        </p>
        <p>
          <strong>Copy protection:</strong> an ADF file records standard disk data only. Disks that rely on copy protection or non-standard tracks cannot be fully preserved in an ADF, so copies of them may not start.
        </p>
      </>
    ),
  },
  {
    id: 'presets',
    title: "Why presets aren't named boards",
    body: (
      <>
        <p>
          Presets such as "A1200 with 68030 accelerator" are <strong>generic emulated configurations</strong>: a processor, a speed and an amount of memory. They are not copies of any particular physical accelerator or expansion board, and TiLT does not emulate named boards or their quirks. Software that needs a specific board's features may not work.
        </p>
        <p>The editor only accepts combinations the real chips allow. For example the 68EC040 has no FPU and no MMU, so TiLT explains the problem and will not save it.</p>
      </>
    ),
  },
  {
    id: 'modes',
    title: 'Compatibility and Performance modes',
    body: (
      <>
        <p>
          <strong>Compatibility</strong> emulates the processor and chips with cycle-exact timing, as the real machine did. It gives the best fidelity and is the right choice for games, demos and anything timing-sensitive.
        </p>
        <p>
          <strong>Performance</strong> is faster but not cycle-exact. It uses the JIT (a speed-up that translates the processor's code) where that is valid: a 68020 or better, without the MMU. Timing-sensitive software, such as some games and demos, may misbehave in this mode. If something acts strangely, switch back to Compatibility.
        </p>
      </>
    ),
  },
  {
    id: 'mouse',
    title: 'Mouse capture, full screen and shortcuts',
    body: (
      <>
        <p>The Amiga runs in its own emulator window. When you click inside it, the emulator can capture the mouse so the Amiga's pointer and yours are the same thing.</p>
        <ul>
          <li>
            To get the mouse back, press <span className="kbd">Ctrl</span> + <span className="kbd">Alt</span> together in the emulator window. This is the emulator's default.
          </li>
          <li>
            <span className="kbd">F12</span> opens the emulator's own settings menu.
          </li>
          <li>
            The <L to="emulator">Emulator</L> screen has buttons to toggle mouse capture and full screen, which always work when live control is available.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'limits',
    title: 'What is not included or not supported',
    body: (
      <>
        <ul>
          <li>
            <strong>No Amiga software is bundled:</strong> no Kickstart ROMs, no Workbench disks, no XCOPY, no games. You bring your own.
          </li>
          <li>
            <strong>ADF cannot preserve copy protection</strong> or non-standard tracks.
          </li>
          <li>
            <strong>The emulator runs in its own window.</strong> It is not embedded in the TiLT window, and the preview on the Emulator screen is a periodic picture, not live video.
          </li>
          <li>
            <strong>Windows builds cannot be controlled while a machine runs.</strong> The official Windows Amiberry builds have no control channel, so pause, disk changes, previews and saved states are unavailable there. You can still start a machine, use the emulator's own menu (F12), and stop it; stopping from TiLT is then a forced stop, so quit from inside the emulator when you can. Changes you make in TiLT apply the next time the machine starts.
          </li>
          <li>Named accelerator boards, networking, and other hardware not listed in the machine editor are not emulated by TiLT.</li>
        </ul>
      </>
    ),
  },
]
