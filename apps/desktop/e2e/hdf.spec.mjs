// Hard Drives screen against the real backend. Every check looks at the screen AND asks the
// backend (api) so the UI can never claim something that did not happen.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { test, expect, fixtures, writeFile } from './harness.mjs'

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Run a job-returning command through the API and wait for it. */
async function job(api, cmd, args) {
  const { job: id } = await api(cmd, args)
  for (;;) {
    const j = await api('job_get', { id })
    if (j.state === 'done') return j.result
    if (j.state === 'failed') throw new Error(`${cmd}: ${j.error?.message}`)
    await new Promise((r) => setTimeout(r, 60))
  }
}
const importHdf = (api, p, name = 'Work') => job(api, 'hdf_import', { path: p, name })

/** Open the screen; if the lazy chunk is slow under machine load, reload once before giving up. */
async function open(page, app) {
  await app('amiga/harddrives')
  try {
    await page.waitForSelector('h1:has-text("Hard Drives")', { timeout: 10000 })
  } catch {
    await page.reload()
    await page.waitForSelector('h1:has-text("Hard Drives")')
  }
}

const importButton = (page) => page.getByRole('button', { name: 'Import hard disk…' }).first()

test('hdf: import wizard shows the estimate, imports a managed copy and never touches the original', async ({ page, app, api, dir, shot }) => {
  const orig = writeFile(dir, 'work.hdf', fixtures.hdf())
  const before = sha(orig)
  const mtime = statSync(orig).mtimeMs
  await open(page, app)
  await page.waitForSelector('text=No hard disks yet')
  await shot('hdf-empty')
  await importButton(page).click()
  await page.getByRole('dialog').waitFor()
  expect((await page.textContent('[role=dialog]')).includes('only read, never changed'), 'wizard promises the original is never changed')
  await page.fill('input[placeholder="/path/to/disk.hdf"]', orig)
  await page.click('text=Check this file')
  await page.waitForSelector('[data-testid=hdf-estimate]')
  const est = await page.textContent('[data-testid=hdf-estimate]')
  for (const s of ['DH0', 'FFS', 'Bootable', 'Needed, working copy only', 'Needed, with untouched copy', 'Free in your library drive', 'Enough space', 'one extra copy']) {
    expect(est.includes(s), `estimate shows "${s}"`)
  }
  await shot('hdf-import-estimate')
  // the name is pre-filled; keep an untouched copy is on by default
  expect((await page.inputValue('input[value="work"]')) === 'work', 'name defaults to the file name')
  await page.getByRole('switch', { name: /untouched copy/ }).isChecked().then((c) => expect(c, 'untouched copy defaults on'))
  await page.getByRole('button', { name: 'Import disk' }).click()
  await page.waitForSelector('[data-testid^=disk-]')
  await page.waitForSelector('[role=dialog]', { state: 'detached' })
  const card = await page.textContent('[data-testid^=disk-]')
  for (const s of ['work', 'Ready', 'Untouched copy kept: Yes', 'Not measured', 'DH0', 'FFS', 'Bootable']) expect(card.includes(s), `card shows "${s}"`)
  await shot('hdf-card')

  const list = await api('hdf_list')
  expect(list.length === 1, 'one disk in the library')
  const rec = list[0]
  expect(rec.original_sha256 === before, 'recorded original hash')
  expect(sha(rec.working_path) === before && sha(rec.pristine_path) === before, 'working and untouched copies match the original')
  expect(sha(orig) === before && statSync(orig).mtimeMs === mtime, 'the original file is byte-identical and was not even touched')
})

test('hdf: keeping no untouched copy is honoured and shown', async ({ page, app, api, dir }) => {
  const orig = writeFile(dir, 'small.hdf', fixtures.hdf())
  await open(page, app)
  await importButton(page).click()
  await page.fill('input[placeholder="/path/to/disk.hdf"]', orig)
  await page.click('text=Check this file')
  await page.waitForSelector('[data-testid=hdf-estimate]')
  await page.getByRole('switch', { name: /untouched copy/ }).uncheck()
  await page.getByLabel('Name in your library').fill('Lean disk')
  await page.getByRole('button', { name: 'Import disk' }).click()
  await page.waitForSelector('text=Untouched copy kept: No')
  const rec = (await api('hdf_list'))[0]
  expect(rec.name === 'Lean disk' && rec.pristine_path === null, 'backend kept no pristine copy')
})

test('hdf: an unrecognised image needs explicit acceptance', async ({ page, app, api, dir, shot }) => {
  const junk = Buffer.alloc(1024 * 1024)
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 31 + 7) & 0xff
  const p = writeFile(dir, 'mystery.img', junk)
  await open(page, app)
  await importButton(page).click()
  await page.fill('input[placeholder="/path/to/disk.hdf"]', p)
  await page.click('text=Check this file')
  await page.waitForSelector('[data-testid=hdf-estimate]')
  const t = await page.textContent('[role=dialog]')
  expect(t.includes('Unrecognised layout') && t.includes('does not look like an Amiga hard disk'), 'says it is unrecognised')
  const btn = page.getByRole('button', { name: 'Import disk' })
  expect(await btn.isDisabled(), 'import is blocked until accepted')
  await shot('hdf-unrecognised')
  await page.getByRole('checkbox', { name: /I am sure/ }).check()
  expect(!(await btn.isDisabled()), 'import is allowed after explicit acceptance')
  await btn.click()
  await page.waitForSelector('[data-testid^=disk-]')
  const rec = (await api('hdf_list'))[0]
  expect(rec.info.layout === 'unrecognised', 'imported as unrecognised')
  expect((await page.textContent('[data-testid^=disk-]')).includes('Unrecognised layout'), 'card is honest about it')
})

test('hdf: a blank image shows recovery guidance and never offers to format', async ({ page, app, api, dir, shot }) => {
  const p = writeFile(dir, 'empty.hdf', Buffer.alloc(2 * 1024 * 1024))
  await open(page, app)
  await importButton(page).click()
  await page.fill('input[placeholder="/path/to/disk.hdf"]', p)
  await page.click('text=Check this file')
  await page.waitForSelector('[data-testid=hdf-estimate]')
  const t = await page.textContent('[role=dialog]')
  expect(t.includes('Blank') && t.includes('HDToolBox') && t.includes('Workbench install disk'), 'recovery guidance shown')
  expect(t.includes('never formats or partitions'), 'states that nothing is formatted automatically')
  expect(!/format (it|the disk) now/i.test(t) && (await page.getByRole('button', { name: /format/i }).count()) === 0, 'no format button')
  await shot('hdf-blank')
  expect(!(await page.getByRole('button', { name: 'Import disk' }).isDisabled()), 'a blank disk can be imported (it is just empty)')
  await page.getByRole('button', { name: 'Import disk' }).click()
  await page.waitForSelector('[data-testid^=disk-]')
  expect((await page.textContent('[data-testid^=disk-]')).includes('HDToolBox'), 'guidance stays on the card')
  expect((await api('hdf_list'))[0].info.layout === 'blank', 'recorded as blank')
})

test('hdf: a file that is not a disk image is refused with a readable message', async ({ page, app, dir }) => {
  const p = writeFile(dir, 'tiny.hdf', Buffer.alloc(100))
  await open(page, app)
  await importButton(page).click()
  await page.fill('input[placeholder="/path/to/disk.hdf"]', p)
  await page.click('text=Check this file')
  await page.waitForSelector('[role=dialog] [role=alert]')
  expect((await page.textContent('[role=dialog] [role=alert]')).includes('too small'), 'explains why')
})

test('hdf: backup, snapshot and restore round trip', async ({ page, app, api, dir, shot }) => {
  const orig = writeFile(dir, 'work.hdf', fixtures.hdf())
  const original = sha(orig)
  await importHdf(api, orig, 'Work')
  const rec = (await api('hdf_list'))[0]
  await open(page, app)
  await page.waitForSelector('[data-testid^=disk-]')

  await page.getByRole('button', { name: 'Back up now' }).click()
  await page.waitForSelector('text=Backup of “Work” saved')
  await page.getByRole('button', { name: 'Create snapshot…' }).click()
  await page.getByLabel('Snapshot name').fill('Clean install')
  await page.getByRole('button', { name: 'Create snapshot', exact: true }).click()
  await page.waitForSelector('text=Snapshot “Clean install” saved')
  await page.getByRole('tab', { name: /Backups and snapshots \(2\)/ }).click()
  const table = await page.textContent('[data-testid^=disk-]')
  expect(table.includes('Backup') && table.includes('Snapshot') && table.includes('Clean install'), 'both entries listed with kind labels and the note')
  await shot('hdf-snapshots')

  const snaps = await api('hdf_snapshots', { id: rec.id })
  expect(snaps.length === 2 && snaps.some((s) => s.kind === 'snapshot' && s.note === 'Clean install') && snaps.some((s) => s.kind === 'backup'), 'backend has a backup and a named snapshot')

  // Something changes the working copy on disk (as an Amiga session would)
  const damaged = Buffer.from(fixtures.hdf())
  damaged.fill(0x5a, 600000, 700000)
  writeFileSync(rec.working_path, damaged)
  const changed = sha(rec.working_path)
  expect(changed !== original, 'working copy differs now')

  // restore: must be confirmed and explain the safety net
  await page.locator('tr:has-text("Clean install") >> button:has-text("Restore")').click()
  const dlg = await page.textContent('[role=dialog]')
  expect(dlg.includes('Before restore') && dlg.includes('undo'), 'confirmation explains the undo copy')
  await shot('hdf-restore-confirm')
  await page.getByRole('button', { name: 'Restore this version' }).click()
  await page.waitForSelector('text=restored')
  await page.waitForSelector('tr:has-text("Before restore")')
  expect(sha(rec.working_path) === original, 'working copy is back to the snapshot content')
  const after = await api('hdf_snapshots', { id: rec.id })
  const pre = after.find((s) => s.kind === 'pre_restore')
  expect(pre && sha(pre.path) === changed, 'the state before the restore is kept as a Before restore backup')
  expect(sha(orig) === original, 'the original is still untouched')

  // delete the Backup entry (confirmed)
  await page.locator('tr:has-text("Backup") >> button:has-text("Delete")').first().click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForSelector('text=Backups and snapshots (2)')
  expect((await api('hdf_snapshots', { id: rec.id })).length === 2, 'one entry removed')
})

test('hdf: cancelling the restore confirmation changes nothing', async ({ page, app, api, dir }) => {
  const orig = writeFile(dir, 'work.hdf', fixtures.hdf())
  await importHdf(api, orig)
  const rec = (await api('hdf_list'))[0]
  await job(api, 'hdf_backup', { id: rec.id, kind: 'snapshot', note: 'S1' })
  writeFileSync(rec.working_path, Buffer.alloc(rec.size, 7))
  const changed = sha(rec.working_path)
  await open(page, app)
  await page.getByRole('tab', { name: /Backups and snapshots/ }).click()
  await page.locator('tr:has-text("S1") >> button:has-text("Restore")').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(300)
  expect(sha(rec.working_path) === changed, 'declined restore left the disk alone')
  expect((await api('hdf_snapshots', { id: rec.id })).length === 1, 'no extra backup was made')
})

test('hdf: export refuses to overwrite without consent, then writes the complete disk', async ({ page, app, api, dir, shot }) => {
  const orig = writeFile(dir, 'work.hdf', fixtures.hdf())
  await importHdf(api, orig)
  const rec = (await api('hdf_list'))[0]
  const dest = writeFile(dir, 'exported.hdf', 'precious existing file')
  await open(page, app)
  await page.getByRole('button', { name: 'Export complete disk…' }).click()
  await page.getByLabel('Save as (full path of the new file)').fill(dest)
  await page.getByRole('button', { name: 'Export disk' }).click()
  await page.waitForSelector('[role=dialog] [role=alert]')
  const msg = await page.textContent('[role=dialog] [role=alert]')
  expect(msg.includes('already exists') && msg.includes('Allow overwriting'), 'refusal is readable and says what to do')
  await shot('hdf-export-refused')
  expect(readFileSync(dest, 'utf8') === 'precious existing file', 'existing file untouched')
  await page.getByRole('switch', { name: 'Allow overwriting' }).check()
  await page.getByRole('button', { name: 'Export disk' }).click()
  await page.waitForSelector('[role=dialog]', { state: 'detached' })
  expect(sha(dest) === sha(rec.working_path), 'exported file equals the complete disk')

  // a brand-new destination needs no consent
  const fresh = path.join(dir, 'fresh', 'copy.hdf')
  await page.getByRole('button', { name: 'Export complete disk…' }).click()
  await page.getByLabel('Save as (full path of the new file)').fill(fresh)
  await page.getByRole('button', { name: 'Export disk' }).click()
  await page.waitForSelector('[role=dialog]', { state: 'detached' })
  expect(existsSync(fresh) && sha(fresh) === sha(rec.working_path), 'exported to a new path')

  // refuses a relative path before calling the backend
  await page.getByRole('button', { name: 'Export complete disk…' }).click()
  await page.getByLabel('Save as (full path of the new file)').fill('relative.hdf')
  await page.getByRole('button', { name: 'Export disk' }).click()
  await page.waitForSelector('text=full path')
})

test('hdf: attach to a machine with validation, show attachments, detach', async ({ page, app, api, dir, shot }) => {
  const orig = writeFile(dir, 'work.hdf', fixtures.hdf())
  await importHdf(api, orig, 'Work')
  const rec = (await api('hdf_list'))[0]
  const a500 = await api('profile_from_preset', { preset_id: 'a500', name: 'My A500' })
  const rom = writeFile(dir, 'kick13.rom', fixtures.rom(34, 5))
  const imported = await api('rom_import', { paths: [rom] })
  a500.rom_id = imported[0].ok.record.id
  await api('profile_save', { profile: a500 })
  const a1200 = await api('profile_from_preset', { preset_id: 'a1200', name: 'My A1200' })
  await api('profile_save', { profile: a1200 })

  await open(page, app)
  await page.getByRole('tab', { name: /Machines/ }).click()
  expect((await page.textContent('[data-testid=not-attached]')).includes('Not attached'), 'starts unattached')

  // impossible: built-in IDE on an A500
  await page.getByLabel('Machine').selectOption({ label: 'My A500' })
  await page.getByLabel('Connect it through').selectOption('mainboard_ide')
  await page.waitForFunction(() => document.querySelector('[data-testid=issue-list]')?.textContent?.includes('Mainboard IDE'))
  const issues = await page.textContent('[data-testid=issue-list]')
  expect(issues.includes('Mainboard IDE exists on the A600/A1200/A4000') && issues.includes('Problem'), 'validation message shown with a word label')
  expect(await page.getByRole('button', { name: 'Attach disk' }).isDisabled(), 'cannot attach an invalid combination')
  await shot('hdf-attach-invalid')
  expect((await api('profile_get', { id: a500.id })).hard_disks.length === 0, 'nothing was saved')

  // valid: generic controller; Kickstart 1.x warning is shown but does not block
  await page.getByLabel('Connect it through').selectOption('uae')
  await page.waitForFunction(() => {
    const t = document.querySelector('[data-testid=issue-list]')?.textContent ?? ''
    return t.includes('Kickstart 1.x cannot autoboot') && !t.includes('Mainboard IDE')
  })
  expect(!(await page.getByRole('button', { name: 'Attach disk' }).isDisabled()), 'warnings do not block')
  await page.getByRole('switch', { name: /Read-only/ }).check()
  await page.getByRole('button', { name: 'Attach disk' }).click()
  await page.waitForSelector(`[data-testid=attached-${a500.id}]`)
  await shot('hdf-attached')
  const saved = await api('profile_get', { id: a500.id })
  expect(saved.hard_disks.length === 1 && saved.hard_disks[0].hdf_id === rec.id && saved.hard_disks[0].controller === 'uae' && saved.hard_disks[0].read_only === true, 'profile saved with the disk attached read-only')
  const row = await page.textContent(`[data-testid=attached-${a500.id}]`)
  expect(row.includes('My A500') && row.includes('Read-only'), 'attachment listed')

  // A1200 with the built-in IDE is fine
  await page.getByLabel('Machine').selectOption({ label: 'My A1200' })
  await page.getByLabel('Connect it through').selectOption('mainboard_ide')
  await page.waitForTimeout(400)
  expect(!(await page.getByRole('button', { name: 'Attach disk' }).isDisabled()), 'A1200 accepts the built-in IDE')
  await page.getByRole('button', { name: 'Attach disk' }).click()
  await page.waitForSelector(`[data-testid=attached-${a1200.id}]`)
  expect((await api('profile_get', { id: a1200.id })).hard_disks[0].controller === 'mainboard_ide', 'saved with mainboard IDE')

  // removal is blocked while attached, with a reason
  expect(await page.getByRole('button', { name: 'Remove from library…' }).isDisabled(), 'cannot remove an attached disk')

  await page.getByRole('button', { name: 'Detach Work from My A500' }).click()
  await page.waitForSelector(`[data-testid=attached-${a500.id}]`, { state: 'detached' })
  expect((await api('profile_get', { id: a500.id })).hard_disks.length === 0, 'detached in the saved profile')
})

test('hdf: removing from the library keeps the original and cleans up the copies', async ({ page, app, api, dir }) => {
  const orig = writeFile(dir, 'work.hdf', fixtures.hdf())
  const before = sha(orig)
  await importHdf(api, orig, 'Work')
  const rec = (await api('hdf_list'))[0]
  await job(api, 'hdf_backup', { id: rec.id, kind: 'backup' })
  await open(page, app)
  await page.getByRole('button', { name: 'Remove from library…' }).click()
  const dlg = await page.textContent('[role=dialog]')
  expect(dlg.includes('never deleted or changed') && dlg.includes('backups and snapshots'), 'confirmation explains what goes and what stays')
  await page.getByRole('button', { name: 'Remove from library', exact: true }).click()
  await page.waitForSelector('text=No hard disks yet')
  expect((await api('hdf_list')).length === 0, 'gone from the library')
  expect(!existsSync(rec.working_path), 'working copy removed')
  expect(existsSync(orig) && sha(orig) === before, 'original untouched')
})

test('hdf: a missing working copy is shown honestly and can be rebuilt from a backup', async ({ page, app, api, dir, shot }) => {
  const orig = writeFile(dir, 'work.hdf', fixtures.hdf())
  await importHdf(api, orig, 'Work')
  const rec = (await api('hdf_list'))[0]
  await job(api, 'hdf_backup', { id: rec.id, kind: 'backup' })
  const before = sha(rec.working_path)
  const { unlinkSync } = await import('node:fs')
  unlinkSync(rec.working_path)
  await open(page, app)
  await page.waitForSelector('text=Working copy missing')
  expect(await page.getByRole('button', { name: 'Back up now' }).isDisabled(), 'cannot back up a missing copy')
  await shot('hdf-missing')
  // Restoring a backup over a missing working file now works: the disk is rebuilt from the backup
  await page.getByRole('tab', { name: /Backups and snapshots/ }).click()
  await page.locator('tr:has-text("Backup") >> button:has-text("Restore")').first().click()
  await page.getByRole('button', { name: 'Restore this version' }).click()
  for (let i = 0; i < 100 && (await api('hdf_list'))[0].working_missing; i++) await new Promise((r) => setTimeout(r, 100))
  expect(existsSync(rec.working_path) && sha(rec.working_path) === before, 'the disk was rebuilt from the backup, byte for byte')
  // removal still works and frees the library entry; the original stays
  await page.getByRole('button', { name: 'Remove from library…' }).click()
  await page.getByRole('button', { name: 'Remove from library', exact: true }).click()
  await page.waitForSelector('text=No hard disks yet')
  expect(existsSync(orig), 'original still there')
})
