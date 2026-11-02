/**
 * Offline mode — set OFFLINE=1 (or `pnpm dev:offline`) to run the API without
 * a fal.ai key. Every image that would normally come from fal.ai (or from a
 * user upload) is replaced by a static placeholder, so the full worksheet
 * pipeline and PDF layout can be exercised and tested for free.
 *
 * The flag is read on every call rather than once at start-up so that tests
 * can toggle it with `vi.stubEnv`.
 */
export function isOfflineMode(): boolean {
  const raw = process.env.OFFLINE?.trim().toLowerCase()
  return raw === '1' || raw === 'true'
}
