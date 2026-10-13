import { useState } from 'react'
import { call } from '@/api/client'
import type { MediaRecord } from '@/api/types'
import { ErrorNote, Loading, Page, PageHeader, Tabs } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { DisksTab } from './DisksTab'
import { QueuesTab } from './QueuesTab'
import { WorkbenchTab } from './WorkbenchTab'
import './disk-library.css'

type TabId = 'disks' | 'queues' | 'workbench'

export default function DiskLibrary() {
  const [tab, setTab] = useState<TabId>('disks')
  const media = useLoad(() => call<MediaRecord[]>('media_list'))
  return (
    <Page>
      <PageHeader
        title="Disk Library"
        subtitle="Your floppy disks: add ADF images and DMS archives, make safe working copies, line disks up in queues, and set up Workbench."
      />
      <Tabs
        tabs={[
          { id: 'disks', label: 'Disks' },
          { id: 'queues', label: 'Queues' },
          { id: 'workbench', label: 'Workbench' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorNote error={media.error} />
      {media.loading ? (
        <Loading />
      ) : (
        <>
          {tab === 'disks' && <DisksTab media={media.data ?? []} reload={media.reload} />}
          {tab === 'queues' && <QueuesTab media={media.data ?? []} />}
          {tab === 'workbench' && <WorkbenchTab media={media.data ?? []} />}
        </>
      )}
    </Page>
  )
}
