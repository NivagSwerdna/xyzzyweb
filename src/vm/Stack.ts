/**
 * push_fp/pop_fp use an intentional fp-1/fp+1 convention that the Quetzal
 * frame walk (build_stks/process_stks) depends on — preserve exactly.
 */
export class Stack {
  readonly stackSize = 1024
  readonly stack = new Uint32Array(1024)
  sp = 1024
  fp = 1024
  frameCount = 0

  pushWord(value: number): void {
    this.sp -= 1
    this.stack[this.sp] = value
  }

  popWord(): number {
    const value = this.stack[this.sp]!
    this.sp += 1
    return value
  }

  peekWord(): number {
    return this.stack[this.sp]!
  }

  pushFp(): void {
    this.pushWord(this.fp - 1)
  }

  popFp(): void {
    this.fp = this.popWord() + 1
  }

  markFrame(): void {
    this.fp = this.sp
    this.frameCount += 1
  }

  unmarkFrame(): void {
    this.sp = this.fp
    this.frameCount -= 1
  }

  fixupFrame(localVarCount: number): void {
    this.stack[this.fp] = this.stack[this.fp]! | (localVarCount << 8)
  }

  // local_number 1..15, since fp points to stack element before locals... fp+1 is first local
  readLocal(localNumber: number): number {
    return this.stack[this.fp - localNumber]!
  }

  writeLocal(localNumber: number, value: number): void {
    this.stack[this.fp - localNumber] = value
  }
}
