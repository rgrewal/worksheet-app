# CLAUDE.md

This file provides guidance to Claude Code when working with this repository. It is also the primary context-sharing mechanism between Claude.ai planning sessions and Claude Code implementation sessions — keep it current.

## Project context

**worksheet-app** generates personalized printable learning worksheets for children based on their interests. It is both a real product and a portfolio piece demonstrating AI/LLM integration.

- **Users: teachers and other educators**, who as a rule don't submit children's data. The name field is optional (a first name at most) and a reference photo shows the child's interest, never the child.

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

# Same, but with OFFLINE=1: fal.ai is never called, static placeholder images are used
pnpm dev:offline

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

# Endpoint timings, run serially for stable numbers (writes apps/api/test-output/, gitignored)
pnpm --filter @worksheet/api test:timing

# Contact sheet of cutting outlines for eyeballing (writes apps/api/test-output/outline-gallery/)
pnpm --filter @worksheet/api outline:gallery
```

Every API test run also prints an endpoint-timing table (custom Vitest reporter). The `ERROR /generate failed` log lines in test output are expected: tests deliberately exercise the 400/500 paths.

Cutting-outline debug scripts live in `apps/api/src/scripts/` and run with `npx tsx` from `apps/api` — see the README's "Debug scripts" section. The README also documents offline mode, the placeholder images and endpoint timing in detail.

## Environment setup

Copy and populate before first run:
```bash
cp apps/api/.env.example apps/api/.env
```

### Local (dev)
`apps/api/.env`:
- `FAL_API_KEY` — from fal.ai. Required unless `OFFLINE=1`: without it, any request that needs fal.ai fails with `500 "FAL_API_KEY is not set"` (there is no silent placeholder fallback any more). Uploaded photos for maze/word-search and transparent PNGs for cutting still work without a key.
- `OFFLINE=1` — optional; usually set by `pnpm dev:offline`. fal.ai is never called and one of six static placeholders is used per workflow × source. An opaque cutting upload is rejected with 400 (no background removal offline).
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
- **`apps/api`** — Hono server with `POST /generate` and `GET /health` (returns status, git hash and `offline`). `index.ts` only loads `.env` and starts the server; routes live in `app.ts` (imported by `app.test.ts`). Thin controller: cutting and word-search have their own branches, maze is a `case` in `switch(spec.activity)`, and anything else returns 501. An `AppError` thrown anywhere becomes its own status + `{ error, details }`; anything else is a generic 500. Delegates to:
  - `lib/offline.ts` — `isOfflineMode()` reads `OFFLINE` (`1`/`true`) on every call, so tests can toggle it.
  - `lib/fal.ts` — `requireFalApiKey()`, the single gate every fal.ai call goes through; throws `FalApiKeyMissingError`.
  - `lib/errors.ts` — `AppError` (status 400/500 + `details` hint), `FalApiKeyMissingError` (500), `InvalidImageError` (400).
  - `lib/timing.ts` — `serverTiming()` middleware (access log + `Server-Timing` header) and `timed(name, fn)`, which `app.ts` wraps around the image/outline/pdf stages via `AsyncLocalStorage`, so services know nothing about timing.
  - `services/placeholders.ts` — loads the six offline PNGs from `src/assets/placeholders/` (regenerate with `scripts/generatePlaceholders.ts`; committed because rendering them needs a system font).
  - `services/morphology.ts` — `growMask` / `shrinkMask` / `closeMask` / `openMask`: convention-safe wrappers over sharp's dilate/erode (which grow *dark* pixels). `morphology.test.ts` pins sharp's convention.
  - `services/maze.ts` — DFS-based maze generator → SVG renderer. Difficulty maps to grid size (6×6 / 10×10 / 14×14).
  - `services/wordSearch.ts` — Places up to 30 words (≤30 chars each) in a letter grid → SVG with a word bank. Grid grows with word count and longest word (max 32×32). The generator supports all three difficulties (easy = right/down, medium adds down-diagonals, hard = all 8), but word search worksheets always use `WORD_SEARCH_DIFFICULTY` (`'easy'`, in `packages/shared`): the API ignores the requested level and the form shows that value in a disabled dropdown.
  - `services/icons.ts` — Icon for maze and word-search worksheets (`fetchOrGenerateIcon(workflow, interest, ref?, opts?)`). Offline → placeholder. An uploaded reference photo is used as the icon as-is. Otherwise: in-memory cache keyed on normalized interest → Ideogram v3 text-to-image (`fal-ai/ideogram/v3`, or `generate-transparent` + sharp trim when `removeBackground` is set). A fal.ai failure propagates as a 500; there is no placeholder SVG fallback.
  - `services/cornerImages.ts` — 10 built-in SVG line drawings; one is picked deterministically from the interest string and drawn in the top-right corner of every worksheet type.
  - `services/cuttingIcon.ts` — Generates a subject PNG via fal-ai/ideogram/v3/generate-transparent when no user photo is provided for cutting worksheets.
  - `services/backgroundRemoval.ts` — Processes a user-uploaded image data URL for cutting worksheets: checks for existing transparency, removes background via fal-ai/birefnet/v2 if needed, then normalises (crop to bounding box → proportional padding → resize to ≤1800 px). Uses `@fal-ai/client` for storage upload + model call.
  - `services/outline.ts` — Pure-TypeScript distance-transform contour tracer. Extracts alpha via sharp and downsamples it to ≤512 px on the longest edge (`MAX_WORKING_PX`, ~4× faster than 1024 px), applies close→fill-holes→dilate at per-difficulty margins, traces polygon edges, simplifies with Ramer–Douglas–Peucker, then scales back. Returns `CuttingOutlineResult` (pathData in source-image pixel coords + stroke/dash sizes). Geometry is checked on ten synthetic shapes × 3 difficulties in `outline.shapes.test.ts` (shapes in `src/test/outlineShapes.ts`).
  - `services/pdf.ts` — PDFKit builds LETTER-size PDFs: `buildPdf` (maze: title + icon + activity SVG), `buildCuttingPdf`, `buildWordSearchPdf`. Uses stream-based buffer collection (PDFKit doesn't support async/await directly). The maze icon is scaled uniformly to fit the `ICON_SIZE` box (a 4:3 photo renders 120×90), never stretched.
  - `services/storage.ts` — (pending) Cloudflare R2 upload/download via `@aws-sdk/client-s3`.
  - `lib/logger.ts` — pino logger; pretty-printed at `debug` level in dev, JSON at `info` in production (override with `LOG_LEVEL`).
  - `scripts/` — dev-only scripts: `generateTestImage.ts`, `testOutline.ts` (replays the original sharp + potrace outline that `outline.ts` replaced; `potrace` is a devDependency only for it), `outlineGallery.ts` (contact sheet) and `generatePlaceholders.ts`.
  - `test/` — test helpers: `outlineShapes.ts`, `endpointTiming.ts`, `timingReporter.ts` (the Vitest reporter).

## Build notes

- `tsc` only compiles `.ts` files — assets must be copied manually
- Fonts and placeholder images are copied as part of the API build: `tsc && cp -r src/fonts dist/fonts && cp -r src/assets dist/assets`
- `tsc` also type-checks test files, so a type error in a test breaks the Render build. With this TypeScript/`@types/node` combination, `bufA.equals(bufB)` fails to type-check; wrap the argument in `new Uint8Array(...)`
- Running the compiled API locally: `node dist/index.js` fails on Node 20 because `@worksheet/shared` resolves to `.ts` source; use `npx tsx dist/index.js` (Render is unaffected)
- All internal imports must use `.js` extensions (ESM requirement) e.g. `import { foo } from './bar.js'`
- Server binds to `process.env.PORT ?? 3001` — Render injects `PORT` automatically
- `FRONTEND_URL` in Render must have no trailing slash or CORS will fail
- `apps/api/src/scripts/` is excluded in `apps/api/tsconfig.json`, so the debug scripts are neither built nor type-checked
- Both apps run `git rev-parse --short HEAD` (the API at startup, the frontend at build time) for the version label, and fall back to `unknown` outside a git checkout

## Known issues (fix before adding new features)

- UI is plain and unpolished
- Layout issues present
- Maze rendering quality needs improvement
- ✅ Distorted output when users upload reference images for cutting worksheets — fixed via birefnet/v2 background removal + normalisation pipeline
- ✅ `ICON_SIZE` bumped to `120` in `apps/api/src/services/pdf.ts`

## Clean source export

A shareable copy (no `.git`, agent files, dependencies, build output or secrets) is exported from the `contract-baseline` tag:

```bash
git archive --prefix=worksheet-app/ -o ../worksheet-app-clean.zip contract-baseline -- . ':!CLAUDE.md' ':!.claude'
```

`git archive` only includes tracked files, so `node_modules`, `dist`, `.env` and test images are left out automatically. To bring changes made in the copy back: `git switch -c contract-work contract-baseline`, rsync the copy over the repo (excluding `.git`, `CLAUDE.md`, `.claude`, `node_modules`, `dist`, `.env`, `coverage`, `test-output`, and with `--chmod=D755,F644` because files from `/mnt/c` arrive as 777), `git rm` anything deleted in the copy (files removed only for the export, like `CLAUDE.md` and `.claude/`, are not deletions), then PR and merge into `main`.

The first round of contract work (offline mode, placeholders, endpoint timing, morphology wrappers, outline shape tests, 512 px outline working resolution, uniform icon scaling) was merged back this way on Nov 2, 2026.

## Adding a new activity type

1. Create `apps/api/src/services/<activity>.ts` with a generator function
2. Handle it in `apps/api/src/app.ts`: a `case` in `switch(spec.activity)` if it fits the maze layout (`buildPdf`), or its own branch plus a builder in `pdf.ts`, like cutting and word-search
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