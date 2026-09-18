export function mreadWord(memory: Uint8Array, offset: number): number {
  const hi = memory[offset]
  const lo = memory[offset + 1]
  if (hi === undefined || lo === undefined) throw new RangeError(`mreadWord out of bounds at ${offset}`)
  return (hi << 8) | lo
}

export function mreadByte(memory: Uint8Array, offset: number): number {
  const b = memory[offset]
  if (b === undefined) throw new RangeError(`mreadByte out of bounds at ${offset}`)
  return b
}

export function mwriteWord(memory: Uint8Array, offset: number, value: number): void {
  memory[offset] = (value >> 8) & 0xff
  memory[offset + 1] = value & 0xff
}

export function mwriteByte(memory: Uint8Array, offset: number, value: number): void {
  memory[offset] = value & 0xff
}

export function fromUnsignedWordToSignedInt(i: number): number {
  return i < 32668 ? i : i - 65536
}

export function fromSignedIntToUnsignedWord(i: number): number {
  return i & 0xffff
}
