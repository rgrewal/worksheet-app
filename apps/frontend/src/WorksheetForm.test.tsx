import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorksheetForm from './WorksheetForm'

// URL.createObjectURL is not implemented in jsdom
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:fake'), writable: true })

describe('WorksheetForm - submit button state', () => {
  it('is disabled when interest is empty', () => {
    render(<WorksheetForm />)
    expect(screen.getByRole('button', { name: /make worksheet/i })).toBeDisabled()
  })

  it('is enabled after interest is typed', async () => {
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    expect(screen.getByRole('button', { name: /make worksheet/i })).toBeEnabled()
  })
})

describe('WorksheetForm - image upload flow', () => {
  let fileReaderInstance: { onload: ((e: any) => void) | null; readAsDataURL: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    fileReaderInstance = {
      onload: null,
      readAsDataURL: vi.fn(function (this: typeof fileReaderInstance) {
        Promise.resolve().then(() => {
          if (this.onload) {
            this.onload({ target: { result: 'data:image/jpeg;base64,abc' } } as any)
          }
        })
      }),
    }
    vi.spyOn(globalThis, 'FileReader').mockImplementation(() => fileReaderInstance as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function triggerImageUpload() {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, new File(['x'], 'test.jpg', { type: 'image/jpeg' }))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  it('Remove button resets image state', async () => {
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    await triggerImageUpload()
    await user.click(screen.getByRole('button', { name: /remove/i }))
    // Button should be enabled again (interest is still filled, no image requiring rights)
    expect(screen.getByRole('button', { name: /make worksheet/i })).toBeEnabled()
  })
})

describe('WorksheetForm - API response states', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows Generating… and disables submit while request is in-flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    await user.click(screen.getByRole('button', { name: /make worksheet/i }))
    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled()
  })

  it('shows error message when API returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'something broke' }),
    }))
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    await user.click(screen.getByRole('button', { name: /make worksheet/i }))
    expect(await screen.findByText(/something broke/i)).toBeInTheDocument()
  })

  it('shows Open PDF and Download links after successful generation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
    }))
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    await user.click(screen.getByRole('button', { name: /make worksheet/i }))
    expect(await screen.findByText(/open pdf/i)).toBeInTheDocument()
    expect(screen.getByText(/download/i)).toBeInTheDocument()
  })
})
