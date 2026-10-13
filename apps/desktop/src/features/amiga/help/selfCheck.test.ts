import { describe, expect, it } from 'vitest'
import { buildReport, olderThan, summarise, type CheckResult } from './selfCheck'

describe('self-check helpers', () => {
  it('compares engine versions', () => {
    expect(olderThan([8, 3, 9], [8, 4, 0])).toBe(true)
    expect(olderThan([8, 4, 0], [8, 4, 0])).toBe(false)
    expect(olderThan([9, 0, 0], [8, 4, 0])).toBe(false)
    expect(olderThan(null, [8, 4, 0])).toBe(false)
  })
  it('counts results', () => {
    const rows: CheckResult[] = [
      { id: 'a', title: 'A', status: 'pass', detail: '' },
      { id: 'b', title: 'B', status: 'warn', detail: '' },
      { id: 'c', title: 'C', status: 'fail', detail: '' },
      { id: 'd', title: 'D', status: 'pass', detail: '' },
    ]
    expect(summarise(rows)).toEqual({ pass: 2, warn: 1, fail: 1 })
  })
  it('builds a plain-text report that says when nothing has run', () => {
    const t = buildReport(null, null, null, [])
    expect(t).toContain('Amiga Studio diagnostics')
    expect(t).toContain('Emulator engine: not found')
    expect(t).toContain('(not run)')
    expect(t).toContain('(none)')
  })
  it('lists each check with its status word', () => {
    const t = buildReport({ version: '1.2.3', platform: 'linux', arch: 'x86_64', storage_root: '/lib', engine: null, runtime_control: true, embedded_core: null, run_mode: 'process' }, null, [{ id: 'x', title: 'Thing', status: 'warn', detail: 'careful' }], [
      { id: 's', profile_id: 'p', profile_name: 'A500', started_at: 100, ended_at: 160, outcome: 'unclean' },
    ])
    expect(t).toContain('[WARN] Thing: careful')
    expect(t).toContain('App version: 1.2.3')
    expect(t).toContain('A500')
    expect(t).toContain('unclean')
  })
})
