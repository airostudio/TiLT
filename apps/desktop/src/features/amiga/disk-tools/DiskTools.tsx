import { useState } from 'react'
import { Page, PageHeader, Tabs } from '@/components/ui'
import { CopyDrives } from './CopyDrives'
import { CopyImage } from './CopyImage'
import { RealCopy } from './RealCopy'
import './disk-tools.css'

type Tab = 'image' | 'drives' | 'real'

export default function DiskTools() {
  const [tab, setTab] = useState<Tab>('image')
  return (
    <Page>
      <PageHeader title="XCOPY / Disk Tools" subtitle="Duplicate floppy disks the safe way: copies are made from files on your computer, checked afterwards, and never overwrite an untouched original." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'image', label: 'Copy a disk image' },
          { id: 'drives', label: 'Copy between drives' },
          { id: 'real', label: 'Real Amiga disk copy' },
        ]}
      />
      <div hidden={tab !== 'image'}>
        <CopyImage />
      </div>
      <div hidden={tab !== 'drives'}>
        <CopyDrives active={tab === 'drives'} />
      </div>
      <div hidden={tab !== 'real'}>
        <RealCopy />
      </div>
    </Page>
  )
}
