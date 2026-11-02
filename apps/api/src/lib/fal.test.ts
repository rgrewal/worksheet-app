import { describe, it, expect, vi, afterEach } from 'vitest'
import { requireFalApiKey } from './fal.js'
import { AppError, FalApiKeyMissingError } from './errors.js'

afterEach(() => vi.unstubAllEnvs())

describe('requireFalApiKey', () => {
  it('returns the trimmed key when set', () => {
    vi.stubEnv('FAL_API_KEY', '  abc123  ')
    expect(requireFalApiKey()).toBe('abc123')
  })

  it.each(['', '   '])('throws FalApiKeyMissingError when FAL_API_KEY=%j', (value) => {
    vi.stubEnv('FAL_API_KEY', value)
    expect(() => requireFalApiKey()).toThrow(FalApiKeyMissingError)
  })

  it('the error maps to HTTP 500 with the message "FAL_API_KEY is not set"', () => {
    vi.stubEnv('FAL_API_KEY', '')
    try {
      requireFalApiKey()
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).status).toBe(500)
      expect((err as AppError).message).toBe('FAL_API_KEY is not set')
      expect((err as AppError).details).toMatch(/dev:offline/)
    }
  })
})
