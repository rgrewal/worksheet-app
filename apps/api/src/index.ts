import 'dotenv/config'
import { serve } from '@hono/node-server'
import app from './app.js'
import logger from './lib/logger.js'
import { isOfflineMode } from './lib/offline.js'

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, () => {
  if (isOfflineMode()) {
    logger.warn(`API running on port ${port} in OFFLINE mode — fal.ai is never called, placeholder images are used`)
  } else if (!process.env.FAL_API_KEY?.trim()) {
    logger.warn(`API running on port ${port} without FAL_API_KEY — image generation will fail with 500 (use pnpm dev:offline for placeholders)`)
  } else {
    logger.info(`API running on port ${port}`)
  }
})
