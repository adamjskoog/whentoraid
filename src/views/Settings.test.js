import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.svelte'
import { app } from '../lib/app.svelte.js'
import { createSeedState } from '../lib/seed.js'
import { backupJson } from '../lib/storage.js'

function backupFile(state) {
  return new File([backupJson(state)], 'backup.json', { type: 'application/json' })
}

async function chooseFile(file) {
  const input = screen.getByLabelText('Restore from backup…')
  await fireEvent.change(input, { target: { files: [file] } })
}

describe('Guild settings: backup and start over', () => {
  beforeEach(() => {
    localStorage.clear()
    app.data = createSeedState()
    app.view = 'settings'
    app.unreadable = null
  })

  test('restoring a backup replaces the guild, and Undo puts it back', async () => {
    const before = app.data
    const other = { ...createSeedState(), guild: { ...before.guild, name: 'Backup Guild' } }
    render(App)

    await chooseFile(backupFile(other))
    await waitFor(() => expect(app.data.guild.name).toBe('Backup Guild'))
    expect(screen.getByText('Restored Backup Guild from the backup.')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(app.data).toBe(before)
  })

  test('a file that is not a backup leaves the guild alone', async () => {
    const before = app.data
    render(App)
    await chooseFile(new File(['{"hello": 1}'], 'notes.json'))
    await waitFor(() => expect(screen.getByText(/not a WhenToRaid backup/)).toBeTruthy())
    expect(app.data).toBe(before)
  })

  test('erasing the guild can be undone from setup', async () => {
    const before = app.data
    render(App)
    await fireEvent.click(screen.getByRole('button', { name: 'Set up a new guild' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Click again to erase this guild' }))
    expect(app.data).toBeNull()
    expect(screen.getByRole('heading', { name: 'Set up your guild' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(app.data).toBe(before)
  })

  test('raid hours can run past midnight', async () => {
    render(App)
    await fireEvent.change(screen.getByLabelText('Raids can start from'), { target: { value: '20' } })
    await fireEvent.change(screen.getByLabelText('Raids must end by'), { target: { value: '26' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(app.data.guild.dayStartHour).toBe(20)
    expect(app.data.guild.slotsPerDay).toBe(12)
  })
})

describe('recovering unreadable saved data', () => {
  beforeEach(() => {
    localStorage.clear()
    app.data = null
    app.view = 'planner'
  })

  test('setup explains the problem and offers the data for download', () => {
    app.unreadable = JSON.stringify({ version: 99 })
    render(App)
    const notice = screen.getByRole('alert')
    expect(notice.textContent).toMatch(/could not be loaded/)
    expect(notice.textContent).toMatch(/newer version/)
    expect(screen.getByRole('button', { name: 'Download the saved data' })).toBeTruthy()
  })

  test('setup can restore a backup', async () => {
    app.unreadable = null
    render(App)
    await chooseFile(backupFile(createSeedState()))
    await waitFor(() => expect(app.data?.members).toHaveLength(24))
  })
})
