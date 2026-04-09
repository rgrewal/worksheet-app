import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined
)

export default logger
