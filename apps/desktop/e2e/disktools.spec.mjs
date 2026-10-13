// XCOPY / Disk Tools against the real backend: every copy is checked on screen, through the API
// and on disk (hashes).
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, fixtures, writeFile } from './harness.mjs'

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const shaBuf = (b) => createHash('sha256').update(b).digest('hex')

async function job(api, cmd, args) {
  const { job: id } = await api(cmd, args)
  for (;;) {
    const j = await api('job_get', { id })
    if (j.state === 'done') return j.result
    if (j.state === 'failed') throw new Error(`${cmd}: ${j.error?.message}`)
    await new Promise((r) => setTimeout(r, 60))
  }
}
const importAdf = async (api, p) => (await job(api, 'media_import', { paths: [p] }))[0].ok.record

async function open(page, app) {
  await app('amiga/tools')
  try {
    await page.waitForSelector('h1:has-text("XCOPY")', { timeout: 10000 })
  } catch {
    await page.reload()
    await page.waitForSelector('h1:has-text("XCOPY")')
  }
}
const copyBtn = (page) => page.getByRole('button', { name: 'Copy disk', exact: true })

test('disktools: copy a library disk to a new image, verified, with matching hashes', async ({ page, app, api, dir, shot }) => {
  const adf = fixtures.adf('Source')
  const src = await importAdf(api, writeFile(dir, 'source.adf', adf))
  await open(page, app)
  const t0 = await page.textContent('body')
  expect(t0.includes('cannot reproduce copy protection'), 'states the limitation')
  expect(t0.includes('Nothing has been copied yet'), 'empty history is honest')
  expect(await copyBtn(page).isDisabled(), 'copy is disabled until a source is chosen')
  await page.getByLabel('Source disk').selectOption({ label: src.name + ' (original)' })
  expect((await page.getByLabel('Name of the new disk').inputValue()) === `Copy of ${src.name}`, 'a name is proposed')
  expect(await page.getByRole('switch', { name: 'Verify after copying' }).isChecked(), 'verify defaults on')
  await shot('disktools-form')
  await copyBtn(page).click()
  await page.waitForSelector('[data-testid=copy-report]')
  const rep = await page.textContent('[data-testid=copy-report]')
  for (const s of ['Copy complete', 'Identical to the source', 'Yes, read back and compared', adf.length.toLocaleString(), shaBuf(adf)]) expect(rep.includes(s), `report shows "${s}"`)
  await page.waitForSelector('text=Copy complete >> nth=0')
  await shot('disktools-result')
  const media = await api('media_list')
  const copy = media.find((m) => m.name === `Copy of ${src.name}`)
  expect(copy && !copy.pristine && sha(copy.path) === shaBuf(adf), 'a new, writable library disk with identical content exists')
  expect(sha(src.path) === shaBuf(adf), 'source untouched')
  // history in plain words
  const hist = await page.textContent('[data-testid=history]')
  expect(hist.includes('Completed') && hist.includes(`Library disk “${src.name}”`) && hist.includes(`New library disk “Copy of ${src.name}”`), 'history is readable')
  expect(!hist.includes('media_id') && !hist.includes('NewLibraryImage'), 'no raw debug text in the history')
})

test('disktools: untouched originals are shown disabled as a target and refused by the backend', async ({ page, app, api, dir, shot }) => {
  const a = await importAdf(api, writeFile(dir, 'a.adf', fixtures.adf('Alpha')))
  await open(page, app)
  await page.getByRole('radio', { name: /An existing working copy/ }).check()
  const opt = page.getByLabel('Working copy to overwrite').locator('option', { hasText: a.name })
  expect(await opt.isDisabled(), 'the pristine disk cannot be picked')
  expect((await opt.textContent()).includes('untouched original'), 'the reason is shown')
  await shot('disktools-pristine-disabled')
  // the backend refuses it too
  let msg = ''
  try {
    await job(api, 'copy_disk', { source: { type: 'file', path: writeFile(dir, 'b.adf', fixtures.adf('Beta')) }, target: { type: 'library', media_id: a.id }, options: { verify: true, overwrite: true, backup_existing: true } })
  } catch (e) {
    msg = e.message
  }
  expect(msg.includes('untouched original'), `backend refusal: ${msg}`)
  // and the failure is in the history, readable
  await page.reload()
  await page.waitForSelector('h1:has-text("XCOPY")')
  const hist = await page.textContent('[data-testid=history]')
  expect(hist.includes('Failed') && hist.includes('untouched original'), 'history shows the refusal')
})

test('disktools: overwriting a working copy needs explicit consent and keeps a backup', async ({ page, app, api, dir, shot }) => {
  const orig = await importAdf(api, writeFile(dir, 'orig.adf', fixtures.adf('Orig')))
  const work = await api('media_working_copy', { id: orig.id, name: 'My work' })
  const other = fixtures.adf('Other')
  const otherPath = writeFile(dir, 'other.adf', other)
  const workBefore = sha(work.path)
  await open(page, app)
  await page.getByRole('radio', { name: 'A file on this computer' }).check()
  await page.getByLabel('Disk file').fill(otherPath)
  await page.getByRole('radio', { name: /An existing working copy/ }).check()
  await page.getByLabel('Working copy to overwrite').selectOption({ label: 'My work' })
  const warn = await page.textContent('body')
  expect(warn.includes('“My work” will be replaced'), 'clear warning about the destination')
  expect(!(await page.getByRole('switch', { name: 'Allow overwriting' }).isChecked()), 'overwrite defaults off')
  expect(await copyBtn(page).isDisabled(), 'cannot copy until overwrite is allowed')
  expect(await page.getByRole('switch', { name: 'Back up the destination first' }).isChecked(), 'backup defaults on')
  await shot('disktools-overwrite-warning')
  await page.getByRole('switch', { name: 'Allow overwriting' }).check()
  await copyBtn(page).click()
  await page.waitForSelector('[data-testid=copy-report]')
  const rep = await page.textContent('[data-testid=copy-report]')
  expect(sha(work.path) === shaBuf(other), 'working copy now holds the new content')
  const m = /Old contents backed up to([^\n]*)/.exec(rep)
  const backupPath = (await api('operations_list')).length && rep.match(/\/[^\s]*xcopy[^\s]*\.adf/)?.[0]
  expect(backupPath && existsSync(backupPath) && sha(backupPath) === workBefore, `the old contents were backed up (${m?.[1]})`)
  const after = (await api('media_list')).find((x) => x.id === work.id)
  expect(after.sha256 === shaBuf(other), 'the library records the new hash')
})

test('disktools: exporting to a file refuses an existing file unless overwriting, and refuses copying a file onto itself', async ({ page, app, api, dir }) => {
  const adf = fixtures.adf('Exp')
  const srcPath = writeFile(dir, 'exp.adf', adf)
  const dest = writeFile(dir, 'target.adf', 'important')
  await open(page, app)
  await page.getByRole('radio', { name: 'A file on this computer' }).check()
  await page.getByLabel('Disk file').fill(srcPath)
  await page.getByRole('radio', { name: /Save as a file/ }).check()
  await page.getByLabel('Save as', { exact: true }).fill(dest)
  expect(!(await copyBtn(page).isDisabled()), 'can try')
  await copyBtn(page).click()
  await page.waitForSelector('text=The disk was not copied')
  const err = await page.textContent('[role=alert]')
  expect(err.includes('already exists') && err.includes('Allow overwriting'), 'refusal is readable')
  expect(readFileSync(dest, 'utf8') === 'important', 'existing file untouched')
  await page.getByRole('switch', { name: 'Allow overwriting' }).check()
  await copyBtn(page).click()
  await page.waitForSelector('[data-testid=copy-report]')
  expect(sha(dest) === shaBuf(adf), 'file replaced once allowed')
  // same file
  await page.getByLabel('Save as', { exact: true }).fill(srcPath)
  await copyBtn(page).click()
  await page.waitForSelector('text=same file')
  expect(sha(srcPath) === shaBuf(adf), 'source intact')
})

test('disktools: DMS archive to ADF file, and a corrupt DMS gives a readable error', async ({ page, app, api, dir, shot }) => {
  const adf = fixtures.adf('FromDms')
  const dms = writeFile(dir, 'game.dms', fixtures.dms(adf))
  const out = path.join(dir, 'out', 'game.adf')
  await open(page, app)
  await page.getByRole('radio', { name: 'A file on this computer' }).check()
  await page.getByLabel('Disk file').fill(dms)
  await page.getByRole('radio', { name: /Save as a file/ }).check()
  await page.getByLabel('Save as', { exact: true }).fill(out)
  await copyBtn(page).click()
  await page.waitForSelector('[data-testid=copy-report]')
  expect(existsSync(out) && sha(out) === shaBuf(adf), 'the unpacked ADF is byte-identical to the original disk')
  expect((await page.textContent('[data-testid=copy-report]')).includes('Identical to the source'), 'shown as identical')
  await shot('disktools-dms')

  const bad = Buffer.from(fixtures.dms(adf))
  bad.fill(0xee, 200, 4000)
  const badPath = writeFile(dir, 'bad.dms', bad)
  await page.getByLabel('Disk file').fill(badPath)
  await page.getByLabel('Save as', { exact: true }).fill(path.join(dir, 'out', 'bad.adf'))
  await copyBtn(page).click()
  await page.waitForSelector('text=The disk was not copied')
  const err = await page.textContent('[role=alert]')
  expect(/DMS|archive|checksum|corrupt/i.test(err), `readable DMS error: ${err}`)
  expect(!existsSync(path.join(dir, 'out', 'bad.adf')), 'nothing written for a bad archive')
  const hist = await page.textContent('[data-testid=history]')
  expect(hist.includes('Failed') && hist.includes('Completed'), 'history has the success and the failure')
  const ops = await api('operations_list')
  expect(ops.length === 2 && ops.some((o) => o.status === 'failed') && ops.some((o) => o.status === 'done' && o.verified), 'backend history agrees')
  await shot('disktools-history')
})

test('disktools: copying between drives explains when no machine runs', async ({ page, app }) => {
  await open(page, app)
  await page.getByRole('tab', { name: 'Copy between drives' }).click()
  await page.waitForSelector('text=No machine is running')
  const link = page.getByRole('link', { name: 'Go to the Emulator' })
  expect((await link.getAttribute('href')) === '#/amiga/emulator', 'links to the Emulator')
  expect((await page.textContent('body')).includes('Copy a disk image'), 'points to the alternative')
  await page.screenshot({ path: path.join(process.cwd(), 'e2e/artifacts/disktools-drives-idle.png') })
})

test('disktools: real Amiga disk copy explains itself and builds a validated four-drive machine', async ({ page, app, api, dir, shot }) => {
  const xc = await importAdf(api, writeFile(dir, 'mycopier.adf', fixtures.adf('MyCopier')))
  await open(page, app)
  await page.getByRole('tab', { name: 'Real Amiga disk copy' }).click()
  const t = await page.textContent('body')
  expect(t.includes('does not include XCOPY'), 'says XCOPY is not included')
  const create = page.getByRole('button', { name: 'Create the disk-copy machine' })
  expect(await create.isDisabled(), 'needs a ROM')
  expect((await page.textContent('body')).includes('No ROMs imported yet'), 'honest about the missing ROM')
  await shot('disktools-real-noroms')
  const imported = await api('rom_import', { paths: [writeFile(dir, 'k13.rom', fixtures.rom(34, 5))] })
  const rom = imported[0].ok.record
  await page.reload()
  await page.waitForSelector('h1:has-text("XCOPY")')
  await page.getByRole('tab', { name: 'Real Amiga disk copy' }).click()
  await page.getByLabel('Kickstart ROM').selectOption(rom.id)
  await page.getByLabel(/Your copy program disk/).selectOption(xc.id)
  expect(!(await create.isDisabled()), 'ready once a ROM is chosen')
  await shot('disktools-real-form')
  await create.click()
  await page.waitForSelector('text=“Disk copy station” is ready')
  const p = (await api('profile_list')).find((x) => x.name === 'Disk copy station')
  expect(p && p.model === 'a500' && p.rom_id === rom.id, 'profile saved with the chosen ROM')
  expect(p.drives.every((d) => d.kind === 'dd35'), 'all four drives are DD floppy drives')
  expect(p.drives[0].media_id === xc.id && p.drives[0].write_protect === true, 'XCOPY disk is in DF0, write-protected')
  expect((await page.getByRole('link', { name: 'Open the Emulator' }).getAttribute('href')) === '#/amiga/emulator', 'links to the Emulator')
})
