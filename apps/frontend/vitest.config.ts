import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
    },
  },
  resolve: {
    alias: {
      '@worksheet/shared': fileURLToPath(new URL('../../packages/shared/src/types.ts', import.meta.url)),
    },
  },
})
