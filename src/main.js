import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

mount(App, { target: document.getElementById('app') })

// Offline support and "Add to Home Screen". Development builds skip it so edits are never cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // A failed registration (private mode, blocked storage) only means no offline copy; the app still works.
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
