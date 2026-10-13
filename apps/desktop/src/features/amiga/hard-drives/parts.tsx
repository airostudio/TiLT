import type { HdfInfo, Issue } from '@/api/types'
import { Badge, Icon, Table } from '@/components/ui'
import { formatBytes } from '@/lib/format'
import { SEVERITY_LABEL } from './helpers'
import './hard-drives.css'

/** Partition list of an RDB disk (name, filesystem, bootable flag, size). */
export function PartitionTable({ info }: { info: HdfInfo }) {
  if (info.partitions.length === 0) return null
  return (
    <Table head={['Partition', 'Filesystem', 'Bootable', 'Size']} caption="Partitions on this hard disk">
      {info.partitions.map((p) => (
        <tr key={`${p.name}-${p.low_cyl}`}>
          <td>
            <strong>{p.name || '(unnamed)'}</strong>
            {p.no_mount && (
              <div className="xs faint" title="This partition is flagged “do not mount” in the partition table, so the Amiga will not mount it by itself.">
                Not mounted automatically
              </div>
            )}
          </td>
          <td>{p.dos_type_name}</td>
          <td>
            {p.bootable ? (
              <Badge tone="success" title="This partition is flagged as bootable. Whether it really contains a startable system is only known by starting it.">
                <Icon name="check" size={12} /> Bootable
              </Badge>
            ) : (
              <span className="muted">No</span>
            )}
          </td>
          <td>{formatBytes(p.size_bytes)}</td>
        </tr>
      ))}
    </Table>
  )
}

/** Findings the backend reported about a disk: what looks wrong, and what to do about it. */
export function Findings({ info }: { info: HdfInfo }) {
  return (
    <>
      {info.embedded_filesystems.length > 0 && (
        <p className="hdd-note">
          <strong>Extra filesystems stored on the disk:</strong> {info.embedded_filesystems.join(', ')}. These are drivers the Amiga loads from the disk itself so it can read partitions that are not plain OFS/FFS.
        </p>
      )}
      {info.plain_dos_type && (
        <p className="hdd-note">
          <strong>Filesystem:</strong> {info.plain_dos_type}
        </p>
      )}
      {info.warnings.length > 0 && (
        <div className="banner warning" role="status" data-testid="hdf-warnings">
          <Icon name="warn" />
          <div className="banner-body">
            <div className="banner-title">Things to check</div>
            <ul className="hdd-list-plain">
              {info.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {info.advice.length > 0 && (
        <div className="banner info" role="status" data-testid="hdf-advice">
          <Icon name="info" />
          <div className="banner-body">
            <div className="banner-title">Good to know</div>
            <ul className="hdd-list-plain">
              {info.advice.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

/** Validation results with a word as well as a colour for each severity. */
export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null
  const tone = { error: 'danger', warning: 'warning', info: 'accent' } as const
  const order = { error: 0, warning: 1, info: 2 }
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <ul className="hdd-issues" data-testid="issue-list">
      {sorted.map((i, n) => (
        <li key={n} className="hdd-issue">
          <Badge tone={tone[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  )
}
