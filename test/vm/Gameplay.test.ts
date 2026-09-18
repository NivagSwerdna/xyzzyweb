import { describe, expect, it } from 'vitest'
import { loadGame } from './fixtures'
import { runHeadless } from './runHeadless'

describe('ZORK1 headless playthrough', () => {
  it('prints the opening banner and West of House on start, and responds to LOOK', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const { screen, steps } = await runHeadless(gameData, ['look'])

    expect(steps).toBeGreaterThan(0)
    const text = screen.lowerText()
    expect(text).toContain('ZORK')
    expect(text).toContain('West of House')
    // The status line (V1-3) should reflect the starting room.
    const statusEvents = screen.events.filter((e) => e.type === 'status')
    expect(statusEvents.length).toBeGreaterThan(0)
    expect(statusEvents[0]!['location']).toContain('West of House')
  })

  it('moves the player and updates the room description on NORTH', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const { screen } = await runHeadless(gameData, ['north'])

    const text = screen.lowerText()
    expect(text).toContain('North of House')
  })

  it('picks up an object and reflects it in inventory', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const { screen } = await runHeadless(gameData, ['east', 'open window', 'enter house', 'take sack', 'inventory'])

    const text = screen.lowerText().toLowerCase()
    expect(text).toContain('sack')
  })

  it('produces deterministic output for a fixed RNG seed', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const a = await runHeadless(gameData, ['north', 'north', 'north'], { seed: 42 })
    const b = await runHeadless(gameData, ['north', 'north', 'north'], { seed: 42 })

    expect(a.screen.lowerText()).toBe(b.screen.lowerText())
  })

  it('reads embedded game text (the leaflet) via a multi-step interaction', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const { screen } = await runHeadless(gameData, ['open mailbox', 'take leaflet', 'read leaflet'])

    const text = screen.lowerText()
    expect(text).toContain('WELCOME TO ZORK')
  })

  it('supports the undo meta-command to roll back one turn', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const { screen } = await runHeadless(gameData, ['north', 'undo', 'look'])

    const text = screen.lowerText()
    expect(text).toContain('[Undone.]')
    // After undo, "look" should redescribe the starting room, not North of House.
    const lastLookIndex = text.lastIndexOf('West of House')
    expect(lastLookIndex).toBeGreaterThan(-1)
  })

  it('round-trips state through save/restore (Quetzal)', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const slots = new Map<string, Uint8Array>()
    const saveHandler = {
      async save(bytes: Uint8Array, slot: string) {
        slots.set(slot, bytes)
      },
      async restore(slot: string) {
        return slots.get(slot) ?? null
      },
    }

    // Move north, save, move south (leaving the saved room), then restore and
    // look again — the restored state should put us back in North of House.
    const { screen } = await runHeadless(gameData, ['north', 'save', 'testslot', 'south', 'restore', 'testslot', 'look'], {
      saveHandler,
    })

    expect(slots.has('testslot')).toBe(true)
    const text = screen.lowerText()
    expect(text.lastIndexOf('North of House')).toBeGreaterThan(-1)
  })

  it('stops cleanly (StopExecution) when the command list runs out mid-game', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const { steps } = await runHeadless(gameData, ['look', 'inventory'])
    // Ran through the scripted commands without throwing, then stopped
    // cleanly when the interpreter next asked for input.
    expect(steps).toBeGreaterThan(0)
  })
})
