import type { SaveHandler } from '../vm/Instructions'

const DB_NAME = 'xyzzyweb'
const DB_VERSION = 1
const STORE = 'saves'

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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(bytes, this.key(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error as unknown)
    })
  }

  async restore(slot: string): Promise<Uint8Array | null> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(this.key(slot))
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null)
      req.onerror = () => reject(req.error as unknown)
    })
  }
}
