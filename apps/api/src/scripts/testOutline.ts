/**
 * Debug script for the cutting outline pipeline.
 *
 * Usage (from apps/api):
 *   npx tsx src/scripts/testOutline.ts
 *
 * Drop transparent PNGs into src/scripts/test-images/ before running.
 * All intermediate artifacts are written to src/scripts/test-output/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import potrace from 'potrace'

// ── Pipeline parameters — tweak and re-run ────────────────────────────────────
const DILATE = { easy: 28, medium: 14, hard: 1 }  // controls margin + gap-fill; less = more detail on hard
const ERODE = 0        // set to 0 to skip
const TURD_SIZE = 5
const OPT_TOLERANCE = { easy: 0.25, medium: 0.12, hard: 0.03 } as const
const CONCAVE_CLOSE = { easy: 20, medium: 6, hard: 0 } as const

// ─────────────────────────────────────────────────────────────────────────────

type Difficulty = keyof typeof OPT_TOLERANCE

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INPUT_DIR  = path.join(__dirname, 'test-images')
const OUTPUT_DIR = path.join(__dirname, 'test-output')

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(msg + '\n')
}

interface BBox { minX: number; minY: number; maxX: number; maxY: number }

/** Find the bounding box of non-zero pixels in a single-channel raw buffer. */
function computeBBox(data: Buffer, width: number, height: number): BBox | null {
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        found = true
      }
    }
  }
  return found ? { minX, minY, maxX, maxY } : null
}

/** Fill transparent holes that are fully enclosed by the visible subject mask. */
function fillEnclosedHoles(data: Buffer, width: number, height: number): Buffer {
  const filled = Buffer.from(data)
  const exterior = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const index = y * width + x
    if (exterior[index] || filled[index] !== 0) return
    exterior[index] = 1
    queue[tail++] = index
  }

  for (let x = 0; x < width; x++) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }

  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = Math.floor(index / width)
    enqueue(x + 1, y)
    enqueue(x - 1, y)
    enqueue(x, y + 1)
    enqueue(x, y - 1)
  }

  for (let i = 0; i < filled.length; i++) {
    if (filled[i] === 0 && !exterior[i]) filled[i] = 255
  }

  return filled
}

interface Point { x: number; y: number }

async function makeConcaveHullMask(data: Buffer, width: number, height: number, closeRadius: number): Promise<Buffer> {
  const bbox = computeBBox(data, width, height)
  if (!bbox) return Buffer.from(data)

  const useColumns = (bbox.maxY - bbox.minY) > (bbox.maxX - bbox.minX)
  const points: Point[] = []
  const step = Math.max(2, Math.round(closeRadius / 4))

  if (useColumns) {
    const top = new Int32Array(width).fill(height)
    const bottom = new Int32Array(width).fill(-1)

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (data[y * width + x] > 0) {
          if (y < top[x]) top[x] = y
          if (y > bottom[x]) bottom[x] = y
        }
      }
    }

    const smoothTop = new Int32Array(width).fill(height)
    const smoothBottom = new Int32Array(width).fill(-1)
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - closeRadius)
      const x2 = Math.min(width - 1, x + closeRadius)
      for (let xx = x1; xx <= x2; xx++) {
        if (bottom[xx] < 0) continue
        if (top[xx] < smoothTop[x]) smoothTop[x] = top[xx]
        if (bottom[xx] > smoothBottom[x]) smoothBottom[x] = bottom[xx]
      }
    }

    for (let x = 0; x < width; x += step) {
      if (smoothBottom[x] >= 0) points.push({ x, y: smoothTop[x] })
    }
    for (let x = width - 1; x >= 0; x -= step) {
      if (smoothBottom[x] >= 0) points.push({ x, y: smoothBottom[x] })
    }
  } else {
    const left = new Int32Array(height).fill(width)
    const right = new Int32Array(height).fill(-1)

    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        if (data[row + x] > 0) {
          if (x < left[y]) left[y] = x
          if (x > right[y]) right[y] = x
        }
      }
    }

    const smoothLeft = new Int32Array(height).fill(width)
    const smoothRight = new Int32Array(height).fill(-1)
    for (let y = 0; y < height; y++) {
      const y1 = Math.max(0, y - closeRadius)
      const y2 = Math.min(height - 1, y + closeRadius)
      for (let yy = y1; yy <= y2; yy++) {
        if (right[yy] < 0) continue
        if (left[yy] < smoothLeft[y]) smoothLeft[y] = left[yy]
        if (right[yy] > smoothRight[y]) smoothRight[y] = right[yy]
      }
    }

    for (let y = 0; y < height; y += step) {
      if (smoothRight[y] >= 0) points.push({ x: smoothLeft[y], y })
    }
    for (let y = height - 1; y >= 0; y -= step) {
      if (smoothRight[y] >= 0) points.push({ x: smoothRight[y], y })
    }
  }

  if (points.length < 3) return Buffer.from(data)

  const polygonPoints = points.map(point => `${point.x},${point.y}`).join(' ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${polygonPoints}" fill="white"/></svg>`
  const envelope = await sharp(Buffer.from(svg)).extractChannel('red').raw().toBuffer()
  for (let i = 0; i < envelope.length; i++) {
    if (data[i] > 0) envelope[i] = 255
  }
  return fillEnclosedHoles(envelope, width, height)
}

/**
 * Composite a rectangle onto the original image.
 * The rect is the padded bounding box, clamped to image bounds.
 */
async function makeRectComposite(
  originalPng: Buffer,
  bbox: BBox,
  padding: number,
  outPath: string,
): Promise<void> {
  const { width, height } = await sharp(originalPng).metadata()
  if (!width || !height) throw new Error('Could not read image dimensions')

  const x  = Math.max(0, bbox.minX - padding)
  const y  = Math.max(0, bbox.minY - padding)
  const x2 = Math.min(width,  bbox.maxX + padding)
  const y2 = Math.min(height, bbox.maxY + padding)

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="${x}" y="${y}" width="${x2 - x}" height="${y2 - y}"
        fill="none" stroke="red" stroke-width="4"/>
</svg>`

  const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer()
  await sharp(originalPng).composite([{ input: overlayPng, blend: 'over' }]).png().toFile(outPath)
}

/**
 * Composite an ellipse onto the original image.
 * The ellipse is sized so its axes pass through the corners of the padded bbox,
 * guaranteeing the entire subject is enclosed (rx = hw*√2, ry = hh*√2).
 */
async function makeEllipseComposite(
  originalPng: Buffer,
  bbox: BBox,
  padding: number,
  outPath: string,
): Promise<void> {
  const { width, height } = await sharp(originalPng).metadata()
  if (!width || !height) throw new Error('Could not read image dimensions')

  const cx = (bbox.minX + bbox.maxX) / 2
  const cy = (bbox.minY + bbox.maxY) / 2
  const hw = (bbox.maxX - bbox.minX) / 2 + padding
  const hh = (bbox.maxY - bbox.minY) / 2 + padding
  // Multiply by √2 so the ellipse passes through the corners of the padded bbox
  const rx = hw * Math.SQRT2
  const ry = hh * Math.SQRT2

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
           fill="none" stroke="red" stroke-width="4"/>
</svg>`

  const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer()
  await sharp(originalPng).composite([{ input: overlayPng, blend: 'over' }]).png().toFile(outPath)
}

/** Wrap potrace.trace in a Promise. */
function traceAsync(
  input: Buffer,
  options: Parameters<typeof potrace.trace>[1],
): Promise<string> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    potrace.trace(input, options as any, (err, svg) => {
      if (err) reject(err)
      else resolve(svg)
    })
  })
}

/**
 * Composite the SVG outline on top of the original PNG.
 * sharp composite requires the overlay to match the base image dimensions,
 * so we re-render the SVG path as a same-size PNG overlay first.
 */
async function makeComposite(
  originalPng: Buffer,
  svgStr: string,
  outPath: string,
): Promise<void> {
  const { width, height } = await sharp(originalPng).metadata()
  if (!width || !height) throw new Error('Could not read image dimensions')

  // Extract the viewBox / width / height from potrace SVG and replace with
  // the same pixel dimensions so the overlay aligns perfectly.
  // potrace emits: <svg xmlns="..." width="Xpt" height="Ypt" viewBox="0 0 X Y">
  // We need an SVG where the coordinate space matches pixel dimensions.
  const pathMatch = svgStr.match(/<path[^>]*\sd="([^"]+)"/)
  if (!pathMatch) throw new Error('No path in SVG — cannot composite')

  const pathData = pathMatch[1]

  // Re-extract viewBox from potrace output to know the coordinate scale
  const vbMatch = svgStr.match(/viewBox="([^"]+)"/)
  const [, , vbW, vbH] = vbMatch ? vbMatch[1].split(' ').map(Number) : [0, 0, width, height]

  // Build a clean overlay SVG: same pixel size as original, scale path to fit
  const scaleX = width / (vbW || width)
  const scaleY = height / (vbH || height)

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <g transform="scale(${scaleX},${scaleY})">
    <path d="${pathData}" fill="none" stroke="red" stroke-width="${3 / scaleX}" />
  </g>
</svg>`

  const overlayPng = await sharp(Buffer.from(overlaySvg))
    .png()
    .toBuffer()

  await sharp(originalPng)
    .composite([{ input: overlayPng, blend: 'over' }])
    .png()
    .toFile(outPath)
}

// ── Per-image pipeline ────────────────────────────────────────────────────────

async function processImage(
  imagePath: string,
  name: string,
): Promise<{ passed: string[]; failed: string[] }> {
  const passed: string[] = []
  const failed: string[] = []
  const out = (suffix: string) => path.join(OUTPUT_DIR, `${name}${suffix}`)

  log(`\n── ${name} ──`)

  const originalPng = fs.readFileSync(imagePath)

  // Step 1: extract alpha channel
  let alphaData: Buffer
  let alphaInfo: sharp.OutputInfo
  try {
    const result = await sharp(originalPng)
      .extractChannel('alpha')
      .raw()
      .toBuffer({ resolveWithObject: true })
    alphaData = result.data
    alphaInfo = result.info

    // Re-encode as PNG for inspection
    await sharp(alphaData, {
      raw: { width: alphaInfo.width, height: alphaInfo.height, channels: 1 },
    })
      .png()
      .toFile(out('-1-alpha.png'))

    log(`  [1] alpha extracted (${alphaInfo.width}×${alphaInfo.height}) → ${name}-1-alpha.png`)
    passed.push(`${name} step 1`)
  } catch (err) {
    log(`  [1] FAILED: ${(err as Error).message}`)
    failed.push(`${name} step 1`)
    return { passed, failed }
  }

  // Step 2: threshold
  let threshData: Buffer
  let threshInfo: sharp.OutputInfo
  try {
    // Note: threshold() on a 1-channel raw input expands to 3-channel output.
    // .grayscale() collapses it back to 1 channel so subsequent steps receive
    // the correct channel count.
    const result = await sharp(alphaData, {
      raw: { width: alphaInfo.width, height: alphaInfo.height, channels: 1 },
    })
      .threshold(1)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    threshData = result.data
    threshInfo = result.info

    await sharp(threshData, {
      raw: { width: threshInfo.width, height: threshInfo.height, channels: threshInfo.channels },
    })
      .png()
      .toFile(out('-2-threshold.png'))

    log(`  [2] threshold(1) applied → ${name}-2-threshold.png`)
    passed.push(`${name} step 2`)
  } catch (err) {
    log(`  [2] FAILED: ${(err as Error).message}`)
    failed.push(`${name} step 2`)
    return { passed, failed }
  }

  if (threshInfo.channels !== 1) {
    log(`  [2] FAILED: expected 1 channel, got ${threshInfo.channels}`)
    failed.push(`${name} step 2`)
    return { passed, failed }
  }

  // Compute bounding box from thresholded alpha. Used for easy rect/ellipse composites.
  const bbox = computeBBox(threshData, threshInfo.width, threshInfo.height)

  // Steps 3-6: per difficulty. Dilation varies, so everything downstream is per-difficulty.
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
    const dilate = DILATE[difficulty]
    const optTolerance = OPT_TOLERANCE[difficulty]

    // Step 3: dilate (and optional erode)
    let dilatedData: Buffer
    let dilatedInfo: sharp.OutputInfo
    try {
      let pipeline = sharp(threshData, {
        raw: { width: threshInfo.width, height: threshInfo.height, channels: 1 },
      }).dilate(dilate)

      if (ERODE > 0) {
        pipeline = pipeline.erode(ERODE)
        log(`  [3/${difficulty}] dilate(${dilate}) + erode(${ERODE}) → ${name}-${difficulty}-3-dilated.png`)
      } else {
        log(`  [3/${difficulty}] dilate(${dilate}) → ${name}-${difficulty}-3-dilated.png`)
      }

      const result = await pipeline.grayscale().raw().toBuffer({ resolveWithObject: true })
      dilatedData = result.data
      dilatedInfo = result.info

      await sharp(dilatedData, {
        raw: { width: dilatedInfo.width, height: dilatedInfo.height, channels: dilatedInfo.channels },
      })
        .png()
        .toFile(out(`-${difficulty}-3-dilated.png`))


      const outsideOnlyData = fillEnclosedHoles(dilatedData, dilatedInfo.width, dilatedInfo.height)
      await sharp(outsideOnlyData, {
        raw: { width: dilatedInfo.width, height: dilatedInfo.height, channels: 1 },
      })
        .png()
        .toFile(out(`-${difficulty}-3b-filled-holes.png`))
      dilatedData = outsideOnlyData
      if (difficulty !== 'hard') {
        const hullData = await makeConcaveHullMask(
          dilatedData,
          dilatedInfo.width,
          dilatedInfo.height,
          CONCAVE_CLOSE[difficulty],
        )
        await sharp(hullData, {
          raw: { width: dilatedInfo.width, height: dilatedInfo.height, channels: 1 },
        })
          .png()
          .toFile(out(`-${difficulty}-3c-concave-hull.png`))
        dilatedData = hullData
        log(`  [3c/${difficulty}] concave hull mask -> ${name}-${difficulty}-3c-concave-hull.png`)
        passed.push(`${name} step 3c/${difficulty}`)
      }
      dilatedInfo = { ...dilatedInfo, channels: 1 }

      log(`  [3b/${difficulty}] enclosed holes filled after dilation -> ${name}-${difficulty}-3b-filled-holes.png`)
      passed.push(`${name} step 3b/${difficulty}`)
      passed.push(`${name} step 3/${difficulty}`)
    } catch (err) {
      log(`  [3/${difficulty}] FAILED: ${(err as Error).message}`)
      failed.push(`${name} step 3/${difficulty}`)
      continue
    }

    // Step 4: negate (what potrace sees)
    let negatedPng: Buffer
    try {
      negatedPng = await sharp(dilatedData, {
        raw: { width: dilatedInfo.width, height: dilatedInfo.height, channels: dilatedInfo.channels },
      })
        .negate()
        .png()
        .toBuffer()

      await sharp(negatedPng).toFile(out(`-${difficulty}-4-negated.png`))

      log(`  [4/${difficulty}] negate → ${name}-${difficulty}-4-negated.png`)
      passed.push(`${name} step 4/${difficulty}`)
    } catch (err) {
      log(`  [4/${difficulty}] FAILED: ${(err as Error).message}`)
      failed.push(`${name} step 4/${difficulty}`)
      continue
    }

    // Step 5: potrace
    let svg: string
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svg = await traceAsync(negatedPng, {
        turdSize: TURD_SIZE,
        turnPolicy: 'minority',   // @types/potrace incorrectly names this turdPolicy
        optTolerance,
        optCurve: false,
        blackOnWhite: true,
      } as any)

      const svgPath = out(`-${difficulty}-5-potrace.svg`)
      fs.writeFileSync(svgPath, svg)

      const hasPath = /<path/.test(svg) && svg.match(/<path[^>]*\sd="([^"]+)"/)
      log(`  [5/${difficulty}] potrace (dilate=${dilate} optTolerance=${optTolerance}) → ${name}-${difficulty}-5-potrace.svg${hasPath ? '' : ' ⚠ NO PATH'}`)
      passed.push(`${name} step 5/${difficulty}`)
    } catch (err) {
      log(`  [5/${difficulty}] FAILED: ${(err as Error).message}`)
      failed.push(`${name} step 5/${difficulty}`)
      continue
    }

    // Step 6: composite
    try {
      const compositePath = out(`-${difficulty}-6-composite.png`)
      await makeComposite(originalPng, svg, compositePath)
      log(`  [6/${difficulty}] composite → ${name}-${difficulty}-6-composite.png`)
      passed.push(`${name} step 6/${difficulty}`)
    } catch (err) {
      log(`  [6/${difficulty}] FAILED: ${(err as Error).message}`)
      failed.push(`${name} step 6/${difficulty}`)
    }

    // Steps 6b & 6c (easy only): rect and ellipse composites as alternative easy cut lines
    if (difficulty === 'easy' && bbox) {
      try {
        await makeRectComposite(originalPng, bbox, DILATE.easy, out('-easy-6b-rect.png'))
        log(`  [6b/easy] rect composite → ${name}-easy-6b-rect.png`)
        passed.push(`${name} step 6b/easy`)
      } catch (err) {
        log(`  [6b/easy] FAILED: ${(err as Error).message}`)
        failed.push(`${name} step 6b/easy`)
      }

      try {
        await makeEllipseComposite(originalPng, bbox, DILATE.easy, out('-easy-6c-ellipse.png'))
        log(`  [6c/easy] ellipse composite → ${name}-easy-6c-ellipse.png`)
        passed.push(`${name} step 6c/easy`)
      } catch (err) {
        log(`  [6c/easy] FAILED: ${(err as Error).message}`)
        failed.push(`${name} step 6c/easy`)
      }
    }
  }

  return { passed, failed }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('testOutline.ts — cutting outline pipeline debugger')
  log(`Parameters: DILATE easy=${DILATE.easy} medium=${DILATE.medium} hard=${DILATE.hard} | ERODE=${ERODE} TURD_SIZE=${TURD_SIZE}`)
  log(`OPT_TOLERANCE: easy=${OPT_TOLERANCE.easy} medium=${OPT_TOLERANCE.medium} hard=${OPT_TOLERANCE.hard}`)
  log(`Input:  ${INPUT_DIR}`)
  log(`Output: ${OUTPUT_DIR}`)

  if (!fs.existsSync(INPUT_DIR)) {
    log(`\nERROR: input folder does not exist: ${INPUT_DIR}`)
    process.exit(1)
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const pngs = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith('.png'))
  if (pngs.length === 0) {
    log('\nNo PNG files found in test-images/. Drop some transparent PNGs there and re-run.')
    process.exit(0)
  }

  log(`\nFound ${pngs.length} image(s): ${pngs.join(', ')}`)

  const allPassed: string[] = []
  const allFailed: string[] = []

  for (const file of pngs) {
    const name = path.basename(file, '.png')
    const imagePath = path.join(INPUT_DIR, file)
    try {
      const { passed, failed } = await processImage(imagePath, name)
      allPassed.push(...passed)
      allFailed.push(...failed)
    } catch (err) {
      log(`\nUnexpected error processing ${file}: ${(err as Error).message}`)
      allFailed.push(`${name} (unexpected)`)
    }
  }

  log('\n── Summary ──────────────────────────────────────────────────────────────')
  log(`Passed: ${allPassed.length}   Failed: ${allFailed.length}`)
  if (allFailed.length > 0) {
    log('\nFailed steps:')
    for (const f of allFailed) log(`  ✗ ${f}`)
  } else {
    log('All steps passed.')
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`)
  process.exit(1)
})
