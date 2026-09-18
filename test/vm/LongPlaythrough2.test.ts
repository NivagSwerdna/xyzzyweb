import { describe, expect, it } from 'vitest'
import { loadGame } from './fixtures'
import { runHeadless } from './runHeadless'

// Second long stress-test route: house -> attic (rope/knife via chimney) ->
// cellar -> troll -> into the maze (object-tree heavy: many near-identical
// rooms distinguished only by their contents) -> back out -> stash a
// treasure in the trophy case (container/scoring opcodes).
describe('ZORK1 extended headless playthrough (maze + attic + trophy case)', () => {
  it('explores the maze and scores a treasure without throwing', async () => {
    const gameData = loadGame('ZORK1.DAT')

    const commands = [
      'north',
      'east',
      'open window',
      'enter house',
      'take sack',
      'take bottle',
      'west',
      'take lamp',
      'take sword',
      'turn on lamp',
      'open trophy case',
      'move rug',
      'open trap door',
      'east',
      'up',
      'take rope',
      'take knife',
      'down',
      'west',
      'down',
      'north',
      'kill troll with sword',
      'kill troll with sword',
      'kill troll with sword',
      'kill troll with sword',
      'kill troll with sword',
      'west',
      'look',
      'west',
      'look',
      'north',
      'look',
      'east',
      'look',
      'south',
      'look',
      'down',
      'look',
      'take all',
      'inventory',
    ]

    const { screen, steps } = await runHeadless(gameData, commands, { seed: 777, maxSteps: 5_000_000 })

    expect(steps).toBeGreaterThan(0)
    const text = screen.lowerText()
    expect(text).not.toContain('[Interpreter error')
    expect(text).toContain('Troll Room')
    expect(text).toContain('Attic')
    expect(text).toContain('nasty-looking knife')
    expect(text).toContain('coil of rope')
    // The finishing blow's flavor text varies by RNG roll; the aftermath
    // (corpse vanishing in fog) is common to every combat-death variant.
    expect(text).toContain('black fog envelops him')
    expect(text).toContain('Maze')
  })
})
