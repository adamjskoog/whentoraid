import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { charactersOf } from '../lib/model.js'
import { createSeedState } from '../lib/seed.js'
import Characters from './Characters.svelte'

describe('Characters view', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('"Edit character" opens the existing character and saves it in place', async () => {
    render(Characters)
    const before = charactersOf(app.data, 'm0').length

    await fireEvent.click(screen.getAllByRole('button', { name: 'Edit character' })[0])
    expect(screen.getByRole('heading', { name: 'Edit character' })).toBeTruthy()

    const nameInput = screen.getByLabelText('Character name')
    expect(nameInput.value).toBe('Stoneguard')

    await fireEvent.input(nameInput, { target: { value: 'Stonewall' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save character' }))

    const after = charactersOf(app.data, 'm0')
    expect(after).toHaveLength(before)
    expect(after.find((c) => c.id === 'c0a').name).toBe('Stonewall')
  })

  test('the specialization list follows the chosen class', async () => {
    render(Characters)
    await fireEvent.click(screen.getAllByRole('button', { name: 'Edit character' })[0])
    const spec = screen.getByLabelText('Specialization')
    const options = () => [...spec.options].filter((o) => !o.disabled).map((o) => o.value)
    expect(spec.value).toBe('Protection')
    expect(options()).toEqual(['Arms', 'Fury', 'Protection'])

    await fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'Druid' } })
    expect(options()).toEqual(['Balance', 'Feral Combat', 'Restoration'])
    expect(spec.value).toBe('')
  })

  test('a spec typed before the dropdown existed stays until it is changed', async () => {
    app.data = {
      ...app.data,
      characters: app.data.characters.map((c) => (c.id === 'c0a' ? { ...c, spec: 'Deep Prot' } : c)),
    }
    render(Characters)
    await fireEvent.click(screen.getAllByRole('button', { name: 'Edit character' })[0])
    expect(screen.getByLabelText('Specialization').value).toBe('Deep Prot')

    await fireEvent.click(screen.getByRole('button', { name: 'Save character' }))
    expect(charactersOf(app.data, 'm0').find((c) => c.id === 'c0a').spec).toBe('Deep Prot')
  })

  test('"Make main" swaps which character is the main', async () => {
    render(Characters)
    await fireEvent.click(screen.getByRole('button', { name: 'Make main' }))
    expect(charactersOf(app.data, 'm0').map((c) => c.main)).toEqual([false, true])
  })

  test('deleting a character takes a second click to confirm', async () => {
    render(Characters)
    await fireEvent.click(screen.getAllByRole('button', { name: 'Edit character' })[1])
    await fireEvent.click(screen.getByRole('button', { name: 'Delete character' }))
    expect(charactersOf(app.data, 'm0')).toHaveLength(2)

    await fireEvent.click(screen.getByRole('button', { name: 'Click again to delete' }))
    expect(charactersOf(app.data, 'm0').map((c) => c.id)).toEqual(['c0a'])
  })

  test('"Add character" adds a new alt', async () => {
    render(Characters)
    await fireEvent.click(screen.getByRole('button', { name: '+ Add character' }))
    expect(screen.getByRole('heading', { name: 'Add character' })).toBeTruthy()

    await fireEvent.input(screen.getByLabelText('Character name'), { target: { value: 'Newblade' } })
    await fireEvent.input(screen.getByLabelText('Realm'), { target: { value: 'Whitemane' } })
    await fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'Rogue' } })
    await fireEvent.change(screen.getByLabelText('Specialization'), { target: { value: 'Combat' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save character' }))

    const names = charactersOf(app.data, 'm0').map((c) => c.name)
    expect(names).toEqual(['Stoneguard', 'Stoneguardalt', 'Newblade'])
  })
})
