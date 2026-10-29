# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. It is also the primary context-sharing mechanism between Claude.ai planning sessions and Claude Code implementation sessions — keep it current.

## Project context

**worksheet-app** generates personalized printable learning worksheets for children based on their interests. It is both a real product and a portfolio piece demonstrating AI/LLM integration.

- **Demo deadline: April 22, 2026 (passed)**
- **Current priority: fix remaining known issues (UI, layout, maze rendering)**
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

Run tests:
```bash
# All workspaces (shared, api, frontend)
pnpm test

# One workspace
pnpm --filter @worksheet/api test
```

Cutting-outline debug scripts live in `apps/api/src/scripts/` and run with `npx tsx` from `apps/api` — see the README's "Debug scripts" section.

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

- **`packages/shared`** — Zod schemas, shared types and constants (`WorksheetSpec`, `ActivityType`, `DifficultyLevel`, `WORD_SEARCH_DIFFICULTY`, `Icon`, `MazeData`, `WordSearchData`, plus data shapes for activities not built yet). Both frontend and API import from here. Consumed as TypeScript source with no build step; its `tsconfig.json` is for type-checking only. Any value import pulls the whole module, Zod included, into the frontend bundle (~12 kB gzipped).
- **`apps/frontend`** — Single React component (`WorksheetForm.tsx`) that collects form input, POSTs to `/generate`, and displays the returned PDF. The activity dropdown is a hardcoded list in that file with an `enabled` flag (counting, tracing and matching only show in dev builds) — it is *not* generated from `ActivityType`. The footer shows the git hash via `__GIT_HASH__`, defined in `vite.config.ts` (and stubbed in `vitest.config.ts`).
- **`apps/api`** — Hono server with `POST /generate` and `GET /health` (returns status + git hash). Thin controller in `index.ts`: cutting and word-search have their own branches, maze is a `case` in `switch(spec.activity)`, and anything else returns 501. Delegates to services:
  - `services/maze.ts` — DFS-based maze generator → SVG renderer. Difficulty maps to grid size (6×6 / 10×10 / 14×14).
  - `services/wordSearch.ts` — Places up to 30 words (≤30 chars each) in a letter grid → SVG with a word bank. Grid grows with word count and longest word (max 32×32). The generator supports all three difficulties (easy = right/down, medium adds down-diagonals, hard = all 8), but word search worksheets always use `WORD_SEARCH_DIFFICULTY` (`'easy'`, in `packages/shared`): the API ignores the requested level and the form shows that value in a disabled dropdown.
  - `services/icons.ts` — Icon for maze and word-search worksheets. An uploaded reference photo is used as the icon as-is. Otherwise: in-memory cache keyed on normalized interest → Ideogram v3 text-to-image (`fal-ai/ideogram/v3`, or `generate-transparent` + sharp trim when `removeBackground` is set) → placeholder SVG.
  - `services/cornerImages.ts` — 10 built-in SVG line drawings; one is picked deterministically from the interest string and drawn in the top-right corner of every worksheet type.
  - `services/cuttingIcon.ts` — Generates a subject PNG via fal-ai/ideogram/v3/generate-transparent when no user photo is provided for cutting worksheets.
  - `services/backgroundRemoval.ts` — Processes a user-uploaded image data URL for cutting worksheets: checks for existing transparency, removes background via fal-ai/birefnet/v2 if needed, then normalises (crop to bounding box → proportional padding → resize to ≤1800 px). Uses `@fal-ai/client` for storage upload + model call.
  - `services/outline.ts` — Pure-TypeScript distance-transform contour tracer. Extracts alpha via sharp, applies close→fill-holes→dilate at per-difficulty margins, traces polygon edges, simplifies with Ramer–Douglas–Peucker. Returns `CuttingOutlineResult` (pathData in image-pixel coords + stroke/dash sizes).
  - `services/pdf.ts` — PDFKit builds LETTER-size PDFs: `buildPdf` (maze: title + icon + activity SVG), `buildCuttingPdf`, `buildWordSearchPdf`. Uses stream-based buffer collection (PDFKit doesn't support async/await directly).
  - `services/storage.ts` — (pending) Cloudflare R2 upload/download via `@aws-sdk/client-s3`.
  - `lib/logger.ts` — pino logger; pretty-printed at `debug` level in dev, JSON at `info` in production (override with `LOG_LEVEL`).
  - `scripts/` — dev-only debug scripts for the cutting outline (`generateTestImage.ts`, `testOutline.ts`). `testOutline.ts` replays the original sharp + potrace outline that `outline.ts` replaced; `potrace` is a devDependency only for it.

## Build notes

- `tsc` only compiles `.ts` files — assets must be copied manually
- Font file is copied as part of the API build: `tsc && cp -r src/fonts dist/fonts`
- All internal imports must use `.js` extensions (ESM requirement) e.g. `import { foo } from './bar.js'`
- Server binds to `process.env.PORT ?? 3001` — Render injects `PORT` automatically
- `FRONTEND_URL` in Render must have no trailing slash or CORS will fail
- `apps/api/src/scripts/` is excluded in `apps/api/tsconfig.json`, so the debug scripts are neither built nor type-checked
- Both apps run `git rev-parse --short HEAD` (the API at startup, the frontend at build time), so both need a git checkout

## Known issues (fix before adding new features)

- UI is plain and unpolished
- Layout issues present
- Maze rendering quality needs improvement
- ✅ Distorted output when users upload reference images for cutting worksheets — fixed via birefnet/v2 background removal + normalisation pipeline
- ✅ `ICON_SIZE` bumped to `120` in `apps/api/src/services/pdf.ts`

## Adding a new activity type

1. Create `apps/api/src/services/<activity>.ts` with a generator function
2. Handle it in `apps/api/src/index.ts`: a `case` in `switch(spec.activity)` if it fits the maze layout (`buildPdf`), or its own branch plus a builder in `pdf.ts`, like cutting and word-search
3. Add the new value to `ActivityType` in `packages/shared/src/types.ts`
4. Add it to (or enable it in) the activity list in `apps/frontend/src/WorksheetForm.tsx`

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

### Pre-demo (deadline April 22 — passed; items 4–5 still open)
1. ✅ GitHub repo setup
2. ✅ Render deploy + live URL
3. ✅ Dev/prod env config
4. R2 storage + upload icons/PDFs on generation
5. Fix known issues — icon distortion and ICON_SIZE done; UI, layout, maze rendering remain

Also shipped before the demo, outside this list: cutting worksheet (AI subject or user photo) and word search worksheet.

### Post-demo
6. Remaining activity types: counting, tracing, matching
7. Social story generator with guardrail layer (highest portfolio value — guardrailing is underrepresented and maps to enterprise concerns)
8. Persistent icon cache via KV
9. Worksheet history (re-downloads + admin analytics) via D1
10. R2 CDN public URL

## AI image generation notes

- `fal.ai` is used for all image generation and processing
- **Cutting worksheet — no photo:** Ideogram v3 generate-transparent (`fal-ai/ideogram/v3/generate-transparent`) produces a cartoon subject PNG with a transparent background
- **Cutting worksheet — user photo:** birefnet/v2 (`fal-ai/birefnet/v2`) removes the background; subject is then normalised (crop + pad + resize) before outline tracing
- **Maze / word-search icon:** Ideogram v3 text-to-image (`fal-ai/ideogram/v3`). An uploaded reference photo is placed on the worksheet as-is — there is no img2img step (Flux Canny is not used anywhere in this repo's history)
- Tried and dropped: Flux Schnell failed on obscure references; Ideogram v3 remix ignored style prompts
- In-memory icon cache exists but does not persist across server restarts — R2/KV cache is the fix
- Render free tier spins down after inactivity, which clears the in-memory icon cache on every wake

## Dev environment

- Windows 11 with Ubuntu WSL
- VS Code connected via WSL Remote extension (launched from Windows, not `code .` from terminal)
- Node 20, pnpm 9
- Project at `~/worksheet-app`
- Claude Code is the AI coding assistant in use