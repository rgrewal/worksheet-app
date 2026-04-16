import { z } from 'zod'

export const ActivityType = z.enum(['maze', 'cutting', 'tracing', 'counting', 'matching'])
export type ActivityType = z.infer<typeof ActivityType>

export const DifficultyLevel = z.enum(['easy', 'medium', 'hard'])
export type DifficultyLevel = z.infer<typeof DifficultyLevel>

export const WorksheetSpec = z.object({
  // Optional when referenceImageDataUrl is provided; required otherwise.
  interest: z.string().max(100).default(''),
  activity: ActivityType,
  difficulty: DifficultyLevel.default('easy'),
  childName: z.string().max(50).optional(),
  // base64-encoded image data URI — e.g. "data:image/jpeg;base64,..."
  // When provided, interest becomes optional.
  referenceImageDataUrl: z.string().optional(),
}).refine(
  (data) => data.interest.trim().length > 0 || !!data.referenceImageDataUrl,
  { message: 'Interest is required when no reference photo is provided', path: ['interest'] },
)
export type WorksheetSpec = z.infer<typeof WorksheetSpec>

export interface Icon {
  url: string
  label: string
  cached: boolean
}

export interface MazeCell {
  x: number
  y: number
  walls: { top: boolean; right: boolean; bottom: boolean; left: boolean }
}

export interface MazeData {
  cols: number
  rows: number
  cells: MazeCell[][]
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export interface CountingData {
  targetCount: number
  decoyCount: number
  gridCols: number
}

export interface TracingData {
  path: string
  viewBoxWidth: number
  viewBoxHeight: number
}

export interface MatchingPair {
  id: string
  label: string
}

export interface MatchingData {
  pairs: MatchingPair[]
}

export interface CuttingData {
  lineCount: number
  patterns: Array<'straight' | 'zigzag' | 'wave'>
}

export type ActivityData = MazeData | CountingData | TracingData | MatchingData | CuttingData

export interface Worksheet {
  spec: WorksheetSpec
  icon: Icon
  data: ActivityData
  generatedAt: string
}

export interface GenerateResponse {
  pdfUrl: string
  expiresAt: string
}

export interface ErrorResponse {
  error: string
  details?: string
}
