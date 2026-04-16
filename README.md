# worksheet-app

Printable learning worksheets personalised to a child's interests.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React + TypeScript + Tailwind |
| API | Hono on Node (dev) / Cloudflare Workers (prod) |
| PDF | PDFKit + svg-to-pdfkit |
| Icons | fal.ai (AI generation) with in-memory cache |
| Shared types | Zod schemas in `packages/shared` |
| Monorepo | pnpm workspaces |

## Setup

```bash
# Prerequisites: Node 20+, pnpm 9+
npm install -g pnpm

# Install all dependencies
pnpm install

# Copy env file and fill in your fal.ai key (optional for dev — placeholder icons work without it)
cp apps/api/.env.example apps/api/.env

# Start both frontend and API in parallel
pnpm dev
```

Frontend runs at http://localhost:5173  
API runs at http://localhost:3001

## Environment variables

`apps/api/.env`:
```
FAL_API_KEY=your_key_here        # get one free at fal.ai
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

`apps/frontend/.env`:
```
VITE_API_URL=http://localhost:3001
```

## Project structure

```
worksheet-app/
├── apps/
│   ├── frontend/          # Vite + React UI
│   │   └── src/
│   │       └── WorksheetForm.tsx
│   └── api/               # Hono API
│       └── src/
│           ├── index.ts           # Route handlers (thin controllers)
│           ├── services/
│           │   ├── maze.ts        # Maze generator + SVG renderer
│           │   ├── icons.ts       # Cache-first icon service
│           │   ├── outline.ts     # Cutting outline: alpha → potrace SVG path
│           │   └── pdf.ts         # PDFKit worksheet builder
│           └── scripts/
│               ├── test-images/          # Input PNGs for debugging (gitignored output, .gitkeep tracked)
│               ├── test-output/          # Artifacts written here (gitignored)
│               ├── generateTestImage.ts  # Fetch a real AI image into test-images/
│               └── testOutline.ts        # Step-by-step outline pipeline debugger
└── packages/
    └── shared/
        └── src/
            └── types.ts   # WorksheetSpec + all shared types (Zod)
```

## Adding a new activity type

1. Add the generator in `apps/api/src/services/` (e.g. `tracing.ts`)
2. Add a case to the `switch` in `apps/api/src/index.ts`
3. The frontend activity buttons are driven by the `ActivityType` enum in `packages/shared/src/types.ts` — adding a value there automatically adds it to the UI

## Debug scripts

### Generate a test image (`generateTestImage.ts`)

Fetches a real AI-generated PNG using the exact same Ideogram endpoint, prompt, and parameters as the cutting worksheet pipeline, and saves the unmodified result to `test-images/`. Use this to build up a set of realistic inputs for `testOutline.ts` without having to manually source transparent PNGs.

```bash
cd apps/api
npx tsx src/scripts/generateTestImage.ts dinosaur
npx tsx src/scripts/generateTestImage.ts "fire truck"
```

Requires `FAL_API_KEY` to be set in `apps/api/.env`. The image is saved as `test-images/{interest}.png` (multi-word interests are slugified: `fire truck` → `fire-truck.png`).

**How it works:** calls `fal-ai/ideogram/v3/generate-transparent` with `style_type: GENERAL`, `magic_prompt: OFF`, and `rendering_speed: QUALITY` — the same settings as `services/cuttingIcon.ts`. The image URL returned by Ideogram is fetched and written to disk with no post-processing, so what you see in `test-images/` is exactly what the outline pipeline receives.

### Cutting outline pipeline (`testOutline.ts`)

Runs the cutting-worksheet outline pipeline step-by-step against a folder of test images and saves every intermediate artifact so you can see exactly where it breaks.

```bash
# Drop transparent PNGs into the input folder
apps/api/src/scripts/test-images/

# Run from apps/api
cd apps/api
npx tsx src/scripts/testOutline.ts
```

Artifacts are written to `apps/api/src/scripts/test-output/`, named `{image}-{step}.png/svg`:

| Artifact | What it shows |
|---|---|
| `{name}-1-alpha.png` | Raw extracted alpha channel |
| `{name}-2-threshold.png` | After `threshold(128)` |
| `{name}-3-dilated.png` | After `dilate(N)` (and optional erode) |
| `{name}-4-negated.png` | What potrace actually sees (black = subject) |
| `{name}-{difficulty}-5-potrace.svg` | Raw potrace output |
| `{name}-{difficulty}-6-composite.png` | Original PNG with the cutting line overlaid in red |

The composite (step 6) is the key artifact — it shows whether the outline follows the subject correctly at each difficulty level.

Pipeline parameters are constants at the top of the script (`DILATE`, `ERODE`, `TURD_SIZE`, `OPT_TOLERANCE`) — tweak and re-run to iterate quickly.

## Deploying

```bash
# Frontend → Cloudflare Pages (auto-deploys on push to main)
pnpm --filter @worksheet/frontend build
# Build output: apps/frontend/dist

# API → Render (auto-deploys on push to main)
# Build command: cd ../.. && pnpm install && pnpm --filter @worksheet/api build
# Start command: node dist/index.js
```
