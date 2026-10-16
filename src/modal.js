import { Modal } from 'bootstrap'

let modalElement
let modalInstance
let resolveModal
let confirmed = false

const createModal = () => {
  modalElement = document.createElement('div')
  modalElement.className = 'modal fade'
  modalElement.tabIndex = -1
  modalElement.setAttribute('aria-hidden', 'true')
  modalElement.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5" data-modal-title></h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body" data-modal-message></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-modal-cancel data-bs-dismiss="modal"></button>
          <button type="button" class="btn btn-primary" data-modal-confirm></button>
        </div>
      </div>
    </div>
  `
  document.body.append(modalElement)

  modalElement.querySelector('[data-modal-confirm]').addEventListener('click', () => {
    confirmed = true
    modalInstance.hide()
  })
  modalElement.addEventListener('hidden.bs.modal', () => {
    resolveModal?.(confirmed)
    resolveModal = undefined
  })
  modalInstance = Modal.getOrCreateInstance(modalElement)
}

export const showModal = (message, {
  title = 'Aviso',
  confirmText = 'Aceptar',
  cancelText,
} = {}) => {
  if (!modalElement) createModal()
  if (modalElement.classList.contains('show')) return Promise.resolve(false)

  confirmed = false
  modalElement.querySelector('[data-modal-title]').textContent = title
  modalElement.querySelector('[data-modal-message]').textContent = message
  modalElement.querySelector('[data-modal-confirm]').textContent = confirmText
  const cancelButton = modalElement.querySelector('[data-modal-cancel]')
  cancelButton.textContent = cancelText || 'Cancelar'
  cancelButton.hidden = !cancelText

  return new Promise((resolve) => {
    resolveModal = resolve
    modalInstance.show()
  })
}
