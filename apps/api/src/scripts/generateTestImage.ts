/**
 * Generates a test image using the same prompt and endpoint as the cutting
 * worksheet pipeline, and saves the unmodified PNG to test-images/.
 *
 * Usage (from apps/api):
 *   npx tsx src/scripts/generateTestImage.ts <interest>
 *
 * Examples:
 *   npx tsx src/scripts/generateTestImage.ts dinosaur
 *   npx tsx src/scripts/generateTestImage.ts "fire truck"
 *
 * Requires FAL_API_KEY in apps/api/.env (or environment).
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, 'test-images')

const interest = process.argv[2]?.trim()
if (!interest) {
  process.stderr.write('Usage: npx tsx src/scripts/generateTestImage.ts <interest>\n')
  process.exit(1)
}

const apiKey = process.env.FAL_API_KEY
if (!apiKey) {
  process.stderr.write('FAL_API_KEY is not set. Copy apps/api/.env.example to apps/api/.env and add your key.\n')
  process.exit(1)
}

// ── Prompt — identical to cuttingIcon.ts ─────────────────────────────────────

const prompt =
  `a single ${interest} on a pure flat white background, bold black outline, ` +
  `cartoon illustration style, subject only, nothing else in the image, ` +
  `full body visible, not cropped, centered, simple, child-friendly`

const negativePrompt =
  `gradient, shaded background, vignette, environment, scene, motion lines, ` +
  `speed lines, action lines, radial lines, magical effects, runes, rune circle, ` +
  `energy trails, aura, glow, decorative ring, shadows, text, multiple subjects, ` +
  `cropped, sticker, sticker border, white border, drop shadow`

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`Generating test image for: "${interest}"`)
console.log('Endpoint: fal-ai/ideogram/v3/generate-transparent')

const res = await fetch('https://fal.run/fal-ai/ideogram/v3/generate-transparent', {
  method: 'POST',
  headers: {
    'Authorization': `Key ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt,
    negative_prompt: negativePrompt,
    style_type: 'GENERAL',
    magic_prompt: 'OFF',
    rendering_speed: 'QUALITY',
  }),
})

if (!res.ok) {
  const body = await res.text()
  process.stderr.write(`Ideogram API error ${res.status}: ${body}\n`)
  process.exit(1)
}

const data = await res.json() as { images: { url: string }[] }
const imageUrl = data.images[0].url
console.log(`Image URL: ${imageUrl}`)

const imgRes = await fetch(imageUrl)
if (!imgRes.ok) {
  process.stderr.write(`Failed to fetch image ${imgRes.status}: ${imageUrl}\n`)
  process.exit(1)
}

const buffer = Buffer.from(await imgRes.arrayBuffer())

fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const slug = interest.toLowerCase().replace(/\s+/g, '-')
const filename = `${slug}.png`
const outPath = path.join(OUTPUT_DIR, filename)
fs.writeFileSync(outPath, new Uint8Array(buffer))

console.log(`Saved ${buffer.length} bytes → ${outPath}`)
