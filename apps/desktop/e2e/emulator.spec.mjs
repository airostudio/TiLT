// Emulator screen. The backend is real. Where a real Amiberry is not installed (it is not, in CI),
// the "live session" tests put a tiny stand-in Amiberry on PATH: a Node script that answers
// `--help`/`--dump-config` like the real engine and speaks Amiberry's line protocol on the real
// control socket, so the real Rust session supervisor, IPC client and UI all run for real. It records
// every command it receives so the tests can prove the UI's buttons reach the engine. It is a test
// double for the *engine process only*: it renders nothing and plays nothing.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, tests, expect, fixtures, writeFile } from './harness.mjs'

const FAKE_ENGINE = String.raw`#!/usr/bin/env node
const net = require('net'), fs = require('fs'), path = require('path'), zlib = require('zlib')
const args = process.argv.slice(2)
if (args.includes('--help')) { console.log('$VER: Amiberry v8.4.0 (2026-10-11)'); process.exit(0) }
if (args.includes('--dump-config')) { console.log('cpu_model=68000'); process.exit(0) }
const dir = process.env.XDG_RUNTIME_DIR
const log = path.join(dir, 'fake-amiberry.log')
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
function png() {
  const w = 160, h = 120, rows = []
  const bars = [[170,170,170],[170,170,0],[0,170,170],[0,170,0],[170,0,170],[170,0,0],[0,0,170],[0,0,0]]
  for (let y = 0; y < h; y++) { const r = [0]; for (let x = 0; x < w; x++) r.push(...bars[Math.floor((x / w) * 8)]); rows.push(Buffer.from(r)) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
let paused = false
const df = ['', '', '', ''], prot = [0, 0, 0, 0]
function handle(f) {
  switch (f[0]) {
    case 'PING': return 'OK\tPONG'
    case 'GET_STATUS': return 'OK\tPaused=' + paused
    case 'PAUSE': paused = true; return 'OK'
    case 'RESUME': paused = false; return 'OK'
    case 'SCREENSHOT': fs.writeFileSync(f[1], png()); return 'OK'
    case 'GET_FPS': return 'OK\tfps=50.0\tidle=12%'
    case 'GET_LED_STATUS': return 'OK\tDF0=off\tHD=off\tPower=on'
    case 'GET_DRIVE_STATE': return ['OK', ...[0, 1, 2, 3].flatMap((u) => ['DF' + u + '_disk=' + (df[u] || '<empty>'), 'DF' + u + '_protected=' + prot[u], 'DF' + u + '_motor=0', 'DF' + u + '_writing=0', 'DF' + u + '_track=0', 'DF' + u + '_disabled=' + (u > 1 ? 1 : 0)])].join('\t')
    case 'INSERTFLOPPY': df[Number(f[2])] = f[1]; return 'OK'
    case 'EJECT_FLOPPY': df[Number(f[1])] = ''; return 'OK'
    case 'DISK_WRITE_PROTECT': prot[Number(f[1])] = Number(f[2]); return 'OK'
    case 'SAVESTATE': fs.writeFileSync(f[1], 'state'); fs.writeFileSync(f[2], 'cfg'); return 'OK'
    default: return 'OK'
  }
}
const sock = path.join(dir, 'amiberry.sock')
try { fs.unlinkSync(sock) } catch {}
net.createServer((c) => {
  let buf = ''
  c.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const f = line.split('\t')
      fs.appendFileSync(log, line.replace(/\t/g, ' ') + '\n')
      c.write(handle(f) + '\n')
      if (f[0] === 'QUIT' && !process.env.FAKE_IGNORE_QUIT) setTimeout(() => process.exit(0), 100)
    }
  })
}).listen(sock)
setTimeout(() => process.exit(0), 180000) // never outlive a forgotten test
`

const engineDir = mkdtempSync(path.join(tmpdir(), 'fake-amiberry-'))
writeFileSync(path.join(engineDir, 'amiberry'), FAKE_ENGINE)
chmodSync(path.join(engineDir, 'amiberry'), 0o755)

/** Register a test whose backend can find the stand-in engine. */
function withEngine(name, fn, extraEnv = {}) {
  test(name, fn)
  tests[tests.length - 1].env = { PATH: `${engineDir}:${process.env.PATH}`, ...extraEnv }
}

const profileByName = async (api, name) => (await api('profile_list')).find((p) => p.name === name)
const logOf = (dir) => {
  const p = path.join(dir, 'fake-amiberry.log')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
async function waitLog(dir, re, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (re.test(logOf(dir))) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`engine never received ${re}. It received:\n${logOf(dir)}`)
}
async function waitJob(api, r) {
  for (;;) {
    const j = await api('job_get', { id: r.job })
    if (j.state === 'done') return j.result
    if (j.state === 'failed') throw new Error(j.error?.message)
    await new Promise((x) => setTimeout(x, 100))
  }
}

/** A500 with a Kickstart 1.3 ROM and one writable library disk. */
async function liveSetup(api, dir) {
  const [rr] = await api('rom_import', { paths: [writeFile(dir, 'ks13.rom', fixtures.rom(34, 5))] })
  const p = await profileByName(api, 'Classic Amiga 500')
  p.rom_id = rr.ok.record.id
  await api('profile_save', { profile: p })
  const imp = await waitJob(api, await api('media_import', { paths: [writeFile(dir, 'Work.adf', fixtures.adf('Work'))] }))
  return { profile: p, rom: rr.ok.record, disk: imp[0].ok.record }
}

async function startFromUi(page, app, name = 'Classic Amiga 500') {
  await app('amiga/emulator')
  await page.waitForSelector('[data-testid=machine-select]')
  await page.selectOption('[data-testid=machine-select]', { label: name })
  await page.waitForFunction(() => !document.querySelector('[data-testid=start-machine]').disabled)
  await page.click('[data-testid=start-machine]')
  await page.waitForSelector('[data-testid=power-off]', { timeout: 30000 })
}

// ---------------------------------------------------------------- not running

test('emulator: not running, with no engine installed, explains setup and fails readably', async ({ page, app, api, shot }) => {
  await app('amiga/emulator')
  await page.waitForSelector('[data-testid=machine-select]')
  await page.waitForSelector('[data-testid=engine-missing]')
  const missing = await page.textContent('[data-testid=engine-missing]')
  expect(/Amiberry/.test(missing), `engine-missing message names the engine: ${missing}`)
  expect(await page.isVisible('a[href="#/amiga/settings"] >> nth=0'), 'links to Settings')
  const ready = await page.textContent('[data-testid=readiness]')
  expect(ready.includes('Amiberry') && ready.includes('was not found'), `readiness row for the engine: ${ready}`)
  expect(ready.includes('No Kickstart ROM is selected'), 'readiness row for the missing Kickstart')
  expect(await page.isVisible('[data-testid=check-rom] a[href="#/amiga/roms"]'), 'missing Kickstart links to the ROM Library')
  await page.waitForFunction(() => !document.querySelector('[data-testid=start-machine]').disabled)
  await shot('emulator-not-running')
  await page.click('[data-testid=start-machine]')
  await page.waitForSelector('[data-testid=start-error]')
  const err = await page.textContent('[data-testid=start-error]')
  expect(/Amiberry/.test(err) && /Settings/.test(err), `Start failure is readable and points to Settings: ${err}`)
  expect((await page.textContent('[role=alert]')).includes('Nothing was changed'), 'reassures that nothing was changed')
  expect(!(await api('session_status')).running, 'nothing is running')
})

withEngine('emulator: engine found, Start with no Kickstart gives a readable error and a ROM Library link', async ({ page, app, api, shot }) => {
  await app('amiga/emulator')
  await page.waitForSelector('[data-testid=machine-select]')
  await page.waitForSelector('[data-testid=check-engine]:has-text("Amiberry v8.4.0")')
  expect(!(await page.isVisible('[data-testid=engine-missing]')), 'no engine warning when the engine is found')
  await page.waitForFunction(() => !document.querySelector('[data-testid=start-machine]').disabled)
  await page.click('[data-testid=start-machine]')
  await page.waitForSelector('[data-testid=start-error]')
  const err = await page.textContent('[data-testid=start-error]')
  expect(/Kickstart/.test(err), `readable no-ROM error from the backend: ${err}`)
  expect(await page.isVisible('[role=alert] >> text=Open ROM Library'), 'error offers the ROM Library')
  await shot('emulator-start-failure-no-rom')
  expect(!(await api('session_status')).running, 'nothing is running')
})

// ---------------------------------------------------------------- live session (stand-in engine)

withEngine('emulator: live session, every control reaches the engine, power off is clean', async ({ page, app, api, dir, shot }) => {
  const { disk } = await liveSetup(api, dir)
  await startFromUi(page, app)
  const meta = await page.textContent('[data-testid=emu-meta]')
  expect(/process \d+/.test(meta), `status header shows the pid: ${meta}`)
  expect((await page.textContent('main')).includes('Classic Amiga 500'), 'header names the machine')

  // preview image comes from session_screenshot and is honestly captioned
  await page.waitForSelector('[data-testid=preview-img]')
  const src = await page.getAttribute('[data-testid=preview-img]', 'src')
  expect(src.startsWith('data:image/png;base64,'), 'preview is the real screenshot')
  const frame = await page.textContent('.preview-wrap')
  expect(frame.includes("emulator's own window") && frame.includes('not live video'), 'preview caption is honest')
  expect(await page.evaluate(() => !!document.querySelector('.screen-frame img')), 'preview sits in .screen-frame')

  // floppies: DF0/DF1 fitted, DF2/DF3 not
  await page.waitForSelector('[data-testid=df-0]')
  expect((await page.textContent('[data-testid=df-2]')).includes('Not fitted'), 'DF2 not fitted')
  await page.selectOption('[aria-label="Insert a disk into DF0"]', disk.id)
  await page.click('[data-testid=df-0] button:text-is("Insert")')
  await waitLog(dir, /INSERTFLOPPY .*\.adf 0/)
  await page.waitForSelector('[data-testid=df-0]:has-text("Work")')
  await page.click('[aria-label="Eject DF0"]')
  await waitLog(dir, /EJECT_FLOPPY 0/)

  // performance panel shows what the engine reports
  await page.waitForSelector('[data-testid=perf]:has-text("50.0")')
  expect((await page.textContent('[data-testid=perf]')).includes('12%'), 'idle value shown')

  // pause / resume really toggles the engine's state and the UI follows the real status
  await page.click('[data-testid=pause]')
  await waitLog(dir, /^PAUSE$/m)
  await page.waitForSelector('[data-testid=resume]')
  expect((await page.textContent('main')).includes('Paused'), 'header shows Paused')
  await page.click('[data-testid=resume]')
  await waitLog(dir, /^RESUME$/m)
  await page.waitForSelector('[data-testid=pause]')

  await page.click('[data-testid=reset-soft]')
  await waitLog(dir, /RESET SOFT/)

  // hard reset asks first
  await page.click('[data-testid=reset-hard]')
  await page.waitForSelector('[role=dialog]:has-text("Hard reset")')
  expect((await page.textContent('[role=dialog]')).includes('validation'), 'explains the consequence')
  await page.click('[role=dialog] >> text=Cancel')
  await new Promise((r) => setTimeout(r, 300))
  expect(!/RESET HARD/.test(logOf(dir)), 'cancelling does not reset')
  await page.click('[data-testid=reset-hard]')
  await page.click('[role=dialog] button:has-text("Hard reset")')
  await waitLog(dir, /RESET HARD/)

  await page.click('[data-testid=fullscreen]')
  await waitLog(dir, /TOGGLE_FULLSCREEN/)
  await page.click('[data-testid=mouse-grab]')
  await waitLog(dir, /TOGGLE_MOUSE_GRAB/)
  const help = await page.textContent('[data-testid=mouse-help]')
  expect(help.includes('Ctrl') && help.includes('Alt') && help.includes('Toggle mouse capture'), 'always shows how to get the mouse back')

  // sound
  await page.evaluate(() => {
    const el = document.getElementById('emu-volume')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '40')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await waitLog(dir, /SET_VOLUME 60/) // 40% volume is 60 attenuation in Amiberry's scale
  await page.click('text=Mute')
  await waitLog(dir, /^MUTE$/m)
  await page.waitForSelector('text=Muted from here')

  // save and restore a state: the backend note is always shown
  await page.getByLabel('State name').fill('before boss')
  await page.click('button:has-text("Save state")')
  await page.waitForSelector('[data-testid=state-note]')
  const note = await page.textContent('[data-testid=state-note]')
  expect(note.includes('memory only') && note.includes('NOT rolled back'), `shows the backend note: ${note}`)
  await waitLog(dir, /SAVESTATE .*\.uss/)
  await page.click('button:has-text("Load state")')
  await page.waitForSelector('[role=dialog]:has-text("NOT rolled back")')
  await page.click('[role=dialog] button:has-text("Load state")')
  await waitLog(dir, /LOADSTATE/)

  // keyboard shortcut guide lists only what Amiberry's source confirms
  const sc = await page.textContent('.shortcut-table >> xpath=ancestor::table')
  expect(sc.includes('Ctrl') && sc.includes('Release the mouse') && sc.includes('F12'), 'confirmed shortcuts are listed')
  expect(!/Alt\+Enter|F11|Ctrl\+Q/.test(sc), 'no unconfirmed shortcuts are invented')
  await shot('emulator-running')

  // power off: asks, then the engine really quits and the outcome is clean
  await page.click('[data-testid=power-off]')
  await page.waitForSelector('[role=dialog]:has-text("Power off")')
  await shot('emulator-poweroff-confirm')
  await page.click('[role=dialog] button:has-text("Power off")')
  await page.waitForSelector('[data-testid=stop-outcome]', { timeout: 30000 })
  expect((await page.getAttribute('[data-testid=stop-outcome]', 'data-outcome')) === 'clean', 'outcome is clean')
  expect(/QUIT/.test(logOf(dir)), 'the engine was asked to quit')
  const rec = await api('sessions_recent')
  expect(rec[0].outcome === 'clean', `session recorded as clean: ${rec[0].outcome}`)
  await shot('emulator-after-poweroff')
  // the same session shows up in Help / Diagnostics with its outcome
  await page.click('[data-testid=nav-help]')
  await page.click('role=tab[name="Diagnostics"]')
  await page.waitForSelector('[data-testid=session-row]')
  const srow = await page.textContent('[data-testid=session-row]')
  expect(srow.includes('Classic Amiga 500') && srow.includes('Clean'), `recent sessions lists it as clean: ${srow}`)
})

withEngine('emulator: Start notes are listed while running; preview polling stops when leaving the screen', async ({ page, app, api, dir }) => {
  await liveSetup(api, dir)
  await startFromUi(page, app)
  await page.waitForSelector('[data-testid=preview-img]')
  const shots = () => (logOf(dir).match(/^SCREENSHOT/gm) ?? []).length
  await new Promise((r) => setTimeout(r, 1800))
  expect(shots() >= 2, `preview polls the emulator (${shots()} screenshots so far)`)
  await page.click('[data-testid=nav-dashboard]')
  await page.waitForSelector('text=Dashboard >> nth=0')
  await new Promise((r) => setTimeout(r, 400)) // let an in-flight request finish
  const before = shots()
  await new Promise((r) => setTimeout(r, 3600))
  expect(shots() === before, `no more screenshots once the screen is closed (${before} -> ${shots()})`)
  // and the emulator keeps running; coming back finds it
  await page.click('[data-testid=nav-emulator]')
  await page.waitForSelector('[data-testid=power-off]')
  await api('session_stop')
})

withEngine(
  'emulator: a forced stop is reported honestly as not clean',
  async ({ page, app, api, dir, shot }) => {
    await liveSetup(api, dir)
    await startFromUi(page, app)
    await page.click('[data-testid=power-off]')
    await page.click('[role=dialog] button:has-text("Power off")')
    // the engine ignores QUIT, so TiLT waits its grace period and then stops it by force
    await page.waitForSelector('[data-testid=stop-outcome]', { timeout: 40000 })
    expect((await page.getAttribute('[data-testid=stop-outcome]', 'data-outcome')) === 'forced', 'outcome is forced')
    const t = await page.textContent('[data-testid=stop-outcome]')
    expect(t.includes('did not exit cleanly') && t.includes('validate'), `explains the consequence: ${t}`)
    const rec = await api('sessions_recent')
    expect(rec[0].outcome === 'unclean', `recorded as unclean: ${rec[0].outcome}`)
    await shot('emulator-forced-stop')
  },
  { FAKE_IGNORE_QUIT: '1' },
)
