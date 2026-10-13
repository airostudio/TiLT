// Floppy Drives e2e: real backend and UI. Profile mode (no machine running) is exercised against the
// real service. The live-session tests simulate ONLY the emulator's control channel by intercepting
// session_* HTTP calls (there is no emulator in the test environment); everything else is real.
import { test, expect, fixtures, writeFile } from './harness.mjs'

const URL = 'amiga/floppies'

async function waitJob(api, job) {
  for (let i = 0; i < 200; i++) {
    const j = await api('job_get', { id: job })
    if (j.state === 'done') return j.result
    if (j.state === 'failed') throw new Error(`job failed: ${JSON.stringify(j.error)}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('job timed out')
}

/** The backend seeds some starter machines; tests that need a known machine start from none. */
async function clearProfiles(api) {
  for (const p of await api('profile_list')) await api('profile_delete', { id: p.id })
}

/** Import named blank ADFs and make a classic A500 machine. Returns the machine and a name -> record map. */
async function setup(api, dir, names = ['Alpha', 'Beta', 'Gamma'], machine = 'Test A500') {
  const paths = names.map((n) => writeFile(dir, `${n}.adf`, fixtures.adf(n)))
  if (paths.length) await waitJob(api, (await api('media_import', { paths })).job)
  const disks = Object.fromEntries((await api('media_list')).map((m) => [m.name, m]))
  await clearProfiles(api)
  const profile = await api('profile_from_preset', { preset_id: 'a500', name: machine })
  await api('profile_save', { profile })
  return { profile, disks }
}

const slot = (u) => `[data-testid=slot-${u}]`
async function insertVia(page, unit, diskName) {
  await page.click(`[aria-label="Insert a floppy disk into DF${unit}:"], [aria-label="Replace the disk in DF${unit}:"]`)
  await page.fill('.modal input.input >> nth=0', diskName)
  await page.check(`.modal label:has-text("${diskName}") input`)
  await page.click('.modal .modal-actions button.primary')
  await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 0)
}
const label = async (page, u) => (await page.textContent(`${slot(u)} [data-testid=disk-${u}] strong`)).trim()

test('floppies: four drive slots; insert, save, reload and eject a disk in the machine profile', async ({ page, app, api, dir, shot }) => {
  const { profile, disks } = await setup(api, dir)
  await app(URL)
  await page.waitForSelector('[data-testid=slots]')
  expect((await page.$$('[data-testid=slots] > section')).length === 4, 'four drive slots')
  expect((await page.textContent('[data-testid=slots]')).includes('DF3:'), 'DF3 present')
  expect(await page.$(`${slot(0)}[data-state=empty]`), 'DF0 empty')
  expect(await page.$(`${slot(2)}[data-state=off]`), 'DF2 not fitted in the preset')
  expect((await page.textContent(slot(0))).includes('Not running'), 'LED says not running')
  await shot('floppies-empty')

  await insertVia(page, 0, 'Alpha')
  await page.waitForSelector(`${slot(0)}[data-state=disk]`)
  expect((await label(page, 0)) === 'Alpha', 'Alpha shown in DF0')
  const t = await page.textContent(slot(0))
  expect(t.includes('Alpha.adf') === false && t.includes('.adf'), 'image filename shown')
  expect(t.includes('Write-protected') && t.includes('Untouched original'), 'originals are write-protected')
  expect(t.includes('AmigaDOS FFS'), 'format summary shown')
  expect((await page.textContent('body')).includes('Unsaved changes'), 'unsaved state is clear')
  expect((await api('profile_get', { id: profile.id })).drives[0].media_id === null, 'nothing saved before pressing Save')

  await insertVia(page, 1, 'Beta')
  await page.selectOption('[aria-label="DF2: drive type"]', 'dd35')
  await shot('floppies-edited')
  await page.click('button:has-text("Save drive settings")')
  await page.waitForSelector('.toast.success')
  let p = await api('profile_get', { id: profile.id })
  expect(p.drives[0].media_id === disks.Alpha.id && p.drives[1].media_id === disks.Beta.id, 'saved in the backend')
  expect(p.drives[0].write_protect === true, 'original saved write-protected')
  expect(p.drives[2].kind === 'dd35', 'DF2 now fitted')

  await page.reload()
  await page.waitForSelector(`${slot(0)}[data-state=disk]`)
  expect((await label(page, 0)) === 'Alpha' && (await label(page, 1)) === 'Beta', 'state persists after reload')
  expect(await page.$(`${slot(2)}[data-state=empty]`), 'DF2 fitted and empty after reload')

  await page.click('[aria-label="Eject the disk from DF0:"]')
  await page.waitForSelector(`${slot(0)}[data-state=empty]`)
  await page.click('button:has-text("Save drive settings")')
  await page.waitForSelector('.toast.success')
  p = await api('profile_get', { id: profile.id })
  expect(p.drives[0].media_id === null && p.drives[1].media_id === disks.Beta.id, 'eject saved')
  // discard works
  await page.click('[aria-label="Eject the disk from DF1:"]')
  await page.click('button:has-text("Discard changes")')
  await page.waitForSelector(`${slot(1)}[data-state=disk]`)
})

test('floppies: invalid drive layouts are explained and cannot be saved', async ({ page, app, api, dir }) => {
  const { profile, disks } = await setup(api, dir)
  await app(URL)
  await page.waitForSelector('[data-testid=slots]')
  // DF3 without DF2 breaks the "in order" rule
  await page.selectOption('[aria-label="DF3: drive type"]', 'dd35')
  await page.waitForSelector('[data-testid=drive-issues] >> text=Drives must be enabled in order')
  expect(await page.isDisabled('button:has-text("Save drive settings")'), 'Save disabled while there is an error')
  await page.selectOption('[aria-label="DF3: drive type"]', 'disabled')
  await page.waitForFunction(() => !document.querySelector('[data-testid=drive-issues]')?.textContent.includes('in order'))
  // the same disk cannot go in two drives
  await insertVia(page, 0, 'Alpha')
  await page.click('[aria-label="Insert a floppy disk into DF1:"]')
  await page.fill('.modal input.input >> nth=0', 'Alpha')
  const row = await page.textContent('.modal label:has-text("Alpha")')
  expect(row.includes('Already in DF0:'), `picker explains why: ${row}`)
  expect(await page.isDisabled('.modal label:has-text("Alpha") input'), 'Alpha cannot be chosen twice')
  await page.click('.modal button:has-text("Cancel")')
  // switching a drive off takes its disk out
  await insertVia(page, 1, 'Beta')
  await page.selectOption('[aria-label="DF1: drive type"]', 'disabled')
  await page.waitForSelector(`${slot(1)}[data-state=off]`)
  await page.waitForSelector('.toast >> text=switched off')
  await page.click('button:has-text("Save drive settings")')
  await page.waitForSelector('.toast.success')
  const p = await api('profile_get', { id: profile.id })
  expect(p.drives[1].kind === 'disabled' && p.drives[1].media_id === null && p.drives[0].media_id === disks.Alpha.id, 'saved consistently')
})

test('floppies: drag a disk from the library panel onto a drive', async ({ page, app, api, dir, shot }) => {
  const { profile, disks } = await setup(api, dir)
  await app(URL)
  await page.waitForSelector('[data-testid=panel-disk]')
  expect((await page.$$('[data-testid=panel-disk]')).length === 3, 'library panel lists the three disks')
  await page.dragAndDrop('[data-testid=panel-disk][data-name="Beta"]', slot(1))
  await page.waitForSelector(`${slot(1)}[data-state=disk]`)
  expect((await label(page, 1)) === 'Beta', 'drop inserted Beta in DF1')
  expect((await page.textContent('[data-testid=panel-disk][data-name="Beta"]')).includes('In DF1:'), 'panel shows where the disk is')
  // dropping on a drive that is switched off is refused with a reason
  await page.dragAndDrop('[data-testid=panel-disk][data-name="Gamma"]', slot(3))
  expect(await page.$(`${slot(3)}[data-state=off]`), 'DF3 unchanged')
  // dropping the same disk onto another drive is refused (one disk, one drive)
  await page.dragAndDrop('[data-testid=panel-disk][data-name="Beta"]', slot(0))
  await page.waitForSelector('.toast.error >> text=already in DF1:')
  expect(await page.$(`${slot(0)}[data-state=empty]`), 'DF0 still empty')
  await shot('floppies-drag')
  await page.click('button:has-text("Save drive settings")')
  await page.waitForSelector('.toast.success')
  expect((await api('profile_get', { id: profile.id })).drives[1].media_id === disks.Beta.id, 'drop result saved')
})

test('floppies: originals stay write-protected; a working copy can be swapped in and protected', async ({ page, app, api, dir, shot }) => {
  const { profile } = await setup(api, dir, ['Alpha'])
  await app(URL)
  await insertVia(page, 0, 'Alpha')
  expect(await page.isDisabled(`${slot(0)} input[role=switch]`), 'protection switch locked for an original')
  expect(await page.isChecked(`${slot(0)} input[role=switch]`), 'and it is on')
  await shot('floppies-original')
  await page.click(`${slot(0)} button:has-text("make a working copy")`)
  await page.waitForSelector('.modal >> text=Put the copy in DF0: now')
  await page.click('.modal button:has-text("Make working copy")')
  await page.waitForFunction(() => document.querySelector('[data-testid=disk-0] strong')?.textContent.includes('working copy'))
  const t = await page.textContent(slot(0))
  expect(t.includes('Working copy') && t.includes('Writable'), `copy is writable: ${t}`)
  const all = await api('media_list')
  const copy = all.find((m) => m.name === 'Alpha (working copy)')
  expect(copy && copy.pristine === false && all.find((m) => m.name === 'Alpha').pristine === true, 'original untouched, copy writable')
  // now the protection switch works
  await page.click(`${slot(0)} input[role=switch]`)
  await page.waitForFunction(() => document.querySelector('[data-testid=protect-0]')?.textContent.includes('Write-protected'))
  await page.click('button:has-text("Save drive settings")')
  await page.waitForSelector('.toast.success >> text=saved')
  const p = await api('profile_get', { id: profile.id })
  expect(p.drives[0].media_id === copy.id && p.drives[0].write_protect === true, 'copy in DF0, protected, saved')
})

test('floppies: "Insert next disk" cycles through a queue and skips disks held by other drives', async ({ page, app, api, dir, shot }) => {
  const { disks } = await setup(api, dir)
  await api('queue_save', { name: 'Trilogy', media_ids: [disks.Alpha.id, disks.Beta.id, disks.Gamma.id] })
  await app(URL)
  await page.waitForSelector('[data-testid=queue-helper]')
  await page.selectOption('[data-testid=queue-helper] select >> nth=0', { label: 'Trilogy (3 disks)' })
  await page.waitForFunction(() => document.querySelector('[data-testid=queue-next]')?.textContent.includes('Alpha'))
  const seen = []
  for (let i = 0; i < 4; i++) {
    await page.click('button:has-text("Insert next disk")')
    await page.waitForFunction((n) => document.querySelector('[data-testid=disk-0] strong')?.textContent.trim() === n, ['Alpha', 'Beta', 'Gamma', 'Alpha'][i])
    seen.push(await label(page, 0))
  }
  expect(seen.join() === 'Alpha,Beta,Gamma,Alpha', `cycles and wraps: ${seen}`)
  await shot('floppies-queue')
  // Gamma goes into DF1 by hand; from DF0 (holding Alpha) the next usable disk is Beta, then Beta -> (Gamma busy) -> Alpha
  await insertVia(page, 1, 'Gamma')
  await page.click('button:has-text("Insert next disk")')
  await page.waitForFunction(() => document.querySelector('[data-testid=disk-0] strong')?.textContent.trim() === 'Beta')
  await page.click('button:has-text("Insert next disk")')
  await page.waitForFunction(() => document.querySelector('[data-testid=disk-0] strong')?.textContent.trim() === 'Alpha')
})

test('floppies: no machine yet explains what to do', async ({ page, app, api, shot }) => {
  await clearProfiles(api)
  await app(URL)
  await page.waitForSelector('text=No machine yet')
  expect((await page.textContent('body')).includes('Create a machine in My Amigas'), 'guides the user')
  await shot('floppies-no-machine')
})

// ---------- simulated emulator control channel (see header comment) ----------
async function simulateSession(page, { profile, control, drives }) {
  const calls = []
  const state = drives
  await page.route('**/api/session_status', (r) =>
    r.fulfill({
      json: {
        ok: {
          running: true,
          profile_id: profile.id,
          profile_name: profile.name,
          pid: 1,
          uptime_s: 5,
          runtime_control: control,
          paused: false,
          warnings: [],
          log_path: null,
          hard_disks: [],
        },
      },
    }),
  )
  await page.route('**/api/session_drives', (r) => r.fulfill({ json: { ok: state } }))
  await page.route('**/api/session_insert', (r) => {
    const a = JSON.parse(r.request().postData())
    calls.push(['insert', a])
    const d = state[a.unit]
    d.media_id = a.media_id
    d.path = `/sim/${a.media_id}.adf`
    d.write_protected = !!a.write_protect
    return r.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/session_eject', (r) => {
    const a = JSON.parse(r.request().postData())
    calls.push(['eject', a])
    Object.assign(state[a.unit], { media_id: null, path: null, media_name: null, write_protected: false })
    return r.fulfill({ json: { ok: true } })
  })
  return { calls, state }
}
const simDrives = () => [0, 1, 2, 3].map((unit) => ({ unit, enabled: unit < 2, path: null, media_id: null, media_name: null, write_protected: false, motor: false, writing: false, track: null }))

test('floppies: live mode (simulated emulator) inserts, replaces and ejects through the session commands', async ({ page, app, api, dir, shot }) => {
  const { profile, disks } = await setup(api, dir, ['Alpha'])
  const copy = await api('media_working_copy', { id: disks.Alpha.id, name: 'Alpha copy' })
  const { calls, state } = await simulateSession(page, { profile, control: true, drives: simDrives() })
  await app(URL)
  await page.waitForSelector('text=is running')
  expect(await page.$('select[aria-label="DF0: drive type"]') === null, 'no profile editing UI while live')
  expect((await page.textContent('body')).includes('write-protected'), 'tells the user originals are inserted write-protected')
  await insertVia(page, 0, 'Alpha')
  await page.waitForSelector(`${slot(0)}[data-state=disk]`)
  expect(JSON.stringify(calls.at(-1)) === JSON.stringify(['insert', { unit: 0, media_id: disks.Alpha.id, write_protect: true }]), `original inserted write-protected: ${JSON.stringify(calls)}`)
  expect((await page.textContent(`[data-testid=protect-0]`)).includes('Write-protected'), 'live protection state shown')
  // LED: the activity is text as well as colour
  state[0].motor = true
  await page.waitForFunction(() => document.querySelector('[data-testid=led-0]')?.textContent.includes('Reading'))
  state[0].writing = true
  await page.waitForFunction(() => document.querySelector('[data-testid=led-0]')?.textContent.includes('Writing'))
  await shot('floppies-live-writing')
  // while the Amiga is writing, replacing is refused with an explanation
  await page.click('[aria-label="Replace the disk in DF0:"]')
  await page.fill('.modal input.input >> nth=0', 'copy')
  await page.check('.modal label:has-text("Alpha copy") input')
  await page.click('.modal .modal-actions button.primary')
  await page.waitForSelector('.toast.error >> text=busy writing')
  const before = calls.length
  state[0].writing = false
  state[0].motor = false
  await page.waitForFunction(() => document.querySelector('[data-testid=led-0]')?.textContent.includes('Idle'))
  await insertVia(page, 0, 'Alpha copy')
  await page.waitForFunction(() => document.querySelector('[data-testid=disk-0] strong')?.textContent.includes('Alpha copy'))
  expect(JSON.stringify(calls.slice(before).map((c) => c[0])) === '["eject","insert"]', `replace = eject then insert: ${JSON.stringify(calls.slice(before))}`)
  expect(calls.at(-1)[1].media_id === copy.id && calls.at(-1)[1].write_protect === false, 'working copy inserted writable')
  // toggle protection on a writable disk re-inserts it protected
  await page.click(`${slot(0)} input[role=switch]`)
  await page.waitForFunction(() => document.querySelector('[data-testid=protect-0]')?.textContent.includes('Write-protected'))
  expect(calls.at(-1)[1].write_protect === true, 'protection applied through session_insert')
  await page.click('[aria-label="Eject the disk from DF0:"]')
  await page.waitForSelector(`${slot(0)}[data-state=empty]`)
  expect(calls.at(-1)[0] === 'eject' && calls.at(-1)[1].unit === 0, 'eject sent')
  // the drive that is switched off in the running machine says so
  expect((await page.textContent(slot(3))).includes('switched off in the running machine'), 'disabled drive explained')
})

test('floppies: running machine without runtime control falls back to editing the machine', async ({ page, app, api, dir, shot }) => {
  const { profile, disks } = await setup(api, dir, ['Alpha'])
  await simulateSession(page, { profile, control: false, drives: simDrives() })
  await app(URL)
  await page.waitForSelector('text=disks cannot be changed while it runs')
  const b = await page.textContent('[role=status]')
  expect(b.includes('F12') && b.includes('restart') && b.includes('next time it starts'), `explains the limitation: ${b}`)
  await insertVia(page, 0, 'Alpha')
  await page.click('button:has-text("Save drive settings")')
  await page.waitForSelector('.toast.success >> text=next time the machine starts')
  expect((await api('profile_get', { id: profile.id })).drives[0].media_id === disks.Alpha.id, 'edit saved to the machine')
  await shot('floppies-no-control')
})
