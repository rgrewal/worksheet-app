import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  PLACEHOLDER_WORKFLOWS,
  PLACEHOLDER_SOURCES,
  getPlaceholderPng,
  getPlaceholderDataUrl,
  placeholderFileName,
  placeholderSourceFor,
} from './placeholders.js'
import { generateCuttingOutline } from './outline.js'

const ALL = PLACEHOLDER_WORKFLOWS.flatMap(w => PLACEHOLDER_SOURCES.map(s => [w, s] as const))

/** Alpha at (x, y) of a decoded RGBA buffer */
async function alphaAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return data[(y * info.width + x) * info.channels + 3]
}

describe('placeholder assets', () => {
  it('has exactly one placeholder for each of the six workflow × source combinations', () => {
    expect(ALL).toHaveLength(6)
    const names = ALL.map(([w, s]) => placeholderFileName(w, s))
    expect(new Set(names).size).toBe(6)
    expect(names).toEqual([
      'maze-user-uploaded.png',
      'maze-system-generated.png',
      'word-search-user-uploaded.png',
      'word-search-system-generated.png',
      'cutting-user-uploaded.png',
      'cutting-system-generated.png',
    ])
  })

  it.each(ALL)('%s / %s is a readable, non-trivial PNG', async (workflow, source) => {
    const png  = await getPlaceholderPng(workflow, source)
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBeGreaterThanOrEqual(512)
    expect(meta.height).toBeGreaterThanOrEqual(512)
  })

  it('returns the same cached buffer on repeated calls', async () => {
    const a = await getPlaceholderPng('maze', 'system-generated')
    const b = await getPlaceholderPng('maze', 'system-generated')
    expect(a).toBe(b)
  })

  it('each placeholder is visually distinct (different bytes)', async () => {
    const buffers = await Promise.all(ALL.map(([w, s]) => getPlaceholderPng(w, s)))
    const hashes = new Set(buffers.map(b => b.toString('base64')))
    expect(hashes.size).toBe(6)
  })

  it('getPlaceholderDataUrl wraps the PNG bytes as a base64 data URL', async () => {
    const png = await getPlaceholderPng('word-search', 'user-uploaded')
    const url = await getPlaceholderDataUrl('word-search', 'user-uploaded')
    expect(url).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })
})

describe('maze / word-search placeholders (bordered, opaque)', () => {
  const bordered = ALL.filter(([w]) => w !== 'cutting')

  it.each(bordered)('%s / %s is fully opaque', async (workflow, source) => {
    const png = await getPlaceholderPng(workflow, source)
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let transparent = 0
    for (let i = 3; i < data.length; i += info.channels) if (data[i] < 255) transparent++
    expect(transparent).toBe(0)
  })

  it.each(bordered)('%s / %s has a dark border pixel at every edge midpoint', async (workflow, source) => {
    const png = await getPlaceholderPng(workflow, source)
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const lum = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels
      return (data[i] + data[i + 1] + data[i + 2]) / 3
    }
    const cx = Math.floor(info.width / 2)
    const cy = Math.floor(info.height / 2)
    expect(lum(cx, 0)).toBeLessThan(64)               // top edge
    expect(lum(cx, info.height - 1)).toBeLessThan(64) // bottom edge
    expect(lum(0, cy)).toBeLessThan(64)               // left edge
    expect(lum(info.width - 1, cy)).toBeLessThan(64)  // right edge
    expect(lum(cx, cy)).toBeGreaterThan(200)          // centre is light (inside the circle)
  })

  it('"user uploaded" variants are non-square (photo-like) so stretching is detectable', async () => {
    for (const workflow of ['maze', 'word-search'] as const) {
      const meta = await sharp(await getPlaceholderPng(workflow, 'user-uploaded')).metadata()
      expect(meta.width).not.toBe(meta.height)
    }
  })

  it('"system generated" variants are square, matching the Ideogram default', async () => {
    for (const workflow of ['maze', 'word-search'] as const) {
      const meta = await sharp(await getPlaceholderPng(workflow, 'system-generated')).metadata()
      expect(meta.width).toBe(meta.height)
    }
  })
})

describe('cutting placeholders (shape on transparent background)', () => {
  const cutting = ALL.filter(([w]) => w === 'cutting')

  it.each(cutting)('%s / %s has an alpha channel, transparent corners and edges, opaque centre', async (workflow, source) => {
    const png  = await getPlaceholderPng(workflow, source)
    const meta = await sharp(png).metadata()
    expect(meta.hasAlpha).toBe(true)

    const w = meta.width!
    const h = meta.height!
    const cx = Math.floor(w / 2)
    const cy = Math.floor(h / 2)

    // No border: the image edge must be invisible
    expect(await alphaAt(png, 0, 0)).toBe(0)
    expect(await alphaAt(png, w - 1, 0)).toBe(0)
    expect(await alphaAt(png, 0, h - 1)).toBe(0)
    expect(await alphaAt(png, w - 1, h - 1)).toBe(0)
    expect(await alphaAt(png, cx, 0)).toBe(0)
    expect(await alphaAt(png, 0, cy)).toBe(0)

    // The subject is in the middle
    expect(await alphaAt(png, cx, cy)).toBe(255)
  })

  it.each(cutting)('%s / %s subject is a circle: opaque extent is equal horizontally and vertically', async (workflow, source) => {
    const png = await getPlaceholderPng(workflow, source)
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]
    const cx = Math.floor(info.width / 2)
    const cy = Math.floor(info.height / 2)

    let horiz = 0
    for (let x = 0; x < info.width; x++) if (alpha(x, cy) > 16) horiz++
    let vert = 0
    for (let y = 0; y < info.height; y++) if (alpha(cx, y) > 16) vert++

    expect(Math.abs(horiz - vert)).toBeLessThanOrEqual(2)
    // The diagonal extent of a circle is the same as its axis extent
    let diag = 0
    for (let i = 0; i < Math.min(info.width, info.height); i++) if (alpha(i, i) > 16) diag++
    expect(Math.abs(diag - horiz / Math.SQRT2)).toBeLessThanOrEqual(2)
  })

  it.each(cutting)('%s / %s can be traced into a single cutting outline at every difficulty', async (workflow, source) => {
    const png = await getPlaceholderPng(workflow, source)
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const outline = await generateCuttingOutline(png, difficulty)
      expect(outline.pathData).toMatch(/^M/)
      expect((outline.pathData.match(/M/g) ?? []).length).toBe(1)
    }
  })
})

describe('placeholderSourceFor', () => {
  it('maps a reference image to "user-uploaded" and none to "system-generated"', () => {
    expect(placeholderSourceFor('data:image/png;base64,abc')).toBe('user-uploaded')
    expect(placeholderSourceFor(undefined)).toBe('system-generated')
    expect(placeholderSourceFor('')).toBe('system-generated')
  })
})
