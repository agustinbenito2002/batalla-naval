import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './style.css'
import { useModal } from './Modal.jsx'
import {
  clearAuthToken,
  requestBackend,
} from './backendApi.js'

const username = localStorage.getItem('battle-naval-current-user') || 'nombre usuario'

function MainMenu() {
  const [selectedButtons, setSelectedButtons] = useState([])
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [backendStatus, setBackendStatus] = useState({
    type: 'idle',
    message: 'Ingresa la URL de tu backend y comprueba la conexión.',
  })
  const [isStartingBattle, setIsStartingBattle] = useState(false)
  const [chatError, setChatError] = useState('')
  const chatInputRef = useRef(null)
  const { dialog, showModal } = useModal()

  const checkBackendConnection = async (event) => {
    event.preventDefault()

    setBackendStatus({ type: 'checking', message: 'Comprobando el backend y su conexión con Supabase…' })
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)

    try {
      const result = await requestBackend('/health', { signal: controller.signal })

      if (result.status !== 'ok' || result.supabase !== 'connected') {
        setBackendStatus({
          type: 'error',
          message: result.message || 'El backend respondió, pero no confirmó la conexión con Supabase.',
        })
        return
      }

      setBackendStatus({ type: 'connected', message: 'Backend activo y conectado con Supabase.' })
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'La conexión tardó demasiado. Inténtalo de nuevo.'
        : `${error.message} Revisa que CORS permita el origen del frontend.`
      setBackendStatus({ type: 'error', message })
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  const toggleSelected = (buttonName) => {
    setSelectedButtons((current) => current.includes(buttonName)
      ? current.filter((name) => name !== buttonName)
      : [...current, buttonName])
  }

  const startBattle = async (mode) => {
    setIsStartingBattle(true)
    setBackendStatus({ type: 'checking', message: 'Enviando la solicitud de partida al backend…' })

    try {
      const result = await requestBackend('/api/games', {
        method: 'POST',
        body: { username, mode },
      })
      const gameId = result.game?.id || result.id
      if (typeof gameId !== 'string' || !gameId) {
        throw new Error('El backend no devolvió el identificador de la partida.')
      }

      const params = new URLSearchParams({ gameId })
      if (mode === 'spectator') params.set('mode', 'spectator')
      window.location.href = `/battle.html?${params.toString()}`
    } catch (error) {
      setBackendStatus({ type: 'error', message: error.message })
      setIsStartingBattle(false)
    }
  }

  const exitSession = async () => {
    if (await showModal('¿Seguro que quieres cerrar sesión?', {
      title: 'Cerrar sesión',
      confirmText: 'Salir',
      cancelText: 'Cancelar',
    })) {
      localStorage.removeItem('battle-naval-current-user')
      clearAuthToken()
      window.location.href = '/'
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    const trimmedMessage = message.trim()

    if (!trimmedMessage) return

    setChatError('')
    try {
      await requestBackend('/api/chat/messages', {
        method: 'POST',
        body: { username, text: trimmedMessage },
      })
      setMessages((current) => [...current, `${username}: ${trimmedMessage}`])
      setMessage('')
      chatInputRef.current?.focus()
    } catch (error) {
      setChatError(error.message)
    }
  }

  return (
    <main className="game-shell">
      <aside className="menu-panel" aria-label="Menú principal">
        <button
          className={`btn btn-secondary menu-button username${selectedButtons.includes('username') ? ' is-selected' : ''}`}
          type="button"
          onClick={() => toggleSelected('username')}
        >
          {username}
        </button>
        <nav className="menu-actions" aria-label="Opciones de partida">
          <button
            className={`btn btn-primary menu-button battle-option${selectedButtons.includes('random') ? ' is-selected' : ''}`}
            type="button"
            disabled={isStartingBattle}
            onClick={() => {
              toggleSelected('random')
              void startBattle('random')
            }}
          >
            PARTIDA ALEATORIA
          </button>
          <button
            className={`btn btn-info menu-button battle-option${selectedButtons.includes('challenge') ? ' is-selected' : ''}`}
            type="button"
            disabled={isStartingBattle}
            onClick={() => {
              toggleSelected('challenge')
              void startBattle('challenge')
            }}
          >
            DESAFÍO A USUARIO
          </button>
          <button
            className={`btn btn-success menu-button battle-option${selectedButtons.includes('spectator') ? ' is-selected' : ''}`}
            type="button"
            disabled={isStartingBattle}
            onClick={() => {
              toggleSelected('spectator')
              void startBattle('spectator')
            }}
          >
            MODO ESPECTADOR
          </button>
        </nav>
        <button
          className={`btn btn-danger menu-button exit-button${selectedButtons.includes('exit') ? ' is-selected' : ''}`}
          type="button"
          onClick={() => {
            toggleSelected('exit')
            void exitSession()
          }}
        >
          SALIR
        </button>
      </aside>

      <section className="chat-panel" aria-label="Chat">
        <div className="chat-history" id="chat-history" aria-live="polite">
          <h1>chat</h1>
          {messages.map((chatMessage, index) => (
            <p className="chat-message" key={`${index}-${chatMessage}`}>{chatMessage}</p>
          ))}
          {chatError && <p className="chat-error" role="alert">{chatError}</p>}
        </div>
        <form className="chat-compose" id="chat-form" onSubmit={sendMessage}>
          <input
            ref={chatInputRef}
            id="chat-input"
            type="text"
            placeholder="escribe en el chat"
            autoComplete="off"
            aria-label="Escribe en el chat"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button className="btn btn-primary send-button" type="submit" aria-label="Enviar mensaje" title="Enviar mensaje">&#10148;</button>
        </form>
      </section>
      <BackendConnection
        onSubmit={checkBackendConnection}
        backendStatus={backendStatus}
        setBackendStatus={setBackendStatus}
      />
      {dialog}
    </main>
  )
}

function BackendConnection({ onSubmit, backendStatus, setBackendStatus }) {
  return (
    <section className="backend-panel" aria-labelledby="backend-title">
      <div className="backend-heading">
        <div>
          <p className="backend-eyebrow">CONFIGURACIÓN</p>
          <h2 id="backend-title">Conexión con el backend</h2>
        </div>
        <p>Comprueba que la API está activa y conectada con Supabase.</p>
      </div>
      <form className="backend-form" onSubmit={onSubmit}>
        <button className="btn btn-primary backend-connect-button" type="submit" disabled={backendStatus.type === 'checking'}>
          {backendStatus.type === 'checking' ? 'CONECTANDO…' : 'PROBAR CONEXIÓN'}
        </button>
      </form>
      <p className={`backend-status ${backendStatus.type}`} role="status" aria-live="polite">
        <span className="backend-status-indicator" aria-hidden="true" />
        {backendStatus.message}
      </p>
      <p className="backend-note">Se consulta la ruta /health. La dirección se configura fuera de la interfaz; el backend debe permitir CORS para el frontend.</p>
    </section>
  )
}

createRoot(document.querySelector('#app')).render(<MainMenu />)
