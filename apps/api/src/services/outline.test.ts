import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import type { DifficultyLevel } from '@worksheet/shared'
import { generateCuttingOutline } from './outline.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let subjectPng: Buffer       // 200×200, centered 100×100 opaque square, transparent bg
let allTransparentPng: Buffer // 100×100, fully transparent

beforeAll(async () => {
  const opaquePatch = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 200, b: 50, alpha: 255 } },
  })
    .png()
    .toBuffer()

  subjectPng = await sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: opaquePatch, left: 50, top: 50 }])
    .png()
    .toBuffer()

  allTransparentPng = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer()
})

// ─── Result shape ─────────────────────────────────────────────────────────────

describe.each([
  ['easy']   as [DifficultyLevel],
  ['medium'] as [DifficultyLevel],
  ['hard']   as [DifficultyLevel],
])('generateCuttingOutline("%s") - result shape', (difficulty) => {
  it('returns pathData, strokePx, dash, gap', async () => {
    const result = await generateCuttingOutline(subjectPng, difficulty)
    expect(result).toHaveProperty('pathData')
    expect(result).toHaveProperty('strokePx')
    expect(result).toHaveProperty('dash')
    expect(result).toHaveProperty('gap')
  })

  it('strokePx, dash, and gap are positive numbers', async () => {
    const { strokePx, dash, gap } = await generateCuttingOutline(subjectPng, difficulty)
    expect(strokePx).toBeGreaterThan(0)
    expect(dash).toBeGreaterThan(0)
    expect(gap).toBeGreaterThan(0)
  })

  it('pathData is a non-empty SVG path string', async () => {
    const { pathData } = await generateCuttingOutline(subjectPng, difficulty)
    expect(pathData.length).toBeGreaterThan(0)
    expect(pathData).toMatch(/^M /)
    expect(pathData).toContain('L ')
    expect(pathData).toContain('Z')
  })
})

// ─── Difficulty ordering ──────────────────────────────────────────────────────

describe('generateCuttingOutline - difficulty ordering', () => {
  it('easy has a larger stroke width than hard', async () => {
    const easy = await generateCuttingOutline(subjectPng, 'easy')
    const hard = await generateCuttingOutline(subjectPng, 'hard')
    expect(easy.strokePx).toBeGreaterThan(hard.strokePx)
  })

  it('easy has longer dashes than hard', async () => {
    const easy = await generateCuttingOutline(subjectPng, 'easy')
    const hard = await generateCuttingOutline(subjectPng, 'hard')
    expect(easy.dash).toBeGreaterThan(hard.dash)
  })

  it('easy produces a different (larger-margin) path than hard', async () => {
    const easy = await generateCuttingOutline(subjectPng, 'easy')
    const hard = await generateCuttingOutline(subjectPng, 'hard')
    // Easy margin (76px) >> hard margin (16px), so paths must differ
    expect(easy.pathData).not.toBe(hard.pathData)
  })
})

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('generateCuttingOutline - edge cases', () => {
  it('throws when the image has no visible subject', async () => {
    await expect(generateCuttingOutline(allTransparentPng, 'easy')).rejects.toThrow()
  })

  it('contours stay within reasonable coordinate bounds for the given image', async () => {
    const { pathData } = await generateCuttingOutline(subjectPng, 'easy')
    // Extract all numeric coordinate values from the path
    const coords = [...pathData.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].flatMap(
      ([, x, y]) => [parseFloat(x), parseFloat(y)],
    )
    // The outline extends outside the 200×200 image due to margin, but not by more
    // than the maximum scaledMarginPx (which at scale 0.25 is ≤ 76×0.25=19 plus padding)
    const SLACK = 30
    expect(Math.min(...coords)).toBeGreaterThan(-SLACK)
    expect(Math.max(...coords)).toBeLessThan(200 + SLACK)
  })
})

// ─── Working-resolution cap ──────────────────────────────────────────────────
// Large images are traced on a ≤512 px mask and scaled back. The outline must
// land in the same place, in source pixels, as it would at full resolution.

describe('generateCuttingOutline - working-resolution cap', () => {
  /** Transparent canvas with a centred opaque circle */
  async function circlePng(size: number, radius: number): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="black"/></svg>`
    return sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer()
  }

  function radiiFrom(pathData: string, c: number): number[] {
    return [...pathData.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map(([, x, y]) => Math.hypot(+x - c, +y - c))
  }

  it.each(['easy', 'medium', 'hard'] as const)(
    '%s: a 2048 px image gets the same offset (in source px) as the same shape at 1024 px, scaled ×2',
    async (difficulty) => {
      const small = await generateCuttingOutline(await circlePng(1024, 300), difficulty)
      const large = await generateCuttingOutline(await circlePng(2048, 600), difficulty)

      const rSmall = radiiFrom(small.pathData, 512)
      const rLarge = radiiFrom(large.pathData, 1024)
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

      // Offset scales with the image: margin is a fraction of image size
      expect(mean(rLarge) / mean(rSmall)).toBeCloseTo(2, 1)
      // Stroke geometry scales the same way
      expect(large.strokePx).toBe(small.strokePx * 2)
      expect(large.dash).toBe(small.dash * 2)
      expect(large.gap).toBe(small.gap * 2)
    },
  )

  it('the offset of a circle is concentric and accurate to within 1 % after downsampling', async () => {
    // 1024 px source → 512 px working mask; easy margin = 76 px at this size
    const png = await circlePng(1024, 300)
    const { pathData } = await generateCuttingOutline(png, 'easy')
    const radii = radiiFrom(pathData, 512)
    const expected = 300 + 76
    for (const r of radii) expect(Math.abs(r - expected) / expected).toBeLessThan(0.01)
  })

  it('returns coordinates in source pixels, not working pixels', async () => {
    const png = await circlePng(2048, 600)
    const { pathData } = await generateCuttingOutline(png, 'hard')
    const coords = [...pathData.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].flatMap(([, x, y]) => [+x, +y])
    // hard margin at 2048 px = 16 × 2 = 32 px → outline spans roughly 1024 ± 632
    expect(Math.max(...coords)).toBeGreaterThan(1024 + 600)
    expect(Math.min(...coords)).toBeLessThan(1024 - 600)
  })

  it('images at or below the cap are traced at native resolution (integer coordinates)', async () => {
    const { pathData } = await generateCuttingOutline(subjectPng, 'easy')   // 200 px
    const coords = [...pathData.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].flatMap(([, x, y]) => [x, y])
    for (const c of coords) expect(c).toMatch(/^-?\d+$/)
  })
})
