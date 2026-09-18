import type { DictionaryTable } from './DictionaryTable'
import type { Processor } from './Processor'
import { Quetzal } from './Quetzal'
import type { Screen } from './Screen'
import { UndoPerformed, RestartRequested, QuitRequested } from './errors'
import { fromSignedIntToUnsignedWord, fromUnsignedWordToSignedInt, mreadByte, mreadWord, mwriteByte, mwriteWord } from './Utils'
import { convertToEncodedWords, singleZSCIIChar, toZString } from './ZStrings'

export const enum OpcodeType {
  z_0OP = 0,
  z_1OP = 1,
  z_2OP = 2,
  z_VAR = 3,
  z_EXT = 4, // V5+ extended opcodes (0xBE prefix)
}

type OpcodeHandler = (args: readonly number[]) => void | Promise<void>

/** Persists/retrieves Quetzal save bytes for a named slot (wired to IndexedDB by the browser UI). */
export interface SaveHandler {
  save(bytes: Uint8Array, slotName: string): Promise<void>
  restore(slotName: string): Promise<Uint8Array | null>
}

/**
 * Notified once per real player command with a room-to-room transition
 * (used to build the live map). fromLocation is null on the very first
 * turn (nothing to compare against yet); either label can be null if the
 * current location couldn't be determined for this game.
 */
export interface TurnObserver {
  onTurn(fromLocation: string | null, toLocation: string | null, command: string): void
}

// Common short names Infocom games give the player object, used by the V4+
// location-detection heuristic below (mirrors the Python interpreter's
// _find_player_object).
const PLAYER_NAMES = new Set(['yourself', 'you', 'self', 'me', 'adventurer', 'hero', 'cretin', 'player', 'i'])

interface InterpUndoSnapshot {
  pc: number
  memory: Uint8Array
  stackData: Uint32Array
  random: number
  sp: number
  fp: number
  frameCount: number
}

export class Instructions {
  readonly processor: Processor
  readonly dictionary: DictionaryTable
  readonly screen: Screen
  saveHandler?: SaveHandler
  turnObserver?: TurnObserver

  random = 0x1234

  // Output stream 1 (screen): can be disabled by output_stream -1.
  private stream1Active = true
  // Output stream 3: stack of [tableAddress, currentLength] pairs.
  // When non-empty, print output goes to memory instead of the screen.
  private stream3Stack: Array<[number, number]> = []

  private undoStack: InterpUndoSnapshot[] = []
  private readonly undoMaxDepth = 10
  private interpUndoStack: InterpUndoSnapshot[] = []
  /** If true, undo does NOT reset the RNG to its pre-undo value. */
  undoRandomContinue = false

  private currentOpcodePc = 0
  private lastSavePath: string | null = null

  // Map-tracking state (only touched when turnObserver is set).
  private mapPrevLocation: string | null = null
  private mapPrevCommand: string | null = null
  private playerObjNum: number | null = null
  private playerCandidates: number[] | null = null

  private readonly op0Functions: OpcodeHandler[]
  private readonly op1Functions: OpcodeHandler[]
  private readonly op2Functions: OpcodeHandler[]
  private readonly varFunctions: OpcodeHandler[]
  private readonly extFunctions: OpcodeHandler[]
  private readonly allFunctions: readonly OpcodeHandler[][]

  constructor(processor: Processor, dictionary: DictionaryTable, screen: Screen, saveHandler?: SaveHandler) {
    this.processor = processor
    this.dictionary = dictionary
    this.screen = screen
    this.saveHandler = saveHandler

    this.op0Functions = [
      this.instructionRtrue, // 0
      this.instructionRfalse, // 1
      this.instructionPrint, // 2
      this.instructionPrintRet, // 3
      this.instructionNop, // 4 nop
      this.instructionSave, // 5
      this.instructionRestore, // 6
      this.instructionRestart, // 7
      this.instructionRetPopped, // 8
      this.instructionPop, // 9 pop (V1-4)
      this.instructionQuit, // 10
      this.instructionNewLine, // 11
      this.instructionShowStatus, // 12 no-op in V4
      this.instructionVerify, // 13 stub as true
      this.unimplemented, // 14
      this.instructionPiracy, // 15 stub as genuine
    ].map((fn) => fn.bind(this))

    this.op1Functions = [
      this.instructionJz, // 0
      this.instructionGetSibling, // 1
      this.instructionGetChild, // 2
      this.instructionGetParent, // 3
      this.instructionGetPropLen, // 4
      this.instructionInc, // 5
      this.instructionDec, // 6
      this.instructionPrintAddr, // 7
      this.instructionCall1s, // 8 call_1s (V4+)
      this.instructionRemoveObject, // 9
      this.instructionPrintObj, // 10
      this.instructionRet, // 11
      this.instructionJump, // 12
      this.instructionPrintPaddr, // 13
      this.instructionLoad, // 14
      this.instructionNot, // 15 not (V1-4)
    ].map((fn) => fn.bind(this))

    this.op2Functions = [
      this.illegal, // 0
      this.instructionJe, // 1
      this.instructionJl, // 2
      this.instructionJg, // 3
      this.instructionDecChk, // 4
      this.instructionIncChk, // 5
      this.instructionJin, // 6
      this.instructionTest, // 7
      this.instructionOr, // 8
      this.instructionAnd, // 9
      this.instructionTestAttr, // 10
      this.instructionSetAttr, // 11
      this.instructionClearAttr, // 12
      this.instructionStore, // 13
      this.instructionInsertObj, // 14
      this.instructionLoadw, // 15
      this.instructionLoadb, // 16
      this.instructionGetProp, // 17
      this.instructionGetPropAddr, // 18
      this.instructionGetNextProp, // 19
      this.instructionAdd, // 20
      this.instructionSub, // 21
      this.instructionMul, // 22
      this.instructionDiv, // 23
      this.instructionMod, // 24
      this.instructionCall2s, // 25 call_2s (V4+)
      this.unimplemented, // 26 call_2n (V5+)
      this.instructionSetColour, // 27 set_colour (V5+)
      this.unimplemented, // 28 throw (V5+)
      this.unimplemented, // 29
      this.unimplemented, // 30
      this.unimplemented, // 31
    ].map((fn) => fn.bind(this))

    this.varFunctions = [
      this.instructionCall, // 0 call / call_vs
      this.instructionStorew, // 1
      this.instructionStoreb, // 2
      this.instructionPutProp, // 3
      this.instructionRead, // 4 sread/aread
      this.instructionPrintChar, // 5
      this.instructionPrintNum, // 6
      this.instructionRandom, // 7
      this.instructionPush, // 8
      this.instructionPull, // 9
      this.instructionSplitWindow, // 10
      this.instructionSetWindow, // 11
      this.instructionCallVs2, // 12 call_vs2 (V4+)
      this.instructionEraseWindow, // 13
      this.instructionEraseLine, // 14
      this.instructionSetCursor, // 15
      this.instructionGetCursor, // 16
      this.instructionSetTextStyle, // 17
      this.instructionBufferMode, // 18
      this.instructionOutputStream, // 19
      this.instructionInputStream, // 20
      this.instructionSoundEffect, // 21 sound_effect
      this.instructionReadChar, // 22 read_char (V4+)
      this.instructionScanTable, // 23 scan_table (V4+)
      this.unimplemented, // 24 not (V5+)
      this.instructionCallVn, // 25 call_vn (V4+)
      this.instructionCallVn2, // 26 call_vn2 (V4+)
      this.unimplemented, // 27 tokenise (V5+)
      this.unimplemented, // 28 encode_text (V5+)
      this.unimplemented, // 29 copy_table (V5+)
      this.unimplemented, // 30 print_table (V5+)
      this.instructionCheckArgCount, // 31 check_arg_count (V4+)
    ].map((fn) => fn.bind(this))

    this.extFunctions = [
      this.unimplemented, // 0 save (V5+)
      this.unimplemented, // 1 restore (V5+)
      this.instructionLogShift, // 2
      this.instructionArtShift, // 3
      this.instructionSetFont, // 4
      this.unimplemented, // 5 draw_picture (V6)
      this.unimplemented, // 6 picture_data (V6)
      this.unimplemented, // 7 erase_picture (V6)
      this.unimplemented, // 8 set_margins (V6)
      this.instructionSaveUndo, // 9
      this.instructionRestoreUndo, // 10
      this.unimplemented, // 11 print_unicode
      this.unimplemented, // 12 check_unicode
    ].map((fn) => fn.bind(this))

    this.allFunctions = [this.op0Functions, this.op1Functions, this.op2Functions, this.varFunctions, this.extFunctions]
  }

  execute(opType: OpcodeType, opNumber: number, args: readonly number[], currentPc: number, _opcode: number): void | Promise<void> {
    this.currentOpcodePc = currentPc
    const table = this.allFunctions[opType]
    const implementation = table?.[opNumber]
    if (!implementation) throw new Error(`Illegal opcode ${opType}:${opNumber} at 0x${currentPc.toString(16)}`)
    return implementation(args)
  }

  private unimplemented(_args: readonly number[]): void {
    throw new Error('Unimplemented function')
  }

  private illegal(_args: readonly number[]): void {
    throw new Error('Illegal function')
  }

  // ---------------------------------------------------------------------- //
  // Output helpers — route through stream 3 if active, else Screen          //
  // ---------------------------------------------------------------------- //

  private printStr(s: string): void {
    if (this.stream3Stack.length > 0) {
      const [tableAddr, startLength] = this.stream3Stack[this.stream3Stack.length - 1]!
      let length = startLength
      for (const ch of s) {
        mwriteByte(this.processor.memory, tableAddr + 2 + length, ch.charCodeAt(0))
        length += 1
      }
      mwriteWord(this.processor.memory, tableAddr, length)
      this.stream3Stack[this.stream3Stack.length - 1] = [tableAddr, length]
    } else if (this.stream1Active) {
      this.screen.printStr(s)
    }
  }

  private printChar(ch: string): void {
    if (this.stream3Stack.length > 0) {
      const [tableAddr, startLength] = this.stream3Stack[this.stream3Stack.length - 1]!
      mwriteByte(this.processor.memory, tableAddr + 2 + startLength, ch.charCodeAt(0))
      const length = startLength + 1
      mwriteWord(this.processor.memory, tableAddr, length)
      this.stream3Stack[this.stream3Stack.length - 1] = [tableAddr, length]
    } else if (this.stream1Active) {
      this.screen.printChar(ch)
    }
  }

  // ---------------------------------------------------------------------- //
  // Call Instructions                                                       //
  // ---------------------------------------------------------------------- //

  private instructionCall(args: readonly number[]): void {
    if (args[0] === 0x0000) this.processor.store(0)
    else this.processor.call(args[0]!, args.slice(1), 0)
  }

  private instructionCallVs2(args: readonly number[]): void {
    if (args[0] === 0) this.processor.store(0)
    else this.processor.call(args[0]!, args.slice(1), 0)
  }

  private instructionCall2s(args: readonly number[]): void {
    if (args[0] === 0) this.processor.store(0)
    else this.processor.call(args[0]!, args.slice(1, 2), 0)
  }

  private instructionCall1s(args: readonly number[]): void {
    if (args[0] === 0) this.processor.store(0)
    else this.processor.call(args[0]!, [], 0)
  }

  private instructionCallVn(args: readonly number[]): void {
    if (args[0] !== 0) this.processor.call(args[0]!, args.slice(1), 2) // 2 = void: discard return value
  }

  private instructionCallVn2(args: readonly number[]): void {
    if (args[0] !== 0) this.processor.call(args[0]!, args.slice(1), 2)
  }

  // ---------------------------------------------------------------------- //
  // Memory Instructions                                                     //
  // ---------------------------------------------------------------------- //

  private instructionStorew(args: readonly number[]): void {
    this.processor.storew(args[0]! + 2 * args[1]!, args[2]!)
  }

  private instructionStore(args: readonly number[]): void {
    const variable = args[0]!
    const value = args[1]!
    if (variable === 0) this.processor.stack.pushWord(value)
    else if (variable < 16) this.processor.stack.writeLocal(variable, value)
    else this.processor.globals.writeGlobal(variable - 16, value)
  }

  private instructionStoreb(args: readonly number[]): void {
    mwriteByte(this.processor.memory, args[0]! + args[1]!, args[2]!)
  }

  private instructionLoadb(args: readonly number[]): void {
    this.processor.store(this.processor.loadb(args[0]! + args[1]!))
  }

  private instructionLoadw(args: readonly number[]): void {
    this.processor.store(this.processor.loadw(args[0]! + 2 * args[1]!))
  }

  // ---------------------------------------------------------------------- //
  // Arithmetic Instructions                                                 //
  // ---------------------------------------------------------------------- //

  private instructionAdd(args: readonly number[]): void {
    const a0 = fromUnsignedWordToSignedInt(args[0]!)
    const a1 = fromUnsignedWordToSignedInt(args[1]!)
    this.processor.store(fromSignedIntToUnsignedWord(a0 + a1))
  }

  private instructionSub(args: readonly number[]): void {
    const a0 = fromUnsignedWordToSignedInt(args[0]!)
    const a1 = fromUnsignedWordToSignedInt(args[1]!)
    this.processor.store(fromSignedIntToUnsignedWord(a0 - a1))
  }

  private instructionMul(args: readonly number[]): void {
    const a0 = fromUnsignedWordToSignedInt(args[0]!)
    const a1 = fromUnsignedWordToSignedInt(args[1]!)
    this.processor.store(fromSignedIntToUnsignedWord(a0 * a1))
  }

  private instructionDiv(args: readonly number[]): void {
    const a0 = fromUnsignedWordToSignedInt(args[0]!)
    const a1 = fromUnsignedWordToSignedInt(args[1]!)
    this.processor.store(fromSignedIntToUnsignedWord(Math.trunc(a0 / a1)))
  }

  private instructionMod(args: readonly number[]): void {
    const a0 = fromUnsignedWordToSignedInt(args[0]!)
    const a1 = fromUnsignedWordToSignedInt(args[1]!)
    const result = a0 - Math.trunc(a0 / a1) * a1 // truncate-towards-zero, not floor
    this.processor.store(fromSignedIntToUnsignedWord(result))
  }

  private instructionOr(args: readonly number[]): void {
    this.processor.store(args[0]! | args[1]!)
  }

  private instructionAnd(args: readonly number[]): void {
    this.processor.store(args[0]! & args[1]!)
  }

  private instructionNot(args: readonly number[]): void {
    this.processor.store(~args[0]! & 0xffff)
  }

  // ---------------------------------------------------------------------- //
  // Branch Instructions                                                     //
  // ---------------------------------------------------------------------- //

  private instructionJe(args: readonly number[]): void {
    let matched = false
    for (let i = 1; i < args.length; i++) if (args[0] === args[i]) matched = true
    this.processor.branch(matched)
  }

  private instructionJz(args: readonly number[]): void {
    this.processor.branch(args[0] === 0)
  }

  private instructionJl(args: readonly number[]): void {
    const a0 = fromUnsignedWordToSignedInt(args[0]!)
    const a1 = fromUnsignedWordToSignedInt(args[1]!)
    this.processor.branch(a0 < a1)
  }

  private instructionJg(args: readonly number[]): void {
    const a0 = fromUnsignedWordToSignedInt(args[0]!)
    const a1 = fromUnsignedWordToSignedInt(args[1]!)
    this.processor.branch(a0 > a1)
  }

  private instructionJin(args: readonly number[]): void {
    const child = args[0]!
    const parent = args[1]!
    if (child === 0) {
      this.processor.branch(parent === 0)
    } else {
      const childEntry = this.processor.objectTable.getObjectTableEntry(child)!
      this.processor.branch(childEntry.getParentObjectNumber() === parent)
    }
  }

  private instructionTest(args: readonly number[]): void {
    this.processor.branch((args[0]! & args[1]!) === args[1])
  }

  private instructionTestAttr(args: readonly number[]): void {
    const entry = this.processor.objectTable.getObjectTableEntry(args[0]!)!
    this.processor.branch(entry.testAttr(args[1]!) !== 0)
  }

  private instructionDecChk(args: readonly number[]): void {
    const result = this.processor.adjustVariable(args[0]!, -1)
    this.processor.branch(result < fromUnsignedWordToSignedInt(args[1]!))
  }

  private instructionIncChk(args: readonly number[]): void {
    const result = this.processor.adjustVariable(args[0]!, 1)
    this.processor.branch(result > fromUnsignedWordToSignedInt(args[1]!))
  }

  private instructionVerify(_args: readonly number[]): void {
    this.processor.branch(true)
  }

  private instructionPiracy(_args: readonly number[]): void {
    this.processor.branch(true)
  }

  // ---------------------------------------------------------------------- //
  // Return Instructions                                                     //
  // ---------------------------------------------------------------------- //

  private instructionRet(args: readonly number[]): void {
    this.processor.ret(args[0]!)
  }

  private instructionRtrue(_args: readonly number[]): void {
    this.processor.ret(1)
  }

  private instructionRfalse(_args: readonly number[]): void {
    this.processor.ret(0)
  }

  private instructionRetPopped(_args: readonly number[]): void {
    this.processor.ret(this.processor.stack.popWord())
  }

  // ---------------------------------------------------------------------- //
  // Jump / Variable Instructions                                            //
  // ---------------------------------------------------------------------- //

  private instructionJump(args: readonly number[]): void {
    this.processor.jump(fromUnsignedWordToSignedInt(args[0]!) - 2)
  }

  private instructionInc(args: readonly number[]): void {
    this.processor.adjustVariable(args[0]!, 1)
  }

  private instructionDec(args: readonly number[]): void {
    this.processor.adjustVariable(args[0]!, -1)
  }

  private instructionLoad(args: readonly number[]): void {
    const variable = args[0]!
    let value: number
    if (variable === 0) value = this.processor.stack.peekWord()
    else if (variable < 16) value = this.processor.stack.readLocal(variable)
    else value = this.processor.globals.readGlobal(variable - 16)
    this.processor.store(value)
  }

  private instructionPush(args: readonly number[]): void {
    this.processor.stack.pushWord(args[0]!)
  }

  private instructionPull(args: readonly number[]): void {
    this.processor.pull(args[0]!)
  }

  private instructionPop(_args: readonly number[]): void {
    this.processor.stack.popWord()
  }

  // ---------------------------------------------------------------------- //
  // Object Instructions                                                     //
  // ---------------------------------------------------------------------- //

  private instructionSetAttr(args: readonly number[]): void {
    this.processor.objectTable.getObjectTableEntry(args[0]!)!.setAttr(args[1]!)
  }

  private instructionClearAttr(args: readonly number[]): void {
    this.processor.objectTable.getObjectTableEntry(args[0]!)!.clearAttr(args[1]!)
  }

  private instructionInsertObj(args: readonly number[]): void {
    this.processor.objectTable.insertObject(args[0]!, args[1]!)
  }

  private instructionRemoveObject(args: readonly number[]): void {
    this.processor.objectTable.removeObject(args[0]!)
  }

  private instructionGetParent(args: readonly number[]): void {
    const entry = this.processor.objectTable.getObjectTableEntry(args[0]!)!
    this.processor.store(entry.getParentObjectNumber())
  }

  private instructionGetChild(args: readonly number[]): void {
    let firstChild: number
    if (args[0] === 0) firstChild = 0
    else firstChild = this.processor.objectTable.getObjectTableEntry(args[0]!)!.getChildObjectNumber()
    this.processor.store(firstChild)
    this.processor.branch(firstChild !== 0)
  }

  private instructionGetSibling(args: readonly number[]): void {
    let nextSibling: number
    if (args[0] === 0) nextSibling = 0
    else nextSibling = this.processor.objectTable.getObjectTableEntry(args[0]!)!.getNextSiblingObjectNumber()
    this.processor.store(nextSibling)
    this.processor.branch(nextSibling !== 0)
  }

  private instructionPrintObj(args: readonly number[]): void {
    const entry = this.processor.objectTable.getObjectTableEntry(args[0]!)!
    this.printStr(entry.getPropertyTable().getDescription())
  }

  private instructionPutProp(args: readonly number[]): void {
    const entry = this.processor.objectTable.getObjectTableEntry(args[0]!)!
    const prop = entry.getPropertyTable().getPropertyTableEntryForPropertyNumber(args[1]!)!
    prop.putValue(args[2]!)
  }

  private instructionGetProp(args: readonly number[]): void {
    if (args[0] === 0) {
      this.processor.store(0)
    } else {
      const entry = this.processor.objectTable.getObjectTableEntry(args[0]!)!
      const prop = entry.getPropertyTable().getPropertyTableEntryForPropertyNumber(args[1]!)
      const value = prop === null ? this.processor.objectTable.getPropertyDefault(args[1]!) : prop.getValue()
      this.processor.store(value)
    }
  }

  private instructionGetPropAddr(args: readonly number[]): void {
    if (args[0] === 0) {
      this.processor.store(0)
    } else {
      const mask = this.processor.gameVersion >= 4 ? 0x3f : 0x1f
      const propertyNumber = args[1]! & mask
      const entry = this.processor.objectTable.getObjectTableEntry(args[0]!)!
      const prop = entry.getPropertyTable().getPropertyTableEntryForPropertyNumber(propertyNumber)
      this.processor.store(prop !== null ? prop.getDataAddress() : 0)
    }
  }

  private instructionGetPropLen(args: readonly number[]): void {
    const addr = args[0]!
    if (addr === 0) {
      this.processor.store(0)
      return
    }
    let length: number
    const sizeByte = mreadByte(this.processor.memory, addr - 1)
    if (this.processor.gameVersion <= 3) {
      length = (sizeByte >> 5) + 1
    } else {
      if (sizeByte & 0x80) {
        length = sizeByte & 0x3f
        if (length === 0) length = 64
      } else {
        length = sizeByte & 0x40 ? 2 : 1
      }
    }
    this.processor.store(length)
  }

  private instructionGetNextProp(args: readonly number[]): void {
    if (args[0] === 0) {
      this.processor.store(0)
    } else {
      const entry = this.processor.objectTable.getObjectTableEntry(args[0]!)!
      const value = entry.getPropertyTable().getPropertyTableEntryAfterPropertyNumber(args[1]!)
      this.processor.store(value === null ? 0 : value.getPropertyNumber())
    }
  }

  // ---------------------------------------------------------------------- //
  // Print Instructions                                                      //
  // ---------------------------------------------------------------------- //

  private instructionPrint(_args: readonly number[]): void {
    const embeddedStringAddress = this.processor.getPc()
    const s = toZString(embeddedStringAddress, this.processor.memory, this.processor.abbreviationTable)
    while (true) {
      const value = this.processor.getWordAndAdvance()
      if (value & 0x8000) break
    }
    this.printStr(s)
  }

  private instructionPrintRet(_args: readonly number[]): void {
    const embeddedStringAddress = this.processor.getPc()
    const s = toZString(embeddedStringAddress, this.processor.memory, this.processor.abbreviationTable)
    while (true) {
      const value = this.processor.getWordAndAdvance()
      if (value & 0x8000) break
    }
    this.printStr(s)
    this.printStr('\n')
    this.processor.ret(1)
  }

  private instructionPrintPaddr(args: readonly number[]): void {
    const zstringAddress = this.processor.packedAddress(args[0]!)
    this.printStr(toZString(zstringAddress, this.processor.memory, this.processor.abbreviationTable))
  }

  private instructionPrintAddr(args: readonly number[]): void {
    this.printStr(toZString(args[0]!, this.processor.memory, this.processor.abbreviationTable))
  }

  private instructionPrintChar(args: readonly number[]): void {
    this.printChar(singleZSCIIChar(args[0]!))
  }

  private instructionPrintNum(args: readonly number[]): void {
    this.printStr(String(fromUnsignedWordToSignedInt(args[0]!)))
  }

  private instructionNewLine(_args: readonly number[]): void {
    this.printStr('\n')
  }

  // ---------------------------------------------------------------------- //
  // I/O Instructions                                                         //
  // ---------------------------------------------------------------------- //

  private saveInterpUndo(): void {
    const stack = this.processor.stack
    this.interpUndoStack.push({
      pc: this.currentOpcodePc,
      memory: this.processor.memory.slice(),
      stackData: stack.stack.slice(),
      random: this.random,
      sp: stack.sp,
      fp: stack.fp,
      frameCount: stack.frameCount,
    })
    if (this.interpUndoStack.length > this.undoMaxDepth) this.interpUndoStack.shift()
  }

  private async instructionRead(args: readonly number[]): Promise<void> {
    // sread (V3) / aread (V4+)
    this.saveInterpUndo()
    this.refreshStatusLine()

    // Map tracking: check whether the command from the PREVIOUS turn caused
    // a room transition, then refresh the location baseline for this turn.
    if (this.turnObserver && this.mapPrevCommand !== null) {
      const newLoc = this.currentLocationLabel()
      if (newLoc && this.mapPrevLocation && newLoc !== this.mapPrevLocation) {
        this.turnObserver.onTurn(this.mapPrevLocation, newLoc, this.mapPrevCommand)
      }
    }
    if (this.turnObserver) {
      this.mapPrevLocation = this.currentLocationLabel()
    }

    const textAddr = args[0]!
    const parseAddr = args.length > 1 ? args[1]! : null
    const timeTenths = args.length > 2 ? args[2]! : 0
    const timeRoutine = args.length > 3 ? args[3]! : 0

    const maxChars = mreadByte(this.processor.memory, textAddr)
    let textStart: number
    if (this.processor.gameVersion >= 4) {
      textStart = textAddr + 2
      mwriteByte(this.processor.memory, textAddr + 1, 0)
    } else {
      textStart = textAddr + 1
    }

    const separators = new Set(this.dictionary.getSeparators())
    separators.add(' ')

    let inString: string
    while (true) {
      inString = (await this.getInputLine(maxChars, timeTenths, timeRoutine)).toLowerCase()
      if (this.handleMetaCommand(inString)) {
        this.screen.transcriptWrite('\n>' + inString + '\n')
        continue // meta-command handled; ask for another line
      }
      break
    }

    this.screen.transcriptWrite(inString + '\n')

    if (inString.length > maxChars - 1) inString = inString.slice(0, maxChars - 1)

    for (let index = 0; index < inString.length; index++) {
      mwriteByte(this.processor.memory, textStart + index, inString.charCodeAt(index) & 0xff)
    }
    mwriteByte(this.processor.memory, textStart + inString.length, 0)

    if (this.processor.gameVersion >= 4) {
      mwriteByte(this.processor.memory, textAddr + 1, inString.length)
    }

    if (parseAddr !== null && parseAddr !== 0) {
      mwriteByte(this.processor.memory, parseAddr + 1, 0)
      if (inString.trim()) this.tokenise(inString, parseAddr, separators)
    }

    if (this.processor.gameVersion >= 5) {
      this.processor.store(13) // V5+ aread stores terminating character; V4 sread does not
    }

    if (this.turnObserver) {
      this.mapPrevCommand = inString
    }
  }

  // ---------------------------------------------------------------------- //
  // Map tracking helpers                                                    //
  // ---------------------------------------------------------------------- //

  /**
   * Best-effort label for the player's current room, or null if it can't be
   * determined. V1-3: global 0 IS the room (Z-Machine spec section 8.2).
   * V4+: find the player object (named "yourself"/"you"/etc.) and use its
   * parent. Mirrors the Python interpreter's _current_location_str.
   */
  private currentLocationLabel(): string | null {
    try {
      const objectCount = this.processor.objectTable.objectCount
      if (this.processor.gameVersion <= 3) {
        const num = this.processor.globals.readGlobal(0)
        return this.objLocationLabel(num, objectCount)
      }

      const playerNum = this.findPlayerObject(objectCount)
      if (playerNum) {
        const player = this.processor.objectTable.getObjectTableEntry(playerNum)
        const roomNum = player?.getParentObjectNumber() ?? 0
        if (roomNum) {
          const room = this.processor.objectTable.getObjectTableEntry(roomNum)
          const name = room?.getPropertyTable().getDescription().trim()
          if (name) return `${roomNum}: ${name}`
        }
      }
      return null
    } catch {
      return null
    }
  }

  private objLocationLabel(objNum: number, objectCount: number): string | null {
    if (objNum < 1 || objNum > objectCount) return null
    const obj = this.processor.objectTable.getObjectTableEntry(objNum)
    if (!obj) return null
    const name = obj.getPropertyTable().getDescription().trim()
    return name.length >= 4 ? `${objNum}: ${name}` : null
  }

  /**
   * Scans the object table once for candidate player objects (named
   * "yourself", "you", etc.), then picks whichever currently has a named
   * parent (the room it's standing in). Only caches permanently once a
   * confirmed live player is found, matching the Python original.
   */
  private findPlayerObject(objectCount: number): number | null {
    if (this.playerObjNum !== null) return this.playerObjNum

    if (this.playerCandidates === null) {
      this.playerCandidates = []
      for (let n = 1; n <= objectCount; n++) {
        try {
          const obj = this.processor.objectTable.getObjectTableEntry(n)
          if (!obj) continue
          const desc = obj.getPropertyTable().getDescription().trim().toLowerCase()
          if (PLAYER_NAMES.has(desc)) this.playerCandidates.push(n)
        } catch {
          // Skip malformed object entries.
        }
      }
    }

    for (const n of this.playerCandidates) {
      try {
        const obj = this.processor.objectTable.getObjectTableEntry(n)
        const parentNum = obj?.getParentObjectNumber() ?? 0
        if (parentNum) {
          const p = this.processor.objectTable.getObjectTableEntry(parentNum)
          if (p && p.getPropertyTable().getDescription().trim()) {
            this.playerObjNum = n // confirmed — cache it
            return n
          }
        }
      } catch {
        // Try the next candidate.
      }
    }

    return this.playerCandidates[0] ?? null
  }

  private async instructionReadChar(args: readonly number[]): Promise<void> {
    // read_char 1 [time routine] -> (result)
    const timeTenths = args.length > 1 ? args[1]! : 0
    const timeRoutine = args.length > 2 ? args[2]! : 0

    const ch = await this.readSingleChar(timeTenths, timeRoutine)
    const zscii = ch === '\r' || ch === '\n' || ch === '' ? 13 : ch.charCodeAt(0)
    this.processor.store(zscii)
  }

  // ---------------------------------------------------------------------- //
  // Input helpers                                                            //
  // ---------------------------------------------------------------------- //

  /**
   * Handle interpreter-level commands (work regardless of game vocabulary).
   * Returns true if the line was a meta-command (caller should loop for new input).
   */
  private handleMetaCommand(line: string): boolean {
    const cmd = line.trim().split(/\s+/).filter(Boolean)
    if (cmd.length === 0) return false
    const verb = cmd[0]

    if (verb === 'undo' && cmd.length === 1) {
      // saveInterpUndo() fires at the START of instructionRead, so the
      // most-recent snapshot is the *current* state (saved moments ago before
      // the user typed anything). We must discard it and restore the one
      // before it, which represents the state at the previous turn.
      if (this.interpUndoStack.length < 2) {
        this.screen.printStr('[Nothing to undo.]\n')
        return true
      }
      this.interpUndoStack.pop() // discard current-state snapshot
      const s = this.interpUndoStack.pop()!
      this.processor.memory.set(s.memory)
      const stack = this.processor.stack
      stack.stack.set(s.stackData)
      stack.sp = s.sp
      stack.fp = s.fp
      stack.frameCount = s.frameCount
      this.processor.setPc(s.pc)
      if (!this.undoRandomContinue) this.random = s.random
      // Clear only the status bar (upper window) — it still shows the
      // location we just undid. The lower window is untouched. The game
      // redraws the status bar correctly on the next turn.
      this.screen.eraseWindow(1)
      this.screen.printStr('\n[Undone.]\n\n> ')
      throw new UndoPerformed()
    }

    if (verb === '#help') {
      this.screen.printStr('[Interpreter commands:\n  undo    Undo last move\n  #help   Show this list\n]\n')
      return true
    }

    return false
  }

  private async getInputLine(maxChars: number, timeTenths: number, timeRoutine: number): Promise<string> {
    const cb = timeTenths && timeRoutine ? () => this.processor.callAndRun(timeRoutine, []) : undefined
    return this.screen.readLine(maxChars, timeTenths, cb)
  }

  private async readSingleChar(timeTenths: number, timeRoutine: number): Promise<string> {
    const cb = timeTenths && timeRoutine ? () => this.processor.callAndRun(timeRoutine, []) : undefined
    return this.screen.readChar(timeTenths, cb)
  }

  /** Parse in_string into words and write to the parse buffer according to Z-machine spec. */
  private tokenise(inString: string, parseAddr: number, separators: Set<string>): void {
    const maxTokens = mreadByte(this.processor.memory, parseAddr)
    mwriteByte(this.processor.memory, parseAddr + 1, 0)

    const words: Array<[string, number]> = []
    let currentWord = ''
    let inWord = false

    for (let i = 0; i < inString.length; i++) {
      const c = inString[i]!
      if (separators.has(c)) {
        if (inWord) {
          words.push([currentWord, i - currentWord.length])
          currentWord = ''
          inWord = false
        }
      } else {
        currentWord += c
        inWord = true
      }
    }
    if (inWord) words.push([currentWord, inString.length - currentWord.length])

    const truncatedWords = words.slice(0, maxTokens)

    mwriteByte(this.processor.memory, parseAddr + 1, truncatedWords.length)

    const tokenDataStart = parseAddr + 2
    const keyWords = this.dictionary.dictionaryEntryKeyWords
    // Position in parse buffer counts from start of text_buf:
    // V1-3: text starts at byte 1, so offset = 1
    // V4+:  text starts at byte 2 (byte 1 is the length count), so offset = 2
    const textOffset = this.processor.gameVersion >= 4 ? 2 : 1

    truncatedWords.forEach(([word, startPos], i) => {
      const tokenAddr = tokenDataStart + i * 4
      const encodedZstring = convertToEncodedWords(word, keyWords)
      const dictAddr = this.dictionary.findPhrase(encodedZstring) ?? 0
      mwriteWord(this.processor.memory, tokenAddr, dictAddr)
      mwriteByte(this.processor.memory, tokenAddr + 2, word.length)
      mwriteByte(this.processor.memory, tokenAddr + 3, startPos + textOffset)
    })
  }

  private instructionRandom(args: readonly number[]): void {
    const rangeVal = fromUnsignedWordToSignedInt(args[0]!)
    if (rangeVal < 0) {
      this.random = Math.abs(rangeVal)
      this.processor.store(0)
    } else if (rangeVal === 0) {
      this.random = Math.floor(Date.now() / 1000) & 0x7fffffff
      this.processor.store(0)
    } else {
      this.random = (this.random * 0x343fd + 0x269ec3) & 0x7fffffff
      const n = (this.random >> 16) & 0x7fff
      this.processor.store((n % rangeVal) + 1)
    }
  }

  private instructionScanTable(args: readonly number[]): void {
    const x = args[0]!
    const table = args[1]!
    const length = args[2]!
    const form = args.length > 3 ? args[3]! : 0x82

    let fieldLen = form >> 8 !== 0 ? form >> 8 : form & 0x7f
    if (fieldLen === 0) fieldLen = 2
    const wordCompare = (form & 0x80) !== 0

    let foundAddr = 0
    for (let i = 0; i < length; i++) {
      const addr = table + i * fieldLen
      const val = wordCompare ? mreadWord(this.processor.memory, addr) : mreadByte(this.processor.memory, addr)
      if (val === x) {
        foundAddr = addr
        break
      }
    }

    this.processor.store(foundAddr)
    this.processor.branch(foundAddr !== 0)
  }

  private instructionCheckArgCount(args: readonly number[]): void {
    const argNumber = args[0]!
    const details = this.processor.stack.stack[this.processor.stack.fp - 4]!
    const supplied = details & 0x00ff
    this.processor.branch(argNumber <= supplied)
  }

  // ---------------------------------------------------------------------- //
  // Save / Restore                                                           //
  // ---------------------------------------------------------------------- //

  private async readAuxLine(prompt: string): Promise<string> {
    this.screen.printStr(prompt)
    this.screen.refresh()
    return (await this.screen.readLine(128)).trim()
  }

  /** Write the resolved filename/slot name to the transcript as a >-prefixed line. */
  private echoAuxLine(text: string): void {
    if (text) this.screen.transcriptWrite('\n> ' + text + '\n')
  }

  private async instructionSave(_args: readonly number[]): Promise<void> {
    const inString = (await this.readAuxLine('Save to file: ')) || 'save.qzl'
    this.echoAuxLine(inString)

    if (!this.saveHandler) {
      this.screen.printStr('\n[Saving is not available in this session.]\n')
      this.processor.saveFailed()
      return
    }

    try {
      const q = new Quetzal(this.processor.filename, this.processor.pristineMemory)
      const bytes = q.writeQuetzalSave(this.processor.memory, this.processor.purbot, this.processor.stack, this.processor.getPc())
      await this.saveHandler.save(bytes, inString)
      this.lastSavePath = inString
      this.processor.saveSucceeded()
    } catch (e) {
      this.screen.printStr(`\n[Save failed: ${e instanceof Error ? e.message : e}]\n`)
      this.processor.saveFailed()
    }
  }

  private async instructionRestore(_args: readonly number[]): Promise<void> {
    const inString = (await this.readAuxLine('Restore from file: ')) || 'save.qzl'
    this.echoAuxLine(inString)

    if (!this.saveHandler) {
      this.screen.printStr('\n[Restoring is not available in this session.]\n')
      this.processor.saveFailed()
      return
    }

    try {
      const bytes = await this.saveHandler.restore(inString)
      if (!bytes) {
        this.screen.printStr(`\n[Save not found: ${inString}]\n`)
        this.processor.saveFailed()
        return
      }
      const q = new Quetzal(this.processor.filename, this.processor.pristineMemory)
      q.setSaveData(bytes)
      q.processFile()
      this.processor.restore(q.gameData, q.newStack, q.restorePc)
    } catch (e) {
      this.screen.printStr(`\n[Restore failed: ${e instanceof Error ? e.message : e}]\n`)
      this.processor.saveFailed()
    }
  }

  // ---------------------------------------------------------------------- //
  // Display / Window Instructions                                           //
  // ---------------------------------------------------------------------- //

  private instructionSplitWindow(args: readonly number[]): void {
    this.screen.splitWindow(args[0]!)
  }

  private instructionSetWindow(args: readonly number[]): void {
    this.screen.setWindow(args[0]!)
  }

  private instructionEraseWindow(args: readonly number[]): void {
    const win = fromUnsignedWordToSignedInt(args[0]!)
    this.screen.eraseWindow(win)
  }

  private instructionEraseLine(_args: readonly number[]): void {
    this.screen.eraseLine()
  }

  private instructionSetCursor(args: readonly number[]): void {
    const row = args[0]!
    const col = args.length > 1 ? args[1]! : 1
    this.screen.setCursor(row, col)
  }

  private instructionGetCursor(args: readonly number[]): void {
    const [row, col] = this.screen.getCursor()
    const arrayAddr = args[0]!
    mwriteWord(this.processor.memory, arrayAddr, row)
    mwriteWord(this.processor.memory, arrayAddr + 2, col)
  }

  private instructionSetTextStyle(args: readonly number[]): void {
    this.screen.setTextStyle(args[0]!)
  }

  private instructionSetColour(args: readonly number[]): void {
    const fg = args.length > 0 ? args[0]! : 1
    const bg = args.length > 1 ? args[1]! : 1
    this.screen.setColour(fg, bg)
  }

  private instructionBufferMode(_args: readonly number[]): void {
    // Buffering is handled transparently by Screen.
  }

  private instructionShowStatus(_args: readonly number[]): void {
    this.refreshStatusLine()
  }

  /**
   * V1-3 only: redraw the interpreter-drawn status line from globals.
   *
   * Global 0 holds the current location object; global 1/2 hold either
   * score/turns or hours/minutes, selected by Flags1 bit 1 (set by the game
   * in the header, e.g. Deadline's real-time clock vs. Zork's score).
   * V4+ games manage their own upper window instead (see splitWindow).
   */
  private refreshStatusLine(): void {
    if (this.processor.gameVersion > 3) return
    if (this.processor.gameVersion === 3 && this.processor.memory[0x01]! & 0x10) {
      return // header bit 4 set: game declares the status line unavailable
    }

    const globals = this.processor.globals
    let location = ''
    const locObj = globals.readGlobal(0)
    if (locObj) {
      try {
        const entry = this.processor.objectTable.getObjectTableEntry(locObj)
        location = entry ? entry.getPropertyTable().getDescription() : ''
      } catch {
        location = ''
      }
    }

    const timeFormat = (this.processor.memory[0x01]! & 0x02) !== 0
    let rightText: string
    if (timeFormat) {
      const hours = fromUnsignedWordToSignedInt(globals.readGlobal(1))
      const minutes = fromUnsignedWordToSignedInt(globals.readGlobal(2))
      const suffix = hours < 12 ? 'am' : 'pm'
      let displayHour = hours % 12
      if (displayHour === 0) displayHour = 12
      rightText = `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`
    } else {
      const score = fromUnsignedWordToSignedInt(globals.readGlobal(1))
      const turns = globals.readGlobal(2)
      rightText = `Score: ${score}  Moves: ${turns}`
    }

    this.screen.updateStatusLine(location, rightText)
  }

  private instructionSoundEffect(_args: readonly number[]): void {
    // No-op: sound data requires a Blorb resource file.
  }

  private instructionNop(_args: readonly number[]): void {
    // Intentionally does nothing.
  }

  // ---------------------------------------------------------------------- //
  // Output / Input Stream                                                    //
  // ---------------------------------------------------------------------- //

  private instructionOutputStream(args: readonly number[]): void {
    const stream = fromUnsignedWordToSignedInt(args[0]!)
    if (stream === 1) {
      this.stream1Active = true
    } else if (stream === -1) {
      this.stream1Active = false
    } else if (stream === 3) {
      const tableAddr = args.length > 1 ? args[1]! : 0
      this.stream3Stack.push([tableAddr, 0])
      mwriteWord(this.processor.memory, tableAddr, 0)
    } else if (stream === -3) {
      if (this.stream3Stack.length > 0) this.stream3Stack.pop()
    }
    // stream 2/-2 (transcript enable/disable): handled by the browser UI's own transcript toggle.
  }

  private instructionInputStream(_args: readonly number[]): void {
    // Switches between input stream 0 (keyboard) and 1 (script playback). No
    // V1-3 Infocom game calls this from Z-code in normal play; nothing to do.
  }

  // ---------------------------------------------------------------------- //
  // Extended Opcodes                                                         //
  // ---------------------------------------------------------------------- //

  private instructionLogShift(args: readonly number[]): void {
    const number_ = args[0]!
    const places = fromUnsignedWordToSignedInt(args[1]!)
    const result = places >= 0 ? (number_ << places) & 0xffff : (number_ >>> -places) & 0xffff
    this.processor.store(result)
  }

  private instructionArtShift(args: readonly number[]): void {
    const number_ = fromUnsignedWordToSignedInt(args[0]!)
    const places = fromUnsignedWordToSignedInt(args[1]!)
    const result = places >= 0 ? number_ << places : number_ >> -places
    this.processor.store(fromSignedIntToUnsignedWord(result))
  }

  private instructionSetFont(_args: readonly number[]): void {
    this.processor.store(1)
  }

  private instructionSaveUndo(_args: readonly number[]): void {
    const stack = this.processor.stack
    this.undoStack.push({
      pc: this.processor.pc,
      memory: this.processor.memory.slice(),
      stackData: stack.stack.slice(),
      random: this.random,
      sp: stack.sp,
      fp: stack.fp,
      frameCount: stack.frameCount,
    })
    if (this.undoStack.length > this.undoMaxDepth) this.undoStack.shift() // discard oldest
    this.processor.store(1)
  }

  private instructionRestoreUndo(_args: readonly number[]): void {
    const s = this.undoStack.pop()
    if (!s) {
      this.processor.store(0)
      return
    }
    this.processor.memory.set(s.memory)
    const stack = this.processor.stack
    stack.stack.set(s.stackData)
    stack.sp = s.sp
    stack.fp = s.fp
    stack.frameCount = s.frameCount
    this.processor.setPc(s.pc)
    this.processor.store(2)
  }

  // ---------------------------------------------------------------------- //
  // Misc                                                                      //
  // ---------------------------------------------------------------------- //

  private instructionQuit(_args: readonly number[]): void {
    throw new QuitRequested()
  }

  private instructionRestart(_args: readonly number[]): void {
    throw new RestartRequested()
  }
}
