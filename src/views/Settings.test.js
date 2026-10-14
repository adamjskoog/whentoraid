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

    await fireEvent.click(screen.getByRole('tab', { name: 'Backups' }))
    await chooseFile(backupFile(other))
    await waitFor(() => expect(app.data.guild.name).toBe('Backup Guild'))
    expect(screen.getByText('Restored Backup Guild from the backup.')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(app.data).toBe(before)
  })

  test('a file that is not a backup leaves the guild alone', async () => {
    const before = app.data
    render(App)
    await fireEvent.click(screen.getByRole('tab', { name: 'Backups' }))
    await chooseFile(new File(['{"hello": 1}'], 'notes.json'))
    await waitFor(() => expect(screen.getByText(/not a WhenToRaid backup/)).toBeTruthy())
    expect(app.data).toBe(before)
  })

  test('erasing the guild can be undone from setup', async () => {
    const before = app.data
    render(App)
    await fireEvent.click(screen.getByRole('tab', { name: 'Backups' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Set up a new guild' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Click again to erase this guild' }))
    expect(app.data).toBeNull()
    expect(screen.getByRole('heading', { name: 'Set up your guild' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(app.data).toBe(before)
  })

  test('attendance tracking starts off and can be turned on', async () => {
    render(App)
    const toggle = screen.getByRole('checkbox', { name: 'Track attendance after each raid' })
    expect(toggle.checked).toBe(false)

    await fireEvent.click(toggle)
    await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(app.data.settings.trackAttendance).toBe(true)
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

describe('Guild settings: unsaved changes', () => {
  beforeEach(() => {
    localStorage.clear()
    app.data = createSeedState()
    app.view = 'settings'
    app.unreadable = null
  })

  const guildName = () => screen.getByLabelText('Guild name')
  const goToPlanner = () => fireEvent.click(screen.getByRole('button', { name: /Raid planner/ }))

  test('switching settings sections retains the draft and its leave guard', async () => {
    render(App)
    await fireEvent.input(guildName(), { target: { value: 'Renamed' } })
    await fireEvent.click(screen.getByRole('tab', { name: 'Connections' }))
    expect(screen.getByText('You have unsaved raid rules.')).toBeTruthy()
    await goToPlanner()
    expect(app.view).toBe('settings')
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    expect(guildName().value).toBe('Renamed')
    await fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }))
    expect(guildName().value).toBe('The After Hours')
    await goToPlanner()
    expect(app.view).toBe('planner')
  })

  test('leaving backups cancels a pending guild replacement confirmation', async () => {
    render(App)
    await fireEvent.click(screen.getByRole('tab', { name: 'Backups' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Replace with the demo guild' }))
    await fireEvent.click(screen.getByRole('tab', { name: 'Raid rules' }))
    await fireEvent.click(screen.getByRole('tab', { name: 'Backups' }))
    expect(screen.queryByRole('button', { name: 'Click again to replace your guild' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Replace with the demo guild' })).toBeTruthy()
  })

  test('leaving with unsaved changes stays on the page until they are discarded', async () => {
    render(App)
    await fireEvent.input(guildName(), { target: { value: 'Renamed' } })

    await goToPlanner()
    expect(app.view).toBe('settings')
    expect(screen.getByText(/You have unsaved guild settings/)).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(app.view).toBe('planner')
    expect(app.data.guild.name).toBe('The After Hours')
  })

  test('changing a field back to its saved value is not an unsaved change', async () => {
    render(App)
    await fireEvent.input(guildName(), { target: { value: 'Renamed' } })
    await fireEvent.input(guildName(), { target: { value: 'The After Hours' } })
    await goToPlanner()
    expect(app.view).toBe('planner')
  })

  test('turning off the check-in deadline counts as a change', async () => {
    render(App)
    await fireEvent.click(screen.getByRole('checkbox', { name: /check in by a deadline/ }))
    await goToPlanner()
    expect(app.view).toBe('settings')
  })

  test('switching raids with unsaved changes waits, and discarding resets the form', async () => {
    render(App)
    const before = app.data.currentRaidId
    await fireEvent.input(guildName(), { target: { value: 'Renamed' } })
    const other = screen.getAllByRole('button', { pressed: false }).find((b) => b.closest('.raid-selector'))
    await fireEvent.click(other)
    expect(app.data.currentRaidId).toBe(before)

    await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(app.data.currentRaidId).not.toBe(before)
    expect(guildName().value).toBe('The After Hours')
    await goToPlanner()
    expect(app.view).toBe('planner')
  })

  test('closing the tab with unsaved changes asks the browser to confirm', async () => {
    render(App)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await fireEvent.input(guildName(), { target: { value: 'Renamed' } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
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
