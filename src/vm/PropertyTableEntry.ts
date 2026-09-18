import { mreadByte, mreadWord, mwriteByte, mwriteWord } from './Utils'

export interface DecodedProperty {
  n: number
  l: number
  headerSize: number
}

export class PropertyTableEntry {
  readonly address: number
  readonly memory: Uint8Array
  readonly gameVersion: number

  constructor(address: number, memory: Uint8Array, gameVersion = 3) {
    this.address = address
    this.memory = memory
    this.gameVersion = gameVersion
  }

  /**
   * Returns (property_number, data_length, header_size_in_bytes).
   * header_size is 1 in V3, and either 1 or 2 in V4+.
   */
  static decodeNAndL(memory: Uint8Array, address: number, gameVersion = 3): DecodedProperty {
    const prop = memory[address]!

    if (gameVersion <= 3) {
      if (prop === 0) return { n: 0, l: 0, headerSize: 1 }
      const n = prop & 0x1f
      const l = (prop >> 5) + 1
      return { n, l, headerSize: 1 }
    } else {
      if (prop === 0) return { n: 0, l: 0, headerSize: 1 }
      const n = prop & 0x3f

      if (prop & 0x80) {
        const sizeByte = memory[address + 1]!
        let l = sizeByte & 0x3f
        if (l === 0) l = 64 // 0 means 64 per spec
        return { n, l, headerSize: 2 }
      } else {
        const l = prop & 0x40 ? 2 : 1
        return { n, l, headerSize: 1 }
      }
    }
  }

  getPropertyNumber(): number {
    return PropertyTableEntry.decodeNAndL(this.memory, this.address, this.gameVersion).n
  }

  getLength(): number {
    return PropertyTableEntry.decodeNAndL(this.memory, this.address, this.gameVersion).l
  }

  getHeaderSize(): number {
    return PropertyTableEntry.decodeNAndL(this.memory, this.address, this.gameVersion).headerSize
  }

  /** Address of the actual property data (after the header byte(s)). */
  getDataAddress(): number {
    return this.address + this.getHeaderSize()
  }

  putValue(value: number): void {
    const { l, headerSize } = PropertyTableEntry.decodeNAndL(this.memory, this.address, this.gameVersion)
    const valueAddress = this.address + headerSize
    if (l === 1) mwriteByte(this.memory, valueAddress, value)
    else if (l === 2) mwriteWord(this.memory, valueAddress, value)
    else throw new Error(`putValue called on property with length ${l} > 2 at ${this.address.toString(16)}`)
  }

  getValue(): number {
    const { l, headerSize } = PropertyTableEntry.decodeNAndL(this.memory, this.address, this.gameVersion)
    const valueAddress = this.address + headerSize
    if (l === 1) return mreadByte(this.memory, valueAddress)
    if (l === 2) return mreadWord(this.memory, valueAddress)
    throw new Error(`getValue called on property with length ${l} > 2 at ${this.address.toString(16)}`)
  }

  getAddress(): number {
    return this.address
  }
}
