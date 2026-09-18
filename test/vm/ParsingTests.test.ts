import { describe, expect, it } from 'vitest'
import { AbbreviationTable } from '../../src/vm/AbbreviationTable'
import { DictionaryTable } from '../../src/vm/DictionaryTable'
import { Header } from '../../src/vm/Header'
import { convertToEncodedWords } from '../../src/vm/ZStrings'
import { loadGame } from './fixtures'

// Port of infocomm/tests/ParsingTests.py: tokenizes "examine, ghostsocks" the
// same way the in-game parser does, then looks each token up in ZORK1's
// dictionary. "examine" is a real verb; "ghostsocks" is not a real word.
describe('ZORK1 dictionary parsing', () => {
  const memory = loadGame('ZORK1.DAT')
  const header = new Header(memory)
  const abbreviations = new AbbreviationTable(header.FWORDS, memory)
  const dictionary = new DictionaryTable(header.VOCAB, memory, abbreviations, header.ZVERSION_version)

  function tokenize(input: string): string[] {
    const str = input.toLowerCase()
    const separators = new Set(dictionary.getSeparators())
    const spaceInSeparators = separators.has(' ')
    if (!spaceInSeparators) separators.add(' ')

    const words: string[] = []
    let currentWord = ''
    for (const c of str) {
      if (separators.has(c)) {
        if (currentWord.length > 0) {
          words.push(currentWord)
          currentWord = ''
        }
        if (c !== ' ' || spaceInSeparators) words.push(c)
      } else {
        currentWord += c
      }
    }
    if (currentWord.length > 0) words.push(currentWord)
    return words
  }

  it('tokenizes on the dictionary separators and whitespace', () => {
    const tokens = tokenize('examine,     ghostsocks')
    expect(tokens).toEqual(['examine', ',', 'ghostsocks'])
  })

  it('finds a real verb in the dictionary', () => {
    // The dictionary only stores/compares the first 6 letters (V3), so "examine"
    // is looked up (and stored) as "examin".
    const address = dictionary.findPhrase(convertToEncodedWords('examine'))
    expect(address).not.toBeNull()

    const entry = dictionary.entryAt(address!)
    expect(entry.text().trim()).toBe('examin')
  })

  it('does not find a made-up word in the dictionary', () => {
    const address = dictionary.findPhrase(convertToEncodedWords('zzqxvbnm'))
    expect(address).toBeNull()
  })
})
