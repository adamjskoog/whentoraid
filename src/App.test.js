import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import App from './App.svelte'
import { app } from './lib/app.svelte.js'
import { createSeedState, SEED_WEEK } from './lib/seed.js'

describe('URL routing', () => {
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '#')
    app.data = createSeedState()
    app.view = 'planner'
  })

  test('the page and week are kept in the URL', async () => {
    render(App)
    await waitFor(() => expect(location.hash).toBe(`#/planner/${SEED_WEEK}`))
    await fireEvent.click(screen.getByRole('button', { name: /Guild members/ }))
    await waitFor(() => expect(location.hash).toBe(`#/members/${SEED_WEEK}`))
  })

  test('following a link opens that page and week', async () => {
    render(App)
    location.hash = '#/availability/2026-10-07'
    await waitFor(() => expect(app.view).toBe('availability'))
    expect(app.data.currentWeek).toBe('2026-10-05')
  })
})

describe('other tabs', () => {
  beforeEach(() => {
    localStorage.clear()
    app.data = createSeedState()
    app.view = 'planner'
  })

  test('a save in another tab replaces this tab’s guild', async () => {
    render(App)
    const renamed = { ...app.data, guild: { ...app.data.guild, name: 'Renamed Elsewhere' } }
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'whentoraid-v3', newValue: JSON.stringify(renamed) }),
    )
    await waitFor(() => expect(app.data.guild.name).toBe('Renamed Elsewhere'))
    expect(screen.getByText('Updated with changes from another tab.')).toBeTruthy()
  })

  test('each tab keeps its own week', async () => {
    render(App)
    const before = app.data
    const paged = { ...before, currentWeek: '2026-10-12' }
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'whentoraid-v3', newValue: JSON.stringify(paged) }),
    )
    const renamed = { ...paged, guild: { ...before.guild, name: 'Renamed' } }
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'whentoraid-v3', newValue: JSON.stringify(renamed) }),
    )
    await waitFor(() => expect(app.data.guild.name).toBe('Renamed'))
    expect(app.data.currentWeek).toBe(before.currentWeek)
  })
})

describe('undo', () => {
  beforeEach(() => {
    localStorage.clear()
    app.data = createSeedState()
    app.view = 'members'
  })

  test('removing a player can be undone', async () => {
    const before = app.data
    render(App)
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Briar' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Remove from guild' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Click again to remove' }))
    expect(app.data.members.some((m) => m.name === 'Briar')).toBe(false)

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(app.data).toBe(before)
  })

  test('Undo refuses once something else has changed', async () => {
    render(App)
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Briar' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Remove from guild' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Click again to remove' }))
    app.data = { ...app.data, guild: { ...app.data.guild, name: 'Edited since' } }

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(app.data.guild.name).toBe('Edited since')
    expect(app.data.members.some((m) => m.name === 'Briar')).toBe(false)
    expect(screen.getByText(/Can’t undo/)).toBeTruthy()
  })
})
