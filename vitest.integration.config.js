import { defineConfig } from 'vitest/config'

// Runs against the local Supabase from `npx supabase start`; see README.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['integration/**/*.test.js'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
