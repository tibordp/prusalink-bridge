import { md5 } from './md5'

/**
 * HTTP Digest auth (RFC 2617, qop=auth) — fetch() can't do this natively, so we
 * compute the Authorization header ourselves. All of
 * this runs only in the background; secrets never leave it.
 */

export interface DigestChallenge {
  realm: string
  nonce: string
  qop?: string
  opaque?: string
  algorithm?: string
}

/** Parse a `WWW-Authenticate: Digest ...` header value into its fields. */
export function parseWwwAuthenticate(header: string): DigestChallenge | null {
  const m = /^\s*Digest\s+(.*)$/is.exec(header)
  if (!m) return null
  const params: Record<string, string> = {}
  // Match key=value where value is either "quoted" or a bare token.
  const re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/gi
  let item: RegExpExecArray | null
  while ((item = re.exec(m[1]!)) !== null) {
    const key = item[1]!.toLowerCase()
    const val = item[2] != null ? item[2].replace(/\\(.)/g, '$1') : item[3]!
    params[key] = val
  }
  if (!params.realm || !params.nonce) return null
  const out: DigestChallenge = { realm: params.realm, nonce: params.nonce }
  if (params.qop) out.qop = params.qop
  if (params.opaque) out.opaque = params.opaque
  if (params.algorithm) out.algorithm = params.algorithm
  return out
}

function randomCnonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** Pick the `auth` token if the challenge offers a qop list. */
function chooseQop(qop: string | undefined): 'auth' | null {
  if (!qop) return null
  const tokens = qop.split(',').map((t) => t.trim().toLowerCase())
  return tokens.includes('auth') ? 'auth' : null
}

export interface BuildDigestParams {
  username: string
  password: string
  method: string
  /** request-URI = path + query (no scheme/host), e.g. "/api/v1/status". */
  uri: string
  challenge: DigestChallenge
  /** override for deterministic testing. */
  cnonce?: string
  /** nonce count hex, default "00000001". */
  nc?: string
}

/** Build the value for the `Authorization` request header. */
export function buildDigestHeader(p: BuildDigestParams): string {
  const { username, password, method, uri, challenge } = p
  const qop = chooseQop(challenge.qop)
  const cnonce = p.cnonce ?? randomCnonce()
  const nc = p.nc ?? '00000001'

  const ha1 = md5(`${username}:${challenge.realm}:${password}`)
  const ha2 = md5(`${method}:${uri}`)
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`) // RFC 2069 fallback

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ]
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  }
  if (challenge.opaque != null) parts.push(`opaque="${challenge.opaque}"`)
  if (challenge.algorithm != null) parts.push(`algorithm=${challenge.algorithm}`)
  return `Digest ${parts.join(', ')}`
}
