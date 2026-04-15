import 'dotenv/config'
import { execSync } from 'child_process'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'
import { WorksheetSpec } from '@worksheet/shared'
import { generateMaze, mazeToSvg } from './services/maze.js'
import { fetchOrGenerateIcon, type IconGenerationOptions } from './services/icons.js'
import { buildPdf, buildCuttingPdf } from './services/pdf.js'
import { generateCuttingIcon } from './services/cuttingIcon.js'
import { generateCuttingOutline } from './services/outline.js'
import logger from './lib/logger.js'

const gitHash = execSync('git rev-parse --short HEAD').toString().trim()

const app = new Hono()

// ─── Request logging middleware ───────────────────────────────────────────────
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  }, `${c.req.method} ${c.req.path}`)
})

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

app.get('/health', (c) => c.json({ status: 'ok', git: gitHash }))

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
        logger.info('cutting: generating icon')
        const pngBuffer = await generateCuttingIcon(spec.interest)
        logger.info({ byteLength: pngBuffer.length }, 'cutting: icon ready')

        logger.info('cutting: tracing outline')
        const outlinePath = await generateCuttingOutline(pngBuffer, spec.difficulty)
        logger.info({ dLength: outlinePath.length }, 'cutting: outline ready')

        logger.info('cutting: rendering PDF')
        const pdfBytes = await buildCuttingPdf({ spec, pngBuffer, outlinePath })
        logger.info({ bytes: pdfBytes.length }, 'cutting: PDF complete')

        return c.newResponse(new Uint8Array(pdfBytes), 200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${spec.interest}-cutting.pdf"`,
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

      const icon = await fetchOrGenerateIcon(
        spec.interest,
        spec.referenceImageDataUrl,
        iconOptions,
      )
      logger.info({ iconCached: icon.cached, iconUrl: icon.url.slice(0, 80) }, 'icon resolved')

      logger.info('PDF render start')
      const pdfBytes = await buildPdf({ spec, icon, activitySvg, activityLabels })
      logger.info({ bytes: pdfBytes.length }, 'PDF render complete')

      return c.newResponse(new Uint8Array(pdfBytes), 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${spec.interest}-${spec.activity}.pdf"`,
        'Cache-Control': 'public, max-age=3600',
      })
    } catch (err) {
      logger.error({ err }, '/generate failed')
      return c.json({ error: 'Failed to generate worksheet', details: String(err) }, 500)
    }
  }
)

export default app

const { serve } = await import('@hono/node-server')
const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, port }, () => {
  logger.info(`API running on port ${port}`)
})
