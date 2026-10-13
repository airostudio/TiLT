import { Badge, Banner, Card, Icon, Page } from '@/components/ui'

const shots: { file: string; title: string; text: string }[] = [
  { file: 'rooms.png', title: 'Rooms', text: 'Home Arcade and Pinball Arcade, with launchers for your own emulators.' },
  { file: 'dashboard.png', title: 'Amiga Studio dashboard', text: 'Current machine, Kickstart, drives, storage and emulator status at a glance.' },
  { file: 'machines.png', title: 'My Amigas', text: 'A500 to A4000 profiles with live validation: impossible CPU/FPU/MMU/RAM combinations are rejected.' },
  { file: 'emulator.png', title: 'Live emulator session', text: 'A real Amiberry session booting the open-source AROS ROM on an A1200 (AGA) configuration, controlled from the app.' },
  { file: 'harddrives.png', title: 'Hard Drives', text: 'Import your HDF safely: originals untouched, managed working copy, backups, snapshots, restore.' },
]

/** Shown when the page is opened in a plain browser with no TiLT backend (e.g. a web preview). */
export function OfflinePreview() {
  const local = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  return (
    <Page>
      {local && (
        <Banner tone="warning" title="Open TiLT with its private link">
          This page is served by <code>tilt-local</code> on your computer, but your browser did not present its access token. Use the full link printed in the terminal where you started it (it ends with <code>?token=…</code>).
        </Banner>
      )}
      <div className="stack">
        <div>
          <Badge tone="warning">Web preview</Badge>
          <h1 style={{ marginTop: 8 }}>TiLT is a desktop application</h1>
          <p className="muted" style={{ maxWidth: '70ch', marginTop: 6 }}>
            The arcade front end and Amiga Studio run on your computer: the emulator, your ROMs, floppies and hard disks never leave it. This web page has no backend, so nothing here is interactive.
            Below are real screenshots taken from the running application.
          </p>
        </div>
        <Banner tone="info" title="What you are looking at">
          The screenshots come from automated end-to-end tests that drive the real UI against the real backend using synthetic test media. No proprietary Amiga ROMs or Workbench disks are included in TiLT or in these images.
        </Banner>
        <div className="grid grid-2">
          {shots.map((s) => (
            <Card key={s.file} title={s.title}>
              <img src={`./preview/${s.file}`} alt={`${s.title} screen`} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)' }} loading="lazy" />
              <p className="muted small" style={{ marginTop: 8 }}>
                {s.text}
              </p>
            </Card>
          ))}
        </div>
        <Card title="Honest status">
          <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <Icon name="check" size={14} /> Verified: ROM/ADF/DMS/HDF handling, safe storage, machine profiles, XCOPY-style copying, and a real Amiberry boot of the open-source AROS ROM on Linux.
            </li>
            <li>
              <Icon name="warn" size={14} /> Not yet verified: authentic Kickstart/Workbench boots, Windows hardware, and live hot-swap/pause controls on Windows (the official Windows emulator build has no control channel).
            </li>
            <li>
              <Icon name="info" size={14} /> Details: <code>docs/amiga-studio/RELEASE_READINESS.md</code> in the repository.
            </li>
          </ul>
        </Card>
      </div>
    </Page>
  )
}
