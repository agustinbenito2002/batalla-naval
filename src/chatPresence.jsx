import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAuthToken,
  getAuthUserId,
  getBackendWebSocketUrl,
  requestBackend,
} from './backendApi.js'

const AUTHENTICATION_TIMEOUT = 25000
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
      : root.data && typeof root.data === 'object' && !Array.isArray(root.data)
        ? root.data
      : root
  const rawSender = rawMessage.sender || rawMessage.user || rawMessage.profile
    || root.sender || root.user || root.profile
  const username = rawMessage.username
    || rawMessage.senderUsername
    || rawMessage.sender_username
    || (typeof rawSender === 'string' ? rawSender : rawSender?.username || rawSender?.name)
    || root.username
    || root.senderUsername
    || root.sender_username
  const text = rawMessage.text
    ?? rawMessage.content
    ?? rawMessage.message
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

function extractOnlineUsers(event) {
  const payload = event.data && typeof event.data === 'object'
    ? event.data
    : event.payload && typeof event.payload === 'object'
      ? event.payload
      : event
  let entries = [
    payload.users,
    payload.onlineUsers,
    payload.members,
    payload.presence?.users,
    payload.presence?.onlineUsers,
    event.users,
    event.onlineUsers,
  ].find(Array.isArray)

  if (!entries) {
    const presence = payload.presence
    if (presence && typeof presence === 'object' && !Array.isArray(presence)) {
      entries = Object.values(presence).flatMap((value) =>
        (Array.isArray(value) ? value : [value]).map((entry) => (
          typeof entry === 'string'
            ? { username: entry }
            : { ...entry }
        )),
      )
    }
  }

  if (!entries) return null
  return entries.map((entry) => {
    const user = entry?.user && typeof entry.user === 'object' ? entry.user : entry
    const username = typeof entry === 'string' ? entry : user?.username || user?.name
    const id = typeof entry === 'object'
      ? user?.id || user?.userId || user?.user_id || entry.id || entry.userId || entry.user_id
      : null
    return {
      username: typeof username === 'string' ? username.trim() : '',
      id: typeof id === 'string' ? id : '',
    }
  }).filter((entry) => entry.username)
}

function extractAuthenticatedUser(event) {
  const payload = event.data && typeof event.data === 'object'
    ? event.data
    : event.payload && typeof event.payload === 'object'
      ? event.payload
      : event
  const user = payload.user && typeof payload.user === 'object' ? payload.user : payload
  return {
    id: user.id || user.userId || user.user_id || payload.userId || payload.user_id,
    username: user.username || user.name || payload.username,
  }
}

export function useChatConnection(
  currentUsername,
  authenticatedUserId = '',
  initialMatchId = '',
  initialMatchRole = 'player',
  matchChatOnly = false,
) {
  const username = currentUsername.trim()
  const [users, setUsers] = useState(() => username ? [username] : [])
  const [messages, setMessages] = useState([])
  const [matchMessages, setMatchMessages] = useState([])
  const [privateMessages, setPrivateMessages] = useState([])
  const [privateChatError, setPrivateChatError] = useState('')
  const [invitations, setInvitations] = useState([])
  const [match, setMatch] = useState(null)
  const [matchActions, setMatchActions] = useState([])
  const [radarResults, setRadarResults] = useState([])
  const [matchError, setMatchError] = useState('')
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [status, setStatus] = useState('Desconectado')
  const socketRef = useRef(null)
  const authenticatedRef = useRef(false)
  const socketAuthErrorRef = useRef('')
  const userIdRef = useRef(authenticatedUserId || getAuthUserId() || '')
  const userIdsByUsernameRef = useRef(new Map())
  const usernamesByUserIdRef = useRef(new Map())

  if (username && userIdRef.current) {
    userIdsByUsernameRef.current.set(username.toLowerCase(), userIdRef.current)
    usernamesByUserIdRef.current.set(userIdRef.current, username)
  }

  const sendSocketEvent = useCallback((event) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN || !authenticatedRef.current) {
      throw new Error('El chat en tiempo real no está conectado o aún no confirmó la autenticación.')
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

  const addMatchChatMessage = useCallback((event) => {
    if (!initialMatchId || event.matchId !== initialMatchId) return
    const normalized = normalizeChatMessage(event)
    if (!normalized) return

    setMatchMessages((current) => {
      if (normalized.id && current.some((existing) => existing.id === normalized.id)) {
        return current
      }
      return [...current, normalized]
    })
  }, [initialMatchId])

  const replaceMatchChatHistory = useCallback((history) => {
    if (!Array.isArray(history)) return
    const normalizedMessages = history
      .map((message) => normalizeChatMessage({ message }))
      .filter(Boolean)
    setMatchMessages(normalizedMessages)
  }, [])

  const sendMatchChat = useCallback((text) => {
    const trimmedText = text.trim()
    if (!initialMatchId) {
      throw new Error('No hay una partida en tiempo real asociada a este chat.')
    }
    if (!trimmedText) return
    sendSocketEvent({
      type: 'chat:send',
      scope: 'match',
      matchId: initialMatchId,
      text: trimmedText,
    })
  }, [initialMatchId, sendSocketEvent])

  const sendPrivateMessage = useCallback((recipient, text) => {
    const trimmedText = text.trim()
    if (!recipient || !trimmedText) return
    const recipientId = userIdsByUsernameRef.current.get(recipient.toLowerCase())
    if (!recipientId) {
      throw new Error(`No se recibió el ID de Supabase de ${recipient}. Espera a que aparezca como conectado y vuelve a intentarlo.`)
    }
    setPrivateChatError('')
    sendSocketEvent({
      type: 'chat:private:send',
      recipientId,
      text: trimmedText,
    })
  }, [sendSocketEvent])

  const sendChallenge = useCallback((recipient) => {
    if (!recipient) return
    const recipientId = userIdsByUsernameRef.current.get(recipient.toLowerCase())
    if (!recipientId) {
      throw new Error(`No se recibió el ID de Supabase de ${recipient}. Espera a que aparezca como conectado y vuelve a intentarlo.`)
    }
    sendSocketEvent({ type: 'game:challenge:invite', recipientId })
  }, [sendSocketEvent])

  const respondToInvitation = useCallback((invitation, accepted) => {
    sendSocketEvent({
      type: 'game:challenge:respond',
      invitationId: invitation.id,
      matchId: invitation.matchId || invitation.id,
      from: invitation.username,
      accepted,
    })
    setInvitations((current) => current.filter((entry) => entry.id !== invitation.id))
  }, [sendSocketEvent])

  const sendMatchAction = useCallback((matchId, action) => {
    if (!matchId) throw new Error('No hay una partida en tiempo real asociada.')
    setMatchError('')
    sendSocketEvent({ type: 'match:action', matchId, action })
  }, [sendSocketEvent])

  const leaveMatch = useCallback((matchId) => {
    if (!matchId) return
    sendSocketEvent({ type: 'match:leave', matchId })
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
            : Array.isArray(result.data)
              ? result.data
            : Array.isArray(result.data?.messages)
              ? result.data.messages
              : Array.isArray(result.payload?.messages)
                ? result.payload.messages
              : null
        if (!history) {
          throw new Error('El backend no devolvió el historial del chat en un formato válido.')
        }

        if (isActive) {
          let invalidMessages = 0
          history.forEach((chatMessage) => {
            if (!normalizeChatMessage({ message: chatMessage })) {
              invalidMessages += 1
              return
            }
            addChatMessage({ message: chatMessage })
          })
          setHistoryError(invalidMessages
            ? `${invalidMessages} mensaje(s) del historial no tenían remitente o texto válido; se omitieron.`
            : '')
        }
      } catch (historyRequestError) {
        if (isActive) setHistoryError(historyRequestError.message)
      } finally {
        if (isActive) timerId = window.setTimeout(refreshChatHistory, CHAT_HISTORY_REFRESH_INTERVAL)
      }
    }

    if (!matchChatOnly && getAuthToken()) void refreshChatHistory()
    return () => {
      isActive = false
      window.clearTimeout(timerId)
    }
  }, [addChatMessage, matchChatOnly])

  useEffect(() => {
    let isActive = true
    let authenticationTimer
    let socket

    const updateOnlineUsers = (event) => {
      const onlineEntries = extractOnlineUsers(event)
      if (!onlineEntries) return
      const onlineUsernames = onlineEntries.map(({ username: onlineUsername, id }) => {
        if (id) {
          userIdsByUsernameRef.current.set(onlineUsername.toLowerCase(), id)
          usernamesByUserIdRef.current.set(id, onlineUsername)
          if (onlineUsername.toLowerCase() === username.toLowerCase()) userIdRef.current = id
        }
        return onlineUsername
      })
      if (username && !onlineUsernames.some((name) => name.toLowerCase() === username.toLowerCase())) {
        onlineUsernames.push(username)
      }
      setUsers([...new Set(onlineUsernames)])
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
        authenticatedRef.current = false
        socketAuthErrorRef.current = ''
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
            authenticatedRef.current = false
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
          authenticatedRef.current = true
          socketAuthErrorRef.current = ''
          setStatus('Conectado')
          setError('')
          setPrivateChatError('')
          const authenticatedUser = extractAuthenticatedUser(event)
          if (typeof authenticatedUser.id === 'string' && authenticatedUser.id) {
            userIdRef.current = authenticatedUser.id
            userIdsByUsernameRef.current.set(username.toLowerCase(), authenticatedUser.id)
            usernamesByUserIdRef.current.set(authenticatedUser.id, username)
          }
          updateOnlineUsers(event)
          if (initialMatchId) {
            try {
              socket.send(JSON.stringify({
                type: initialMatchRole === 'spectator' ? 'match:spectate' : 'match:join',
                matchId: initialMatchId,
              }))
            } catch (joinError) {
              setError(`No se pudo volver a conectar a la partida: ${joinError.message}`)
            }
          }
          return
        }

        if (event.type === 'chat:presence') {
          updateOnlineUsers(event)
          return
        }

        if (event.type === 'chat:message') {
          if (event.scope === 'match') {
            addMatchChatMessage(event)
          } else if (event.scope === 'general' && !matchChatOnly) {
            addChatMessage(event)
          }
          return
        }

        if (event.type === 'chat:messages') {
          if (matchChatOnly) return
          const payload = event.payload && typeof event.payload === 'object' ? event.payload : event
          const incomingMessages = Array.isArray(payload.messages) ? payload.messages : []
          incomingMessages.forEach((incomingMessage) => addChatMessage({ message: incomingMessage }))
          return
        }

        if (event.type === 'chat:private:message') {
          const payload = event.payload && typeof event.payload === 'object'
            ? event.payload
            : event.data && typeof event.data === 'object'
              ? event.data
              : event
          const privateMessage = payload.message && typeof payload.message === 'object'
            ? payload.message
            : payload
          const rawSender = privateMessage.sender || privateMessage.fromUser
            || privateMessage.from || privateMessage.username
          const rawRecipient = privateMessage.recipient || privateMessage.toUser
            || privateMessage.to
          const senderId = privateMessage.senderId || privateMessage.sender_id
            || privateMessage.fromId || privateMessage.from_id
          const recipientId = privateMessage.recipientId || privateMessage.recipient_id
            || privateMessage.toId || privateMessage.to_id
          const getIdentity = (value, id, name) => {
            if (value && typeof value === 'object') {
              return {
                id: value.id || value.userId || value.user_id || id || '',
                username: value.username || value.name || name || '',
              }
            }
            return {
              id: id || (typeof value === 'string' && usernamesByUserIdRef.current.has(value) ? value : ''),
              username: name || (typeof value === 'string' ? value : ''),
            }
          }
          const senderIdentity = getIdentity(
            rawSender,
            senderId,
            privateMessage.senderUsername || privateMessage.fromUsername,
          )
          const recipientIdentity = getIdentity(
            rawRecipient,
            recipientId,
            privateMessage.recipientUsername || privateMessage.toUsername,
          )
          const resolveUsername = (identity) => {
            if (identity.id === userIdRef.current && username) return username
            if (identity.id && usernamesByUserIdRef.current.has(identity.id)) {
              return usernamesByUserIdRef.current.get(identity.id)
            }
            return identity.username
          }
          const sender = resolveUsername(senderIdentity)
          const recipient = resolveUsername(recipientIdentity)
          const text = privateMessage.text
          const isCurrentUser = (identity) => (
            (identity.id && identity.id === userIdRef.current)
            || (identity.id
              && usernamesByUserIdRef.current.get(identity.id)?.toLowerCase() === username.toLowerCase())
            || (identity.username && identity.username.toLowerCase() === username.toLowerCase())
          )
          const isConversationParticipant = isCurrentUser(senderIdentity)
            || isCurrentUser(recipientIdentity)
          if (isConversationParticipant && sender && recipient && typeof text === 'string' && text.trim()) {
            setPrivateMessages((current) => {
              const id = privateMessage.id ? String(privateMessage.id) : event.id ? String(event.id) : null
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

        if (event.type === 'match:created'
            || event.type === 'match:joined'
            || event.type === 'match:spectating'
            || event.type === 'match:updated') {
          if (event.match && typeof event.match === 'object') setMatch(event.match)
          if (event.match?.id === initialMatchId
              && (event.type === 'match:joined' || event.type === 'match:spectating')) {
            replaceMatchChatHistory(event.messages)
            if (Array.isArray(event.actions)) setMatchActions(event.actions)
          }
          return
        }

        if (event.type === 'match:action') {
          if (event.matchId === initialMatchId) {
            setMatchActions((current) => current.some((existing) =>
              (event.actionId && existing.actionId === event.actionId)
              || (existing.sentAt === event.sentAt && existing.playerId === event.playerId),
            ) ? current : [...current, event])
            if (event.game) {
              setMatch((current) => current ? { ...current, game: event.game } : current)
            }
          }
          return
        }

        if (event.type === 'match:radar:result' && event.matchId === initialMatchId) {
          setRadarResults(Array.isArray(event.results) ? event.results : [])
          return
        }

        if (event.type === 'match:ended') {
          setMatch((current) => current ? { ...current, status: 'ended' } : current)
          setError('La partida terminó porque uno de los jugadores salió.')
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
                matchId: String(invitation.matchId || invitation.gameId || id),
                username: sender.trim(),
                gameId: typeof invitation.gameId === 'string' ? invitation.gameId : '',
              }])
          }
          return
        }

        if (event.type === 'game:challenge:accepted') {
          const matchId = event.matchId || event.gameId
          if (typeof matchId === 'string' && matchId) {
            window.location.href = `/battle.html?${new URLSearchParams({ matchId })}`
          }
          return
        }

        if (event.type === 'game:challenge:declined') {
          const notice = event.reason === 'recipient_offline'
            ? 'El usuario se desconectó antes de responder el desafío.'
            : event.reason === 'expired'
              ? 'El desafío expiró sin respuesta.'
              : event.reason === 'cancelled'
                ? 'El desafío fue cancelado.'
                : `${event.from || 'El usuario'} rechazó el desafío.`
          setError(notice)
          return
        }

        if (event.type === 'auth:error' || event.type === 'error') {
          const errorObject = event.error && typeof event.error === 'object' ? event.error : null
          const errorCode = event.code || event.errorCode || errorObject?.code
            || (typeof event.error === 'string' ? event.error : '')
          const errorMessage = event.message || errorObject?.message || errorCode
          if (event.type === 'error') {
            setMatchError(errorMessage || 'El servidor rechazó la acción de la partida.')
          }
          if (errorCode === 'RECIPIENT_OFFLINE') {
            setPrivateChatError('El destinatario no está conectado. Comprueba que seleccionaste al usuario correcto y que sigue en línea.')
            return
          }
          if (errorCode === 'PRIVATE_CHAT_UNAVAILABLE') {
            setPrivateChatError('El chat privado no está disponible entre las instancias del servidor. Inténtalo más tarde.')
            return
          }
          if (event.type === 'auth:error' || errorCode === 'AUTHENTICATION_FAILED'
              || errorCode === 'AUTHENTICATION_REQUIRED'
              || errorCode === 'AUTHENTICATION_TIMEOUT') {
            authenticatedRef.current = false
            socketAuthErrorRef.current = errorMessage || 'El servidor no pudo validar la sesión.'
            setStatus('Error de autenticación')
          }
          setError(errorMessage || 'El servidor rechazó la conexión WebSocket.')
        }
      })

      socket.addEventListener('error', () => {
        if (!isActive) return
        authenticatedRef.current = false
        setStatus('Error de conexión')
        setError('Falló la conexión WebSocket. Revisa Network → WS en las herramientas del navegador.')
      })

      socket.addEventListener('close', (closeEvent) => {
        if (!isActive) return
        authenticatedRef.current = false
        if (socketRef.current === socket) socketRef.current = null
        window.clearTimeout(authenticationTimer)
        setStatus(socketAuthErrorRef.current ? 'Error de autenticación' : 'Desconectado')
        const reason = closeEvent.reason ? ` Motivo: ${closeEvent.reason}` : ''
        setError(socketAuthErrorRef.current
          ? `${socketAuthErrorRef.current} (código WebSocket ${closeEvent.code}).`
          : `El servidor cerró la conexión WebSocket (código ${closeEvent.code}).${reason} Revisa Network → WS.`)
      })
    } catch (connectionError) {
      authenticatedRef.current = false
      setStatus('Error de conexión')
      setError(`No se pudo abrir el WebSocket: ${connectionError.message}`)
    }

    return () => {
      isActive = false
      authenticatedRef.current = false
      window.clearTimeout(authenticationTimer)
      if (socketRef.current === socket) socketRef.current = null
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
    }
  }, [
    addChatMessage,
    addMatchChatMessage,
    authenticatedUserId,
    initialMatchId,
    initialMatchRole,
    replaceMatchChatHistory,
    username,
  ])

  return {
    users,
    messages,
    matchMessages,
    addChatMessage,
    privateMessages,
    privateChatError,
    sendPrivateMessage,
    invitations,
    match,
    matchActions,
    radarResults,
    matchError,
    sendMatchAction,
    leaveMatch,
    sendMatchChat,
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
