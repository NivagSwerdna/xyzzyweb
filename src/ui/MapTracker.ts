import type { TurnObserver } from '../vm/Instructions'

export interface MapEdge {
  from: string
  to: string
  command: string
}

interface StoredMap {
  edges: MapEdge[]
}

function storageKey(gameId: string): string {
  return `xyzzyweb:map:${gameId}`
}

/**
 * Tracks room-to-room transitions as the player explores (fed by
 * Instructions' turnObserver hook), persisted per-game in localStorage so
 * the map survives reloads. The web equivalent of the Python interpreter's
 * "#map <file>" transition log.
 */
export class MapTracker implements TurnObserver {
  private edges: MapEdge[] = []
  private readonly listeners = new Set<() => void>()
  private readonly gameId: string

  constructor(gameId: string) {
    this.gameId = gameId
    this.load()
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(storageKey(this.gameId))
      if (raw) {
        const parsed = JSON.parse(raw) as StoredMap
        if (Array.isArray(parsed.edges)) this.edges = parsed.edges
      }
    } catch {
      // Corrupt or unavailable storage: start fresh rather than fail.
    }
  }

  private persist(): void {
    try {
      const payload: StoredMap = { edges: this.edges }
      localStorage.setItem(storageKey(this.gameId), JSON.stringify(payload))
    } catch {
      // Storage full/unavailable (e.g. private browsing): keep going in-memory.
    }
  }

  onTurn(fromLocation: string | null, toLocation: string | null, command: string): void {
    if (!fromLocation || !toLocation) return
    const exists = this.edges.some((e) => e.from === fromLocation && e.to === toLocation && e.command === command)
    if (exists) return
    this.edges.push({ from: fromLocation, to: toLocation, command })
    this.persist()
    this.notify()
  }

  getEdges(): readonly MapEdge[] {
    return this.edges
  }

  getNodes(): string[] {
    const nodes = new Set<string>()
    for (const e of this.edges) {
      nodes.add(e.from)
      nodes.add(e.to)
    }
    return [...nodes]
  }

  clear(): void {
    this.edges = []
    this.persist()
    this.notify()
  }

  /** Subscribe to graph growth; returns an unsubscribe function. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }

  /** Plain-text edge list (from\tto\tcommand per line), for the map download. */
  toText(): string {
    return this.edges.map((e) => `${e.from}\t${e.to}\t${e.command}`).join('\n')
  }
}
