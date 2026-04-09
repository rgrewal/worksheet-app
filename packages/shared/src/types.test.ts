import { describe, it, expect } from 'vitest'
import { WorksheetSpec } from './types'

describe('WorksheetSpec', () => {
  it('parses a minimal valid spec and defaults difficulty to easy', () => {
    const result = WorksheetSpec.safeParse({ interest: 'dinosaurs', activity: 'maze' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.difficulty).toBe('easy')
    }
  })

  it('rejects empty interest', () => {
    expect(WorksheetSpec.safeParse({ interest: '', activity: 'maze' }).success).toBe(false)
  })

  it('rejects interest over 100 characters', () => {
    expect(WorksheetSpec.safeParse({ interest: 'a'.repeat(101), activity: 'maze' }).success).toBe(false)
  })

  it('accepts interest of exactly 100 characters', () => {
    expect(WorksheetSpec.safeParse({ interest: 'a'.repeat(100), activity: 'maze' }).success).toBe(true)
  })

  it('rejects childName over 50 characters', () => {
    expect(WorksheetSpec.safeParse({ interest: 'trains', activity: 'maze', childName: 'a'.repeat(51) }).success).toBe(false)
  })

  it('accepts childName of exactly 50 characters', () => {
    expect(WorksheetSpec.safeParse({ interest: 'trains', activity: 'maze', childName: 'a'.repeat(50) }).success).toBe(true)
  })

  it('childName is undefined when omitted', () => {
    const result = WorksheetSpec.safeParse({ interest: 'trains', activity: 'maze' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.childName).toBeUndefined()
    }
  })

  it.each(['maze', 'tracing', 'counting', 'matching'] as const)('accepts activity "%s"', (activity) => {
    expect(WorksheetSpec.safeParse({ interest: 'trains', activity }).success).toBe(true)
  })

  it('rejects an invalid activity value', () => {
    expect(WorksheetSpec.safeParse({ interest: 'trains', activity: 'unknown' }).success).toBe(false)
  })

  it.each(['easy', 'medium', 'hard'] as const)('accepts difficulty "%s"', (difficulty) => {
    expect(WorksheetSpec.safeParse({ interest: 'trains', activity: 'maze', difficulty }).success).toBe(true)
  })

  it('rejects an invalid difficulty value', () => {
    expect(WorksheetSpec.safeParse({ interest: 'trains', activity: 'maze', difficulty: 'extreme' }).success).toBe(false)
  })

  it('passes through referenceImageDataUrl unchanged', () => {
    const result = WorksheetSpec.safeParse({
      interest: 'trains',
      activity: 'maze',
      referenceImageDataUrl: 'data:image/jpeg;base64,abc',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.referenceImageDataUrl).toBe('data:image/jpeg;base64,abc')
    }
  })
})
