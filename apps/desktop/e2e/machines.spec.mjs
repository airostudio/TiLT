import { test, expect, fixtures, writeFile } from './harness.mjs'

const AGA_ROM = () => fixtures.rom(40, 68, 0x80000)
const KS13_ROM = () => fixtures.rom(34, 5)

async function importRom(api, dir, name, data) {
  const p = writeFile(dir, name, data)
  const [r] = await api('rom_import', { paths: [p] })
  if (r.error) throw new Error(r.error.message)
  return r.ok.record
}

const profileByName = async (api, name) => (await api('profile_list')).find((p) => p.name === name)

async function openEditor(page, app, name) {
  await app('amiga/machines')
  await page.waitForSelector(`[data-testid^=machine-]:has(h2:text-is("${name}"))`)
  await page.click(`[data-testid^=machine-]:has(h2:text-is("${name}")) >> text=Edit`)
  await page.waitForSelector('[data-testid=validation-summary]')
}

const waitChecked = (page) => page.waitForFunction(() => !document.querySelector('[data-testid=validation-summary]')?.textContent?.includes('Checking'))

test('machines: seeded presets are listed with real specs and a validation badge', async ({ page, app, api, shot }) => {
  await app('amiga/machines')
  await page.waitForSelector('[data-testid^=machine-]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^=machine-]').length >= 10)
  const text = await page.textContent('main')
  for (const n of ['Classic Amiga 500', 'Amiga 500+', 'Amiga 1200', 'A1200 with 68030 accelerator', 'A1200 with 68040 accelerator', 'Amiga 3000', 'Amiga 4000/040', 'Custom Amiga', 'A500 with 68020 accelerator', 'A500 with 68030 accelerator'])
    expect(text.includes(n), `lists ${n}`)
  const card = await page.textContent('[data-testid^=machine-]:has(h2:text-is("A1200 with 68040 accelerator"))')
  expect(card.includes('68040 + FPU + MMU'), `shows CPU with FPU and MMU: ${card}`)
  expect(card.includes('2 MB Chip') && card.includes('32 MB Accelerator RAM'), 'shows chip and fast RAM')
  expect(card.includes('None selected'), 'no Kickstart is honestly reported as not selected')
  expect(card.includes('1 warning'), `validation badge shows the missing-Kickstart warning: ${card}`)
  const profs = await api('profile_list')
  expect(profs.length === 10, 'ten seeded presets')
  await shot('machines-list')
})

test('machines: Kickstart label and Ready badge appear once a ROM is chosen', async ({ page, app, api, dir }) => {
  const rom = await importRom(api, dir, 'ks31.rom', AGA_ROM())
  const p = await profileByName(api, 'Amiga 1200')
  p.rom_id = rom.id
  await api('profile_save', { profile: p })
  await app('amiga/machines')
  const sel = '[data-testid^=machine-]:has(h2:text-is("Amiga 1200"))'
  await page.waitForSelector(`${sel} .badge:text-is("Ready")`)
  const t = await page.textContent(sel)
  expect(t.includes(rom.info.label), `shows detected label ${rom.info.label}: ${t}`)
})

test('machines: new machine from a preset is unsaved until Save, then persists across reload', async ({ page, app, api, dir, shot }) => {
  const rom = await importRom(api, dir, 'ks31.rom', AGA_ROM())
  await app('amiga/machines')
  await page.click('[data-testid=new-machine]')
  await page.waitForSelector('[data-testid=preset-a1200_040]')
  const modal = await page.textContent('[role=dialog]')
  expect(modal.includes('never a particular physical expansion board'), 'presets are described as generic')
  expect(modal.includes('A1200 with 68040 accelerator') && modal.includes('Classic Amiga 500'), 'preset titles from the backend')
  await shot('machines-new-modal')
  await page.click('[data-testid=preset-a1200_040]')
  await page.fill('[role=dialog] input:not([type=radio])', 'My 040 Amiga')
  await page.click('[data-testid=create-machine]')
  await page.waitForSelector('text=New, not saved yet')
  expect(!(await profileByName(api, 'My 040 Amiga')), 'nothing is saved before pressing Save')
  await waitChecked(page)
  await page.selectOption('#sec-kickstart select >> nth=0', rom.id)
  await waitChecked(page)
  await page.waitForFunction(() => !document.querySelector('[data-testid=save]').disabled)
  await shot('machines-editor-top')
  await page.click('[data-testid=save]')
  await page.waitForSelector('text=Saved “My 040 Amiga”')
  const saved = await profileByName(api, 'My 040 Amiga')
  expect(saved && saved.rom_id === rom.id && saved.cpu.model === '68040' && saved.cpu.fpu === 'internal' && saved.memory.accel_mb === 32, 'saved profile matches the preset plus the chosen ROM')
  await page.reload()
  await page.waitForSelector('[data-testid=validation-summary]')
  expect((await page.inputValue('#sec-general input')) === 'My 040 Amiga', 'name persisted after a page reload')
  expect((await page.inputValue('#sec-kickstart select >> nth=0')) === rom.id, 'Kickstart choice persisted after reload')
  expect((await page.inputValue('#sec-cpu select >> nth=0')) === '68040', 'CPU persisted after reload')
})

test('machines: impossible hardware is flagged inline and blocks saving', async ({ page, app, api, shot }) => {
  await openEditor(page, app, 'Amiga 1200')
  await waitChecked(page)
  // 68EC040 + internal FPU
  await page.selectOption('#sec-cpu select >> nth=0', '68EC040')
  await page.selectOption('#sec-cpu select >> nth=1', 'internal')
  await page.waitForSelector('[data-field="cpu.fpu"] .fi.error')
  const fpu = await page.textContent('[data-field="cpu.fpu"]')
  expect(fpu.includes('The 68EC040 has no FPU'), `inline FPU error explains why: ${fpu}`)
  expect(await page.isDisabled('[data-testid=save]'), 'Save is disabled while errors exist')
  const blocked = await page.textContent('[data-testid=save-blocked]')
  expect(blocked.includes('Cannot save'), 'a plain-language reason is shown')
  const summary = await page.textContent('[data-testid=validation-summary]')
  expect(summary.includes('Problems') && summary.includes('The 68EC040 has no FPU'), 'summary lists the error')
  // the field is marked invalid for assistive tech
  expect((await page.getAttribute('#sec-cpu select >> nth=1', 'aria-invalid')) === 'true', 'aria-invalid set on the FPU select')
  await shot('machines-editor-fpu-error')
  // MMU on a 68EC040
  await page.check('#sec-cpu input[role=switch] >> nth=0')
  await page.waitForSelector('[data-field="cpu.mmu"] .fi.error')
  expect((await page.textContent('[data-field="cpu.mmu"]')).includes('no MMU'), 'MMU error')
  // Fix both
  await page.selectOption('#sec-cpu select >> nth=1', 'none')
  await page.uncheck('#sec-cpu input[role=switch] >> nth=0')
  await page.waitForFunction(() => !document.querySelector('[data-testid=save]').disabled)
  // The backend, not just the UI, refuses an impossible profile
  const p = await api('profile_get', { id: (await profileByName(api, 'Amiga 1200')).id })
  p.cpu.model = '68EC040'
  p.cpu.fpu = 'internal'
  let refused = ''
  try {
    await api('profile_save', { profile: p })
  } catch (e) {
    refused = String(e.message)
  }
  expect(refused.includes('68EC040'), `backend refuses to save it: ${refused}`)
})

test('machines: 68000 with accelerator RAM is an error on the RAM field', async ({ page, app }) => {
  await openEditor(page, app, 'Classic Amiga 500')
  await waitChecked(page)
  await page.selectOption('#sec-memory select >> nth=3', '8')
  await page.waitForSelector('[data-field="memory.accel_mb"] .fi.error')
  expect((await page.textContent('[data-field="memory.accel_mb"]')).includes('needs a 68020 or better'), 'accelerator RAM error text')
  expect(await page.isDisabled('[data-testid=save]'), 'Save disabled')
  // Switching to a 32-bit CPU resolves it (24-bit addressing follows the CPU model)
  await page.selectOption('#sec-cpu select >> nth=0', '68030')
  await page.waitForFunction(() => !document.querySelector('[data-field="memory.accel_mb"] .fi.error'))
  await waitChecked(page)
})

test('machines: valid A1200/040 saves, quick memory layouts and advanced settings work', async ({ page, app, api, dir }) => {
  const rom = await importRom(api, dir, 'ks31.rom', AGA_ROM())
  await openEditor(page, app, 'A1200 with 68040 accelerator')
  await page.selectOption('#sec-kickstart select >> nth=0', rom.id)
  await page.click('#sec-memory >> text=Standard + 128 MB Fast')
  await page.selectOption('#sec-cpu select >> nth=0', '68040')
  expect(!(await page.isVisible('[data-testid=cpu-advanced]')), 'advanced CPU settings are hidden by default')
  await page.check('[data-testid=advanced-toggle]')
  await page.waitForSelector('[data-testid=cpu-advanced]')
  await page.check('[data-testid=cpu-advanced] input[role=switch] >> nth=0') // data cache
  await waitChecked(page)
  await page.waitForFunction(() => !document.querySelector('[data-testid=save]').disabled)
  await page.click('[data-testid=save]')
  await page.waitForSelector('text=Saved “A1200 with 68040 accelerator”')
  const p = await profileByName(api, 'A1200 with 68040 accelerator')
  expect(p.memory.accel_mb === 128 && p.cpu.data_cache === true && p.rom_id === rom.id, 'memory layout, data cache and ROM saved')
  await page.reload()
  await page.waitForSelector('[data-testid=validation-summary]')
})

test('machines: Kickstart details, AGA machine with a 1.3 ROM is an error', async ({ page, app, api, dir, shot }) => {
  const aga = await importRom(api, dir, 'ks31.rom', AGA_ROM())
  const k13 = await importRom(api, dir, 'ks13.rom', KS13_ROM())
  await openEditor(page, app, 'Amiga 1200')
  await page.selectOption('#sec-kickstart select >> nth=0', aga.id)
  await page.waitForSelector('[data-testid=rom-detail]')
  const d = await page.textContent('[data-testid=rom-detail]')
  expect(d.includes('Works with AGA'), `AGA ROM marked AGA capable: ${d}`)
  await waitChecked(page)
  expect(!(await page.isVisible('[data-field=rom_id] .fi.error')), 'no Kickstart error with the matching ROM')
  await page.selectOption('#sec-kickstart select >> nth=0', k13.id)
  await page.waitForSelector('[data-field=rom_id] .fi.error')
  const e = await page.textContent('[data-field=rom_id]')
  expect(e.includes('cannot drive the AGA chipset'), `mismatch explained: ${e}`)
  expect(await page.isDisabled('[data-testid=save]'), 'cannot save AGA machine with Kickstart 1.3')
  expect((await page.textContent('[data-testid=rom-detail]')).includes('Not for AGA machines'), 'detail says not for AGA')
  await shot('machines-editor-kickstart-mismatch')
})

test('machines: honest empty state when no Kickstart ROM is imported', async ({ page, app }) => {
  await openEditor(page, app, 'Classic Amiga 500')
  await page.waitForSelector('#sec-kickstart >> text=No Kickstart ROMs imported yet')
  const t = await page.textContent('#sec-kickstart')
  expect(t.includes('No Kickstart ROMs imported yet'), 'empty state')
  expect(await page.isVisible('#sec-kickstart a[href="#/amiga/roms"]'), 'links to the ROM Library')
  await waitChecked(page)
  const s = await page.textContent('[data-testid=validation-summary]')
  expect(s.includes('No Kickstart ROM is selected'), 'summary warns about it (as a warning, not an error)')
})

test('machines: clone, delete and the new-machine name are real backend operations', async ({ page, app, api, shot }) => {
  await app('amiga/machines')
  await page.waitForSelector('[data-testid^=machine-]')
  const src = await profileByName(api, 'Amiga 3000')
  await page.click(`[data-testid=clone-${src.id}]`)
  await page.fill('[role=dialog] input', 'Studio A3000')
  await page.click('[data-testid=clone-confirm]')
  await page.waitForSelector('h2:text-is("Studio A3000")')
  const copy = await profileByName(api, 'Studio A3000')
  expect(copy && copy.id !== src.id && copy.cpu.model === src.cpu.model, 'clone exists with its own id')
  await page.click(`[data-testid=delete-${copy.id}]`)
  await page.waitForSelector('[role=dialog]:has-text("Delete")')
  await shot('machines-delete-confirm')
  await page.click('[role=dialog] >> text=Delete machine')
  await page.waitForFunction((n) => !document.body.textContent.includes(n), 'Studio A3000')
  expect(!(await profileByName(api, 'Studio A3000')), 'deleted in the backend')
  expect(await profileByName(api, 'Amiga 3000'), 'original untouched')
})

test('machines: Start with no Kickstart gives a readable error and a link to the ROM Library', async ({ page, app, api }) => {
  await app('amiga/machines')
  const src = await profileByName(api, 'Classic Amiga 500')
  await page.waitForSelector(`[data-testid=start-${src.id}]`)
  await page.waitForFunction((id) => !document.querySelector(`[data-testid=start-${id}]`).disabled, src.id)
  await page.click(`[data-testid=start-${src.id}]`)
  await page.waitForSelector('[data-testid=start-error]')
  const t = await page.textContent('[role=alert]')
  expect(/Kickstart|engine|Amiberry/i.test(t), `readable start error: ${t}`)
  expect(!(await api('session_status')).running, 'nothing was started')
})

test('machines: keyboard users can reach every section and Save', async ({ page, app, shot }) => {
  await openEditor(page, app, 'Amiga 1200')
  await waitChecked(page)
  await page.fill('#sec-general textarea', 'keyboard test') // make the form dirty so Save is enabled
  await waitChecked(page)
  await page.waitForFunction(() => !document.querySelector('[data-testid=save]').disabled)
  await page.focus('#sec-general input >> nth=0')
  let reached = false
  const visited = new Set()
  const trail = []
  for (let i = 0; i < 160 && !reached; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      return { id: el?.getAttribute('data-testid'), sec: el?.closest('[data-section]')?.getAttribute('data-section'), tag: el?.tagName }
    })
    if (info.sec) visited.add(info.sec)
    trail.push(`${info.tag}:${info.sec ?? info.id ?? ''}`)
    if (info.id === 'save') reached = true
  }
  expect(reached, `Tab order reaches the Save button (after ${trail.length} tabs: ${trail.join(' ')})`)
  for (const s of ['general', 'cpu', 'chipset', 'memory', 'kickstart', 'floppies', 'audio', 'display', 'input', 'performance'])
    expect(visited.has(s), `tab order passes through ${s}`)
  // Visible focus indicator on the focused control
  const shadow = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow)
  expect(shadow && shadow !== 'none', `focus ring visible on Save: ${shadow}`)
  await shot('machines-editor-focus-save')
})

test('machines: floppy drives are enabled in order and performance modes are explained', async ({ page, app, api, shot }) => {
  await openEditor(page, app, 'Amiga 500+')
  await waitChecked(page)
  await page.check('[data-testid=drive-3]')
  const p0 = await page.evaluate(() => [0, 1, 2, 3].map((i) => document.querySelector(`[data-testid=drive-${i}]`).checked))
  expect(p0.every(Boolean), `enabling DF3 also enables DF0-DF2 so they stay in order: ${p0}`)
  await page.uncheck('[data-testid=drive-1]')
  const p1 = await page.evaluate(() => [0, 1, 2, 3].map((i) => document.querySelector(`[data-testid=drive-${i}]`).checked))
  expect(p1.join() === 'true,false,false,false', `disabling DF1 also disables DF2/DF3: ${p1}`)
  const perf = await page.textContent('#sec-performance')
  expect(perf.includes('cycle-exact') && perf.includes('not cycle-exact') && perf.includes('may misbehave'), 'both modes explained honestly')
  await page.check('#sec-performance input[type=radio] >> nth=1')
  await page.waitForFunction(() => document.querySelector('[data-field=performance]')?.textContent?.includes('not cycle-exact'))
  await page.waitForSelector('[data-field=performance] .fi.warning') // 68000 cannot use the JIT
  await shot('machines-editor-performance')
  void api
})

test('machines: light theme editor renders legibly', async ({ page, app, shot }) => {
  await openEditor(page, app, 'Amiga 1200')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await waitChecked(page)
  await page.selectOption('#sec-cpu select >> nth=0', '68EC040')
  await page.selectOption('#sec-cpu select >> nth=1', 'internal')
  await page.waitForSelector('[data-field="cpu.fpu"] .fi.error')
  await shot('machines-editor-light')
  await page.goto(page.url().split('#')[0] + '#/amiga/machines')
  await page.waitForSelector('[data-testid^=machine-]')
  await shot('machines-list-light')
})
