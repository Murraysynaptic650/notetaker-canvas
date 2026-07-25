import { useCallback, useState } from 'react'
import type { Editor } from 'tldraw'
import { boardFingerprint } from './boardContext'
import { useAiChat } from './useAiChat'
import { useBoardWatcher } from './useBoardWatcher'
import { useVoiceInput } from './useVoiceInput'
import {
  DEFAULT_SETTINGS,
  getSettings,
  isConfigured,
  saveSettings,
  type AiSettings,
  type ProviderId,
} from './settingsStore'
import './AiPanel.css'

interface AiPanelProps {
  editor: Editor
}

/**
 * Floating AI collaboration panel. Rendered as a plain sibling over the
 * canvas, same pattern as CanvasOverlay — only depends on Editor, not
 * tldraw's component-injection system.
 */
export function AiPanel({ editor }: AiPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [settings, setSettings] = useState<AiSettings>(getSettings)
  const [showSettings, setShowSettings] = useState(() => !isConfigured(getSettings()))
  const [draft, setDraft] = useState('')

  const { messages, isSending, error, sendMessage, sendAuto, clearError, resetConversation } =
    useAiChat(editor)

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text || isSending) return
    setDraft('')
    void sendMessage(text)
  }, [draft, isSending, sendMessage])

  // Voice input: interim results fill the box live, final phrases auto-send.
  const voice = useVoiceInput({
    onInterim: (text) => setDraft(text),
    onFinal: (text) => {
      setDraft('')
      void sendMessage(text)
    },
  })

  // Proactive collaboration: when auto-watch is on, react after the board
  // settles. Fingerprint on shape geometry so handwriting/drawings count too,
  // not just typed text.
  useBoardWatcher(editor, settings.autoWatch && isConfigured(settings), {
    getSnapshot: () => boardFingerprint(editor),
    onSettled: () => {
      if (!isSending) void sendAuto()
    },
  })

  const applySettings = useCallback((next: AiSettings) => {
    setSettings(saveSettings(next))
  }, [])

  const toggleAutoWatch = useCallback(() => {
    setSettings((current) => saveSettings({ autoWatch: !current.autoWatch }))
  }, [])

  const toggleFocus = useCallback(() => {
    setSettings((current) => saveSettings({ focusSelection: !current.focusSelection }))
  }, [])

  const toggleBoardReply = useCallback(() => {
    setSettings((current) => saveSettings({ boardReply: !current.boardReply }))
  }, [])

  return (
    <div className="ai-panel-root">
      <button
        type="button"
        className="ai-panel-toggle"
        onClick={() => setIsOpen((open) => !open)}
        title="AI study partner"
      >
        {isOpen ? '✕' : '💬 AI'}
      </button>

      {isOpen && (
        <div className="ai-panel">
          <div className="ai-panel-header">
            <span>Study partner</span>
            <div className="ai-panel-header-actions">
              <button
                type="button"
                className={settings.boardReply ? 'is-active' : undefined}
                onClick={toggleBoardReply}
                title={
                  settings.boardReply
                    ? 'Answer on board: on (replies are drawn on the canvas)'
                    : 'Answer on board: off (replies appear in chat)'
                }
              >
                🖊️
              </button>
              <button
                type="button"
                className={settings.focusSelection ? 'is-active' : undefined}
                onClick={toggleFocus}
                title={
                  settings.focusSelection
                    ? 'Focus on selection: on (select shapes to point at them)'
                    : 'Focus on selection: off'
                }
              >
                🎯
              </button>
              <button
                type="button"
                className={settings.autoWatch ? 'is-active' : undefined}
                onClick={toggleAutoWatch}
                title={settings.autoWatch ? 'Auto-watch board: on' : 'Auto-watch board: off'}
              >
                {settings.autoWatch ? '👁️' : '👁️‍🗨️'}
              </button>
              <button type="button" onClick={() => setShowSettings((s) => !s)} title="Settings">
                ⚙️
              </button>
              <button type="button" onClick={resetConversation} title="Clear conversation">
                🗑️
              </button>
            </div>
          </div>

          {showSettings ? (
            <ProviderSettings
              initial={settings}
              onSave={(next) => {
                applySettings(next)
                setShowSettings(false)
              }}
            />
          ) : (
            <>
              <div className="ai-panel-messages">
                {messages.length === 0 && (
                  <p className="ai-panel-hint">
                    Write or ask something and I'll respond about what's on the board
                    {settings.autoWatch ? ' — and I’ll chime in as you edit.' : '.'}
                  </p>
                )}
                {messages.map((message, index) =>
                  message.auto ? (
                    <div key={index} className="ai-message-auto">
                      👁️ reacting to your board edits…
                    </div>
                  ) : (
                    <div key={index} className={`ai-message ai-message--${message.role}`}>
                      {message.text}
                    </div>
                  ),
                )}
              </div>

              {error && (
                <div className="ai-panel-error" role="alert" onClick={clearError}>
                  {error}
                </div>
              )}

              <div className="ai-panel-input">
                {voice.supported && (
                  <button
                    type="button"
                    className={`ai-panel-mic${voice.listening ? ' is-listening' : ''}`}
                    onClick={voice.toggle}
                    title={voice.listening ? 'Stop listening' : 'Speak to the AI'}
                  >
                    {voice.listening ? '🔴' : '🎤'}
                  </button>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Write, speak, or ask a question…"
                  rows={2}
                />
                <button type="button" onClick={handleSend} disabled={isSending || !draft.trim()}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface ProviderSettingsProps {
  initial: AiSettings
  onSave: (settings: AiSettings) => void
}

const DEFAULT_MODEL_FOR: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  gemini: 'gemini-2.5-flash',
  openai: '',
  claudecode: 'sonnet',
}

/** True when the model isn't one of our provider defaults, so it's worth keeping across a provider switch. */
function isCustomModel(model: string): boolean {
  const trimmed = model.trim()
  return trimmed !== '' && !Object.values(DEFAULT_MODEL_FOR).includes(trimmed)
}

function apiKeyPlaceholder(provider: ProviderId): string {
  if (provider === 'gemini') return 'AIza…'
  if (provider === 'openai') return 'only if your server requires one'
  return 'sk-ant-…'
}

function settingsNote(provider: ProviderId): string {
  switch (provider) {
    case 'openai':
      return 'Requests go directly from this browser to your server, so it must allow this origin (CORS). For Ollama set OLLAMA_ORIGINS; for vLLM use --allowed-origins.'
    case 'gemini':
      return 'Stored only in this browser (localStorage), never sent anywhere except directly to Google’s Gemini API.'
    case 'anthropic':
      return 'Stored only in this browser (localStorage), never sent anywhere except directly to Anthropic’s API.'
    case 'claudecode':
      return 'Runs Claude Code headless on your Mac via the local bridge (default: Sonnet). Start it with your OAuth token: cd claude-bridge && npm install && CLAUDE_CODE_OAUTH_TOKEN=… npm start. It can answer general questions and run commands / read the board on that machine.'
  }
}

const MODEL_PLACEHOLDER_FOR: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  gemini: 'e.g. gemini-2.5-flash',
  openai: 'e.g. llama-3.3-70b-instruct',
  claudecode: 'sonnet',
}

function ProviderSettings({ initial, onSave }: ProviderSettingsProps) {
  const [draft, setDraft] = useState<AiSettings>(initial)
  const isOpenAI = draft.provider === 'openai'
  // The Claude Code bridge holds its own URL/auth/model server-side, so the app
  // needs no fields for it.
  const isClaudeCode = draft.provider === 'claudecode'

  const update = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const onProviderChange = (provider: ProviderId) =>
    setDraft((current) => ({
      ...current,
      provider,
      // Give a sensible default model when switching, unless the user has set
      // a non-default one worth keeping.
      model: isCustomModel(current.model) ? current.model : DEFAULT_MODEL_FOR[provider],
    }))

  return (
    <div className="ai-panel-settings">
      <label htmlFor="ai-provider">Provider</label>
      <select
        id="ai-provider"
        value={draft.provider}
        onChange={(event) => onProviderChange(event.target.value as ProviderId)}
      >
        <option value="anthropic">Anthropic API</option>
        <option value="gemini">Google Gemini API</option>
        <option value="openai">Local / OpenAI-compatible (vLLM, Ollama)</option>
        <option value="claudecode">Claude Code (agent, your Mac)</option>
      </select>

      {!isClaudeCode && (
        <>
          {isOpenAI && (
            <>
              <label htmlFor="ai-base-url">Server base URL</label>
              <input
                id="ai-base-url"
                type="text"
                value={draft.baseUrl}
                onChange={(event) => update('baseUrl', event.target.value)}
                placeholder="http://your-server:8000/v1"
                autoComplete="off"
              />
            </>
          )}

          <label htmlFor="ai-model">Model</label>
          <input
            id="ai-model"
            type="text"
            value={draft.model}
            onChange={(event) => update('model', event.target.value)}
            placeholder={MODEL_PLACEHOLDER_FOR[draft.provider]}
            autoComplete="off"
          />

          <label htmlFor="ai-api-key">API key{isOpenAI ? ' (optional)' : ''}</label>
          <input
            id="ai-api-key"
            type="password"
            value={draft.apiKey}
            onChange={(event) => update('apiKey', event.target.value)}
            placeholder={apiKeyPlaceholder(draft.provider)}
            autoComplete="off"
          />
        </>
      )}

      <p className="ai-panel-settings-note">{settingsNote(draft.provider)}</p>

      <div className="ai-panel-settings-actions">
        <button type="button" onClick={() => setDraft(DEFAULT_SETTINGS)}>
          Reset
        </button>
        <button
          type="button"
          disabled={!isConfigured(draft)}
          onClick={() => onSave(draft)}
        >
          Save
        </button>
      </div>
    </div>
  )
}
