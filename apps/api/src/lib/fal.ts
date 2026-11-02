import { FalApiKeyMissingError } from './errors.js'

/**
 * Single gate for every fal.ai call. Returns the key, or throws the same
 * FalApiKeyMissingError (→ HTTP 500 "FAL_API_KEY is not set") regardless of
 * which service tried to call fal.ai. Offline mode never reaches this: the
 * services short-circuit to placeholders before asking for a key.
 */
export function requireFalApiKey(): string {
  const apiKey = process.env.FAL_API_KEY?.trim()
  if (!apiKey) throw new FalApiKeyMissingError()
  return apiKey
}
