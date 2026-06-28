import { createBridge, BridgeError } from './lib/prusalink-bridge.js'

const bridge = createBridge()
const $ = (id) => document.getElementById(id)
const sel = $('printer')
const logEl = $('log')
let firstLog = true

function log(label, value) {
  const text =
    value instanceof BridgeError
      ? `BridgeError ${value.code}: ${value.message}`
      : value === undefined
        ? 'ok'
        : JSON.stringify(value, null, 2)
  const entry = `▶ ${label}\n${text}\n`
  logEl.textContent = firstLog ? entry : entry + '\n' + logEl.textContent
  firstLog = false
}

const run = (label, fn) => async () => {
  try {
    log(label, await fn())
  } catch (e) {
    log(label + ' (error)', e)
  }
}

function fillPrinters(printers) {
  sel.replaceChildren()
  for (const p of printers) {
    const o = document.createElement('option')
    o.value = p.id
    o.textContent = `${p.name}${p.model ? ' (' + p.model + ')' : ''}`
    sel.append(o)
  }
  if (printers.length === 0) {
    const o = document.createElement('option')
    o.textContent = '— none granted —'
    sel.append(o)
  }
}

// ── extension detection ─────────────────────────────────────────────────────
const interactive = [
  'b-request',
  'b-request-force',
  'b-printers',
  'b-status',
  'b-cancel',
  'b-print',
  'file',
  'filename',
  'timeout',
  'start',
].map($)

async function detect() {
  const dot = $('ext-dot')
  const status = $('ext-status')
  status.textContent = 'Checking for the extension…'
  dot.className = 'statedot'
  const ok = await bridge.available()
  for (const el of interactive) el.disabled = !ok
  if (ok) {
    const v = await bridge.version()
    dot.className = 'statedot ok'
    status.textContent = `Extension detected${v ? ` · protocol v${v}` : ''}. Grant access to try it.`
    try {
      fillPrinters(await bridge.printers())
    } catch {
      /* no grant yet */
    }
  } else {
    dot.className = 'statedot err'
    status.textContent =
      'Extension not detected — install it, then reload this page.'
  }
}

// ── wiring ──────────────────────────────────────────────────────────────────
$('b-available').onclick = run('available', () => bridge.available())

const doRequest = (force) =>
  run(force ? 'requestAccess(force)' : 'requestAccess', async () => {
    const printers = await bridge.requestAccess({ force })
    fillPrinters(printers)
    return printers
  })
$('b-request').onclick = doRequest(false)
$('b-request-force').onclick = doRequest(true)

$('b-printers').onclick = run('printers', async () => {
  const printers = await bridge.printers()
  fillPrinters(printers)
  return printers
})
$('b-status').onclick = run('status', () => bridge.status(sel.value))
$('b-cancel').onclick = run('cancel', () => bridge.cancel(sel.value))

let uploadAbort = null
$('b-cancel-upload').onclick = () => uploadAbort && uploadAbort.abort()

$('b-print').onclick = async () => {
  const fileInput = $('file')
  const file = fileInput.files[0]
  const gcode = file ?? 'G28\nG1 Z5 F300\nM117 hello\n'
  const name = file ? $('filename').value || file.name : $('filename').value
  const tv = $('timeout').value
  uploadAbort = new AbortController()
  $('b-cancel-upload').disabled = false
  log('print', 'uploading…')
  try {
    const res = await bridge.print(sel.value, {
      name,
      gcode,
      start: $('start').checked,
      timeoutMs: tv ? Number(tv) : undefined,
      signal: uploadAbort.signal,
    })
    log('print', res)
  } catch (e) {
    log('print (error)', e)
  } finally {
    $('b-cancel-upload').disabled = true
    uploadAbort = null
  }
}

// Default the on-printer name to the chosen file's name.
$('file').onchange = () => {
  if ($('file').files[0]) $('filename').value = $('file').files[0].name
}

void detect()
