import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './login.css'
import { requestBackend, saveAuthToken } from './backendApi.js'

function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const login = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage('')

    try {
      const result = await requestBackend('/api/auth/login', {
        method: 'POST',
        body: { username: username.trim(), password },
      })
      const loggedInUsername = result.user?.username || username.trim()
      localStorage.setItem('battle-naval-current-user', loggedInUsername)
      saveAuthToken(result.accessToken || result.token || result.session?.access_token)
      window.location.href = '/main.html'
    } catch (error) {
      setMessage(error.message)
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-window" aria-labelledby="login-title">
        <h1 id="login-title">iniciar sesion</h1>
        <form className="login-form" onSubmit={login}>
          <label htmlFor="username">ingresar usuario</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <label htmlFor="password">ingresar contraseña</label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={passwordVisible ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              className="btn btn-link password-toggle"
              type="button"
              aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              title={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? '◌' : '◉'}
            </button>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary form-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'conectando…' : 'confirmar'}
            </button>
            <button
              className="btn btn-secondary form-button"
              type="button"
              disabled={isSubmitting}
              onClick={() => { window.location.href = '/register.html' }}
            >
              registrar usuario
            </button>
          </div>
          <p className="form-message" aria-live="polite">{message}</p>
        </form>
      </section>
    </main>
  )
}

createRoot(document.querySelector('#login-app')).render(<LoginPage />)
