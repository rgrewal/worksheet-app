import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOrGenerateIcon, clearCacheForTesting } from './icons.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  clearCacheForTesting()
})

describe('fetchOrGenerateIcon - caching', () => {
  it('returns cached:false on first call and cached:true on second call with same interest', async () => {
    vi.stubEnv('FAL_API_KEY', '')
    const first = await fetchOrGenerateIcon('robots')
    const second = await fetchOrGenerateIcon('robots')
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.url).toBe(first.url)
  })

  it('treats differently-cased and padded interest as the same cache key', async () => {
    vi.stubEnv('FAL_API_KEY', '')
    const a = await fetchOrGenerateIcon('  Robots  ')
    const b = await fetchOrGenerateIcon('robots')
    expect(b.cached).toBe(true)
    expect(b.url).toBe(a.url)
  })
})

describe('fetchOrGenerateIcon - placeholder fallback', () => {
  it('returns a data:image/svg+xml placeholder when FAL_API_KEY is not set', async () => {
    vi.stubEnv('FAL_API_KEY', '')
    const icon = await fetchOrGenerateIcon('unique-interest-xyz')
    expect(icon.url).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(icon.label).toBe('unique-interest-xyz')
  })
})

describe('fetchOrGenerateIcon - reference image passthrough', () => {
  it('returns the reference image data URL directly without any API call', async () => {
    vi.stubEnv('FAL_API_KEY', '')
    const refUrl = 'data:image/jpeg;base64,/9j/fakeimagedata'
    const icon = await fetchOrGenerateIcon('my-pet', refUrl)
    expect(icon.url).toBe(refUrl)
    expect(icon.cached).toBe(false)
    expect(icon.label).toBe('my-pet')
  })

  it('uses the reference image even when a FAL_API_KEY is set', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    const refUrl = 'data:image/png;base64,iVBORw0KGgoAAAANS'
    const icon = await fetchOrGenerateIcon('dragons', refUrl)
    expect(icon.url).toBe(refUrl)
  })
})

describe('fetchOrGenerateIcon - fal.ai error handling', () => {
  it('falls back to placeholder when fetch throws during text-to-image', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const icon = await fetchOrGenerateIcon('dragons')
    expect(icon.url).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('falls back to placeholder when text-to-image returns non-ok status', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }))
    const icon = await fetchOrGenerateIcon('unicorns')
    expect(icon.url).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})
