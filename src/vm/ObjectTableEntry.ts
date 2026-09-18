import { PropertyTable } from './PropertyTable'
import { mreadByte, mreadWord, mwriteByte, mwriteWord } from './Utils'
import type { AbbreviationLookup } from './ZStrings'
import type { ObjectTable } from './ObjectTable'

export class ObjectTableEntry {
  readonly startLocation: number
  readonly memory: Uint8Array
  readonly entrySize: number
  readonly abbreviations: AbbreviationLookup
  readonly n: number
  readonly objectTable: ObjectTable
  readonly gameVersion: number

  private readonly parentOffset: number
  private readonly siblingOffset: number
  private readonly childOffset: number
  private readonly propOffset: number
  private readonly wordLinks: boolean

  constructor(
    startLocation: number,
    memory: Uint8Array,
    entrySize: number,
    abbreviations: AbbreviationLookup,
    n: number,
    objectTable: ObjectTable,
    gameVersion = 3,
  ) {
    this.startLocation = startLocation
    this.memory = memory
    this.entrySize = entrySize
    this.abbreviations = abbreviations
    this.n = n
    this.objectTable = objectTable
    this.gameVersion = gameVersion

    if (gameVersion <= 3) {
      this.parentOffset = 4
      this.siblingOffset = 5
      this.childOffset = 6
      this.propOffset = 7
      this.wordLinks = false
    } else {
      this.parentOffset = 6
      this.siblingOffset = 8
      this.childOffset = 10
      this.propOffset = 12
      this.wordLinks = true
    }
  }

  private readLink(offset: number): number {
    if (this.wordLinks) return mreadWord(this.memory, this.startLocation + offset)
    return mreadByte(this.memory, this.startLocation + offset)
  }

  private writeLink(offset: number, value: number): void {
    if (this.wordLinks) mwriteWord(this.memory, this.startLocation + offset, value)
    else mwriteByte(this.memory, this.startLocation + offset, value)
  }

  getParentObjectNumber(): number {
    return this.readLink(this.parentOffset)
  }

  setParentObjectNumber(value: number): void {
    this.writeLink(this.parentOffset, value)
  }

  getNextSiblingObjectNumber(): number {
    return this.readLink(this.siblingOffset)
  }

  setNextSiblingObjectNumber(value: number): void {
    this.writeLink(this.siblingOffset, value)
  }

  getChildObjectNumber(): number {
    return this.readLink(this.childOffset)
  }

  setChildObjectNumber(value: number): void {
    this.writeLink(this.childOffset, value)
  }

  getPriorSiblingObjectNumber(): number {
    const parentObjectNumber = this.getParentObjectNumber()
    if (parentObjectNumber === 0) return 0
    const parent = this.objectTable.getObjectTableEntry(parentObjectNumber)!
    let priorSiblingObjectNumber = 0
    let siblingObjectNumber = parent.getChildObjectNumber()
    while (siblingObjectNumber !== this.n) {
      priorSiblingObjectNumber = siblingObjectNumber
      const sibling = this.objectTable.getObjectTableEntry(siblingObjectNumber)!
      siblingObjectNumber = sibling.getNextSiblingObjectNumber()
    }
    return priorSiblingObjectNumber
  }

  propertiesAddress(): number {
    return mreadWord(this.memory, this.startLocation + this.propOffset)
  }

  getPropertyTable(): PropertyTable {
    return new PropertyTable(this.memory, this.propertiesAddress(), this.abbreviations, this.gameVersion)
  }

  testAttr(attributeNumber: number): number {
    const attrAddress = this.startLocation + (attributeNumber >> 3)
    const attrs = this.memory[attrAddress]!
    return attrs & (0b10000000 >> (attributeNumber & 0b111))
  }

  setAttr(attributeNumber: number): void {
    const attrAddress = this.startLocation + (attributeNumber >> 3)
    const attrs = this.memory[attrAddress]!
    this.memory[attrAddress] = attrs | (0b10000000 >> (attributeNumber & 0b111))
  }

  clearAttr(attributeNumber: number): void {
    const attrAddress = this.startLocation + (attributeNumber >> 3)
    const attrs = this.memory[attrAddress]!
    this.memory[attrAddress] = attrs & (~(0b10000000 >> (attributeNumber & 0b111)) & 0xff)
  }

  describe(): string {
    return `[${this.n}] ${this.getPropertyTable().description()}`
  }

  unlink(): void {
    const parentObjectNumber = this.getParentObjectNumber()
    if (parentObjectNumber === 0) return

    const parent = this.objectTable.getObjectTableEntry(parentObjectNumber)!
    const priorSiblingObjectNumber = this.getPriorSiblingObjectNumber()
    const nextSiblingObjectNumber = this.getNextSiblingObjectNumber()

    if (priorSiblingObjectNumber !== 0) {
      const priorSibling = this.objectTable.getObjectTableEntry(priorSiblingObjectNumber)!
      priorSibling.setNextSiblingObjectNumber(this.getNextSiblingObjectNumber())
    } else {
      if (nextSiblingObjectNumber !== 0) {
        parent.setChildObjectNumber(nextSiblingObjectNumber)
      } else {
        parent.setChildObjectNumber(0)
      }
    }

    this.setParentObjectNumber(0)
    this.setNextSiblingObjectNumber(0)
  }
}
