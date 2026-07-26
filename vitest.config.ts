import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts on purpose: that config loads the PWA
// plugin and the dev-server proxies, none of which the test run needs (and the
// service worker generation is slow). Tests import source modules directly.
export default defineConfig({
  test: {
    // jsdom because several modules touch browser globals (localStorage,
    // document/canvas) even though the logic under test is pure.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Gate the *logic* layer only. Everything left out below is either a UI
      // component or a thin wrapper over a browser API that a unit test can
      // only assert against its own mock (canvas rendering, SpeechRecognition,
      // service-worker registration, file download/share, tldraw's editor).
      // Those belong in an E2E suite (Playwright) driving a real browser —
      // stubbing them here would buy coverage percentage, not confidence.
      include: [
        'src/ai/boardActions.ts',
        'src/ai/boardContext.ts',
        'src/ai/llmClient.ts',
        'src/ai/settingsStore.ts',
        'src/ai/thinkFilter.ts',
        'src/ai/useAiChat.ts',
        'src/export/filename.ts',
      ],
      // Two included files are part logic, part browser API — captureBoardImage
      // (canvas) in boardContext, and the Anthropic SDK path in llmClient. Their
      // untested halves are what keeps the line threshold below the branch one.
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
