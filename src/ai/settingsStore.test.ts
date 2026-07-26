import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, getSettings, isConfigured, saveSettings } from './settingsStore'

const STORAGE_KEY = 'notetaker-ai-settings'
const LEGACY_KEY_STORAGE = 'notetaker-anthropic-api-key'

beforeEach(() => {
  window.localStorage.clear()
})

describe('getSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('reads back what was saved', () => {
    saveSettings({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'AIzaTEST' })
    const settings = getSettings()
    expect(settings.provider).toBe('gemini')
    expect(settings.model).toBe('gemini-2.5-flash')
    expect(settings.apiKey).toBe('AIzaTEST')
  })

  it('falls back to defaults on corrupt JSON instead of throwing', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('migrates an API key saved by the older Anthropic-only version', () => {
    window.localStorage.setItem(LEGACY_KEY_STORAGE, 'sk-ant-legacy')
    const settings = getSettings()
    expect(settings.apiKey).toBe('sk-ant-legacy')
    expect(settings.provider).toBe('anthropic')
  })

  it('prefers stored settings over the legacy key', () => {
    window.localStorage.setItem(LEGACY_KEY_STORAGE, 'sk-ant-legacy')
    saveSettings({ apiKey: 'sk-ant-current' })
    expect(getSettings().apiKey).toBe('sk-ant-current')
  })

  it('coerces an unknown provider back to anthropic', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'skynet' }))
    expect(getSettings().provider).toBe('anthropic')
  })

  it('coerces non-string fields to their defaults', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl: 42, model: null, apiKey: { nested: true } }),
    )
    const settings = getSettings()
    expect(settings.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl)
    expect(settings.model).toBe(DEFAULT_SETTINGS.model)
    expect(settings.apiKey).toBe('')
  })

  it('treats non-true toggle values as false', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ autoWatch: 'yes', focusSelection: 1, boardReply: null }),
    )
    const settings = getSettings()
    expect(settings.autoWatch).toBe(false)
    expect(settings.focusSelection).toBe(false)
    expect(settings.boardReply).toBe(false)
  })
})

describe('saveSettings', () => {
  it('merges a patch over existing settings rather than replacing them', () => {
    saveSettings({ provider: 'openai', baseUrl: '/llm/v1', model: 'local-model' })
    saveSettings({ autoWatch: true })
    const settings = getSettings()
    expect(settings.provider).toBe('openai')
    expect(settings.baseUrl).toBe('/llm/v1')
    expect(settings.autoWatch).toBe(true)
  })

  it('returns the merged result it persisted', () => {
    const returned = saveSettings({ boardReply: true })
    expect(returned).toEqual(getSettings())
  })

  it('does not mutate the exported defaults object', () => {
    const before = { ...DEFAULT_SETTINGS }
    saveSettings({ provider: 'gemini', apiKey: 'AIza' })
    expect(DEFAULT_SETTINGS).toEqual(before)
  })
})

describe('isConfigured', () => {
  it('is always true for the Claude Code bridge, which holds its own auth', () => {
    expect(isConfigured({ ...DEFAULT_SETTINGS, provider: 'claudecode', apiKey: '', model: '' })).toBe(
      true,
    )
  })

  it('requires a key and model for hosted providers', () => {
    const anthropic = { ...DEFAULT_SETTINGS, provider: 'anthropic' as const }
    expect(isConfigured({ ...anthropic, apiKey: '' })).toBe(false)
    expect(isConfigured({ ...anthropic, apiKey: 'sk-ant-x', model: '' })).toBe(false)
    expect(isConfigured({ ...anthropic, apiKey: 'sk-ant-x' })).toBe(true)
  })

  it('requires a base URL and model — but no key — for self-hosted servers', () => {
    const local = { ...DEFAULT_SETTINGS, provider: 'openai' as const, apiKey: '' }
    expect(isConfigured({ ...local, baseUrl: '', model: 'local-model' })).toBe(false)
    expect(isConfigured({ ...local, baseUrl: '/llm/v1', model: '' })).toBe(false)
    expect(isConfigured({ ...local, baseUrl: '/llm/v1', model: 'local-model' })).toBe(true)
  })

  it('rejects whitespace-only values', () => {
    expect(isConfigured({ ...DEFAULT_SETTINGS, provider: 'anthropic', apiKey: '   ' })).toBe(false)
    expect(
      isConfigured({ ...DEFAULT_SETTINGS, provider: 'openai', baseUrl: '  ', model: '  ' }),
    ).toBe(false)
  })
})
