function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  if (className) b.className = className
  b.addEventListener('click', onClick)
  return b
}

/** Mounts a "Quit to Menu" button into `root`. */
export function mountGameControls(root: HTMLElement, onQuit: () => void): void {
  const bar = document.createElement('div')
  bar.className = 'save-toolbar'
  bar.append(button('Quit to Menu', onQuit, 'quit-button'))
  root.append(bar)
}
