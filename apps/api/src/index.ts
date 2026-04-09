import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'
import { WorksheetSpec } from '@worksheet/shared'
import { generateMaze, mazeToSvg } from './services/maze.js'
import { fetchOrGenerateIcon } from './services/icons.js'
import { buildPdf } from './services/pdf.js'
import logger from './lib/logger.js'

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

app.get('/health', (c) => c.json({ status: 'ok' }))

app.post(
  '/generate',
  zValidator('json', WorksheetSpec),
  async (c) => {
    const spec = c.req.valid('json')

    logger.info({ activity: spec.activity, difficulty: spec.difficulty, interest: spec.interest, hasRef: !!spec.referenceImageDataUrl }, 'route /generate entered')

    try {
      let activitySvg: string
      let activityLabels: Parameters<typeof buildPdf>[0]['activityLabels']

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
          }
          logger.debug({ svgW: result.svgW, svgH: result.svgH }, 'maze generated')
          break
        }
        default:
          return c.json({ error: `Activity "${spec.activity}" not yet implemented` }, 501)
      }

      const icon = await fetchOrGenerateIcon(
        spec.interest,
        spec.referenceImageDataUrl
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

if (process.env.NODE_ENV !== 'production') {
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port: 3001 }, () => {
    console.log('API running at http://localhost:3001')
  })
}
