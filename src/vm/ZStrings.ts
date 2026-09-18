export const alphabetA0 = '^^^^^^abcdefghijklmnopqrstuvwxyz'
export const alphabetA1 = '^^^^^^ABCDEFGHIJKLMNOPQRSTUVWXYZ'
// NOTE: contains a Unicode right single quotation mark (U+2019), not an ASCII apostrophe.
export const alphabetA2 = '^^^^^^^^0123456789.,!?_#’"/\\-:()'

export interface AbbreviationLookup {
  toString(n: number): string
}

export class ZStringContext {
  currentAlphabet: string = alphabetA0
  buildingZSCII = false
  partialZSCII: number | null = null
  nextIsAbbreviation = false
  abbreviationOffset: number | null = null
}

export function singleZSCIIChar(value: number): string {
  return String.fromCharCode(value)
}

function fromZChar(
  value: number,
  abbreviationTable: AbbreviationLookup | null,
  context: ZStringContext,
): string {
  if (context.nextIsAbbreviation) {
    context.nextIsAbbreviation = false
    if (!abbreviationTable) throw new Error('Abbreviation reference with no abbreviation table')
    return abbreviationTable.toString(value + (context.abbreviationOffset ?? 0))
  }

  if (context.buildingZSCII) {
    if (context.partialZSCII === null) {
      context.partialZSCII = value
      return ''
    } else {
      const zscii = (context.partialZSCII << 5) | value
      const result = singleZSCIIChar(zscii)
      context.buildingZSCII = false
      context.currentAlphabet = alphabetA0
      return result
    }
  }

  if (value === 0) {
    context.currentAlphabet = alphabetA0
    return ' '
  } else if (value === 1) {
    context.nextIsAbbreviation = true
    context.abbreviationOffset = 32 * (value - 1)
    return ''
  } else if (value === 2) {
    context.nextIsAbbreviation = true
    context.abbreviationOffset = 32 * (value - 1)
    return ''
  } else if (value === 3) {
    context.nextIsAbbreviation = true
    context.abbreviationOffset = 32 * (value - 1)
    return ''
  } else if (value === 4) {
    context.currentAlphabet = alphabetA1
    return ''
  } else if (value === 5) {
    context.currentAlphabet = alphabetA2
    return ''
  } else if (value === 6 && context.currentAlphabet === alphabetA2) {
    context.buildingZSCII = true
    context.partialZSCII = null
    return ''
  } else if (value === 7 && context.currentAlphabet === alphabetA2) {
    context.currentAlphabet = alphabetA0
    return '\n'
  } else {
    const zscii = context.currentAlphabet[value]!
    context.currentAlphabet = alphabetA0
    return zscii
  }
}

export function toZString(
  address: number,
  memory: Uint8Array,
  abbreviationTable: AbbreviationLookup | null,
  count: number | null = null,
  context: ZStringContext = new ZStringContext(),
): string {
  let result = ''
  let done = false
  while (!done) {
    const hi = memory[address]!
    const lo = memory[address + 1]!
    const word = (hi << 8) | lo
    address += 2
    const top = word & 0x8000
    const first = (word >> 10) & 0x1f
    const second = (word >> 5) & 0x1f
    const third = word & 0x1f
    result +=
      fromZChar(first, abbreviationTable, context) +
      fromZChar(second, abbreviationTable, context) +
      fromZChar(third, abbreviationTable, context)
    if (top) done = true
    if (count !== null) {
      count -= 1
      if (count === 0) done = true
    }
  }
  return result
}

function appendIfSpace(fiveBits: number[], extraBits: number[], maxBits: number): void {
  if (fiveBits.length + extraBits.length <= maxBits) {
    fiveBits.push(...extraBits)
  } else {
    fiveBits.push(...new Array(maxBits - fiveBits.length).fill(5))
  }
}

export function convertToEncodedWords(s: string, keyWords = 2): number[] {
  let index = 0
  const fiveBitsToEncode = keyWords * 3
  const fiveBits: number[] = []

  while (fiveBits.length < fiveBitsToEncode) {
    if (index < s.length) {
      const c = s[index]!
      index += 1

      if (c !== '^' && alphabetA0.includes(c)) {
        fiveBits.push(alphabetA0.indexOf(c))
      } else if (c !== '^' && alphabetA1.includes(c)) {
        appendIfSpace(fiveBits, [4, alphabetA1.indexOf(c)], fiveBitsToEncode)
      } else if (c !== '^' && alphabetA2.includes(c)) {
        appendIfSpace(fiveBits, [5, alphabetA2.indexOf(c)], fiveBitsToEncode)
      } else {
        const value = c.charCodeAt(0)
        appendIfSpace(fiveBits, [5, 6, value >> 5, value & 0b11111], fiveBitsToEncode)
      }
    } else {
      fiveBits.push(5)
    }
  }

  const words: number[] = []
  for (let i = 0; i < fiveBits.length; i += 3) {
    const a = fiveBits[i]!
    const b = fiveBits[i + 1]!
    const c = fiveBits[i + 2]!
    words.push((a << 10) | (b << 5) | c)
  }
  words[words.length - 1] = words[words.length - 1]! | 0x8000

  return words
}
