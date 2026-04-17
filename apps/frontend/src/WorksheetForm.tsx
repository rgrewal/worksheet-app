import { useState, useRef } from 'react'
import type { WorksheetSpec } from '@worksheet/shared'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Status = 'idle' | 'loading' | 'done' | 'error'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition'
const labelCls = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5'

function splitWordSearchWords(value: string) {
  return value
    .split(',')
    .map(word => word.trim())
    .filter(Boolean)
}

function mergeWordSearchWords(existing: string[], value: string) {
  const seen = new Set(existing.map(word => word.toLowerCase()))
  const words = [...existing]

  for (const word of splitWordSearchWords(value)) {
    const key = word.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      words.push(word)
    }
  }

  return words
}

export default function WorksheetForm() {
  const [interest, setInterest]               = useState('')
  const [activity, setActivity]               = useState<WorksheetSpec['activity']>('maze')
  const [difficulty, setDifficulty]           = useState<WorksheetSpec['difficulty']>('easy')
  const [childName, setChildName]             = useState('')
  const [referenceImage, setReferenceImage]   = useState<string | null>(null)
  const [imageFileName, setImageFileName]     = useState<string>('')
  const [wordSearchInput, setWordSearchInput] = useState('')
  const [wordSearchWords, setWordSearchWords] = useState<string[]>([])
  const [status, setStatus]                   = useState<Status>('idle')
  const [pdfUrl, setPdfUrl]                   = useState<string | null>(null)
  const [errorMsg, setErrorMsg]               = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function loadFile(file: File) {
    setImageFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => setReferenceImage(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
  }

  function clearImage() {
    setReferenceImage(null)
    setImageFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addWordSearchWords(value: string) {
    setWordSearchWords(words => mergeWordSearchWords(words, value))
  }

  function removeWordSearchWord(wordToRemove: string) {
    setWordSearchWords(words => words.filter(word => word !== wordToRemove))
  }

  function handleWordSearchInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value

    if (!value.includes(',')) {
      setWordSearchInput(value)
      return
    }

    const parts = value.split(',')
    addWordSearchWords(parts.slice(0, -1).join(','))
    setWordSearchInput(parts[parts.length - 1] ?? '')
  }

  function handleWordSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (wordSearchInput.trim()) {
        addWordSearchWords(wordSearchInput)
        setWordSearchInput('')
      }
      return
    }

    if (e.key === 'Backspace' && !wordSearchInput && wordSearchWords.length > 0) {
      setWordSearchWords(words => words.slice(0, -1))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!interest.trim()) return

    const submittedWordSearchWords = activity === 'word-search'
      ? mergeWordSearchWords(wordSearchWords, wordSearchInput)
      : []

    if (activity === 'word-search' && submittedWordSearchWords.length === 0) return

    setStatus('loading')
    setPdfUrl(null)
    setErrorMsg('')
    setWordSearchWords(submittedWordSearchWords)
    setWordSearchInput('')

    try {
      const spec: WorksheetSpec = {
        interest: interest.trim(),
        activity,
        difficulty,
        ...(childName.trim() ? { childName: childName.trim() } : {}),
        ...(referenceImage ? { referenceImageDataUrl: referenceImage } : {}),
        ...(activity === 'word-search' ? { wordSearchWords: submittedWordSearchWords } : {}),
      }

      const res = await fetch(`${API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Unknown error')
      }

      const blob = await res.blob()
      setPdfUrl(URL.createObjectURL(blob))
      setStatus('done')
    } catch (err) {
      setErrorMsg(String(err))
      setStatus('error')
    }
  }

  const canSubmit = status !== 'loading'
    && (interest.trim().length > 0 || !!referenceImage)
    && (activity !== 'word-search' || wordSearchWords.length > 0 || wordSearchInput.trim().length > 0)

  const interestPlaceholder = referenceImage
    ? 'e.g. Siren Head, Labubu, our dog Rex'
    : 'e.g. lawnmowers, garbage trucks, dinosaurs'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">

      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Worksheet maker</h1>
          <p className="mt-1 text-sm text-gray-500">Generate a personalised activity sheet in seconds.</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-5">

            <div>
              <label className={labelCls}>
                What do they love?
                {referenceImage && <span className="normal-case font-normal text-gray-400 tracking-normal"> (optional)</span>}
              </label>
              <input
                type="text"
                value={interest}
                onChange={e => setInterest(e.target.value)}
                placeholder={interestPlaceholder}
                className={inputCls}
                required={!referenceImage}
              />
            </div>

            <div>
              <label className={labelCls}>Child's name <span className="normal-case font-normal text-gray-400 tracking-normal">(optional)</span></label>
              <input
                type="text"
                value={childName}
                onChange={e => setChildName(e.target.value)}
                placeholder="e.g. Sam"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Activity</label>
                <select
                  value={activity}
                  onChange={e => setActivity(e.target.value as WorksheetSpec['activity'])}
                  className={inputCls}
                >
                  {([
                    { value: 'maze',     label: 'Maze',     enabled: true },
                    { value: 'cutting',  label: 'Cutting',  enabled: true },
                    { value: 'word-search', label: 'Word Search', enabled: true },
                    { value: 'counting', label: 'Counting', enabled: !import.meta.env.PROD },
                    { value: 'tracing',  label: 'Tracing',  enabled: !import.meta.env.PROD },
                    { value: 'matching', label: 'Matching', enabled: !import.meta.env.PROD },
                  ] as const).filter(a => a.enabled).map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Difficulty</label>
                <select
                  value={difficulty}
                  onChange={e => setDifficulty(e.target.value as WorksheetSpec['difficulty'])}
                  className={inputCls}
                >
                  {(['easy', 'medium', 'hard'] as const).map(d => (
                    <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            {activity === 'word-search' && (
              <div>
                <label className={labelCls}>Words</label>
                <div className="flex min-h-[46px] w-full flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500">
                  {wordSearchWords.map(word => (
                    <span key={word} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-sm text-indigo-700">
                      {word}
                      <button
                        type="button"
                        onClick={() => removeWordSearchWord(word)}
                        className="text-indigo-400 hover:text-red-500"
                        aria-label={`Remove ${word}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={wordSearchInput}
                    onChange={handleWordSearchInputChange}
                    onKeyDown={handleWordSearchKeyDown}
                    onBlur={() => {
                      if (wordSearchInput.trim()) {
                        addWordSearchWords(wordSearchInput)
                        setWordSearchInput('')
                      }
                    }}
                    placeholder={wordSearchWords.length ? 'Add another word' : 'e.g. cat, moon, robot'}
                    className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-400">Separate words with commas.</p>
              </div>
            )}

            <div>
              <label className={labelCls}>Reference photo <span className="normal-case font-normal text-gray-400 tracking-normal">(optional)</span></label>
              {!referenceImage ? (
                <div>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => {
                      e.preventDefault()
                      setDragOver(false)
                      const file = e.dataTransfer.files?.[0]
                      if (file) loadFile(file)
                    }}
                    className={`mb-2 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'}`}
                  >
                    <p className="text-sm text-gray-500">Drag a photo here</p>
                    <p className="text-xs text-gray-400">JPG, PNG or WEBP</p>
                  </div>
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg cursor-pointer text-sm text-gray-600 bg-white shadow-sm hover:border-indigo-400 hover:text-indigo-600 transition">
                    Choose file
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                  <img src={referenceImage} alt="Reference" className="w-10 h-10 object-cover rounded-md flex-shrink-0" />
                  <p className="flex-1 text-sm text-gray-700 truncate">{imageFileName}</p>
                  <button type="button" onClick={clearImage} className="text-xs text-gray-400 hover:text-red-500 transition flex-shrink-0">
                    Remove
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition mt-1"
            >
              {status === 'loading' ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Generating…
                </span>
              ) : 'Make worksheet'}
            </button>

          </form>
        </div>

        {/* Result */}
        {status === 'done' && pdfUrl && (
          <div className="mt-4 bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-800 mb-3">Your worksheet is ready</p>
            <div className="flex gap-3">
              <a href={pdfUrl} target="_blank" rel="noreferrer"
                className="flex-1 text-center bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition">
                Open PDF
              </a>
              <a href={pdfUrl} download={`${interest}-${activity}.pdf`}
                className="flex-1 text-center border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-lg transition">
                Download
              </a>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-4 border border-red-200 bg-red-50 rounded-xl p-4">
            <p className="text-sm text-red-700">{errorMsg}</p>
          </div>
        )}

      </div>
      <p className="mt-4 text-xs text-gray-400">v-{__GIT_HASH__}</p>
    </div>
  )
}
