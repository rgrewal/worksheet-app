import fs from 'node:fs'
import path from 'node:path'
import type { File, Reporter, Task } from 'vitest'
import type { EndpointTimingSample } from './endpointTiming.js'

/**
 * Vitest reporter that aggregates the endpoint timings recorded by
 * `recordEndpointTiming` and, once the run has finished:
 *
 *   - prints a table to the console (one row per scenario)
 *   - writes test-output/endpoint-timings.json  (raw samples + summary)
 *   - writes test-output/endpoint-timings.md    (the same table, for PRs)
 *
 * Registered in vitest.config.ts. It does nothing when no test recorded a sample.
 */

interface ScenarioSummary {
  scenario: string
  status: number
  samples: number
  minMs: number
  medianMs: number
  maxMs: number
  /** Median per stage across samples */
  stagesMs: Record<string, number>
}

export default class EndpointTimingReporter implements Reporter {
  constructor(private readonly outputDir = path.resolve(process.cwd(), 'test-output')) {}

  onFinished(files: File[] = []): void {
    const samples = files.flatMap(collectSamples)
    if (samples.length === 0) return

    const summary = summarise(samples)
    const table   = renderTable(summary)

    fs.mkdirSync(this.outputDir, { recursive: true })
    fs.writeFileSync(
      path.join(this.outputDir, 'endpoint-timings.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), summary, samples }, null, 2),
    )
    fs.writeFileSync(
      path.join(this.outputDir, 'endpoint-timings.md'),
      `# Endpoint timings\n\nGenerated ${new Date().toISOString()} — ${samples.length} samples\n\n${table}\n`,
    )

    process.stdout.write(`\nEndpoint timings (${samples.length} samples, written to ${path.relative(process.cwd(), this.outputDir)}/endpoint-timings.{json,md})\n\n${table}\n\n`)
  }
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function collectSamples(task: Task): EndpointTimingSample[] {
  const own = task.meta?.endpointTimings ?? []
  const children = 'tasks' in task ? task.tasks.flatMap(collectSamples) : []
  return [...own, ...children]
}

function summarise(samples: EndpointTimingSample[]): ScenarioSummary[] {
  // A 200 and a 400 for the same scenario take different paths — keep them apart
  const byKey = new Map<string, EndpointTimingSample[]>()
  for (const s of samples) {
    const key = `${s.scenario}\u0000${s.status}`
    byKey.set(key, [...(byKey.get(key) ?? []), s])
  }

  return [...byKey.values()]
    .map((group) => {
      const totals = group.map(s => s.totalMs)
      const stageNames = new Set(group.flatMap(s => Object.keys(s.stages)))
      const stagesMs: Record<string, number> = {}
      for (const name of stageNames) {
        // Median over the samples that actually ran this stage
        stagesMs[name] = median(group.filter(s => name in s.stages).map(s => s.stages[name]))
      }
      return {
        scenario: group[0].scenario,
        status: group[0].status,
        samples: group.length,
        minMs: Math.min(...totals),
        medianMs: median(totals),
        maxMs: Math.max(...totals),
        stagesMs,
      }
    })
    .sort((a, b) => b.medianMs - a.medianMs)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(m * 10) / 10
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderTable(summary: ScenarioSummary[]): string {
  const stageNames = [...new Set(summary.flatMap(s => Object.keys(s.stagesMs)))].sort()
  const header = ['Scenario', 'status', 'n', 'min ms', 'median ms', 'max ms', ...stageNames.map(n => `${n} ms (med)`)]
  const rows = summary.map(s => [
    s.scenario,
    String(s.status),
    String(s.samples),
    fmt(s.minMs),
    fmt(s.medianMs),
    fmt(s.maxMs),
    ...stageNames.map(n => n in s.stagesMs ? fmt(s.stagesMs[n]) : '–'),
  ])

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  const line = (cells: string[]) =>
    '| ' + cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ') + ' |'

  return [
    line(header),
    '|' + widths.map((w, i) => (i === 0 ? '-'.repeat(w + 2) : '-'.repeat(w + 1) + ':')).join('|') + '|',
    ...rows.map(line),
  ].join('\n')
}

function fmt(ms: number): string {
  return ms.toFixed(1)
}
