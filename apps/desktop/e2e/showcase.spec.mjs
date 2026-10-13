// Generates the real screenshots used by the web preview page (public/preview/*.png).
// Only runs with SHOWCASE=1:  SHOWCASE=1 node e2e/run.mjs showcase
import { test, fixtures, writeFile } from './harness.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/preview')

if (process.env.SHOWCASE) {
  test('showcase: capture preview screenshots', async ({ page, app, api, dir }) => {
    const k13 = writeFile(dir, 'a.rom', fixtures.rom(34, 5))
    const k31 = writeFile(dir, 'b.rom', fixtures.rom(40, 68, 0x80000))
    const r = await api('rom_import', { paths: [k13, k31], copy: true })
    const roms = await api('rom_list')
    for (const p of await api('profile_list')) {
      const want = p.chipset === 'ocs' ? 34 : 40
      const rom = roms.find((x) => x.info.exec_version === want)
      if (rom && p.model !== 'custom') await api('profile_save', { profile: { ...p, rom_id: rom.id } })
    }
    const hdf = writeFile(dir, 'Work.hdf', fixtures.hdf())
    const { job } = await api('hdf_import', { path: hdf, name: 'Work', keep_pristine: true })
    for (let i = 0; i < 100; i++) {
      if ((await api('job_get', { id: job })).state !== 'running') break
      await new Promise((r) => setTimeout(r, 100))
    }
    await api('media_import', { paths: [writeFile(dir, 'Game.adf', fixtures.adf('Game')), writeFile(dir, 'Tools.adf', fixtures.adf('Tools'))] })
    await new Promise((r) => setTimeout(r, 800))
    const snap = async (hash, name, sel) => {
      await app(hash)
      await page.waitForSelector(sel)
      await page.waitForTimeout(400)
      await page.screenshot({ path: path.join(out, `${name}.png`) })
    }
    await app('amiga/dashboard')
    await page.evaluate(() => localStorage.setItem('tilt.amiga.machine', '"preset-a1200_040"'))
    await snap('', 'rooms', '[data-testid=rooms]')
    await snap('amiga/dashboard', 'dashboard', '[data-testid=current-machine]')
    await snap('amiga/machines', 'machines', 'h1')
    await snap('amiga/harddrives', 'harddrives', 'h1')
    void r
  })
}
