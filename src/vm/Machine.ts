import { AbbreviationTable } from './AbbreviationTable'
import { DictionaryTable } from './DictionaryTable'
import { Header } from './Header'
import { ObjectTable } from './ObjectTable'
import { Processor } from './Processor'
import type { SaveHandler } from './Instructions'
import type { Screen } from './Screen'

export interface BuildMachineOptions {
  /** The raw, unmodified game file bytes as fetched — never mutated. */
  gameData: Uint8Array
  screen: Screen
  filename: string
  seed?: number
  saveHandler?: SaveHandler
}

/**
 * Load a game file, patch interpreter header bytes, and wire up all
 * subsystems. Returns the ready-to-run Processor; the caller drives the main
 * loop (see runLoop in the screen layer).
 */
export function buildMachine(options: BuildMachineOptions): Processor {
  const { gameData, screen, filename, seed, saveHandler } = options

  // Working copy: header patches and gameplay mutate this; gameData itself
  // stays pristine (needed for restart and as the Quetzal diff baseline).
  const memory = gameData.slice()

  // Standard revision number (1.1) at 0x32-0x33.
  memory[0x32] = 0x01
  memory[0x33] = 0x01

  // Screen dimensions the game can query.
  memory[0x20] = 25 // height in lines
  memory[0x21] = 80 // width in chars

  // Interpreter capability flags — these bytes are zeroed in the .DAT file
  // and must be filled in by the interpreter before the game starts running.
  // Queried from the screen backend so we never advertise a feature (e.g.
  // bold, or timed input) the active screen can't actually deliver.
  const gameVersionByte = memory[0]!
  if (gameVersionByte >= 4) {
    let flags = 0
    if (screen.supportsBold) flags |= 0x04
    if (screen.supportsItalic) flags |= 0x08
    if (screen.supportsFixedWidth) flags |= 0x10
    if (screen.supportsTimedInput) flags |= 0x80
    memory[0x01] = memory[0x01]! | flags
    memory[0x1c] = 6 // interpreter number: IBM PC
    memory[0x1d] = 'F'.charCodeAt(0) // interpreter version letter
  } else if (gameVersionByte <= 3) {
    // Flags 1 (0x01): screen-splitting available (bit 5).
    memory[0x01] = memory[0x01]! | 0x20
  }

  const header = new Header(memory)
  const gameVersion = header.ZVERSION_version

  const abbrevs = new AbbreviationTable(header.FWORDS, memory)
  const dictionary = new DictionaryTable(header.VOCAB, memory, abbrevs, gameVersion)
  const objectTable = new ObjectTable(header.OBJECT, memory, abbrevs, gameVersion)

  const processor = new Processor({
    memory,
    start: header.START,
    objectTable,
    abbreviationTable: abbrevs,
    dictionary,
    filename,
    purbot: header.PURBOT,
    gameVersion,
    screen,
    pristineMemory: gameData,
  })

  processor.instructions.saveHandler = saveHandler

  if (seed !== undefined) {
    processor.instructions.random = seed & 0x7fffffff
  }

  return processor
}
