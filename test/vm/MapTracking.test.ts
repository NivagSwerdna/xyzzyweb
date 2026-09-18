import { describe, expect, it } from 'vitest'
import type { TurnObserver } from '../../src/vm/Instructions'
import { loadGame } from './fixtures'
import { runHeadless } from './runHeadless'

describe('room-transition tracking (turnObserver)', () => {
  it('records an edge for every command that moves the player to a new room', async () => {
    const gameData = loadGame('ZORK1.DAT')
    const edges: Array<{ from: string | null; to: string | null; command: string }> = []
    const observer: TurnObserver = {
      onTurn: (from, to, command) => edges.push({ from, to, command }),
    }

    await runHeadless(gameData, ['north', 'east', 'look', 'south'], { turnObserver: observer })

    // "look" doesn't move the player, so it should not produce an edge.
    expect(edges.map((e) => e.command)).toEqual(['north', 'east', 'south'])

    expect(edges[0]!.from).toContain('West of House')
    expect(edges[0]!.to).toContain('North of House')

    expect(edges[1]!.from).toContain('North of House')
    expect(edges[1]!.to).toContain('Behind House')

    expect(edges[2]!.from).toContain('Behind House')
    expect(edges[2]!.to).toContain('South of House')
  })

  it('does nothing when no turnObserver is set', async () => {
    const gameData = loadGame('ZORK1.DAT')
    // Should behave exactly as before: no crash, no map bookkeeping cost.
    const { steps } = await runHeadless(gameData, ['north', 'east'])
    expect(steps).toBeGreaterThan(0)
  })
})
