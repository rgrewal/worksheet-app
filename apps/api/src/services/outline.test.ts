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
