import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import type { MiddlewareHandler } from 'hono'
import logger from './logger.js'

/**
 * Request timing as a cross-cutting concern.
 *
 *   serverTiming()   — Hono middleware: times every request and publishes the
 *                      result in the standard `Server-Timing` response header.
 *   timed(name, fn)  — "around advice" for any async function: records how long
 *                      each call took into the *current request's* context
 *                      (via AsyncLocalStorage), so stages such as icon / outline /
 *                      pdf show up in the same header with no parameter threading.
 *
 * Outside a request (scripts, unit tests of a service) `timed` is a no-op
 * pass-through, so wrapped functions behave exactly like the originals.
 *
 * The header is readable by tests (`parseServerTiming(res.headers)`) and by
 * browsers (DevTools → Network → Timing), so one mechanism serves both.
 */

export interface TimingEntry {
  name: string
  /** Duration in milliseconds, rounded to 0.1 ms */
  ms: number
}

interface TimingContext {
  entries: TimingEntry[]
}

const storage = new AsyncLocalStorage<TimingContext>()

export const SERVER_TIMING_HEADER = 'Server-Timing'
export const TOTAL_ENTRY = 'total'

// ─── Around advice ────────────────────────────────────────────────────────────

/**
 * Wraps `fn` so each call records `{ name, ms }` on the active request.
 * Timing is captured even when `fn` throws; the error is re-thrown unchanged.
 */
export function timed<Args extends unknown[], R>(
  name: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    const ctx = storage.getStore()
    if (!ctx) return fn(...args)

    const start = performance.now()
    try {
      return await fn(...args)
    } finally {
      ctx.entries.push({ name, ms: round(performance.now() - start) })
    }
  }
}

/** Records an already-measured duration on the active request (no-op outside one). */
export function recordTiming(name: string, ms: number): void {
  storage.getStore()?.entries.push({ name, ms: round(ms) })
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Times the full request, exposes stage + total durations as `Server-Timing`,
 * and writes one structured access-log line per request.
 */
export function serverTiming(): MiddlewareHandler {
  return async (c, next) => {
    const ctx: TimingContext = { entries: [] }
    const start = performance.now()

    await storage.run(ctx, next)

    const total = round(performance.now() - start)
    const entries = [...ctx.entries, { name: TOTAL_ENTRY, ms: total }]

    c.res.headers.set(SERVER_TIMING_HEADER, formatServerTiming(entries))

    logger.info({
      method: c.req.method,
      path:   c.req.path,
      status: c.res.status,
      ms:     total,
      stages: Object.fromEntries(ctx.entries.map(e => [e.name, e.ms])),
    }, `${c.req.method} ${c.req.path}`)
  }
}

// ─── Header (de)serialisation ─────────────────────────────────────────────────

/** `icon;dur=12.3, pdf;dur=45.6, total;dur=70.1` */
export function formatServerTiming(entries: TimingEntry[]): string {
  return entries.map(e => `${e.name};dur=${e.ms}`).join(', ')
}

/** Parses a `Server-Timing` header (or a Headers object) back into entries. */
export function parseServerTiming(source: Headers | string | null | undefined): TimingEntry[] {
  const header = typeof source === 'string' || source == null ? source : source.get(SERVER_TIMING_HEADER)
  if (!header) return []

  return header
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .flatMap(part => {
      const [name, ...params] = part.split(';').map(s => s.trim())
      const dur = params.find(p => p.startsWith('dur='))
      if (!name || !dur) return []
      const ms = Number(dur.slice(4))
      return Number.isFinite(ms) ? [{ name, ms }] : []
    })
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10
}
