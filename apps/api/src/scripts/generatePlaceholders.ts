/**
 * Regenerates the offline-mode placeholder images in src/assets/placeholders/.
 *
 * Usage (from apps/api):
 *   npx tsx src/scripts/generatePlaceholders.ts
 *
 * The placeholders are committed as static PNGs so that the API never needs a
 * system font at runtime (sharp/librsvg can only rasterise <text> when
 * fontconfig finds a font). Re-run this script after changing the design.
 *
 * Design goals:
 *   - Every image states the workflow (maze / word search / cutting) and the
 *     source (user uploaded / system generated) it stands in for.
 *   - Maze and word-search placeholders are opaque and carry a thick border,
 *     coloured corner markers, a centre crosshair and a circle. The border
 *     shows exactly where the image edge lands on the page; the circle turns
 *     into an ellipse if the image is stretched non-uniformly; the corner
 *     colours reveal flips or rotation.
 *   - Cutting placeholders have NO border. They are a filled circle on a
 *     transparent background so the traced cutting outline can be judged
 *     against a known shape (it should be a concentric circle).
 *   - "User uploaded" variants are non-square (4:3, like a photo) so that any
 *     layout code that assumes square input is caught. "System generated"
 *     variants are 1024×1024, the default size returned by Ideogram.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'placeholders')

type Workflow = 'maze' | 'word-search' | 'cutting'
type Source   = 'user-uploaded' | 'system-generated'

const WORKFLOW_LABEL: Record<Workflow, string> = {
  'maze':        'MAZE',
  'word-search': 'WORD SEARCH',
  'cutting':     'CUTTING',
}

const SOURCE_LABEL: Record<Source, string> = {
  'user-uploaded':    'USER UPLOADED',
  'system-generated': 'SYSTEM GENERATED',
}

// Distinct fill per variant so the six images are telling apart at a glance.
const FILL: Record<`${Workflow}-${Source}`, string> = {
  'maze-user-uploaded':            '#ffe3e3',
  'maze-system-generated':         '#e3f0ff',
  'word-search-user-uploaded':     '#fff4d6',
  'word-search-system-generated':  '#e6f7e6',
  'cutting-user-uploaded':         '#ffd166',
  'cutting-system-generated':      '#8ecae6',
}

const FONT = 'font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="bold"'

// ─── Shared text block ────────────────────────────────────────────────────────

/** Approximate advance width of a bold upper-case sans glyph, as a fraction of font-size. */
const GLYPH_W = 0.78

/** Largest font-size at which `text` fits within `maxWidth`, capped at `preferred`. */
function fitFont(text: string, maxWidth: number, preferred: number): number {
  return Math.round(Math.min(preferred, maxWidth / (text.length * GLYPH_W)))
}

/** Four centred lines of text sized to fit inside the circle they sit in. */
function textBlock(cx: number, cy: number, circleDiameter: number, workflow: Workflow, source: Source, w: number, h: number): string {
  const maxWidth = circleDiameter * 0.82
  const line1 = WORKFLOW_LABEL[workflow]
  const line2 = SOURCE_LABEL[source]
  const line3 = 'OFFLINE PLACEHOLDER'
  const line4 = `${w} × ${h}`

  const big   = fitFont(line1, maxWidth, circleDiameter * 0.15)
  const mid   = fitFont(line2, maxWidth, circleDiameter * 0.09)
  const small = fitFont(line3, maxWidth, circleDiameter * 0.06)

  // Baselines, laid out around the vertical centre
  const y1 = cy - mid * 0.9
  const y2 = cy + mid * 0.9
  const y3 = y2 + small * 1.8
  const y4 = y3 + small * 1.4

  return `
    <text x="${cx}" y="${y1}" ${FONT} font-size="${big}"   text-anchor="middle" fill="#111">${line1}</text>
    <text x="${cx}" y="${y2}" ${FONT} font-size="${mid}"   text-anchor="middle" fill="#111">${line2}</text>
    <text x="${cx}" y="${y3}" ${FONT} font-size="${small}" text-anchor="middle" fill="#555">${line3}</text>
    <text x="${cx}" y="${y4}" ${FONT} font-size="${small}" text-anchor="middle" fill="#555">${line4}</text>`
}

// ─── Bordered, opaque placeholder (maze + word search) ────────────────────────

function borderedSvg(w: number, h: number, workflow: Workflow, source: Source): string {
  const cx = w / 2
  const cy = h / 2
  const minDim = Math.min(w, h)
  const border = Math.round(minDim * 0.025)   // outer border stroke
  const corner = Math.round(minDim * 0.09)    // corner marker size
  const r      = Math.round(minDim * 0.40)    // circle radius
  const fill   = FILL[`${workflow}-${source}`]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="${fill}"/>

    <!-- centre crosshair: shows the image centre and reveals cropping -->
    <line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="#999" stroke-width="3" stroke-dasharray="24 12"/>
    <line x1="${cx}" y1="0" x2="${cx}" y2="${h}" stroke="#999" stroke-width="3" stroke-dasharray="24 12"/>

    <!-- circle: becomes an ellipse if the image is stretched -->
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="#111" stroke-width="${Math.round(minDim * 0.012)}"/>

    <!-- corner markers: TL red, TR green, BL blue, BR orange (reveals flips/rotation) -->
    <rect x="0" y="0" width="${corner}" height="${corner}" fill="#e63946"/>
    <rect x="${w - corner}" y="0" width="${corner}" height="${corner}" fill="#2a9d8f"/>
    <rect x="0" y="${h - corner}" width="${corner}" height="${corner}" fill="#3a86ff"/>
    <rect x="${w - corner}" y="${h - corner}" width="${corner}" height="${corner}" fill="#fb8500"/>

    <!-- outer border: drawn inset by half its width so the full stroke is inside the image -->
    <rect x="${border / 2}" y="${border / 2}" width="${w - border}" height="${h - border}" fill="none" stroke="#111" stroke-width="${border}"/>

    ${textBlock(cx, cy, r * 2, workflow, source, w, h)}
  </svg>`
}

// ─── Transparent placeholder (cutting) ───────────────────────────────────────

function cuttingSvg(w: number, h: number, r: number, source: Source): string {
  const cx = w / 2
  const cy = h / 2
  const fill = FILL[`cutting-${source}`]

  // No border and nothing outside the circle: the alpha channel IS the subject.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#111" stroke-width="${Math.round(r * 0.035)}"/>
    ${textBlock(cx, cy, r * 2, 'cutting', source, w, h)}
  </svg>`
}

// ─── Image specs ──────────────────────────────────────────────────────────────

type Spec = { file: string; svg: string; alpha: boolean }

const SPECS: Spec[] = [
  // Ideogram returns 1024×1024 by default
  { file: 'maze-system-generated.png',        svg: borderedSvg(1024, 1024, 'maze',        'system-generated'), alpha: false },
  { file: 'word-search-system-generated.png', svg: borderedSvg(1024, 1024, 'word-search', 'system-generated'), alpha: false },
  // User photos are rarely square — use 4:3 so stretching is detectable
  { file: 'maze-user-uploaded.png',           svg: borderedSvg(1024, 768,  'maze',        'user-uploaded'),    alpha: false },
  { file: 'word-search-user-uploaded.png',    svg: borderedSvg(1024, 768,  'word-search', 'user-uploaded'),    alpha: false },
  // generate-transparent output: subject centred on a 1024×1024 transparent canvas
  { file: 'cutting-system-generated.png',     svg: cuttingSvg(1024, 1024, 350, 'system-generated'),            alpha: true },
  // Output of the user-photo pipeline: subject cropped to its bounds + 8 % padding
  { file: 'cutting-user-uploaded.png',        svg: cuttingSvg(880, 880, 380, 'user-uploaded'),                 alpha: true },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUTPUT_DIR, { recursive: true })

for (const spec of SPECS) {
  let pipeline = sharp(Buffer.from(spec.svg))
  pipeline = spec.alpha ? pipeline.ensureAlpha() : pipeline.flatten({ background: '#ffffff' }).removeAlpha()
  const buffer = await pipeline.png({ compressionLevel: 9, palette: !spec.alpha }).toBuffer()

  const outPath = path.join(OUTPUT_DIR, spec.file)
  fs.writeFileSync(outPath, new Uint8Array(buffer))

  const meta = await sharp(buffer).metadata()
  console.log(`${spec.file.padEnd(34)} ${meta.width}×${meta.height} alpha=${meta.hasAlpha} ${buffer.length} bytes`)
}
