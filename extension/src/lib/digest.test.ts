import { describe, expect, it } from 'vitest'
import { buildDigestHeader, parseWwwAuthenticate } from './digest'

describe('parseWwwAuthenticate', () => {
  it('parses a qop=auth challenge', () => {
    const c = parseWwwAuthenticate(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    )
    expect(c).toEqual({
      realm: 'testrealm@host.com',
      nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
      qop: 'auth,auth-int',
      opaque: '5ccc069c403ebaf9f0171e9517f40e41',
    })
  })

  it('returns null without realm/nonce', () => {
    expect(parseWwwAuthenticate('Basic realm="x"')).toBeNull()
    expect(parseWwwAuthenticate('Digest realm="x"')).toBeNull()
  })
})

describe('buildDigestHeader', () => {
  // RFC 2617 §3.5 worked example.
  it('computes the canonical response', () => {
    const header = buildDigestHeader({
      username: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      cnonce: '0a4f113b',
      nc: '00000001',
      challenge: {
        realm: 'testrealm@host.com',
        nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
        qop: 'auth',
        opaque: '5ccc069c403ebaf9f0171e9517f40e41',
      },
    })
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"')
    expect(header).toContain('qop=auth')
    expect(header).toContain('nc=00000001')
    expect(header).toContain('cnonce="0a4f113b"')
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"')
  })

  it('falls back to RFC 2069 when no qop is offered', () => {
    // HA1 = md5(user:realm:pass), response = md5(HA1:nonce:HA2)
    const header = buildDigestHeader({
      username: 'user',
      password: 'pass',
      method: 'GET',
      uri: '/api/v1/status',
      challenge: { realm: 'r', nonce: 'n' },
    })
    expect(header).not.toContain('qop=')
    expect(header).toMatch(/response="[0-9a-f]{32}"/)
  })
})
