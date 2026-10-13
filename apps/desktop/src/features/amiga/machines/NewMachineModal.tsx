import { useEffect, useMemo, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { MachineProfile, Preset } from '@/api/types'
import { Banner, Button, ErrorNote, Loading, Modal, TextInput } from '@/components/ui'
import { useLoad } from '@/lib/hooks'

/** Choose a starting configuration and a name. Nothing is saved until the editor's Save. */
export function NewMachineModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: MachineProfile) => void }) {
  const presets = useLoad(() => call<Preset[]>('preset_list'), [])
  const [choice, setChoice] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useMemo(() => presets.data ?? [], [presets.data])

  useEffect(() => {
    if (!choice && list.length) setChoice(list[0].id)
  }, [list, choice])
  const picked = list.find((p) => p.id === choice)
  useEffect(() => {
    if (!nameTouched && picked) setName(picked.title)
  }, [picked, nameTouched])

  const create = async () => {
    if (!choice || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      onCreated(await call<MachineProfile>('profile_from_preset', { preset_id: choice, name: name.trim() }))
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New machine"
      wide
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!choice || !name.trim() || busy} onClick={() => void create()} data-testid="create-machine">
            Create and edit
          </Button>
        </>
      }
    >
      <Banner tone="info" title="Presets are starting points">
        Each preset is a generic emulated configuration. Names like “68030 accelerator” describe the processor and memory being emulated, never a particular physical expansion board. You can change every setting before saving.
      </Banner>
      {presets.loading && <Loading />}
      <ErrorNote error={presets.error} />
      <div className="preset-list" role="radiogroup" aria-label="Starting configuration">
        {list.map((p) => (
          <label key={p.id} className={`preset-option ${p.id === choice ? 'selected' : ''}`} data-testid={`preset-${p.id}`}>
            <input type="radio" name="preset" checked={p.id === choice} onChange={() => setChoice(p.id)} />
            <span>
              <strong>{p.title}</strong>
              <span className="small muted">{p.description}</span>
            </span>
          </label>
        ))}
      </div>
      <TextInput
        label="Name"
        value={name}
        maxLength={80}
        onChange={(e) => {
          setName(e.target.value)
          setNameTouched(true)
        }}
        onKeyDown={(e) => e.key === 'Enter' && void create()}
      />
      <ErrorNote error={error} />
    </Modal>
  )
}
