import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 'unknown' when building outside a git checkout
let gitHash = 'unknown'
try {
  gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
} catch {}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
  },
})
