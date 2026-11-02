# worksheet-app

Printable learning worksheets personalised to a child's interests.

Type what a child is into (dinosaurs, fire trucks, a favourite cartoon), pick an activity, and the
app returns a print-ready PDF built around it. It is for parents and teachers who want activity
sheets a particular child will actually want to do. Today it makes mazes, word searches and
cutting-practice sheets; the child's name (optional) goes in the title, and an uploaded photo can
stand in for the generated picture.

AI image generation (fal.ai) supplies the artwork. The puzzles, the cutting outline and the PDF
layout are generated in code.

**Live:** https://worksheet-app.pages.dev. The API is on Render's free tier, so the first request
after a quiet spell can take 30–60 s while it wakes up.

Planned work is listed in [ROADMAP.md](ROADMAP.md).

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React + TypeScript + Tailwind |
| API | Hono on Node (Render in production) |
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

# Copy env file and fill in your fal.ai key
cp apps/api/.env.example apps/api/.env

# Start both frontend and API in parallel
pnpm dev

# …or run without a fal.ai key: every image is a placeholder (see "Offline mode")
pnpm dev:offline
```

Frontend runs at http://localhost:5173  
API runs at http://localhost:3001

## Offline mode

Image generation and background removal use fal.ai, which is a paid API. Set `OFFLINE=1`
(`pnpm dev:offline` does this for you) to run and test the whole pipeline without a key.

| Mode | `FAL_API_KEY` | Behaviour when an image is needed |
|---|---|---|
| default (`OFFLINE` unset) | set | fal.ai is called |
| default (`OFFLINE` unset) | missing | `500 { "error": "FAL_API_KEY is not set" }` — never a silent placeholder |
| offline (`OFFLINE=1`) | set or missing | fal.ai is never called; a placeholder image is used and a real PDF is produced |

`GET /health` reports `"offline": true|false` so you can tell which mode the API is in.

In offline mode the image is replaced by one of six static placeholders in
`apps/api/src/assets/placeholders/`, one per workflow and source:

| Workflow | No photo uploaded | Photo uploaded |
|---|---|---|
| Maze | `maze-system-generated.png` (1024×1024) | `maze-user-uploaded.png` (1024×768) |
| Word search | `word-search-system-generated.png` (1024×1024) | `word-search-user-uploaded.png` (1024×768) |
| Cutting | `cutting-system-generated.png` (1024×1024, transparent) | `cutting-user-uploaded.png` (880×880, transparent) |

- Maze and word-search placeholders are opaque and labelled with their workflow and source. A thick
  border and coloured corner markers show exactly where the image edge lands; a centred circle turns
  into an ellipse if the image is stretched; the crosshair reveals cropping. "User uploaded" variants
  are 4:3 so non-uniform scaling of photo-shaped input is visible.
- Cutting placeholders have no border. They are a filled circle on a transparent background, so the
  traced cutting line can be checked against a known shape (it should be a concentric dashed circle).
- Offline mode cannot remove backgrounds, so a cutting photo **without** a transparent background is
  rejected with `400`. Maze and word-search uploads are always accepted (the placeholder is used).

To change the placeholder design, edit and re-run the generator (it rasterises SVG with `sharp`,
which needs a system font — that is why the PNGs are committed rather than rendered at runtime):

```bash
cd apps/api
npx tsx src/scripts/generatePlaceholders.ts
```

## Environment variables

`apps/api/.env`:
```
FAL_API_KEY=your_key_here        # get one at fal.ai — required unless OFFLINE=1
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
OFFLINE=1                        # optional: use placeholder images, never call fal.ai
```

`apps/frontend/.env`:
```
VITE_API_URL=http://localhost:3001
```

## Endpoint timing

Request timing is implemented as a cross-cutting concern rather than inside the handlers:

- `apps/api/src/lib/timing.ts` — `serverTiming()` Hono middleware times every request and publishes
  the result as a standard [`Server-Timing`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing)
  header (also visible in browser DevTools → Network → Timing). `timed(name, fn)` wraps any async
  function so its duration is attributed to the current request via `AsyncLocalStorage`; the
  wrappers are applied once in `app.ts`, so the services know nothing about timing.

  ```
  server-timing: image;dur=2.2, outline;dur=664.7, pdf;dur=171.5, total;dur=853.6
  ```

- `apps/api/src/test/endpointTiming.ts` — `recordEndpointTiming(res, scenario)` parses that header
  onto the running test's `task.meta`. The route tests call it from their request helper.
- `apps/api/src/test/timingReporter.ts` — a Vitest reporter that aggregates every sample at the
  end of the run, prints a per-scenario table (min / median / max and per-stage medians) and writes
  `apps/api/test-output/endpoint-timings.{json,md}` (gitignored).

Numbers captured while other test files compete for CPU are noisy. For stable figures run the
endpoint tests on their own, serially:

```bash
pnpm --filter @worksheet/api test:timing
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
│           ├── index.ts           # Entry point: loads .env and starts the server
│           ├── app.ts             # Route handlers (thin controllers) — imported by tests
│           ├── lib/
│           │   ├── offline.ts           # isOfflineMode() — reads OFFLINE=1
│           │   ├── fal.ts               # requireFalApiKey() — single gate for every fal.ai call
│           │   ├── errors.ts            # AppError with HTTP status (FalApiKeyMissingError, InvalidImageError)
│           │   └── timing.ts            # Server-Timing middleware + timed() wrapper (see "Endpoint timing")
│           ├── test/
│           │   ├── outlineShapes.ts     # Subject shapes shared by the outline tests and the gallery
│           │   ├── endpointTiming.ts    # Records a response's Server-Timing on the current test
│           │   └── timingReporter.ts    # Vitest reporter: aggregates timings → test-output/
│           ├── assets/placeholders/     # Six offline-mode PNGs (see "Offline mode")
│           ├── services/
│           │   ├── maze.ts              # Maze generator + SVG renderer
│           │   ├── icons.ts             # Cache-first icon service (maze + word-search worksheets)
│           │   ├── cuttingIcon.ts       # Ideogram text-to-image for cutting worksheets
│           │   ├── backgroundRemoval.ts # fal-ai/birefnet/v2 + subject normalisation
│           │   ├── morphology.ts        # grow/shrink/close/open masks with sharp, convention-safe
│           │   ├── placeholders.ts      # Loads the offline placeholder images
│           │   ├── outline.ts           # Cutting outline: distance-transform contour tracer
│           │   └── pdf.ts               # PDFKit worksheet builder
│           └── scripts/
│               ├── test-images/          # Input PNGs for the debug scripts (PNGs gitignored)
│               ├── test-output/          # Artifacts written here (gitignored)
│               ├── generatePlaceholders.ts # Regenerate assets/placeholders/*.png
│               ├── outlineGallery.ts     # Visual contact sheet of cutting outlines (see "Verifying the cutting outline")
│               ├── generateTestImage.ts  # Fetch a real AI image into test-images/
│               └── testOutline.ts        # Step-by-step debugger for the original sharp + potrace outline
└── packages/
    └── shared/
        └── src/
            └── types.ts   # WorksheetSpec + all shared types (Zod)
```

## Adding a new activity type

1. Add the generator in `apps/api/src/services/` (e.g. `tracing.ts`)
2. Handle it in `apps/api/src/app.ts` — a case in the `switch` if it uses the standard `buildPdf` layout, or its own branch plus a builder in `services/pdf.ts` (like cutting and word search)
3. Add the value to the `ActivityType` enum in `packages/shared/src/types.ts`
4. Add it to the activity dropdown list in `apps/frontend/src/WorksheetForm.tsx` — the list is hardcoded there, with an `enabled` flag that hides unfinished activities in production

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

### Verifying the cutting outline

Two layers, with different jobs:

1. **Geometry is proven by tests** — `services/outline.shapes.test.ts` traces ten subject shapes
   (circle, square, rotated square, ellipse, off-centre blob, doughnut, star, crescent, dumbbell,
   L-shape) at every difficulty and checks each result against the subject's alpha mask: exactly one
   contour, every subject pixel enclosed, the line never nearer than the margin, hugging at the
   extremes, bounding box = subject + margin, and transparent holes never get a line of their own.
   The shapes live in `src/test/outlineShapes.ts`.

2. **Looks are judged by eye** — the gallery renders the same shapes (plus the offline cutting
   placeholders and any PNGs in `scripts/test-images/`) with the cut line drawn exactly as the PDF
   draws it, one row per subject and one column per difficulty:

   ```bash
   cd apps/api
   pnpm outline:gallery        # → test-output/outline-gallery/contact-sheet.png (+ one PNG per tile)
   ```

   Use it for questions the tests can't answer: is "easy" easy enough, is the dash legible, should a
   deep concavity (e.g. a crescent's mouth) be bridged or cut into. To check real subjects, fetch
   them with `generateTestImage.ts` (needs a key) and re-run the gallery.

### Original outline approach (`testOutline.ts`)

Runs the first version of the cutting outline (sharp `threshold` → sharp `dilate` → potrace) step by step against every PNG in `test-images/`, at all three difficulty levels. Every intermediate mask is written to `test-output/`, plus a `{image}-{difficulty}-6-composite.png` that overlays the traced cut line in red on the original image.

This is not the production pipeline: `services/outline.ts` replaced this approach with a distance-transform contour tracer. The script is kept for reference, which is why `potrace` remains a dev dependency.

**Using sharp's morphology correctly.** Two sharp behaviours are easy to misread, and both bit
the first version of this script (it dilated 28 px *inside* the subject, which is why the production
tracer was rewritten):

1. sharp's `dilate()` / `erode()` treat **dark** pixels as the foreground (libvips' "ink on paper"
   convention — the implementation is an all-zero structuring matrix followed by `invert()`). On a
   white-subject-on-black mask such as an alpha channel, `dilate()` shrinks and `erode()` grows.
2. One `sharp()` instance applies operations in a fixed internal order (threshold → dilate → erode →
   blur → … → negate), not call order, and `negate()` is a flag, not a toggle. `.dilate(r).erode(r)`
   is therefore not a closing, and a negate cannot precede a morphological step in the same instance.

`services/morphology.ts` wraps this as `growMask` / `shrinkMask` / `closeMask` / `openMask` with one
materialised sharp call per step, and `morphology.test.ts` pins sharp's convention so an upgrade that
changes it fails loudly. Note that sharp's structuring element is a square, so offsets bulge at the
corners (`radius·√2` on the diagonal); the production tracer in `services/outline.ts` uses a Euclidean
distance transform instead to get an exact, rounded offset.

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

## License

[MIT](LICENSE)
