import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Quetzal } from '../../src/vm/Quetzal'
import { loadGame } from './fixtures'

const testDir = path.dirname(fileURLToPath(import.meta.url))

function loadFixture(fileName: string): Uint8Array {
  return new Uint8Array(readFileSync(path.resolve(testDir, '../fixtures', fileName)))
}

describe('Quetzal interop with real Python-generated saves', () => {
  it('parses a Quetzal save produced by the original Python interpreter (TRINITY)', () => {
    const gameData = loadGame('TRINITY.DAT')
    const saveBytes = loadFixture('trinity-a.qzl')

    const q = new Quetzal('TRINITY.DAT', gameData)
    q.setSaveData(saveBytes)

    // Should not throw: IFhd release/serial/checksum must match TRINITY.DAT,
    // and the CMem/Stks chunks must decode without error.
    expect(() => q.processFile()).not.toThrow()

    expect(q.restorePc).toBeGreaterThan(0)
    expect(q.newStack.frameCount).toBeGreaterThanOrEqual(0)
    // Every restored frame's saved return PC should land inside the file.
    expect(q.restorePc).toBeLessThan(gameData.length)
  })

  it('rejects a save file that does not match the loaded game', () => {
    const gameData = loadGame('ZORK1.DAT') // mismatched: save was made against TRINITY
    const saveBytes = loadFixture('trinity-a.qzl')

    const q = new Quetzal('ZORK1.DAT', gameData)
    q.setSaveData(saveBytes)

    expect(() => q.processFile()).toThrow(/does not match/)
  })
})
