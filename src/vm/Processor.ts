import type { AbbreviationTable } from './AbbreviationTable'
import type { DictionaryTable } from './DictionaryTable'
import { Globals } from './Globals'
import { Instructions, OpcodeType } from './Instructions'
import type { ObjectTable } from './ObjectTable'
import type { Screen } from './Screen'
import { Stack } from './Stack'
import { fromSignedIntToUnsignedWord, fromUnsignedWordToSignedInt, mreadByte, mreadWord, mwriteByte, mwriteWord } from './Utils'
import { toZString } from './ZStrings'

const enum OpcodeForm {
  VARIABLE = 0b11,
  SHORT = 0b10,
  LONG_0 = 0b00,
  LONG_1 = 0b01,
}

const enum OperandType {
  LARGE = 0b00,
  SMALL_CONSTANT = 0b01,
  VARIABLE = 0b10,
  OMITTED = 0b11,
}

export class Processor {
  memory: Uint8Array
  pc: number
  globals: Globals
  objectTable: ObjectTable
  abbreviationTable: AbbreviationTable
  dictionary: DictionaryTable
  filename: string
  purbot: number
  stack = new Stack()
  screen: Screen
  instructions: Instructions
  gameVersion: number
  /** Original, unpatched game file bytes — needed for restart and Quetzal save diffing. */
  pristineMemory: Uint8Array

  constructor(options: {
    memory: Uint8Array
    start: number
    objectTable: ObjectTable
    abbreviationTable: AbbreviationTable
    dictionary: DictionaryTable
    filename: string
    purbot: number
    gameVersion: number
    screen: Screen
    pristineMemory: Uint8Array
    globalVariables?: Globals
  }) {
    this.memory = options.memory
    this.pc = options.start
    this.objectTable = options.objectTable
    this.abbreviationTable = options.abbreviationTable
    this.dictionary = options.dictionary
    this.filename = options.filename
    this.purbot = options.purbot
    this.screen = options.screen
    this.gameVersion = options.gameVersion
    this.pristineMemory = options.pristineMemory
    this.globals = options.globalVariables ?? new Globals(options.memory, options.gameVersion)
    this.instructions = new Instructions(this, options.dictionary, options.screen)
  }

  /** Returns a Promise only when the executed instruction needed to suspend for input. */
  nextInstruction(): void | Promise<void> {
    const currentPc = this.pc
    const opcode = this.getByteAndAdvance()

    // V4+ adds the EXTENDED opcode form (0xBE).
    if (opcode === 0xbe && this.gameVersion >= 4) {
      return this.executeExtended()
    }

    const opcodeForm = opcode >> 6

    const args: number[] = []

    if (opcodeForm === OpcodeForm.LONG_0 || opcodeForm === OpcodeForm.LONG_1) {
      // All versions: bit 6 = operand 1 type, bit 5 = operand 2 type.
      // 0 = small constant, 1 = variable.
      const operandType1 = (opcode & 0x40) === 0 ? OperandType.SMALL_CONSTANT : OperandType.VARIABLE
      this.loadOperand(operandType1, args)
      const operandType2 = (opcode & 0x20) === 0 ? OperandType.SMALL_CONSTANT : OperandType.VARIABLE
      this.loadOperand(operandType2, args)
      const opNumber = opcode & 0b11111

      return this.instructions.execute(OpcodeType.z_2OP, opNumber, args, currentPc, opcode)
    } else if (opcodeForm === OpcodeForm.SHORT) {
      const operandType1: OperandType = (opcode >> 4) & 0x03
      const opNumber = opcode & 0b1111
      if (operandType1 === OperandType.OMITTED) {
        return this.instructions.execute(OpcodeType.z_0OP, opNumber, args, currentPc, opcode)
      } else {
        this.loadOperand(operandType1, args)
        return this.instructions.execute(OpcodeType.z_1OP, opNumber, args, currentPc, opcode)
      }
    } else {
      // VARIABLE
      // V4+: opcodes 0xEC (call_vs2) and 0xFA (call_vn2) take two operand type bytes.
      if (this.gameVersion >= 4 && (opcode === 0xec || opcode === 0xfa)) {
        const opNumber = opcode & 0b11111
        const varOperandTypes1 = this.getByteAndAdvance()
        const varOperandTypes2 = this.getByteAndAdvance()
        this.loadOperands(varOperandTypes1, args)
        this.loadOperands(varOperandTypes2, args)
        return this.instructions.execute(OpcodeType.z_VAR, opNumber, args, currentPc, opcode)
      } else {
        const opcodeType = (opcode & 0b00100000) === 0 ? OpcodeType.z_2OP : OpcodeType.z_VAR
        const opNumber = opcode & 0b11111
        const varOperandTypes = this.getByteAndAdvance()
        this.loadOperands(varOperandTypes, args)
        return this.instructions.execute(opcodeType, opNumber, args, currentPc, opcode)
      }
    }
  }

  /** Handle V4+ extended opcodes (opcode byte 0xBE). */
  private executeExtended(): void | Promise<void> {
    const currentPc = this.pc - 1 // point back at the 0xBE
    const extOpcode = this.getByteAndAdvance()
    const args: number[] = []
    const varOperandTypes = this.getByteAndAdvance()
    this.loadOperands(varOperandTypes, args)
    return this.instructions.execute(OpcodeType.z_EXT, extOpcode, args, currentPc, 0xbe)
  }

  private loadOperand(operandType: OperandType, args: number[]): void {
    let value: number
    switch (operandType) {
      case OperandType.LARGE:
        value = this.getWordAndAdvance()
        break
      case OperandType.SMALL_CONSTANT:
        value = this.getByteAndAdvance()
        break
      case OperandType.VARIABLE: {
        const variable = this.getByteAndAdvance()
        if (variable === 0) value = this.stack.popWord()
        else if (variable < 16) value = this.stack.readLocal(variable)
        else value = this.globals.readGlobal(variable - 16)
        break
      }
      default:
        throw new Error(`loadOperand called with OMITTED`)
    }
    args.push(value)
  }

  private loadOperands(varOperandTypes: number, args: number[]): void {
    for (let i = 6; i >= 0; i -= 2) {
      const operandType: OperandType = (varOperandTypes >> i) & 0b11
      if (operandType === OperandType.OMITTED) break
      this.loadOperand(operandType, args)
    }
  }

  getByteAndAdvance(): number {
    const v = this.memory[this.pc]!
    this.pc += 1
    return v
  }

  getWordAndAdvance(): number {
    const v = mreadWord(this.memory, this.pc)
    this.pc += 2
    return v
  }

  getPc(): number {
    return this.pc
  }

  setPc(newAddress: number): void {
    this.pc = newAddress
  }

  store(value: number): void {
    const variable = this.getByteAndAdvance()
    if (variable === 0) this.stack.pushWord(value)
    else if (variable < 16) this.stack.writeLocal(variable, value)
    else this.globals.writeGlobal(variable - 16, value)
  }

  branch(condition: boolean): void {
    let specifier = this.getByteAndAdvance()
    let offset1 = specifier & 0b111111

    if (!condition) specifier ^= 0x80

    let offset: number
    if ((specifier & 0x40) === 0x00) {
      if ((offset1 & 0b100000) !== 0) offset1 |= 0b11000000
      const offset2 = this.getByteAndAdvance()
      const rawOffset = (offset1 << 8) | offset2
      offset = fromUnsignedWordToSignedInt(rawOffset & 0xffff)
    } else {
      offset = offset1
    }

    if (specifier & 0x80) {
      if (offset === 0 || offset === 1) {
        this.ret(offset)
      } else {
        let pc = this.getPc()
        pc += offset - 2
        this.setPc(pc)
      }
    }
  }

  jump(delta: number): void {
    this.setPc(this.pc + delta)
  }

  loadb(address: number): number {
    return mreadByte(this.memory, address)
  }

  loadw(address: number): number {
    return mreadWord(this.memory, address)
  }

  storeb(address: number, value: number): void {
    mwriteByte(this.memory, address, value)
  }

  storew(address: number, value: number): void {
    mwriteWord(this.memory, address, value)
  }

  /** Convert a packed address to a byte address based on game version. */
  packedAddress(paddr: number): number {
    if (this.gameVersion <= 3) return paddr * 2
    if (this.gameVersion <= 7) return paddr * 4
    return paddr * 8 // V8
  }

  call(address: number, args: readonly number[], callType: number): void {
    const pc = this.getPc()
    this.stack.pushWord(pc >> 9)
    this.stack.pushWord(pc & 0x1ff)
    this.stack.pushFp()
    this.stack.pushWord(args.length | (callType << 12))
    this.stack.markFrame()

    const byteAddress = this.packedAddress(address)
    this.setPc(byteAddress)

    const localVarCount = this.getByteAndAdvance()
    this.stack.fixupFrame(localVarCount)

    for (let i = 0; i < localVarCount; i++) {
      let v: number
      if (this.gameVersion <= 4) {
        // V1-4: local variable defaults are stored in the routine header.
        v = this.getWordAndAdvance()
      } else {
        // V5+: no stored default values; locals start as 0.
        v = 0
      }
      if (i < args.length) v = args[i]!
      this.stack.pushWord(v)
    }
  }

  ret(value: number): void {
    this.stack.unmarkFrame()
    const ct = this.stack.popWord() >> 12
    this.stack.popFp()
    let pc = this.stack.popWord()
    pc |= this.stack.popWord() << 9
    this.setPc(pc)
    if (ct === 0) this.store(value)
    else if (ct === 1) this.stack.pushWord(value)
    // ct === 2: void call (call_vn / call_vn2) — discard return value.
  }

  /**
   * Synchronously call a Z-machine routine and return true if it returns non-zero.
   * Used by timed-input interrupt callbacks. The routine is called with
   * callType=1 so ret() pushes the return value onto the eval stack rather
   * than trying to consume a store-variable byte from the PC (which would
   * corrupt the instruction stream). Runs nextInstruction() until the frame
   * returns, then pops the result, restores PC, and hands back a bool.
   */
  async callAndRun(packedAddress: number, args: readonly number[]): Promise<boolean> {
    const savedPc = this.pc
    const savedFp = this.stack.fp // frame pointer before the call

    // callType=1: ret() will push the return value instead of calling store().
    this.call(packedAddress, args, 1)

    // ret() restores fp via popFp(), so when fp is back to savedFp we are done.
    while (this.stack.fp !== savedFp) {
      const maybe = this.nextInstruction()
      if (maybe) await maybe
    }

    // ret() with callType=1 pushed the return value onto the eval stack.
    const result = this.stack.popWord()

    // ret() already restored PC to savedPc; this is just defensive.
    this.setPc(savedPc)

    return result !== 0
  }

  printPaddr(paddr: number): void {
    const zstringAddress = this.packedAddress(paddr)
    this.screen.printStr(toZString(zstringAddress, this.memory, this.abbreviationTable))
  }

  adjustVariable(variable: number, delta: number): number {
    let value: number
    if (variable === 0) value = this.stack.popWord()
    else if (variable < 16) value = this.stack.readLocal(variable)
    else value = this.globals.readGlobal(variable - 16)

    const signedValue = fromUnsignedWordToSignedInt(value)
    const result = signedValue + delta
    value = fromSignedIntToUnsignedWord(result)

    if (variable === 0) this.stack.pushWord(value)
    else if (variable < 16) this.stack.writeLocal(variable, value)
    else this.globals.writeGlobal(variable - 16, value)

    return result
  }

  pull(destination: number): void {
    const value = this.stack.popWord()
    if (destination === 0) this.stack.pushWord(value)
    else if (destination < 16) this.stack.writeLocal(destination, value)
    else this.globals.writeGlobal(destination - 16, value)
  }

  /** Restore game state from a save file. */
  restore(gameData: Uint8Array, newStack: Stack, newPc: number): void {
    this.memory.set(gameData)
    this.stack = newStack
    this.setPc(newPc)

    if (this.gameVersion <= 3) {
      // V3: save/restore are branch instructions.
      this.branch(true)
    } else {
      // V4+: save/restore are store instructions.
      // 2 = successfully restored (0 = failed, 1 = saved OK, 2 = restored OK).
      this.store(2)
    }
  }

  /** Called when a save attempt fails. */
  saveFailed(): void {
    if (this.gameVersion <= 3) this.branch(false)
    else this.store(0)
  }

  /** Called after a successful save (from the saving side). */
  saveSucceeded(): void {
    if (this.gameVersion <= 3) this.branch(true)
    else this.store(1)
  }
}
