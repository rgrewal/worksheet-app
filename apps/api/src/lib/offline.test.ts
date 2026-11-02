import { describe, it, expect, vi, afterEach } from 'vitest'
import { isOfflineMode } from './offline.js'

afterEach(() => vi.unstubAllEnvs())

describe('isOfflineMode', () => {
  it.each(['1', 'true', 'TRUE', ' 1 '])('is on when OFFLINE=%j', (value) => {
    vi.stubEnv('OFFLINE', value)
    expect(isOfflineMode()).toBe(true)
  })

  it.each(['', '0', 'false', 'no', 'yes'])('is off when OFFLINE=%j', (value) => {
    vi.stubEnv('OFFLINE', value)
    expect(isOfflineMode()).toBe(false)
  })

  it('is off when OFFLINE is unset (default mode)', () => {
    vi.stubEnv('OFFLINE', undefined as unknown as string)
    delete process.env.OFFLINE
    expect(isOfflineMode()).toBe(false)
  })

  it('is evaluated on every call, not cached at import time', () => {
    vi.stubEnv('OFFLINE', '')
    expect(isOfflineMode()).toBe(false)
    vi.stubEnv('OFFLINE', '1')
    expect(isOfflineMode()).toBe(true)
  })
})
