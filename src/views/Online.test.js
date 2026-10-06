import { render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import App from '../App.svelte'
import { app } from '../lib/app.svelte.js'
import { remote } from '../lib/remote/sync.svelte.js'
import { createSeedState } from '../lib/seed.js'

/** A signed-in player in an online guild who is not an officer. */
describe('online guild, as a player', () => {
  beforeEach(() => {
    localStorage.clear()
    app.data = createSeedState()
    app.view = 'planner'
    Object.assign(remote, { guildId: 'guild-1', memberId: app.data.members[3].id, officer: false })
    app.data = { ...app.data, currentMemberId: remote.memberId }
  })

  afterEach(() => {
    Object.assign(remote, { guildId: null, memberId: null, officer: false })
  })

  test('players see only the published roster, without editing controls', () => {
    const before = app.data
    render(App)
    expect(screen.queryByRole('button', { name: /Rebuild roster/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull()
    expect(screen.getByText(/Viewing the confirmed roster/)).toBeTruthy()
    expect(app.data).toBe(before)
  })

  test('players are not offered managing the guild or acting as others', () => {
    app.view = 'members'
    render(App)
    expect(screen.queryByRole('button', { name: '+ Add player' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Act as' })).toBeNull()
    expect(screen.queryByLabelText(/Acting as|Editing as/)).toBeNull()
  })

  test('nothing is written to browser storage', () => {
    render(App)
    expect(localStorage.getItem('whentoraid-v3')).toBeNull()
  })

  test('officers keep every control', () => {
    remote.officer = true
    app.view = 'members'
    render(App)
    expect(screen.getByRole('button', { name: '+ Add player' })).toBeTruthy()
    expect(screen.getByLabelText('Editing as')).toBeTruthy()
  })
})
