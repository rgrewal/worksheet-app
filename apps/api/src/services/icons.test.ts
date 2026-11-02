import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOrGenerateIcon, clearCacheForTesting } from './icons.js'
import { FalApiKeyMissingError } from '../lib/errors.js'
import { getPlaceholderDataUrl } from './placeholders.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  clearCacheForTesting()
})

/** Stub fetch so Ideogram "returns" a hosted image URL without touching the network. */
function stubIdeogramFetch(url = 'https://fal.media/fake/icon.png') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ images: [{ url }] }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchOrGenerateIcon - caching', () => {
  it('returns cached:false on first call and cached:true on second call with same interest', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    const fetchMock = stubIdeogramFetch()
    const first = await fetchOrGenerateIcon('maze', 'robots')
    const second = await fetchOrGenerateIcon('maze', 'robots')
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.url).toBe(first.url)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats differently-cased and padded interest as the same cache key', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    stubIdeogramFetch()
    const a = await fetchOrGenerateIcon('maze', '  Robots  ')
    const b = await fetchOrGenerateIcon('maze', 'robots')
    expect(b.cached).toBe(true)
    expect(b.url).toBe(a.url)
  })
})

describe('fetchOrGenerateIcon - missing FAL_API_KEY (default mode)', () => {
  it('throws FalApiKeyMissingError instead of silently substituting a placeholder', async () => {
    vi.stubEnv('OFFLINE', '')
    vi.stubEnv('FAL_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchOrGenerateIcon('maze', 'unique-interest-xyz')).rejects.toBeInstanceOf(FalApiKeyMissingError)
    await expect(fetchOrGenerateIcon('word-search', 'unique-interest-xyz')).rejects.toThrow('FAL_API_KEY is not set')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only key as missing', async () => {
    vi.stubEnv('FAL_API_KEY', '   ')
    await expect(fetchOrGenerateIcon('maze', 'dragons')).rejects.toThrow('FAL_API_KEY is not set')
  })

  it('does not cache the failure, so a later call with a key succeeds', async () => {
    vi.stubEnv('FAL_API_KEY', '')
    await expect(fetchOrGenerateIcon('maze', 'dragons')).rejects.toThrow()

    vi.stubEnv('FAL_API_KEY', 'fake-key')
    stubIdeogramFetch('https://fal.media/dragons.png')
    const icon = await fetchOrGenerateIcon('maze', 'dragons')
    expect(icon.url).toBe('https://fal.media/dragons.png')
    expect(icon.cached).toBe(false)
  })
})

describe('fetchOrGenerateIcon - reference image passthrough (default mode)', () => {
  it('returns the reference image data URL directly without any API call', async () => {
    vi.stubEnv('FAL_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const refUrl = 'data:image/jpeg;base64,/9j/fakeimagedata'
    const icon = await fetchOrGenerateIcon('maze', 'my-pet', refUrl)
    expect(icon.url).toBe(refUrl)
    expect(icon.cached).toBe(false)
    expect(icon.label).toBe('my-pet')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the reference image even when a FAL_API_KEY is set', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    const refUrl = 'data:image/png;base64,iVBORw0KGgoAAAANS'
    const icon = await fetchOrGenerateIcon('word-search', 'dragons', refUrl)
    expect(icon.url).toBe(refUrl)
  })
})

describe('fetchOrGenerateIcon - fal.ai error handling (default mode)', () => {
  it('propagates a network error instead of falling back to a placeholder', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    await expect(fetchOrGenerateIcon('maze', 'dragons')).rejects.toThrow('network error')
  })

  it('propagates a non-ok Ideogram response with its status', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }))
    await expect(fetchOrGenerateIcon('maze', 'unicorns')).rejects.toThrow(/Ideogram 500/)
  })
})

describe('fetchOrGenerateIcon - offline mode', () => {
  it('returns the "maze system generated" placeholder when no reference image is given', async () => {
    vi.stubEnv('OFFLINE', '1')
    vi.stubEnv('FAL_API_KEY', '')
    const icon = await fetchOrGenerateIcon('maze', 'robots')
    expect(icon.url).toBe(await getPlaceholderDataUrl('maze', 'system-generated'))
    expect(icon.label).toBe('robots')
    expect(icon.cached).toBe(false)
  })

  it('returns the "maze user uploaded" placeholder instead of the uploaded photo', async () => {
    vi.stubEnv('OFFLINE', '1')
    const refUrl = 'data:image/jpeg;base64,/9j/fakeimagedata'
    const icon = await fetchOrGenerateIcon('maze', 'my-pet', refUrl)
    expect(icon.url).toBe(await getPlaceholderDataUrl('maze', 'user-uploaded'))
    expect(icon.url).not.toBe(refUrl)
  })

  it('returns the "word search system generated" placeholder', async () => {
    vi.stubEnv('OFFLINE', '1')
    const icon = await fetchOrGenerateIcon('word-search', 'space')
    expect(icon.url).toBe(await getPlaceholderDataUrl('word-search', 'system-generated'))
  })

  it('returns the "word search user uploaded" placeholder', async () => {
    vi.stubEnv('OFFLINE', '1')
    const icon = await fetchOrGenerateIcon('word-search', 'space', 'data:image/png;base64,iVBORw0KGgo=')
    expect(icon.url).toBe(await getPlaceholderDataUrl('word-search', 'user-uploaded'))
  })

  it('never calls fal.ai even when a FAL_API_KEY is set', async () => {
    vi.stubEnv('OFFLINE', '1')
    vi.stubEnv('FAL_API_KEY', 'real-looking-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const withKey = await fetchOrGenerateIcon('maze', 'robots')
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv('FAL_API_KEY', '')
    const withoutKey = await fetchOrGenerateIcon('maze', 'robots')
    expect(withoutKey.url).toBe(withKey.url)
  })

  it('is a PNG data URL (raster), so the PDF takes the same embedding path as a real image', async () => {
    vi.stubEnv('OFFLINE', '1')
    const icon = await fetchOrGenerateIcon('maze', 'robots')
    expect(icon.url).toMatch(/^data:image\/png;base64,/)
  })
})
