import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'
import type { WorksheetSpec, Icon } from '@worksheet/shared'
import logger from '../lib/logger.js'
import { getCornerImage } from './cornerImages.js'
import type { CuttingOutlineResult } from './outline.js'

interface GapPosition {
  svgX: number
  svgY: number
}

interface BuildPdfOptions {
  spec: WorksheetSpec
  icon: Icon
  activitySvg: string
  activityLabels?: {
    svgW: number
    svgH: number
    entryGap?: GapPosition
    clearing?: { svgX: number; svgY: number; svgSize: number }
    showFinishLabel?: boolean
  }
}

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2
const ICON_SIZE = 120

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FONT_NUNITO = path.join(__dirname, '..', 'fonts', 'Nunito-Bold.ttf')

// ─── Resolve icon to a buffer before opening the PDF stream ───────────────────
// PDFKit is stream-based; all async work must finish before we touch the doc.

async function resolveIconBuffer(icon: Icon): Promise<Buffer | null> {
  if (icon.url.startsWith('data:image/svg+xml')) {
    logger.debug('pdf: icon is SVG data URL — will render via SVGtoPDF')
    return null
  }
  if (icon.url.startsWith('data:image/')) {
    // Reference photo uploaded by user — decode base64 directly to buffer
    const base64 = icon.url.split(',')[1]
    if (!base64) {
      logger.error({ urlPreview: icon.url.slice(0, 60) }, 'pdf: malformed image data URL')
      return null
    }
    const buf = Buffer.from(base64, 'base64')
    logger.info({ byteLength: buf.length }, 'pdf: decoded reference image from data URL')
    return buf
  }
  if (icon.url.startsWith('http://') || icon.url.startsWith('https://')) {
    logger.info({ url: icon.url }, 'pdf: downloading icon buffer')
    const res = await fetch(icon.url)
    if (!res.ok) {
      logger.error({ status: res.status, url: icon.url }, 'pdf: icon download failed')
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    logger.info({ byteLength: buf.length, url: icon.url }, 'pdf: icon buffer downloaded')
    return buf
  }
  logger.warn({ urlPreview: icon.url.slice(0, 60) }, 'pdf: unrecognised icon URL scheme — skipping')
  return null
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildPdf(opts: BuildPdfOptions): Promise<Buffer> {
  const { spec, icon, activitySvg, activityLabels } = opts

  // Resolve async work before touching PDFKit
  const iconBuffer = await resolveIconBuffer(icon)
  const isSvgIcon  = icon.url.startsWith('data:image/svg+xml')

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      info: {
        Title: `${spec.interest} ${spec.activity} worksheet`,
        Author: 'WorksheetApp',
      },
    })

    const chunks: Uint8Array[] = []
    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.from(Buffer.concat(chunks))))
    doc.on('error', reject)

    // Register Nunito, fall back to Helvetica if file is missing
    let titleFont = 'Helvetica-Bold'
    try {
      doc.registerFont('Nunito-Bold', FONT_NUNITO)
      titleFont = 'Nunito-Bold'
    } catch {
      // font file not found — Helvetica keeps things running
    }

    let cursor = MARGIN

    // ── Corner illustration — top-right, entirely within the top margin ────
    // Sits from y=4 to y=48 (the margin boundary), so it never crowds content.

    const CORNER_SIZE = 44
    const cornerSvg = getCornerImage(spec.interest)
    SVGtoPDF(doc, cornerSvg, PAGE_W - MARGIN - CORNER_SIZE, 4, {
      width: CORNER_SIZE,
      height: CORNER_SIZE,
    })

    // ── Title ──────────────────────────────────────────────────────────────

    const activityWord = capitalise(spec.activity)
    const title = spec.childName
      ? `${capitalise(spec.childName)}'s Adventure ${activityWord}: ${capitalise(spec.interest)}`
      : `Adventure ${activityWord}: ${capitalise(spec.interest)}`

    doc
      .fontSize(22)
      .font(titleFont)
      .fillColor('#111111')
      .text(title, MARGIN, cursor, { width: CONTENT_W, align: 'center' })

    cursor += 32

    // ── Divider ────────────────────────────────────────────────────────────

    doc
      .moveTo(MARGIN, cursor)
      .lineTo(PAGE_W - MARGIN, cursor)
      .lineWidth(1)
      .strokeColor('#cccccc')
      .stroke()

    cursor += 16

    // ── Activity SVG ───────────────────────────────────────────────────────
    // Maze fills the full content width. Gap is sized to balance whitespace
    // above (page-top → maze-top) and below (maze-bottom → page-bottom).
    // With mazeSize = 516: (792 − 516) / 2 = 138; gap = 138 − 96 = 42 pt.

    cursor += 42

    const remainingH = PAGE_H - cursor - MARGIN
    const mazeSize   = Math.min(CONTENT_W, remainingH)
    const mazeX      = MARGIN

    SVGtoPDF(doc, activitySvg, mazeX, cursor, {
      width: mazeSize,
      height: mazeSize,
      preserveAspectRatio: 'xMidYMid meet',
    })

    // ── Labels + icon ──────────────────────────────────────────────────────
    // Recompute the SVG→PDF transform that svg-to-pdfkit applied with 'meet'.

    if (activityLabels) {
      const { svgW, svgH, entryGap, clearing } = activityLabels

      const scale   = Math.min(mazeSize / svgW, mazeSize / svgH)
      const xOffset = (mazeSize - svgW * scale) / 2
      const yOffset = (mazeSize - svgH * scale) / 2

      // ── "Start >" label flush against the entry wall ────────────────────

      if (entryGap) {
        const entryPdfX = mazeX + xOffset + entryGap.svgX * scale
        const entryPdfY = cursor + yOffset + entryGap.svgY * scale

        logger.debug({ x: entryPdfX.toFixed(1), y: entryPdfY.toFixed(1) }, 'pdf: entry gap position')

        const labelSize = 13
        const labelGap  = 4
        const pageEdge  = 4

        doc
          .font(titleFont).fontSize(labelSize).fillColor('#111111')
          .text(
            'Start >',
            pageEdge,
            entryPdfY - labelSize * 0.35,
            { width: entryPdfX - pageEdge - labelGap, align: 'right', lineBreak: false }
          )
      }

      // ── Icon centred in the clearing ─────────────────────────────────────
      // The clearing is an open room; the icon fills ~85% of it with padding
      // on each side so it never touches the surrounding maze walls.

      if (clearing) {
        const clearPdfX    = mazeX + xOffset + clearing.svgX * scale
        const clearPdfY    = cursor + yOffset + clearing.svgY * scale
        const clearPdfSize = clearing.svgSize * scale

        // ── "Finish" label centred at top of clearing (maze only) ──────────
        const finishSize = 13
        if (activityLabels.showFinishLabel) {
          doc
            .font(titleFont).fontSize(finishSize).fillColor('#111111')
            .text(
              'Finish',
              clearPdfX,
              clearPdfY + 4,
              { width: clearPdfSize, align: 'center', lineBreak: false }
            )
        }

        // ── Compute icon position ─────────────────────────────────────────
        const ICON_PAD    = 0.075
        const labelBottom = clearPdfY + 4 + finishSize + 4

        const iconSize = ICON_SIZE
        const iconRendW = iconSize
        const iconRendH = iconSize
        const iconX = clearPdfX + (clearPdfSize - iconSize) / 2
        const iconY = Math.max(clearPdfY + clearPdfSize * ICON_PAD, labelBottom)

        logger.debug({ x: clearPdfX.toFixed(1), y: clearPdfY.toFixed(1), size: clearPdfSize.toFixed(1) }, 'pdf: clearing position')

        if (isSvgIcon) {
          logger.debug({ iconX, iconY, iconRendW, iconRendH }, 'pdf: embedding SVG icon into clearing')
          const svgStr = Buffer.from(icon.url.split(',')[1], 'base64').toString('utf8')
          SVGtoPDF(doc, svgStr, iconX, iconY, { width: iconRendW, height: iconRendH })
          logger.debug('pdf: SVG icon embedded')
        } else if (iconBuffer) {
          logger.debug({ iconX, iconY, iconRendW, iconRendH, byteLength: iconBuffer.length }, 'pdf: embedding raster icon into clearing')
          try {
            doc.image(iconBuffer, iconX, iconY, { width: iconRendW, height: iconRendH })
            logger.debug('pdf: raster icon embedded')
          } catch (err) {
            logger.error({ err }, 'pdf: failed to embed raster icon into clearing')
          }
        } else {
          logger.warn({ isSvgIcon, hasBuffer: !!iconBuffer }, 'pdf: no icon to embed in clearing — icon will be blank')
        }

      }
    }

    // ── Footer ─────────────────────────────────────────────────────────────

    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#aaaaaa')
      .text('worksheetapp.com', MARGIN, PAGE_H - MARGIN + 8, {
        width: CONTENT_W,
        align: 'center',
      })

    doc.end()
  })
}

// ─── Cutting PDF builder ──────────────────────────────────────────────────────

export async function buildCuttingPdf(opts: {
  spec: WorksheetSpec
  pngBuffer: Buffer
  outline: CuttingOutlineResult
}): Promise<Buffer> {
  const { spec, pngBuffer, outline } = opts

  // Pre-compute image dimensions before opening the PDFKit stream
  let imgW = 0
  let imgH = 0
  try {
    const meta = await sharp(pngBuffer).metadata()
    imgW = meta.width ?? 0
    imgH = meta.height ?? 0
  } catch (err) {
    logger.warn({ err }, 'buildCuttingPdf: could not read image dimensions')
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      info: {
        Title: `${spec.interest} cutting worksheet`,
        Author: 'WorksheetApp',
      },
    })

    const chunks: Uint8Array[] = []
    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.from(Buffer.concat(chunks))))
    doc.on('error', reject)

    let titleFont = 'Helvetica-Bold'
    try {
      doc.registerFont('Nunito-Bold', FONT_NUNITO)
      titleFont = 'Nunito-Bold'
    } catch {
      // font file not found — Helvetica keeps things running
    }

    let cursor = MARGIN

    // ── Corner illustration ────────────────────────────────────────────────
    const CORNER_SIZE = 44
    const cornerSvg = getCornerImage(spec.interest)
    SVGtoPDF(doc, cornerSvg, PAGE_W - MARGIN - CORNER_SIZE, 4, {
      width: CORNER_SIZE,
      height: CORNER_SIZE,
    })

    // ── Title ──────────────────────────────────────────────────────────────
    const title = spec.childName
      ? `${capitalise(spec.childName)}'s Cutting: ${capitalise(spec.interest)}`
      : `Cutting: ${capitalise(spec.interest)}`

    doc
      .fontSize(22)
      .font(titleFont)
      .fillColor('#111111')
      .text(title, MARGIN, cursor, { width: CONTENT_W, align: 'center' })

    cursor += 32

    // ── Divider ────────────────────────────────────────────────────────────
    doc
      .moveTo(MARGIN, cursor)
      .lineTo(PAGE_W - MARGIN, cursor)
      .lineWidth(1)
      .strokeColor('#cccccc')
      .stroke()

    cursor += 16

    // ── Image centered in remaining space ──────────────────────────────────
    const FOOTER_TOP = PAGE_H - MARGIN
    const PAD = 24
    const maxW = CONTENT_W - PAD * 2
    const maxH = FOOTER_TOP - cursor - PAD * 2

    let rendW = maxW
    let rendH = maxH
    if (imgW > 0 && imgH > 0) {
      const s = Math.min(maxW / imgW, maxH / imgH)
      rendW = imgW * s
      rendH = imgH * s
    }

    const imgX = MARGIN + PAD + (maxW - rendW) / 2
    const imgY = cursor + PAD + (maxH - rendH) / 2

    doc.image(pngBuffer, imgX, imgY, { width: rendW, height: rendH })

    // ── Dashed cutting outline ─────────────────────────────────────────────
    if (imgW > 0 && imgH > 0) {
      const s = rendW / imgW
      const scaledD = outline.pathData.replace(/([-\d.]+)\s+([-\d.]+)/g, (_m: string, xs: string, ys: string) => {
        const x = imgX + parseFloat(xs) * s
        const y = imgY + parseFloat(ys) * s
        return `${x.toFixed(2)} ${y.toFixed(2)}`
      })
      doc.save()
      doc.path(scaledD)
        .dash(outline.dash * s, { space: outline.gap * s })
        .lineWidth(outline.strokePx * s)
        .stroke('#333333')
      doc.restore()
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#aaaaaa')
      .text('worksheetapp.com', MARGIN, PAGE_H - MARGIN + 8, {
        width: CONTENT_W,
        align: 'center',
      })

    doc.end()
  })
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
