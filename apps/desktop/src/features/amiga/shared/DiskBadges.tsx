import type { MediaRecord } from '@/api/types'
import { Badge } from '@/components/ui'
import { adfWarnings } from './disks'
import './shared.css'

/** Plain-language state badges for a library item. Always text, never colour alone. */
export function DiskBadges({ disk }: { disk: MediaRecord }) {
  const warnings = adfWarnings(disk)
  return (
    <span className="dk-badges">
      {disk.kind === 'dms' ? (
        <Badge title="A DMS archive exactly as you imported it. Disks are made from it as ADF images.">DMS archive</Badge>
      ) : disk.pristine ? (
        <Badge tone="success" title="Stored read-only and never changed. To save changes to a game or program, make a working copy.">
          Untouched original
        </Badge>
      ) : (
        <Badge tone="accent" title="You can write to this disk. Your untouched original (if any) is safe.">
          {disk.parent_id ? 'Working copy' : 'Writable disk'}
        </Badge>
      )}
      {disk.source_dms_id && <Badge title="This disk image was made by converting a DMS archive. The archive is kept.">From DMS</Badge>}
      {disk.missing && (
        <Badge tone="danger" title="The library file for this disk can no longer be found on this computer.">
          Missing file
        </Badge>
      )}
      {warnings.length > 0 && (
        <Badge tone="warning" title={warnings.join(' ')}>
          Needs attention
        </Badge>
      )}
    </span>
  )
}
