import { ObjectTableEntry } from './ObjectTableEntry'
import { mreadWord } from './Utils'
import type { AbbreviationLookup } from './ZStrings'

export class ObjectTable {
  readonly gameVersion: number
  readonly objectEntrySize: number
  readonly propertyDefaultsCount: number
  readonly propertyDefaultsStartLocation: number
  readonly objectStartLocation: number
  readonly memory: Uint8Array
  readonly abbreviations: AbbreviationLookup
  readonly objectCount: number

  constructor(startLocation: number, memory: Uint8Array, abbreviations: AbbreviationLookup, gameVersion: number) {
    this.gameVersion = gameVersion
    if (gameVersion <= 3) {
      this.objectEntrySize = 9
      this.propertyDefaultsCount = 31
    } else {
      this.objectEntrySize = 14
      this.propertyDefaultsCount = 63
    }

    this.propertyDefaultsStartLocation = startLocation
    this.objectStartLocation = startLocation + this.propertyDefaultsCount * 2

    this.memory = memory
    this.abbreviations = abbreviations

    this.objectCount = this.determineExtent()
  }

  /**
   * Heuristic object-count scan: walk forward tracking the lowest property-table
   * address seen, stop once the object-entry cursor reaches it. Not spec-guaranteed,
   * but what correctly decodes these game files — preserve exactly, don't "improve".
   */
  private determineExtent(): number {
    let start = this.objectStartLocation
    let done = false
    let lowestPropAddress: number | null = null
    let n = 0

    while (!done) {
      const propAddress = mreadWord(this.memory, start + this.objectEntrySize - 2)

      if (lowestPropAddress === null || propAddress < lowestPropAddress) {
        lowestPropAddress = propAddress
      }

      start += this.objectEntrySize
      n += 1

      if (start >= lowestPropAddress) done = true
    }

    return n
  }

  getObjectTableEntry(n: number): ObjectTableEntry | null {
    if (n === 0) return null
    return new ObjectTableEntry(
      this.objectStartLocation + (n - 1) * this.objectEntrySize,
      this.memory,
      this.objectEntrySize,
      this.abbreviations,
      n,
      this,
      this.gameVersion,
    )
  }

  getPropertyTableEntry(objectNumber: number, propertyNumber: number) {
    const entry = this.getObjectTableEntry(objectNumber)
    return entry?.getPropertyTable().getPropertyTableEntryForPropertyNumber(propertyNumber) ?? null
  }

  insertObject(movingObject: number, destinationObject: number): void {
    const movingObjectTableEntry = this.getObjectTableEntry(movingObject)!
    const destinationObjectTableEntry = this.getObjectTableEntry(destinationObject)!

    movingObjectTableEntry.unlink()

    const previousChild = destinationObjectTableEntry.getChildObjectNumber()
    destinationObjectTableEntry.setChildObjectNumber(movingObjectTableEntry.n)
    movingObjectTableEntry.setParentObjectNumber(destinationObjectTableEntry.n)
    movingObjectTableEntry.setNextSiblingObjectNumber(previousChild)
  }

  removeObject(movingObject: number): void {
    const movingObjectTableEntry = this.getObjectTableEntry(movingObject)!
    movingObjectTableEntry.unlink()
  }

  getPropertyDefault(propertyNumber: number): number {
    return mreadWord(this.memory, this.propertyDefaultsStartLocation + 2 * (propertyNumber - 1))
  }
}
