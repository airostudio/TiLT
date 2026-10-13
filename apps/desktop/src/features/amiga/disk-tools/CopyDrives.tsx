import { useMemo, useState } from 'react'
import { call } from '@/api/client'
import type { CopyReport, DriveView, MediaRecord } from '@/api/types'
import { Banner, Button, Card, Empty, JobProgress, Loading, Select, TextInput, Toggle, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useInterval, useLoad } from '@/lib/hooks'
import { basename } from '@/lib/format'
import { friendly } from '../hard-drives/helpers'
import { isCancelled, useJob } from '../hard-drives/useJob'
import { ReportCard, ScrollTo, StepTitle } from './parts'
import './disk-tools.css'

const driveName = (d: DriveView): string => d.media_name ?? (d.path ? basename(d.path) : '')

/** Copy between the floppy drives of the machine that is running right now. */
export function CopyDrives({ active }: { active: boolean }) {
  const { session } = useBackend()
  const { toast, confirm } = useUi()
  const control = !!session?.running && session.runtime_control
  const drives = useLoad(() => (control ? call<DriveView[]>('session_drives') : Promise.resolve([] as DriveView[])), [control])
  const media = useLoad(() => call<MediaRecord[]>('media_list'))
  const runner = useJob()
  const [src, setSrc] = useState('')
  const [dst, setDst] = useState('')
  const [newName, setNewName] = useState('')
  const [verify, setVerify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<CopyReport | null>(null)

  useInterval(() => void drives.reload(), 2500, control && active && !runner.running)

  const list = useMemo(() => (drives.data ?? []).filter((d) => d.enabled), [drives.data])
  const withDisk = list.filter((d) => d.path)
  const srcDrive = list.find((d) => String(d.unit) === src)
  const dstDrive = list.find((d) => String(d.unit) === dst)
  const dstRecord = dstDrive?.media_id ? (media.data ?? []).find((m) => m.id === dstDrive.media_id) : undefined
  const dstEmpty = !!dstDrive && !dstDrive.path
  const dstWhy = (d: DriveView): string => {
    if (!d.path) return ''
    const rec = d.media_id ? (media.data ?? []).find((m) => m.id === d.media_id) : undefined
    if (!rec) return 'not from the library'
    if (rec.pristine) return 'untouched original, cannot be overwritten'
    return ''
  }
  const canCopy = !!srcDrive?.path && !!dstDrive && srcDrive.unit !== dstDrive.unit && !dstWhy(dstDrive) && !runner.running

  const go = async () => {
    if (!srcDrive || !dstDrive) return
    if (dstDrive.path) {
      const ok = await confirm({
        title: `Replace the disk in DF${dstDrive.unit}:?`,
        confirmLabel: 'Copy and replace',
        danger: true,
        body: (
          <p>
            Everything on <strong>{driveName(dstDrive)}</strong> (DF{dstDrive.unit}:) will be overwritten with a copy of <strong>{driveName(srcDrive)}</strong> (DF{srcDrive.unit}:). Its old contents are backed up first.
          </p>
        ),
      })
      if (!ok) return
    }
    setError(null)
    setReport(null)
    try {
      const args: Record<string, unknown> = { src_unit: srcDrive.unit, dst_unit: dstDrive.unit, verify }
      if (dstEmpty && newName.trim()) args.new_name = newName.trim()
      const r = await runner.run<CopyReport>('session_copy_drive', args)
      setReport(r)
      toast('Copy complete', 'success')
    } catch (e) {
      setError(isCancelled(e) ? 'Copy cancelled.' : friendly(e))
    } finally {
      void drives.reload()
      void media.reload()
    }
  }

  const emulatorLink = (
    <a className="btn" href="#/amiga/emulator">
      Go to the Emulator
    </a>
  )

  if (!session) return <Loading />
  if (!session.running) {
    return (
      <Empty icon="play" title="No machine is running" action={emulatorLink}>
        This tool copies a disk from one floppy drive of a running Amiga to another. Start a machine on the Emulator screen first. To copy a disk without running a machine, use the “Copy a disk image” tab.
      </Empty>
    )
  }
  if (!session.runtime_control) {
    return (
      <Empty icon="warn" title="This machine cannot be controlled while it runs" action={emulatorLink}>
        {session.profile_name ?? 'The machine'} is running, but this build of the emulator engine has no control channel, so Amiga Studio cannot swap or read its disks while it runs. Shut the machine down and use the “Copy a disk image” tab instead. (Official Windows builds of Amiberry work this way; see Settings for details about your engine.)
      </Empty>
    )
  }

  return (
    <div className="stack">
      <Banner tone="info" title={`Copying inside ${session.profile_name ?? 'the running machine'}`}>
        <ol className="dt-steps">
          <li>Both disks are briefly ejected from the Amiga, so the emulator saves everything it was still holding in memory.</li>
          <li>The copy is made on your computer, sector for sector, and checked.</li>
          <li>Both disks go back into their drives. If the destination drive is empty, a new library disk is created and inserted there.</li>
        </ol>
        <p style={{ marginTop: 8 }}>Like any image copy, this cannot reproduce copy protection.</p>
      </Banner>

      <Card>
        <div className="dt-step">
          <StepTitle n={1}>Choose the drives</StepTitle>
          {drives.loading ? (
            <Loading label="Reading the drives…" />
          ) : withDisk.length === 0 ? (
            <p className="muted small">None of the drives has a disk in it. Insert the disk you want to copy from the Emulator screen first.</p>
          ) : (
            <div className="dt-options">
              <Select label="Copy from" value={src} onChange={(e) => setSrc(e.target.value)} disabled={runner.running}>
                <option value="">Choose a drive…</option>
                {withDisk.map((d) => (
                  <option key={d.unit} value={d.unit}>
                    DF{d.unit}: {driveName(d)}
                  </option>
                ))}
              </Select>
              <Select label="Copy to" value={dst} onChange={(e) => setDst(e.target.value)} disabled={runner.running}>
                <option value="">Choose a drive…</option>
                {list
                  .filter((d) => String(d.unit) !== src)
                  .map((d) => {
                    const why = dstWhy(d)
                    return (
                      <option key={d.unit} value={d.unit} disabled={!!why}>
                        DF{d.unit}: {d.path ? driveName(d) : 'empty (a new disk will be created)'}
                        {why ? ` (${why})` : ''}
                      </option>
                    )
                  })}
              </Select>
            </div>
          )}
          {dstEmpty && <TextInput label="Name of the new disk (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={srcDrive ? `Copy of ${driveName(srcDrive)}` : 'Copy of …'} maxLength={80} />}
          {dstDrive?.path && dstRecord && (
            <Banner tone="warning" title={`The disk in DF${dstDrive.unit}: will be replaced`}>
              “{dstRecord.name}” is overwritten with the copy. Its old contents are backed up first.
            </Banner>
          )}
          <Toggle label="Verify after copying" checked={verify} onChange={setVerify} disabled={runner.running} />
          <div className="row">
            <Button variant="primary" icon="copy" disabled={!canCopy} onClick={() => void go()}>
              Copy between drives
            </Button>
          </div>
          {runner.running && <JobProgress job={runner.job} jobId={runner.jobId} label="Copying between drives… the disks are out of the drives for a moment." />}
        </div>
      </Card>

      {error && (
        <ScrollTo>
          <Banner tone="error" title="The disk was not copied">
            {error}
          </Banner>
        </ScrollTo>
      )}
      {report && (
        <ScrollTo>
          <ReportCard report={report} media={media.data ?? []} />
        </ScrollTo>
      )}
    </div>
  )
}
