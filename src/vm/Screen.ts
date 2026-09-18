/**
 * The contract every screen backend (DOM, headless-test) implements.
 * Ported from ScreenBase.py's abstract contract. readLine/readChar are the
 * only two real suspension points in the VM: they return a Promise so the
 * driver loop can await player input without blocking the whole interpreter.
 */
export interface Screen {
  // V4+ Flags1 capability advertisement (header $01, bits 2/3/4/7) — queried
  // by Machine.buildMachine() so it never advertises a feature this backend
  // can't actually deliver.
  readonly supportsBold: boolean
  readonly supportsItalic: boolean
  readonly supportsFixedWidth: boolean
  readonly supportsTimedInput: boolean

  printStr(s: string): void
  printChar(ch: string): void
  newLine(): void

  splitWindow(height: number): void
  setWindow(win: number): void
  setCursor(row: number, col: number): void
  getCursor(): [number, number]
  setTextStyle(style: number): void
  setColour(fg: number, bg: number): void
  eraseWindow(win: number): void
  eraseLine(): void
  updateStatusLine(location: string, rightText: string): void
  printLocationPrompt(locText: string): void

  /** Write straight to the transcript without rendering to screen. */
  transcriptWrite(s: string): void

  refresh(): void

  /**
   * timeRoutineCb, when the game supplied a timed-input routine, is invoked
   * roughly every timeTenths/10 seconds while waiting; a `true` return means
   * the routine wants to force-terminate the read.
   */
  readLine(maxChars: number, timeTenths?: number, timeRoutineCb?: () => Promise<boolean>): Promise<string>
  readChar(timeTenths?: number, timeRoutineCb?: () => Promise<boolean>): Promise<string>
}
