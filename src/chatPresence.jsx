import { useEffect, useState } from 'react'
import { requestBackend } from './backendApi.js'

const PRESENCE_REFRESH_INTERVAL = 10000

function parseOnlineUsers(result) {
  const entries = Array.isArray(result)
    ? result
    : [result.users, result.onlineUsers, result.online].find(Array.isArray)
  if (!Array.isArray(entries)) {
    throw new Error('El backend devolvió una lista de usuarios conectados no válida.')
  }

  const usernames = entries.map((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.username
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('El backend devolvió un usuario conectado sin nombre válido.')
    }
    return name.trim()
  })

  return [...new Set(usernames)]
}

export function useOnlineUsers() {
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let isActive = true
    let timerId

    const refreshUsers = async () => {
      try {
        const result = await requestBackend('/chat/online', { allowArray: true })
        const onlineUsers = parseOnlineUsers(result)
        if (isActive) {
          setUsers(onlineUsers)
          setError('')
        }
      } catch (requestError) {
        if (isActive) setError(requestError.message)
      } finally {
        if (isActive) {
          timerId = window.setTimeout(refreshUsers, PRESENCE_REFRESH_INTERVAL)
        }
      }
    }

    void refreshUsers()
    return () => {
      isActive = false
      window.clearTimeout(timerId)
    }
  }, [])

  return { users, error }
}

export function OnlineUsers({ users, error }) {
  return (
    <aside className="online-users" aria-label="Usuarios conectados">
      <h2>Usuarios <span>{users.length}</span></h2>
      <ul>
        {users.map((username) => (
          <li key={username}>
            <span className="online-user-indicator" aria-hidden="true" />
            <span>{username}</span>
          </li>
        ))}
      </ul>
      {users.length === 0 && !error && <p className="online-users-empty">No hay usuarios conectados.</p>}
      {error && <p className="online-users-error" role="status">{error}</p>}
    </aside>
  )
}
