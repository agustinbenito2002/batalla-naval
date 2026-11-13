const AUTH_TOKEN_KEY = 'battle-naval-auth-token'
const AUTH_USER_ID_KEY = 'battle-naval-user-id'

export function getBackendBaseUrl() {
  const configuredUrl = import.meta.env.VITE_BACKEND_URL?.trim()
  return configuredUrl || 'http://localhost:3000'
}

export function getBackendWebSocketUrl() {
  const url = new URL(getBackendBaseUrl())
  if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('VITE_BACKEND_URL debe usar http:// o https://.')
  }
  url.pathname = '/ws'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function getAuthUserId() {
  return localStorage.getItem(AUTH_USER_ID_KEY)
}

export async function requestBackend(path, { method = 'GET', body, signal, allowArray = false } = {}) {
  const headers = {}
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(new URL(path, `${getBackendBaseUrl()}/`), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(
      `No se pudo conectar con el backend en ${getBackendBaseUrl()}. Verifica que esté iniciado y que CORS permita el origen del frontend.`,
    )
  }

  const responseText = await response.text()
  let result = {}
  if (responseText) {
    try {
      result = JSON.parse(responseText)
    } catch {
      if (response.status === 404 && path === '/api/perfiles') {
        throw new Error('El backend no tiene habilitada la ruta POST /api/perfiles.')
      }
      throw new Error('El backend devolvió una respuesta que no es JSON.')
    }
  }

  if (!result || typeof result !== 'object' || (!allowArray && Array.isArray(result))) {
    throw new Error('El backend devolvió una respuesta JSON no válida.')
  }

  if (!response.ok) {
    const message = result.message || result.error
    if (response.status === 404 && path === '/api/perfiles') {
      throw new Error('El backend no tiene habilitada la ruta POST /api/perfiles.')
    }
    throw new Error(message || `El backend respondió con HTTP ${response.status}.`)
  }

  return result
}

export function saveAuthToken(token) {
  if (typeof token === 'string' && token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY)
  }
}

export function saveAuthUserId(userId) {
  if (typeof userId === 'string' && userId.trim()) {
    localStorage.setItem(AUTH_USER_ID_KEY, userId.trim())
  } else {
    localStorage.removeItem(AUTH_USER_ID_KEY)
  }
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_USER_ID_KEY)
}
