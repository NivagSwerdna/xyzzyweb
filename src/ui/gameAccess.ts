/**
 * Classroom access gate: no games are shown until a recognized access code
 * is entered, unlocking progressively larger tiers of the game library.
 * This is a lightweight visibility gate for a classroom, not real security
 * -- the codes live in this file, which ships to the browser like any other
 * client-side code.
 */

const TIERS: Record<string, readonly string[]> = {
  xyzzy: ['zork1'],
  plugh: ['zork1', 'zork2', 'zork3'],
  froboz: ['zork1', 'zork2', 'zork3', 'deadline', 'trinity'],
}

const STORAGE_KEY = 'xyzzyweb:accessCode'

function normalize(code: string): string {
  return code.trim().toLowerCase()
}

/** Game ids unlocked by `code`, or an empty array if the code isn't recognized. */
export function unlockedGameIds(code: string): readonly string[] {
  return TIERS[normalize(code)] ?? []
}

function getStoredCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function setStoredCode(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // Storage unavailable: the unlock still applies for this page load.
  }
}

// Once the player explicitly changes/clears their code in this session, stop
// re-reading the URL's ?password= on every re-render — otherwise "Change
// access code" would immediately re-unlock whatever tier the page was
// originally opened with, since the query param never goes away on its own.
let ignoreQueryCode = false

export function clearStoredCode(): void {
  ignoreQueryCode = true
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear if storage isn't available anyway.
  }
}

/**
 * Resolves which games are unlocked right now: a valid `?password=` in the
 * URL takes priority and also becomes the new sticky value (so a teacher
 * can share one link per tier); otherwise falls back to whatever code was
 * entered previously on this browser.
 */
export function currentAccess(): { code: string | null; gameIds: readonly string[] } {
  if (!ignoreQueryCode) {
    const queryCode = new URLSearchParams(window.location.search).get('password')
    if (queryCode !== null) {
      const ids = unlockedGameIds(queryCode)
      if (ids.length > 0) {
        const normalized = normalize(queryCode)
        setStoredCode(normalized)
        return { code: normalized, gameIds: ids }
      }
    }
  }

  const stored = getStoredCode()
  if (stored) {
    const ids = unlockedGameIds(stored)
    if (ids.length > 0) return { code: stored, gameIds: ids }
  }

  return { code: null, gameIds: [] }
}

/** Validates and stores `code`; returns the games it unlocks (empty if not recognized). */
export function tryUnlock(code: string): readonly string[] {
  const ids = unlockedGameIds(code)
  if (ids.length > 0) setStoredCode(normalize(code))
  return ids
}
