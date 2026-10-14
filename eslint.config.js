import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'

export default [
  { ignores: ['dist/', 'legacy/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['*.config.js', 'vitest-setup.js', 'integration/**/*.js', 'dev/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Supabase Edge Functions run on Deno; their console output is the server log.
    files: ['supabase/functions/**/*.js'],
    languageOptions: { globals: { Deno: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
]
