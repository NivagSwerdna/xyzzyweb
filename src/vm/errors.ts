/** Raised by the undo meta-command to unwind the driver loop cleanly. */
export class UndoPerformed extends Error {}

/** Raised by the restart opcode to unwind back to the main run loop. */
export class RestartRequested extends Error {}

/** Raised by the quit opcode; the driver loop treats this as "game over". */
export class QuitRequested extends Error {}
