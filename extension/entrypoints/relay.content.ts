import {
  PROTOCOL_VERSION,
  SOURCE_CS,
  SOURCE_PAGE,
  type RequestEnvelope,
  type ResponseEnvelope,
  type WireError,
} from '@tibordp/prusalink-bridge/protocol'
import { browser } from 'wxt/browser'
import { gcodeToWire } from '@/src/lib/bytes'
import {
  REPLY_SOURCE,
  type PrintRpcArgs,
  type ReplyMessage,
  type RpcMessage,
} from '@/src/lib/ipc'

/**
 * relay.js — the dumb, origin-pinning relay between page `postMessage` and the
 * background. Adds nothing but transport. The TRUE origin is taken
 * from the background's `sender.origin`, never from the page. Top frame only.
 */
export default defineContentScript({
  matches: ['https://*/*', 'http://*/*'],
  runAt: 'document_start',
  allFrames: false,
  world: 'ISOLATED',
  main() {
    const PAGE_METHODS = new Set([
      'requestAccess',
      'printers',
      'print',
      'status',
      'cancel',
    ])

    function postToPage(resp: ResponseEnvelope): void {
      window.postMessage(resp, window.location.origin)
    }

    function reply(
      reqId: string,
      ok: boolean,
      result?: unknown,
      error?: WireError,
    ) {
      postToPage({
        source: SOURCE_CS,
        reqId,
        ok,
        ...(ok ? { result } : { error }),
      })
    }

    // ── page → relay ──────────────────────────────────────────────────────
    window.addEventListener('message', (event: MessageEvent) => {
      // Reject anything not from this exact window/origin.
      if (event.source !== window) return
      if (event.origin !== window.location.origin) return
      const data = event.data as RequestEnvelope | undefined
      if (
        !data ||
        data.source !== SOURCE_PAGE ||
        typeof data.reqId !== 'string'
      ) {
        return
      }
      const { reqId, method } = data

      // Control message: abort the in-flight upload for this reqId.
      if ((data as { abort?: boolean }).abort === true) {
        void browser.runtime
          .sendMessage({ kind: 'abort', reqId })
          .catch(() => undefined)
        return
      }

      // Discovery is answered locally so it works even while the SW sleeps.
      if (method === 'ping') {
        reply(reqId, true, { pong: true, version: PROTOCOL_VERSION })
        return
      }
      if (typeof method !== 'string' || !PAGE_METHODS.has(method)) {
        reply(reqId, false, undefined, {
          code: 'BAD_REQUEST',
          message: `Unknown method: ${String(method)}`,
        })
        return
      }

      void forward(reqId, method, data.args)
    })

    async function forward(
      reqId: string,
      method: string,
      args: unknown,
    ): Promise<void> {
      let rpcArgs = args
      try {
        if (method === 'print') {
          const a = (args ?? {}) as {
            printerId?: string
            name?: string
            gcode?: string | Blob | ArrayBuffer
            start?: boolean
            timeoutMs?: number
          }
          if (!a.printerId || !a.name || a.gcode == null) {
            reply(reqId, false, undefined, {
              code: 'BAD_REQUEST',
              message: 'print requires printerId, name, gcode',
            })
            return
          }
          const wire = await gcodeToWire(a.gcode)
          rpcArgs = {
            printerId: a.printerId,
            name: a.name,
            gcode: wire,
            start: a.start,
            timeoutMs: a.timeoutMs,
          } satisfies PrintRpcArgs
        }
        const msg: RpcMessage = {
          kind: 'rpc',
          reqId,
          method: method as RpcMessage['method'],
          args: rpcArgs,
        }
        // Fire-and-forget: the real answer comes back via tabs.sendMessage and
        // is handled by the runtime.onMessage listener below. This wakes
        // the SW. We ignore the (possibly undefined) direct ack.
        await browser.runtime.sendMessage(msg).catch(() => undefined)
      } catch (err) {
        reply(reqId, false, undefined, {
          code: 'INTERNAL',
          message: 'Relay failed to forward: ' + String(err),
        })
      }
    }

    // ── background → relay (reply addressed by reqId) → page ──────────────────
    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as Partial<ReplyMessage>
      if (m && m.kind === 'reply' && m.source === REPLY_SOURCE && m.reqId) {
        reply(m.reqId, m.ok ?? false, m.result, m.error)
      }
      // no response needed
    })
  },
})
