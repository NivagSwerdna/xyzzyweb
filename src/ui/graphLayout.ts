export interface Point {
  x: number
  y: number
}

/**
 * Fruchterman-Reingold force-directed layout. `positions` is mutated in
 * place and also returned, so callers can seed new nodes near a neighbor
 * (or anywhere reasonable) and get a stable, incremental-looking layout
 * across repeated calls instead of a full re-shuffle every time a node
 * is added.
 */
export function layoutGraph(
  nodes: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
  positions: Map<string, Point>,
  width: number,
  height: number,
  iterations = 200,
): Map<string, Point> {
  for (const id of nodes) {
    if (!positions.has(id)) {
      positions.set(id, { x: width / 2 + (Math.random() - 0.5) * 40, y: height / 2 + (Math.random() - 0.5) * 40 })
    }
  }
  // Drop stale nodes (e.g. after clearing the map).
  for (const id of [...positions.keys()]) {
    if (!nodes.includes(id)) positions.delete(id)
  }

  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1))

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, Point>(nodes.map((id) => [id, { x: 0, y: 0 }]))

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        const pa = positions.get(a)!
        const pb = positions.get(b)!
        let dx = pa.x - pb.x
        let dy = pa.y - pb.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        const force = (k * k) / dist
        dx /= dist
        dy /= dist
        const da = disp.get(a)!
        const db = disp.get(b)!
        da.x += dx * force
        da.y += dy * force
        db.x -= dx * force
        db.y -= dy * force
      }
    }

    for (const [a, b] of edges) {
      const pa = positions.get(a)
      const pb = positions.get(b)
      if (!pa || !pb) continue
      let dx = pa.x - pb.x
      let dy = pa.y - pb.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      const force = (dist * dist) / k
      dx /= dist
      dy /= dist
      const da = disp.get(a)!
      const db = disp.get(b)!
      da.x -= dx * force
      da.y -= dy * force
      db.x += dx * force
      db.y += dy * force
    }

    const temp = width * 0.03 * (1 - iter / iterations)
    for (const id of nodes) {
      const d = disp.get(id)!
      const dlen = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01
      const p = positions.get(id)!
      p.x += (d.x / dlen) * Math.min(dlen, temp)
      p.y += (d.y / dlen) * Math.min(dlen, temp)
      p.x = Math.max(24, Math.min(width - 24, p.x))
      p.y = Math.max(24, Math.min(height - 24, p.y))
    }
  }

  return positions
}
