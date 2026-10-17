# worksheet-app

Printable learning worksheets personalised to a child's interests.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React + TypeScript + Tailwind |
| API | Hono on Node (dev) / Cloudflare Workers (prod) |
| PDF | PDFKit + svg-to-pdfkit |
| Icons | fal.ai (Ideogram text-to-image + Birefnet background removal) with in-memory cache |
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
│           │   ├── maze.ts              # Maze generator + SVG renderer
│           │   ├── icons.ts             # Cache-first icon service (maze worksheets)
│           │   ├── cuttingIcon.ts       # Ideogram text-to-image for cutting worksheets
│           │   ├── backgroundRemoval.ts # fal-ai/birefnet/v2 + subject normalisation
│           │   ├── outline.ts           # Cutting outline: distance-transform contour tracer
│           │   └── pdf.ts               # PDFKit worksheet builder
│           └── scripts/
│               ├── test-images/          # Input PNGs for the debug scripts (PNGs gitignored)
│               ├── test-output/          # Artifacts written here (gitignored)
│               ├── generateTestImage.ts  # Fetch a real AI image into test-images/
│               └── testOutline.ts        # Step-by-step debugger for the original sharp + potrace outline
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

### Original outline approach (`testOutline.ts`)

Runs the first version of the cutting outline (sharp `threshold` → sharp `dilate` → potrace) step by step against every PNG in `test-images/`, at all three difficulty levels. Every intermediate mask is written to `test-output/`, plus a `{image}-{difficulty}-6-composite.png` that overlays the traced cut line in red on the original image.

This is not the production pipeline: `services/outline.ts` replaced this approach with a distance-transform contour tracer. The script is kept for reference, which is why `potrace` remains a dev dependency.

Note: on a white-on-black mask, sharp's `dilate()` shrinks the shape and `erode()` grows it — compare `{image}-2-threshold.png` with `{image}-{difficulty}-3-dilated.png`.

```bash
# Drop transparent PNGs into the input folder
apps/api/src/scripts/test-images/

# Run from apps/api
cd apps/api
npx tsx src/scripts/testOutline.ts
```

## Cutting worksheet — user photo flow

When a user uploads a reference photo for a cutting worksheet, the API runs it through a background-removal pipeline before generating the cutting outline:

1. **Transparency check** — if the image already has significant transparent pixels (e.g. it was exported with a transparent background), the bg-removal step is skipped.
2. **Background removal** — `fal-ai/birefnet/v2` isolates the foreground subject and returns a transparent-background PNG.
3. **Normalisation** — the subject is cropped to its bounding box, padded proportionally, and resized if over 1800 px.
4. **Outline tracing** — the distance-transform contour tracer in `services/outline.ts` generates a dashed cutting path scaled to the chosen difficulty level.

If no photo is uploaded, the cutting icon is generated from the interest text via Ideogram (`services/cuttingIcon.ts`) and follows the same outline/PDF steps.

## Deploying

```bash
# Frontend → Cloudflare Pages (auto-deploys on push to main)
pnpm --filter @worksheet/frontend build
# Build output: apps/frontend/dist

# API → Render (auto-deploys on push to main)
# Build command: cd ../.. && pnpm install && pnpm --filter @worksheet/api build
# Start command: node dist/index.js
```
