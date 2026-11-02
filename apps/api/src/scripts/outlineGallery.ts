/**
 * Visual check for the cutting outline.
 *
 * Renders every subject shape used by outline.shapes.test.ts — plus the two
 * offline cutting placeholders and any PNGs dropped into scripts/test-images/ —
 * at all three difficulties, with the cut line drawn exactly as the PDF draws
 * it (same stroke width, dash and gap, in image pixels). Writes one PNG per
 * shape × difficulty and a contact sheet of everything.
 *
 * Usage (from apps/api):
 *   npx tsx src/scripts/outlineGallery.ts            # → test-output/outline-gallery/
 *   pnpm outline:gallery
 *
 * The tests prove the geometry; this is for judging how it looks.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { DifficultyLevel } from '@worksheet/shared'
import { generateCuttingOutline } from '../services/outline.js'
import { SHAPES, shapeSvg } from '../test/outlineShapes.js'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR    = path.resolve(process.cwd(), 'test-output', 'outline-gallery')
const IMAGES_DIR = path.join(__dirname, 'test-images')
const PLACEHOLDERS = path.join(__dirname, '..', 'assets', 'placeholders')

const DIFFICULTIES: DifficultyLevel[] = ['easy', 'medium', 'hard']
const TILE = 360                       // contact-sheet tile size
const SUBJECT_FILL = '#8ecae6'         // subject silhouette colour for the SVG shapes

interface Subject { name: string; png: Buffer }

// ─── Subjects ─────────────────────────────────────────────────────────────────

async function collectSubjects(): Promise<Subject[]> {
  const subjects: Subject[] = []

  for (const shape of SHAPES) {
    // Colour the silhouette so it reads as "the thing being cut out"
    const svg = shapeSvg(shape).replace('<svg ', `<svg fill="${SUBJECT_FILL}" `)
    subjects.push({ name: slug(shape.name), png: await sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer() })
  }

  for (const file of ['cutting-system-generated.png', 'cutting-user-uploaded.png']) {
    subjects.push({ name: `placeholder-${file.replace('.png', '')}`, png: fs.readFileSync(path.join(PLACEHOLDERS, file)) })
  }

  if (fs.existsSync(IMAGES_DIR)) {
    for (const file of fs.readdirSync(IMAGES_DIR).filter(f => f.toLowerCase().endsWith('.png'))) {
      subjects.push({ name: `image-${file.replace(/\.png$/i, '')}`, png: fs.readFileSync(path.join(IMAGES_DIR, file)) })
    }
  }

  return subjects
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Subject on white with the dashed cut line overlaid. The canvas is grown by
 * `pad` on every side because the line sits outside the image bounds.
 */
async function renderComposite(png: Buffer, difficulty: DifficultyLevel, label: string): Promise<Buffer> {
  const meta = await sharp(png).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  const outline = await generateCuttingOutline(png, difficulty)

  const pad = Math.round(Math.max(w, h) * 0.12)
  const W = w + pad * 2
  const H = h + pad * 2

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="${pad}" y="${pad}" width="${w}" height="${h}" fill="none" stroke="#ddd" stroke-width="1" stroke-dasharray="4 4"/>
    <g transform="translate(${pad} ${pad})">
      <path d="${outline.pathData}" fill="none" stroke="#d00" stroke-width="${outline.strokePx}"
            stroke-dasharray="${outline.dash} ${outline.gap}" stroke-linecap="butt" stroke-linejoin="round"/>
    </g>
    <text x="8" y="${H - 8}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(W * 0.03)}" fill="#333">${escapeXml(label)} — ${difficulty} · stroke ${outline.strokePx} dash ${outline.dash}/${outline.gap}</text>
  </svg>`

  return sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
    .composite([
      { input: png, left: pad, top: pad },
      { input: Buffer.from(overlay), left: 0, top: 0 },
    ])
    .png()
    .toBuffer()
}

async function contactSheet(tiles: Buffer[], columns: number): Promise<Buffer> {
  const rows = Math.ceil(tiles.length / columns)
  const resized = await Promise.all(tiles.map(t => sharp(t).resize(TILE, TILE, { fit: 'contain', background: '#fff' }).toBuffer()))
  return sharp({ create: { width: columns * TILE, height: rows * TILE, channels: 3, background: '#bbb' } })
    .composite(resized.map((input, i) => ({ input, left: (i % columns) * TILE, top: Math.floor(i / columns) * TILE })))
    .png()
    .toBuffer()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true })
const subjects = await collectSubjects()
const tiles: Buffer[] = []

for (const subject of subjects) {
  for (const difficulty of DIFFICULTIES) {
    const composite = await renderComposite(subject.png, difficulty, subject.name)
    const file = `${subject.name}-${difficulty}.png`
    fs.writeFileSync(path.join(OUT_DIR, file), new Uint8Array(composite))
    tiles.push(composite)
    console.log(`${file}`)
  }
}

// One row per subject, one column per difficulty
fs.writeFileSync(path.join(OUT_DIR, 'contact-sheet.png'), new Uint8Array(await contactSheet(tiles, DIFFICULTIES.length)))
console.log(`\n${subjects.length} subjects × ${DIFFICULTIES.length} difficulties → ${path.relative(process.cwd(), OUT_DIR)}/ (see contact-sheet.png)`)

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
