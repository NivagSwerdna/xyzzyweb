import { mreadWord } from './Utils'

export class Globals {
  readonly memory: Uint8Array
  readonly gameVersion: number
  readonly startLocation: number

  constructor(memory: Uint8Array, gameVersion: number, startLocation?: number) {
    this.memory = memory
    this.gameVersion = gameVersion
    this.startLocation = startLocation ?? mreadWord(memory, 0x0c)
  }

  readGlobal(globalNumber: number): number {
    const location = this.startLocation + globalNumber * 2
    return mreadWord(this.memory, location)
  }

  writeGlobal(globalNumber: number, value: number): void {
    const location = this.startLocation + globalNumber * 2
    this.memory[location] = (value >> 8) & 0xff
    this.memory[location + 1] = value & 0xff
  }
}
