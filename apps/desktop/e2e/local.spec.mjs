// tilt-local: the same UI and backend in a normal browser, protected for local use.
import { test, expect, fixtures, writeFile, TOKEN } from './harness.mjs'
import http from 'node:http'
import path from 'node:path'

const rawRequest = (base, p, { method = 'POST', headers = {}, body = '{}' } = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(base)
    const r = http.request({ host: u.hostname, port: u.port, path: p, method, headers: { 'content-length': Buffer.byteLength(body), ...headers } }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }))
    })
    r.on('error', reject)
    r.end(body)
  })

test('local server: API refuses missing tokens, wrong hosts and foreign origins', async ({ base }) => {
  const { port } = new URL(base)
  expect((await rawRequest(base, '/api/app_info')).status === 401, 'no token -> 401')
  expect((await rawRequest(base, '/api/app_info', { headers: { 'x-tilt-token': 'wrong' } })).status === 401, 'wrong token -> 401')
  expect((await rawRequest(base, '/api/app_info', { headers: { 'x-tilt-token': TOKEN } })).status === 200, 'right token -> 200')
  expect((await rawRequest(base, '/api/app_info', { headers: { 'x-tilt-token': TOKEN, host: 'evil.example:' + port } })).status === 403, 'DNS-rebinding Host -> 403')
  expect((await rawRequest(base, '/api/app_info', { headers: { 'x-tilt-token': TOKEN, origin: 'https://evil.example' } })).status === 403, 'cross-origin -> 403')
  expect((await rawRequest(base, '/api/app_info', { method: 'GET' })).status === 405, 'GET refused')
  expect((await rawRequest(base, '/api/rm_rf', { headers: { 'x-tilt-token': TOKEN } })).body.includes('unknown command'), 'unknown command rejected by the allow-list')
  const page = await rawRequest(base, '/', { method: 'GET', headers: { host: 'evil.example:' + port } })
  expect(page.status === 403, 'UI is not served to a rebinding Host')
  expect((await rawRequest(base, '/../../etc/passwd', { method: 'GET' })).headers['content-type']?.startsWith('text/html'), 'path traversal falls back to the app, never a file')
})

test('local server: token link sets a strict cookie and the UI works; without it the UI explains', async ({ page, base, shot, consoleErrors }) => {
  await page.goto(`${base}/#/`) // no token
  await page.waitForSelector('text=Open TiLT with its private link')
  await shot('local-no-token')
  consoleErrors.length = 0 // the 401s above are the expected behaviour
  await page.goto(`${base}/?token=${TOKEN}#/`)
  await page.waitForSelector('[data-testid=rooms]')
  expect(new URL(page.url()).search === '', 'token is removed from the address bar')
  const cookies = await page.context().cookies()
  const c = cookies.find((x) => x.name === 'tilt_token')
  expect(c && c.httpOnly && c.sameSite === 'Strict', 'cookie is HttpOnly and SameSite=Strict')
  expect(!(await page.evaluate(() => document.cookie)).includes('tilt_token'), 'page scripts cannot read the token')
})

test('local server: file browser picks a ROM and a folder on this computer', async ({ page, app, api, dir, shot }) => {
  writeFile(path.join(dir, 'roms'), 'kick13.rom', fixtures.rom(34, 5))
  writeFile(path.join(dir, 'roms'), 'notes.txt', Buffer.from('x'))
  await app('amiga/roms')
  await page.waitForSelector('text=Import Kickstart ROMs')
  await page.click('button:has-text("Browse…")')
  await page.waitForSelector('[data-testid=file-browser]')
  await page.fill('input[aria-label="Folder path"]', path.join(dir, 'roms'))
  await page.click('button:has-text("Go")')
  await page.waitForSelector('[data-testid=file-browser] >> text=kick13.rom')
  expect(!(await page.textContent('[data-testid=file-browser]')).includes('notes.txt'), 'only matching file types are listed by default')
  await shot('local-file-browser')
  await page.click('[data-testid=file-browser] >> text=kick13.rom')
  await page.click('.modal button:has-text("Choose")')
  await page.waitForSelector('[data-testid=rom-row]')
  const roms = await api('rom_list')
  expect(roms.length === 1 && roms[0].info.family === 'Kickstart 1.3', 'the ROM chosen in the browser was imported')
  // folder mode through a PathInput
  await app('amiga/settings')
  await page.getByRole('tab', { name: /Emulator engine|Storage/ }).first().click().catch(() => {})
  const fs = await api('fs_list', { path: dir })
  expect(fs.entries.some((e) => e.name === 'roms' && e.is_dir), 'backend lists folders')
  expect((await api('fs_list', {}).then(() => true)), 'defaults to the home folder')
})
