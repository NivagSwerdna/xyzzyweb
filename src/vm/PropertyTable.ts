import { PropertyTableEntry } from './PropertyTableEntry'
import { toZString, type AbbreviationLookup } from './ZStrings'

export class PropertyTable {
  readonly memory: Uint8Array
  readonly startLocation: number
  readonly abbreviations: AbbreviationLookup
  readonly gameVersion: number

  constructor(memory: Uint8Array, startLocation: number, abbreviations: AbbreviationLookup, gameVersion = 3) {
    this.memory = memory
    this.startLocation = startLocation
    this.abbreviations = abbreviations
    this.gameVersion = gameVersion
  }

  /** Address of the first property entry (after the description string). */
  private skipDescription(): number {
    const paddr = this.startLocation
    const dlen = this.memory[paddr]!
    return paddr + 2 * dlen + 1
  }

  description(): string {
    const paddr = this.startLocation
    const dlen = this.memory[paddr]!
    if (dlen > 0) {
      return toZString(paddr + 1, this.memory, this.abbreviations, dlen)
    }
    return ''
  }

  findFirstProperty(): PropertyTableEntry | null {
    const paddr = this.skipDescription()
    const { n } = PropertyTableEntry.decodeNAndL(this.memory, paddr, this.gameVersion)
    if (n !== 0) return new PropertyTableEntry(paddr, this.memory, this.gameVersion)
    return null
  }

  findNextProperty(previous: PropertyTableEntry): PropertyTableEntry | null {
    let paddr = previous.getAddress()
    const first = PropertyTableEntry.decodeNAndL(this.memory, paddr, this.gameVersion)

    // Advance past this property's header and data
    paddr += first.headerSize + first.l

    const next = PropertyTableEntry.decodeNAndL(this.memory, paddr, this.gameVersion)
    if (next.n !== 0) return new PropertyTableEntry(paddr, this.memory, this.gameVersion)
    return null
  }

  getPropertyTableEntryForPropertyNumber(propertyNumber: number): PropertyTableEntry | null {
    let prop = this.findFirstProperty()
    while (prop !== null) {
      const n = prop.getPropertyNumber()
      if (n === propertyNumber) return prop
      if (n < propertyNumber) return null
      prop = this.findNextProperty(prop)
    }
    return null
  }

  getPropertyTableEntryAfterPropertyNumber(propertyNumber: number): PropertyTableEntry | null {
    let prop = this.findFirstProperty()
    if (propertyNumber === 0) return prop

    while (prop !== null) {
      const n = prop.getPropertyNumber()
      if (n === propertyNumber) return this.findNextProperty(prop)
      if (n < propertyNumber) return null
      prop = this.findNextProperty(prop)
    }
    return null
  }

  getPropertyTableEntryAddress(propertyNumber: number): number | null {
    const prop = this.getPropertyTableEntryForPropertyNumber(propertyNumber)
    return prop === null ? null : prop.getAddress()
  }

  getDescription(): string {
    return this.description()
  }
}
