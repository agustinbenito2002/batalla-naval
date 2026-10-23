import { useCallback, useEffect, useRef, useState } from 'react'

export function useModal() {
  const [modal, setModal] = useState(null)
  const resolveModal = useRef(null)

  const showModal = useCallback((message, options = {}) => {
    if (resolveModal.current) return Promise.resolve(false)

    setModal({
      message,
      title: options.title || 'Aviso',
      confirmText: options.confirmText || 'Aceptar',
      cancelText: options.cancelText,
    })

    return new Promise((resolve) => {
      resolveModal.current = resolve
    })
  }, [])

  const closeModal = useCallback((confirmed) => {
    const resolve = resolveModal.current
    resolveModal.current = null
    setModal(null)
    resolve?.(confirmed)
  }, [])

  useEffect(() => {
    if (!modal) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeModal(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modal, closeModal])

  return {
    modal,
    showModal,
    closeModal,
    dialog: modal && (
      <>
        <div className="modal-backdrop fade show" />
        <div
          className="modal fade show d-block"
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-modal-title"
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h2 className="modal-title fs-5" id="app-modal-title">{modal.title}</h2>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Cerrar"
                  onClick={() => closeModal(false)}
                />
              </div>
              <div className="modal-body">{modal.message}</div>
              <div className="modal-footer">
                {modal.cancelText && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => closeModal(false)}
                  >
                    {modal.cancelText}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => closeModal(true)}
                >
                  {modal.confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    ),
  }
}
