// Disk Library e2e: real backend, real UI. Every test checks the screen AND the backend state.
import { chmodSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, fixtures, writeFile } from './harness.mjs'

const URL = 'amiga/disks'

async function waitJob(api, job) {
  for (let i = 0; i < 200; i++) {
    const j = await api('job_get', { id: job })
    if (j.state === 'done') return j.result
    if (j.state === 'failed') throw new Error(`job failed: ${JSON.stringify(j.error)}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('job timed out')
}
const importViaApi = async (api, paths) => waitJob(api, (await api('media_import', { paths })).job)

/** Type a path into the import drop zone and submit it (browser mode has no native dialog). */
async function importPath(page, p) {
  await page.fill('[data-testid=dropzone] input[aria-label="File path"]', p)
  await page.click('[data-testid=dropzone] button[type=submit]')
}
const resultsText = async (page) => {
  await page.waitForSelector('[data-testid=import-result]')
  return page.textContent('[data-testid=import-results]')
}

/** Make a bootable-looking disk with an optional `$VER: workbench.library` string, like a real Workbench disk. */
function wbDisk(label, ver, seed = 0) {
  const d = fixtures.adf(label)
  d[12] = 0x43
  d[13] = 0xfa
  d[14] = 0x00
  d[15] = 0x18
  d.writeUInt32BE(0, 4)
  let sum = 0n
  for (let i = 0; i < 1024; i += 4) {
    sum += BigInt(d.readUInt32BE(i))
    if (sum > 0xffffffffn) sum = (sum & 0xffffffffn) + 1n
  }
  d.writeUInt32BE(Number(~sum & 0xffffffffn), 4)
  if (ver) d.write(`$VER: workbench.library ${ver} (01.01.99)`, 100_000)
  if (seed) d[200_000] = seed
  return d
}

test('disks: ADF import, duplicate detection and library list', async ({ page, app, api, dir, shot }) => {
  const a = writeFile(dir, 'Game1.adf', fixtures.adf('Game1'))
  const b = writeFile(dir, 'Other.adf', fixtures.adf('Other'))
  await app(URL)
  await page.waitForSelector('text=Your disk library is empty')
  await importPath(page, a)
  let t = await resultsText(page)
  expect(t.includes('Imported') && t.includes('Game1'), `shows an imported result: ${t}`)
  await page.waitForSelector('[data-testid=disk-row][data-name="Game1"]')
  const row = await page.textContent('[data-testid=disk-row][data-name="Game1"]')
  expect(row.includes('Untouched original'), 'ADF is shown as an untouched original')
  let list = await api('media_list')
  expect(list.length === 1 && list[0].pristine === true && list[0].kind === 'adf', 'backend has one pristine ADF')

  // the same file again: recognised, nothing added
  await importPath(page, a)
  await page.waitForFunction(() => document.querySelector('[data-testid=import-results]')?.textContent.includes('Already in library'))
  list = await api('media_list')
  expect(list.length === 1, 'duplicate not added twice')

  await importPath(page, b)
  await page.waitForSelector('[data-testid=disk-row][data-name="Other"]')
  expect((await api('media_list')).length === 2, 'second distinct disk added')
  expect((await page.textContent('[data-testid=disk-count]')).includes('2 in library'), 'count shown')

  // search and filter
  await page.fill('input[type=search]', 'game')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=disk-row]').length === 1)
  expect((await page.textContent('[data-testid=disk-count]')).includes('1 of 2'), 'search narrows the list')
  await page.fill('input[type=search]', '')
  await page.click('button:has-text("Working copies")')
  await page.waitForSelector('text=No disks match')
  await page.click('button:has-text("Untouched originals")')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=disk-row]').length === 2)
  await shot('disks-list')
})

test('disks: DMS import keeps the archive and creates an ADF', async ({ page, app, api, dir, shot }) => {
  const p = writeFile(dir, 'Packed.dms', fixtures.dms(fixtures.adf('PackedDisk')))
  await app(URL)
  await importPath(page, p)
  const t = await resultsText(page)
  expect(t.includes('Imported') && t.includes('DMS archive is kept') && t.includes('Converted to a disk image'), `explains DMS handling: ${t}`)
  const list = await api('media_list')
  const adf = list.find((m) => m.kind === 'adf')
  const dms = list.find((m) => m.kind === 'dms')
  expect(adf && dms, 'both archive and ADF exist')
  expect(adf.source_dms_id === dms.id, 'ADF points at its archive')
  await page.waitForSelector('[data-testid=disk-row][data-name="PackedDisk"]')
  const rowText = await page.textContent('[data-testid=disk-row][data-name="PackedDisk"]')
  expect(rowText.includes('From DMS'), 'ADF is badged From DMS')
  await page.click('button:has-text("DMS archives")')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=disk-row]').length === 1)
  expect((await page.textContent('[data-testid=disk-row]')).includes('DMS archive'), 'archive filter shows the archive')
  await shot('disks-dms')

  // deleting the archive while its ADF exists is refused with a readable reason
  await page.click('[aria-label^="Delete "]')
  await page.click('.modal button:has-text("Delete disk")')
  await page.waitForSelector('.toast.error')
  const msg = await page.textContent('.toast.error')
  expect(msg.includes('converted from this archive'), `refusal is readable: ${msg}`)
  expect((await api('media_list')).length === 2, 'nothing deleted')
})

test('disks: corrupt and missing files are rejected with readable messages', async ({ page, app, api, dir }) => {
  const junk = Buffer.alloc(1000, 7)
  const bad = writeFile(dir, 'junk.adf', junk)
  await app(URL)
  await importPath(page, bad)
  let t = await resultsText(page)
  expect(t.includes('Not imported'), `reports failure: ${t}`)
  expect(!t.includes('[object') && !t.includes('undefined'), 'message is readable')
  expect((await api('media_list')).length === 0, 'nothing imported')
  await importPath(page, path.join(dir, 'does-not-exist.adf'))
  await page.waitForFunction(() => document.querySelector('[data-testid=import-results]')?.textContent.includes('does-not-exist'))
  t = await page.textContent('[data-testid=import-results]')
  expect(t.includes('Not imported') && t.includes('cannot read'), `missing file explained: ${t}`)
  // a bad DMS
  const baddms = fixtures.dms(fixtures.adf('X'))
  baddms[100] ^= 0xff
  baddms[2000] ^= 0xff
  await importPath(page, writeFile(dir, 'broken.dms', baddms))
  await page.waitForFunction(() => document.querySelector('[data-testid=import-results]')?.textContent.includes('broken.dms'))
  expect((await page.textContent('[data-testid=import-results]')).includes('Not imported'), 'broken DMS rejected')
  expect((await api('media_list')).length === 0, 'still nothing imported')
})

test('disks: working copy leaves the original untouched', async ({ page, app, api, dir, shot }) => {
  const p = writeFile(dir, 'Orig.adf', fixtures.adf('Orig'))
  await api('media_import', { paths: [p] }).then((r) => waitJob(api, r.job))
  await app(URL)
  await page.click('[aria-label="Make a working copy of Orig"]')
  await page.waitForSelector('text=A working copy is a separate disk')
  await shot('disks-working-copy-dialog')
  await page.fill('.modal input', 'Orig play copy')
  await page.click('.modal button:has-text("Make working copy")')
  await page.waitForSelector('[data-testid=disk-row][data-name="Orig play copy"]')
  const text = await page.textContent('[data-testid=disk-row][data-name="Orig play copy"]')
  expect(text.includes('Working copy'), 'copy is badged Working copy')
  const list = await api('media_list')
  const orig = list.find((m) => m.name === 'Orig')
  const copy = list.find((m) => m.name === 'Orig play copy')
  expect(orig.pristine === true && copy.pristine === false && copy.parent_id === orig.id, 'backend relations correct')
  expect(copy.sha256 === orig.sha256, 'copy has identical contents')
  await page.click('button:has-text("Working copies")')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=disk-row]').length === 1)
})

test('disks: details, integrity check detects tampering', async ({ page, app, api, dir, shot }) => {
  const p = writeFile(dir, 'Detail.adf', wbDisk('Detail', null))
  await waitJob(api, (await api('media_import', { paths: [p] })).job)
  await app(URL)
  await page.click('button[aria-label="Details for Detail"]')
  await page.waitForSelector('[role=dialog] >> text=Fingerprint (SHA-256)')
  const d = await page.textContent('[role=dialog]')
  const rec = (await api('media_list'))[0]
  expect(d.includes(rec.sha256), 'full hash in detail')
  expect(d.includes('Bootable'), 'boot status shown')
  expect(d.includes('Untouched original'), 'origin shown')
  expect(d.includes('copy protection'), 'ADF limitation stated')
  await page.click('button:has-text("Check integrity")')
  await page.waitForSelector('text=The stored file matches its fingerprint exactly')
  await shot('disks-detail')
  // tamper with the stored library file behind the app's back
  chmodSync(rec.path, 0o644)
  const buf = readFileSync(rec.path)
  buf[5000] ^= 0xff
  writeFileSync(rec.path, buf)
  await page.click('button:has-text("Check integrity")')
  await page.waitForSelector('text=The file has changed')
})

test('disks: export refuses to overwrite unless asked', async ({ page, app, api, dir }) => {
  const src = fixtures.adf('Exp')
  const p = writeFile(dir, 'Exp.adf', src)
  await waitJob(api, (await api('media_import', { paths: [p] })).job)
  const dest = path.join(dir, 'out-Exp.adf')
  await app(URL)
  await page.click('[aria-label="Export Exp"]')
  await page.fill('.modal input.input', dest)
  await page.click('.modal button:has-text("Export")')
  await page.waitForSelector('.toast.success')
  expect(existsSync(dest) && readFileSync(dest).equals(src), 'exported file is identical')

  // second export to the same place is refused with an explanation
  await page.click('[aria-label="Export Exp"]')
  await page.fill('.modal input.input', dest)
  await page.click('.modal button:has-text("Export")')
  await page.waitForSelector('.modal [role=alert]')
  const err = await page.textContent('.modal [role=alert]')
  expect(/exist/i.test(err), `refusal explains the file exists: ${err}`)
  // tick overwrite -> explicit confirmation -> done
  await page.click('.modal >> text=Replace the file if it already exists')
  await page.click('.modal button:has-text("Export")')
  await page.waitForSelector('text=Replace the existing file?')
  await page.click('.modal button:has-text("Replace file")')
  await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 0)
  expect(readFileSync(dest).equals(src), 'file still correct after confirmed overwrite')
})

test('disks: create blank disks (OFS standard and FFS high density)', async ({ page, app, api, shot }) => {
  await app(URL)
  await page.click('button:has-text("Create blank disk")')
  await page.fill('.modal input >> nth=0', 'Scratch')
  await page.selectOption('.modal select >> nth=1', 'ofs')
  await shot('disks-create-blank')
  await page.click('.modal button:has-text("Create disk")')
  await page.waitForSelector('[data-testid=disk-row][data-name="Scratch"]')
  let list = await api('media_list')
  let m = list.find((x) => x.name === 'Scratch')
  expect(m.pristine === false && m.size === 901120 && m.info.adf.fs === 'ofs', `OFS double density disk: ${JSON.stringify(m.info.adf.summary)}`)
  expect((await page.textContent('[data-testid=disk-row][data-name="Scratch"]')).includes('Writable disk'), 'blank disk is badged as writable')

  await page.click('button:has-text("Create blank disk")')
  await page.fill('.modal input >> nth=0', 'BigOne')
  await page.selectOption('.modal select >> nth=0', 'high')
  await page.click('.modal button:has-text("Create disk")')
  await page.waitForSelector('[data-testid=disk-row][data-name="BigOne"]')
  list = await api('media_list')
  m = list.find((x) => x.name === 'BigOne')
  expect(m.size === 1802240 && m.info.adf.density === 'high' && m.info.adf.fs === 'ffs', 'FFS high density disk')
})

test('disks: delete is confirmed and refused while a machine uses the disk', async ({ page, app, api, dir }) => {
  const p = writeFile(dir, 'Busy.adf', fixtures.adf('Busy'))
  await waitJob(api, (await api('media_import', { paths: [p] })).job)
  const disk = (await api('media_list'))[0]
  const prof = await api('profile_from_preset', { preset_id: 'a500', name: 'Test machine' })
  prof.drives[0].media_id = disk.id
  await api('profile_save', { profile: prof })
  await app(URL)
  // cancel keeps it
  await page.click('[aria-label="Delete Busy"]')
  await page.waitForSelector('text=Delete “Busy”?')
  await page.click('.modal button:has-text("Cancel")')
  expect((await api('media_list')).length === 1, 'cancel keeps the disk')
  // confirm -> backend refuses, message is shown
  await page.click('[aria-label="Delete Busy"]')
  await page.click('.modal button:has-text("Delete disk")')
  await page.waitForSelector('.toast.error')
  const msg = await page.textContent('.toast.error')
  expect(msg.includes('Test machine'), `refusal names the machine: ${msg}`)
  expect((await api('media_list')).length === 1, 'still in library')
  // free it, then delete for real
  prof.drives[0].media_id = null
  await api('profile_save', { profile: prof })
  await page.click('[aria-label="Delete Busy"]')
  await page.click('.modal button:has-text("Delete disk")')
  await page.waitForSelector('text=Your disk library is empty')
  expect((await api('media_list')).length === 0, 'deleted')
})

test('disks: queues can be built, reordered, saved and deleted', async ({ page, app, api, dir, shot }) => {
  const paths = ['Disk A', 'Disk B', 'Disk C'].map((n) => writeFile(dir, `${n}.adf`, fixtures.adf(n)))
  await waitJob(api, (await api('media_import', { paths })).job)
  await app(URL)
  await page.click('[role=tab]:has-text("Queues")')
  await page.click('button:has-text("New queue")')
  await page.fill('input[placeholder^="For example"]', 'Trilogy')
  await page.click('button:has-text("Add disks")')
  for (const n of ['Disk A', 'Disk B', 'Disk C']) await page.check(`.modal input[aria-label="${n}"], .modal label:has-text("${n}") input`)
  await page.click('.modal button:has-text("Add to queue")')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=queue-disk]').length === 3)
  // move C up one place: A, C, B
  await page.click('[aria-label="Move Disk C up"]')
  await page.click('button:has-text("Save queue")')
  await page.waitForSelector('.toast.success')
  const names = async () => {
    const media = await api('media_list')
    const q = (await api('queue_list'))[0]
    return q.media_ids.map((id) => media.find((m) => m.id === id).name)
  }
  expect(JSON.stringify(await names()) === JSON.stringify(['Disk A', 'Disk C', 'Disk B']), `saved order: ${JSON.stringify(await names())}`)
  await shot('disks-queue')
  // reload the page: order is persisted
  await page.reload()
  await page.click('[role=tab]:has-text("Queues")')
  await page.click('button.dl-qitem:has-text("Trilogy")')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=queue-disk]').length === 3)
  const shown = await page.$$eval('[data-testid=queue-disk]', (els) => els.map((e) => e.textContent))
  expect(shown[0].includes('Disk A') && shown[1].includes('Disk C') && shown[2].includes('Disk B'), 'order after reload')
  // a disk that is in a queue cannot be deleted from the library
  await page.click('[role=tab]:has-text("Disks")')
  await page.click('[aria-label="Delete Disk A"]')
  await page.click('.modal button:has-text("Delete disk")')
  await page.waitForSelector('.toast.error')
  expect((await page.textContent('.toast.error')).includes('Trilogy'), 'refusal names the queue')
  // remove the queue
  await page.click('[role=tab]:has-text("Queues")')
  await page.click('button.dl-qitem:has-text("Trilogy")')
  await page.click('button:has-text("Delete queue")')
  await page.click('.modal button:has-text("Delete queue")')
  await page.waitForSelector('text=No queues yet')
  expect((await api('queue_list')).length === 0, 'queue deleted in backend')
})

async function setupWorkbench(api, dir, spec) {
  const paths = spec.map(([label, ver, seed]) => writeFile(dir, `${label}.adf`, wbDisk(label, ver, seed)))
  await waitJob(api, (await api('media_import', { paths })).job)
}

test('disks: Workbench set analysis, Kickstart check and saved sets', async ({ page, app, api, dir, shot }) => {
  await setupWorkbench(api, dir, [
    ['Workbench3.1', '40.42'],
    ['Install3.1', null],
    ['Fonts3.1', null],
    ['Zool', null],
  ])
  const k40 = writeFile(dir, 'kick40.rom', fixtures.rom(40, 68, 0x80000))
  const k37 = writeFile(dir, 'kick37.rom', fixtures.rom(37, 175, 0x80000))
  await api('rom_import', { paths: [k40, k37], copy: true })
  await app(URL)
  await page.click('[role=tab]:has-text("Workbench")')
  await page.waitForSelector('[data-testid=wb-disks]')
  // Zool is not suggested, the three Workbench disks are
  await page.click('button:has-text("Select suggested disks (3)")')
  await page.click('button:has-text("Check these disks")')
  await page.waitForSelector('[data-testid=wb-analysis]')
  const t = await page.textContent('[data-testid=wb-analysis]')
  expect(t.includes('Workbench 3.1') && t.includes('Version confirmed'), `3.1 confirmed: ${t}`)
  expect(t.includes('40.42') && t.includes('as expected'), 'revision shown against expected')
  expect(t.includes('scans the disk image for version text'), 'explains that detection scans for strings')
  const missing = await page.textContent('[data-testid=wb-missing]')
  expect(missing.includes('Extras') && missing.includes('Storage') && missing.includes('Locale') && !missing.includes('Install'), `missing roles: ${missing}`)
  const rows = await page.$$eval('[data-testid=wb-row]', (els) => els.map((e) => e.dataset.role))
  expect(rows.join() === 'workbench,install,fonts' || [...rows].sort().join() === 'fonts,install,workbench', `roles classified: ${rows}`)

  // Kickstart: the 3.1 ROM suits, the 2.0-era ROM does not
  await page.waitForSelector('[data-testid=ks-status] >> text=suits Workbench 3.1')
  const romOpts = await page.$$eval('select option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })))
  const old = romOpts.find((o) => /37\./.test(o.t))
  expect(old, `a 37.x ROM is offered: ${JSON.stringify(romOpts)}`)
  await page.selectOption('select >> nth=1', old.v)
  await page.waitForSelector('[data-testid=ks-status] >> text=needs a newer Kickstart')
  await shot('disks-workbench-analysis')

  // save, list, reload, delete
  await page.click('button:has-text("Save this set")')
  await page.waitForSelector('[data-testid=wb-saved][data-name="Workbench 3.1"]')
  const saved = await api('workbench_list')
  expect(saved.length === 1 && saved[0].version === '3.1' && saved[0].disks.length === 3, 'set saved in backend')
  await page.reload()
  await page.click('[role=tab]:has-text("Workbench")')
  await page.waitForSelector('[data-testid=wb-saved][data-name="Workbench 3.1"]')
  await page.click('[aria-label="Delete the set Workbench 3.1"]')
  await page.click('.modal button:has-text("Delete set")')
  await page.waitForSelector('text=No saved sets yet')
  expect((await api('workbench_list')).length === 0, 'set deleted in backend')
  expect((await api('media_list')).length === 4, 'deleting a set keeps the disks')
})

test('disks: Workbench problems are reported (wrong revision, mixed releases, duplicates, no boot block)', async ({ page, app, api, dir }) => {
  // a Workbench 3.1 disk that is not bootable and carries the wrong revision
  const nobootWb = fixtures.adf('Workbench3.1')
  nobootWb.write('$VER: workbench.library 40.40 (x)', 100_000)
  const files = [
    writeFile(dir, 'Workbench3.1.adf', nobootWb),
    writeFile(dir, 'Workbench2.1.adf', wbDisk('Workbench2.1', '38.36')),
    writeFile(dir, 'Workbench3.1b.adf', wbDisk('Workbench3.1b', '40.42', 9)),
  ]
  await waitJob(api, (await api('media_import', { paths: files })).job)
  await app(URL)
  await page.click('[role=tab]:has-text("Workbench")')
  await page.check('input[aria-label="Use Workbench3.1"]')
  await page.check('input[aria-label="Use Workbench2.1"]')
  await page.check('input[aria-label="Use Workbench3.1b"]')
  await page.click('button:has-text("Check these disks")')
  await page.waitForSelector('[data-testid=wb-warnings]')
  const w = await page.textContent('[data-testid=wb-warnings]')
  expect(w.includes('different Workbench releases'), `mixed releases: ${w}`)
  const dup = await page.textContent('[data-testid=wb-duplicates]')
  expect(dup.includes('Workbench'), 'duplicate Workbench disks reported')
  // the install button is blocked and says why
  const b = await page.textContent('[data-testid=wb-blockers]')
  expect(b.includes('No Install disk'), `blocked without an Install disk: ${b}`)
  expect(await page.isDisabled('button:has-text("Create a machine for the installation")'), 'cannot create the machine')

  // just the non-bootable disk with the wrong revision
  await page.uncheck('input[aria-label="Use Workbench2.1"]')
  await page.uncheck('input[aria-label="Use Workbench3.1b"]')
  await page.click('button:has-text("Check these disks")')
  await page.waitForFunction(() => document.querySelector('[data-testid=wb-warnings]')?.textContent.includes('40.40'))
  const w2 = await page.textContent('[data-testid=wb-warnings]')
  expect(w2.includes('40.40') && w2.includes('40.42'), `wrong revision explained: ${w2}`)
  expect(w2.includes('no valid boot block'), `non-bootable Workbench explained: ${w2}`)
  expect((await page.textContent('[data-testid=wb-analysis]')).includes('Version not confirmed'), 'not confirmed')
})

test('disks: Workbench install creates a validated, saved machine', async ({ page, app, api, dir, shot }) => {
  await setupWorkbench(api, dir, [
    ['Workbench3.1', '40.42'],
    ['Install3.1', null],
  ])
  await api('rom_import', { paths: [writeFile(dir, 'kick40.rom', fixtures.rom(40, 68, 0x80000))], copy: true })
  const hdfPath = writeFile(dir, 'work.hdf', fixtures.hdf())
  await waitJob(api, (await api('hdf_import', { path: hdfPath, name: 'Work drive', keep_pristine: true })).job)
  await app(URL)
  await page.click('[role=tab]:has-text("Workbench")')
  await page.click('button:has-text("Select suggested disks (2)")')
  await page.click('button:has-text("Check these disks")')
  await page.waitForSelector('[data-testid=ks-status] >> text=suits Workbench 3.1')
  // honest about what is automated
  const step4 = await page.textContent('text=The installation itself happens inside the emulated Amiga >> xpath=../..')
  expect(step4.includes('cannot install Workbench for you'), 'states the install is manual')
  const hdfOpt = (await page.$$eval('select option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })))).find((o) => o.t.includes('Work drive'))
  await page.selectOption('select >> nth=2', hdfOpt.v)
  await shot('disks-workbench-install')
  await page.click('button:has-text("Create a machine for the installation")')
  await page.waitForSelector('[data-testid=open-emulator]')
  const profiles = await api('profile_list')
  const p = profiles.find((x) => x.name === 'Workbench install')
  const media = await api('media_list')
  expect(p, 'profile saved')
  expect(p.model === 'a1200', `A1200 for Workbench 3.1: ${p.model}`)
  expect(p.drives[0].media_id === media.find((m) => m.name === 'Workbench3.1').id, 'DF0 = Workbench disk')
  expect(p.drives[1].media_id === media.find((m) => m.name === 'Install3.1').id, 'DF1 = Install disk')
  expect(p.drives[0].kind === 'dd35' && p.drives[1].kind === 'dd35' && p.drives[2].kind === 'disabled', 'drive kinds')
  expect(p.rom_id && p.hard_disks.length === 1 && p.hard_disks[0].controller === 'mainboard_ide', 'ROM and IDE hard disk attached')
  expect((await page.getAttribute('[data-testid=open-emulator]', 'href')) === '#/amiga/emulator', 'links to the emulator')
  // a second run does not clash with the first name
  await page.click('button:has-text("Create a machine for the installation")')
  await page.waitForSelector('text=/Workbench install 2. is ready/')
  const names = (await api('profile_list')).map((x) => x.name)
  expect(names.includes('Workbench install') && names.includes('Workbench install 2'), `second machine saved with a distinct name: ${names}`)
})
