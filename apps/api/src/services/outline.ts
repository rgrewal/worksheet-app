import sharp from 'sharp'
import type { DifficultyLevel } from '@worksheet/shared'
import logger from '../lib/logger.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number }

type LevelConfig = {
  name: 'easy' | 'medium' | 'hard'
  marginPx: number
  gapClosePx: number
  simplifyPx: number
  strokePx: number
  dash: number
  gap: number
}

type ScaledLevelConfig = LevelConfig & {
  scaledMarginPx: number
  scaledGapClosePx: number
  scaledSimplifyPx: number
  scaledStrokePx: number
}

// ─── Public result type ───────────────────────────────────────────────────────

export type CuttingOutlineResult = {
  /** SVG path data in image-pixel coordinates (origin = top-left of original image) */
  pathData: string
  /** Stroke width in image pixels — caller must scale to render units */
  strokePx: number
  /** Dash length in image pixels */
  dash: number
  /** Gap length between dashes in image pixels */
  gap: number
}

// ─── Level configs (parameters defined for a ~1024 px image) ─────────────────

const LEVELS: Record<DifficultyLevel, LevelConfig> = {
  easy: {
    name: 'easy',
    marginPx: 76,
    gapClosePx: 28,
    simplifyPx: 18,
    strokePx: 7,
    dash: 34,
    gap: 22,
  },
  medium: {
    name: 'medium',
    marginPx: 42,
    gapClosePx: 18,
    simplifyPx: 10,
    strokePx: 6,
    dash: 26,
    gap: 16,
  },
  hard: {
    name: 'hard',
    marginPx: 16,
    gapClosePx: 10,
    simplifyPx: 5,
    strokePx: 5,
    dash: 18,
    gap: 12,
  },
}

const ALPHA_THRESHOLD = 16
const DISTANCE_INFINITY = 1e20

/**
 * Longest edge of the mask the raster stages work on. Everything here is
 * O(pixels) (three distance transforms, two flood fills, contour tracing), so
 * a 1024 px image costs ~4× a 512 px one. The contour is simplified to
 * 5–18 px (scaled) anyway, and the dashed cut line is 5–7 px wide, so working
 * at 512 px loses nothing visible in print. Path coordinates and stroke sizes
 * are scaled back to source-image pixels before returning.
 */
const MAX_WORKING_PX = 512

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function generateCuttingOutline(
  pngBuffer: Buffer,
  difficulty: DifficultyLevel,
): Promise<CuttingOutlineResult> {
  const src = await loadWorkingAlpha(pngBuffer)
  const { alpha, toSource } = src
  const width  = src.workingWidth
  const height = src.workingHeight

  // Level parameters are calibrated for a 1024 px image. `sourceScale` adapts
  // them to this image; the mask stages use the same values expressed in
  // working pixels, so the margin is the same fraction of the image whether or
  // not the mask was downsampled.
  const sourceScale  = Math.max(0.25, Math.min(src.width, src.height) / 1024)
  const workingScale = sourceScale / toSource
  const level = scaleLevel(LEVELS[difficulty], workingScale)

  const padding =
    level.scaledMarginPx + level.scaledGapClosePx + level.scaledStrokePx + 24

  const workingWidth  = width  + padding * 2
  const workingHeight = height + padding * 2

  const rawMask        = maskFromAlpha(alpha, ALPHA_THRESHOLD)
  const paddedMask     = padMask(rawMask, width, height, padding)
  const minArea        = Math.max(20, Math.round(width * height * 0.00005))
  const cleanedBase    = removeSmallComponents(paddedMask, workingWidth, workingHeight, minArea)
  const cutMask        = makeCutMask(cleanedBase, workingWidth, workingHeight, level)

  const contours = traceContours(cutMask, workingWidth, workingHeight)
    .map(removeCollinearPoints)
    .map((c) => simplifyClosedContour(c, level.scaledSimplifyPx))
    .filter((c) => Math.abs(polygonArea(c)) >= minArea)

  if (contours.length === 0) {
    throw new Error('generateCuttingOutline: could not create a cut contour')
  }

  // Shift contours from padded-working space back to source-image pixels
  const imageSpaceContours = contours.map((c) =>
    c.map((p) => ({ x: (p.x - padding) * toSource, y: (p.y - padding) * toSource })),
  )

  const pathData = imageSpaceContours.map(contourToPathData).join(' ')

  logger.debug(
    {
      difficulty,
      source: `${src.width}×${src.height}`,
      working: `${width}×${height}`,
      contours: contours.length,
      pathDataLength: pathData.length,
    },
    'generateCuttingOutline: done',
  )

  // Stroke geometry is in source pixels, computed from the source scale
  // directly so working-resolution rounding does not leak into the PDF.
  const base = LEVELS[difficulty]
  return {
    pathData,
    strokePx: Math.max(1, Math.round(base.strokePx * sourceScale)),
    dash:     Math.max(1, Math.round(base.dash     * sourceScale)),
    gap:      Math.max(1, Math.round(base.gap      * sourceScale)),
  }
}

// ─── Alpha loading at working resolution ─────────────────────────────────────

interface WorkingAlpha {
  /** Source image size */
  width: number
  height: number
  /** Size the raster stages run at (≤ MAX_WORKING_PX on the longest edge) */
  workingWidth: number
  workingHeight: number
  /** Multiply working-space coordinates by this to get source pixels */
  toSource: number
  /** Alpha channel at working resolution */
  alpha: Uint8Array
}

async function loadWorkingAlpha(pngBuffer: Buffer): Promise<WorkingAlpha> {
  const meta = await sharp(pngBuffer).metadata()
  const width  = meta.width  ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) throw new Error('generateCuttingOutline: could not read image size')

  const downscale     = Math.min(1, MAX_WORKING_PX / Math.max(width, height))
  const workingWidth  = Math.max(1, Math.round(width  * downscale))
  const workingHeight = Math.max(1, Math.round(height * downscale))

  let pipeline = sharp(pngBuffer).ensureAlpha().extractChannel('alpha')
  if (downscale < 1) {
    pipeline = pipeline.resize(workingWidth, workingHeight, { fit: 'fill', kernel: 'lanczos3' })
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })

  return {
    width,
    height,
    workingWidth:  info.width,
    workingHeight: info.height,
    toSource: width / info.width,
    alpha: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  }
}

// ─── Level scaling ────────────────────────────────────────────────────────────

function scaleLevel(level: LevelConfig, scale: number): ScaledLevelConfig {
  return {
    ...level,
    scaledMarginPx:   Math.max(1, Math.round(level.marginPx   * scale)),
    scaledGapClosePx: Math.max(1, Math.round(level.gapClosePx * scale)),
    scaledSimplifyPx: Math.max(1, Math.round(level.simplifyPx * scale)),
    scaledStrokePx:   Math.max(1, Math.round(level.strokePx   * scale)),
  }
}

// ─── Mask construction ────────────────────────────────────────────────────────

function maskFromAlpha(alpha: Uint8Array, threshold: number): Uint8Array {
  const mask = new Uint8Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) {
    mask[i] = alpha[i] > threshold ? 1 : 0
  }
  return mask
}

function padMask(
  mask: Uint8Array,
  width: number,
  height: number,
  padding: number,
): Uint8Array {
  const pw = width  + padding * 2
  const ph = height + padding * 2
  const padded = new Uint8Array(pw * ph)
  for (let y = 0; y < height; y++) {
    const src = y * width
    const dst = (y + padding) * pw + padding
    padded.set(mask.subarray(src, src + width), dst)
  }
  return padded
}

function makeCutMask(
  baseMask: Uint8Array,
  width: number,
  height: number,
  level: ScaledLevelConfig,
): Uint8Array {
  const closed      = closeMask(baseMask, width, height, level.scaledGapClosePx)
  const noHoles     = fillHoles(closed, width, height)
  const expanded    = dilateMask(noHoles, width, height, level.scaledMarginPx)
  return fillHoles(expanded, width, height)
}

function closeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return erodeMask(dilateMask(mask, width, height, radius), width, height, radius)
}

function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask.slice()
  const dist = squaredDistanceToValue(mask, width, height, 1)
  const r2   = radius * radius
  const out  = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    out[i] = dist[i] <= r2 ? 1 : 0
  }
  return out
}

function erodeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask.slice()
  const dist = squaredDistanceToValue(mask, width, height, 0)
  const r2   = radius * radius
  const out  = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    out[i] = mask[i] === 1 && dist[i] > r2 ? 1 : 0
  }
  return out
}

// ─── 2-D squared distance transform (Felzenszwalb/Huttenlocher) ───────────────

function squaredDistanceToValue(
  mask: Uint8Array,
  width: number,
  height: number,
  targetValue: 0 | 1,
): Float64Array {
  let hasTarget = false
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === targetValue) { hasTarget = true; break }
  }

  const size   = width * height
  const result = new Float64Array(size)
  if (!hasTarget) {
    result.fill(DISTANCE_INFINITY)
    return result
  }

  const temp      = new Float64Array(size)
  const maxDim    = Math.max(width, height)
  const values    = new Float64Array(maxDim)
  const distances = new Float64Array(maxDim)

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      values[y] = mask[y * width + x] === targetValue ? 0 : DISTANCE_INFINITY
    }
    squaredDistanceTransform1d(values, height, distances)
    for (let y = 0; y < height; y++) {
      temp[y * width + x] = distances[y]
    }
  }

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) values[x] = temp[row + x]
    squaredDistanceTransform1d(values, width, distances)
    for (let x = 0; x < width; x++) result[row + x] = distances[x]
  }

  return result
}

function squaredDistanceTransform1d(
  values: Float64Array,
  length: number,
  distances: Float64Array,
): void {
  const locations   = new Int32Array(length)
  const boundaries  = new Float64Array(length + 1)
  let segment = 0

  locations[0]  = 0
  boundaries[0] = -DISTANCE_INFINITY
  boundaries[1] = DISTANCE_INFINITY

  for (let q = 1; q < length; q++) {
    let intersection = parabolaIntersection(values, q, locations[segment])
    while (intersection <= boundaries[segment]) {
      segment--
      intersection = parabolaIntersection(values, q, locations[segment])
    }
    segment++
    locations[segment]     = q
    boundaries[segment]    = intersection
    boundaries[segment + 1] = DISTANCE_INFINITY
  }

  segment = 0
  for (let q = 0; q < length; q++) {
    while (boundaries[segment + 1] < q) segment++
    const d = q - locations[segment]
    distances[q] = d * d + values[locations[segment]]
  }
}

function parabolaIntersection(values: Float64Array, q: number, loc: number): number {
  return (
    (values[q] + q * q - values[loc] - loc * loc) / (2 * q - 2 * loc)
  )
}

// ─── Hole filling (BFS from border) ──────────────────────────────────────────

function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const visited = new Uint8Array(mask.length)
  const queue   = new Int32Array(mask.length)
  let head = 0
  let tail = 0

  const enqueue = (idx: number): void => {
    if (mask[idx] === 0 && visited[idx] === 0) {
      visited[idx] = 1
      queue[tail++] = idx
    }
  }

  for (let x = 0; x < width; x++) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }

  while (head < tail) {
    const idx = queue[head++]
    const x   = idx % width
    const y   = Math.floor(idx / width)
    if (x > 0)           enqueue(idx - 1)
    if (x + 1 < width)   enqueue(idx + 1)
    if (y > 0)           enqueue(idx - width)
    if (y + 1 < height)  enqueue(idx + width)
  }

  const filled = mask.slice()
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0 && visited[i] === 0) filled[i] = 1
  }
  return filled
}

// ─── Small component removal ──────────────────────────────────────────────────

function removeSmallComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Uint8Array {
  const visited = new Uint8Array(mask.length)
  const output  = new Uint8Array(mask.length)
  const queue   = new Int32Array(mask.length)

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue

    let head = 0
    let tail = 0
    visited[start] = 1
    queue[tail++]  = start

    while (head < tail) {
      const idx = queue[head++]
      const x   = idx % width
      const y   = Math.floor(idx / width)
      if (x > 0)          tail = enqueueForeground(mask, visited, queue, tail, idx - 1)
      if (x + 1 < width)  tail = enqueueForeground(mask, visited, queue, tail, idx + 1)
      if (y > 0)          tail = enqueueForeground(mask, visited, queue, tail, idx - width)
      if (y + 1 < height) tail = enqueueForeground(mask, visited, queue, tail, idx + width)
    }

    if (tail >= minArea) {
      for (let i = 0; i < tail; i++) output[queue[i]] = 1
    }
  }

  return output
}

function enqueueForeground(
  mask: Uint8Array,
  visited: Uint8Array,
  queue: Int32Array,
  tail: number,
  idx: number,
): number {
  if (mask[idx] === 1 && visited[idx] === 0) {
    visited[idx]  = 1
    queue[tail++] = idx
  }
  return tail
}

// ─── Contour tracing ──────────────────────────────────────────────────────────

function traceContours(mask: Uint8Array, width: number, height: number): Point[][] {
  type Edge = { from: Point; to: Point; fromKey: string; toKey: string; used: boolean }

  const edges: Edge[]                  = []
  const outgoing = new Map<string, number[]>()

  const isFilled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1

  const addEdge = (from: Point, to: Point): void => {
    const edge: Edge = { from, to, fromKey: ptKey(from), toKey: ptKey(to), used: false }
    const idx = edges.length
    edges.push(edge)
    const list = outgoing.get(edge.fromKey)
    if (list) list.push(idx)
    else outgoing.set(edge.fromKey, [idx])
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isFilled(x, y)) continue
      if (!isFilled(x,     y - 1)) addEdge({ x,     y     }, { x: x + 1, y     })
      if (!isFilled(x + 1, y    )) addEdge({ x: x + 1, y  }, { x: x + 1, y: y + 1 })
      if (!isFilled(x,     y + 1)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 })
      if (!isFilled(x - 1, y    )) addEdge({ x, y: y + 1  }, { x, y     })
    }
  }

  const contours: Point[][] = []

  for (let ei = 0; ei < edges.length; ei++) {
    if (edges[ei].used) continue

    const start    = edges[ei]
    start.used     = true
    const contour: Point[] = [start.from, start.to]
    let currentKey = start.toKey
    let guard      = 0

    while (currentKey !== start.fromKey && guard < edges.length) {
      const next = chooseNextEdge(edges, outgoing.get(currentKey) ?? [], contour)
      if (next === undefined) break
      edges[next].used = true
      contour.push(edges[next].to)
      currentKey = edges[next].toKey
      guard++
    }

    if (currentKey === start.fromKey && contour.length >= 4) {
      contour.pop()
      contours.push(contour)
    }
  }

  return contours
}

function chooseNextEdge(
  edges: { from: Point; to: Point; used: boolean }[],
  candidates: number[],
  contour: Point[],
): number | undefined {
  const available = candidates.filter((i) => !edges[i].used)
  if (available.length <= 1) return available[0]

  const prev       = contour[contour.length - 2]
  const curr       = contour[contour.length - 1]
  const inDir      = directionIndex(curr.x - prev.x, curr.y - prev.y)
  const preference = new Map<number, number>([[1, 0], [0, 1], [3, 2], [2, 3]])

  return available
    .map((i) => {
      const e      = edges[i]
      const outDir = directionIndex(e.to.x - e.from.x, e.to.y - e.from.y)
      const turn   = (outDir - inDir + 4) % 4
      return { i, score: preference.get(turn) ?? 99 }
    })
    .sort((a, b) => a.score - b.score)[0]?.i
}

function directionIndex(dx: number, dy: number): number {
  if (dx > 0) return 0
  if (dy > 0) return 1
  if (dx < 0) return 2
  return 3
}

function ptKey(p: Point): string {
  return `${p.x},${p.y}`
}

// ─── Contour simplification ───────────────────────────────────────────────────

function removeCollinearPoints(points: Point[]): Point[] {
  if (points.length <= 3) return points
  const out: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]
    const curr = points[i]
    const next = points[(i + 1) % points.length]
    const dx1  = curr.x - prev.x
    const dy1  = curr.y - prev.y
    const dx2  = next.x - curr.x
    const dy2  = next.y - curr.y
    if (dx1 * dy2 !== dy1 * dx2) out.push(curr)
  }
  return out
}

function simplifyClosedContour(points: Point[], tolerance: number): Point[] {
  if (points.length <= 4) return points

  let secondIdx   = 0
  let bestDist    = -1
  for (let i = 0; i < points.length; i++) {
    const d = squaredDistance(points[0], points[i])
    if (d > bestDist) { bestDist = d; secondIdx = i }
  }

  const first  = simplifyPolyline(contourSlice(points, 0, secondIdx), tolerance)
  const second = simplifyPolyline(contourSlice(points, secondIdx, 0), tolerance)
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

function contourSlice(points: Point[], startIdx: number, endIdx: number): Point[] {
  const out: Point[] = []
  let i = startIdx
  while (i !== endIdx) {
    out.push(points[i])
    i = (i + 1) % points.length
  }
  out.push(points[endIdx])
  return out
}

function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points

  const tol2 = tolerance * tolerance
  let bestDist  = -1
  let bestIdx   = -1
  const start   = points[0]
  const end     = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = squaredDistanceToSegment(points[i], start, end)
    if (d > bestDist) { bestDist = d; bestIdx = i }
  }

  if (bestDist <= tol2 || bestIdx === -1) return [start, end]

  const left  = simplifyPolyline(points.slice(0, bestIdx + 1), tolerance)
  const right = simplifyPolyline(points.slice(bestIdx), tolerance)
  return [...left.slice(0, -1), ...right]
}

function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function squaredDistanceToSegment(p: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return squaredDistance(p, start)
  const t  = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / l2))
  return squaredDistance(p, { x: start.x + t * dx, y: start.y + t * dy })
}

function polygonArea(points: Point[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const curr = points[i]
    const next = points[(i + 1) % points.length]
    area += curr.x * next.y - next.x * curr.y
  }
  return area / 2
}

// ─── SVG path serialisation ───────────────────────────────────────────────────

function contourToPathData(contour: Point[]): string {
  const [first, ...rest] = contour
  const cmds = [`M ${fmt(first.x)} ${fmt(first.y)}`]
  for (const p of rest) cmds.push(`L ${fmt(p.x)} ${fmt(p.y)}`)
  cmds.push('Z')
  return cmds.join(' ')
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}
