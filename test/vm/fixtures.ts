import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { GAMES, xorFF } from '../../src/ui/games'

const testDir = path.dirname(fileURLToPath(import.meta.url))

// Tests refer to games by their classic .DAT name; the actual files shipped
// under public/data/ are obfuscated and opaquely named (see src/ui/games.ts).
const DAT_TO_GAME_ID: Record<string, string> = {
  'ZORK1.DAT': 'zork1',
  'ZORK2.DAT': 'zork2',
  'ZORK3.DAT': 'zork3',
  'DEADLINE.DAT': 'deadline',
  'TRINITY.DAT': 'trinity',
}

export function loadGame(fileName: string): Uint8Array {
  const gameId = DAT_TO_GAME_ID[fileName]
  if (!gameId) throw new Error(`loadGame: unknown fixture "${fileName}"`)
  const game = GAMES.find((g) => g.id === gameId)
  if (!game) throw new Error(`loadGame: no GAMES entry for "${gameId}"`)

  const filePath = path.resolve(testDir, '../../public/data', game.file)
  const raw = new Uint8Array(readFileSync(filePath))
  return game.obfuscated ? xorFF(raw) : raw
}
