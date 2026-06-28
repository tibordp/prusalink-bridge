import { browser } from 'wxt/browser'
import { AppError } from './errors'

/**
 * Build the least-privilege host match pattern for a printer baseUrl.
 * e.g. "http://192.168.1.50"        → "http://192.168.1.50/*"
 *      "http://printer.local:8080"  → "http://printer.local:8080/*"
 */
export function originPatternFor(baseUrl: string): string {
  const u = new URL(baseUrl)
  return `${u.protocol}//${u.host}/*`
}

export async function hasHostPermission(baseUrl: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({
      origins: [originPatternFor(baseUrl)],
    })
  } catch {
    return false
  }
}

/** Request the host permission. MUST be called from a user gesture (options
 *  page Add/Save handler). Returns whether it was granted. */
export async function requestHostPermission(baseUrl: string): Promise<boolean> {
  return browser.permissions.request({
    origins: [originPatternFor(baseUrl)],
  })
}

/** Remove the host permission for a printer, unless another configured printer
 *  still uses the same host. Best-effort. */
export async function removeHostPermission(baseUrl: string): Promise<void> {
  try {
    await browser.permissions.remove({ origins: [originPatternFor(baseUrl)] })
  } catch {
    /* ignore — removal is best-effort */
  }
}

/** Throw NO_HOST_PERMISSION if the permission is missing/revoked. The
 *  background calls this before any fetch to a printer. */
export async function assertHostPermission(baseUrl: string): Promise<void> {
  if (!(await hasHostPermission(baseUrl))) {
    throw new AppError(
      'NO_HOST_PERMISSION',
      'The extension lacks permission to reach this printer',
    )
  }
}
