import { DomScreen } from '../screen/DomScreen'
import { IndexedDbSaveHandler } from '../storage/SaveStore'
import { QuitRequested, RestartRequested, UndoPerformed } from '../vm/errors'
import { Header } from '../vm/Header'
import { buildMachine } from '../vm/Machine'
import type { Processor } from '../vm/Processor'
import { mountGameControls } from './GameControls'
import { mountSaveControls } from './SavePanel'
import { mountTranscriptControls } from './TranscriptPanel'

/** Thrown by the "Quit to Menu" button to unwind the run loop cleanly. */
class ReturnToMenu extends Error {}

interface GameEntry {
  id: string
  title: string
  file: string
}

const GAMES: GameEntry[] = [
  { id: 'zork1', title: 'Zork I: The Great Underground Empire', file: 'ZORK1.DAT' },
  { id: 'zork2', title: 'Zork II: The Wizard of Frobozz', file: 'ZORK2.DAT' },
  { id: 'zork3', title: 'Zork III: The Dungeon Master', file: 'ZORK3.DAT' },
  { id: 'deadline', title: 'Deadline', file: 'DEADLINE.DAT' },
  { id: 'trinity', title: 'Trinity', file: 'TRINITY.DAT' },
]

export function startApp(root: HTMLElement): void {
  showPicker(root)
}

function showPicker(root: HTMLElement): void {
  root.innerHTML = ''

  const wrap = document.createElement('div')
  wrap.className = 'picker'

  const heading = document.createElement('h1')
  heading.textContent = 'xyzzy'
  const subheading = document.createElement('p')
  subheading.textContent = 'Pick a game to play.'
  wrap.append(heading, subheading)

  const list = document.createElement('ul')
  list.className = 'picker-list'
  for (const game of GAMES) {
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'

    const title = document.createElement('span')
    title.textContent = game.title
    const subtitle = document.createElement('span')
    subtitle.className = 'subtitle'
    subtitle.textContent = game.file

    button.append(title, subtitle)
    button.addEventListener('click', () => {
      void launchGame(root, game)
    })
    li.appendChild(button)
    list.appendChild(li)
  }
  wrap.appendChild(list)
  root.appendChild(wrap)
}

function gameIdFor(gameData: Uint8Array): string {
  const header = new Header(gameData)
  return `${header.ZORKID}-${header.serialString}`
}

async function launchGame(root: HTMLElement, game: GameEntry): Promise<void> {
  root.innerHTML = ''

  const layout = document.createElement('div')
  layout.className = 'game-layout'
  const screenRoot = document.createElement('div')
  screenRoot.className = 'game-main'
  const sidebar = document.createElement('div')
  sidebar.className = 'game-sidebar'
  layout.append(screenRoot, sidebar)
  root.appendChild(layout)

  const screen = new DomScreen(screenRoot)
  screen.printStr(`Loading ${game.title}...\n`)

  mountGameControls(sidebar, () => screen.abort(new ReturnToMenu()))

  const response = await fetch(`data/${game.file}`)
  if (!response.ok) {
    screen.printStr(`\n[Could not load ${game.file}: HTTP ${response.status}]\n`)
    return
  }
  const gameData = new Uint8Array(await response.arrayBuffer())
  const saveHandler = new IndexedDbSaveHandler(gameIdFor(gameData))
  mountSaveControls(sidebar, screen, saveHandler)
  mountTranscriptControls(sidebar, screen, game.title)

  screen.eraseWindow(0)

  const build = (): Processor => buildMachine({ gameData, screen, filename: game.file, saveHandler })

  const returnedToMenu = await runLoop(build(), build, screen)
  if (returnedToMenu) showPicker(root)
}

/** Returns true if the loop ended because the player chose "Quit to Menu". */
async function runLoop(initialProcessor: Processor, rebuild: () => Processor, screen: DomScreen): Promise<boolean> {
  let processor = initialProcessor

  while (true) {
    try {
      const maybe = processor.nextInstruction()
      if (maybe) await maybe
    } catch (e) {
      if (e instanceof UndoPerformed) continue
      if (e instanceof RestartRequested) {
        const undoRandomContinue = processor.instructions.undoRandomContinue
        screen.eraseWindow(-1)
        processor = rebuild()
        processor.instructions.undoRandomContinue = undoRandomContinue
        continue
      }
      if (e instanceof QuitRequested) {
        screen.printStr('\n[The game has ended. Choose "Quit to Menu" to play again.]\n')
        return false
      }
      if (e instanceof ReturnToMenu) {
        return true
      }
      console.error(e)
      screen.printStr(`\n[Interpreter error: ${e instanceof Error ? e.message : String(e)}]\n`)
      return false
    }
  }
}
