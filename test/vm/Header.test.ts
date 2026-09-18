import { describe, expect, it } from 'vitest'
import { Header } from '../../src/vm/Header'
import { loadGame } from './fixtures'

describe('Header', () => {
  it('parses ZORK1.DAT as a version 3 game', () => {
    const memory = loadGame('ZORK1.DAT')
    const header = new Header(memory)

    expect(header.ZVERSION_version).toBe(3)
    expect(header.VOCAB).toBeGreaterThan(0)
    expect(header.OBJECT).toBeGreaterThan(0)
    expect(header.GLOBALS).toBeGreaterThan(0)
    expect(header.START).toBeGreaterThan(0)
    expect(header.SERIAL.length).toBe(6)
  })
})
