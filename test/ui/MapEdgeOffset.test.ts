import { describe, expect, it } from 'vitest'
import { groupEdgesByPair, shiftedEndpoints } from '../../src/ui/MapView'
import type { MapEdge } from '../../src/ui/MapTracker'

describe('map edge offsetting (reciprocal/parallel connections)', () => {
  it('groups a two-way connection ("se" A->B and "nw" B->A) together regardless of direction', () => {
    const edges: MapEdge[] = [
      { from: 'A', to: 'B', command: 'se' },
      { from: 'B', to: 'A', command: 'nw' },
    ]
    const groups = groupEdgesByPair(edges)
    expect(groups.size).toBe(1)
    expect([...groups.values()][0]).toHaveLength(2)
  })

  it('offsets reciprocal edges to opposite sides of the line instead of overlapping', () => {
    const edges: MapEdge[] = [
      { from: 'A', to: 'B', command: 'se' },
      { from: 'B', to: 'A', command: 'nw' },
    ]
    const positions = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 100, y: 0 }],
    ])
    const groups = groupEdgesByPair(edges)

    const [aStart, aEnd] = shiftedEndpoints(edges[0]!, positions, groups)!
    const [bStart, bEnd] = shiftedEndpoints(edges[1]!, positions, groups)!

    // Both edges should be shifted perpendicular to the A-B line (off the y=0
    // axis here, since A-B is horizontal), and in OPPOSITE directions.
    expect(aStart.y).not.toBe(0)
    expect(bStart.y).not.toBe(0)
    expect(Math.sign(aStart.y)).toBe(-Math.sign(bStart.y))
    expect(aStart.y).toBeCloseTo(aEnd.y)
    expect(bStart.y).toBeCloseTo(bEnd.y)

    // The "se" edge still runs A->B and "nw" still runs B->A (just shifted).
    expect(aStart.x).toBeCloseTo(0)
    expect(aEnd.x).toBeCloseTo(100)
    expect(bStart.x).toBeCloseTo(100)
    expect(bEnd.x).toBeCloseTo(0)
  })

  it('leaves a single (non-reciprocal) edge unshifted', () => {
    const edges: MapEdge[] = [{ from: 'A', to: 'B', command: 'north' }]
    const positions = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 100, y: 0 }],
    ])
    const groups = groupEdgesByPair(edges)
    const [start, end] = shiftedEndpoints(edges[0]!, positions, groups)!
    expect(start).toEqual({ x: 0, y: 0 })
    expect(end).toEqual({ x: 100, y: 0 })
  })

  it('returns null when an endpoint has no known position', () => {
    const edges: MapEdge[] = [{ from: 'A', to: 'B', command: 'north' }]
    const positions = new Map([['A', { x: 0, y: 0 }]])
    const groups = groupEdgesByPair(edges)
    expect(shiftedEndpoints(edges[0]!, positions, groups)).toBeNull()
  })
})
