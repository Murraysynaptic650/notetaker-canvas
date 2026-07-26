import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'claude-bridge/node_modules', '**/*.timestamp-*.mjs'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Unused args are fine when prefixed with _ (e.g. deliberate signature padding).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The tldraw shape-creation calls need `as TLShapePartial` casts; those are
      // asserted, not `any`. Genuine `any` should still be flagged.
      '@typescript-eslint/no-explicit-any': 'error',
      // Production code should not log to the console; warn/error are allowed
      // for surfacing real failures.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Test files may use console freely and are not React components.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'no-console': 'off' },
  },
  {
    // Node-side config and the bridge server run outside the browser.
    files: ['*.config.ts', '*.config.js', 'claude-bridge/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
)
