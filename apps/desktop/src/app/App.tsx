import { lazy, Suspense } from 'react'
import { useRoute } from './router'
import { useTheme } from './theme'
import { BackendProvider, useBackend } from './backend'
import { Banner, Button, Icon, Loading } from '@/components/ui'
import { OfflinePreview } from './OfflinePreview'
import { isTauri } from '@/api/client'
import { RoomsHome } from '@/features/rooms/RoomsHome'
import { RoomView } from '@/features/rooms/RoomView'
import { SystemPage } from '@/features/rooms/SystemPage'

const AmigaStudio = lazy(() => import('@/features/amiga/AmigaStudio'))

function TopBar({ parts }: { parts: string[] }) {
  const [theme, setTheme] = useTheme()
  const { offline, session } = useBackend()
  const inAmiga = parts[0] === 'amiga'
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="TiLT home">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="pinball" size={18} />
        </span>
        <span className="brand-name">TiLT</span>
      </a>
      <nav className="crumbs" aria-label="Breadcrumb">
        {parts[0] === 'room' && (
          <>
            <Icon name="chevron" size={14} />
            <a href={`#/room/${parts[1]}`}>{parts[1] === 'pinball' ? 'Pinball Arcade' : 'Home Arcade'}</a>
          </>
        )}
        {inAmiga && (
          <>
            <Icon name="chevron" size={14} />
            <a href="#/room/home">Home Arcade</a>
            <Icon name="chevron" size={14} />
            <a href="#/amiga/dashboard">Amiga Studio</a>
          </>
        )}
      </nav>
      <span className="spacer" />
      {session?.running && (
        <a className="badge success" href="#/amiga/emulator" title="A machine is running">
          <span className="dot on" /> {session.profile_name} running
        </a>
      )}
      {offline && <span className="badge danger">Backend offline</span>}
      <Button
        variant="ghost"
        iconOnly
        icon={theme === 'dark' ? 'sun' : 'moon'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
    </header>
  )
}

function Routes({ parts }: { parts: string[] }) {
  const { offline } = useBackend()
  if (offline && !isTauri()) return <main className="main" id="main"><OfflinePreview /></main>
  if (parts[0] === 'amiga') {
    return (
      <Suspense fallback={<Loading />}>
        <AmigaStudio section={parts[1] ?? 'dashboard'} />
      </Suspense>
    )
  }
  return (
    <main className="main" id="main">
      {offline && (
        <div style={{ padding: 16 }}>
          <Banner tone="error" title="The TiLT backend is not running">
            The interface could not reach its backend. In the desktop app this should never happen; in development start <code>amiga-devserver</code>.
          </Banner>
        </div>
      )}
      {parts[0] === 'room' && parts[2] ? <SystemPage room={parts[1]} system={parts[2]} /> : parts[0] === 'room' ? <RoomView room={parts[1]} /> : <RoomsHome />}
    </main>
  )
}

export function App() {
  const [parts] = useRoute()
  return (
    <BackendProvider pollSession>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app">
        <TopBar parts={parts} />
        <Routes parts={parts} />
      </div>
    </BackendProvider>
  )
}
