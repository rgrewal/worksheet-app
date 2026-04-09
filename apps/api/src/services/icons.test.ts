import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOrGenerateIcon, clearCacheForTesting } from './icons'

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

  it('returns placeholder with cached:false when referenceImageDataUrl is provided but no API key', async () => {
    vi.stubEnv('FAL_API_KEY', '')
    const icon = await fetchOrGenerateIcon('my-pet', 'data:image/jpeg;base64,/9j/fake')
    expect(icon.url).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(icon.cached).toBe(false)
  })
})

describe('fetchOrGenerateIcon - fal.ai error handling', () => {
  it('falls back to placeholder when fetch throws during image upload', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const icon = await fetchOrGenerateIcon('dragons', 'data:image/jpeg;base64,abc')
    expect(icon.url).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('falls back to placeholder when upload initiate returns non-ok status', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }))
    const icon = await fetchOrGenerateIcon('unicorns', 'data:image/jpeg;base64,abc')
    expect(icon.url).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})
