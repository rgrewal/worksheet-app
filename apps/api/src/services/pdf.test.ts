import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import type { WorksheetSpec } from '@worksheet/shared'
import { buildPdf } from './pdf.js'
import { generateMaze, mazeToSvg } from './maze.js'
import { getPlaceholderDataUrl } from './placeholders.js'

const ICON_SIZE = 120

const spec: WorksheetSpec = { interest: 'dinosaurs', activity: 'maze', difficulty: 'easy' }

let mazeArgs: Pick<Parameters<typeof buildPdf>[0], 'activitySvg' | 'activityLabels'>

beforeAll(() => {
  const result = mazeToSvg(generateMaze('easy'))
  mazeArgs = {
    activitySvg: result.svg,
    activityLabels: {
      svgW: result.svgW,
      svgH: result.svgH,
      entryGap: result.entryGap,
      clearing: result.clearing,
      showFinishLabel: true,
    },
  }
})

afterEach(() => vi.restoreAllMocks())

/** Captures the (x, y, {width, height}) PDFKit was asked to draw the icon at. */
function spyOnImage() {
  return vi.spyOn(PDFDocument.prototype, 'image')
}

async function pngDataUrl(width: number, height: number): Promise<string> {
  const png = await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 200, b: 80 } } }).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

describe('buildPdf - maze icon keeps its aspect ratio', () => {
  it('fits a landscape (4:3) upload inside the 120×120 box without stretching', async () => {
    const image = spyOnImage()
    await buildPdf({ spec, icon: { url: await pngDataUrl(1024, 768), label: 'x', cached: false }, ...mazeArgs })

    expect(image).toHaveBeenCalledTimes(1)
    const opts = image.mock.calls[0][3] as { width: number; height: number }
    expect(opts.width).toBeCloseTo(ICON_SIZE, 5)
    expect(opts.height).toBeCloseTo(ICON_SIZE * 3 / 4, 5)
  })

  it('fits a portrait (3:4) upload inside the box without stretching', async () => {
    const image = spyOnImage()
    await buildPdf({ spec, icon: { url: await pngDataUrl(600, 800), label: 'x', cached: false }, ...mazeArgs })

    const opts = image.mock.calls[0][3] as { width: number; height: number }
    expect(opts.width).toBeCloseTo(ICON_SIZE * 3 / 4, 5)
    expect(opts.height).toBeCloseTo(ICON_SIZE, 5)
  })

  it('renders a square image at the full 120×120', async () => {
    const image = spyOnImage()
    await buildPdf({ spec, icon: { url: await pngDataUrl(512, 512), label: 'x', cached: false }, ...mazeArgs })

    const opts = image.mock.calls[0][3] as { width: number; height: number }
    expect(opts.width).toBeCloseTo(ICON_SIZE, 5)
    expect(opts.height).toBeCloseTo(ICON_SIZE, 5)
  })

  it('centres a non-square image within the box the square would have occupied', async () => {
    const image = spyOnImage()
    await buildPdf({ spec, icon: { url: await pngDataUrl(512, 512), label: 'x', cached: false }, ...mazeArgs })
    const [, squareX, squareY] = image.mock.calls[0] as unknown as [Buffer, number, number]

    image.mockClear()
    await buildPdf({ spec, icon: { url: await pngDataUrl(1024, 768), label: 'x', cached: false }, ...mazeArgs })
    const [, wideX, wideY, wideOpts] = image.mock.calls[0] as unknown as [Buffer, number, number, { width: number; height: number }]

    // Same horizontal position (full width), vertically centred in the 120 box
    expect(wideX).toBeCloseTo(squareX, 5)
    expect(wideY).toBeCloseTo(squareY + (ICON_SIZE - wideOpts.height) / 2, 5)
    // And it never leaves the box
    expect(wideX + wideOpts.width).toBeLessThanOrEqual(squareX + ICON_SIZE + 1e-6)
    expect(wideY + wideOpts.height).toBeLessThanOrEqual(squareY + ICON_SIZE + 1e-6)
  })

  it('the offline "maze user uploaded" placeholder (1024×768) is rendered 120×90', async () => {
    const image = spyOnImage()
    const url = await getPlaceholderDataUrl('maze', 'user-uploaded')
    await buildPdf({ spec, icon: { url, label: 'x', cached: false }, ...mazeArgs })

    const opts = image.mock.calls[0][3] as { width: number; height: number }
    expect(opts.width).toBeCloseTo(120, 5)
    expect(opts.height).toBeCloseTo(90, 5)
  })

  it('still produces a valid PDF', async () => {
    const pdf = await buildPdf({ spec, icon: { url: await pngDataUrl(1024, 768), label: 'x', cached: false }, ...mazeArgs })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
