# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. It is also the primary context-sharing mechanism between Claude.ai planning sessions and Claude Code implementation sessions — keep it current.

## Project context

**worksheet-app** generates personalized printable learning worksheets for children based on their interests. It is both a real product and a portfolio piece demonstrating AI/LLM integration.

- **Demo deadline: April 22, 2025**
- **Current priority: stable ops (GitHub → Render deploy → R2 asset backup)**
- **Stack was chosen deliberately new-to-author** to demonstrate modern JS/TS ecosystem learning

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
- `FRONTEND_URL` — e.g. `http://localhost:5173`
- `NODE_ENV=development`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Cloudflare R2 credentials (once set up)

`apps/frontend/.env`:
- `VITE_API_URL=http://localhost:3001`

### Production (Render)
All env vars above are set as Render environment variables — never committed to git. `NODE_ENV=production`.

## Architecture

Pnpm monorepo with three packages:

- **`packages/shared`** — Zod schemas only (`WorksheetSpec`, `ActivityType`, `DifficultyLevel`, `Icon`, `MazeData`). Both frontend and API import from here. Adding a value to `ActivityType` automatically adds it to the frontend UI.
- **`apps/frontend`** — Single React component (`WorksheetForm.tsx`) that collects form input, POSTs to `/generate`, and displays the returned PDF.
- **`apps/api`** — Hono server with one route (`POST /generate`). Thin controller in `index.ts` delegates to services:
  - `services/maze.ts` — DFS-based maze generator → SVG renderer. Difficulty maps to grid size (6×6 / 10×10 / 14×14).
  - `services/icons.ts` — In-memory cache keyed on normalized interest string. Tries: reference image → fal.ai img2img (Flux Canny), then text → fal.ai text-to-image, then placeholder SVG.
  - `services/pdf.ts` — PDFKit assembles title + icon + activity SVG into a LETTER-size PDF. Uses stream-based buffer collection (PDFKit doesn't support async/await directly).
  - `services/storage.ts` — (pending) Cloudflare R2 upload/download via `@aws-sdk/client-s3`.

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

## Infrastructure decisions

**Decided against Cloudflare Workers for the API** — PDFKit depends on Node.js APIs (`fs`, `Buffer`) and would require a rewrite to `pdf-lib`. Not worth the risk before the demo. Decision can be revisited post-launch.

| Concern | Solution | Status |
|---|---|---|
| Source control | GitHub (private repo) | Pending |
| API hosting | Render (Node, push-to-deploy) | Pending |
| Frontend hosting | Cloudflare Pages | Pending |
| Image/PDF blob storage | Cloudflare R2 (via S3 SDK) | Pending |
| Icon cache (persistent) | Cloudflare KV | Post-demo |
| Worksheet metadata/history | Cloudflare D1 or Turso | Post-demo |
| Asset CDN | R2 public bucket | Post-demo |

## Deployment

### Frontend → Cloudflare Pages
```bash
pnpm --filter @worksheet/frontend build
# Upload apps/frontend/dist via Cloudflare dashboard or wrangler pages deploy
```

### API → Render
- Connect GitHub repo in Render dashboard
- Build command: `pnpm install && pnpm --filter @worksheet/api build`
- Start command: `node apps/api/dist/index.js` (adjust to actual entry point)
- Set all env vars in Render dashboard — never in code
- Auto-deploys on push to `main`

## Roadmap (ordered)

### Pre-demo (by April 22)
1. GitHub repo setup
2. Render deploy + live URL
3. Dev/prod env config
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

## Dev environment

- Windows 11 with Ubuntu WSL
- VS Code connected via WSL Remote extension (launched from Windows, not `code .` from terminal)
- Node 20, pnpm 9
- Project at `~/worksheet-app`
- Claude Code is the AI coding assistant in use