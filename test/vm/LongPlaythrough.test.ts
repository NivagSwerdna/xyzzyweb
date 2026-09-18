import { describe, expect, it } from 'vitest'
import { loadGame } from './fixtures'
import { runHeadless } from './runHeadless'

// A much longer scripted playthrough than Gameplay.test.ts, intended to
// stress-test a broad slice of the opcode set (combat/damage, containers,
// darkness, climbing, the maze, scoring) rather than to win the game.
// Mainly asserts the interpreter never throws; loosely checks a few
// well-known landmarks show up so a silent-wrong-output regression would
// still fail the test.
describe('ZORK1 extended headless playthrough', () => {
  it('runs a long tour of the house, cellar, troll, and maze without throwing', async () => {
    const gameData = loadGame('ZORK1.DAT')

    const commands = [
      'open mailbox',
      'read leaflet',
      'drop leaflet',
      'south',
      'east',
      'open window',
      'enter house',
      'take all',
      'west',
      'take lamp',
      'take sword',
      'move rug',
      'open trap door',
      'turn on lamp',
      'down',
      'north',
      'kill troll with sword',
      'kill troll with sword',
      'kill troll with sword',
      'kill troll with sword',
      'kill troll with sword',
      'look',
      'inventory',
      'north',
      'east',
      'east',
      'up',
      'east',
      'take painting',
      'down',
      'west',
      'south',
      'east',
      'up',
      'east',
      'take chalice',
      'west',
      'down',
      'south',
      'east',
      'east',
      'take torch',
      'turn off lamp',
      'down',
      'south',
      'down',
      'east',
      'take all',
      'up',
      'up',
      'west',
      'west',
      'up',
      'up',
      'east',
      'south',
      'east',
      'south',
      'west',
      'up',
    ]

    const { screen, steps } = await runHeadless(gameData, commands, { seed: 12345, maxSteps: 5_000_000 })

    expect(steps).toBeGreaterThan(0)

    const text = screen.lowerText()
    expect(text).not.toContain('[Interpreter error')

    // Landmarks actually reached by this route (verified against the real
    // transcript) — combat, the Loud Room's word-garbling gimmick, and the
    // death/grue/resurrection sequence all fired correctly.
    expect(text).toContain('Troll Room')
    expect(text).toContain('nasty-looking troll')
    expect(text).toContain('The unarmed troll cannot defend himself: He dies.')
    expect(text).toContain('Round Room')
    expect(text).toContain('Loud Room')
    expect(text).toContain('Mirror Room')
    expect(text).toContain('Entrance to Hades')
    expect(text).toContain('You have died')
    expect(text).toContain('probably deserve another chance')
    expect(text).toContain('Forest Path')
  })
})
