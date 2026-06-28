import type { BridgeErrorCode, WireError } from '@tibordp/prusalink-bridge/protocol'

/**
 * Internal error type used throughout the background. Carries a page-safe
 * {@link BridgeErrorCode}. `toWireError()` produces the sanitized payload that
 * crosses to the page — never include baseUrl, secrets, or auth headers.
 */
export class AppError extends Error {
  readonly code: BridgeErrorCode
  readonly httpStatus?: number
  constructor(code: BridgeErrorCode, message: string, httpStatus?: number) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.httpStatus = httpStatus
  }
  toWireError(): WireError {
    return {
      code: this.code,
      message: this.message,
      ...(this.httpStatus != null ? { httpStatus: this.httpStatus } : {}),
    }
  }
}

/** Coerce any thrown value into a page-safe WireError. */
export function toWireError(err: unknown): WireError {
  if (err instanceof AppError) return err.toWireError()
  // Anything unexpected becomes INTERNAL with a generic message — do not leak
  // internals (a raw Error.message could contain a URL).
  return { code: 'INTERNAL', message: 'Internal bridge error' }
}

/** Classify a fetch() rejection. A TypeError from fetch means the request never
 *  completed (DNS, connection refused, blocked, CORS-at-network-layer). */
export function networkError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new AppError('TIMEOUT', 'Printer request timed out')
  }
  return new AppError('PRINTER_UNREACHABLE', 'Could not reach the printer')
}
