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
│           └── services/
│               ├── maze.ts        # Maze generator + SVG renderer
│               ├── icons.ts       # Cache-first icon service
│               └── pdf.ts         # PDFKit worksheet builder
└── packages/
    └── shared/
        └── src/
            └── types.ts   # WorksheetSpec + all shared types (Zod)
```

## Adding a new activity type

1. Add the generator in `apps/api/src/services/` (e.g. `tracing.ts`)
2. Add a case to the `switch` in `apps/api/src/index.ts`
3. The frontend activity buttons are driven by the `ActivityType` enum in `packages/shared/src/types.ts` — adding a value there automatically adds it to the UI

## Deploying to Cloudflare

```bash
# Frontend → Cloudflare Pages (drag-and-drop or Git integration)
pnpm --filter @worksheet/frontend build
# Upload apps/frontend/dist

# API → Cloudflare Workers
cd apps/api
pnpm add -D wrangler
# Replace @hono/node-server import with Cloudflare Workers export (see Hono docs)
npx wrangler deploy
```
