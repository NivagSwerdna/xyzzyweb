import type { Screen } from '../vm/Screen'

const UPPER_WINDOW_COLS = 80

interface PendingRead {
  resolve: (value: string) => void
  isChar: boolean
  timerId: ReturnType<typeof setInterval> | null
  settled: boolean
}

/**
 * Renders the interpreter into a status bar (V1-3) / upper-window character
 * grid (V4+) / scrollable transcript pane / bottom command-input line,
 * classic-IF style. Implements the async Screen contract: readLine/readChar
 * return a Promise that resolves from a real DOM keyboard event.
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
  private readonly inputEl: HTMLInputElement

  private currentWin = 0
  private upperRows = 0
  private upperGrid: string[][] = []
  private upperCursorRow = 1
  private upperCursorCol = 1

  private currentStyle = 0
  private pendingSpan: HTMLElement | null = null
  private pendingSpanStyle = -1

  private pending: PendingRead | null = null
  private readingBuffer = ''

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

    const inputRow = document.createElement('div')
    inputRow.className = 'input-row'
    const prompt = document.createElement('span')
    prompt.className = 'input-prompt'
    prompt.textContent = '>'
    this.inputEl = document.createElement('input')
    this.inputEl.className = 'command-input'
    this.inputEl.type = 'text'
    this.inputEl.autocomplete = 'off'
    this.inputEl.spellcheck = false
    this.inputEl.disabled = true
    inputRow.append(prompt, this.inputEl)

    root.append(this.statusBarEl, this.upperWindowEl, this.transcriptEl, inputRow)

    this.inputEl.addEventListener('keydown', (e) => this.handleKeydown(e))
    root.addEventListener('click', () => this.inputEl.focus())
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
    // Downloadable transcripts are a future enhancement; no-op for now.
  }

  refresh(): void {
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight
  }

  // ------------------------------------------------------------------ //
  // Input                                                                //
  // ------------------------------------------------------------------ //

  async readLine(_maxChars: number, timeTenths = 0, timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    this.refresh()
    return this.beginRead(false, timeTenths, timeRoutineCb)
  }

  async readChar(timeTenths = 0, timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    this.refresh()
    return this.beginRead(true, timeTenths, timeRoutineCb)
  }

  private beginRead(isChar: boolean, timeTenths: number, timeRoutineCb?: () => Promise<boolean>): Promise<string> {
    this.readingBuffer = ''
    this.inputEl.value = ''
    this.inputEl.disabled = false
    this.inputEl.focus()

    return new Promise<string>((resolve) => {
      const pending: PendingRead = { resolve, isChar, timerId: null, settled: false }
      this.pending = pending

      if (timeTenths > 0 && timeRoutineCb) {
        pending.timerId = setInterval(() => {
          void (async () => {
            const stop = await timeRoutineCb()
            if (stop) this.settleRead(pending, this.readingBuffer)
          })()
        }, timeTenths * 100)
      }
    })
  }

  private settleRead(pending: PendingRead, value: string): void {
    if (pending.settled) return
    pending.settled = true
    if (pending.timerId !== null) clearInterval(pending.timerId)
    if (this.pending === pending) {
      this.pending = null
      this.inputEl.disabled = true
      this.inputEl.value = ''
    }
    pending.resolve(value)
  }

  private handleKeydown(e: KeyboardEvent): void {
    const pending = this.pending
    if (!pending) return

    if (pending.isChar) {
      e.preventDefault()
      const ch = e.key === 'Enter' ? '\r' : e.key.length === 1 ? e.key : ''
      this.settleRead(pending, ch)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const value = this.inputEl.value
      this.appendTranscriptSegment(`> ${value}\n`)
      this.settleRead(pending, value)
    }
  }
}
