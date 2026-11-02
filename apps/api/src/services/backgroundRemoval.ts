import sharp from 'sharp'
import { fal } from '@fal-ai/client'
import logger from '../lib/logger.js'
import { isOfflineMode } from '../lib/offline.js'
import { requireFalApiKey } from '../lib/fal.js'
import { InvalidImageError } from '../lib/errors.js'
import { getPlaceholderPng } from './placeholders.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const OPTS = {
  alphaThreshold: 16,
  transparencySampleMaxEdgePx: 1600,
  // If this fraction of all pixels are transparent → image already has bg removed
  transparentPixelRatioToSkipFal: 0.01,
  // If this fraction of border pixels are transparent → confirms subject is centred
  transparentBorderRatioToSkipFal: 0.1,
  paddingRatio: 0.08,
  minPaddingPx: 24,
  maxPaddingPx: 160,
  maxOutputDimensionPx: 1800,
}

type BirefnetResult = { image?: { url: string } }
type AlphaBounds = { left: number; top: number; width: number; height: number }

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Accepts a base64 data URL from the user's upload, removes the background
 * if the image doesn't already have meaningful transparency, then crops to
 * the subject bounding box and adds padding.  Returns a transparent-background
 * PNG buffer ready for cutting-outline tracing.
 *
 * Offline mode cannot remove backgrounds, so it only accepts uploads that are
 * already transparent (anything else is a 400) and then substitutes the
 * "cutting user uploaded" placeholder for the photo.
 */
export async function prepareReferenceImageFromDataUrl(dataUrl: string): Promise<Buffer> {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx === -1) throw new Error('backgroundRemoval: malformed data URL')

  const header   = dataUrl.slice(0, commaIdx)
  const b64      = dataUrl.slice(commaIdx + 1)
  const mimeMatch = header.match(/data:([^;]+);/)
  const mimeType = mimeMatch?.[1] ?? 'image/png'
  const imageBuffer = Buffer.from(b64, 'base64')

  logger.info({ mimeType, byteLength: imageBuffer.length }, 'backgroundRemoval: starting')

  if (isOfflineMode()) {
    if (!(await hasMeaningfulTransparency(imageBuffer))) {
      logger.warn('backgroundRemoval: offline mode — rejecting upload without a transparent background')
      throw new InvalidImageError(
        'Offline mode requires a cutting image with a transparent background',
        'Background removal needs fal.ai, which is unavailable in offline mode. Upload a PNG with a transparent background instead.',
      )
    }
    logger.info('backgroundRemoval: offline mode — upload is transparent, using placeholder')
    return getPlaceholderPng('cutting', 'user-uploaded')
  }

  if (await hasMeaningfulTransparency(imageBuffer)) {
    logger.info('backgroundRemoval: image already transparent — skipping fal.ai')
    return normalizeTransparentSubjectPng(imageBuffer)
  }

  logger.info('backgroundRemoval: removing background with fal-ai/birefnet/v2')
  const withoutBg = await removeBackground(imageBuffer, mimeType)
  return normalizeTransparentSubjectPng(withoutBg)
}

// ─── Transparency detection ───────────────────────────────────────────────────

async function hasMeaningfulTransparency(imageBuffer: Buffer): Promise<boolean> {
  const metadata = await sharp(imageBuffer).metadata()
  if (!metadata.hasAlpha) return false

  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .resize({
      width:  OPTS.transparencySampleMaxEdgePx,
      height: OPTS.transparencySampleMaxEdgePx,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true })

  let transparentPixels       = 0
  let transparentBorderPixels = 0
  let borderPixels            = 0
  const pixels      = info.width * info.height
  const borderWidth = Math.max(1, Math.round(Math.min(info.width, info.height) * 0.02))

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alphaIdx     = (y * info.width + x) * info.channels + info.channels - 1
      const isTransparent = data[alphaIdx] < 255 - OPTS.alphaThreshold
      const isBorder      =
        x < borderWidth || y < borderWidth ||
        x >= info.width - borderWidth || y >= info.height - borderWidth

      if (isTransparent)              transparentPixels++
      if (isBorder)                   borderPixels++
      if (isTransparent && isBorder)  transparentBorderPixels++
    }
  }

  const transparentRatio       = transparentPixels / pixels
  const transparentBorderRatio = transparentBorderPixels / borderPixels

  logger.debug({ transparentRatio, transparentBorderRatio }, 'backgroundRemoval: transparency check')

  return (
    transparentRatio       >= OPTS.transparentPixelRatioToSkipFal &&
    transparentBorderRatio >= OPTS.transparentBorderRatioToSkipFal
  )
}

// ─── Background removal ───────────────────────────────────────────────────────

async function removeBackground(imageBuffer: Buffer, mimeType: string): Promise<Buffer> {
  const apiKey = requireFalApiKey()

  fal.config({ credentials: apiKey })

  const blob     = new Blob([new Uint8Array(imageBuffer)], { type: mimeType }) as unknown as globalThis.Blob
  const imageUrl = await fal.storage.upload(blob)
  logger.debug({ imageUrl }, 'backgroundRemoval: uploaded to fal.ai storage')

  const result = await fal.subscribe('fal-ai/birefnet/v2', {
    input: {
      image_url:            imageUrl,
      model:                'General Use (Light)',
      operating_resolution: '1024x1024',
      output_format:        'png',
      refine_foreground:    true,
    },
  })

  const data = result.data as BirefnetResult
  if (!data.image?.url) throw new Error('fal-ai/birefnet/v2 did not return an image URL')

  logger.debug({ outputUrl: data.image.url }, 'backgroundRemoval: birefnet result ready')

  const res = await fetch(data.image.url)
  if (!res.ok) throw new Error(`backgroundRemoval: download failed ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Normalisation ────────────────────────────────────────────────────────────

async function normalizeTransparentSubjectPng(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const bounds = findAlphaBounds(data, info.width, info.height, info.channels)
  if (!bounds) throw new Error('backgroundRemoval: no visible subject found in image')

  const subjectBuffer = await sharp(input).ensureAlpha().extract(bounds).png().toBuffer()

  const subjectMaxDimension = Math.max(bounds.width, bounds.height)
  const padding = clamp(
    Math.round(subjectMaxDimension * OPTS.paddingRatio),
    OPTS.minPaddingPx,
    OPTS.maxPaddingPx,
  )

  const canvasWidth  = bounds.width  + padding * 2
  const canvasHeight = bounds.height + padding * 2

  const composed = await sharp({
    create: {
      width:      canvasWidth,
      height:     canvasHeight,
      channels:   4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: subjectBuffer, left: padding, top: padding }])
    .png()
    .toBuffer()

  const maxDimension = Math.max(canvasWidth, canvasHeight)
  if (maxDimension <= OPTS.maxOutputDimensionPx) return composed

  const scale = OPTS.maxOutputDimensionPx / maxDimension
  return sharp(composed)
    .resize({
      width:  Math.max(1, Math.round(canvasWidth  * scale)),
      height: Math.max(1, Math.round(canvasHeight * scale)),
      fit: 'fill',
    })
    .png()
    .toBuffer()
}

function findAlphaBounds(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): AlphaBounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + channels - 1]
      if (alpha <= OPTS.alphaThreshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < minX || maxY < minY) return null

  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
