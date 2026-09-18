import type { Screen } from '../vm/Screen'

const UPPER_WINDOW_COLS = 80

interface PendingRead {
  resolve: (value: string) => void
  reject: (err: unknown) => void
  isChar: boolean
  timerId: ReturnType<typeof setInterval> | null
  settled: boolean
}

/**
 * Renders the interpreter into a status bar (V1-3) / upper-window character
 * grid (V4+) / scrollable transcript pane, classic-IF style. The command
 * "cursor" is a real `<input>` positioned inline in the transcript flow
 * (right after the "> " prompt, or invisibly inline for a bare read_char),
 * not a separate box below — once submitted it freezes into plain text and
 * a fresh input appears for the next turn, like a real terminal.
 * Implements the async Screen contract: readLine/readChar return a Promise
 * that resolves from a real DOM keyboard event.
 */
export class DomScreen implements Screen {
  readonly supportsBold = true
  readonly supportsItalic = true
  readonly supportsFixedWidth = true
  readonly supportsTimedInput = true

  private readonly statusBarEl: HTMLElement
  private readonly statusLocationEl: HTMLElement
  private readonly statusRightEl: HTMLElement
  private readonly upperWindowEl: HTMLElement
  private readonly transcriptEl: HTMLElement

  private currentWin = 0
  private upperRows = 0
  private upperGrid: string[][] = []
  private upperCursorRow = 1
  private upperCursorCol = 1

  private currentStyle = 0
  private pendingSpan: HTMLElement | null = null
  private pendingSpanStyle = -1

  private pending: PendingRead | null = null
  private activeInputEl: HTMLInputElement | null = null
  /** Lines queued programmatically (e.g. by Quicksave/Quickload buttons) ahead of real keyboard input. */
  private commandQueue: string[] = []

  private transcriptLog = ''
  private readonly transcriptListeners = new Set<() => void>()

  constructor(root: HTMLElement) {
    root.innerHTML = ''
    root.classList.add('xyzzy-screen')

    this.statusBarEl = document.createElement('div')
    this.statusBarEl.className = 'status-bar'
    this.statusLocationEl = document.createElement('span')
    this.statusLocationEl.className = 'status-location'
    this.statusRightEl = document.createElement('span')
    this.statusRightEl.className = 'status-right'
    this.statusBarEl.append(this.statusLocationEl, this.statusRightEl)
    this.statusBarEl.hidden = true

    this.upperWindowEl = document.createElement('pre')
    this.upperWindowEl.className = 'upper-window'
    this.upperWindowEl.hidden = true

    this.transcriptEl = document.createElement('div')
    this.transcriptEl.className = 'transcript'

    // A dedicated wrapper (not `root` itself) so externally-mounted controls
    // — e.g. the save toolbar/panel prepended into `root` by SavePanel.ts —
    // aren't covered by the "click anywhere here refocuses the command
    // input" behavior below and can receive their own clicks/focus normally.
    const screenBody = document.createElement('div')
    screenBody.className = 'xyzzy-screen-body'
    screenBody.append(this.statusBarEl, this.upperWindowEl, this.transcriptEl)
    root.appendChild(screenBody)

    screenBody.addEventListener('click', () => this.activeInputEl?.focus())
  }

  // ------------------------------------------------------------------ //
  // Output                                                               //
  // ------------------------------------------------------------------ //

  printStr(s: string): void {
    if (this.currentWin === 1 && this.upperRows > 0) {
      this.writeUpperWindow(s)
      return
    }
    // The transcript pane is `white-space: pre-wrap`, so embedded '\n'
    // characters render as line breaks without any special-casing here.
    this.appendTranscriptSegment(s)
  }

  private appendTranscriptSegment(text: string): void {
    if (this.currentStyle !== this.pendingSpanStyle || !this.pendingSpan) {
      this.pendingSpan = document.createElement('span')
      this.pendingSpan.className = this.styleClass(this.currentStyle)
      this.pendingSpanStyle = this.currentStyle
      this.transcriptEl.appendChild(this.pendingSpan)
    }
    this.pendingSpan.appendChild(document.createTextNode(text))
    this.transcriptLog += text
    this.notifyTranscript()
  }

  private styleClass(style: number): string {
    const classes: string[] = []
    if (style & 0x1) classes.push('style-reverse')
    if (style & 0x2) classes.push('style-bold')
    if (style & 0x4) classes.push('style-italic')
    return classes.join(' ')
  }

  printChar(ch: string): void {
    this.printStr(ch)
  }

  newLine(): void {
    this.printStr('\n')
  }

  // ------------------------------------------------------------------ //
  // Upper window (V4+ split window)                                     //
  // ------------------------------------------------------------------ //

  splitWindow(height: number): void {
    this.upperRows = height
    if (height > 0) {
      this.upperGrid = Array.from({ length: height }, () => new Array(UPPER_WINDOW_COLS).fill(' '))
      this.upperWindowEl.hidden = false
      this.upperWindowEl.style.setProperty('--rows', String(height))
    } else {
      this.upperWindowEl.hidden = true
    }
    this.renderUpperWindow()
  }

  setWindow(win: number): void {
    this.currentWin = win
    if (win === 1) {
      this.upperCursorRow = 1
      this.upperCursorCol = 1
    }
  }

  setCursor(row: number, col: number): void {
    this.upperCursorRow = row
    this.upperCursorCol = col
  }

  getCursor(): [number, number] {
    if (this.currentWin === 1) return [this.upperCursorRow, this.upperCursorCol]
    return [1, 1]
  }

  private writeUpperWindow(s: string): void {
    for (const ch of s) {
      if (ch === '\n') {
        this.upperCursorRow += 1
        this.upperCursorCol = 1
        continue
      }
      const row = this.upperGrid[this.upperCursorRow - 1]
      if (row && this.upperCursorCol - 1 < UPPER_WINDOW_COLS) {
        row[this.upperCursorCol - 1] = ch
      }
      this.upperCursorCol += 1
      if (this.upperCursorCol > UPPER_WINDOW_COLS) {
        this.upperCursorCol = 1
        this.upperCursorRow += 1
      }
    }
    this.renderUpperWindow()
  }

  private renderUpperWindow(): void {
    this.upperWindowEl.textContent = this.upperGrid.map((row) => row.join('').replace(/\s+$/, '')).join('\n')
  }

  eraseWindow(win: number): void {
    if (win === -1) {
      this.transcriptEl.innerHTML = ''
      this.pendingSpan = null
      this.upperGrid = []
      this.upperRows = 0
      this.upperWindowEl.hidden = true
      this.currentWin = 0
    } else if (win === 0) {
      this.transcriptEl.innerHTML = ''
      this.pendingSpan = null
    } else if (win === 1) {
      this.upperGrid = this.upperGrid.map(() => new Array(UPPER_WINDOW_COLS).fill(' '))
      this.renderUpperWindow()
    }
  }

  eraseLine(): void {
    if (this.currentWin === 1) {
      const row = this.upperGrid[this.upperCursorRow - 1]
      if (row) row.fill(' ', this.upperCursorCol - 1)
      this.renderUpperWindow()
    }
  }

  setTextStyle(style: number): void {
    this.currentStyle = style
  }

  setColour(_fg: number, _bg: number): void {
    // Classroom deployment keeps a fixed light theme; colour opcodes are no-ops.
  }

  updateStatusLine(location: string, rightText: string): void {
    this.statusBarEl.hidden = false
    this.statusLocationEl.textContent = location
    this.statusRightEl.textContent = rightText
  }

  printLocationPrompt(locText: string): void {
    this.printStr(`\n${locText}\n> `)
  }

  transcriptWrite(_s: string): void {
    // Actual transcript capture happens in appendTranscriptSegment/freezeActiveInput
    // (below), which sees every character reaching the lower window already.
  }

  refresh(): void {
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight
  }

  // ------------------------------------------------------------------ //
  // Transcript export (Download/View Transcript in the sidebar)         //
  // ------------------------------------------------------------------ //

  getTranscript(): string {
    return this.transcriptLog
  }

  /** Subscribe to transcript growth; returns an unsubscribe function. */
  onTranscriptChange(cb: () => void): () => void {
    this.transcriptListeners.add(cb)
    return () => this.transcriptListeners.delete(cb)
  }

  private notifyTranscript(): void {
    for (const l of this.transcriptListeners) l()
  }

  // ------------------------------------------------------------------ //
  // Input                                                                //
  // ------------------------------------------------------------------ //

  async readLine(_maxChars: number, timeTenths = 0, timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    return this.beginRead(false, timeTenths, timeRoutineCb)
  }

  async readChar(timeTenths = 0, timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    return this.beginRead(true, timeTenths, timeRoutineCb)
  }

  /**
   * Feed a line into the interpreter as if the player had typed it and
   * pressed Enter — used by UI controls (Quicksave/Quickload, the save
   * panel) to drive the real SAVE/RESTORE opcodes without the player typing
   * filenames. If a read is currently waiting on real input, resolves it
   * immediately (freezing the live input with the injected text, exactly as
   * if the player had typed it); otherwise the line is consumed by the next
   * read call.
   */
  queueCommand(text: string): void {
    this.commandQueue.push(text)
    const pending = this.pending
    if (pending && !pending.settled) {
      this.commandQueue.shift()
      this.settlePending(pending, text, !pending.isChar)
    }
  }

  /** Abruptly end whatever read is pending, e.g. for "Quit to Menu". */
  abort(error: Error): void {
    const pending = this.pending
    if (pending && !pending.settled) {
      pending.settled = true
      if (pending.timerId !== null) clearInterval(pending.timerId)
      this.pending = null
      if (this.activeInputEl) this.activeInputEl.disabled = true
      pending.reject(error)
    }
  }

  private beginRead(isChar: boolean, timeTenths: number, timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    if (this.commandQueue.length > 0) {
      const value = this.commandQueue.shift()!
      if (!isChar) this.appendFrozenLine(value)
      this.refresh()
      return Promise.resolve(value)
    }

    const input = this.appendLiveInput(isChar)
    this.activeInputEl = input
    input.focus()
    this.refresh()

    return new Promise<string>((resolve, reject) => {
      const pending: PendingRead = { resolve, reject, isChar, timerId: null, settled: false }
      this.pending = pending

      input.addEventListener('keydown', (e) => {
        if (pending.settled) return
        if (isChar) {
          e.preventDefault()
          const ch = e.key === 'Enter' ? '\r' : e.key.length === 1 ? e.key : ''
          this.settlePending(pending, ch, false)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          this.settlePending(pending, input.value, true)
        }
      })

      if (timeTenths > 0 && timeRoutineCb) {
        pending.timerId = setInterval(() => {
          void (async () => {
            const stop = await timeRoutineCb()
            if (stop) this.settlePending(pending, input.value, !isChar)
          })()
        }, timeTenths * 100)
      }
    })
  }

  private settlePending(pending: PendingRead, value: string, echo: boolean): void {
    if (pending.settled) return
    pending.settled = true
    if (pending.timerId !== null) clearInterval(pending.timerId)
    if (this.pending === pending) this.pending = null
    this.freezeActiveInput(echo ? value : null)
    pending.resolve(value)
  }

  /**
   * Append an already-submitted line of text (used for queued/programmatic
   * input). No prompt character is added here — Infocom games print their
   * own "> " before reading, so the injected text just continues right
   * after whatever the game already printed.
   */
  private appendFrozenLine(value: string): void {
    const span = document.createElement('span')
    span.className = 'submitted-text'
    span.textContent = value + '\n'
    this.transcriptEl.appendChild(span)
    this.pendingSpan = null

    this.transcriptLog += `${value}\n`
    this.notifyTranscript()
  }

  /**
   * Append a live, focused `<input>` positioned inline right after the last
   * printed text — e.g. immediately after the game's own "> " prompt for a
   * full command, or right where a read_char wait should show its cursor.
   * No prompt character is synthesized here for the same reason as above.
   */
  private appendLiveInput(isChar: boolean): HTMLInputElement {
    const input = document.createElement('input')
    input.autocomplete = 'off'
    input.spellcheck = false
    input.type = 'text'
    input.className = isChar ? 'char-input' : 'command-input'
    this.transcriptEl.appendChild(input)
    this.pendingSpan = null
    return input
  }

  /** Freeze the currently-live input into plain scrollback text (or remove it if not echoed). */
  private freezeActiveInput(value: string | null): void {
    const input = this.activeInputEl
    if (!input) return
    this.activeInputEl = null

    if (value === null || input.className === 'char-input') {
      input.remove()
      return
    }

    const span = document.createElement('span')
    span.className = 'submitted-text'
    span.textContent = value + '\n'
    input.replaceWith(span)

    this.transcriptLog += `${value}\n`
    this.notifyTranscript()
  }
}
