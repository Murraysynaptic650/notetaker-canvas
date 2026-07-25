export type ProviderId = 'anthropic' | 'gemini' | 'openai' | 'claudecode'

/**
 * All AI settings, persisted in this browser's localStorage. This is a
 * personal, single-user app, so config (including an optional API key) lives
 * client-side and is sent only in direct requests to the chosen provider.
 *
 * - `anthropic`  → Anthropic's hosted API (needs an API key).
 * - `gemini`     → Google Gemini via its OpenAI-compatible endpoint (needs an
 *                  API key; base URL is fixed, so it isn't user-entered).
 * - `openai`     → any OpenAI-compatible `/v1` endpoint. Covers vLLM and
 *                  Ollama running on a remote GPU box (e.g. reached over
 *                  Tailscale); `apiKey` is optional depending on the server.
 * - `claudecode` → the local Claude Code bridge (claude-bridge/), reached at a
 *                  fixed proxy path. Auth + model live on that server, so no
 *                  URL/key/model is needed in the app.
 */
export interface AiSettings {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey: string
  autoWatch: boolean
  /** When on, focus context on the user's current selection (their "pointer"). */
  focusSelection: boolean
  /** When on, the model answers by drawing on the board instead of in chat. */
  boardReply: boolean
}

const STORAGE_KEY = 'notetaker-ai-settings'
const LEGACY_KEY_STORAGE = 'notetaker-anthropic-api-key'

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'anthropic',
  baseUrl: 'http://localhost:11434/v1',
  model: 'claude-sonnet-5',
  apiKey: '',
  autoWatch: false,
  focusSelection: false,
  boardReply: false,
}

export function getSettings(): AiSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      return normalize(JSON.parse(raw))
    } catch {
      // Corrupt JSON — fall through to defaults rather than crashing.
    }
  }

  // Migrate a key saved by the older Anthropic-only version, if present.
  const legacyKey = window.localStorage.getItem(LEGACY_KEY_STORAGE)
  return legacyKey ? { ...DEFAULT_SETTINGS, apiKey: legacyKey } : DEFAULT_SETTINGS
}

export function saveSettings(patch: Partial<AiSettings>): AiSettings {
  const next = normalize({ ...getSettings(), ...patch })
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

/** Whether the current settings are complete enough to send a request. */
export function isConfigured(settings: AiSettings): boolean {
  // The Claude Code bridge holds its own auth + model server-side.
  if (settings.provider === 'claudecode') return true
  // A self-hosted OpenAI-compatible server needs a URL but often no key;
  // hosted providers (Anthropic, Gemini) need a key instead of a URL.
  if (settings.provider === 'openai') {
    return Boolean(settings.baseUrl.trim() && settings.model.trim())
  }
  return Boolean(settings.apiKey.trim() && settings.model.trim())
}

/** Coerce arbitrary parsed input into a valid settings object. */
function normalize(input: unknown): AiSettings {
  const record = (input ?? {}) as Record<string, unknown>
  const provider: ProviderId = isProviderId(record.provider) ? record.provider : 'anthropic'
  return {
    provider,
    baseUrl: asString(record.baseUrl, DEFAULT_SETTINGS.baseUrl),
    model: asString(record.model, DEFAULT_SETTINGS.model),
    apiKey: asString(record.apiKey, ''),
    autoWatch: record.autoWatch === true,
    focusSelection: record.focusSelection === true,
    boardReply: record.boardReply === true,
  }
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'anthropic' || value === 'gemini' || value === 'openai' || value === 'claudecode'
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}
