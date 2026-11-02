/**
 * Geometric tests for the cutting outline on a variety of subject shapes.
 *
 * Every shape is rendered as an opaque silhouette on a transparent 512×512
 * canvas, traced at each difficulty, and the resulting path is checked
 * against the subject's alpha mask:
 *
 *   - exactly one closed contour (holes and concavities never get their own line)
 *   - every subject pixel lies inside the contour
 *   - the line never comes closer to the subject than the margin (less the
 *     simplification tolerance), and hugs it at the extremes
 *   - the contour's bounding box is the subject's bounding box grown by the margin
 *
 * Parameters below are the LEVELS table in outline.ts scaled for a 512 px
 * source (sourceScale = 0.5). Thin (~2 px) appendages are deliberately not
 * covered: the line is allowed to cut through those.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import type { DifficultyLevel } from '@worksheet/shared'
import { generateCuttingOutline } from './outline.js'
import { SHAPES, SHAPE_CANVAS as SIZE, SHAPE_CENTRE as C, shapeSvg, type Shape, type Point } from '../test/outlineShapes.js'

/** outline.ts LEVELS × 0.5 (source scale for a 512 px image) */
const PARAMS: Record<DifficultyLevel, { margin: number; gapClose: number; simplify: number }> = {
  easy:   { margin: 38, gapClose: 14, simplify: 9 },
  medium: { margin: 21, gapClose: 9,  simplify: 5 },
  hard:   { margin: 8,  gapClose: 5,  simplify: 3 },
}
const DIFFICULTIES: DifficultyLevel[] = ['easy', 'medium', 'hard']

/** Pixel-quantisation slack: contour vertices sit on pixel corners, subject samples on centres */
const PX_SLACK = 3

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Subject {
  png: Buffer
  /** Centres of opaque pixels that touch a transparent neighbour (or the canvas edge) */
  boundary: Point[]
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
}

async function renderSubject(shape: Shape): Promise<Subject> {
  const png = await sharp(Buffer.from(shapeSvg(shape))).ensureAlpha().png().toBuffer()
  const { data, info } = await sharp(png).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && data[y * W + x] > 16

  const boundary: Point[] = []
  const bbox = { minX: W, minY: H, maxX: -1, maxY: -1 }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!opaque(x, y)) continue
      bbox.minX = Math.min(bbox.minX, x); bbox.maxX = Math.max(bbox.maxX, x)
      bbox.minY = Math.min(bbox.minY, y); bbox.maxY = Math.max(bbox.maxY, y)
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) {
        boundary.push({ x: x + 0.5, y: y + 0.5 })
      }
    }
  }
  return { png, boundary, bbox }
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Splits SVG path data into closed contours (one per `M`) */
function parseContours(pathData: string): Point[][] {
  return pathData
    .split(/(?=M )/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(seg => [...seg.matchAll(/[ML]\s+([-\d.]+)\s+([-\d.]+)/g)].map(([, x, y]) => ({ x: +x, y: +y })))
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function distToPolygon(p: Point, poly: Point[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i], poly[(i + 1) % poly.length]))
  return best
}

function distToPoints(p: Point, pts: Point[]): number {
  let best = Infinity
  for (const q of pts) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y))
  return best
}

/** Points along every edge of the polygon, roughly `step` px apart (vertices included) */
function samplePolygon(poly: Point[], step: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}

function bboxOf(pts: Point[]) {
  return {
    minX: Math.min(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)),
    maxX: Math.max(...pts.map(p => p.x)),
    maxY: Math.max(...pts.map(p => p.y)),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.each(SHAPES)('cutting outline around: $name', (shape) => {
  let subject: Subject
  beforeAll(async () => { subject = await renderSubject(shape) })

  describe.each(DIFFICULTIES)('%s', (difficulty) => {
    const { margin, gapClose, simplify } = PARAMS[difficulty]

    let pathData: string
    let contours: Point[][]
    let poly: Point[]
    beforeAll(async () => {
      pathData = (await generateCuttingOutline(subject.png, difficulty)).pathData
      contours = parseContours(pathData)
      poly = contours[0]
    })

    it('produces exactly one closed contour', () => {
      expect(contours).toHaveLength(1)
      expect(poly.length).toBeGreaterThanOrEqual(4)
      expect(pathData.endsWith('Z')).toBe(true)
    })

    it('encloses every subject pixel', () => {
      const outside = subject.boundary.filter(p => !pointInPolygon(p, poly))
      expect(outside).toHaveLength(0)
    })

    it(`keeps the line at least ${margin} px (minus ${simplify} px simplification) from the subject`, () => {
      const minGap = Math.min(...subject.boundary.map(p => distToPolygon(p, poly)))
      expect(minGap).toBeGreaterThanOrEqual(margin - simplify - PX_SLACK)
    })

    it('hugs the subject: line vertices are close to the margin distance', () => {
      const vertexGaps = poly.map(v => distToPoints(v, subject.boundary))

      // No vertex is ever nearer than the margin
      expect(Math.min(...vertexGaps)).toBeGreaterThanOrEqual(margin - PX_SLACK)

      if (shape.convex) {
        // Around a convex subject the whole line is an exact offset
        expect(Math.max(...vertexGaps)).toBeLessThanOrEqual(margin + PX_SLACK)
      } else {
        // Concavities narrower than the gap-closing radius are bridged, so the
        // line may sit further out there — but it must still touch the margin
        // somewhere, and never stray beyond margin + gap-closing.
        expect(Math.min(...vertexGaps)).toBeLessThanOrEqual(margin + PX_SLACK)
        expect(Math.max(...vertexGaps)).toBeLessThanOrEqual(margin + 2 * gapClose + simplify + PX_SLACK)
      }
    })

    it("bounding box is the subject's bounding box grown by the margin", () => {
      const got = bboxOf(samplePolygon(poly, 2))
      const want = {
        minX: subject.bbox.minX - margin,
        minY: subject.bbox.minY - margin,
        maxX: subject.bbox.maxX + 1 + margin,
        maxY: subject.bbox.maxY + 1 + margin,
      }
      // Simplification may pull the extreme vertex up to `simplify` px inward, never outward
      expect(got.minX).toBeGreaterThanOrEqual(want.minX - PX_SLACK)
      expect(got.minX).toBeLessThanOrEqual(want.minX + simplify + PX_SLACK)
      expect(got.minY).toBeGreaterThanOrEqual(want.minY - PX_SLACK)
      expect(got.minY).toBeLessThanOrEqual(want.minY + simplify + PX_SLACK)
      expect(got.maxX).toBeLessThanOrEqual(want.maxX + PX_SLACK)
      expect(got.maxX).toBeGreaterThanOrEqual(want.maxX - simplify - PX_SLACK)
      expect(got.maxY).toBeLessThanOrEqual(want.maxY + PX_SLACK)
      expect(got.maxY).toBeGreaterThanOrEqual(want.maxY - simplify - PX_SLACK)
    })

    if (shape.enclosedPoint) {
      it('encloses the transparent region inside the subject (no inner cut line)', () => {
        expect(pointInPolygon(shape.enclosedPoint!, poly)).toBe(true)
      })
    }
  })
})

// ─── Doughnut specifics ───────────────────────────────────────────────────────

describe('doughnut: the transparent hole never receives a cutting line', () => {
  const doughnut = SHAPES.find(s => s.name.startsWith('doughnut'))!
  const OUTER = 190
  const HOLE = 80

  it.each(DIFFICULTIES)('%s: the single contour lies entirely outside the ring', async (difficulty) => {
    const subject = await renderSubject(doughnut)
    const { pathData } = await generateCuttingOutline(subject.png, difficulty)
    const contours = parseContours(pathData)
    expect(contours).toHaveLength(1)

    const { margin } = PARAMS[difficulty]
    const radii = samplePolygon(contours[0], 2).map(p => Math.hypot(p.x - C, p.y - C))
    // Every point of the line is a concentric circle of radius OUTER + margin
    // (the simplified polygon cuts at most `simplify` px inside that circle)…
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(OUTER + margin - PARAMS[difficulty].simplify - PX_SLACK)
    expect(Math.max(...radii)).toBeLessThanOrEqual(OUTER + margin + PX_SLACK)
    // …and nothing comes anywhere near the hole
    expect(Math.min(...radii)).toBeGreaterThan(HOLE + margin + 50)
  })

  it('a hole is treated the same whether or not it is centred', async () => {
    const offCentre: Shape = {
      name: 'doughnut, off-centre hole',
      svg: `<path fill-rule="evenodd" d="M ${C} ${C - 190} a 190 190 0 1 0 0.01 0 Z M ${C + 60} ${C - 20} a 60 60 0 1 1 -0.01 0 Z"/>`,
      convex: true,
    }
    const subject = await renderSubject(offCentre)
    const { pathData } = await generateCuttingOutline(subject.png, 'hard')
    const contours = parseContours(pathData)
    expect(contours).toHaveLength(1)
    expect(pointInPolygon({ x: C + 60, y: C + 40 }, contours[0])).toBe(true)
  })

  it('a ring with a narrow opening (a "C") is treated as a doughnut once the gap is bridged', async () => {
    // Ring 190/120 with a 16 px opening at the top: narrower than twice the
    // gap-closing radius at easy and medium, so it is bridged and the line
    // stays outside, exactly as for the closed doughnut.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
      <mask id="cut"><rect width="${SIZE}" height="${SIZE}" fill="white"/><rect x="${C - 8}" y="${C - 200}" width="16" height="90" fill="black"/></mask>
      <path mask="url(#cut)" fill-rule="evenodd" d="M ${C} ${C - 190} a 190 190 0 1 0 0.01 0 Z M ${C} ${C - 120} a 120 120 0 1 1 -0.01 0 Z"/>
    </svg>`
    const png = await sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer()

    // Sanity: the opening really is transparent
    const { data, info } = await sharp(png).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
    expect(data[(C - 160) * info.width + C]).toBe(0)

    for (const difficulty of ['easy', 'medium'] as const) {
      const { pathData } = await generateCuttingOutline(png, difficulty)
      const contours = parseContours(pathData)
      expect(contours).toHaveLength(1)
      const radii = samplePolygon(contours[0], 2).map(p => Math.hypot(p.x - C, p.y - C))
      expect(Math.min(...radii)).toBeGreaterThanOrEqual(OUTER + PARAMS[difficulty].margin - PARAMS[difficulty].simplify - PX_SLACK)
      expect(pointInPolygon({ x: C, y: C }, contours[0])).toBe(true)
    }
  })
})

// ─── Stray specks ─────────────────────────────────────────────────────────────

describe('detached specks', () => {
  it('a speck smaller than the minimum component area does not get its own outline', async () => {
    const shape: Shape = {
      name: 'circle + speck',
      svg: `<circle cx="${C}" cy="${C}" r="150"/><rect x="40" y="40" width="4" height="4"/>`,
      convex: true,
    }
    const subject = await renderSubject(shape)
    const contours = parseContours((await generateCuttingOutline(subject.png, 'hard')).pathData)
    expect(contours).toHaveLength(1)
    // …and the remaining contour is around the circle, not the speck
    expect(pointInPolygon({ x: C, y: C }, contours[0])).toBe(true)
    expect(pointInPolygon({ x: 42, y: 42 }, contours[0])).toBe(false)
  })

  it('a detached object large enough to matter gets its own outline', async () => {
    const shape: Shape = {
      name: 'circle + small square',
      svg: `<circle cx="${C}" cy="${C}" r="120"/><rect x="30" y="30" width="40" height="40"/>`,
      convex: true,
    }
    const subject = await renderSubject(shape)
    const contours = parseContours((await generateCuttingOutline(subject.png, 'hard')).pathData)
    expect(contours).toHaveLength(2)
    const around = (p: Point) => contours.filter(c => pointInPolygon(p, c)).length
    expect(around({ x: C, y: C })).toBe(1)
    expect(around({ x: 50, y: 50 })).toBe(1)
  })
})
