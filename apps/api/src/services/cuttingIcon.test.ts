import { describe, it, expect, vi, afterEach } from 'vitest'
import sharp from 'sharp'
import { generateCuttingIcon } from './cuttingIcon.js'
import { getPlaceholderPng } from './placeholders.js'
import { FalApiKeyMissingError } from '../lib/errors.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('generateCuttingIcon - missing FAL_API_KEY (default mode)', () => {
  it('throws FalApiKeyMissingError before making any network call', async () => {
    vi.stubEnv('OFFLINE', '')
    vi.stubEnv('FAL_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateCuttingIcon('dinosaur')).rejects.toBeInstanceOf(FalApiKeyMissingError)
    await expect(generateCuttingIcon('dinosaur')).rejects.toThrow('FAL_API_KEY is not set')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('generateCuttingIcon - with FAL_API_KEY (default mode)', () => {
  it('sends the key to Ideogram and returns the downloaded image bytes', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    const png = await getPlaceholderPng('cutting', 'system-generated')
    const ab  = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ images: [{ url: 'https://fal.media/out.png' }] }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => ab })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateCuttingIcon('dinosaur')

    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/ideogram/v3/generate-transparent')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Key fake-key')
    expect(fetchMock.mock.calls[1][0]).toBe('https://fal.media/out.png')
    expect(result.equals(png)).toBe(true)
  })

  it('propagates an Ideogram failure', async () => {
    vi.stubEnv('FAL_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 402, text: async () => 'payment required' }))
    await expect(generateCuttingIcon('dinosaur')).rejects.toThrow(/402/)
  })
})

describe('generateCuttingIcon - offline mode', () => {
  it('returns the "cutting system generated" placeholder without calling fal.ai', async () => {
    vi.stubEnv('OFFLINE', '1')
    vi.stubEnv('FAL_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateCuttingIcon('dinosaur')

    expect(result.equals(await getPlaceholderPng('cutting', 'system-generated'))).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores FAL_API_KEY when set — same placeholder, still no network', async () => {
    vi.stubEnv('OFFLINE', '1')
    vi.stubEnv('FAL_API_KEY', 'real-looking-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateCuttingIcon('dinosaur')

    expect(result.equals(await getPlaceholderPng('cutting', 'system-generated'))).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('placeholder has a transparent background suitable for outline tracing', async () => {
    vi.stubEnv('OFFLINE', '1')
    const result = await generateCuttingIcon('dinosaur')
    const meta = await sharp(result).metadata()
    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
  })
})
