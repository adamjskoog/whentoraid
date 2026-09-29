import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { localSignIn } from './dev/local-sign-in.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    // Relative asset paths, so the build works at a domain root or a sub-path such as GitHub Pages.
    base: './',
    // localSignIn only runs on the dev server, and only against a local Supabase.
    plugins: [svelte(), svelteTesting(), localSignIn(env.VITE_SUPABASE_URL)],
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest-setup.js'],
      include: ['src/**/*.test.js'],
      // Unit tests run browser-only, even when .env.local points the dev server at a Supabase.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
      // Full-page component tests take ~2 s alone and can pass 5 s when every file runs in parallel.
      testTimeout: 15_000,
    },
  }
})
