import { toZString, type AbbreviationLookup } from './ZStrings'
import { mreadWord } from './Utils'

export class AbbreviationTable implements AbbreviationLookup {
  readonly startLocation: number
  readonly memory: Uint8Array

  constructor(startLocation: number, memory: Uint8Array) {
    this.startLocation = startLocation
    this.memory = memory
  }

  toString(n: number): string {
    const location = this.startLocation + n * 2
    const address = mreadWord(this.memory, location) * 2
    return toZString(address, this.memory, this, null)
  }
}
