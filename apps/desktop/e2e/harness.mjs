// Minimal e2e harness: real backend (amiga-devserver) + real built UI + real Chromium.
// Usage in a spec file:
//   import { test, expect, fixtures } from './harness.mjs'
//   test('name', async ({ page, base, api, dir, app }) => { ... })
// Run:  npm run build && cargo build -p amiga-devserver && node e2e/run.mjs [filter]
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = path.dirname(fileURLToPath(import.meta.url))
export const desktopDir = path.resolve(here, '..')
const repo = path.resolve(desktopDir, '../..')
const SERVER = process.env.AMIGA_DEVSERVER ?? path.join(repo, 'target/debug/amiga-devserver')

export const tests = []
export const test = (name, fn, opts = {}) => tests.push({ name, fn, env: opts.env })

export function expect(cond, msg) {
  if (!cond) throw new Error(msg ?? 'expectation failed')
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux/chrome')
      if (d.startsWith('chromium-') && existsSync(p)) return p
    }
  }
  return undefined // let playwright resolve its own download
}

export async function startBackend(extraEnv = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'amiga-e2e-'))
  const port = await freePort()
  const proc = spawn(SERVER, ['--root', path.join(root, 'Studio'), '--config-dir', path.join(root, 'config'), '--port', String(port), '--static', process.env.E2E_DIST ?? path.join(desktopDir, 'dist')], {
    env: { ...process.env, XDG_RUNTIME_DIR: root, ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/api/app_info`, { method: 'POST', body: '{}' })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  const api = async (cmd, args = {}) => {
    const r = await (await fetch(`${base}/api/${cmd}`, { method: 'POST', body: JSON.stringify(args) })).json()
    if (r.error) throw new Error(`${cmd}: ${r.error.message}`)
    return r.ok
  }
  return { base, api, dir: root, stop: () => proc.kill('SIGTERM') }
}

// ---------- synthetic media (no proprietary data) ----------
function kickSum(buf) {
  let sum = 0n
  for (let i = 0; i < buf.length; i += 4) {
    sum += BigInt(buf.readUInt32BE(i))
    if (sum > 0xffffffffn) sum = (sum & 0xffffffffn) + 1n
  }
  return sum
}
function crc16(data) {
  let crc = 0
  for (const b of data) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
  }
  return crc & 0xffff
}
function blockSum(b) {
  let s = 0
  for (let i = 0; i < b.length; i += 4) s = (s + b.readUInt32BE(i)) >>> 0
  return s
}

export const fixtures = {
  /** Kickstart-shaped file: valid header, footer and checksum, no Commodore code. */
  rom(version, revision, size = 0x40000) {
    const d = Buffer.alloc(size)
    d.writeUInt16BE(size >= 0x80000 ? 0x1114 : 0x1111, 0)
    d.writeUInt16BE(0x4ef9, 2)
    d.writeUInt32BE(0x00f800d2, 4)
    d.writeUInt16BE(version, 12)
    d.writeUInt16BE(revision, 14)
    d.writeUInt32BE(size, size - 0x14)
    const fix = Number((0xffffffffn - kickSum(d)) & 0xffffffffn)
    d.writeUInt32BE(fix >>> 0, size - 0x18)
    return d
  },
  /** Formatted blank AmigaDOS floppy (FFS). */
  adf(name = 'Blank') {
    const d = Buffer.alloc(901120)
    d.write('DOS', 0)
    d[3] = 1
    d.writeUInt32BE(880, 8)
    let sum = 0n
    for (let i = 0; i < 1024; i += 4) {
      if (i === 4) continue
      sum += BigInt(d.readUInt32BE(i))
      if (sum > 0xffffffffn) sum = (sum & 0xffffffffn) + 1n
    }
    d.writeUInt32BE(Number(~sum & 0xffffffffn), 4)
    const r = d.subarray(880 * 512, 881 * 512)
    r.writeUInt32BE(2, 0)
    r.writeUInt32BE(72, 12)
    r.writeUInt32BE(0xffffffff, 312)
    r.writeUInt32BE(881, 316)
    r[432] = name.length
    r.write(name, 433)
    r.writeUInt32BE(1, 508)
    r.writeUInt32BE(0, 20)
    r.writeUInt32BE((0 - blockSum(r)) >>> 0, 20)
    const bm = d.subarray(881 * 512, 882 * 512)
    for (let blk = 2; blk < 1760; blk++) {
      if (blk === 880 || blk === 881) continue
      const i = blk - 2
      const off = (1 + Math.floor(i / 32)) * 4
      bm.writeUInt32BE((bm.readUInt32BE(off) | (1 << i % 32)) >>> 0, off)
    }
    bm.writeUInt32BE((0 - blockSum(bm)) >>> 0, 0)
    return d
  },
  /** NOCOMP DMS wrapping `adf`. */
  dms(adf) {
    const tracks = 80
    const tlen = 22 * 512
    const hdr = Buffer.alloc(56)
    hdr.write('DMS!', 0)
    hdr.writeUInt16BE(0, 16)
    hdr.writeUInt16BE(tracks - 1, 18)
    const total = tracks * tlen
    hdr.writeUIntBE(total, 21, 3)
    hdr.writeUIntBE(total, 25, 3)
    hdr.writeUInt16BE(120, 46)
    hdr.writeUInt16BE(2, 50)
    hdr.writeUInt16BE(0, 52)
    hdr.writeUInt16BE(crc16(hdr.subarray(4, 54)), 54)
    const parts = [hdr]
    for (let t = 0; t < tracks; t++) {
      const data = adf.subarray(t * tlen, (t + 1) * tlen)
      const h = Buffer.alloc(20)
      h.write('TR', 0)
      h.writeUInt16BE(t, 2)
      h.writeUInt16BE(tlen, 6)
      h.writeUInt16BE(tlen, 8)
      h.writeUInt16BE(tlen, 10)
      h[12] = 0
      h[13] = 0
      let s = 0
      for (const b of data) s = (s + b) & 0xffff
      h.writeUInt16BE(s, 14)
      h.writeUInt16BE(crc16(data), 16)
      h.writeUInt16BE(crc16(h.subarray(0, 18)), 18)
      parts.push(h, data)
    }
    return Buffer.concat(parts)
  },
  /** Small RDB disk with one bootable FFS partition. */
  hdf(blocks = 8192) {
    const d = Buffer.alloc(blocks * 512)
    const fix = (b, longs) => {
      b.writeUInt32BE(0, 8)
      b.writeUInt32BE((0 - blockSum(b.subarray(0, longs * 4))) >>> 0, 8)
    }
    const r = d.subarray(0, 512)
    r.write('RDSK', 0)
    r.writeUInt32BE(64, 4)
    r.writeUInt32BE(7, 12)
    r.writeUInt32BE(512, 16)
    r.writeUInt32BE(0x12, 20)
    r.writeUInt32BE(0xffffffff, 24)
    r.writeUInt32BE(1, 28)
    r.writeUInt32BE(0xffffffff, 32)
    r.writeUInt32BE(0xffffffff, 36)
    r.writeUInt32BE(100, 64)
    r.writeUInt32BE(32, 68)
    r.writeUInt32BE(4, 72)
    fix(r, 64)
    const p = d.subarray(512, 1024)
    p.write('PART', 0)
    p.writeUInt32BE(64, 4)
    p.writeUInt32BE(7, 12)
    p.writeUInt32BE(0xffffffff, 16)
    p.writeUInt32BE(1, 20)
    p[36] = 3
    p.write('DH0', 37)
    p.writeUInt32BE(16, 128)
    p.writeUInt32BE(128, 132)
    p.writeUInt32BE(4, 140)
    p.writeUInt32BE(1, 144)
    p.writeUInt32BE(32, 148)
    p.writeUInt32BE(2, 164)
    p.writeUInt32BE(99, 168)
    p.writeUInt32BE(0x444f5301, 192)
    fix(p, 64)
    return d
  },
}

/** Write fixtures into the test's scratch dir and return their paths. */
export function writeFile(dir, name, data) {
  mkdirSync(dir, { recursive: true })
  const p = path.join(dir, name)
  writeFileSync(p, data)
  return p
}

export async function runAll(filter) {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
  let failed = 0
  const artifacts = path.join(here, 'artifacts')
  mkdirSync(artifacts, { recursive: true })
  for (const t of tests) {
    if (filter && !t.name.toLowerCase().includes(filter.toLowerCase())) continue
    for (let attempt = 1; attempt <= 2; attempt++) {
    const backend = await startBackend(t.env ?? {})
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()))
    const started = Date.now()
    try {
      await t.fn({
        page,
        ...backend,
        app: (hash = '') => page.goto(`${backend.base}/#/${hash}`),
        shot: (n) => page.screenshot({ path: path.join(artifacts, `${n}.png`) }),
      })
      if (errors.length) throw new Error(`browser console errors:\n${errors.join('\n')}`)
      console.log(`  PASS  ${t.name}  (${Date.now() - started} ms)${attempt > 1 ? '  [passed on retry]' : ''}`)
      attempt = 99
    } catch (e) {
      if (attempt === 1) {
        console.log(`  retry ${t.name}: ${String(e.message ?? e).split('\n')[0]}`)
      } else {
        failed++
        console.log(`  FAIL  ${t.name}\n        ${String(e.stack ?? e).split('\n').join('\n        ')}`)
        await page.screenshot({ path: path.join(artifacts, `FAIL-${t.name.replace(/\W+/g, '_')}.png`) }).catch(() => {})
      }
    } finally {
      await ctx.close()
      backend.stop()
    }
    }
  }
  await browser.close()
  return failed
}
