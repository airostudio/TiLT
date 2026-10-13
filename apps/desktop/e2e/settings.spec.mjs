// Settings + Storage Manager against the real backend.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, fixtures, writeFile } from './harness.mjs'

// same rule as src/lib/format.ts
function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

async function job(api, cmd, args) {
  const { job: id } = await api(cmd, args)
  for (;;) {
    const j = await api('job_get', { id })
    if (j.state === 'done') return j.result
    if (j.state === 'failed') throw new Error(`${cmd}: ${j.error?.message}`)
    await new Promise((r) => setTimeout(r, 60))
  }
}

async function open(page, app, tab) {
  await app('amiga/settings')
  try {
    await page.waitForSelector('h1:has-text("Settings")', { timeout: 10000 })
  } catch {
    await page.reload()
    await page.waitForSelector('h1:has-text("Settings")')
  }
  if (tab) await page.getByRole('tab', { name: tab }).click()
}

test('settings: theme choice is applied and remembered', async ({ page, app, shot }) => {
  await open(page, app)
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark by default')
  await shot('settings-general-dark')
  await page.getByRole('radio', { name: 'Light' }).check()
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'light applied')
  await shot('settings-general-light')
  await page.reload()
  await page.waitForSelector('h1:has-text("Settings")')
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'light is remembered after a reload')
  expect(await page.getByRole('radio', { name: 'Light' }).isChecked(), 'radio reflects the saved choice')
})

test('settings: storage manager totals match the backend report', async ({ page, app, api, dir, shot }) => {
  await api('rom_import', { paths: [writeFile(dir, 'k.rom', fixtures.rom(40, 63, 0x80000))] })
  await job(api, 'media_import', { paths: [writeFile(dir, 'd.adf', fixtures.adf('One')), writeFile(dir, 'g.dms', fixtures.dms(fixtures.adf('Two')))] })
  await job(api, 'hdf_import', { path: writeFile(dir, 'h.hdf', fixtures.hdf()), name: 'H' })
  const rep = await api('storage_report')
  expect(rep.total_managed > 0 && rep.hard_drives > 0 && rep.floppies > 0 && rep.roms > 0, 'something is stored')
  await open(page, app, 'Storage')
  await page.waitForSelector('[data-testid=total-managed]')
  expect((await page.textContent('[data-testid=total-managed]')) === formatBytes(rep.total_managed), 'total managed matches')
  expect((await page.textContent('[data-testid=storage-root]')) === rep.root, 'storage folder shown')
  const free = await page.textContent('[data-testid=free-host]')
  expect(free.endsWith('B') && free !== '0 B', 'free host space shown')
  for (const [k, label] of [['roms', 'ROMs'], ['workbench', 'Workbench disks'], ['floppies', 'Floppy library'], ['dms', 'DMS archives'], ['hard_drives', 'Hard drives'], ['backups', 'Backups'], ['snapshots', 'Snapshots'], ['logs', 'Logs']]) {
    const row = await page.textContent(`[data-testid=area-${k}]`)
    expect(row.includes(label) && row.includes(formatBytes(rep[k])), `${label} row shows ${formatBytes(rep[k])}`)
  }
  // the bars are real progressbars sized to the share
  const bar = page.locator('[data-testid=area-hard_drives] [role=progressbar]')
  const now = Number(await bar.getAttribute('aria-valuenow'))
  expect(now === Math.round((rep.hard_drives / rep.total_managed) * 100), 'bar width equals the share')
  await shot('settings-storage')
})

test('settings: changing the storage location writes the pointer, warns about restart, moves nothing', async ({ page, app, api, dir, shot }) => {
  const before = await api('storage_location')
  expect(before.can_change === true && before.restart_required === false, 'starts changeable with no pending restart')
  await api('rom_import', { paths: [writeFile(dir, 'k.rom', fixtures.rom(34, 5))] })
  const rootFiles = existsSync(before.current)
  await open(page, app, 'Storage')
  await page.waitForSelector('[data-testid=loc-current]')
  // refusals first
  const input = page.getByLabel('Change storage location')
  await input.fill('relative/folder')
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await page.waitForSelector('text=Type the full path of a folder')
  await input.fill(path.join(dir, 'with,comma'))
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await page.waitForSelector('text=no commas')
  expect(!existsSync(path.join(dir, 'with,comma')), 'nothing created for a refused path')
  // real change
  const target = path.join(dir, 'NewLibrary')
  await input.fill(target)
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await page.waitForSelector('text=Restart Amiga Studio to use the new folder')
  const banner = await page.textContent('[role=status]:has-text("Restart Amiga Studio")')
  expect(banner.includes(target) && banner.includes('Nothing was moved or deleted'), 'restart notice explains it')
  await shot('settings-location-restart')
  const after = await api('storage_location')
  expect(after.pointer === target && after.restart_required === true && after.current === before.current, 'backend recorded the pointer, current unchanged')
  expect(existsSync(target), 'the new folder exists')
  expect(rootFiles && existsSync(before.current) && (await api('rom_list')).length === 1, 'the existing library is untouched')
  // reloading the page keeps showing the pending restart
  await page.reload()
  await page.getByRole('tab', { name: 'Storage' }).click()
  await page.waitForSelector('text=Restart Amiga Studio to use the new folder')
  // cancelling the pending change keeps the current folder and clears the notice
  await page.getByRole('button', { name: 'Keep using the current folder' }).click()
  await page.waitForFunction(() => !document.body.textContent.includes('Restart Amiga Studio to use the new folder'))
  const reset = await api('storage_location')
  expect(reset.pointer === reset.current && reset.restart_required === false, 'pending change cancelled')
  // the default folder can be chosen too (needs a restart, since the test library lives elsewhere)
  await page.getByRole('button', { name: 'Go back to the default folder' }).click()
  await page.waitForSelector('text=Restart Amiga Studio to use the new folder')
  expect((await api('storage_location')).pointer === reset.default, 'pointer is the default folder')
})

test('settings: unreferenced files are listed and can be deleted after confirmation', async ({ page, app, api, dir, shot }) => {
  const adf = await job(api, 'media_import', { paths: [writeFile(dir, 'keep.adf', fixtures.adf('Keep'))] })
  const kept = adf[0].ok.record
  const stray = path.join(dir, 'Studio', 'Floppies', 'stray-leftover.adf')
  writeFileSync(stray, 'leftover')
  const strayDms = path.join(dir, 'Studio', 'DMS', 'old-leftover.dms')
  mkdirSync(path.dirname(strayDms), { recursive: true })
  writeFileSync(strayDms, 'leftover too')
  expect((await api('orphans')).length === 2, 'backend sees two orphans')
  await open(page, app, 'Storage')
  await page.waitForSelector('[data-testid=orphan-row]')
  const rows = await page.locator('[data-testid=orphan-row]').allTextContents()
  expect(rows.length === 2 && rows.some((r) => r.includes('stray-leftover.adf')) && rows.some((r) => r.includes('old-leftover.dms')), 'both leftovers listed')
  expect(!rows.some((r) => r.includes(path.basename(kept.path))), 'library files are never listed')
  await shot('settings-orphans')
  // decline first
  await page.getByRole('button', { name: 'Delete leftover file stray-leftover.adf' }).click()
  expect((await page.textContent('[role=dialog]')).includes('Your own original files are never listed'), 'confirmation explains')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  expect(existsSync(stray), 'declined delete keeps the file')
  // accept
  await page.getByRole('button', { name: 'Delete leftover file stray-leftover.adf' }).click()
  await page.getByRole('button', { name: 'Delete file' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=orphan-row]').length === 1)
  expect(!existsSync(stray) && existsSync(strayDms), 'only the chosen file was deleted')
  expect(existsSync(kept.path), 'the library disk is intact')
  expect((await api('orphans')).length === 1, 'backend agrees')
})

test('settings: no leftovers shows an honest empty state', async ({ page, app }) => {
  await open(page, app, 'Storage')
  await page.waitForSelector('text=No leftover files')
})

test('settings: engine section is honest when Amiberry is missing, and accepts a real program', async ({ page, app, api, dir, shot }) => {
  await open(page, app, 'Emulator engine')
  await page.waitForSelector('[data-testid=engine-missing]')
  const miss = await page.textContent('[data-testid=engine-missing]')
  expect(miss.includes('not found'), 'says the engine is missing')
  const body = await page.textContent('body')
  expect(body.includes('Until then you can still manage ROMs') && body.includes('Official Windows builds'), 'explains the consequences and the platform difference')
  await shot('settings-engine-missing')
  // a file that is not Amiberry is refused with a readable message
  const fake = path.join(dir, 'not-amiberry.sh')
  writeFileSync(fake, '#!/bin/sh\necho hello\n')
  chmodSync(fake, 0o755)
  await page.getByLabel('Amiberry program').fill(fake)
  await page.getByRole('button', { name: 'Use this program' }).click()
  await page.waitForSelector('text=does not look like Amiberry')
  // relative paths are rejected before the backend
  await page.getByLabel('Amiberry program').fill('amiberry')
  await page.getByRole('button', { name: 'Use this program' }).click()
  await page.waitForSelector('text=Type the full path of the Amiberry program')
  // a program that answers like Amiberry is accepted and remembered
  const good = path.join(dir, 'amiberry')
  writeFileSync(good, `#!/bin/sh\necho '\$VER: Amiberry v5.7.1 (test build)'\n`)
  chmodSync(good, 0o755)
  await page.getByLabel('Amiberry program').fill(good)
  await page.getByRole('button', { name: 'Use this program' }).click()
  await page.waitForSelector('[data-testid=engine-banner]')
  expect((await page.textContent('[data-testid=engine-banner]')).includes('Amiberry v5.7.1'), 'version banner shown')
  expect((await page.textContent('[data-testid=engine-path]')) === good, 'path shown')
  const info = await api('engine_info')
  expect(info.path === good, 'backend remembers the engine')
  expect((await page.textContent('body')).includes(info.runtime_control ? 'Available' : 'Not available'), 'runtime control state matches the backend')
  await shot('settings-engine-found')
})

test('settings: privacy statements are plain and complete', async ({ page, app, shot }) => {
  await open(page, app, 'Privacy and data')
  const t = await page.textContent('[data-testid=privacy]')
  for (const s of ['No account', 'No telemetry', 'Nothing is uploaded', 'No proprietary software is included']) expect(t.includes(s), `states: ${s}`)
  await shot('settings-privacy')
})
