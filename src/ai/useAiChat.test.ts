import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import { useAiChat } from './useAiChat'
import * as llmClient from './llmClient'
import { saveSettings } from './settingsStore'

// The hook only ever touches these few Editor methods; a stub keeps the test
// free of a real tldraw instance (which needs a canvas and a mounted app).
function stubEditor(): Editor {
  return {
    getViewportPageBounds: () => ({ minX: 0, minY: 0, maxX: 800, maxY: 600 }),
    getCurrentPageShapes: () => [],
    getCurrentPageShapeIds: () => new Set(),
    getSelectedShapeIds: () => [],
    getShape: () => undefined,
    getShapePageBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
    createShape: vi.fn(),
    createAssets: vi.fn(),
    createBinding: vi.fn(),
    updateShape: vi.fn(),
    store: {
      mergeRemoteChanges: (fn: () => void) => fn(),
      // useLastEditedShape subscribes here; nothing in these tests drives it.
      listen: () => () => {},
    },
  } as unknown as Editor
}

/** A streamChat stub that never resolves until the signal aborts. */
function hangingStream(onStart?: () => void) {
  return vi.fn((options: llmClient.StreamOptions) => {
    onStart?.()
    return new Promise<string>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      )
    })
  })
}

beforeEach(() => {
  window.localStorage.clear()
  // Configure a provider so `run` gets past the isConfigured guard.
  saveSettings({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-5' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAiChat', () => {
  it('refuses to send when no provider is configured', async () => {
    window.localStorage.clear()
    saveSettings({ provider: 'anthropic', apiKey: '', model: '' })
    const streamChat = vi.spyOn(llmClient, 'streamChat')

    const { result } = renderHook(() => useAiChat(stubEditor()))
    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(streamChat).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/configuring your AI provider/i)
  })

  it('appends the user turn and the streamed reply', async () => {
    vi.spyOn(llmClient, 'streamChat').mockImplementation(async (options) => {
      options.onToken('Hi ')
      options.onToken('there.')
      return 'Hi there.'
    })

    const { result } = renderHook(() => useAiChat(stubEditor()))
    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(result.current.messages).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'Hi there.' },
    ])
    expect(result.current.isSending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('surfaces a provider failure as an error and drops the empty bubble', async () => {
    vi.spyOn(llmClient, 'streamChat').mockRejectedValue(new Error('LLM server returned 500'))

    const { result } = renderHook(() => useAiChat(stubEditor()))
    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(result.current.error).toBe('LLM server returned 500')
    expect(result.current.messages).toEqual([{ role: 'user', text: 'hello' }])
  })

  it('passes an AbortSignal to the provider', async () => {
    const streamChat = vi.spyOn(llmClient, 'streamChat').mockResolvedValue('ok')

    const { result } = renderHook(() => useAiChat(stubEditor()))
    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(streamChat.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })

  it('stop() cancels the in-flight reply without reporting an error', async () => {
    vi.spyOn(llmClient, 'streamChat').mockImplementation(hangingStream())

    const { result } = renderHook(() => useAiChat(stubEditor()))
    act(() => {
      void result.current.sendMessage('hello')
    })
    await waitFor(() => expect(result.current.isSending).toBe(true))

    await act(async () => {
      result.current.stop()
    })

    await waitFor(() => expect(result.current.isSending).toBe(false))
    expect(result.current.error).toBeNull()
    // The empty placeholder bubble is dropped; the user turn stays.
    expect(result.current.messages).toEqual([{ role: 'user', text: 'hello' }])
  })

  it('keeps partial text that streamed in before the stop', async () => {
    vi.spyOn(llmClient, 'streamChat').mockImplementation((options) => {
      options.onToken('partial answer')
      return new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      })
    })

    const { result } = renderHook(() => useAiChat(stubEditor()))
    act(() => {
      void result.current.sendMessage('hello')
    })
    await waitFor(() => expect(result.current.isSending).toBe(true))

    await act(async () => {
      result.current.stop()
    })

    await waitFor(() => expect(result.current.isSending).toBe(false))
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'partial answer' },
    ])
  })

  it('aborts the in-flight request on unmount', async () => {
    let captured: AbortSignal | undefined
    vi.spyOn(llmClient, 'streamChat').mockImplementation((options) => {
      captured = options.signal
      return new Promise<string>(() => {}) // never settles
    })

    const { result, unmount } = renderHook(() => useAiChat(stubEditor()))
    act(() => {
      void result.current.sendMessage('hello')
    })
    await waitFor(() => expect(captured).toBeDefined())
    expect(captured?.aborted).toBe(false)

    unmount()
    expect(captured?.aborted).toBe(true)
  })

  it('ignores a second send while one is already in flight', async () => {
    const streamChat = vi.fn(hangingStream())
    vi.spyOn(llmClient, 'streamChat').mockImplementation(streamChat)

    const { result } = renderHook(() => useAiChat(stubEditor()))
    act(() => {
      void result.current.sendMessage('first')
    })
    await waitFor(() => expect(result.current.isSending).toBe(true))
    await act(async () => {
      await result.current.sendMessage('second')
    })

    expect(streamChat).toHaveBeenCalledTimes(1)
  })

  it('resetConversation clears the transcript and cancels any stream', async () => {
    let captured: AbortSignal | undefined
    vi.spyOn(llmClient, 'streamChat').mockImplementation((options) => {
      captured = options.signal
      return new Promise<string>(() => {})
    })

    const { result } = renderHook(() => useAiChat(stubEditor()))
    act(() => {
      void result.current.sendMessage('hello')
    })
    await waitFor(() => expect(captured).toBeDefined())

    act(() => {
      result.current.resetConversation()
    })

    expect(captured?.aborted).toBe(true)
    expect(result.current.messages).toEqual([])
  })

  it('clearError dismisses a surfaced error', async () => {
    vi.spyOn(llmClient, 'streamChat').mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useAiChat(stubEditor()))
    await act(async () => {
      await result.current.sendMessage('hello')
    })
    expect(result.current.error).toBe('boom')

    act(() => {
      result.current.clearError()
    })
    expect(result.current.error).toBeNull()
  })

  it('trims the API payload to the recent turns but keeps the full transcript', async () => {
    // MAX_HISTORY_MESSAGES is 8; send enough turns to push past it.
    const streamChat = vi
      .spyOn(llmClient, 'streamChat')
      .mockImplementation(async (options) => `reply to ${options.messages[options.messages.length - 1]?.text}`)

    const { result } = renderHook(() => useAiChat(stubEditor()))
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await result.current.sendMessage(`turn ${i}`)
      })
    }

    const lastPayload = streamChat.mock.calls[streamChat.mock.calls.length - 1][0].messages
    expect(lastPayload.length).toBeLessThanOrEqual(8)
    // Never start the window on an assistant turn — the Anthropic API rejects it.
    expect(lastPayload[0].role).toBe('user')
    // The UI keeps everything: 6 user + 6 assistant.
    expect(result.current.messages).toHaveLength(12)
  })

  it('sends the labelled scene graph, not just a list of strings', async () => {
    // The whole spatial fix depends on this reaching the model: handles with
    // exact bounds, so it can anchor instead of estimating coordinates.
    const editor = {
      getViewportPageBounds: () => ({ minX: 0, minY: 0, maxX: 1200, maxY: 800 }),
      getCurrentPageShapes: () => [
        { id: 'shape:cache', type: 'geo', x: 200, y: 200, props: { geo: 'rectangle', text: 'Cache' } },
      ],
      getCurrentPageShapeIds: () => new Set(),
      getSelectedShapeIds: () => [],
      getShapePageBounds: () => ({ minX: 200, minY: 200, maxX: 380, maxY: 290 }),
      getShape: () => undefined,
      createShape: vi.fn(),
      createAssets: vi.fn(),
      createBinding: vi.fn(),
      updateShape: vi.fn(),
      store: { mergeRemoteChanges: (fn: () => void) => fn(), listen: () => () => {} },
    } as unknown as Editor

    const streamChat = vi.spyOn(llmClient, 'streamChat').mockResolvedValue('ok')
    const { result } = renderHook(() => useAiChat(editor))
    await act(async () => {
      await result.current.sendMessage('what next?')
    })

    const system = streamChat.mock.calls[0][0].system
    expect(system).toContain('S1')
    expect(system).toContain('200,200')
    expect(system).toContain('380,290')
    expect(system).toContain('Cache')
  })

  it('marks auto-watch turns so the UI can style them differently', async () => {
    vi.spyOn(llmClient, 'streamChat').mockResolvedValue('noticed')

    const { result } = renderHook(() => useAiChat(stubEditor()))
    await act(async () => {
      await result.current.sendAuto()
    })

    expect(result.current.messages[0].auto).toBe(true)
  })
})
