import { describe, expect, it } from 'vitest'
import {
  generateWordSearch,
  gridSizeForWords,
  normaliseWordSearchWords,
  wordSearchToSvg,
} from './wordSearch.js'

const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
]

describe('normaliseWordSearchWords', () => {
  it('uppercases, strips non-letters, and deduplicates words', () => {
    expect(normaliseWordSearchWords(['moon', 'space ship', 'Moon', 'R2-D2'])).toEqual([
      'MOON',
      'SPACESHIP',
      'RD',
    ])
  })
})

describe('gridSizeForWords', () => {
  it('grows as more words are added', () => {
    const few = gridSizeForWords(['CAT', 'DOG'])
    const many = gridSizeForWords(['CAT', 'DOG', 'MOON', 'ROCKET', 'PLANET', 'STAR', 'COMET', 'ASTEROID'])
    expect(many).toBeGreaterThan(few)
  })

  it('is at least two cells larger than the longest word', () => {
    expect(gridSizeForWords(['SUPERCALIFRAGILISTIC'])).toBeGreaterThanOrEqual(22)
  })
})

describe('generateWordSearch', () => {
  it('places every word in the generated grid', () => {
    const puzzle = generateWordSearch(['moon', 'rocket', 'star', 'planet'], 'space', 'hard')

    expect(puzzle.grid).toHaveLength(puzzle.size)
    puzzle.grid.forEach(row => expect(row).toHaveLength(puzzle.size))

    for (const word of puzzle.words) {
      expect(gridContainsWord(puzzle.grid, word)).toBe(true)
    }
  })

  it('throws when no usable words are provided', () => {
    expect(() => generateWordSearch(['123', '---'], 'numbers', 'easy')).toThrow(/at least one word/i)
  })
})

describe('wordSearchToSvg', () => {
  it('renders a printable SVG with the theme and word bank', () => {
    const puzzle = generateWordSearch(['moon', 'rocket'], 'space', 'easy')
    const svg = wordSearchToSvg(puzzle)
    expect(svg.trim()).toMatch(/^<svg /)
    expect(svg).toContain('Find the space words')
    expect(svg).toContain('MOON')
    expect(svg).toContain('ROCKET')
  })
})

function gridContainsWord(grid: string[][], word: string): boolean {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      for (const direction of DIRECTIONS) {
        if (matchesAt(grid, word, x, y, direction.dx, direction.dy)) return true
      }
    }
  }

  return false
}

function matchesAt(grid: string[][], word: string, x: number, y: number, dx: number, dy: number): boolean {
  const endX = x + dx * (word.length - 1)
  const endY = y + dy * (word.length - 1)
  if (endX < 0 || endX >= grid.length || endY < 0 || endY >= grid.length) return false

  for (let i = 0; i < word.length; i++) {
    if (grid[y + dy * i][x + dx * i] !== word[i]) return false
  }

  return true
}
