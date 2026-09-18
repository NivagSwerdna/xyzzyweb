export interface Point {
  x: number
  y: number
}

/**
 * Picks a position for a newly-discovered node without disturbing any
 * already-placed node (which may have been manually dragged by the
 * player — auto-layout must never override that). Starts near the average
 * position of its already-placed neighbors (or the canvas center if it has
 * none yet), then runs a short repulsion-only pass against nearby existing
 * nodes — those are treated as fixed anchors, never moved themselves — so
 * the new node doesn't land directly on top of another room.
 */
export function placeNewNode(
  newId: string,
  edges: ReadonlyArray<readonly [string, string]>,
  existingPositions: ReadonlyMap<string, Point>,
  width: number,
  height: number,
): Point {
  const neighbors: Point[] = []
  for (const [a, b] of edges) {
    if (a === newId) {
      const p = existingPositions.get(b)
      if (p) neighbors.push(p)
    } else if (b === newId) {
      const p = existingPositions.get(a)
      if (p) neighbors.push(p)
    }
  }

  let point: Point
  if (neighbors.length > 0) {
    const avgX = neighbors.reduce((s, p) => s + p.x, 0) / neighbors.length
    const avgY = neighbors.reduce((s, p) => s + p.y, 0) / neighbors.length
    const angle = Math.random() * Math.PI * 2
    point = { x: avgX + Math.cos(angle) * 90, y: avgY + Math.sin(angle) * 90 }
  } else {
    point = { x: width / 2 + (Math.random() - 0.5) * 120, y: height / 2 + (Math.random() - 0.5) * 120 }
  }

  const others = [...existingPositions.values()]
  const minDist = 80
  for (let iter = 0; iter < 60; iter++) {
    let fx = 0
    let fy = 0
    for (const o of others) {
      const dx = point.x - o.x
      const dy = point.y - o.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      if (dist < minDist) {
        const force = (minDist - dist) * 0.5
        fx += (dx / dist) * force
        fy += (dy / dist) * force
      }
    }
    point = { x: point.x + fx * 0.3, y: point.y + fy * 0.3 }
  }

  return {
    x: Math.max(24, Math.min(width - 24, point.x)),
    y: Math.max(24, Math.min(height - 24, point.y)),
  }
}
