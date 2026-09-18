import { downloadText } from './download'
import { layoutGraph, type Point } from './graphLayout'
import type { MapTracker } from './MapTracker'

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  if (className) b.className = className
  b.addEventListener('click', onClick)
  return b
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const WIDTH = 760
const HEIGHT = 480

/** Labels are "N: Name" or "Obj#N: Name" (see Instructions.currentLocationLabel) — show just the name. */
function roomName(label: string): string {
  const idx = label.indexOf(': ')
  return idx >= 0 ? label.slice(idx + 2) : label
}

/**
 * Mounts a "Map" toggle into `root` that opens an overlay with a live,
 * auto-updating force-directed graph of rooms explored so far (nodes) and
 * the commands that connect them (edges), plus a plain-text list view and
 * a download button. The web equivalent of the Python interpreter's
 * "#map"/"#remap" meta-commands.
 */
export function mountMapControls(root: HTMLElement, mapTracker: MapTracker, gameTitle: string): void {
  const bar = document.createElement('div')
  bar.className = 'save-toolbar'
  const toggleBtn = button('Map', () => {
    overlay.hidden = !overlay.hidden
    if (!overlay.hidden) renderMap()
  })
  bar.append(toggleBtn)
  root.append(bar)

  const overlay = document.createElement('div')
  overlay.className = 'map-overlay'
  overlay.hidden = true
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true
  })

  const panel = document.createElement('div')
  panel.className = 'map-panel'

  const header = document.createElement('div')
  header.className = 'map-panel-header'
  const title = document.createElement('h2')
  title.textContent = `Map — ${gameTitle}`
  const closeBtn = button('Close', () => {
    overlay.hidden = true
  })
  header.append(title, closeBtn)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
  svg.classList.add('map-svg')

  const list = document.createElement('pre')
  list.className = 'map-list'

  const actions = document.createElement('div')
  actions.className = 'map-actions'
  const downloadBtn = button('Download Map (text)', () => {
    downloadText(`${gameTitle.replace(/[^a-z0-9]+/gi, '-')}-map.txt`, mapTracker.toText())
  })
  const clearBtn = button('Clear Map', () => {
    mapTracker.clear()
    renderMap()
  })
  actions.append(downloadBtn, clearBtn)

  panel.append(header, svg, list, actions)
  overlay.appendChild(panel)
  root.append(overlay)

  const positions = new Map<string, Point>()

  function renderMap(): void {
    const nodes = mapTracker.getNodes()
    const edges = mapTracker.getEdges()

    svg.innerHTML = ''

    if (nodes.length === 0) {
      list.textContent = 'No rooms explored yet — move around to build the map.'
      return
    }

    layoutGraph(
      nodes,
      edges.map((e): [string, string] => [e.from, e.to]),
      positions,
      WIDTH,
      HEIGHT,
    )

    for (const e of edges) {
      const a = positions.get(e.from)
      const b = positions.get(e.to)
      if (!a || !b) continue
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', String(a.x))
      line.setAttribute('y1', String(a.y))
      line.setAttribute('x2', String(b.x))
      line.setAttribute('y2', String(b.y))
      line.setAttribute('class', 'map-edge')
      const edgeTitle = document.createElementNS(SVG_NS, 'title')
      edgeTitle.textContent = e.command
      line.appendChild(edgeTitle)
      svg.appendChild(line)
    }

    for (const n of nodes) {
      const p = positions.get(n)
      if (!p) continue
      const g = document.createElementNS(SVG_NS, 'g')
      const circle = document.createElementNS(SVG_NS, 'circle')
      circle.setAttribute('cx', String(p.x))
      circle.setAttribute('cy', String(p.y))
      circle.setAttribute('r', '6')
      circle.setAttribute('class', 'map-node')
      const label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('x', String(p.x + 9))
      label.setAttribute('y', String(p.y + 4))
      label.setAttribute('class', 'map-node-label')
      label.textContent = roomName(n)
      const nodeTitle = document.createElementNS(SVG_NS, 'title')
      nodeTitle.textContent = n
      g.append(circle, label, nodeTitle)
      svg.appendChild(g)
    }

    list.textContent = edges.map((e) => `${roomName(e.from)} --[${e.command}]--> ${roomName(e.to)}`).join('\n')
  }

  mapTracker.onChange(() => {
    if (!overlay.hidden) renderMap()
  })
}
