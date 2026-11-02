import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { serverTiming, timed, recordTiming, parseServerTiming, formatServerTiming } from './timing.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('timed()', () => {
  it('is a transparent pass-through outside a request: same result, same error', async () => {
    const ok   = timed('x', async (a: number, b: number) => a + b)
    const boom = timed('x', async () => { throw new Error('boom') })
    expect(await ok(2, 3)).toBe(5)
    await expect(boom()).rejects.toThrow('boom')
  })

  it('records one entry per call on the active request, including failed calls', async () => {
    const app = new Hono()
    app.use('*', serverTiming())

    const slow = timed('slow', async () => { await sleep(20) })
    const fail = timed('fail', async () => { await sleep(5); throw new Error('nope') })

    app.get('/', async (c) => {
      await slow()
      await slow()
      try { await fail() } catch { /* expected */ }
      recordTiming('manual', 1.25)
      return c.text('ok')
    })

    const res = await app.request('/')
    const entries = parseServerTiming(res.headers)

    expect(entries.map(e => e.name)).toEqual(['slow', 'slow', 'fail', 'manual', 'total'])
    expect(entries[0].ms).toBeGreaterThanOrEqual(19)
    expect(entries[2].ms).toBeGreaterThanOrEqual(4)
    expect(entries[3].ms).toBe(1.3)                        // rounded to 0.1 ms
    expect(entries.at(-1)!.ms).toBeGreaterThanOrEqual(44)  // 20 + 20 + 5
  })

  it('keeps concurrent requests separate (AsyncLocalStorage isolation)', async () => {
    const app = new Hono()
    app.use('*', serverTiming())
    const work = timed('work', async (ms: number) => { await sleep(ms) })
    app.get('/:ms', async (c) => { await work(Number(c.req.param('ms'))); return c.text('ok') })

    const [a, b] = await Promise.all([app.request('/30'), app.request('/5')])
    expect(parseServerTiming(a.headers).filter(e => e.name === 'work')).toHaveLength(1)
    expect(parseServerTiming(b.headers).filter(e => e.name === 'work')).toHaveLength(1)
    expect(parseServerTiming(a.headers)[0].ms).toBeGreaterThan(parseServerTiming(b.headers)[0].ms)
  })
})

describe('Server-Timing (de)serialisation', () => {
  it('round-trips', () => {
    const entries = [{ name: 'image', ms: 12.3 }, { name: 'pdf', ms: 45 }, { name: 'total', ms: 70.1 }]
    expect(formatServerTiming(entries)).toBe('image;dur=12.3, pdf;dur=45, total;dur=70.1')
    expect(parseServerTiming(formatServerTiming(entries))).toEqual(entries)
  })

  it('tolerates missing headers, descriptions and junk', () => {
    expect(parseServerTiming(null)).toEqual([])
    expect(parseServerTiming('')).toEqual([])
    expect(parseServerTiming('cache;desc="hit", db;dur=5;desc="q", junk;dur=abc')).toEqual([{ name: 'db', ms: 5 }])
  })
})
