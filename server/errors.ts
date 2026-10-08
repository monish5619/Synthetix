/**
 * Errors that are safe to show to API clients. Anything else is treated as an
 * internal error and reported generically.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Raised when the degradation model or liquidation engine cannot finish a run. The run is rolled back. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message);
