import type { MazeCell, MazeData, DifficultyLevel } from '@worksheet/shared'

// ─── Difficulty config ────────────────────────────────────────────────────────

const DIFFICULTY: Record<DifficultyLevel, { cols: number; rows: number }> = {
  easy:   { cols: 6,  rows: 6  },
  medium: { cols: 10, rows: 10 },
  hard:   { cols: 14, rows: 14 },
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Pos = { x: number; y: number }
type Wall = 'top' | 'right' | 'bottom' | 'left'
const OPPOSITE: Record<Wall, Wall> = {
  top: 'bottom', right: 'left', bottom: 'top', left: 'right',
}
const DIRECTIONS: { wall: Wall; dx: number; dy: number }[] = [
  { wall: 'top',    dx:  0, dy: -1 },
  { wall: 'right',  dx:  1, dy:  0 },
  { wall: 'bottom', dx:  0, dy:  1 },
  { wall: 'left',   dx: -1, dy:  0 },
]

// ─── Clearing bounds (pure function of grid size) ─────────────────────────────
// Called by both the generator and the SVG renderer so they always agree.
// Sizes: 3×3 for easy (6×6), 4×4 for medium (10×10), 5×5 for hard (14×14).
// The clearing is always centred and never overlaps start (0,0) or end (n-1,n-1).

function clearingBounds(cols: number, rows: number): { x: number; y: number; size: number } {
  const size = cols <= 6 ? 3 : cols <= 10 ? 4 : 5
  return {
    x: Math.floor((cols - size) / 2),
    y: Math.floor((rows - size) / 2),
    size,
  }
}

// ─── Generator ────────────────────────────────────────────────────────────────

export function generateMaze(difficulty: DifficultyLevel): MazeData {
  const { cols, rows } = DIFFICULTY[difficulty]

  const cells: MazeCell[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => ({
      x, y,
      walls: { top: true, right: true, bottom: true, left: true },
    }))
  )

  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false))

  const start: Pos = { x: 0, y: 0 }
  const end: Pos   = { x: cols - 1, y: rows - 1 }

  // ── Reserve the centre clearing before the backtracker runs ───────────────
  // Pre-marking these cells as visited causes the DFS to treat them as walls,
  // routing corridors around the perimeter of the clearing instead.
  const cl = clearingBounds(cols, rows)
  for (let cy = cl.y; cy < cl.y + cl.size; cy++) {
    for (let cx = cl.x; cx < cl.x + cl.size; cx++) {
      visited[cy][cx] = true
    }
  }

  visited[start.y][start.x] = true
  const stack: Pos[] = [start]

  while (stack.length > 0) {
    const current = stack[stack.length - 1]
    const shuffled = [...DIRECTIONS].sort(() => Math.random() - 0.5)

    const next = shuffled.find(({ dx, dy }) => {
      const nx = current.x + dx
      const ny = current.y + dy
      return nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited[ny][nx]
    })

    if (next) {
      const nx = current.x + next.dx
      const ny = current.y + next.dy
      cells[current.y][current.x].walls[next.wall] = false
      cells[ny][nx].walls[OPPOSITE[next.wall]] = false
      visited[ny][nx] = true
      stack.push({ x: nx, y: ny })
    } else {
      stack.pop()
    }
  }

  // ── Open interior walls of the clearing so it becomes an open room ────────
  // Only the shared wall between two clearing cells is removed; the outer
  // boundary walls (between a clearing cell and a corridor cell) are kept,
  // because the backtracker never carved them.
  for (let cy = cl.y; cy < cl.y + cl.size; cy++) {
    for (let cx = cl.x; cx < cl.x + cl.size; cx++) {
      if (cx + 1 < cl.x + cl.size) {
        cells[cy][cx].walls.right    = false
        cells[cy][cx + 1].walls.left = false
      }
      if (cy + 1 < cl.y + cl.size) {
        cells[cy][cx].walls.bottom   = false
        cells[cy + 1][cx].walls.top  = false
      }
    }
  }

  // ── Carve exactly one opening into the clearing ───────────────────────────
  // Walk every cell on the clearing's perimeter. For each side that faces a
  // valid corridor cell (in-bounds and not in the clearing), add it as a
  // candidate, then pick one at random. This makes the clearing the goal:
  // reachable from exactly one direction, but not a pass-through.
  type Candidate = { cy: number; cx: number; wall: Wall; ny: number; nx: number; nWall: Wall }
  const candidates: Candidate[] = []

  for (let cy = cl.y; cy < cl.y + cl.size; cy++) {
    for (let cx = cl.x; cx < cl.x + cl.size; cx++) {
      const onTop    = cy === cl.y
      const onBottom = cy === cl.y + cl.size - 1
      const onLeft   = cx === cl.x
      const onRight  = cx === cl.x + cl.size - 1

      if (onTop    && cy > 0)
        candidates.push({ cy, cx, wall: 'top',    ny: cy - 1, nx: cx,     nWall: 'bottom' })
      if (onBottom && cy < rows - 1)
        candidates.push({ cy, cx, wall: 'bottom', ny: cy + 1, nx: cx,     nWall: 'top'    })
      if (onLeft   && cx > 0)
        candidates.push({ cy, cx, wall: 'left',   ny: cy,     nx: cx - 1, nWall: 'right'  })
      if (onRight  && cx < cols - 1)
        candidates.push({ cy, cx, wall: 'right',  ny: cy,     nx: cx + 1, nWall: 'left'   })
    }
  }

  const chosen = candidates[Math.floor(Math.random() * candidates.length)]
  cells[chosen.cy][chosen.cx].walls[chosen.wall]    = false
  cells[chosen.ny][chosen.nx].walls[chosen.nWall]   = false

  return { cols, rows, cells, start, end }
}

// ─── SVG renderer ─────────────────────────────────────────────────────────────

export interface MazeSvgResult {
  svg: string
  svgW: number
  svgH: number
  /** Centre of the entry gap in SVG coordinate space */
  entryGap: { svgX: number; svgY: number }
  /** Clearing area in SVG coordinate space — the PDF layer draws the icon here */
  clearing: { svgX: number; svgY: number; svgSize: number }
}

export function mazeToSvg(maze: MazeData): MazeSvgResult {
  const CELL   = 40
  const STROKE = 2.5

  // Minimal padding — labels are drawn by the PDF layer, not embedded in the SVG.
  const PAD = 8

  const mazeW = maze.cols * CELL
  const mazeH = maze.rows * CELL

  const W = mazeW + PAD * 2
  const H = mazeH + PAD * 2

  // Maze grid origin within the SVG canvas
  const OX = PAD
  const OY = PAD

  const lines: string[] = []

  // ── Outer border ──────────────────────────────────────────────────────────
  lines.push(
    `<rect x="${OX}" y="${OY}" width="${mazeW}" height="${mazeH}"
      fill="white" stroke="black" stroke-width="${STROKE}" rx="2"/>`
  )

  // ── Interior walls ────────────────────────────────────────────────────────
  // The clearing cells have walls.right / walls.bottom = false (set in the
  // generator), so they produce no lines here — the clearing stays open.
  for (const row of maze.cells) {
    for (const cell of row) {
      const cx = OX + cell.x * CELL
      const cy = OY + cell.y * CELL

      if (cell.walls.right && cell.x < maze.cols - 1) {
        lines.push(wallLine(cx + CELL, cy, cx + CELL, cy + CELL, STROKE))
      }
      if (cell.walls.bottom && cell.y < maze.rows - 1) {
        lines.push(wallLine(cx, cy + CELL, cx + CELL, cy + CELL, STROKE))
      }
    }
  }

  // ── Entrance gap — left wall of the start cell (always top-left) ──────────
  const entWallX = OX
  const entCellY = OY + maze.start.y * CELL
  lines.push(
    `<line x1="${entWallX}" y1="${entCellY + 6}" x2="${entWallX}" y2="${entCellY + CELL - 6}"
      stroke="white" stroke-width="${STROKE + 2}"/>`
  )
  const entryGap = { svgX: entWallX, svgY: entCellY + CELL / 2 }

  // ── Clearing bounds in SVG coordinate space ───────────────────────────────
  const cl = clearingBounds(maze.cols, maze.rows)
  const clearSvgX    = OX + cl.x * CELL
  const clearSvgY    = OY + cl.y * CELL
  const clearSvgSize = cl.size * CELL

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${lines.join('\n  ')}
</svg>`

  return {
    svg, svgW: W, svgH: H,
    entryGap,
    clearing: { svgX: clearSvgX, svgY: clearSvgY, svgSize: clearSvgSize },
  }
}

function wallLine(x1: number, y1: number, x2: number, y2: number, sw: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
    stroke="black" stroke-width="${sw}" stroke-linecap="square"/>`
}
