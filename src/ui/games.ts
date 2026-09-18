export interface GameEntry {
  id: string
  title: string
  /** Filename served from public/data/. */
  file: string
  /** Whether `file` is XOR-0xFF obfuscated (see xorFF) and needs decoding after fetch. */
  obfuscated: boolean
}

// This deployment only ever ships obfuscated story files -- see
// scripts/obfuscate-data.mjs -- but the loader in app.ts honors this flag
// per game, so a plain (non-obfuscated) file can still be dropped in
// (e.g. for local testing, or a game that's genuinely freeware) without
// code changes.
export const GAMES: GameEntry[] = [
  { id: 'zork1', title: 'Zork I: The Great Underground Empire', file: '2c91.bin', obfuscated: true },
  { id: 'zork2', title: 'Zork II: The Wizard of Frobozz', file: '7a44.bin', obfuscated: true },
  { id: 'zork3', title: 'Zork III: The Dungeon Master', file: 'e619.bin', obfuscated: true },
  { id: 'deadline', title: 'Deadline', file: 'b053.bin', obfuscated: true },
  { id: 'trinity', title: 'Trinity', file: 'f8d2.bin', obfuscated: true },
]

/**
 * XOR every byte with 0xFF -- its own inverse, so the same function both
 * produces public/data/*.bin (see scripts/obfuscate-data.mjs) and decodes
 * it back to real Z-code bytes after fetching. This is NOT real protection
 * -- anyone reading this file can reverse it in one line -- it just stops
 * the most casual case: right-click-save or `curl`-ing the site and getting
 * a working copy of a copyrighted game file for free.
 */
export function xorFF(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ 0xff
  return out
}
