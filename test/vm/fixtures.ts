import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const testDir = path.dirname(fileURLToPath(import.meta.url))

export function loadGame(fileName: string): Uint8Array {
  const filePath = path.resolve(testDir, '../../public/data', fileName)
  return new Uint8Array(readFileSync(filePath))
}
