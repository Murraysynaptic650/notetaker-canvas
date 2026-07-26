import Anthropic from '@anthropic-ai/sdk'
import type { AiSettings } from './settingsStore'
import { ThinkFilter } from './thinkFilter'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface StreamOptions {
  settings: AiSettings
  system: string
  messages: ChatTurn[]
  /** Optional PNG snapshot of the board (data URL), attached to the last user turn. */
  boardImage?: string | null
  /** Called with each new chunk of text as it streams in. */
  onToken: (delta: string) => void
  signal?: AbortSignal
}

// Reply budget. This has to cover the chat text *and* any trailing `tldraw`
// actions block — a multi-shape diagram is easily several hundred tokens of
// JSON on its own. At 1024 a normal answer followed by a diagram could be cut
// off mid-JSON, which fails to parse and silently drops the drawing.
const MAX_TOKENS = 4096

// Google exposes Gemini through an OpenAI-compatible surface, so it shares the
// same streaming path as vLLM/Ollama — only the base URL is fixed here.
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

// The Claude Code bridge is reached same-origin via the Vite `/agent` proxy,
// which forwards to claude-bridge/server.mjs on the Mac.
const CLAUDE_CODE_BASE_URL = '/agent/v1'

/**
 * Provider-agnostic streaming chat. Routes to the Anthropic SDK, or to any
 * OpenAI-compatible `/chat/completions` endpoint (Gemini, vLLM, Ollama, …),
 * emitting text through `onToken` as it arrives and resolving with the full
 * reply once the stream completes.
 */
export async function streamChat(options: StreamOptions): Promise<string> {
  if (options.settings.provider === 'anthropic') {
    return streamAnthropic(options)
  }
  return streamOpenAICompatible(options)
}

async function streamAnthropic({
  settings,
  system,
  messages,
  boardImage,
  onToken,
  signal,
}: StreamOptions): Promise<string> {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })

  const stream = client.messages.stream({
    model: settings.model,
    max_tokens: MAX_TOKENS,
    system,
    messages: messages.map((turn, index): Anthropic.MessageParam => {
      if (isLastUserTurn(messages, index, turn) && boardImage) {
        const image = parseImageDataUrl(boardImage)
        return {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
            },
            { type: 'text', text: turn.text },
          ],
        }
      }
      return { role: turn.role, content: turn.text }
    }),
  })

  if (signal) {
    if (signal.aborted) stream.abort()
    else signal.addEventListener('abort', () => stream.abort(), { once: true })
  }

  stream.on('text', (delta) => onToken(delta))

  const final = await stream.finalMessage()
  return final.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

async function streamOpenAICompatible({
  settings,
  system,
  messages,
  boardImage,
  onToken,
  signal,
}: StreamOptions): Promise<string> {
  const base = resolveBaseUrl(settings)
  const url = `${base.replace(/\/+$/, '')}/chat/completions`
  const model = settings.provider === 'claudecode' ? settings.model.trim() || 'sonnet' : settings.model
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`

  const chatMessages = messages.map((turn, index) => {
    if (isLastUserTurn(messages, index, turn) && boardImage) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: turn.text },
          { type: 'image_url', image_url: { url: boardImage } },
        ],
      }
    }
    return { role: turn.role, content: turn.text }
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        stream: true,
        messages: [{ role: 'system', content: system }, ...chatMessages],
      }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    // fetch() rejects with an opaque TypeError ("Load failed" / "Failed to
    // fetch") for network, CORS, and mixed-content blocks alike. Translate it
    // into something the user can act on.
    throw new Error(
      `Couldn't reach ${url}. Check that: (1) the base URL is correct and reachable from this browser; ` +
        `(2) if this app is served over https, the server must also be https — a browser blocks https→http ` +
        `(mixed content); (3) the server allows this page's origin (CORS).`,
    )
  }

  if (!response.ok || !response.body) {
    const detail = await safeReadText(response)
    throw new Error(`LLM server returned ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  // Local reasoning models (vLLM) emit <think>…</think>; strip it so it doesn't
  // clutter the chat or break the drawing-action parser. Gemini doesn't do this.
  const filter = settings.provider === 'openai' ? new ThinkFilter() : undefined
  return readOpenAIStream(response.body, onToken, filter)
}

/** Parse an OpenAI-style SSE stream, forwarding delta text and returning the whole. */
async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onToken: (delta: string) => void,
  filter?: ThinkFilter,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the trailing partial line

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const payload = trimmed.slice('data:'.length).trim()
      if (payload === '' || payload === '[DONE]') continue

      const delta = extractDelta(payload)
      if (!delta) continue

      const piece = filter ? filter.push(delta) : delta
      if (piece) {
        full += piece
        onToken(piece)
      }
    }
  }

  // Flush any text the filter was holding back to guard against a split tag.
  if (filter) {
    const tail = filter.flush()
    if (tail) {
      full += tail
      onToken(tail)
    }
  }

  return full
}

function extractDelta(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
    }
    const choice = parsed.choices?.[0]
    return choice?.delta?.content ?? choice?.message?.content ?? ''
  } catch {
    return '' // ignore keep-alives / malformed lines
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300)
  } catch {
    return ''
  }
}

function resolveBaseUrl(settings: AiSettings): string {
  if (settings.provider === 'gemini') return GEMINI_BASE_URL
  if (settings.provider === 'claudecode') return CLAUDE_CODE_BASE_URL
  return settings.baseUrl
}

/** True for the final message in the list, when it's a user turn (where the board image belongs). */
function isLastUserTurn(messages: ChatTurn[], index: number, turn: ChatTurn): boolean {
  return index === messages.length - 1 && turn.role === 'user'
}

type AnthropicImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** Split a data URL into the media type + raw base64 the Anthropic API expects. */
function parseImageDataUrl(dataUrl: string): {
  mediaType: AnthropicImageMediaType
  base64: string
} {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return { mediaType: 'image/png', base64: base64FromDataUrl(dataUrl) }

  const raw = match[1]
  const mediaType: AnthropicImageMediaType =
    raw === 'image/jpeg' || raw === 'image/gif' || raw === 'image/webp' ? raw : 'image/png'
  return { mediaType, base64: match[2] }
}

/** Strip the `data:…;base64,` prefix, leaving raw base64. */
function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}
