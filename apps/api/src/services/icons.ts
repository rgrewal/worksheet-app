import sharp from 'sharp'
import type { Icon } from '@worksheet/shared'
import logger from '../lib/logger.js'

const memoryCache = new Map<string, string>()

export interface IconGenerationOptions {
  prompt?: string
  negativePrompt?: string
  styleType?: string
  magicPrompt?: boolean
  /** Use generate-transparent endpoint and trim transparent borders with sharp */
  removeBackground?: boolean
  /** Appended to the cache key so activity-specific prompts don't share entries */
  cacheKeySuffix?: string
  rendering_speed?: string
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function fetchOrGenerateIcon(
  interest: string,
  referenceImageDataUrl?: string,
  options?: IconGenerationOptions,
): Promise<Icon> {
  if (referenceImageDataUrl) {
    logger.info({ interest, refByteLength: referenceImageDataUrl.length }, 'icons: using reference image directly as icon')
    return { url: referenceImageDataUrl, label: interest, cached: false }
  }

  const base = normalise(interest)
  const key  = options?.cacheKeySuffix ? `${base}:${options.cacheKeySuffix}` : base

  const cached = memoryCache.get(key)
  if (cached) {
    logger.info({ key }, 'icons: cache hit')
    return { url: cached, label: base, cached: true }
  }

  const builtin = BUILTIN_ICONS[base]
  if (builtin && !options?.prompt) {
    logger.info({ key }, 'icons: builtin icon hit')
    memoryCache.set(key, builtin)
    return { url: builtin, label: base, cached: true }
  }

  logger.info({ key }, 'icons: generating with text-to-image')
  const url = await generateIconWithText(base, options)
  memoryCache.set(key, url)
  return { url, label: base, cached: false }
}

// ─── Text-to-image ────────────────────────────────────────────────────────────

async function generateIconWithText(interest: string, options?: IconGenerationOptions): Promise<string> {
  const apiKey = process.env.FAL_API_KEY
  if (!apiKey) {
    logger.warn('icons: FAL_API_KEY not set — using placeholder')
    return placeholderSvg(interest)
  }

  const prompt = options?.prompt ??
    `Simple black and white line drawing of a ${interest}, ` +
    `clipart style, white background, no shading, no color, ` +
    `thick clean outlines, child-friendly, suitable for a kids worksheet`

  const useTransparent = options?.removeBackground === true

  const endpoint = useTransparent
    ? 'https://fal.run/fal-ai/ideogram/v3/generate-transparent'
    : 'https://fal.run/fal-ai/ideogram/v3'

  const body: Record<string, unknown> = {
    prompt,
    style_type: options?.styleType ?? 'ILLUSTRATION',
    rendering_speed: 'BALANCED',
  }
  if (options?.negativePrompt) body.negative_prompt = options.negativePrompt
  if (options?.magicPrompt === false) body.magic_prompt_option = 'OFF'

  try {
    logger.info({ interest, endpoint }, 'icons: starting text-to-image job')
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ideogram ${res.status}: ${text}`)
    }

    const data = await res.json() as { images: { url: string }[] }
    const generatedUrl = data.images[0].url
    logger.info({ generatedUrl }, 'icons: text-to-image response received')

    if (useTransparent) {
      return await trimTransparentBorders(generatedUrl)
    }

    return generatedUrl
  } catch (err) {
    logger.error({ err }, 'icons: text-to-image failed')
    return placeholderSvg(interest)
  }
}

// ─── Trim transparent borders from a transparent PNG ─────────────────────────

async function trimTransparentBorders(imageUrl: string): Promise<string> {
  try {
    logger.info('icons: trimming transparent borders')
    const res = await fetch(imageUrl)
    const buf = Buffer.from(await res.arrayBuffer())
    const trimmed = await sharp(buf).trim({ threshold: 10 }).toBuffer()
    logger.info('icons: transparent borders trimmed')
    return `data:image/png;base64,${trimmed.toString('base64')}`
  } catch (err) {
    logger.error({ err }, 'icons: trim failed — using original URL')
    return imageUrl
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
