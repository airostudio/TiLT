import { lazy, type ComponentType } from 'react'
import type { IconName } from '@/components/ui'

export interface Section {
  id: string
  label: string
  icon: IconName
  component: ComponentType
}

// Each section is its own lazy chunk living in its own folder.
export const sections: Section[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', component: lazy(() => import('./dashboard/Dashboard')) },
  { id: 'machines', label: 'My Amigas', icon: 'amiga', component: lazy(() => import('./machines/MyAmigas')) },
  { id: 'emulator', label: 'Emulator', icon: 'play', component: lazy(() => import('./emulator/EmulatorView')) },
  { id: 'floppies', label: 'Floppy Drives', icon: 'floppy', component: lazy(() => import('./floppies/FloppyDrives')) },
  { id: 'disks', label: 'Disk Library', icon: 'disk', component: lazy(() => import('./disk-library/DiskLibrary')) },
  { id: 'tools', label: 'XCOPY / Disk Tools', icon: 'tools', component: lazy(() => import('./disk-tools/DiskTools')) },
  { id: 'harddrives', label: 'Hard Drives', icon: 'hdd', component: lazy(() => import('./hard-drives/HardDrives')) },
  { id: 'roms', label: 'ROM Library', icon: 'chip', component: lazy(() => import('./rom-library/RomLibrary')) },
  { id: 'settings', label: 'Settings', icon: 'settings', component: lazy(() => import('./settings/Settings')) },
  { id: 'help', label: 'Help / Diagnostics', icon: 'help', component: lazy(() => import('./help/Help')) },
]
