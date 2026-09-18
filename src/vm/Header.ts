import { mreadWord } from './Utils'

export class Header {
  readonly ZVERSION_version: number
  readonly ZVERSION_mode: number
  readonly ZORKID: number
  readonly ENDLOD: number
  readonly START: number
  readonly VOCAB: number
  readonly OBJECT: number
  readonly GLOBALS: number
  readonly PURBOT: number
  readonly FLAGS: Uint8Array
  readonly SERIAL: Uint8Array
  readonly FWORDS: number
  readonly PLENTH: number
  readonly PCHKSUM: number

  constructor(memory: Uint8Array) {
    const m = memory
    this.ZVERSION_version = m[0]!
    this.ZVERSION_mode = m[1]!
    this.ZORKID = mreadWord(m, 2)
    this.ENDLOD = mreadWord(m, 4)
    this.START = mreadWord(m, 6)
    this.VOCAB = mreadWord(m, 8)
    this.OBJECT = mreadWord(m, 10)
    this.GLOBALS = mreadWord(m, 12)
    this.PURBOT = mreadWord(m, 0x000e)
    this.FLAGS = m.slice(16, 18)
    this.SERIAL = m.slice(18, 24)
    this.FWORDS = mreadWord(m, 0x0018)
    this.PLENTH = mreadWord(m, 26)
    this.PCHKSUM = mreadWord(m, 28)
  }

  get serialString(): string {
    return Array.from(this.SERIAL)
      .map((b) => String.fromCharCode(b))
      .join('')
  }
}
