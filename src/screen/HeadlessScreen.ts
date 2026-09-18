import type { Screen } from '../vm/Screen'

/** Raised when the scripted command queue is exhausted and the game asks for input. */
export class StopExecution extends Error {}

export interface ScreenEvent {
  type: string
  [key: string]: unknown
}

/**
 * Records every screen call as a ScreenEvent instead of rendering anything;
 * feeds a fixed list of strings as player input. Used by the Vitest suite to
 * drive full playthroughs and assert on transcript/window/status-line output
 * without a DOM. Ported from HeadlessScreen.py + RunHeadless.py's ListScripting.
 */
export class HeadlessScreen implements Screen {
  // Report full V4+ capability so games run the same code paths a fully
  // capable interpreter would exercise.
  readonly supportsBold = true
  readonly supportsItalic = true
  readonly supportsFixedWidth = true
  readonly supportsTimedInput = true

  readonly events: ScreenEvent[] = []

  private currentWin = 0
  private upperRows = 0
  private currentStyle = 0
  private upperCurRow = 1
  private upperCurCol = 1

  private readonly commands: readonly string[]
  private pos = 0
  /**
   * Becomes true the moment a readLine call finds the command queue empty —
   * matching HeadlessScreen.py/Instructions.py's behavior, where readChar
   * NEVER consumes from the scripted queue (it just auto-dismisses with '\r'
   * while any scripted input remains) and only readLine discovers exhaustion.
   */
  private exhausted = false

  constructor(commands: readonly string[] = []) {
    this.commands = commands
  }

  private evt(type: string, kwargs: Record<string, unknown> = {}): ScreenEvent {
    const e: ScreenEvent = { type, ...kwargs }
    this.events.push(e)
    return e
  }

  printStr(s: string): void {
    const win = this.currentWin === 1 && this.upperRows > 0 ? 1 : 0
    this.evt('print', { win, text: s, style: this.currentStyle })
  }

  printChar(ch: string): void {
    this.printStr(ch)
  }

  newLine(): void {
    this.printStr('\n')
  }

  splitWindow(height: number): void {
    const oldRows = this.upperRows
    this.upperRows = height
    if (oldRows > 1 && height <= 1) {
      // Deferred in the GUI (collapses on Enter); record the intent separately
      // so tests can see the popup lifecycle clearly.
      this.evt('split_window_deferred', { height })
    } else {
      this.evt('split_window', { height })
    }
  }

  setWindow(win: number): void {
    this.currentWin = win
    this.evt('set_window', { win })
  }

  setCursor(row: number, col: number): void {
    this.upperCurRow = row
    this.upperCurCol = col
    this.evt('set_cursor', { row, col })
  }

  getCursor(): [number, number] {
    if (this.currentWin === 1) return [this.upperCurRow, this.upperCurCol]
    return [1, 1]
  }

  setTextStyle(style: number): void {
    this.currentStyle = style
    this.evt('set_text_style', { style })
  }

  setColour(_fg: number, _bg: number): void {
    // Not exercised by any headless assertion today.
  }

  eraseWindow(win: number): void {
    this.evt('erase_window', { win })
    if (win === -1) {
      this.upperRows = 0
      this.currentWin = 0
    }
  }

  eraseLine(): void {
    this.evt('erase_line')
  }

  updateStatusLine(location: string, rightText: string): void {
    this.evt('status', { location, rightText })
  }

  printLocationPrompt(locText: string): void {
    this.evt('location_prompt', { text: locText })
  }

  transcriptWrite(_s: string): void {
    // No transcript file in headless tests.
  }

  refresh(): void {
    // Nothing to flush headlessly.
  }

  async readLine(_maxChars: number, _timeTenths = 0, _timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    if (!this.exhausted) {
      if (this.pos < this.commands.length) {
        return this.commands[this.pos++]!
      }
      this.exhausted = true
    }
    throw new StopExecution('scripted commands exhausted at readLine')
  }

  async readChar(_timeTenths = 0, _timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    if (!this.exhausted) return '\r' // auto-dismiss keypress pauses during replay
    throw new StopExecution('scripted commands exhausted at readChar')
  }

  // ------------------------------------------------------------------ //
  // Analysis helpers                                                     //
  // ------------------------------------------------------------------ //

  /** All text written to the lower window (window 0), concatenated. */
  lowerText(): string {
    return this.events
      .filter((e) => e.type === 'print' && e['win'] === 0)
      .map((e) => e['text'] as string)
      .join('')
  }

  /** All text written to the upper window (window 1), concatenated. */
  upperText(): string {
    return this.events
      .filter((e) => e.type === 'print' && e['win'] === 1)
      .map((e) => e['text'] as string)
      .join('')
  }

  /**
   * Events from the last *significant* split_window (height > 1) through its
   * close. A popup is considered closed by either an explicit erase_window(-1),
   * or the game reducing the upper window back to status-bar height (<=1).
   */
  popupEvents(): ScreenEvent[] {
    let lastSig: number | null = null
    this.events.forEach((e, i) => {
      if (e.type === 'split_window' && (e['height'] as number) > 1) lastSig = i
    })
    if (lastSig === null) return []

    for (let i = lastSig + 1; i < this.events.length; i++) {
      const e = this.events[i]!
      const closed =
        (e.type === 'erase_window' && e['win'] === -1) ||
        (e.type === 'split_window' && (e['height'] as number) <= 1) ||
        e.type === 'split_window_deferred'
      if (closed) return this.events.slice(lastSig, i + 1)
    }
    return this.events.slice(lastSig) // popup opened but not yet closed
  }
}
