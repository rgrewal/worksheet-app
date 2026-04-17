import type { DifficultyLevel, WordSearchData } from '@worksheet/shared'

type Direction = { dx: number; dy: number }
type Position = { x: number; y: number }

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const MAX_GRID_SIZE = 32

const DIRECTIONS_BY_DIFFICULTY: Record<DifficultyLevel, Direction[]> = {
  easy: [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ],
  medium: [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
  ],
  hard: [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 },
  ],
}

export function normaliseWordSearchWords(words: string[]): string[] {
  const seen = new Set<string>()
  const normalised: string[] = []

  for (const word of words) {
    const letters = word.toUpperCase().replace(/[^A-Z]/g, '')
    if (!letters || seen.has(letters)) continue
    seen.add(letters)
    normalised.push(letters)
  }

  return normalised
}

export function gridSizeForWords(words: string[]): number {
  const longest = Math.max(...words.map(word => word.length), 0)
  const totalLetters = words.reduce((sum, word) => sum + word.length, 0)
  const wordCountSize = 8 + Math.ceil(words.length * 0.85)
  const densitySize = Math.ceil(Math.sqrt(totalLetters * 2.4))
  return clamp(Math.max(longest + 2, wordCountSize, densitySize), 8, MAX_GRID_SIZE)
}

export function generateWordSearch(words: string[], theme: string, difficulty: DifficultyLevel): WordSearchData {
  const normalised = normaliseWordSearchWords(words)
  if (normalised.length === 0) {
    throw new Error('Word search requires at least one word')
  }

  const sortedWords = [...normalised].sort((a, b) => b.length - a.length)
  let size = gridSizeForWords(sortedWords)

  for (; size <= MAX_GRID_SIZE; size++) {
    const grid = emptyGrid(size)
    if (tryPlaceWords(grid, sortedWords, difficulty)) {
      fillEmptyCells(grid, theme, sortedWords)

      return {
        size,
        grid: grid.map(row => row.map(cell => cell ?? randomLetter())),
        words: sortedWords,
        theme: theme.trim(),
      }
    }
  }

  throw new Error('Could not place all word search words')
}

export function wordSearchToSvg(wordSearch: WordSearchData): string {
  const CELL = 30
  const PAD = 18
  const WORD_BANK_TOP = PAD + wordSearch.size * CELL + 42
  const WORD_BANK_COLS = wordSearch.words.length > 12 ? 3 : 2
  const WORD_BANK_COL_W = 170
  const WORD_BANK_ROWS = Math.ceil(wordSearch.words.length / WORD_BANK_COLS)
  const W = Math.max(PAD * 2 + wordSearch.size * CELL, PAD * 2 + WORD_BANK_COLS * WORD_BANK_COL_W)
  const H = WORD_BANK_TOP + WORD_BANK_ROWS * 24 + PAD
  const OX = (W - wordSearch.size * CELL) / 2
  const OY = PAD
  const theme = escapeXml(wordSearch.theme || 'word search')
  const letters: string[] = []
  const wordBank: string[] = []

  for (let y = 0; y < wordSearch.size; y++) {
    for (let x = 0; x < wordSearch.size; x++) {
      const px = OX + x * CELL
      const py = OY + y * CELL
      const fill = (x + y) % 2 === 0 ? '#f8fafc' : '#ffffff'
      letters.push(`<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" fill="${fill}" stroke="#111111" stroke-width="1"/>`)
      letters.push(`<text x="${px + CELL / 2}" y="${py + 20.5}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="700" fill="#111111">${wordSearch.grid[y][x]}</text>`)
    }
  }

  wordSearch.words.forEach((word, index) => {
    const col = index % WORD_BANK_COLS
    const row = Math.floor(index / WORD_BANK_COLS)
    const x = PAD + col * WORD_BANK_COL_W
    const y = WORD_BANK_TOP + row * 24
    wordBank.push(`<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#111111">${escapeXml(word)}</text>`)
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${W / 2}" y="${OY - 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#666666">Find the ${theme} words</text>
  ${letters.join('\n  ')}
  <text x="${PAD}" y="${WORD_BANK_TOP - 20}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="#111111">Words to find</text>
  ${wordBank.join('\n  ')}
</svg>`
}

function tryPlaceWords(grid: (string | null)[][], words: string[], difficulty: DifficultyLevel): boolean {
  for (const word of words) {
    if (!placeWord(grid, word, difficulty)) return false
  }
  return true
}

function placeWord(grid: (string | null)[][], word: string, difficulty: DifficultyLevel): boolean {
  const directions = DIRECTIONS_BY_DIFFICULTY[difficulty]

  for (let attempt = 0; attempt < 400; attempt++) {
    const direction = directions[Math.floor(Math.random() * directions.length)]
    const start = randomStart(grid.length)
    if (!canPlaceWord(grid, word, start, direction)) continue
    writeWord(grid, word, start, direction)
    return true
  }

  return false
}

function canPlaceWord(grid: (string | null)[][], word: string, start: Position, direction: Direction): boolean {
  const endX = start.x + direction.dx * (word.length - 1)
  const endY = start.y + direction.dy * (word.length - 1)
  if (!inBounds(grid.length, endX, endY)) return false

  for (let i = 0; i < word.length; i++) {
    const x = start.x + direction.dx * i
    const y = start.y + direction.dy * i
    const existing = grid[y][x]
    if (existing && existing !== word[i]) return false
  }

  return true
}

function writeWord(grid: (string | null)[][], word: string, start: Position, direction: Direction) {
  for (let i = 0; i < word.length; i++) {
    const x = start.x + direction.dx * i
    const y = start.y + direction.dy * i
    grid[y][x] = word[i]
  }
}

function fillEmptyCells(grid: (string | null)[][], theme: string, words: string[]) {
  const themeLetters = normaliseWordSearchWords([theme]).join('')
  const wordLetters = words.join('')
  const letterPool = `${themeLetters}${wordLetters}${ALPHABET}` || ALPHABET

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      if (!grid[y][x]) {
        grid[y][x] = letterPool[Math.floor(Math.random() * letterPool.length)]
      }
    }
  }
}

function emptyGrid(size: number): (string | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null))
}

function randomStart(size: number): Position {
  return {
    x: Math.floor(Math.random() * size),
    y: Math.floor(Math.random() * size),
  }
}

function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && x < size && y >= 0 && y < size
}

function randomLetter(): string {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
