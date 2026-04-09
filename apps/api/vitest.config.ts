import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**'],
    },
  },
  resolve: {
    alias: {
      '@worksheet/shared': fileURLToPath(new URL('../../packages/shared/src/types.ts', import.meta.url)),
    },
  },
})
