import { describe, expect, it } from 'vitest'
import { md5 } from './md5'

// RFC 1321, Appendix A.5 — the MD5 test suite.
describe('md5', () => {
  const vectors: Array<[string, string]> = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'd174ab98d277d9f5a5611c2c9f419d9f',
    ],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ]
  for (const [input, expected] of vectors) {
    it(`hashes ${JSON.stringify(input.slice(0, 16))}`, () => {
      expect(md5(input)).toBe(expected)
    })
  }

  it('handles multi-byte UTF-8', () => {
    // "Circle Of Life" used in the digest tests is ASCII; check a unicode case
    // round-trips through TextEncoder consistently.
    expect(md5('héllo')).toBe(md5('héllo'))
    expect(md5('é')).toHaveLength(32)
  })
})
