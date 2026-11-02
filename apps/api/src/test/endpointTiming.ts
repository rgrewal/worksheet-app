import { getCurrentTest } from 'vitest/suite'
import { parseServerTiming, TOTAL_ENTRY } from '../lib/timing.js'

/**
 * Test-side half of endpoint timing.
 *
 * `recordEndpointTiming(res, scenario)` reads the `Server-Timing` header the
 * API attached to a response and stores it on the running test's `task.meta`.
 * Vitest serialises `meta` back to the main process, where
 * `timingReporter.ts` aggregates every sample into a report — the tests
 * themselves never deal with bookkeeping.
 */

export interface EndpointTimingSample {
  /** Human label for the scenario, e.g. "POST /generate maze [offline]" */
  scenario: string
  status: number
  /** Whole-request time as measured by the server middleware */
  totalMs: number
  /** Per-stage breakdown, e.g. { image: 1.2, pdf: 80.4 } (repeated stage names are summed) */
  stages: Record<string, number>
}

declare module 'vitest' {
  interface TaskMeta {
    endpointTimings?: EndpointTimingSample[]
  }
}

export function recordEndpointTiming(res: Response, scenario: string): EndpointTimingSample | undefined {
  const entries = parseServerTiming(res.headers)
  const total = entries.find(e => e.name === TOTAL_ENTRY)
  if (!total) return undefined

  const stages: Record<string, number> = {}
  for (const e of entries) {
    if (e.name === TOTAL_ENTRY) continue
    stages[e.name] = Math.round(((stages[e.name] ?? 0) + e.ms) * 10) / 10
  }

  const sample: EndpointTimingSample = { scenario, status: res.status, totalMs: total.ms, stages }

  const test = getCurrentTest()
  if (test) (test.meta.endpointTimings ??= []).push(sample)

  return sample
}
