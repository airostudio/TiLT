import { useState } from 'react'
import { Card, Icon, KV, Page, PageHeader, Tabs } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useTheme, type Theme } from '@/app/theme'
import { EmbeddedCard } from './EmbeddedCard'
import { EngineCard } from './EngineCard'
import { StorageManager } from './StorageManager'
import './settings.css'

type Tab = 'general' | 'storage' | 'engine' | 'privacy'

function Appearance() {
  const [theme, setTheme] = useTheme()
  const { info } = useBackend()
  const options: { id: Theme; label: string; icon: 'moon' | 'sun' }[] = [
    { id: 'dark', label: 'Dark', icon: 'moon' },
    { id: 'light', label: 'Light', icon: 'sun' },
  ]
  return (
    <div className="stack">
      <Card title="Appearance">
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sr-only">Theme</legend>
          <div className="st-theme" role="radiogroup" aria-label="Theme">
            {options.map((o) => (
              <label key={o.id} className={theme === o.id ? 'on' : ''}>
                <input type="radio" name="theme" value={o.id} checked={theme === o.id} onChange={() => setTheme(o.id)} />
                <Icon name={o.icon} size={16} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="st-note" style={{ marginTop: 12 }}>
          Your choice is remembered on this computer. You can also switch with the sun/moon button at the top of the window.
        </p>
      </Card>
      <Card title="About">
        <KV
          rows={[
            ['Version', info?.version ?? '-'],
            ['Platform', info ? `${info.platform} (${info.arch})` : '-'],
            ['Storage folder', <span key="r" className="st-mono">{info?.storage_root ?? '-'}</span>],
          ]}
        />
      </Card>
    </div>
  )
}

function Privacy() {
  const items: [string, string][] = [
    ['No account.', 'You never sign in, and there is nothing to register.'],
    ['No telemetry.', 'Amiga Studio does not measure or report how you use it.'],
    ['Nothing is uploaded.', 'Your ROMs, disks, hard drives, backups and settings never leave this computer.'],
    ['Everything stays local.', 'All of it is stored in the storage folder shown under Storage, and in the files you chose to import from.'],
    ['No proprietary software is included.', 'Amiga Studio does not ship Kickstart ROMs, Workbench disks, games or copy programs. You provide your own, from software you are entitled to use.'],
    ['Your originals are respected.', 'Files you import are only read. Amiga Studio works on its own managed copies.'],
  ]
  return (
    <Card title="Privacy and data">
      <ul className="st-privacy" data-testid="privacy">
        {items.map(([h, t]) => (
          <li key={h}>
            <Icon name="check" size={18} />
            <span>
              <strong>{h}</strong> {t}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('general')
  return (
    <Page>
      <PageHeader title="Settings" subtitle="How Amiga Studio looks, where it keeps your files, and which emulator engine it uses." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'storage', label: 'Storage' },
          { id: 'engine', label: 'Emulator engine' },
          { id: 'privacy', label: 'Privacy and data' },
        ]}
      />
      {tab === 'general' && <Appearance />}
      {tab === 'storage' && <StorageManager />}
      {tab === 'engine' && (
        <div className="stack">
          <EngineCard />
          <EmbeddedCard />
        </div>
      )}
      {tab === 'privacy' && <Privacy />}
    </Page>
  )
}
