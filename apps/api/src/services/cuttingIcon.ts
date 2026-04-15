import logger from '../lib/logger.js'

export async function generateCuttingIcon(interest: string): Promise<Buffer> {
  const apiKey = process.env.FAL_API_KEY
  if (!apiKey) throw new Error('FAL_API_KEY is not set')

  const prompt =
    `a single ${interest} on a pure flat white background, bold black outline, ` +
    `cartoon illustration style, subject only, nothing else in the image, ` +
    `full body visible, not cropped, centered, simple, child-friendly`

  const negativePrompt =
    `gradient, shaded background, vignette, environment, scene, motion lines, ` +
    `speed lines, action lines, radial lines, magical effects, runes, rune circle, ` +
    `energy trails, aura, glow, decorative ring, shadows, text, multiple subjects, ` +
    `cropped, sticker, sticker border, white border, drop shadow`

  logger.debug({ interest }, 'cuttingIcon: requesting generate-transparent')

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
    throw new Error(`Ideogram generate-transparent ${res.status}: ${body}`)
  }

  const data = await res.json() as { images: { url: string }[] }
  const imageUrl = data.images[0].url
  logger.debug({ imageUrl }, 'cuttingIcon: image generated, fetching buffer')

  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`cuttingIcon: image fetch failed ${imgRes.status}: ${imageUrl}`)

  const buffer = Buffer.from(await imgRes.arrayBuffer())
  logger.info({ interest, byteLength: buffer.length }, 'cuttingIcon: buffer ready')
  return buffer
}
