#!/usr/bin/env node
// One-off/maintenance script: XOR-obfuscates the story files (every byte
// XOR 0xFF, which is its own inverse) and writes them under opaque
// filenames, so a plain download or directory listing doesn't hand anyone
// a byte-identical, immediately-usable copy of a copyrighted game file.
// This is NOT real protection (XOR 0xFF is trivial to reverse for anyone
// who looks at the client code) -- it just stops the most casual case:
// right-click-save / `curl`-ing the site and getting a working ZORK1.DAT.
//
// Run with: node scripts/obfuscate-data.mjs
// Source files stay in data-source/ (gitignored); output goes to public/data/.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sourceDir = path.join(root, 'data-source')
const outDir = path.join(root, 'public', 'data')

// Opaque output filenames -- deliberately unrelated to the game titles.
const FILES = [
  { source: 'ZORK1.DAT', out: '2c91.bin' },
  { source: 'ZORK2.DAT', out: '7a44.bin' },
  { source: 'ZORK3.DAT', out: 'e619.bin' },
  { source: 'DEADLINE.DAT', out: 'b053.bin' },
  { source: 'TRINITY.DAT', out: 'f8d2.bin' },
]

function xorFF(buf) {
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ 0xff
  return out
}

mkdirSync(outDir, { recursive: true })

for (const { source, out } of FILES) {
  const inPath = path.join(sourceDir, source)
  const outPath = path.join(outDir, out)
  const data = readFileSync(inPath)
  writeFileSync(outPath, xorFF(data))
  console.log(`${source} -> public/data/${out} (${data.length} bytes)`)
}
