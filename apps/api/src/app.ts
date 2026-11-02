import { execSync } from 'child_process'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'
import { WorksheetSpec, WORD_SEARCH_DIFFICULTY } from '@worksheet/shared'
import { generateMaze, mazeToSvg } from './services/maze.js'
import { fetchOrGenerateIcon, type IconGenerationOptions } from './services/icons.js'
import { buildPdf, buildCuttingPdf, buildWordSearchPdf } from './services/pdf.js'
import { generateCuttingIcon } from './services/cuttingIcon.js'
import { generateCuttingOutline } from './services/outline.js'
import { prepareReferenceImageFromDataUrl } from './services/backgroundRemoval.js'
import { generateWordSearch, wordSearchToSvg } from './services/wordSearch.js'
import logger from './lib/logger.js'
import { isOfflineMode } from './lib/offline.js'
import { AppError } from './lib/errors.js'
import { serverTiming, timed } from './lib/timing.js'

const gitHash = readGitHash()

// ─── Timing pointcuts ─────────────────────────────────────────────────────────
// Each stage is wrapped once here, so the services stay oblivious and every
// /generate response carries a `Server-Timing` breakdown (image, outline, pdf…).

const resolveIcon           = timed('image',   fetchOrGenerateIcon)
const generateCuttingImage  = timed('image',   generateCuttingIcon)
const prepareReferenceImage = timed('image',   prepareReferenceImageFromDataUrl)
const traceOutline          = timed('outline', generateCuttingOutline)
const renderPdf             = timed('pdf',     buildPdf)
const renderCuttingPdf      = timed('pdf',     buildCuttingPdf)
const renderWordSearchPdf   = timed('pdf',     buildWordSearchPdf)

const app = new Hono()

// ─── Request timing + access log ──────────────────────────────────────────────
app.use('*', serverTiming())

app.use('*', cors({
  origin: (origin) => {
    const allowed = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    // In development, also allow 127.0.0.1 variants and any localhost port
    if (process.env.NODE_ENV !== 'production') {
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return origin ?? allowed
      }
    }
    return origin === allowed ? origin : null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

app.get('/health', (c) => c.json({ status: 'ok', git: gitHash, offline: isOfflineMode() }))

app.post(
  '/generate',
  zValidator('json', WorksheetSpec),
  async (c) => {
    const spec = c.req.valid('json')

    logger.info({ activity: spec.activity, difficulty: spec.difficulty, interest: spec.interest, hasRef: !!spec.referenceImageDataUrl }, 'route /generate entered')

    try {
      let activitySvg: string
      let activityLabels: Parameters<typeof buildPdf>[0]['activityLabels']
      let iconOptions: IconGenerationOptions | undefined

      if (spec.activity === 'cutting') {
        let pngBuffer: Buffer

        if (spec.referenceImageDataUrl) {
          logger.info('cutting: preparing reference image')
          pngBuffer = await prepareReferenceImage(spec.referenceImageDataUrl)
          logger.info({ byteLength: pngBuffer.length }, 'cutting: reference image ready')
        } else {
          logger.info('cutting: generating icon via Ideogram')
          pngBuffer = await generateCuttingImage(spec.interest)
          logger.info({ byteLength: pngBuffer.length }, 'cutting: icon ready')
        }

        logger.info('cutting: tracing outline')
        const outline = await traceOutline(pngBuffer, spec.difficulty)
        logger.info({ contours: outline.pathData.length }, 'cutting: outline ready')

        logger.info('cutting: rendering PDF')
        const pdfBytes = await renderCuttingPdf({ spec, pngBuffer, outline })
        logger.info({ bytes: pdfBytes.length }, 'cutting: PDF complete')

        return c.newResponse(new Uint8Array(pdfBytes), 200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${pdfSlug(spec)}-cutting.pdf"`,
          'Cache-Control': 'public, max-age=3600',
        })
      }

      if (spec.activity === 'word-search') {
        logger.info({ words: spec.wordSearchWords?.length ?? 0 }, 'word-search: generating puzzle')
        const wordSearch = generateWordSearch(spec.wordSearchWords ?? [], spec.interest, WORD_SEARCH_DIFFICULTY)
        const activitySvg = wordSearchToSvg(wordSearch)

        logger.info('word-search: resolving icon')
        const icon = await resolveIcon('word-search', spec.interest, spec.referenceImageDataUrl)
        logger.info({ iconCached: icon.cached, iconUrl: icon.url.slice(0, 80) }, 'word-search: icon resolved')

        logger.info({ cols: wordSearch.cols, rows: wordSearch.rows, words: wordSearch.words.length }, 'word-search: rendering PDF')
        const pdfBytes = await renderWordSearchPdf({ spec, wordSearch, activitySvg, icon })
        logger.info({ bytes: pdfBytes.length }, 'word-search: PDF complete')

        return c.newResponse(new Uint8Array(pdfBytes), 200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${pdfSlug(spec)}-word-search.pdf"`,
          'Cache-Control': 'public, max-age=3600',
        })
      }

      switch (spec.activity) {
        case 'maze': {
          const maze = generateMaze(spec.difficulty)
          const result = mazeToSvg(maze)
          activitySvg = result.svg
          activityLabels = {
            svgW: result.svgW,
            svgH: result.svgH,
            entryGap: result.entryGap,
            clearing: result.clearing,
            showFinishLabel: true,
          }
          logger.debug({ svgW: result.svgW, svgH: result.svgH }, 'maze generated')
          break
        }
        default:
          return c.json({ error: `Activity "${spec.activity}" not yet implemented` }, 501)
      }

      const icon = await resolveIcon(
        'maze',
        spec.interest,
        spec.referenceImageDataUrl,
        iconOptions,
      )
      logger.info({ iconCached: icon.cached, iconUrl: icon.url.slice(0, 80) }, 'icon resolved')

      logger.info('PDF render start')
      const pdfBytes = await renderPdf({ spec, icon, activitySvg, activityLabels })
      logger.info({ bytes: pdfBytes.length }, 'PDF render complete')

      return c.newResponse(new Uint8Array(pdfBytes), 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${pdfSlug(spec)}-${spec.activity}.pdf"`,
        'Cache-Control': 'public, max-age=3600',
      })
    } catch (err) {
      if (err instanceof AppError) {
        // Known failure with a deliberate status: missing FAL_API_KEY (500),
        // unusable upload in offline mode (400), …
        logger.error({ err, status: err.status }, '/generate failed')
        return c.json({ error: err.message, details: err.details }, err.status)
      }
      logger.error({ err }, '/generate failed')
      return c.json({ error: 'Failed to generate worksheet', details: String(err) }, 500)
    }
  }
)

/** Returns a safe filename slug: interest if present, child name if not, fallback 'worksheet'. */
function pdfSlug(spec: { interest: string; childName?: string }): string {
  const base = spec.interest.trim() || spec.childName?.trim() || 'worksheet'
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Short commit hash for /health, or 'unknown' when not running from a git checkout. */
function readGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

export default app
