import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import EndpointTimingReporter from './src/test/timingReporter'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Default output plus the endpoint-timing table (see src/test/timingReporter.ts)
    reporters: ['default', new EndpointTimingReporter()],
    // Cutting-outline tracing on a 1024 px image is CPU-bound and slows down
    // markedly when test files run in parallel on a small machine
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/app.ts', 'src/lib/**', 'src/services/**'],
    },
  },
  resolve: {
    alias: {
      '@worksheet/shared': fileURLToPath(new URL('../../packages/shared/src/types.ts', import.meta.url)),
    },
  },
})
