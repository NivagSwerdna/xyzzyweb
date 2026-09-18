import { Header } from './Header'
import { Stack } from './Stack'

function bytesToUint(bytes: Uint8Array): number {
  let v = 0
  for (const b of bytes) v = v * 256 + b
  return v
}

function pushU32Be(out: number[], value: number, byteCount: number): void {
  for (let shift = (byteCount - 1) * 8; shift >= 0; shift -= 8) {
    out.push((value >>> shift) & 0xff)
  }
}

/**
 * Reads and writes real Quetzal (IFZS) save files, byte-for-byte compatible
 * with any Quetzal-following interpreter. Ported from Quetzal.py, which
 * preserves five specific correctness fixes over a naive reading of the
 * spec — each is called out below since they are easy to regress silently.
 */
export class Quetzal {
  gameFile: string
  /** Pristine copy of the original game file bytes, mutated in place to reconstruct a restore. */
  gameData: Uint8Array

  saveData: Uint8Array | null = null
  ifhdData: Uint8Array | null = null
  cmemData: Uint8Array | null = null
  stksData: Uint8Array | null = null

  /** Set by processIfhd(), consumed by Processor.restore(). */
  restorePc = 0
  newStack: Stack = new Stack()

  constructor(gameFile: string, gameData: Uint8Array) {
    this.gameFile = gameFile
    // Working copy: process_cmem() XORs saved deltas into this buffer in place.
    this.gameData = gameData.slice()
  }

  setSaveData(bytes: Uint8Array): void {
    this.saveData = bytes
  }

  // ------------------------------------------------------------------ //
  // Load path                                                            //
  // ------------------------------------------------------------------ //

  private processIfhd(): void {
    const ifhd = this.ifhdData!
    const releaseNumber = bytesToUint(ifhd.slice(0, 2))
    const serialNumber = ifhd.slice(2, 8)
    const checksum = bytesToUint(ifhd.slice(8, 10))
    const pc = bytesToUint(ifhd.slice(10, 13))

    // Store the restore PC so Processor.restore() can use it.
    this.restorePc = pc

    const header = new Header(this.gameData)

    const matchingSerial = serialNumber.every((b, i) => header.SERIAL[i] === b) && header.SERIAL.length === serialNumber.length
    const matchingRelease = header.ZORKID === releaseNumber
    const matchingChecksum = header.PCHKSUM === checksum

    if (!(matchingSerial && matchingRelease && matchingChecksum)) {
      throw new Error(
        `Save file does not match game file (serial=${matchingSerial ? 'OK' : 'BAD'}, ` +
          `release=${matchingRelease ? 'OK' : 'BAD'}, checksum=${matchingChecksum ? 'OK' : 'BAD'})`,
      )
    }
  }

  /** Decode run-length-encoded XOR delta and apply to gameData. */
  private processCmem(): void {
    const sequence: number[] = []
    let data = this.cmemData!
    let offset = 0
    while (offset < data.length) {
      const byte = data[offset]!
      let occurrences: number
      if (byte === 0) {
        // Run of zeroes: count = data[1] + 1
        occurrences = data[offset + 1]! + 1
        offset += 2
      } else {
        occurrences = 1
        offset += 1
      }
      for (let i = 0; i < occurrences; i++) sequence.push(byte)
    }

    for (let i = 0; i < sequence.length; i++) {
      this.gameData[i] = this.gameData[i]! ^ sequence[i]!
    }
  }

  /** Reconstruct the call stack from the Stks chunk. */
  private processStks(): void {
    this.newStack = new Stack()

    // For versions other than V6, the first Quetzal frame is a dummy frame
    // that holds only the bottom-of-stack eval words (not a real call frame).
    let dummyFrame = true

    const data = this.stksData!
    let offset = 0
    while (offset < data.length) {
      const framePc = bytesToUint(data.slice(offset, offset + 3))
      const flags = data[offset + 3]!
      const resultVariable = data[offset + 4]!
      const argSupplied = data[offset + 5]!
      const evalWordCount = bytesToUint(data.slice(offset + 6, offset + 8))
      offset += 8

      const localWordCount = flags & 0x0f
      const isProcedure = (flags & 0x10) !== 0

      const localsData: number[] = []
      for (let i = 0; i < localWordCount; i++) {
        localsData.push(bytesToUint(data.slice(offset, offset + 2)))
        offset += 2
      }

      const evalData: number[] = []
      for (let i = 0; i < evalWordCount; i++) {
        evalData.push(bytesToUint(data.slice(offset, offset + 2)))
        offset += 2
      }

      if (dummyFrame) {
        // The dummy frame's eval words sit at the very bottom of the stack.
        for (const word of evalData) this.newStack.pushWord(word)
      } else {
        // adjusted_pc goes back one byte so that ret() can call store(), which
        // re-reads the result variable byte from memory. Quetzal stores the
        // return PC PAST the result variable byte, so subtract 1 to point back at it.
        const adjustedPc = framePc - 1

        this.newStack.pushWord(adjustedPc >> 9)
        this.newStack.pushWord(adjustedPc & 0x1ff)
        this.newStack.pushFp()

        const callType = isProcedure ? 1 : 0
        // Reconstruct arg_count from supplied-args bitfield (popcount).
        let argCount = 0
        for (let bits = argSupplied; bits; bits >>= 1) argCount += bits & 1
        this.newStack.pushWord(argCount | (callType << 12))
        this.newStack.markFrame()
        this.newStack.fixupFrame(localWordCount)

        // Push locals (first local = local 1, pushed last so readLocal(1) works).
        for (const word of localsData) this.newStack.pushWord(word)

        // Push eval stack for non-dummy frames too, not just the bottom dummy frame.
        for (const word of evalData) this.newStack.pushWord(word)
      }

      dummyFrame = false
    }
  }

  processFile(): void {
    const save = this.saveData!
    // save[0:4] === 'FORM', save[8:12] === 'IFZS' (not validated further, matching Python).
    const formLength = bytesToUint(save.slice(4, 8))
    const formData = save.slice(8, 8 + formLength)
    const innerData = formData.slice(4)

    let offset = 0
    while (offset < innerData.length) {
      const chunkType = String.fromCharCode(...innerData.slice(offset, offset + 4))
      const chunkLength = bytesToUint(innerData.slice(offset + 4, offset + 8))
      // Slice exactly chunkLength bytes so no pad byte leaks into chunk data;
      // only the outer pointer advances by the padded length.
      const paddedChunkLength = (chunkLength + 1) & ~1
      const chunkData = innerData.slice(offset + 8, offset + 8 + chunkLength)

      if (chunkType === 'IFhd') this.ifhdData = chunkData
      else if (chunkType === 'CMem') this.cmemData = chunkData
      else if (chunkType === 'Stks') this.stksData = chunkData

      offset += 8 + paddedChunkLength
    }

    this.processIfhd()
    this.processCmem()
    this.processStks()
  }

  // ------------------------------------------------------------------ //
  // Save path                                                            //
  // ------------------------------------------------------------------ //

  writeQuetzalSave(memory: Uint8Array, purbot: number, stack: Stack, pc: number): Uint8Array {
    this.ifhdData = this.buildIfhd(pc)
    this.cmemData = this.buildCmem(memory, purbot)
    this.stksData = this.buildStks(memory, stack)

    const chunks: [string, Uint8Array][] = [
      ['IFhd', this.ifhdData],
      ['CMem', this.cmemData],
      ['Stks', this.stksData],
    ]

    let formSize = 4
    for (const [, data] of chunks) {
      formSize += 8 + data.length
      if (data.length % 2 === 1) formSize += 1
    }

    const out: number[] = []
    out.push(..."FORM".split('').map((c) => c.charCodeAt(0)))
    pushU32Be(out, formSize, 4)
    out.push(..."IFZS".split('').map((c) => c.charCodeAt(0)))

    for (const [tag, data] of chunks) {
      out.push(...tag.split('').map((c) => c.charCodeAt(0)))
      pushU32Be(out, data.length, 4)
      out.push(...data)
      if (data.length % 2 === 1) out.push(0)
    }

    this.saveData = Uint8Array.from(out)
    return this.saveData
  }

  private buildIfhd(pc: number): Uint8Array {
    const header = new Header(this.gameData)
    const out: number[] = []
    pushU32Be(out, header.ZORKID, 2)
    out.push(...header.SERIAL)
    pushU32Be(out, header.PCHKSUM, 2)
    pushU32Be(out, pc, 3)
    return Uint8Array.from(out)
  }

  /** Build run-length-encoded XOR delta of dynamic memory. */
  private buildCmem(memory: Uint8Array, purbot: number): Uint8Array {
    const cmem: number[] = []
    let zeroRun = 0

    for (let i = 0; i < purbot; i++) {
      const delta = memory[i]! ^ this.gameData[i]!
      if (delta === 0) {
        zeroRun += 1
      } else {
        while (zeroRun >= 256) {
          cmem.push(0, 255)
          zeroRun -= 256
        }
        if (zeroRun > 0) {
          cmem.push(0, zeroRun - 1)
          zeroRun = 0
        }
        cmem.push(delta)
      }
    }

    // Trailing zero runs are omitted (spec allows this).
    return Uint8Array.from(cmem)
  }

  /** Serialise the call stack to Quetzal Stks format. */
  private buildStks(memory: Uint8Array, stack: Stack): Uint8Array {
    // Walk the stack to find frame boundaries. frames[i] is the index of the
    // word BEFORE frame i's header.
    const frames: number[] = [stack.sp]
    let i = stack.fp + 4
    while (i < stack.stackSize + 4) {
      frames.push(i)
      const nextFp = stack.stack[i - 3]!
      i = nextFp + 4 + 1
    }

    const stks: number[] = []

    // Dummy frame: bottom-of-stack eval words only (6 zero header bytes).
    stks.push(0, 0, 0, 0, 0, 0) // pc(3) + flags(1) + result_var(1) + arg_supply(1)

    const lastFrame = frames[frames.length - 1]!
    const nstk = stack.stackSize - lastFrame
    pushU32Be(stks, nstk, 2)

    for (let idx = stack.stackSize - 1; idx >= stack.stackSize - nstk; idx--) {
      pushU32Be(stks, stack.stack[idx]!, 2)
    }

    // Real call frames, innermost first.
    for (let frameIndex = frames.length - 1; frameIndex > 0; frameIndex--) {
      const currentFrame = frames[frameIndex]!

      const rawPc = (stack.stack[currentFrame - 1]! << 9) | stack.stack[currentFrame - 2]!
      const details = stack.stack[currentFrame - 4]!
      const callType = (details & 0xf000) >> 12
      const varCount = (details & 0x0f00) >> 8
      const argCount = details & 0x00ff

      const localStackCount = frames[frameIndex]! - frames[frameIndex - 1]! - varCount - 4

      const isProcedure = callType !== 0

      let variableForResult: number
      let quetzalPc: number
      if (isProcedure) {
        // Procedures have no result variable.
        variableForResult = 0
        quetzalPc = rawPc // raw_pc already points past the call
      } else {
        // raw_pc points at the result variable byte; read it, then advance.
        variableForResult = memory[rawPc]!
        quetzalPc = rawPc + 1 // Quetzal stores PC past the result byte
      }

      const argPresentBitfield = argCount > 0 ? (1 << argCount) - 1 : 0
      const flags = varCount | (isProcedure ? 0x10 : 0x00)

      pushU32Be(stks, quetzalPc, 3)
      stks.push(flags, variableForResult, argPresentBitfield)
      pushU32Be(stks, localStackCount, 2)

      // Locals then eval stack (both stored innermost-first).
      for (let vi = 0; vi < varCount + localStackCount; vi++) {
        pushU32Be(stks, stack.stack[currentFrame - 5 - vi]!, 2)
      }
    }

    return Uint8Array.from(stks)
  }
}
