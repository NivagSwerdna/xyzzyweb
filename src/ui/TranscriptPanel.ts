import type { DomScreen } from '../screen/DomScreen'
import { downloadText } from './download'

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

/**
 * Mounts a "View Transcript" toggle (a read-only, live-updating copy of
 * everything printed so far) and a "Download Transcript" button into `root`.
 */
export function mountTranscriptControls(root: HTMLElement, screen: DomScreen, gameTitle: string): void {
  const bar = document.createElement('div')
  bar.className = 'save-toolbar'

  const viewer = document.createElement('pre')
  viewer.className = 'transcript-viewer'
  viewer.hidden = true

  const refreshViewer = (): void => {
    viewer.textContent = screen.getTranscript()
    viewer.scrollTop = viewer.scrollHeight
  }

  screen.onTranscriptChange(() => {
    if (!viewer.hidden) refreshViewer()
  })

  const viewToggle = button('View Transcript', () => {
    viewer.hidden = !viewer.hidden
    if (!viewer.hidden) refreshViewer()
  })

  const downloadBtn = button('Download Transcript', () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadText(`${gameTitle.replace(/[^a-z0-9]+/gi, '-')}-transcript-${stamp}.txt`, screen.getTranscript())
  })

  bar.append(viewToggle, downloadBtn)

  root.append(bar, viewer)
}
