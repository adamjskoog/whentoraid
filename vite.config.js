import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

export default defineConfig({
  // Relative asset paths, so the build works at a domain root or a sub-path such as GitHub Pages.
  base: './',
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.js'],
    include: ['src/**/*.test.js'],
    // Full-page component tests take ~2 s alone and can pass 5 s when every file runs in parallel.
    testTimeout: 15_000,
  },
})
