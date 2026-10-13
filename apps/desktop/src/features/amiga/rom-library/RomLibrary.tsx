import { useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { RomRecord } from '@/api/types'
import { Badge, Banner, Button, Card, Empty, ErrorNote, KV, Loading, Modal, Page, PageHeader, PathInput, Table, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { basename, formatBytes, formatDate, shortHash } from '@/lib/format'
import { generationOf, type KsGeneration } from './associate'
import { RomImport } from './RomImport'

export function KickstartCoverage({ roms }: { roms: RomRecord[] }) {
  const have = new Set<KsGeneration>(roms.filter((r) => !r.missing).map(generationOf))
  const items: [KsGeneration, string][] = [
    ['1.3', 'Kickstart 1.3'],
    ['2.x', 'Kickstart 2.x'],
    ['3.1', 'Kickstart 3.x'],
  ]
  return (
    <div className="row" aria-label="Kickstart coverage" data-testid="ks-coverage">
      {items.map(([g, label]) => (
        <Badge key={g} tone={have.has(g) ? 'success' : 'neutral'}>
          {have.has(g) ? '✓' : '–'} {label}
        </Badge>
      ))}
    </div>
  )
}

export default function RomLibrary() {
  const { toast, confirm } = useUi()
  const roms = useLoad(() => call<RomRecord[]>('rom_list'))
  const [detail, setDetail] = useState<RomRecord | null>(null)
  const [relink, setRelink] = useState<RomRecord | null>(null)
  const [relinkPath, setRelinkPath] = useState('')
  const list = roms.data ?? []

  const remove = async (r: RomRecord) => {
    const ok = await confirm({
      title: `Remove ${r.info.label}?`,
      body: r.storage === 'managed' ? 'The copy in the Amiga Studio library will be deleted. Your original file is not touched.' : 'It is only removed from the list. Your original file is not touched.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await call('rom_remove', { id: r.id })
      toast('ROM removed', 'success')
      await roms.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const doRelink = async () => {
    if (!relink) return
    try {
      await call('rom_relink', { id: relink.id, path: relinkPath.trim() })
      toast('ROM relinked', 'success')
      setRelink(null)
      setRelinkPath('')
      await roms.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Page>
      <PageHeader
        title="ROM Library"
        subtitle="Kickstart ROMs identify themselves, so the version you see here comes from the ROM's own contents, never its file name. Amiga Studio ships without any ROMs: import the ones you own."
      />
      <KickstartCoverage roms={list} />
      <Card title="Import Kickstart ROMs">
        <RomImport onDone={() => void roms.reload()} />
      </Card>
      <Card title={`Your ROMs (${list.length})`}>
        <ErrorNote error={roms.error} />
        {roms.loading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="chip" title="No ROMs yet">
            Import a Kickstart ROM above to get started. Nothing is uploaded: ROMs stay on this computer.
          </Empty>
        ) : (
          <Table head={['Kickstart', 'Version', 'Size', 'Checksum', 'Likely machines', 'Stored', '']} caption="Imported ROMs">
            {list.map((r) => (
              <tr key={r.id} data-testid="rom-row">
                <td>
                  <div className="stack-sm" style={{ gap: 2 }}>
                    <strong>{r.info.family ?? (r.info.kind === 'encrypted_cloanto' ? 'Encrypted ROM' : r.info.label)}</strong>
                    <span className="muted xs truncate" title={r.path}>
                      {basename(r.path)}
                    </span>
                  </div>
                </td>
                <td className="mono">{r.info.exec_version != null ? `${r.info.exec_version}.${r.info.exec_revision}` : '—'}</td>
                <td>{formatBytes(r.info.size)}</td>
                <td>{r.info.kind === 'encrypted_cloanto' ? <Badge tone="warning">Needs rom.key</Badge> : r.info.checksum_ok ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">Bad</Badge>}</td>
                <td className="muted small">
                  {r.info.is_aros ? 'Open-source AROS replacement' : r.info.likely_machines.join(', ') || '—'}
                  {r.info.aga_capable && <> · <Badge tone="accent">AGA</Badge></>}
                </td>
                <td>
                  {r.missing ? <Badge tone="danger">File moved</Badge> : r.storage === 'managed' ? <Badge>Library copy</Badge> : <Badge>Original location</Badge>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {r.missing && (
                    <Button size="sm" variant="primary" icon="link" onClick={() => setRelink(r)}>
                      Relink…
                    </Button>
                  )}{' '}
                  <Button size="sm" onClick={() => setDetail(r)}>
                    Details
                  </Button>{' '}
                  <Button size="sm" variant="danger" iconOnly icon="trash" aria-label={`Remove ${r.name}`} onClick={() => void remove(r)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {detail && (
        <Modal title={detail.info.label} onClose={() => setDetail(null)} actions={<Button onClick={() => setDetail(null)}>Close</Button>}>
          <KV
            rows={[
              ['Detected version', detail.info.exec_version != null ? `exec ${detail.info.exec_version}.${detail.info.exec_revision}` : 'unknown (encrypted)'],
              ['Name', detail.info.family ?? '—'],
              ['Version string', detail.info.version_string ?? '—'],
              ['Size', formatBytes(detail.info.size)],
              ['SHA-256', <span className="mono small" key="h">{detail.info.sha256}</span>],
              ['Checksum', detail.info.checksum_ok ? 'Valid' : 'Does not match'],
              ['Chipset support', detail.info.aga_capable ? 'OCS, ECS and AGA' : 'OCS and ECS'],
              ['Likely machines', detail.info.likely_machines.join(', ') || '—'],
              ['Stored', detail.storage === 'managed' ? 'Copy in the library' : 'Original location'],
              ['Location', <span className="mono small" key="p">{detail.path}</span>],
              ['Imported', formatDate(detail.imported_at)],
            ]}
          />
          {detail.info.mirrored_256k && <Banner tone="info">This is a 256 KB ROM stored twice in a 512 KB file. That is normal for Kickstart 1.x images.</Banner>}
          {detail.info.warnings.map((w) => (
            <Banner key={w} tone="warning">
              {w}
            </Banner>
          ))}
        </Modal>
      )}

      {relink && (
        <Modal
          title="Find the moved ROM"
          onClose={() => setRelink(null)}
          actions={
            <>
              <Button onClick={() => setRelink(null)}>Cancel</Button>
              <Button variant="primary" disabled={!relinkPath.trim()} onClick={() => void doRelink()}>
                Relink
              </Button>
            </>
          }
        >
          <p className="muted">
            The file for <strong>{relink.info.label}</strong> was not found at its old location. Point to the ROM's new location. It must be the same ROM (Amiga Studio checks its fingerprint).
          </p>
          <PathInput label="New location of the ROM" value={relinkPath} onChange={setRelinkPath} extensions={['rom', 'bin']} />
          <span className="faint xs">Fingerprint: {shortHash(relink.info.sha256)}</span>
        </Modal>
      )}
    </Page>
  )
}
