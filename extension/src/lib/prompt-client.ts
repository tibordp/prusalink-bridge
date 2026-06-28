import { browser } from 'wxt/browser'
import {
  PROMPT_PORT_PREFIX,
  type ConfirmDecision,
  type ConsentDecision,
  type Prompt,
} from './ipc'

/** Fetch the pending consent/confirm prompt queue from the background. */
export async function getPrompts(): Promise<Prompt[]> {
  const res = await browser.runtime.sendMessage({ kind: 'get-prompts' })
  return (res as Prompt[] | undefined) ?? []
}

export async function sendConsentDecision(
  d: Omit<ConsentDecision, 'kind'>,
): Promise<void> {
  await browser.runtime.sendMessage({ kind: 'consent-decision', ...d })
}

export async function sendConfirmDecision(
  d: Omit<ConfirmDecision, 'kind'>,
): Promise<void> {
  await browser.runtime.sendMessage({ kind: 'confirm-decision', ...d })
}

/**
 * Open a port that lives as long as this prompt is shown. If the popup closes
 * before a decision, the background sees the disconnect and resolves the
 * request as denied/cancelled.
 */
export function openPromptPort(reqId: string): { disconnect: () => void } {
  return browser.runtime.connect({ name: PROMPT_PORT_PREFIX + reqId })
}
