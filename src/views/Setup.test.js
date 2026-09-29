import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.svelte'
import { app } from '../lib/app.svelte.js'

async function fill(label, value) {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } })
}

describe('first-run setup', () => {
  beforeEach(() => {
    localStorage.clear()
    app.data = null
    app.view = 'planner'
  })

  test('with no saved guild, the app opens on setup', () => {
    render(App)
    expect(screen.getByRole('heading', { name: 'Set up your guild' })).toBeTruthy()
  })

  test('creating a guild makes you its only member and opens Guild members', async () => {
    render(App)
    await fill('Guild name', 'Night Shift')
    await fill('Your name', 'Sam')
    await fill('Character name', 'Firstlight')
    await fill('Realm', 'Whitemane')
    await fill('Specialization', 'Holy')
    await fireEvent.click(screen.getByRole('button', { name: 'Create guild' }))

    expect(app.data.guild.name).toBe('Night Shift')
    expect(app.data.members.map((m) => m.name)).toEqual(['Sam'])
    expect(app.view).toBe('members')
    expect(screen.getByRole('heading', { name: 'Guild members' })).toBeTruthy()
  })

  test('problems are shown on the form', async () => {
    render(App)
    await fill('Guild name', 'Night Shift')
    await fill('Your name', 'Sam')
    await fill('Character name', 'Firstlight')
    await fill('Realm', 'Whitemane')
    await fill('Specialization', 'Holy')
    await fill('Discord user ID (optional)', '12')
    await fireEvent.click(screen.getByRole('button', { name: 'Create guild' }))
    expect(screen.getByRole('alert').textContent).toMatch(/17–20 digits/)
    expect(app.data).toBeNull()
  })

  test('the demo guild is one click away', async () => {
    render(App)
    await fireEvent.click(screen.getByRole('button', { name: 'Explore the demo guild' }))
    expect(app.data.members).toHaveLength(24)
  })
})
