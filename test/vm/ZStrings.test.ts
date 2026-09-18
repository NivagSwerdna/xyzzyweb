import { describe, expect, it } from 'vitest'
import { convertToEncodedWords, toZString } from '../../src/vm/ZStrings'

describe('ZStrings', () => {
  it('round-trips a plain lowercase word through encode -> decode', () => {
    // Two key-words = 6 z-characters, so a longer word like "examine" (7 letters)
    // is truncated to its first 6 letters — this matches how a real Z-machine
    // dictionary stores/compares words, not a bug in the encoder.
    const words = convertToEncodedWords('examine')
    expect(words).toHaveLength(2)
    expect(words[1]! & 0x8000).not.toBe(0) // last word has the top bit set

    // Decode straight back out of a scratch buffer to verify the encoding is legible.
    const memory = new Uint8Array(4)
    memory[0] = (words[0]! >> 8) & 0xff
    memory[1] = words[0]! & 0xff
    memory[2] = (words[1]! >> 8) & 0xff
    memory[3] = words[1]! & 0xff

    const decoded = toZString(0, memory, null)
    expect(decoded.trim()).toBe('examin')
  })

  it('pads short words with alphabet-shift filler (5)', () => {
    const words = convertToEncodedWords('go')
    expect(words).toHaveLength(2)
  })
})
