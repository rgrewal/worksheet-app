import sharp from 'sharp'
import potrace from 'potrace'
import type { DifficultyLevel } from '@worksheet/shared'
import logger from '../lib/logger.js'

function optToleranceForDifficulty(difficulty: DifficultyLevel): number {
  switch (difficulty) {
    case 'easy':   return 1.0   // few points, smooth blob-like outline
    case 'medium': return 0.4
    case 'hard':   return 0.1   // hugs all detail, many direction changes
  }
}

export async function generateCuttingOutline(
  pngBuffer: Buffer,
  difficulty: DifficultyLevel,
): Promise<string> {
  // Extract alpha channel as a binary bitmap using sharp
  const { data, info } = await sharp(pngBuffer)
    .extractChannel('alpha')
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true })

  // Re-encode as greyscale PNG so potrace/Jimp can read it.
  // Negate: threshold gives opaque→255, transparent→0.
  // potrace blackOnWhite=true traces black pixels, so invert: opaque→black.
  const greyscalePng = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .negate()
    .png()
    .toBuffer()

  const optTolerance = optToleranceForDifficulty(difficulty)
  logger.debug({ width: info.width, height: info.height, difficulty, optTolerance }, 'outline: tracing with potrace')

  const svg = await new Promise<string>((resolve, reject) => {
    potrace.trace(greyscalePng, {
      turdSize:     5,
      turdPolicy:   'minority',
      optTolerance,
      blackOnWhite: true,
    }, (err, svgStr) => {
      if (err) reject(err)
      else resolve(svgStr)
    })
  })

  const match = svg.match(/<path[^>]*\sd="([^"]+)"/)
  if (!match) throw new Error('outline: potrace returned no path element')

  logger.debug({ dLength: match[1].length }, 'outline: path extracted')
  return match[1]
}
