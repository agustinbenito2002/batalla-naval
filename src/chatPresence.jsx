import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken, getBackendWebSocketUrl, requestBackend } from './backendApi.js'

const AUTHENTICATION_TIMEOUT = 10000
const CHAT_HISTORY_REFRESH_INTERVAL = 5000

function normalizeChatMessage(event) {
  const root = event.payload && typeof event.payload === 'object'
    ? event.payload
    : event.data && typeof event.data === 'object'
      ? event.data
      : event
  const rawMessage = root.message && typeof root.message === 'object'
    ? root.message
    : root.chatMessage && typeof root.chatMessage === 'object'
      ? root.chatMessage
      : root
  const rawSender = rawMessage.sender || rawMessage.user || root.sender || root.user
  const username = rawMessage.username
    || (typeof rawSender === 'string' ? rawSender : rawSender?.username || rawSender?.name)
    || root.username
  const text = rawMessage.text
    ?? rawMessage.content
    ?? (typeof root.message === 'string' ? root.message : undefined)
    ?? root.text
    ?? root.content

  if (typeof username !== 'string' || !username.trim() || typeof text !== 'string' || !text.trim()) {
    return null
  }

  const id = rawMessage.id ?? root.id
  const createdAt = rawMessage.created_at ?? rawMessage.createdAt ?? root.created_at ?? root.createdAt
  const parsedTimestamp = typeof createdAt === 'string' || typeof createdAt === 'number'
    ? Date.parse(createdAt)
    : Number.NaN
  return {
    id: id === undefined ? null : String(id),
    username: username.trim(),
    text: text.trim(),
    timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : null,
    receivedAt: Date.now(),
    local: false,
  }
}

function extractUsernames(event) {
  const payload = event.data && typeof event.data === 'object' ? event.data : event
  const entries = [
    payload.users,
    payload.onlineUsers,
    payload.members,
    payload.presence?.users,
    payload.presence?.onlineUsers,
    event.users,
    event.onlineUsers,
  ].find(Array.isArray)

  if (entries) {
    return entries.map((entry) => {
      const name = typeof entry === 'string' ? entry : entry?.username
      return typeof name === 'string' ? name.trim() : ''
    }).filter(Boolean)
  }

  const presence = payload.presence
  if (presence && typeof presence === 'object' && !Array.isArray(presence)) {
    return Object.values(presence)
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((entry) => typeof entry === 'string' ? entry : entry?.username)
      .filter((name) => typeof name === 'string' && name.trim())
      .map((name) => name.trim())
  }

  return null
}

export function useChatConnection(currentUsername) {
  const username = currentUsername.trim()
  const [users, setUsers] = useState(() => username ? [username] : [])
  const [messages, setMessages] = useState([])
  const [privateMessages, setPrivateMessages] = useState([])
  const [invitations, setInvitations] = useState([])
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [status, setStatus] = useState('Desconectado')
  const socketRef = useRef(null)

  const sendSocketEvent = useCallback((event) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('El chat en tiempo real no está conectado.')
    }
    socket.send(JSON.stringify(event))
  }, [])

  const addChatMessage = useCallback((message, local = false) => {
    const normalized = normalizeChatMessage(message)
    if (!normalized) return
    normalized.local = local

    setMessages((current) => {
      if (normalized.id && current.some((existing) => existing.id === normalized.id)) {
        return current
      }

      const matchingIndex = current.findIndex((existing) =>
        existing.username.toLowerCase() === normalized.username.toLowerCase()
        && existing.text === normalized.text
        && (
          (normalized.timestamp !== null && existing.timestamp !== null
            && Math.abs(normalized.timestamp - existing.timestamp) < 1000)
          || (Date.now() - existing.receivedAt < 5000 && existing.local !== normalized.local)
        ),
      )

      if (matchingIndex >= 0) {
        if (local) return current
        const updated = [...current]
        updated[matchingIndex] = normalized
        return updated
      }

      return [...current, normalized]
    })
  }, [])

  const sendPrivateMessage = useCallback((recipient, text) => {
    const trimmedText = text.trim()
    if (!recipient || !trimmedText) return
    sendSocketEvent({
      type: 'chat:private:send',
      from: username,
      to: recipient,
      text: trimmedText,
    })
    setPrivateMessages((current) => [...current, {
      username,
      to: recipient,
      text: trimmedText,
      receivedAt: Date.now(),
      local: true,
    }])
  }, [sendSocketEvent, username])

  const sendChallenge = useCallback((recipient) => {
    if (!recipient) return
    sendSocketEvent({ type: 'game:challenge:invite', to: recipient })
  }, [sendSocketEvent])

  const respondToInvitation = useCallback((invitation, accepted) => {
    sendSocketEvent({
      type: 'game:challenge:respond',
      invitationId: invitation.id,
      from: invitation.username,
      accepted,
    })
    setInvitations((current) => current.filter((entry) => entry.id !== invitation.id))
    if (accepted && invitation.gameId) {
      window.location.href = `/battle.html?${new URLSearchParams({ gameId: invitation.gameId })}`
    }
  }, [sendSocketEvent])

  useEffect(() => {
    let isActive = true
    let timerId

    const refreshChatHistory = async () => {
      try {
        const result = await requestBackend('/api/chat/messages', { allowArray: true })
        const history = Array.isArray(result)
          ? result
          : Array.isArray(result.messages)
            ? result.messages
            : Array.isArray(result.data?.messages)
              ? result.data.messages
              : null
        if (!history) {
          throw new Error('El backend no devolvió el historial del chat en un formato válido.')
        }

        if (isActive) {
          history.forEach((chatMessage) => {
            if (!normalizeChatMessage({ message: chatMessage })) {
              throw new Error('El historial contiene un mensaje sin remitente o texto válido.')
            }
            addChatMessage({ message: chatMessage })
          })
          setHistoryError('')
        }
      } catch (historyRequestError) {
        if (isActive) setHistoryError(historyRequestError.message)
      } finally {
        if (isActive) timerId = window.setTimeout(refreshChatHistory, CHAT_HISTORY_REFRESH_INTERVAL)
      }
    }

    if (getAuthToken()) void refreshChatHistory()
    return () => {
      isActive = false
      window.clearTimeout(timerId)
    }
  }, [addChatMessage])

  useEffect(() => {
    let isActive = true
    let authenticationTimer
    let socket

    const addCurrentUser = (onlineUsers) => {
      if (username && !onlineUsers.some((user) => user.toLowerCase() === username.toLowerCase())) {
        onlineUsers.push(username)
      }
      return [...new Set(onlineUsers)]
    }

    const token = getAuthToken()
    if (!token) {
      setStatus('No autenticado')
      setError('No se encontró el token de acceso. Cierra sesión e inicia sesión de nuevo.')
      return () => { isActive = false }
    }

    if (typeof window.WebSocket !== 'function') {
      setStatus('No disponible')
      setError('Este navegador no admite conexiones WebSocket.')
      return () => { isActive = false }
    }

    try {
      socket = new WebSocket(getBackendWebSocketUrl())
      socketRef.current = socket
      setStatus('Conectando…')
      setError('')

      socket.addEventListener('open', () => {
        if (!isActive) return
        setStatus('Autenticando…')
        try {
          socket.send(JSON.stringify({ type: 'auth', token }))
        } catch (sendError) {
          setStatus('Error de conexión')
          setError(`No se pudo enviar la autenticación WebSocket: ${sendError.message}`)
          return
        }

        authenticationTimer = window.setTimeout(() => {
          if (isActive) {
            setStatus('Sin confirmar')
            setError('El servidor no confirmó la autenticación. Revisa Network → WS en las herramientas del navegador.')
          }
        }, AUTHENTICATION_TIMEOUT)
      })

      socket.addEventListener('message', (messageEvent) => {
        if (!isActive) return

        let event
        try {
          event = JSON.parse(messageEvent.data)
        } catch {
          setError('El servidor envió un evento WebSocket que no es JSON válido.')
          return
        }

        if (!event || typeof event !== 'object' || typeof event.type !== 'string') return

        if (event.type === 'authenticated') {
          window.clearTimeout(authenticationTimer)
          setStatus('Conectado')
          setError('')
          const authenticatedUsers = extractUsernames(event)
          if (authenticatedUsers) setUsers(addCurrentUser(authenticatedUsers))
          return
        }

        if (event.type === 'chat:presence') {
          const presenceUsers = extractUsernames(event)
          if (presenceUsers) setUsers(addCurrentUser(presenceUsers))
          return
        }

        if (event.type === 'chat:message') {
          addChatMessage(event)
          return
        }

        if (event.type === 'chat:messages') {
          const payload = event.payload && typeof event.payload === 'object' ? event.payload : event
          const incomingMessages = Array.isArray(payload.messages) ? payload.messages : []
          incomingMessages.forEach((incomingMessage) => addChatMessage({ message: incomingMessage }))
          return
        }

        if (event.type === 'chat:private:message') {
          const privateMessage = event.message && typeof event.message === 'object'
            ? event.message
            : event.payload && typeof event.payload === 'object'
              ? event.payload
              : event
          const sender = privateMessage.from
            || privateMessage.sender
            || privateMessage.username
          const recipient = privateMessage.to
            || privateMessage.recipient
          const text = privateMessage.text
          const isConversationParticipant = typeof sender === 'string'
            && typeof recipient === 'string'
            && (sender.toLowerCase() === username.toLowerCase()
              || recipient.toLowerCase() === username.toLowerCase())
          if (isConversationParticipant && typeof text === 'string' && text.trim()) {
            setPrivateMessages((current) => {
              const id = privateMessage.id ? String(privateMessage.id) : null
              if (id && current.some((existing) => existing.id === id)) return current
              const matchingIndex = current.findIndex((existing) =>
                existing.username.toLowerCase() === sender.toLowerCase()
                && existing.to.toLowerCase() === recipient.toLowerCase()
                && existing.text === text.trim()
                && Date.now() - existing.receivedAt < 5000
              )
              const normalized = {
                id,
                username: sender,
                to: recipient,
                text: text.trim(),
                receivedAt: Date.now(),
                local: false,
              }
              if (matchingIndex >= 0) {
                const updated = [...current]
                updated[matchingIndex] = normalized
                return updated
              }
              return [...current, normalized]
            })
          }
          return
        }

        if (event.type === 'game:challenge:invite') {
          const invitation = event.invitation && typeof event.invitation === 'object'
            ? event.invitation
            : event
          const sender = invitation.from || invitation.username
          const recipient = invitation.to || invitation.recipient
          const isRecipient = typeof recipient !== 'string'
            || recipient.toLowerCase() === username.toLowerCase()
          if (isRecipient && typeof sender === 'string' && sender.trim()) {
            const id = invitation.id || invitation.invitationId
              || `${sender}-${Date.now()}`
            setInvitations((current) => current.some((entry) => entry.id === String(id))
              ? current
              : [...current, {
                id: String(id),
                username: sender.trim(),
                gameId: typeof invitation.gameId === 'string' ? invitation.gameId : '',
              }])
          }
          return
        }

        if (event.type === 'game:challenge:accepted' && event.gameId) {
          const participants = Array.isArray(event.players) ? event.players : []
          const isParticipant = [event.from, event.to, event.recipient, ...participants]
            .some((participant) => typeof participant === 'string'
              && participant.toLowerCase() === username.toLowerCase())
          if (isParticipant) {
            window.location.href = `/battle.html?${new URLSearchParams({ gameId: String(event.gameId) })}`
          }
          return
        }

        if (event.type === 'auth:error' || event.type === 'error') {
          setStatus('Error de autenticación')
          setError(event.message || event.error || 'El servidor rechazó la conexión WebSocket.')
        }
      })

      socket.addEventListener('error', () => {
        if (!isActive) return
        setStatus('Error de conexión')
        setError('Falló la conexión WebSocket. Revisa Network → WS en las herramientas del navegador.')
      })

      socket.addEventListener('close', (closeEvent) => {
        if (!isActive) return
        if (socketRef.current === socket) socketRef.current = null
        window.clearTimeout(authenticationTimer)
        setStatus('Desconectado')
        const reason = closeEvent.reason ? ` Motivo: ${closeEvent.reason}` : ''
        setError(`El servidor cerró la conexión WebSocket (código ${closeEvent.code}).${reason} Revisa Network → WS.`)
      })
    } catch (connectionError) {
      setStatus('Error de conexión')
      setError(`No se pudo abrir el WebSocket: ${connectionError.message}`)
    }

    return () => {
      isActive = false
      window.clearTimeout(authenticationTimer)
      if (socketRef.current === socket) socketRef.current = null
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
    }
  }, [addChatMessage, username])

  return {
    users,
    messages,
    addChatMessage,
    privateMessages,
    sendPrivateMessage,
    invitations,
    sendChallenge,
    respondToInvitation,
    error,
    historyError,
    status,
  }
}

export function OnlineUsers({ users, error, status, currentUsername, selectedUser, onSelectUser }) {
  return (
    <aside className="online-users" aria-label="Usuarios conectados">
      <h2>Usuarios <span>{users.length}</span></h2>
      <p className="online-users-status" role="status">{status}</p>
      <ul>
        {users.map((username) => (
          <li key={username} className={selectedUser === username ? 'is-selected' : ''}>
            {username.toLowerCase() === currentUsername?.toLowerCase() ? (
              <>
                <span className="online-user-indicator" aria-hidden="true" />
                <span>{username} (tú)</span>
              </>
            ) : !onSelectUser ? (
              <>
                <span className="online-user-indicator" aria-hidden="true" />
                <span>{username}</span>
              </>
            ) : (
              <button
                type="button"
                aria-pressed={selectedUser === username}
                onClick={() => onSelectUser(username)}
              >
                <span className="online-user-indicator" aria-hidden="true" />
                <span>{username}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {users.length === 0 && !error && <p className="online-users-empty">No hay usuarios conectados.</p>}
      {error && <p className="online-users-error" role="status">{error}</p>}
    </aside>
  )
}
