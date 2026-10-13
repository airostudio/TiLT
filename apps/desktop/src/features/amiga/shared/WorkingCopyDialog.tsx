import { useState, type FormEvent } from 'react'
import { call, errorMessage } from '@/api/client'
import type { MediaRecord } from '@/api/types'
import { Button, Modal, TextInput, Toggle, useUi } from '@/components/ui'

/** Asks for a name and makes a writable working copy of a disk (the original is never touched). */
export function WorkingCopyDialog({
  disk,
  onClose,
  onDone,
  offerInsert,
}: {
  disk: MediaRecord
  onClose: () => void
  onDone: (copy: MediaRecord, opts: { insertNow: boolean }) => void | Promise<void>
  /** Floppy screen: also offer to swap the copy into the drive. */
  offerInsert?: string
}) {
  const { toast } = useUi()
  const [name, setName] = useState(`${disk.name} (working copy)`)
  const [insertNow, setInsertNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const copy = await call<MediaRecord>('media_working_copy', { id: disk.id, name: name.trim() })
      toast(`Working copy “${copy.name}” created. Your original is untouched.`, 'success')
      await onDone(copy, { insertNow: !!offerInsert && insertNow })
      onClose()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Make a working copy"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
            Make working copy
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted small">
          A working copy is a separate disk you can write to (save games, install programs). “{disk.name}” stays exactly as it is, so you can always make another copy.
        </p>
        <TextInput label="Name for the copy" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        {offerInsert && <Toggle label={`Put the copy in ${offerInsert} now (replaces the original in that drive)`} checked={insertNow} onChange={setInsertNow} />}
      </form>
    </Modal>
  )
}
