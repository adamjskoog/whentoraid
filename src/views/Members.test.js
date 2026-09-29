import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { charactersOf } from '../lib/model.js'
import { createSeedState } from '../lib/seed.js'
import Members from './Members.svelte'

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
    await fill('Specialization', 'Arcane')
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
})
