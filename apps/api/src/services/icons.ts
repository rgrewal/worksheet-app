import sharp from 'sharp'
import type { Icon } from '@worksheet/shared'
import logger from '../lib/logger.js'
import { isOfflineMode } from '../lib/offline.js'
import { requireFalApiKey } from '../lib/fal.js'
import { getPlaceholderDataUrl, placeholderSourceFor } from './placeholders.js'

const memoryCache = new Map<string, string>()

/** Worksheets that embed an icon resolved by this service. Selects the offline placeholder. */
export type IconWorkflow = 'maze' | 'word-search'

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

/**
 * Resolves the icon for a worksheet.
 *
 *   offline mode          → the "<workflow> user uploaded / system generated" placeholder
 *   reference photo given → the photo itself, no API call
 *   otherwise             → cache → built-in → fal.ai text-to-image (requires FAL_API_KEY)
 */
export async function fetchOrGenerateIcon(
  workflow: IconWorkflow,
  interest: string,
  referenceImageDataUrl?: string,
  options?: IconGenerationOptions,
): Promise<Icon> {
  const base = normalise(interest)

  if (isOfflineMode()) {
    const source = placeholderSourceFor(referenceImageDataUrl)
    logger.info({ workflow, source, interest: base }, 'icons: offline mode — using placeholder')
    const url = await getPlaceholderDataUrl(workflow, source)
    return { url, label: base, cached: false }
  }

  if (referenceImageDataUrl) {
    logger.info({ interest, refByteLength: referenceImageDataUrl.length }, 'icons: using reference image directly as icon')
    return { url: referenceImageDataUrl, label: interest, cached: false }
  }

  const key = options?.cacheKeySuffix ? `${base}:${options.cacheKeySuffix}` : base

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

/**
 * Calls Ideogram via fal.ai. Throws FalApiKeyMissingError when no key is set
 * and propagates any API failure — the route turns both into a 500 rather
 * than silently shipping a worksheet with a stand-in icon.
 */
async function generateIconWithText(interest: string, options?: IconGenerationOptions): Promise<string> {
  const apiKey = requireFalApiKey()

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

const BUILTIN_ICONS: Record<string, string> = {}

export function clearCacheForTesting(): void {
  memoryCache.clear()
}
