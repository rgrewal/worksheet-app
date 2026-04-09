import type { Icon } from '@worksheet/shared'
import logger from '../lib/logger.js'

const memoryCache = new Map<string, string>()

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function fetchOrGenerateIcon(
  interest: string,
  referenceImageDataUrl?: string
): Promise<Icon> {
  if (referenceImageDataUrl) {
    logger.info({ interest, refByteLength: referenceImageDataUrl.length }, 'icons: using reference image directly as icon')
    return { url: referenceImageDataUrl, label: interest, cached: false }
  }

  const key = normalise(interest)
  const cached = memoryCache.get(key)
  if (cached) {
    logger.info({ key }, 'icons: cache hit')
    return { url: cached, label: key, cached: true }
  }

  const builtin = BUILTIN_ICONS[key]
  if (builtin) {
    logger.info({ key }, 'icons: builtin icon hit')
    memoryCache.set(key, builtin)
    return { url: builtin, label: key, cached: true }
  }

  logger.info({ key }, 'icons: generating with text-to-image')
  const url = await generateIconWithText(key)
  memoryCache.set(key, url)
  return { url, label: key, cached: false }
}

// ─── Text-to-image ────────────────────────────────────────────────────────────

async function generateIconWithText(interest: string): Promise<string> {
  const apiKey = process.env.FAL_API_KEY
  if (!apiKey) {
    logger.warn('icons: FAL_API_KEY not set — using placeholder')
    return placeholderSvg(interest)
  }

  const prompt =
    `Simple black and white line drawing of a ${interest}, ` +
    `clipart style, white background, no shading, no color, ` +
    `thick clean outlines, child-friendly, suitable for a kids worksheet`

  try {
    logger.info({ interest }, 'icons: starting text-to-image job')
    const res = await fetch('https://fal.run/fal-ai/ideogram/v3', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        style_type: 'ILLUSTRATION',
        rendering_speed: 'BALANCED',
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Ideogram ${res.status}: ${body}`)
    }

    const data = await res.json() as { images: { url: string }[] }
    const url = data.images[0].url
    logger.info({ url }, 'icons: text-to-image response received')
    return url
  } catch (err) {
    logger.error({ err }, 'icons: text-to-image failed')
    return placeholderSvg(interest)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalise(interest: string): string {
  return interest.trim().toLowerCase().replace(/\s+/g, '-')
}

function placeholderSvg(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="white"/>
    <rect x="10" y="10" width="180" height="180" rx="8" fill="none" stroke="black" stroke-width="3" stroke-dasharray="8 4"/>
    <text x="100" y="95" font-family="sans-serif" font-size="14" text-anchor="middle" fill="black">${label}</text>
    <text x="100" y="115" font-family="sans-serif" font-size="11" text-anchor="middle" fill="#666">(icon placeholder)</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const BUILTIN_ICONS: Record<string, string> = {}

export function clearCacheForTesting(): void {
  memoryCache.clear()
}
