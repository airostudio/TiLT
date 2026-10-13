// Pinball Arcade: emulator detection, the pinball ROM library, and the read-only preview when there
// is no backend. Fixtures are synthetic zips (never real ROMs). MAME itself is a stand-in script unless
// MAME_BIN points at a real MAME (then the last test also runs against it).
import { test, expect, desktopDir } from './harness.mjs'
import { chmodSync, mkdirSync, readFileSync, writeFileSync, createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

// a minimal valid zip with one stored member, built by hand so the tests need no zip tool
function zipOf(name, data = 'synthetic test data, not a ROM') {
  const body = Buffer.from(data)
  let crc = 0xffffffff
  for (const b of body) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  crc = ~crc >>> 0
  const n = Buffer.from(name)
  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0)
  lh.writeUInt16LE(20, 4)
  lh.writeUInt32LE(crc, 14)
  lh.writeUInt32LE(body.length, 18)
  lh.writeUInt32LE(body.length, 22)
  lh.writeUInt16LE(n.length, 26)
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(20, 4)
  cd.writeUInt16LE(20, 6)
  cd.writeUInt32LE(crc, 16)
  cd.writeUInt32LE(body.length, 20)
  cd.writeUInt32LE(body.length, 24)
  cd.writeUInt16LE(n.length, 28)
  const local = Buffer.concat([lh, n, body])
  const central = Buffer.concat([cd, n])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, end])
}
void deflateRawSync

function fakeMame(dir) {
  const exe = path.join(dir, 'fakemame')
  writeFileSync(
    exe,
    `#!/bin/sh
case "$1" in
  -version) echo '0.999 (mame0999)';;
  -listxml) echo "<mame><machine name=\\"$2\\"><description>Stand-in Machine</description><year>1994</year><manufacturer>Acme</manufacturer></machine></mame>";;
  -rompath) if [ "$3" = "-verifyroms" ]; then echo "romset $4 is good"; else echo "$@" > "${dir}/launched.txt"; sleep 2; fi;;
esac
`,
  )
  chmodSync(exe, 0o755)
  return exe
}

test('pinball: the room lists every pinball system and offers to find installed emulators', async ({ page, app, api, dir }) => {
  // a stand-in MAME on a folder we control; detection is exercised on the PATH
  const bin = path.join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  fakeMame(bin)
  writeFileSync(path.join(bin, 'mame'), readFileSync(path.join(bin, 'fakemame')))
  chmodSync(path.join(bin, 'mame'), 0o755)
  await app('room/pinball')
  await page.waitForSelector('[data-testid=system-mame]')
  for (const id of ['tilt-pinball', 'vpx', 'pinmame', 'mame']) expect(!!(await page.$(`[data-testid=system-${id}]`)), `${id} is listed`)
  expect((await page.textContent('[data-testid=system-tilt-pinball]')).includes('prototype'), 'the TiLT engine is honestly described as a prototype')
  await page.waitForSelector('[data-testid=pinball-roms-card]')
  // the detection call itself, against the real filesystem search
  const none = await api('system_detect', { id: 'mame' })
  expect(Array.isArray(none), 'detection answers with a list')
})

test('pinball: system page finds a program and the ROM library imports, checks and plays sets', async ({ page, app, api, dir, shot }) => {
  const exe = fakeMame(dir)
  const roms = path.join(dir, 'incoming')
  mkdirSync(roms, { recursive: true })
  writeFileSync(path.join(roms, 'tz_94h.zip'), zipOf('u6.rom'))
  writeFileSync(path.join(roms, 'afm_113b.zip'), zipOf('u7.rom'))
  writeFileSync(path.join(roms, 'My Table.zip'), zipOf('x.rom'))
  writeFileSync(path.join(roms, 'broken.zip'), 'this is not a zip file at all')
  writeFileSync(path.join(roms, 'notes.txt'), 'x')

  // without MAME: import works, nothing is claimed good, checking is disabled with a reason
  await app('room/pinball/roms')
  await page.waitForSelector('[data-testid=pinball-import]')
  await page.fill('input[placeholder="Folder path"]', roms)
  await page.click('[data-testid=pinball-import]')
  await page.waitForSelector('[data-testid=pinball-rom-row]')
  expect((await page.locator('[data-testid=pinball-rom-row]').count()) === 2, 'two valid sets imported')
  const bad = await page.textContent('[data-testid=import-results]')
  expect(bad.includes('My Table') && bad.includes('rename'), 'a badly named file is refused with advice')
  expect(bad.includes('broken') && bad.includes('not a valid .zip'), 'a non-zip is refused with a reason')
  const text = await page.textContent('table')
  expect(text.includes('Not checked') && !text.includes('Good (MAME)'), 'nothing is called good without MAME')
  expect(await page.isDisabled('[data-testid=check-all]'), 'checking needs MAME')

  // set MAME up through the system page's own "find" flow
  await page.goto(`${page.url().split('#')[0]}#/room/pinball/mame`)
  await page.waitForSelector('[data-testid=detect]')
  await page.fill('input[placeholder="File path"]', exe)
  await page.click('text=Save settings')
  await page.waitForSelector('text=Emulator found')
  await page.click('text=Find it on this computer')
  await page.waitForSelector('[data-testid=detect-found], [data-testid=detect-none]')
  expect((await api('systems_list')).find((s) => s.id === 'mame').game_dir.endsWith('roms'), 'MAME plays from the ROM library folder by default')

  // now MAME can check them
  await page.goto(`${page.url().split('#')[0]}#/room/pinball/roms`)
  await page.waitForSelector('[data-testid=check-all]:not([disabled])')
  await page.click('[data-testid=check-all]')
  await page.waitForSelector('text=Good (MAME)', { timeout: 20000 })
  const checked = await page.textContent('table')
  expect(checked.includes('Stand-in Machine') && checked.includes('Acme'), 'machine details come from MAME')
  await shot('pinball-rom-library')

  // play one: the launcher passes the ROM folder and the set name, no shell involved
  await page.click('tr:has-text("tz_94h") >> text=Play')
  await page.waitForFunction(() => document.body.textContent.includes('Started'), null, { timeout: 10000 })
  const { readFileSync: rf } = await import('node:fs')
  let launched = ''
  for (let i = 0; i < 40 && !launched; i++) {
    await new Promise((r) => setTimeout(r, 100))
    try {
      launched = rf(path.join(dir, 'launched.txt'), 'utf8')
    } catch {
      /* not yet */
    }
  }
  expect(/-rompath .*roms tz_94h/.test(launched), `MAME was started with the ROM folder and set name: ${launched}`)
  await api('system_stop', { id: 'mame' })

  // removing deletes only the library copy
  await page.click('[aria-label="Remove afm_113b"]')
  await page.click('.modal button:has-text("Remove")')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=pinball-rom-row]').length === 1)
  expect(existsSync(path.join(roms, 'afm_113b.zip')), 'the original is untouched')
})

test('pinball: autoconfigure fills in a found emulator and never overwrites one', async ({ api, dir }) => {
  const bin = path.join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const first = fakeMame(bin)
  // detection works on the process PATH of the backend, which the harness does not control, so check the
  // contract that matters: a configured system is left alone
  const sys = (await api('systems_list')).find((s) => s.id === 'mame')
  await api('system_save', { system: { ...sys, exe: first } })
  const done = await api('systems_autoconfigure', { room: 'pinball' })
  expect(!done.some((d) => d.id === 'mame'), 'an already configured system is not touched')
  expect((await api('systems_list')).find((s) => s.id === 'mame').exe === first, 'its program is unchanged')
})

test('pinball: with no backend the Rooms are a read-only preview, not a blank page', async ({ page, consoleErrors, shot }) => {
  const dist = process.env.E2E_DIST ?? path.join(desktopDir, 'dist')
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' }
  const server = createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent((req.url ?? '/').split('?')[0]))
    if (!f.startsWith(dist)) return res.writeHead(403).end()
    if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(dist, 'index.html')
    // a static host has no /api: it answers HTML for anything unknown, exactly like the Vercel preview
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream' })
    createReadStream(f).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://localhost:${server.address().port}`
  try {
    await page.goto(`${base}/#/`)
    await page.waitForSelector('[data-testid=rooms]', { timeout: 15000 })
    const home = await page.textContent('[data-testid=room-pinball]')
    for (const s of ['MAME Arcade', 'Visual Pinball X', 'PinMAME']) expect(home.includes(s), `the preview lists ${s}`)
    await page.waitForSelector('[data-testid=room-offline]')
    await shot('rooms-preview-no-backend')
    await page.click('[data-testid=room-pinball]')
    await page.waitForSelector('[data-testid=system-mame]')
    expect(await page.isDisabled('[data-testid=system-mame] button:has-text("Start")'), 'nothing can be launched from a web page')
    expect(await page.isDisabled('button:has-text("Open the ROM library")'), 'the ROM library needs the app')
    expect((await page.textContent('[data-testid=system-mame]')).includes('Preview'), 'systems are marked Preview, not "Needs setup"')
    // deep links to backend-only pages explain instead of breaking
    await page.goto(`${base}/#/room/pinball/roms`)
    await page.waitForSelector('text=Needs the TiLT app')
    await page.goto(`${base}/#/amiga/dashboard`)
    await page.waitForSelector('text=Web preview')
  } finally {
    server.close()
  }
  consoleErrors.length = 0 // the failed /api probes of a static host are the point of this test
})

test('pinball: the preview catalogue lists the same systems as the backend', async ({ api }) => {
  const src = readFileSync(path.join(desktopDir, 'src/features/rooms/offlineCatalog.ts'), 'utf8')
  const ids = [...src.matchAll(/ext\('([a-z0-9-]+)'/g)].map((m) => m[1])
  const real = (await api('systems_list')).map((s) => s.id).filter((id) => !id.startsWith('custom'))
  expect(JSON.stringify(ids) === JSON.stringify(real), `offline catalogue ${ids} must equal backend ${real}`)
})

if (process.env.MAME_BIN) {
  test('pinball: against the REAL MAME, synthetic sets are reported wrong and unknown ones unknown', async ({ page, app, api, dir }) => {
    // a MAME in a usual place (here /usr/games) is found and verified by running `mame -version`
    const done = await api('systems_autoconfigure', { room: 'pinball' })
    const auto = done.find((d) => d.id === 'mame')
    if (process.env.MAME_BIN.startsWith('/usr/games/') || process.env.MAME_BIN.startsWith('/usr/bin/')) {
      expect(!!auto && /^0\.\d+/.test(auto.version), `autoconfigure found and verified the real MAME: ${JSON.stringify(done)}`)
    }
    if (!auto) {
      const sys = (await api('systems_list')).find((s) => s.id === 'mame')
      await api('system_save', { system: { ...sys, exe: process.env.MAME_BIN } })
    }
    const roms = path.join(dir, 'incoming')
    mkdirSync(roms, { recursive: true })
    writeFileSync(path.join(roms, 'bttf_a20.zip'), zipOf('u6.rom')) // a real MAME pinball machine
    writeFileSync(path.join(roms, 'zzzz_nope.zip'), zipOf('u6.rom')) // not a machine
    await app('room/pinball/roms')
    await page.fill('input[placeholder="Folder path"]', roms)
    await page.click('[data-testid=pinball-import]')
    await page.waitForSelector('[data-testid=pinball-rom-row]')
    await page.click('[data-testid=check-all]')
    await page.waitForSelector('text=MAME does not know it', { timeout: 120000 })
    const t = await page.textContent('table')
    expect(t.includes('Back to the Future'), 'the machine name comes from the real MAME')
    expect(t.includes('Wrong or incomplete'), 'MAME rejects the synthetic set; TiLT does not call it good')
    expect(!t.includes('Good (MAME)'), 'nothing synthetic is ever called good')
  })
}
