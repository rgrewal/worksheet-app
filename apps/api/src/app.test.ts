/**
 * Route-level tests for POST /generate.
 *
 * They exercise the real services and PDF builders; only the two external
 * boundaries are stubbed: `fetch` (Ideogram) and `@fal-ai/client` (birefnet).
 * Both are wired to fail loudly, so any test that reaches fal.ai is a bug.
 *
 * The PDF builders are wrapped in pass-through spies so we can assert which
 * image actually went into the PDF while still producing a real document.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import sharp from 'sharp'
import type { WorksheetSpec } from '@worksheet/shared'

const fal = vi.hoisted(() => ({
  config:    vi.fn(),
  upload:    vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('@fal-ai/client', () => ({
  fal: { config: fal.config, storage: { upload: fal.upload }, subscribe: fal.subscribe },
}))

const pdf = vi.hoisted(() => ({
  buildPdf:           vi.fn(),
  buildCuttingPdf:    vi.fn(),
  buildWordSearchPdf: vi.fn(),
}))

vi.mock('./services/pdf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/pdf.js')>()
  pdf.buildPdf.mockImplementation(actual.buildPdf)
  pdf.buildCuttingPdf.mockImplementation(actual.buildCuttingPdf)
  pdf.buildWordSearchPdf.mockImplementation(actual.buildWordSearchPdf)
  return { ...actual, buildPdf: pdf.buildPdf, buildCuttingPdf: pdf.buildCuttingPdf, buildWordSearchPdf: pdf.buildWordSearchPdf }
})

import app from './app.js'
import { clearCacheForTesting } from './services/icons.js'
import { recordEndpointTiming } from './test/endpointTiming.js'
import { parseServerTiming } from './lib/timing.js'
import { getPlaceholderPng, getPlaceholderDataUrl } from './services/placeholders.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let transparentDataUrl: string   // PNG with a transparent background → no bg removal needed
let opaquePngDataUrl: string     // PNG with no alpha → bg removal needed
let opaqueJpegDataUrl: string    // JPEG (never has alpha) → bg removal needed

beforeAll(async () => {
  const subject = await sharp({ create: { width: 60, height: 60, channels: 4, background: { r: 255, g: 100, b: 0, alpha: 255 } } })
    .png().toBuffer()
  const transparent = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: subject, left: 20, top: 20 }])
    .png().toBuffer()
  const opaquePng = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 150, b: 100 } } })
    .png().toBuffer()
  const opaqueJpeg = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 150, b: 100 } } })
    .jpeg().toBuffer()

  transparentDataUrl = `data:image/png;base64,${transparent.toString('base64')}`
  opaquePngDataUrl   = `data:image/png;base64,${opaquePng.toString('base64')}`
  opaqueJpegDataUrl  = `data:image/jpeg;base64,${opaqueJpeg.toString('base64')}`
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fal.config.mockClear()
  fal.upload.mockClear()
  fal.subscribe.mockClear()
  pdf.buildPdf.mockClear()
  pdf.buildCuttingPdf.mockClear()
  pdf.buildWordSearchPdf.mockClear()
  clearCacheForTesting()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Make any attempt to reach the network fail the test loudly. */
function forbidNetwork() {
  const fetchMock = vi.fn().mockRejectedValue(new Error('network access attempted in test'))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function defaultMode(apiKey = '') {
  vi.stubEnv('OFFLINE', '')
  vi.stubEnv('FAL_API_KEY', apiKey)
}

function offlineMode(apiKey = '') {
  vi.stubEnv('OFFLINE', '1')
  vi.stubEnv('FAL_API_KEY', apiKey)
}

/**
 * POST /generate and record its Server-Timing on the current test, so the
 * timing reporter can summarise every scenario exercised by this file.
 */
async function generate(spec: Partial<WorksheetSpec> & { activity: WorksheetSpec['activity'] }) {
  const res = await app.request('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interest: 'dinosaurs', difficulty: 'easy', ...spec }),
  })
  const mode   = process.env.OFFLINE === '1' ? 'offline' : 'default'
  const source = spec.referenceImageDataUrl ? 'upload' : 'generated'
  recordEndpointTiming(res, `POST /generate ${spec.activity} ${source} [${mode}]`)
  return res
}

type ErrorBody = { error: string; details?: string }

async function expectPdf(res: Response): Promise<Buffer> {
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/pdf')
  const bytes = Buffer.from(await res.arrayBuffer())
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(bytes.length).toBeGreaterThan(1000)
  return bytes
}

function expectNoFalCalls(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).not.toHaveBeenCalled()
  expect(fal.config).not.toHaveBeenCalled()
  expect(fal.upload).not.toHaveBeenCalled()
  expect(fal.subscribe).not.toHaveBeenCalled()
}

// ─── /health ──────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('reports offline: false in default mode', async () => {
    defaultMode()
    const body = await (await app.request('/health')).json()
    expect(body).toMatchObject({ status: 'ok', offline: false })
  })

  it('reports offline: true in offline mode', async () => {
    offlineMode()
    const body = await (await app.request('/health')).json()
    expect(body).toMatchObject({ status: 'ok', offline: true })
  })
})

// ─── Default mode, no FAL_API_KEY → 500 ───────────────────────────────────────

describe('POST /generate — default mode without FAL_API_KEY', () => {
  const cases: Array<[string, Partial<WorksheetSpec> & { activity: WorksheetSpec['activity'] }]> = [
    ['maze, system-generated icon',              { activity: 'maze' }],
    ['word-search, system-generated icon',       { activity: 'word-search', wordSearchWords: ['rex', 'claw'] }],
    ['cutting, system-generated image',          { activity: 'cutting' }],
    ['cutting, uploaded PNG needing bg removal', { activity: 'cutting', referenceImageDataUrl: '' /* set below */ }],
    ['cutting, uploaded JPEG needing bg removal', { activity: 'cutting', referenceImageDataUrl: '' /* set below */ }],
  ]

  it.each(cases)('%s → 500 "FAL_API_KEY is not set"', async (name, spec) => {
    defaultMode('')
    const fetchMock = forbidNetwork()

    if (name.includes('PNG'))  spec = { ...spec, referenceImageDataUrl: opaquePngDataUrl }
    if (name.includes('JPEG')) spec = { ...spec, referenceImageDataUrl: opaqueJpegDataUrl }

    const res = await generate(spec)

    expect(res.status).toBe(500)
    const body = await res.json() as ErrorBody
    expect(body.error).toBe('FAL_API_KEY is not set')
    expect(body.details).toMatch(/dev:offline/)
    expectNoFalCalls(fetchMock)
    expect(pdf.buildPdf).not.toHaveBeenCalled()
    expect(pdf.buildCuttingPdf).not.toHaveBeenCalled()
    expect(pdf.buildWordSearchPdf).not.toHaveBeenCalled()
  })

  it('does not silently substitute a placeholder: no PDF is produced', async () => {
    defaultMode('')
    forbidNetwork()
    const res = await generate({ activity: 'maze' })
    expect(res.headers.get('content-type')).not.toBe('application/pdf')
  })

  // Workflows that never touch fal.ai keep working without a key — that is
  // what makes the 500 above "an attempted fal.ai call" rather than a blanket failure.
  it('maze with an uploaded photo still succeeds (no fal.ai call needed)', async () => {
    defaultMode('')
    const fetchMock = forbidNetwork()
    const res = await generate({ activity: 'maze', referenceImageDataUrl: opaquePngDataUrl })
    await expectPdf(res)
    expect(pdf.buildPdf.mock.calls[0][0].icon.url).toBe(opaquePngDataUrl)
    expectNoFalCalls(fetchMock)
  })

  it('cutting with an already-transparent upload still succeeds (no fal.ai call needed)', async () => {
    defaultMode('')
    const fetchMock = forbidNetwork()
    const res = await generate({ activity: 'cutting', referenceImageDataUrl: transparentDataUrl })
    await expectPdf(res)
    expectNoFalCalls(fetchMock)
  })
})

describe('POST /generate — default mode with FAL_API_KEY but fal.ai failing', () => {
  it('propagates the failure as a 500 instead of shipping a placeholder', async () => {
    defaultMode('fake-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' }))

    const res = await generate({ activity: 'maze' })

    expect(res.status).toBe(500)
    const body = await res.json() as ErrorBody
    expect(body.details).toMatch(/Ideogram 401/)
    expect(pdf.buildPdf).not.toHaveBeenCalled()
  })
})

// ─── Offline mode → placeholders ──────────────────────────────────────────────

describe('POST /generate — offline mode inserts the workflow-specific placeholder', () => {
  it('maze, no upload → "maze system generated" placeholder in a real PDF', async () => {
    offlineMode()
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'maze' })
    await expectPdf(res)

    expect(pdf.buildPdf).toHaveBeenCalledTimes(1)
    expect(pdf.buildPdf.mock.calls[0][0].icon.url).toBe(await getPlaceholderDataUrl('maze', 'system-generated'))
    expectNoFalCalls(fetchMock)
  })

  it('maze, with upload → "maze user uploaded" placeholder replaces the photo', async () => {
    offlineMode()
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'maze', referenceImageDataUrl: opaquePngDataUrl })
    await expectPdf(res)

    const icon = pdf.buildPdf.mock.calls[0][0].icon
    expect(icon.url).toBe(await getPlaceholderDataUrl('maze', 'user-uploaded'))
    expect(icon.url).not.toBe(opaquePngDataUrl)
    expectNoFalCalls(fetchMock)
  })

  it('word-search, no upload → "word search system generated" placeholder', async () => {
    offlineMode()
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'word-search', wordSearchWords: ['rex', 'claw', 'roar'] })
    await expectPdf(res)

    expect(pdf.buildWordSearchPdf).toHaveBeenCalledTimes(1)
    expect(pdf.buildWordSearchPdf.mock.calls[0][0].icon.url).toBe(await getPlaceholderDataUrl('word-search', 'system-generated'))
    expectNoFalCalls(fetchMock)
  })

  it('word-search, with upload → "word search user uploaded" placeholder', async () => {
    offlineMode()
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'word-search', wordSearchWords: ['rex'], referenceImageDataUrl: opaqueJpegDataUrl })
    await expectPdf(res)

    expect(pdf.buildWordSearchPdf.mock.calls[0][0].icon.url).toBe(await getPlaceholderDataUrl('word-search', 'user-uploaded'))
    expectNoFalCalls(fetchMock)
  })

  it('cutting, no upload → "cutting system generated" placeholder with a traced outline', async () => {
    offlineMode()
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'cutting' })
    await expectPdf(res)

    expect(pdf.buildCuttingPdf).toHaveBeenCalledTimes(1)
    const args = pdf.buildCuttingPdf.mock.calls[0][0]
    expect(args.pngBuffer.equals(await getPlaceholderPng('cutting', 'system-generated'))).toBe(true)
    expect(args.outline.pathData).toMatch(/^M/)
    expectNoFalCalls(fetchMock)
  })

  it('cutting, with transparent upload → "cutting user uploaded" placeholder with a traced outline', async () => {
    offlineMode()
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'cutting', referenceImageDataUrl: transparentDataUrl })
    await expectPdf(res)

    const args = pdf.buildCuttingPdf.mock.calls[0][0]
    expect(args.pngBuffer.equals(await getPlaceholderPng('cutting', 'user-uploaded'))).toBe(true)
    expect(args.outline.pathData).toMatch(/^M/)
    expectNoFalCalls(fetchMock)
  })

  it('behaves identically whether or not FAL_API_KEY is set', async () => {
    const fetchMock = forbidNetwork()

    offlineMode('')
    await expectPdf(await generate({ activity: 'maze' }))
    const withoutKey = pdf.buildPdf.mock.calls[0][0].icon.url

    offlineMode('real-looking-key')
    await expectPdf(await generate({ activity: 'maze' }))
    const withKey = pdf.buildPdf.mock.calls[1][0].icon.url

    expect(withKey).toBe(withoutKey)
    expect(withKey).toBe(await getPlaceholderDataUrl('maze', 'system-generated'))
    expectNoFalCalls(fetchMock)
  })

  it('each difficulty produces a cutting PDF from the placeholder', async () => {
    offlineMode()
    forbidNetwork()
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      await expectPdf(await generate({ activity: 'cutting', difficulty }))
    }
    expect(pdf.buildCuttingPdf).toHaveBeenCalledTimes(3)
  })
})

// ─── Offline mode → 400 for opaque cutting uploads ────────────────────────────

describe('POST /generate — offline mode rejects cutting uploads without transparency', () => {
  it.each([
    ['opaque PNG',  () => opaquePngDataUrl],
    ['JPEG',        () => opaqueJpegDataUrl],
  ])('%s upload → 400 with a clear message', async (_name, dataUrl) => {
    offlineMode()
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'cutting', referenceImageDataUrl: dataUrl() })

    expect(res.status).toBe(400)
    const body = await res.json() as ErrorBody
    expect(body.error).toMatch(/transparent background/i)
    expect(body.details).toMatch(/offline/i)
    expectNoFalCalls(fetchMock)
    expect(pdf.buildCuttingPdf).not.toHaveBeenCalled()
  })

  it('still returns 400 (not a placeholder) when a FAL_API_KEY is set', async () => {
    offlineMode('real-looking-key')
    const fetchMock = forbidNetwork()

    const res = await generate({ activity: 'cutting', referenceImageDataUrl: opaquePngDataUrl })

    expect(res.status).toBe(400)
    expectNoFalCalls(fetchMock)
  })

  it('only applies to cutting: an opaque upload for a maze is accepted (placeholder used)', async () => {
    offlineMode()
    forbidNetwork()

    const res = await generate({ activity: 'maze', referenceImageDataUrl: opaquePngDataUrl })
    await expectPdf(res)
  })
})

// ─── Server-Timing ────────────────────────────────────────────────────────────

describe('Server-Timing header', () => {
  it('every /generate response carries a total and a per-stage breakdown', async () => {
    offlineMode()
    forbidNetwork()

    const res = await generate({ activity: 'cutting' })
    const entries = parseServerTiming(res.headers)
    const names = entries.map(e => e.name)

    expect(names).toEqual(['image', 'outline', 'pdf', 'total'])
    for (const e of entries) expect(e.ms).toBeGreaterThanOrEqual(0)

    const total  = entries.find(e => e.name === 'total')!.ms
    const stages = entries.filter(e => e.name !== 'total').reduce((sum, e) => sum + e.ms, 0)
    expect(total).toBeGreaterThanOrEqual(stages)
  })

  it('is present on error responses too, showing which stage failed', async () => {
    defaultMode('')
    forbidNetwork()

    const res = await generate({ activity: 'maze' })
    expect(res.status).toBe(500)
    expect(parseServerTiming(res.headers).map(e => e.name)).toEqual(['image', 'total'])
  })
})
