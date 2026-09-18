import type { SaveHandler } from '../vm/Instructions'

const DB_NAME = 'xyzzyweb'
const DB_VERSION = 1
const STORE = 'saves'

export interface SaveSlotInfo {
  slot: string
  savedAt: number
}

interface StoredSave {
  slot: string
  savedAt: number
  bytes: Uint8Array
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error as unknown)
  })
}

/**
 * Persists Quetzal save bytes in IndexedDB, keyed by [gameId, slot] so saves
 * from different games (or different releases of the same game) never
 * collide. gameId should be derived from the game's own release number +
 * serial (see gameIdFor in app.ts), not its filename.
 */
export class IndexedDbSaveHandler implements SaveHandler {
  constructor(private readonly gameId: string) {}

  private key(slot: string): string {
    return `${this.gameId}::${slot}`
  }

  async save(bytes: Uint8Array, slot: string): Promise<void> {
    const db = await openDb()
    const record: StoredSave = { slot, savedAt: Date.now(), bytes }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record, this.key(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error as unknown)
    })
  }

  async restore(slot: string): Promise<Uint8Array | null> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(this.key(slot))
      req.onsuccess = () => {
        const value = req.result as StoredSave | Uint8Array | undefined
        if (!value) resolve(null)
        // Defensive fallback in case an older raw-bytes record is still present.
        else if (value instanceof Uint8Array) resolve(value)
        else resolve(value.bytes)
      }
      req.onerror = () => reject(req.error as unknown)
    })
  }

  async delete(slot: string): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(this.key(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error as unknown)
    })
  }

  /** All save slots for this game, for a save-management panel. */
  async listSlots(): Promise<SaveSlotInfo[]> {
    const db = await openDb()
    const prefix = this.key('')
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const results: SaveSlotInfo[] = []
      const req = tx.objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(results)
          return
        }
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          const value = cursor.value as StoredSave | Uint8Array
          if (!(value instanceof Uint8Array)) {
            results.push({ slot: value.slot, savedAt: value.savedAt })
          }
        }
        cursor.continue()
      }
      req.onerror = () => reject(req.error as unknown)
    })
  }
}
