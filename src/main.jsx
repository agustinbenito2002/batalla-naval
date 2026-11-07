import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './style.css'
import { useModal } from './Modal.jsx'
import { OnlineUsers, useChatConnection } from './chatPresence.jsx'
import {
  clearAuthToken,
  requestBackend,
} from './backendApi.js'

const username = localStorage.getItem('battle-naval-current-user') || 'nombre usuario'

function MainMenu() {
  const [selectedButtons, setSelectedButtons] = useState([])
  const [message, setMessage] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [privateChatUser, setPrivateChatUser] = useState('')
  const [privateDraft, setPrivateDraft] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [backendStatus, setBackendStatus] = useState({
    type: 'idle',
    message: 'Ingresa la URL de tu backend y comprueba la conexión.',
  })
  const [isStartingBattle, setIsStartingBattle] = useState(false)
  const [chatError, setChatError] = useState('')
  const chatInputRef = useRef(null)
  const {
    users: onlineUsers,
    messages,
    addChatMessage,
    privateMessages,
    sendPrivateMessage,
    invitations,
    sendChallenge,
    respondToInvitation,
    error: onlineUsersError,
    historyError: chatHistoryError,
    status: onlineUsersStatus,
  } = useChatConnection(username)
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
      addChatMessage({ username, text: trimmedMessage }, true)
      setMessage('')
      chatInputRef.current?.focus()
    } catch (error) {
      setChatError(error.message)
    }
  }

  const startPrivateChat = () => {
    setPrivateChatUser(selectedUser)
    setPrivateDraft('')
    setActionError('')
  }

  const sendPrivate = (event) => {
    event.preventDefault()
    if (!privateChatUser || !privateDraft.trim()) return
    try {
      sendPrivateMessage(privateChatUser, privateDraft)
      setPrivateDraft('')
    } catch (error) {
      setActionError(error.message)
    }
  }

  const challengeSelectedUser = () => {
    setActionError('')
    setActionNotice('')
    try {
      sendChallenge(selectedUser)
      setActionNotice(`Invitación enviada a ${selectedUser}.`)
    } catch (error) {
      setActionError(error.message)
    }
  }

  const answerInvitation = (invitation, accepted) => {
    try {
      respondToInvitation(invitation, accepted)
      setActionNotice(accepted
        ? `Aceptaste el desafío de ${invitation.username}.`
        : `Rechazaste el desafío de ${invitation.username}.`)
      setActionError('')
    } catch (error) {
      setActionError(error.message)
    }
  }

  useEffect(() => {
    const lastIncomingMessage = [...privateMessages].reverse().find((chatMessage) =>
      !chatMessage.local && chatMessage.to.toLowerCase() === username.toLowerCase(),
    )
    if (lastIncomingMessage) setPrivateChatUser(lastIncomingMessage.username)
  }, [privateMessages, username])

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
              if (selectedUser) {
                challengeSelectedUser()
              } else {
                setActionError('Selecciona un usuario conectado antes de desafiarlo.')
              }
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

      <section className={`user-actions-panel${privateChatUser ? ' has-private-chat' : ''}`} aria-live="polite">
        {privateChatUser ? (
          <PrivateChatDialog
            currentUsername={username}
            recipient={privateChatUser}
            messages={privateMessages.filter((chatMessage) =>
              (chatMessage.username.toLowerCase() === username.toLowerCase()
                && chatMessage.to.toLowerCase() === privateChatUser.toLowerCase())
              || (chatMessage.username.toLowerCase() === privateChatUser.toLowerCase()
                && chatMessage.to.toLowerCase() === username.toLowerCase()),
            )}
            draft={privateDraft}
            error={actionError}
            onDraftChange={setPrivateDraft}
            onSubmit={sendPrivate}
            onClose={() => {
              setPrivateChatUser('')
              setActionError('')
            }}
          />
        ) : selectedUser ? (
          <>
            <h2>{selectedUser}</h2>
            <button className="btn btn-primary" type="button" onClick={startPrivateChat}>
              Chat
            </button>
            <button className="btn btn-outline-primary" type="button" onClick={challengeSelectedUser}>
              Desafiar
            </button>
            {actionNotice && <p className="user-action-notice" role="status">{actionNotice}</p>}
            {actionError && <p className="chat-error" role="alert">{actionError}</p>}
          </>
        ) : (
          <p>Selecciona un usuario conectado para ver las opciones.</p>
        )}
      </section>

      <section className="chat-panel" aria-label="Chat">
        <OnlineUsers
          users={onlineUsers}
          error={onlineUsersError}
          status={onlineUsersStatus}
          currentUsername={username}
          selectedUser={selectedUser}
          onSelectUser={(name) => {
            setSelectedUser((current) => current === name ? '' : name)
            setPrivateChatUser('')
            setActionError('')
            setActionNotice('')
          }}
        />
        <div className="chat-content">
          <div className="chat-history" id="chat-history" aria-live="polite">
            <h1>chat</h1>
            {invitations.map((invitation) => (
              <div className="chat-invitation" key={invitation.id}>
                <p><b>{invitation.username}</b> te invita a una partida.</p>
                <div>
                  <button className="btn btn-success btn-sm" type="button" onClick={() => answerInvitation(invitation, true)}>
                    Aceptar
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => answerInvitation(invitation, false)}>
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
            {messages.map((chatMessage, index) => (
              <p className="chat-message" key={chatMessage.id || `${chatMessage.username}-${chatMessage.receivedAt}-${index}`}>
                <b>{chatMessage.username}:</b> {chatMessage.text}
              </p>
            ))}
            {chatHistoryError && <p className="chat-error" role="status">{chatHistoryError}</p>}
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
        </div>
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

function PrivateChatDialog({
  currentUsername,
  recipient,
  messages,
  draft,
  error,
  onDraftChange,
  onSubmit,
  onClose,
}) {
  return (
    <section className="private-chat-dialog" role="region" aria-labelledby="private-chat-title">
      <header>
        <h2 id="private-chat-title">{recipient}</h2>
        <button type="button" aria-label="Cerrar chat privado" onClick={onClose}>×</button>
      </header>
      <p className="private-chat-temporary">Chat privado temporal</p>
      <div className="private-chat-messages" aria-live="polite">
        {messages.map((chatMessage, index) => (
          <p key={chatMessage.id || `${chatMessage.receivedAt}-${index}`}>
            <b>{chatMessage.username === currentUsername ? 'Tú' : chatMessage.username}:</b> {chatMessage.text}
          </p>
        ))}
      </div>
      <form onSubmit={onSubmit}>
        <input
          autoFocus
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={`Mensaje para ${recipient}`}
          aria-label={`Mensaje privado para ${recipient}`}
        />
        <button className="btn btn-primary" type="submit">Enviar</button>
      </form>
      {error && <p className="chat-error" role="alert">{error}</p>}
    </section>
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
