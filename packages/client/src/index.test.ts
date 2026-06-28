import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBridge, BridgeError } from './index'
import { SOURCE_CS, SOURCE_PAGE, type RequestEnvelope } from './protocol'

/**
 * Transport tests with a fake window that plays the part of the content-script
 * relay: it echoes back a response addressed by the same reqId.
 */
type Relay = (env: RequestEnvelope) => unknown | undefined

function installFakeWindow(relay: Relay): void {
  const listeners = new Set<(e: MessageEvent) => void>()
  const win = {
    location: { origin: 'https://app.example' },
    addEventListener: (type: string, cb: (e: MessageEvent) => void) => {
      if (type === 'message') listeners.add(cb)
    },
    removeEventListener: (_type: string, cb: (e: MessageEvent) => void) => {
      listeners.delete(cb)
    },
    postMessage: (data: unknown) => {
      const env = data as RequestEnvelope
      if (env?.source !== SOURCE_PAGE) return
      const response = relay(env)
      if (response === undefined) return
      queueMicrotask(() => {
        for (const cb of listeners) {
          cb({
            source: win,
            origin: 'https://app.example',
            data: response,
          } as unknown as MessageEvent)
        }
      })
    },
  }
  ;(globalThis as { window?: unknown }).window = win
}

function ok(reqId: string, result: unknown) {
  return { source: SOURCE_CS, reqId, ok: true, result }
}
function fail(reqId: string, code: string, message = 'x') {
  return { source: SOURCE_CS, reqId, ok: false, error: { code, message } }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('createBridge transport', () => {
  it('available() resolves false on timeout when nothing answers', async () => {
    installFakeWindow(() => undefined)
    const bridge = createBridge()
    expect(await bridge.available(50)).toBe(false)
  })

  it('available()/version() resolve from a pong', async () => {
    installFakeWindow((env) =>
      env.method === 'ping'
        ? ok(env.reqId, { pong: true, version: '9.9.9' })
        : undefined,
    )
    const bridge = createBridge()
    expect(await bridge.available()).toBe(true)
    expect(await bridge.version()).toBe('9.9.9')
  })

  it('correlates responses by reqId and returns the result', async () => {
    installFakeWindow((env) =>
      env.method === 'print' ? ok(env.reqId, { jobId: '42' }) : undefined,
    )
    const bridge = createBridge()
    const res = await bridge.print('p1', { name: 'a.gcode', gcode: 'G28' })
    expect(res).toEqual({ jobId: '42' })
  })

  it('maps {ok:false} to a thrown BridgeError', async () => {
    installFakeWindow((env) => fail(env.reqId, 'DENIED', 'nope'))
    const bridge = createBridge()
    await expect(bridge.requestAccess()).rejects.toMatchObject({
      name: 'BridgeError',
      code: 'DENIED',
    })
    await expect(bridge.requestAccess()).rejects.toBeInstanceOf(BridgeError)
  })

  it('rejects malformed print() args before sending', async () => {
    installFakeWindow(() => undefined)
    const bridge = createBridge()
    // @ts-expect-error intentionally missing gcode
    await expect(bridge.print('p1', { name: 'a.gcode' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })
})
