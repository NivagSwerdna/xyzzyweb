import { toZString, type AbbreviationLookup } from './ZStrings'

export class DictionaryTableEntry {
  readonly startLocation: number
  readonly memory: Uint8Array
  readonly entryLength: number
  readonly abbreviations: AbbreviationLookup

  constructor(startLocation: number, memory: Uint8Array, entryLength: number, abbreviations: AbbreviationLookup) {
    this.startLocation = startLocation
    this.memory = memory
    this.entryLength = entryLength
    this.abbreviations = abbreviations
  }

  getStartAddress(): number {
    return this.startLocation
  }

  /** The dictionary word text this entry encodes (first two key-words of Z-text). */
  text(): string {
    return toZString(this.startLocation, this.memory, this.abbreviations, 2)
  }
}
