# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. It is also the primary context-sharing mechanism between Claude.ai planning sessions and Claude Code implementation sessions — keep it current.

## Project context

**worksheet-app** generates personalized printable learning worksheets for children based on their interests. It is both a real product and a portfolio piece demonstrating AI/LLM integration.

- **Demo deadline: April 22, 2026**
- **Current priority: fix known issues (UI, layout, maze rendering, icon distortion, ICON_SIZE)**
- **Stack was chosen deliberately new-to-author** to demonstrate modern JS/TS ecosystem learning

## Live URLs

| | URL |
|---|---|
| Frontend | https://worksheet-app.pages.dev |
| API | https://worksheet-app-f9kt.onrender.com |
| Health check | https://worksheet-app-f9kt.onrender.com/health |

## Commands

```bash
# Install dependencies (Node 20+, pnpm 9+ required)
pnpm install

# Start frontend (port 5173) and API (port 3001) in parallel
pnpm dev

# Build all packages
pnpm build

# Type-check all workspaces
pnpm typecheck

# Run individual workspaces
pnpm --filter @worksheet/frontend dev
pnpm --filter @worksheet/api dev
```

No test suite is currently configured.

## Environment setup

Copy and populate before first run:
```bash
cp apps/api/.env.example apps/api/.env
```

### Local (dev)
`apps/api/.env`:
- `FAL_API_KEY` — from fal.ai (app works without it, falls back to placeholder SVG)
- `FRONTEND_URL` — `http://localhost:5173`
- `NODE_ENV=development`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Cloudflare R2 credentials (once set up)

`apps/frontend/.env`:
- `VITE_API_URL=http://localhost:3001`

### Production
| Service | Env var | Value |
|---|---|---|
| Render | `NODE_ENV` | `production` |
| Render | `FAL_API_KEY` | fal.ai key |
| Render | `FRONTEND_URL` | `https://worksheet-app.pages.dev` (no trailing slash) |
| Render | `PORT` | set automatically by Render |
| Cloudflare Pages | `VITE_API_URL` | `https://worksheet-app-f9kt.onrender.com` |

## Architecture

Pnpm monorepo with three packages:

- **`packages/shared`** — Zod schemas only (`WorksheetSpec`, `ActivityType`, `DifficultyLevel`, `Icon`, `MazeData`). Both frontend and API import from here. Adding a value to `ActivityType` automatically adds it to the frontend UI.
- **`apps/frontend`** — Single React component (`WorksheetForm.tsx`) that collects form input, POSTs to `/generate`, and displays the returned PDF.
- **`apps/api`** — Hono server with one route (`POST /generate`). Thin controller in `index.ts` delegates to services:
  - `services/maze.ts` — DFS-based maze generator → SVG renderer. Difficulty maps to grid size (6×6 / 10×10 / 14×14).
  - `services/icons.ts` — In-memory cache keyed on normalized interest string. Tries: reference image → fal.ai img2img (Flux Canny), then text → fal.ai text-to-image, then placeholder SVG.
  - `services/pdf.ts` — PDFKit assembles title + icon + activity SVG into a LETTER-size PDF. Uses stream-based buffer collection (PDFKit doesn't support async/await directly).
  - `services/storage.ts` — (pending) Cloudflare R2 upload/download via `@aws-sdk/client-s3`.

## Build notes

- `tsc` only compiles `.ts` files — assets must be copied manually
- Font file is copied as part of the API build: `tsc && cp -r src/fonts dist/fonts`
- All internal imports must use `.js` extensions (ESM requirement) e.g. `import { foo } from './bar.js'`
- Server binds to `process.env.PORT ?? 3001` — Render injects `PORT` automatically
- `FRONTEND_URL` in Render must have no trailing slash or CORS will fail

## Known issues (fix before adding new features)

- UI is plain and unpolished
- Layout issues present
- Maze rendering quality needs improvement
- Distorted output when users upload reference images for AI icon generation
- `ICON_SIZE` should be bumped from `52` to `120` in `apps/api/src/services/pdf.ts` (one-line fix)

## Adding a new activity type

1. Create `apps/api/src/services/<activity>.ts` with a generator function
2. Add a `case` to the `switch(spec.activity)` in `apps/api/src/index.ts`
3. Add the new value to `ActivityType` in `packages/shared/src/types.ts`

## Infrastructure

**Decided against Cloudflare Workers for the API** — PDFKit depends on Node.js APIs (`fs`, `Buffer`) and would require a rewrite to `pdf-lib`. Not worth the risk before the demo. Decision can be revisited post-launch.

| Concern | Solution | Status |
|---|---|---|
| Source control | GitHub (private repo) | ✅ Done |
| API hosting | Render (Node, push-to-deploy) | ✅ Done |
| Frontend hosting | Cloudflare Pages | ✅ Done |
| Image/PDF blob storage | Cloudflare R2 (via S3 SDK) | Pending |
| Icon cache (persistent) | Cloudflare KV | Post-demo |
| Worksheet metadata/history | Cloudflare D1 or Turso | Post-demo |
| Asset CDN | R2 public bucket | Post-demo |

## Deployment

### Frontend → Cloudflare Pages
- Auto-deploys on push to `main`
- Root directory: `apps/frontend`
- Build command: `pnpm --filter @worksheet/frontend build`
- Build output directory: `dist`
- Node version: `20`

### API → Render
- Auto-deploys on push to `main`
- Root directory: `apps/api`
- Build command: `cd ../.. && pnpm install && pnpm --filter @worksheet/api build`
- Start command: `node dist/index.js`
- Instance type: Free (spins down after inactivity — first request may take 30–60s to wake)

## Roadmap (ordered)

### Pre-demo (by April 22)
1. ✅ GitHub repo setup
2. ✅ Render deploy + live URL
3. ✅ Dev/prod env config
4. R2 storage + upload icons/PDFs on generation
5. Fix known issues (UI, layout, maze rendering, icon distortion, ICON_SIZE)

### Post-demo
6. Remaining activity types: counting, tracing, matching
7. Social story generator with guardrail layer (highest portfolio value — guardrailing is underrepresented and maps to enterprise concerns)
8. Persistent icon cache via KV
9. Worksheet history (re-downloads + admin analytics) via D1
10. R2 CDN public URL

## AI image generation notes

- `fal.ai` is used for icon generation
- **Flux Canny** (img2img via edge detection) is the working model for uploaded reference photos — do not swap without testing
- Flux Schnell failed on obscure references; Ideogram v3 remix ignored style prompts
- In-memory icon cache exists but does not persist across server restarts — R2/KV cache is the fix
- Render free tier spins down after inactivity, which clears the in-memory icon cache on every wake

## Dev environment

- Windows 11 with Ubuntu WSL
- VS Code connected via WSL Remote extension (launched from Windows, not `code .` from terminal)
- Node 20, pnpm 9
- Project at `~/worksheet-app`
- Claude Code is the AI coding assistant in use