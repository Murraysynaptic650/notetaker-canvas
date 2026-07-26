import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamChat } from './llmClient'
import { DEFAULT_SETTINGS, type AiSettings } from './settingsStore'

/** Build a Response whose body streams the given SSE lines. */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

/** One well-formed OpenAI SSE data frame carrying a content delta. */
function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

const localSettings: AiSettings = {
  ...DEFAULT_SETTINGS,
  provider: 'openai',
  baseUrl: 'http://gpu.local:8000/v1',
  model: 'local-model',
  apiKey: '',
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('streamChat (OpenAI-compatible)', () => {
  it('streams deltas through onToken and returns the full reply', async () => {
    // Gemini: no ThinkFilter, so tokens surface one frame at a time.
    fetchMock.mockResolvedValue(sseResponse([frame('Hello'), frame(' world'), 'data: [DONE]\n\n']))
    const tokens: string[] = []

    const reply = await streamChat({
      settings: { ...DEFAULT_SETTINGS, provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' },
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: (delta) => tokens.push(delta),
    })

    expect(tokens).toEqual(['Hello', ' world'])
    expect(reply).toBe('Hello world')
  })

  it('holds local-provider text until the reasoning block resolves', async () => {
    // Documents a deliberate trade-off in ThinkFilter: a reasoning model may
    // open its <think> block implicitly (closing tag only), so nothing can be
    // shown until a </think> arrives or the stream ends. The consequence is
    // that a *non*-reasoning local model delivers its whole reply in one lump.
    fetchMock.mockResolvedValue(sseResponse([frame('Hello'), frame(' world')]))
    const tokens: string[] = []

    const reply = await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: (delta) => tokens.push(delta),
    })

    expect(tokens).toEqual(['Hello world'])
    expect(reply).toBe('Hello world')
  })

  it('reassembles a frame split across network chunks', async () => {
    const whole = frame('split')
    const cut = Math.floor(whole.length / 2)
    fetchMock.mockResolvedValue(sseResponse([whole.slice(0, cut), whole.slice(cut)]))

    const reply = await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(reply).toBe('split')
  })

  it('ignores keep-alives, blank lines and malformed frames', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([': keep-alive\n\n', '\n', 'data: {not json}\n\n', frame('ok'), 'data: \n\n']),
    )

    const reply = await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(reply).toBe('ok')
  })

  it('accepts a non-streaming message payload as well as deltas', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([`data: ${JSON.stringify({ choices: [{ message: { content: 'full' } }] })}\n\n`]),
    )

    const reply = await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(reply).toBe('full')
  })

  it('strips <think> reasoning for the local provider', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame('<think>hmm</think>'), frame('The answer.')]),
    )

    const reply = await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(reply).toBe('The answer.')
  })

  it('does not strip <think> for Gemini, which does not emit it', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('a <think> b')]))

    const reply = await streamChat({
      settings: { ...DEFAULT_SETTINGS, provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' },
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(reply).toBe('a <think> b')
  })

  it('posts to the configured base URL, trimming trailing slashes', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('x')]))

    await streamChat({
      settings: { ...localSettings, baseUrl: 'http://gpu.local:8000/v1///' },
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(fetchMock.mock.calls[0][0]).toBe('http://gpu.local:8000/v1/chat/completions')
  })

  it('routes Gemini to its OpenAI-compatible endpoint', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('x')]))

    await streamChat({
      settings: { ...DEFAULT_SETTINGS, provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' },
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    )
  })

  it('routes the Claude Code bridge to the same-origin proxy path', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('x')]))

    await streamChat({
      settings: { ...DEFAULT_SETTINGS, provider: 'claudecode', model: '' },
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })

    expect(fetchMock.mock.calls[0][0]).toBe('/agent/v1/chat/completions')
    // Falls back to the bridge's default model when none is set in the app.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('sonnet')
  })

  it('sends an Authorization header only when a key is set', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('x')]))
    await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()

    fetchMock.mockResolvedValue(sseResponse([frame('x')]))
    await streamChat({
      settings: { ...localSettings, apiKey: 'secret' },
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      onToken: () => {},
    })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer secret')
  })

  it('attaches the board image to the last user turn only', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('x')]))

    await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'reply' },
        { role: 'user', text: 'second' },
      ],
      boardImage: 'data:image/jpeg;base64,AAAA',
      onToken: () => {},
    })

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.messages[0].role).toBe('system')
    expect(sent.messages[1].content).toBe('first') // plain text, no image
    expect(sent.messages[3].content).toEqual([
      { type: 'text', text: 'second' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ])
  })

  it('sends plain text turns when there is no board image', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('x')]))

    await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      boardImage: null,
      onToken: () => {},
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content).toBe('hi')
  })

  it('translates an opaque fetch failure into actionable advice', async () => {
    fetchMock.mockRejectedValue(new TypeError('Load failed'))

    await expect(
      streamChat({
        settings: localSettings,
        system: 'sys',
        messages: [{ role: 'user', text: 'hi' }],
        onToken: () => {},
      }),
    ).rejects.toThrow(/mixed content|CORS|reachable/i)
  })

  it('rethrows an abort rather than reporting it as unreachable', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'))

    await expect(
      streamChat({
        settings: localSettings,
        system: 'sys',
        messages: [{ role: 'user', text: 'hi' }],
        onToken: () => {},
      }),
    ).rejects.toThrow(/aborted/i)
  })

  it('reports the server status and body on an error response', async () => {
    fetchMock.mockResolvedValue(
      new Response('context length exceeded', { status: 400, statusText: 'Bad Request' }),
    )

    await expect(
      streamChat({
        settings: localSettings,
        system: 'sys',
        messages: [{ role: 'user', text: 'hi' }],
        onToken: () => {},
      }),
    ).rejects.toThrow(/400.*context length exceeded/)
  })

  it('forwards the abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame('x')]))
    const controller = new AbortController()

    await streamChat({
      settings: localSettings,
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      signal: controller.signal,
      onToken: () => {},
    })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})
