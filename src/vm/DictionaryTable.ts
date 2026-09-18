import { DictionaryTableEntry } from './DictionaryTableEntry'
import { mreadWord } from './Utils'
import type { AbbreviationLookup } from './ZStrings'

function compareKeys(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i]!
    const bv = b[i]!
    if (av < bv) return -1
    if (av > bv) return 1
  }
  return a.length - b.length
}

/** Lowest index i such that keyAt(i) >= target, for a sorted virtual sequence. */
function bisectLeft(length: number, keyAt: (i: number) => readonly number[], target: readonly number[]): number {
  let lo = 0
  let hi = length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (compareKeys(keyAt(mid), target) < 0) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class DictionaryTable {
  readonly headerStart: number
  readonly memory: Uint8Array
  readonly abbreviations: AbbreviationLookup
  readonly gameVersion: number
  readonly numSeparators: number
  readonly separators: Uint8Array
  readonly entryLength: number
  readonly wordCount: number
  readonly dictionaryStart: number
  readonly dictionaryEntryKeyWords: number

  constructor(startLocation: number, memory: Uint8Array, abbreviations: AbbreviationLookup, gameVersion = 3) {
    this.headerStart = startLocation
    this.memory = memory
    this.abbreviations = abbreviations
    this.gameVersion = gameVersion

    let loc = startLocation
    this.numSeparators = memory[loc]!
    loc += 1
    this.separators = memory.slice(loc, loc + this.numSeparators)
    loc += this.numSeparators
    this.entryLength = memory[loc]!
    loc += 1
    this.wordCount = mreadWord(memory, loc)
    loc += 2
    this.dictionaryStart = loc

    // V1-3: 2 key words (4 bytes), V4+: 3 key words (6 bytes)
    this.dictionaryEntryKeyWords = gameVersion <= 3 ? 2 : 3
  }

  getSeparators(): string[] {
    return Array.from(this.separators).map((b) => String.fromCharCode(b))
  }

  getWordCount(): number {
    return this.wordCount
  }

  private keyAt(index: number): number[] {
    let addr = this.dictionaryStart + index * this.entryLength
    const words: number[] = []
    for (let i = 0; i < this.dictionaryEntryKeyWords; i++) {
      words.push(mreadWord(this.memory, addr))
      addr += 2
    }
    return words
  }

  /** n is a 1-based dictionary entry number. */
  find(n: number): DictionaryTableEntry {
    return new DictionaryTableEntry(
      this.dictionaryStart + (n - 1) * this.entryLength,
      this.memory,
      this.entryLength,
      this.abbreviations,
    )
  }

  entryAt(address: number): DictionaryTableEntry {
    return new DictionaryTableEntry(address, this.memory, this.entryLength, this.abbreviations)
  }

  /** Binary-search the dictionary for an encoded word; returns its memory address, or null. */
  findPhrase(words: readonly number[]): number | null {
    const i = bisectLeft(this.wordCount, (idx) => this.keyAt(idx), words)
    if (i < this.wordCount && compareKeys(this.keyAt(i), words) === 0) {
      return this.dictionaryStart + i * this.entryLength
    }
    return null
  }
}
