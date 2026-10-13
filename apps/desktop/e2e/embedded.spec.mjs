// Embedded-machine UI test: drives the REAL UI against the REAL backend, which hosts the REAL Amiberry
// libretro core in-process and boots the open-source AROS ROM. No display server and no standalone
// Amiberry are involved. Skipped unless these are set: LIBRETRO_CORE AROS_ROM AROS_EXT
import { test, expect } from './harness.mjs'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { LIBRETRO_CORE, AROS_ROM, AROS_EXT } = process.env

// Counts distinct colours and finds the centre of the red mouse pointer in the live picture.
const probe = () =>
  document.querySelector('[data-testid=live-img]') &&
  (() => {
    const img = document.querySelector('[data-testid=live-img]')
    if (!img.naturalWidth) return null
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    const set = new Set()
    let n = 0
    let sx = 0
    let sy = 0
    for (let i = 0; i < d.length; i += 4) {
      if (set.size < 16) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      if (d[i] > 150 && d[i + 1] < 60 && d[i + 2] < 60) {
        n++
        sx += (i / 4) % c.width
        sy += Math.floor(i / 4 / c.width)
      }
    }
    return { colours: set.size, pointer: n >= 10 ? [sx / n, sy / n] : null }
  })()

if (LIBRETRO_CORE && AROS_ROM && AROS_EXT) {
  test(
    'embedded: boot AROS inside the app, type and move the mouse, pause, swap DF0, save state, power off',
    async ({ page, app, api, dir, shot }) => {
      await api('embedded_set_core', { path: LIBRETRO_CORE })
      const info = await api('app_info')
      expect(info.embedded_core === LIBRETRO_CORE, 'the backend reports the embedded core')
      const rom = path.join(dir, 'aros-rom.bin')
      const ext = path.join(dir, 'aros-ext.bin')
      copyFileSync(AROS_ROM, rom)
      copyFileSync(AROS_EXT, ext)
      const imp = await api('rom_import', { paths: [rom, ext], copy: true })
      const main = imp.map((r) => r.ok.record).find((r) => r.info.exec_version === 46 && r.name.includes('rom'))
      const extr = imp.map((r) => r.ok.record).find((r) => r.id !== main.id)
      const work = (await api('media_create_blank', { name: 'Work', fs: 'ofs', density: 'double' })).id
      const p = await api('profile_get', { id: 'preset-a1200' })
      await api('profile_save', { profile: { ...p, rom_id: main.id, ext_rom_id: extr.id, hard_disks: [] } })

      // start inside the app, chosen in the UI
      await app('amiga/emulator')
      await page.waitForSelector('[data-testid=mode-select]')
      await page.selectOption('[data-testid=mode-select]', 'embedded')
      await page.selectOption('[data-testid=machine-select]', 'preset-a1200')
      expect((await page.textContent('[data-testid=check-engine]')).includes('inside TiLT'), 'readiness says it will run inside TiLT')
      await page.click('[data-testid=start-machine]')
      await page.waitForSelector('[data-testid=power-off]', { timeout: 30000 })
      expect((await page.textContent('[data-testid=emu-meta]')).includes('inside TiLT'), 'status says the machine runs inside TiLT')

      // the picture is real emulated graphics and a mouse movement moves the guest's pointer
      await page.waitForSelector('[data-testid=live-img]', { timeout: 30000 })
      let first = null
      for (let i = 0; i < 150 && !(first && first.colours >= 4 && first.pointer); i++) {
        await page.waitForTimeout(100)
        first = await page.evaluate(probe)
      }
      expect(first && first.colours >= 4, `the live picture shows graphics (${first?.colours} colours)`)
      expect(!!first.pointer, 'the guest pointer is visible')
      await page.click('[data-testid=live-screen]')
      await page.waitForFunction(() => document.querySelector('[data-testid=live-screen]').dataset.captured === 'true')
      const box = await page.locator('[data-testid=live-screen]').boundingBox()
      let x = box.x + box.width / 2
      let y = box.y + box.height / 2
      await page.mouse.move(x, y)
      let moved = null
      // quick: AROS's picture goes dark a few seconds after boot, so keep this window short
      for (let i = 0; i < 8; i++) {
        x += 10
        y += 7
        await page.mouse.move(x, y)
        await page.waitForTimeout(30)
      }
      for (let i = 0; i < 100 && !(moved && moved.pointer && moved.pointer[0] > first.pointer[0] + 20); i++) {
        await page.waitForTimeout(100)
        moved = await page.evaluate(probe)
      }
      expect(!!moved?.pointer && moved.pointer[0] > first.pointer[0] + 20, `moving the mouse over the screen moves the guest pointer (${first.pointer} -> ${moved?.pointer})`)
      await shot('embedded-running')
      await page.keyboard.press('KeyA') // accepted without error
      await page.keyboard.press('Control+Alt')
      await page.waitForFunction(() => document.querySelector('[data-testid=live-screen]').dataset.captured === 'false')

      // pause / resume
      await page.click('[data-testid=pause]')
      await page.waitForFunction(() => document.body.textContent.includes('Paused'), null, { timeout: 10000 })
      expect((await api('session_status')).paused === true, 'the backend reports paused')
      await page.click('[data-testid=resume]')
      await page.waitForSelector('[data-testid=pause]')

      // the embedded-mode honesty notes are on screen
      await page.waitForSelector('[data-testid=embedded-no-sound]')
      expect((await page.textContent('[data-testid=embedded-df-note]')).includes('only DF0'), 'the DF0-only limit is stated')
      expect((await page.locator('[data-testid=df-1]').textContent()).includes('Fixed while running'), 'DF1 is shown as fixed')

      // DF0 swap through the UI
      await page.selectOption('[aria-label="Insert a disk into DF0"]', work)
      await page.click('[data-testid=df-0] button:has-text("Insert")')
      let df0 = null
      for (let i = 0; i < 50 && df0 !== work; i++) {
        await page.waitForTimeout(150)
        df0 = (await api('session_drives'))[0].media_id
      }
      expect(df0 === work, 'DF0 shows the disk that was inserted through the UI')

      // saved state (floppy-only machine)
      await page.click('button:has-text("Save state")')
      await page.waitForSelector('[data-testid=state-note]', { timeout: 20000 })

      // power off cleanly
      await page.click('[data-testid=power-off]')
      await page.click('.modal button:has-text("Power off")')
      await page.waitForSelector('[data-testid=stop-outcome][data-outcome=clean]', { timeout: 30000 })
      expect((await api('sessions_recent'))[0].outcome === 'clean', 'session recorded as a clean exit')
      expect((await api('session_status')).running === false, 'nothing is running afterwards')
    },
    { env: { HOME: mkdtempSync(path.join(tmpdir(), 'amiga-embedded-home-')) } },
  )
}
