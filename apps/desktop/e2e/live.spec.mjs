// Live-emulator UI test: drives the REAL UI against the REAL backend and a REAL Amiberry
// booting the open-source AROS ROM. Linux/macOS only. Skipped unless these are set:
//   AMIBERRY_BIN  AROS_ROM  AROS_EXT  DISPLAY (use xvfb-run on headless machines)
import { test, expect, fixtures, writeFile } from './harness.mjs'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { AMIBERRY_BIN, AROS_ROM, AROS_EXT, DISPLAY } = process.env

if (AMIBERRY_BIN && AROS_ROM && AROS_EXT && DISPLAY) {
  test(
    'live: boot AROS on an A1200 from the UI, hot-swap a floppy, control and power off',
    async ({ page, app, api, dir, shot }) => {
      await api('engine_set_path', { path: AMIBERRY_BIN })
      // 1. import the real (open-source) ROMs through the first-run wizard path
      const rom = path.join(dir, 'aros-rom.bin')
      const ext = path.join(dir, 'aros-ext.bin')
      copyFileSync(AROS_ROM, rom)
      copyFileSync(AROS_EXT, ext)
      await app('amiga/roms')
      for (const f of [rom, ext]) {
        await page.fill('input[aria-label="File path"]', f)
        await page.click('button:has-text("Import")')
        await page.waitForTimeout(300)
      }
      await page.waitForSelector('[data-testid=rom-row]')
      const roms = await api('rom_list')
      expect(roms.length === 2 && roms.every((r) => r.info.is_aros), 'both AROS ROMs imported and recognised')
      const main = roms.find((r) => r.info.exec_version === 46 && r.name.includes('rom'))
      const extr = roms.find((r) => r.id !== main.id)
      // 2. configure the A1200 with the ROMs, a blank hard disk and a floppy
      const hdfSrc = writeFile(dir, 'blank.hdf', Buffer.alloc(8 * 1024 * 1024))
      const { job } = await api('hdf_import', { path: hdfSrc, name: 'Blank', keep_pristine: false, accept_unrecognised: false })
      for (let i = 0; i < 100 && (await api('job_get', { id: job })).state === 'running'; i++) await new Promise((r) => setTimeout(r, 100))
      const hdf = (await api('hdf_list'))[0]
      const disk = (await api('media_create_blank', { name: 'Work', fs: 'ffs', density: 'double' })).id
      const p = await api('profile_get', { id: 'preset-a1200' })
      await api('profile_save', {
        profile: { ...p, rom_id: main.id, ext_rom_id: extr.id, hard_disks: [{ hdf_id: hdf.id, controller: 'mainboard_ide', read_only: false, boot_priority: 0 }] },
      })
      // 3. start from the UI
      await app('amiga/emulator')
      await page.waitForSelector('[data-testid=start-machine]')
      await page.selectOption('[data-testid=machine-select]', 'preset-a1200')
      await page.click('[data-testid=start-machine]')
      await page.waitForSelector('[data-testid=power-off]', { timeout: 30000 })
      expect((await page.textContent('[data-testid=start-notes]')).toLowerCase().includes('safety backup'), 'the safety backup of the hard disk is announced')
      // 4. the preview shows REAL emulated graphics (not a blank frame)
      await page.waitForSelector('[data-testid=preview-img]', { timeout: 30000 })
      let colours = 0
      for (let i = 0; i < 30 && colours < 4; i++) {
        await page.waitForTimeout(1500)
        colours = await page.evaluate(async () => {
          const img = document.querySelector('[data-testid=preview-img]')
          if (!img || !img.naturalWidth) return 0
          const c = document.createElement('canvas')
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          const g = c.getContext('2d')
          g.drawImage(img, 0, 0)
          const d = g.getImageData(0, 0, c.width, c.height).data
          const set = new Set()
          for (let i = 0; i < d.length && set.size < 16; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
          return set.size
        })
      }
      expect(colours >= 4, `the emulated screen shows graphics (${colours} colours)`)
      await shot('live-emulator-running')
      // 5. runtime controls
      await page.click('[data-testid=pause]')
      await page.waitForFunction(() => document.body.textContent.includes('Paused'), null, { timeout: 10000 })
      await page.click('[data-testid=resume]')
      await page.click('[data-testid=reset-soft]')
      // 6. hot-swap a floppy in DF1 through the UI
      await page.selectOption('[aria-label="Insert a disk into DF1"]', disk)
      await page.click('[data-testid=df-1] button:has-text("Insert")')
      let df1 = null
      for (let i = 0; i < 100 && df1 !== disk; i++) {
        await new Promise((r) => setTimeout(r, 150))
        df1 = (await api('session_drives'))[1].media_id
      }
      expect(df1 === disk, 'DF1 shows the disk that was hot-swapped in through the UI')
      // 7. power off cleanly; the disk is then free for maintenance
      await page.click('[data-testid=power-off]')
      await page.click('.modal button:has-text("Power off")')
      await page.waitForSelector('[data-testid=stop-outcome][data-outcome=clean]', { timeout: 30000 })
      const recent = await api('sessions_recent')
      expect(recent[0].outcome === 'clean', 'session recorded as a clean exit')
      const snap = await api('hdf_backup', { id: hdf.id, kind: 'backup', note: 'after live test' })
      expect(!!snap.job, 'backup possible once the machine is off')
    },
    {
      env: {
        HOME: mkdtempSync(path.join(tmpdir(), 'amiga-live-home-')),
        SDL_AUDIODRIVER: 'dummy',
        DISPLAY,
        XDG_RUNTIME_DIR: mkdtempSync(path.join(tmpdir(), 'amiga-live-xdg-')),
      },
    },
  )
}
void fixtures
