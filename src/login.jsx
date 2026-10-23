import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './login.css'

function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [message, setMessage] = useState('')

  const login = (event) => {
    event.preventDefault()
    const registeredUsers = JSON.parse(localStorage.getItem('battle-naval-users') || '[]')

    if (!registeredUsers.some((user) => user.username === username.trim() && user.password === password)) {
      setMessage('Usuario o contraseña incorrectos.')
      return
    }

    localStorage.setItem('battle-naval-current-user', username.trim())
    window.location.href = '/main.html'
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
            <button className="btn btn-primary form-button" type="submit">confirmar</button>
            <button
              className="btn btn-secondary form-button"
              type="button"
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
