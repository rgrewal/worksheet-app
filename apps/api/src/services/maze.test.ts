import { describe, it, expect } from 'vitest'
import { generateMaze, mazeToSvg } from './maze.js'
import type { DifficultyLevel } from '@worksheet/shared'

describe.each([
  ['easy',   6,  6 ] as const,
  ['medium', 10, 10] as const,
  ['hard',   14, 14] as const,
])('generateMaze("%s")', (difficulty, expectedCols, expectedRows) => {
  const maze = generateMaze(difficulty as DifficultyLevel)

  it('returns correct cols and rows', () => {
    expect(maze.cols).toBe(expectedCols)
    expect(maze.rows).toBe(expectedRows)
  })

  it('cells array has correct dimensions', () => {
    expect(maze.cells).toHaveLength(expectedRows)
    maze.cells.forEach(row => expect(row).toHaveLength(expectedCols))
  })

  it('cell x/y coordinates match their array position', () => {
    for (let y = 0; y < expectedRows; y++) {
      for (let x = 0; x < expectedCols; x++) {
        expect(maze.cells[y][x]).toMatchObject({ x, y })
      }
    }
  })
})

describe('generateMaze - start and end positions', () => {
  it('start is always top-left (0,0)', () => {
    const maze = generateMaze('easy')
    expect(maze.start).toEqual({ x: 0, y: 0 })
  })

  it('end is always bottom-right', () => {
    const maze = generateMaze('medium')
    expect(maze.end).toEqual({ x: maze.cols - 1, y: maze.rows - 1 })
  })
})

describe('generateMaze - wall symmetry', () => {
  it.each(['easy', 'medium', 'hard'] as const)('walls are symmetric for %s difficulty', (difficulty) => {
    const maze = generateMaze(difficulty)
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (x < maze.cols - 1) {
          expect(maze.cells[y][x].walls.right).toBe(maze.cells[y][x + 1].walls.left)
        }
        if (y < maze.rows - 1) {
          expect(maze.cells[y][x].walls.bottom).toBe(maze.cells[y + 1][x].walls.top)
        }
      }
    }
  })
})

describe('generateMaze - full connectivity', () => {
  it.each(['easy', 'medium', 'hard'] as const)('all cells are reachable from start in %s maze', (difficulty) => {
    const maze = generateMaze(difficulty)
    const visited = new Set<string>()
    const queue = [maze.start]

    while (queue.length > 0) {
      const { x, y } = queue.shift()!
      const key = `${x},${y}`
      if (visited.has(key)) continue
      visited.add(key)
      const cell = maze.cells[y][x]

      if (!cell.walls.top    && y > 0)             queue.push({ x, y: y - 1 })
      if (!cell.walls.right  && x < maze.cols - 1) queue.push({ x: x + 1, y })
      if (!cell.walls.bottom && y < maze.rows - 1) queue.push({ x, y: y + 1 })
      if (!cell.walls.left   && x > 0)             queue.push({ x: x - 1, y })
    }

    expect(visited.size).toBe(maze.cols * maze.rows)
  })
})

describe('mazeToSvg', () => {
  it('returns a string starting with <svg and ending with </svg>', () => {
    const { svg } = mazeToSvg(generateMaze('easy'))
    expect(svg.trim()).toMatch(/^<svg /)
    expect(svg.trim()).toMatch(/<\/svg>$/)
  })

  it('medium maze SVG is wider than easy maze SVG', () => {
    const getWidth = (s: string) => Number(s.match(/width="(\d+)"/)?.[1])
    expect(getWidth(mazeToSvg(generateMaze('medium')).svg)).toBeGreaterThan(
      getWidth(mazeToSvg(generateMaze('easy')).svg)
    )
  })

  it('contains a white stroke line for the entrance gap', () => {
    const { svg } = mazeToSvg(generateMaze('easy'))
    const whiteLines = [...svg.matchAll(/stroke="white"/g)]
    expect(whiteLines.length).toBeGreaterThanOrEqual(1)
  })

  it('contains a white-filled background rect for the maze grid', () => {
    const { svg } = mazeToSvg(generateMaze('easy'))
    expect(svg).toContain('fill="white"')
    expect(svg).toContain('<rect')
  })

  it('returns svgW and svgH dimensions', () => {
    const { svgW, svgH } = mazeToSvg(generateMaze('easy'))
    expect(svgW).toBeGreaterThan(0)
    expect(svgH).toBeGreaterThan(0)
  })

  it('returns entryGap and clearing coordinates', () => {
    const { entryGap, clearing } = mazeToSvg(generateMaze('easy'))
    expect(entryGap.svgX).toBeGreaterThanOrEqual(0)
    expect(entryGap.svgY).toBeGreaterThan(0)
    expect(clearing.svgSize).toBeGreaterThan(0)
  })
})
