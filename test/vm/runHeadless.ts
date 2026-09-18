import { HeadlessScreen, StopExecution } from '../../src/screen/HeadlessScreen'
import { QuitRequested, UndoPerformed } from '../../src/vm/errors'
import { buildMachine } from '../../src/vm/Machine'
import type { SaveHandler, TurnObserver } from '../../src/vm/Instructions'

export interface RunHeadlessResult {
  screen: HeadlessScreen
  steps: number
}

/** Port of RunHeadless.py's run(): feed a fixed command list, capture every screen event. */
export async function runHeadless(
  gameData: Uint8Array,
  commands: readonly string[],
  options: { seed?: number; maxSteps?: number; saveHandler?: SaveHandler; turnObserver?: TurnObserver } = {},
): Promise<RunHeadlessResult> {
  const { seed, maxSteps = 2_000_000, saveHandler, turnObserver } = options
  const screen = new HeadlessScreen(commands)
  const processor = buildMachine({ gameData, screen, filename: 'test.dat', seed, saveHandler })
  if (turnObserver) processor.instructions.turnObserver = turnObserver

  let steps = 0
  while (steps < maxSteps) {
    try {
      const maybe = processor.nextInstruction()
      if (maybe) await maybe
    } catch (e) {
      if (e instanceof StopExecution) break
      if (e instanceof QuitRequested) break
      if (e instanceof UndoPerformed) continue
      throw e
    }
    steps += 1
  }

  return { screen, steps }
}
