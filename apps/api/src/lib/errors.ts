/**
 * Errors that carry the HTTP status the /generate route should respond with.
 * Anything else thrown inside the route is reported as a generic 500.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 500,
    /** Optional hint surfaced to the client alongside the message. */
    readonly details?: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

/** A fal.ai call was attempted in default (online) mode without FAL_API_KEY. */
export class FalApiKeyMissingError extends AppError {
  constructor() {
    super(
      'FAL_API_KEY is not set',
      500,
      'Add FAL_API_KEY to apps/api/.env, or start the API in offline mode (pnpm dev:offline) to use placeholder images.',
    )
  }
}

/** The client sent an image the current mode cannot process — a 400, not a server fault. */
export class InvalidImageError extends AppError {
  constructor(message: string, details?: string) {
    super(message, 400, details)
  }
}
