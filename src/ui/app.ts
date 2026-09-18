import { DomScreen } from '../screen/DomScreen'
import { IndexedDbSaveHandler } from '../storage/SaveStore'
import { QuitRequested, RestartRequested, UndoPerformed } from '../vm/errors'
import { Header } from '../vm/Header'
import type { TurnObserver } from '../vm/Instructions'
import { buildMachine } from '../vm/Machine'
import type { Processor } from '../vm/Processor'
import { isMapFeatureEnabled } from './featureFlags'
import { clearStoredCode, currentAccess, tryUnlock } from './gameAccess'
import { GAMES, xorFF, type GameEntry } from './games'
import { mountGameControls } from './GameControls'
import { MapTracker } from './MapTracker'
import { mountMapControls } from './MapView'
import { mountSaveControls } from './SavePanel'
import { mountTranscriptControls } from './TranscriptPanel'

/** Thrown by the "Quit to Menu" button to unwind the run loop cleanly. */
class ReturnToMenu extends Error {}

export function startApp(root: HTMLElement): void {
  showPicker(root)
}

function showPicker(root: HTMLElement): void {
  root.innerHTML = ''

  const wrap = document.createElement('div')
  wrap.className = 'picker'

  const heading = document.createElement('h1')
  heading.textContent = 'xyzzy'
  wrap.appendChild(heading)

  const { gameIds } = currentAccess()
  const unlockedGames = GAMES.filter((g) => gameIds.includes(g.id))

  if (unlockedGames.length === 0) {
    const tagline = document.createElement('p')
    tagline.textContent = 'Your path to interactive fiction.'
    wrap.appendChild(tagline)
    wrap.appendChild(buildAccessForm(root))
    root.appendChild(wrap)
    return
  }

  const subheading = document.createElement('p')
  subheading.textContent = 'Pick a game to play.'
  wrap.appendChild(subheading)

  const list = document.createElement('ul')
  list.className = 'picker-list'
  for (const game of unlockedGames) {
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'

    const title = document.createElement('span')
    title.textContent = game.title

    button.append(title)
    button.addEventListener('click', () => {
      void launchGame(root, game)
    })
    li.appendChild(button)
    list.appendChild(li)
  }
  wrap.appendChild(list)

  const changeCode = document.createElement('button')
  changeCode.type = 'button'
  changeCode.className = 'picker-change-code'
  changeCode.textContent = 'Not you? Change access code'
  changeCode.addEventListener('click', () => {
    clearStoredCode()
    showPicker(root)
  })
  wrap.appendChild(changeCode)

  root.appendChild(wrap)
}

function buildAccessForm(root: HTMLElement): HTMLFormElement {
  const form = document.createElement('form')
  form.className = 'access-form'

  const label = document.createElement('label')
  label.textContent = 'Enter the access code your teacher gave you:'
  label.htmlFor = 'access-code-input'

  const input = document.createElement('input')
  input.id = 'access-code-input'
  input.type = 'password'
  input.autocomplete = 'off'

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.textContent = 'Unlock'

  const error = document.createElement('p')
  error.className = 'access-form-error'
  error.textContent = "That code wasn't recognized."
  error.hidden = true

  form.append(label, input, submit, error)

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const unlocked = tryUnlock(input.value)
    if (unlocked.length > 0) {
      showPicker(root)
    } else {
      error.hidden = false
    }
  })

  return form
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
    screen.printStr(`\n[Could not load ${game.title}: HTTP ${response.status}]\n`)
    return
  }
  // Story files are served XOR-obfuscated (see src/ui/games.ts) so a plain
  // download doesn't hand out a working copy; decode before use, unless this
  // particular entry opts out (e.g. a genuinely freeware or local test file).
  const rawData = new Uint8Array(await response.arrayBuffer())
  const gameData = game.obfuscated ? xorFF(rawData) : rawData
  const gameId = gameIdFor(gameData)
  const saveHandler = new IndexedDbSaveHandler(gameId)
  mountSaveControls(sidebar, screen, saveHandler)
  mountTranscriptControls(sidebar, screen, game.title)

  // The map is an optional feature (?lazymapper=1) — off by default, since
  // an auto-drawn map can be an unwanted shortcut for students who are
  // meant to be mapping the game themselves.
  let turnObserver: TurnObserver | undefined
  if (isMapFeatureEnabled()) {
    const mapTracker = new MapTracker(gameId)
    mountMapControls(sidebar, mapTracker, game.title)
    turnObserver = mapTracker
  }

  screen.eraseWindow(0)

  const build = (): Processor => {
    const processor = buildMachine({ gameData, screen, filename: game.file, saveHandler })
    processor.instructions.turnObserver = turnObserver
    return processor
  }

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
