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
    fileReaderInstance = { onload: null, readAsDataURL: vi.fn() }
    vi.spyOn(globalThis, 'FileReader').mockImplementation(() => fileReaderInstance as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function triggerImageUpload() {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, new File(['x'], 'test.jpg', { type: 'image/jpeg' }))
    act(() => {
      fileReaderInstance.onload?.({ target: { result: 'data:image/jpeg;base64,abc' } })
    })
  }

  it('does not show rights checkbox before image upload', () => {
    render(<WorksheetForm />)
    expect(screen.queryByText(/i have the right/i)).not.toBeInTheDocument()
  })

  it('shows rights checkbox after image upload', async () => {
    render(<WorksheetForm />)
    await triggerImageUpload()
    expect(screen.getByText(/i have the right/i)).toBeInTheDocument()
  })

  it('submit button stays disabled when image is uploaded but rights not confirmed', async () => {
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    await triggerImageUpload()
    expect(screen.getByRole('button', { name: /make worksheet/i })).toBeDisabled()
  })

  it('submit button enables after rights are confirmed', async () => {
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    await triggerImageUpload()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /make worksheet/i })).toBeEnabled()
  })

  it('Remove button resets image state and hides rights checkbox', async () => {
    const user = userEvent.setup()
    render(<WorksheetForm />)
    await user.type(screen.getByPlaceholderText(/lawnmowers/i), 'trains')
    await triggerImageUpload()
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(screen.queryByText(/i have the right/i)).not.toBeInTheDocument()
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
