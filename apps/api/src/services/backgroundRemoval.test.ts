import { vi, describe, it, expect, beforeAll, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import sharp from 'sharp'

// ─── Mock @fal-ai/client before any imports that use it ──────────────────────
// vi.hoisted ensures these values exist when the vi.mock factory runs (which is
// hoisted before the import statements by vitest's module transform).

const { mockFalConfig, mockFalUpload, mockFalSubscribe } = vi.hoisted(() => ({
  mockFalConfig:    vi.fn(),
  mockFalUpload:    vi.fn<() => Promise<string>>(),
  mockFalSubscribe: vi.fn(),
}))

vi.mock('@fal-ai/client', () => ({
  fal: {
    config:   mockFalConfig,
    storage:  { upload: mockFalUpload },
    subscribe: mockFalSubscribe,
  },
}))

// Import the service under test after the mock is registered
import { prepareReferenceImageFromDataUrl } from './backgroundRemoval.js'
import { getPlaceholderPng } from './placeholders.js'
import { FalApiKeyMissingError, InvalidImageError } from '../lib/errors.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** 100×100 PNG: 60×60 opaque centre, transparent background → has meaningful transparency */
let transparentSubjectPng: Buffer
/** 100×100 fully opaque RGB PNG (no alpha channel) → needs background removal */
let opaquePng: Buffer

/** data URL wrappers */
let transparentDataUrl: string
let opaqueDataUrl: string

/** A transparent PNG that fal.ai "returns" after removing the background */
let falResultPng: Buffer

beforeAll(async () => {
  const opaquePatch = await sharp({
    create: { width: 60, height: 60, channels: 4, background: { r: 255, g: 100, b: 0, alpha: 255 } },
  })
    .png()
    .toBuffer()

  transparentSubjectPng = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: opaquePatch, left: 20, top: 20 }])
    .png()
    .toBuffer()

  opaquePng = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 150, b: 100 } },
  })
    .png()
    .toBuffer()

  // fal "returns" the same transparent image we built above
  falResultPng = transparentSubjectPng

  transparentDataUrl = `data:image/png;base64,${transparentSubjectPng.toString('base64')}`
  opaqueDataUrl      = `data:image/png;base64,${opaquePng.toString('base64')}`
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Stub fetch to return falResultPng when the fal output URL is requested */
function stubFalFetch() {
  const ab = falResultPng.buffer.slice(
    falResultPng.byteOffset,
    falResultPng.byteOffset + falResultPng.byteLength,
  ) as ArrayBuffer

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => ab,
  }))
}

// ─── Input validation ─────────────────────────────────────────────────────────

describe('prepareReferenceImageFromDataUrl - malformed input', () => {
  it('throws if the data URL has no comma separator', async () => {
    await expect(prepareReferenceImageFromDataUrl('notadataurl')).rejects.toThrow()
  })

  it('throws if the data URL is an empty string', async () => {
    await expect(prepareReferenceImageFromDataUrl('')).rejects.toThrow()
  })
})

// ─── Already-transparent image (skip fal.ai) ─────────────────────────────────

describe('prepareReferenceImageFromDataUrl - image already has transparency', () => {
  it('does NOT call fal.ai', async () => {
    await prepareReferenceImageFromDataUrl(transparentDataUrl)
    expect(mockFalSubscribe).not.toHaveBeenCalled()
    expect(mockFalUpload).not.toHaveBeenCalled()
  })

  it('returns a valid PNG buffer', async () => {
    const result = await prepareReferenceImageFromDataUrl(transparentDataUrl)
    const meta = await sharp(result).metadata()
    expect(meta.format).toBe('png')
  })

  it('output has an alpha channel', async () => {
    const result = await prepareReferenceImageFromDataUrl(transparentDataUrl)
    const meta = await sharp(result).metadata()
    expect(meta.hasAlpha).toBe(true)
  })

  it('normalises: output dimensions reflect the cropped + padded subject', async () => {
    const result = await prepareReferenceImageFromDataUrl(transparentDataUrl)
    const meta = await sharp(result).metadata()
    // Subject is 60×60; minPaddingPx = 24 on each side → 60+48 = 108
    expect(meta.width).toBe(108)
    expect(meta.height).toBe(108)
  })
})

// ─── Opaque image (background removal needed) ────────────────────────────────

describe('prepareReferenceImageFromDataUrl - background removal needed', () => {
  it('throws FalApiKeyMissingError ("FAL_API_KEY is not set") if FAL_API_KEY is not set', async () => {
    vi.stubEnv('OFFLINE', '')
    vi.stubEnv('FAL_API_KEY', '')
    await expect(prepareReferenceImageFromDataUrl(opaqueDataUrl)).rejects.toBeInstanceOf(FalApiKeyMissingError)
    await expect(prepareReferenceImageFromDataUrl(opaqueDataUrl)).rejects.toThrow('FAL_API_KEY is not set')
    expect(mockFalUpload).not.toHaveBeenCalled()
    expect(mockFalSubscribe).not.toHaveBeenCalled()
  })

  it('calls fal.ai birefnet/v2 with the uploaded image URL', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-key')
    stubFalFetch()
    mockFalUpload.mockResolvedValueOnce('https://storage.fal.ai/fake-input.png')
    mockFalSubscribe.mockResolvedValueOnce({ data: { image: { url: 'https://fal.ai/output/fake.png' } } })

    await prepareReferenceImageFromDataUrl(opaqueDataUrl)

    expect(mockFalSubscribe).toHaveBeenCalledWith(
      'fal-ai/birefnet/v2',
      expect.objectContaining({
        input: expect.objectContaining({
          image_url: 'https://storage.fal.ai/fake-input.png',
        }),
      }),
    )
  })

  it('configures fal with the FAL_API_KEY from the environment', async () => {
    vi.stubEnv('FAL_API_KEY', 'my-secret-key')
    stubFalFetch()
    mockFalUpload.mockResolvedValueOnce('https://storage.fal.ai/x.png')
    mockFalSubscribe.mockResolvedValueOnce({ data: { image: { url: 'https://fal.ai/out.png' } } })

    await prepareReferenceImageFromDataUrl(opaqueDataUrl)

    expect(mockFalConfig).toHaveBeenCalledWith({ credentials: 'my-secret-key' })
  })

  it('returns a valid PNG after background removal and normalisation', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-key')
    stubFalFetch()
    mockFalUpload.mockResolvedValueOnce('https://storage.fal.ai/x.png')
    mockFalSubscribe.mockResolvedValueOnce({ data: { image: { url: 'https://fal.ai/out.png' } } })

    const result = await prepareReferenceImageFromDataUrl(opaqueDataUrl)
    const meta = await sharp(result).metadata()
    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
  })

  it('throws if fal.ai does not return an image URL', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-key')
    mockFalUpload.mockResolvedValueOnce('https://storage.fal.ai/x.png')
    mockFalSubscribe.mockResolvedValueOnce({ data: {} })  // no image URL

    await expect(prepareReferenceImageFromDataUrl(opaqueDataUrl)).rejects.toThrow(
      /did not return an image URL/,
    )
  })

  it('throws if the result image download fails', async () => {
    vi.stubEnv('FAL_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    mockFalUpload.mockResolvedValueOnce('https://storage.fal.ai/x.png')
    mockFalSubscribe.mockResolvedValueOnce({ data: { image: { url: 'https://fal.ai/out.png' } } })

    await expect(prepareReferenceImageFromDataUrl(opaqueDataUrl)).rejects.toThrow(/503/)
  })
})

// ─── MIME type parsing ────────────────────────────────────────────────────────

describe('prepareReferenceImageFromDataUrl - MIME type handling', () => {
  it('accepts a JPEG data URL and processes it correctly', async () => {
    // Re-encode the opaque PNG as a JPEG-flavoured data URL (same bytes, different header)
    // We're testing header parsing, not format conversion, so the actual bytes can be PNG
    const jpegDataUrl = `data:image/jpeg;base64,${opaquePng.toString('base64')}`

    vi.stubEnv('FAL_API_KEY', 'test-key')
    stubFalFetch()
    mockFalUpload.mockResolvedValueOnce('https://storage.fal.ai/x.png')
    mockFalSubscribe.mockResolvedValueOnce({ data: { image: { url: 'https://fal.ai/out.png' } } })

    // Should not throw; the Blob mime type should be image/jpeg
    await prepareReferenceImageFromDataUrl(jpegDataUrl)
    const uploadCall = (mockFalUpload as unknown as Mock).mock.calls[0]
    expect((uploadCall[0] as Blob).type).toBe('image/jpeg')
  })
})

// ─── Offline mode ─────────────────────────────────────────────────────────────

describe('prepareReferenceImageFromDataUrl - offline mode', () => {
  it('returns the "cutting user uploaded" placeholder for a transparent upload', async () => {
    vi.stubEnv('OFFLINE', '1')
    vi.stubEnv('FAL_API_KEY', '')

    const result = await prepareReferenceImageFromDataUrl(transparentDataUrl)

    expect(result.equals(new Uint8Array(await getPlaceholderPng('cutting', 'user-uploaded')))).toBe(true)
    expect(mockFalUpload).not.toHaveBeenCalled()
    expect(mockFalSubscribe).not.toHaveBeenCalled()
  })

  it('rejects an upload without a transparent background with a 400 InvalidImageError', async () => {
    vi.stubEnv('OFFLINE', '1')
    vi.stubEnv('FAL_API_KEY', '')

    const promise = prepareReferenceImageFromDataUrl(opaqueDataUrl)
    await expect(promise).rejects.toBeInstanceOf(InvalidImageError)
    await expect(promise).rejects.toMatchObject({ status: 400 })
    await expect(promise).rejects.toThrow(/transparent background/)
    expect(mockFalUpload).not.toHaveBeenCalled()
    expect(mockFalSubscribe).not.toHaveBeenCalled()
  })

  it('behaves identically when a FAL_API_KEY is set: still no fal.ai call, same placeholder / same 400', async () => {
    vi.stubEnv('OFFLINE', '1')
    vi.stubEnv('FAL_API_KEY', 'real-looking-key')

    const result = await prepareReferenceImageFromDataUrl(transparentDataUrl)
    expect(result.equals(new Uint8Array(await getPlaceholderPng('cutting', 'user-uploaded')))).toBe(true)

    await expect(prepareReferenceImageFromDataUrl(opaqueDataUrl)).rejects.toMatchObject({ status: 400 })

    expect(mockFalConfig).not.toHaveBeenCalled()
    expect(mockFalUpload).not.toHaveBeenCalled()
    expect(mockFalSubscribe).not.toHaveBeenCalled()
  })

  it('rejects a JPEG upload (never has alpha) with a 400', async () => {
    vi.stubEnv('OFFLINE', '1')
    const jpeg = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg()
      .toBuffer()
    const jpegDataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`

    await expect(prepareReferenceImageFromDataUrl(jpegDataUrl)).rejects.toMatchObject({ status: 400 })
  })
})
