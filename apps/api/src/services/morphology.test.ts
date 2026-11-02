import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import { growMask, shrinkMask, closeMask, openMask, thresholdMask, type Mask } from './morphology.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const W = 200
const H = 200

/** 200×200 black mask with a 60×60 white square at (70,70) */
let square: Mask
/** Two 40×60 white blocks separated by a 6 px black gap */
let gapped: Mask

async function maskFromSvg(svg: string): Promise<Mask> {
  const data = await sharp(Buffer.from(svg)).toColourspace('b-w').raw().toBuffer()
  return { data, width: W, height: H }
}

beforeAll(async () => {
  square = await maskFromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="black"/><rect x="70" y="70" width="60" height="60" fill="white"/></svg>`,
  )
  gapped = await maskFromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="black"/>
      <rect x="60" y="70" width="40" height="60" fill="white"/>
      <rect x="106" y="70" width="40" height="60" fill="white"/></svg>`,
  )
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function whiteCount(m: Mask): number {
  let n = 0
  for (let i = 0; i < m.data.length; i++) if (m.data[i] > 127) n++
  return n
}

/** Horizontal extent of white on the centre row: [first, last] */
function rowExtent(m: Mask, y = H / 2): [number, number] {
  let first = -1
  let last = -1
  for (let x = 0; x < m.width; x++) {
    if (m.data[y * m.width + x] > 127) { if (first < 0) first = x; last = x }
  }
  return [first, last]
}

// ─── Pin sharp's convention ───────────────────────────────────────────────────

describe("sharp's raw dilate()/erode() convention (dark = foreground)", () => {
  // If a sharp upgrade ever flips this, these fail loudly and growMask/shrinkMask
  // must be swapped. Do not "fix" the helpers without updating this test.
  it('sharp.dilate() SHRINKS a white subject on black', async () => {
    const out = await sharp(square.data, { raw: { width: W, height: H, channels: 1 } })
      .dilate(5).toColourspace('b-w').raw().toBuffer()
    const n = whiteCount({ data: out, width: W, height: H })
    expect(n).toBe(50 * 50)
  })

  it('sharp.erode() GROWS a white subject on black', async () => {
    const out = await sharp(square.data, { raw: { width: W, height: H, channels: 1 } })
      .erode(5).toColourspace('b-w').raw().toBuffer()
    const n = whiteCount({ data: out, width: W, height: H })
    expect(n).toBe(70 * 70)
  })

  it('within one sharp() instance, operations run in a fixed order regardless of call order', async () => {
    // negate() is applied last no matter where it appears in the chain, so
    // ".negate().dilate(5).negate()" is a single negate after the dilate.
    const out = await sharp(square.data, { raw: { width: W, height: H, channels: 1 } })
      .negate().dilate(5).negate().toColourspace('b-w').raw().toBuffer()
    const n = whiteCount({ data: out, width: W, height: H })
    // Result is the 50×50 shrunken square, inverted: everything else is white
    expect(n).toBe(W * H - 50 * 50)
  })
})

// ─── Helpers behave as their names say ───────────────────────────────────────

describe('growMask / shrinkMask', () => {
  it('growMask(r) expands the subject by exactly r on each side', async () => {
    const out = await growMask(square, 10)
    expect(whiteCount(out)).toBe(80 * 80)
    expect(rowExtent(out)).toEqual([60, 139])
  })

  it('shrinkMask(r) contracts the subject by exactly r on each side', async () => {
    const out = await shrinkMask(square, 10)
    expect(whiteCount(out)).toBe(40 * 40)
    expect(rowExtent(out)).toEqual([80, 119])
  })

  it('radius 0 is a copy', async () => {
    const out = await growMask(square, 0)
    expect(out.data.equals(square.data)).toBe(true)
    expect(out.data).not.toBe(square.data)
  })

  it('returns a 1-channel mask of the same size', async () => {
    const out = await growMask(square, 3)
    expect(out.width).toBe(W)
    expect(out.height).toBe(H)
    expect(out.data.length).toBe(W * H)
  })

  it('grow then shrink by the same radius restores a convex shape exactly', async () => {
    const out = await shrinkMask(await growMask(square, 7), 7)
    expect(out.data.equals(square.data)).toBe(true)
  })
})

describe('closeMask / openMask', () => {
  it('closeMask bridges a gap narrower than 2·radius without moving outer edges', async () => {
    const out = await closeMask(gapped, 4)
    // 6 px gap closed: 40 + 6 + 40 = 86 wide block
    expect(rowExtent(out)).toEqual([60, 145])
    expect(whiteCount(out)).toBe(86 * 60)
  })

  it('closeMask leaves a gap wider than 2·radius alone', async () => {
    const out = await closeMask(gapped, 2)
    expect(out.data.equals(gapped.data)).toBe(true)
  })

  it('openMask removes a strand thinner than 2·radius', async () => {
    const withStrand = await maskFromSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <rect width="${W}" height="${H}" fill="black"/>
        <rect x="70" y="70" width="60" height="60" fill="white"/>
        <rect x="130" y="98" width="50" height="3" fill="white"/></svg>`,
    )
    const out = await openMask(withStrand, 3)
    expect(whiteCount(out)).toBe(60 * 60)
  })
})

describe('thresholdMask', () => {
  it('binarises soft alpha: above threshold → 255, at/below → 0', async () => {
    const soft = { data: Buffer.from([0, 10, 16, 17, 128, 255]), width: 6, height: 1 }
    const out = await thresholdMask(soft, 16)
    expect([...out.data]).toEqual([0, 0, 0, 255, 255, 255])
  })
})
