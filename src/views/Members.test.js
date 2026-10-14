import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { charactersOf } from '../lib/model.js'
import { createSeedState } from '../lib/seed.js'
import Members from './Members.svelte'

async function choose(label, value) {
  await fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function fill(label, value) {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } })
}

describe('Guild members', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('adds a player with their main character', async () => {
    render(Members)
    await fireEvent.click(screen.getByRole('button', { name: '+ Add player' }))
    await fill('Player name', 'Nova')
    await fill('Character name', 'Starfall')
    await fill('Realm', 'Whitemane')
    await choose('Class', 'Mage')
    await choose('Specialization', 'Arcane')
    await fireEvent.click(screen.getByRole('button', { name: 'Add player' }))

    const nova = app.data.members.find((m) => m.name === 'Nova')
    expect(nova).toBeTruthy()
    expect(charactersOf(app.data, nova.id).map((c) => c.name)).toEqual(['Starfall'])
    expect(screen.getByRole('rowheader', { name: /Nova/ })).toBeTruthy()
  })

  test('"Act as" switches the current member', async () => {
    render(Members)
    const row = screen.getByRole('rowheader', { name: /Briar/ }).closest('tr')
    await fireEvent.click(within(row).getByRole('button', { name: 'Act as' }))
    expect(app.data.currentMemberId).toBe('m1')
    expect(within(row).getByRole('button', { name: 'Acting as' }).disabled).toBe(true)
  })

  test('removing a player takes two clicks', async () => {
    render(Members)
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Briar' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Remove from guild' }))
    expect(app.data.members.some((m) => m.id === 'm1')).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'Click again to remove' }))
    expect(app.data.members.some((m) => m.id === 'm1')).toBe(false)
  })

  test('shows each player’s check-in status for the week', () => {
    render(Members)
    expect(screen.getAllByText('Checked in')).toHaveLength(24)
  })

  test('finds players by an alt character and combines role and check-in filters', async () => {
    render(Members)
    await fill('Search players or characters', 'Stoneguardalt')
    expect(screen.getByRole('rowheader', { name: /Adam/ })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: /Briar/ })).toBeNull()
    await choose('Role', 'Healer')
    expect(screen.getByRole('rowheader', { name: /Adam/ })).toBeTruthy()
    await choose('Check-in', 'waiting')
    expect(screen.getByText('No players match these filters.')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByRole('rowheader')).toHaveLength(24)
    expect(screen.getByLabelText('Search players or characters').value).toBe('')
    expect(screen.getByLabelText('Role').value).toBe('')
    expect(screen.getByLabelText('Check-in').value).toBe('')
  })

  test('changing the directory week updates check-ins and snaps the date to Monday', async () => {
    render(Members)
    await choose('Week beginning', '2026-10-07')
    expect(app.data.currentWeek).toBe('2026-10-05')
    expect(screen.getByLabelText('Week beginning').value).toBe('2026-10-05')
    expect(screen.getAllByText('Waiting')).toHaveLength(24)
    expect(screen.getByText(/^0 of 24 players checked in/).textContent).toContain('24 waiting')
  })
})
