import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.svelte'
import { app } from '../lib/app.svelte.js'

async function choose(label, value) {
  await fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

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

  test('setup links to the privacy policy and terms of service', () => {
    render(App)
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('./privacy.html')
    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('./terms.html')
  })

  test('creating a guild makes you its only member and opens the personal dashboard', async () => {
    render(App)
    await fill('Guild name', 'Night Shift')
    await fill('Your name', 'Sam')
    await fill('Character name', 'Firstlight')
    await fill('Realm', 'Whitemane')
    await choose('Class', 'Priest')
    await choose('Specialization', 'Holy')
    await fireEvent.click(screen.getByRole('button', { name: 'Create guild in this browser' }))

    expect(app.data.guild.name).toBe('Night Shift')
    expect(app.data.members.map((m) => m.name)).toEqual(['Sam'])
    expect(app.view).toBe('home')
    expect(screen.getByRole('heading', { name: 'My next raid' })).toBeTruthy()
  })

  test('problems are shown on the form', async () => {
    render(App)
    await fill('Guild name', 'Night Shift')
    await fill('Your name', 'Sam')
    await fill('Character name', 'Firstlight')
    await fill('Realm', 'Whitemane')
    await choose('Class', 'Priest')
    await choose('Specialization', 'Holy')
    await fill('Discord user ID (optional)', '12')
    await fireEvent.click(screen.getByRole('button', { name: 'Create guild in this browser' }))
    expect(screen.getByRole('alert').textContent).toMatch(/17–20 digits/)
    expect(app.data).toBeNull()
  })

  test('the demo guild is one click away', async () => {
    render(App)
    await fireEvent.click(screen.getByRole('button', { name: 'Explore the demo guild' }))
    expect(app.data.members).toHaveLength(24)
  })
})
