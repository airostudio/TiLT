import { Suspense } from 'react'
import { sections } from './sections'
import { Icon, Loading } from '@/components/ui'
import { useBackend } from '@/app/backend'

export default function AmigaStudio({ section }: { section: string }) {
  const { session } = useBackend()
  const current = sections.find((s) => s.id === section) ?? sections[0]
  const Current = current.component
  return (
    <div className="studio">
      <nav className="studio-nav" aria-label="Amiga Studio">
        <h2>Amiga Studio</h2>
        {sections.map((s) => (
          <a key={s.id} className="nav-item" href={`#/amiga/${s.id}`} aria-current={s.id === current.id ? 'page' : undefined} data-testid={`nav-${s.id}`}>
            <Icon name={s.icon} />
            <span className="label">{s.label}</span>
            {s.id === 'emulator' && session?.running && <span className="dot on nav-badge" title="A machine is running" />}
          </a>
        ))}
      </nav>
      <main className="studio-main" id="main">
        <Suspense fallback={<Loading />}>
          <Current />
        </Suspense>
      </main>
    </div>
  )
}
