import { ipcRenderer } from 'electron'

let currentStatus = 'Iniciando caballocci'
let statusElement: HTMLElement | null = null

function renderStatus() {
  statusElement = document.querySelector<HTMLElement>('[data-splash-status]')
  if (statusElement) statusElement.textContent = currentStatus
}

window.addEventListener('DOMContentLoaded', renderStatus, { once: true })

ipcRenderer.on('splash:status', (_event, status: unknown) => {
  if (typeof status !== 'string' || status.length > 100) return
  currentStatus = status
  if (statusElement?.isConnected) statusElement.textContent = currentStatus
  else renderStatus()
})
