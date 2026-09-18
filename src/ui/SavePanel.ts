import type { DomScreen } from '../screen/DomScreen'
import type { IndexedDbSaveHandler } from '../storage/SaveStore'

const QUICKSAVE_SLOT = 'Quicksave'

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  if (className) b.className = className
  b.addEventListener('click', onClick)
  return b
}

/**
 * Mounts a Quicksave/Quickload toolbar plus a collapsible named-slot panel
 * into `root`, driving the real SAVE/RESTORE Z-machine opcodes through
 * screen.queueCommand — this is a UI convenience over the same mechanism the
 * classic "Save to file:" prompt uses, not a separate save format.
 */
export function mountSaveControls(root: HTMLElement, screen: DomScreen, saveStore: IndexedDbSaveHandler): void {
  const bar = document.createElement('div')
  bar.className = 'save-toolbar'

  const panel = document.createElement('div')
  panel.className = 'save-panel'
  panel.hidden = true

  const quicksaveBtn = button('Quicksave', () => {
    screen.queueCommand('save')
    screen.queueCommand(QUICKSAVE_SLOT)
    setTimeout(() => void refreshPanel(), 300)
  })
  const quickloadBtn = button('Quickload', () => {
    screen.queueCommand('restore')
    screen.queueCommand(QUICKSAVE_SLOT)
  })
  const savesToggle = button('Saves…', () => {
    panel.hidden = !panel.hidden
    if (!panel.hidden) void refreshPanel()
  })

  bar.append(quicksaveBtn, quickloadBtn, savesToggle)

  async function refreshPanel(): Promise<void> {
    panel.innerHTML = ''

    const newRow = document.createElement('div')
    newRow.className = 'save-panel-new'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.placeholder = 'Save name'
    nameInput.className = 'save-panel-name-input'
    const saveAsBtn = button('Save as new', () => {
      const name = nameInput.value.trim()
      if (!name || name === QUICKSAVE_SLOT) return
      screen.queueCommand('save')
      screen.queueCommand(name)
      nameInput.value = ''
      setTimeout(() => void refreshPanel(), 300)
    })
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveAsBtn.click()
    })
    newRow.append(nameInput, saveAsBtn)
    panel.appendChild(newRow)

    const slots = (await saveStore.listSlots()).filter((s) => s.slot !== QUICKSAVE_SLOT).sort((a, b) => b.savedAt - a.savedAt)

    if (slots.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'save-panel-empty'
      empty.textContent = 'No named saves yet.'
      panel.appendChild(empty)
    }

    for (const s of slots) {
      const row = document.createElement('div')
      row.className = 'save-panel-row'

      const label = document.createElement('span')
      label.className = 'save-panel-label'
      label.textContent = `${s.slot} — ${new Date(s.savedAt).toLocaleString()}`

      const loadBtn = button('Load', () => {
        screen.queueCommand('restore')
        screen.queueCommand(s.slot)
      })
      const deleteBtn = button('Delete', () => {
        void saveStore.delete(s.slot).then(refreshPanel)
      })

      row.append(label, loadBtn, deleteBtn)
      panel.appendChild(row)
    }
  }

  root.prepend(panel)
  root.prepend(bar)
}
