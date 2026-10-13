import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, fixtures, writeFile } from './harness.mjs'

const openDiagnostics = async (page, app) => {
  await app('amiga/help')
  await page.click('role=tab[name="Diagnostics"]')
  await page.waitForSelector('[data-testid=run-selfcheck]')
}
const runCheck = async (page) => {
  await page.click('[data-testid=run-selfcheck]')
  await page.waitForSelector('[data-testid=selfcheck-summary]')
}
const row = (page, id) => page.getAttribute(`[data-testid=check-${id}]`, 'data-status')

test('help: getting-started topics are collapsible and cover the essentials', async ({ page, app, shot }) => {
  await app('amiga/help')
  await page.waitForSelector('[data-testid=topics]')
  const n = await page.locator('[data-testid=topics] details').count()
  expect(n >= 10, `${n} topics`)
  const all = await page.textContent('[data-testid=topics]')
  for (const s of ['Import a Kickstart ROM', 'Set up Workbench', 'Insert floppy disks', 'hard disk file (HDF)', 'Backups and snapshots', 'Copy disks', "aren't named boards", 'Compatibility and Performance', 'Mouse capture', 'not included or not supported'])
    expect(all.includes(s), `topic ${s}`)
  // honest statements are present
  for (const s of ['No Amiga software is bundled', 'copy protection', 'Windows builds cannot be controlled', 'generic emulated configurations', 'not cycle-exact', 'memory only'])
    expect(all.replace(/\s+/g, ' ').includes(s), `says: ${s}`)
  // open/close with the keyboard
  const first = page.locator('[data-testid=topics] details >> nth=1 >> summary')
  await first.focus()
  expect(!(await page.evaluate(() => document.querySelectorAll('[data-testid=topics] details')[1].open)), 'starts collapsed')
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => document.querySelectorAll('[data-testid=topics] details')[1].open), 'Enter opens a topic')
  await page.keyboard.press('Enter')
  expect(!(await page.evaluate(() => document.querySelectorAll('[data-testid=topics] details')[1].open)), 'Enter closes it again')
  await page.evaluate(() => document.querySelectorAll('[data-testid=topics] details')[4].setAttribute('open', ''))
  await shot('help-getting-started')
})

test('help: About shows licensing and where the details live', async ({ page, app, shot }) => {
  await app('amiga/help')
  await page.click('role=tab[name="About and licensing"]')
  const t = (await page.textContent('main')).replace(/\s+/g, ' ')
  for (const s of ['GPL-3.0-or-later', 'Amiberry', 'WinUAE', 'separate program', 'xdms-rs', 'MIT or Apache-2.0', 'No proprietary Amiga software is bundled', 'docs/amiga-studio/licensing.md'])
    expect(t.includes(s), `About mentions ${s}`)
  await shot('help-about')
})

test('help: self-check on a fresh library reports real results from the backend', async ({ page, app, api, shot }) => {
  await openDiagnostics(page, app)
  const info = await api('app_info')
  expect((await page.textContent('[data-testid=diag-root]')) === info.storage_root, 'shows the real storage root')
  expect((await page.textContent('[data-testid=diag-engine]')).includes('Not found'), 'engine not installed here, and says so')
  await runCheck(page)
  expect((await row(page, 'engine')) === 'fail', 'engine fails when Amiberry is missing')
  expect((await row(page, 'library')) === 'pass', 'library readable')
  expect((await row(page, 'recover')) === 'pass', 'nothing to recover')
  expect((await row(page, 'orphans')) === 'pass', 'no stray files')
  expect((await row(page, 'roms')) === 'warn', 'no ROM imported is a warning')
  expect((await row(page, 'media')) === 'pass', 'disk images fine')
  expect((await row(page, 'hdf')) === 'pass', 'hard disks fine')
  expect((await row(page, 'space')) === 'pass', 'space fine')
  expect((await row(page, 'machines')) === 'pass', 'seeded machines have no configuration errors')
  const sum = await page.textContent('[data-testid=selfcheck-summary]')
  expect(/1 failed/.test(sum) && /warning/.test(sum), `summary counts: ${sum}`)
  expect((await page.textContent('[data-testid=check-roms]')).includes('Import one in the ROM Library'), 'tells you the fix')
  expect((await page.textContent('[data-testid=check-library]')).includes(info.storage_root), 'library row shows the real path')
  expect((await page.textContent('main')).includes('No machine has been started yet'), 'no sessions yet')
  await shot('help-selfcheck-fresh')
})

test('help: self-check finds missing referenced files and stray files, and does not delete anything', async ({ page, app, api, dir }) => {
  // ROM referenced in place, then its file disappears
  const romPath = writeFile(dir, 'ks.rom', fixtures.rom(40, 68, 0x80000))
  await api('rom_import', { paths: [romPath], copy: false })
  unlinkSync(romPath)
  // a managed floppy whose file vanishes
  const adf = writeFile(dir, 'Gone.adf', fixtures.adf('Gone'))
  const { job } = await api('media_import', { paths: [adf] })
  for (;;) {
    const j = await api('job_get', { id: job })
    if (j.state !== 'running') break
    await new Promise((r) => setTimeout(r, 50))
  }
  const media = await api('media_list')
  unlinkSync(media[0].path)
  // a stray file in a managed folder
  const stray = path.join(path.dirname(media[0].path), 'stray-file.adf')
  writeFileSync(stray, 'x')
  await openDiagnostics(page, app)
  await runCheck(page)
  expect((await row(page, 'roms')) === 'fail', 'missing ROM file is a failure')
  expect((await page.textContent('[data-testid=check-roms]')).includes('missing'), 'names the problem')
  expect((await row(page, 'media')) === 'fail', 'missing floppy file is a failure')
  expect((await row(page, 'orphans')) === 'warn', 'stray file is a warning')
  expect((await page.textContent('[data-testid=check-orphans]')).includes('never deleted automatically'), 'reassures')
  expect(existsSync(stray), 'the self-check does not delete stray files')
})

test('help: free space is compared with hard disk sizes', async ({ page, app, api, dir }) => {
  const p = writeFile(dir, 'a.hdf', fixtures.hdf())
  const { job } = await api('hdf_import', { path: p, name: 'Work' })
  for (;;) {
    const j = await api('job_get', { id: job })
    if (j.state === 'done') break
    if (j.state === 'failed') throw new Error(j.error.message)
    await new Promise((r) => setTimeout(r, 50))
  }
  await openDiagnostics(page, app)
  await runCheck(page)
  const rep = await api('storage_report')
  const hd = await api('hdf_list')
  expect(hd.length === 1, 'one hard disk imported')
  const status = await row(page, 'space')
  expect(status === 'pass', `plenty of space for a ${hd[0].size} byte disk with ${rep.free_host} free: ${status}`)
  expect((await page.textContent('[data-testid=check-hdf]')).includes('1 hard disk'), 'hard disk row counts it')
})

test('help: copy diagnostics puts a plain-text report on the clipboard', async ({ page, app, shot }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await openDiagnostics(page, app)
  await page.click('[data-testid=copy-diagnostics]')
  await page.waitForSelector('[data-testid=selfcheck-summary]')
  await page.waitForSelector('text=Diagnostics copied')
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip.startsWith('Amiga Studio diagnostics'), `report header: ${clip.slice(0, 40)}`)
  for (const s of ['System', 'App version:', 'Library location:', 'Emulator engine: not found', '[FAIL] Emulator engine', '[WARN] Kickstart ROMs', 'Recent sessions'])
    expect(clip.includes(s), `report contains ${s}`)
  await page.click('text=Show report')
  expect((await page.inputValue('[data-testid=report-text]')).includes('Self-check'), 'report can be inspected before sharing')
  await shot('help-diagnostics-report')
})

test('help: light theme', async ({ page, app, shot }) => {
  await openDiagnostics(page, app)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await runCheck(page)
  await shot('help-diagnostics-light')
})
