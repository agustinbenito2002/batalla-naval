import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './login.css'

function PasswordField({ id, label, value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false)

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
        />
        <button
          className="btn btn-link password-toggle"
          type="button"
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? '◌' : '◉'}
        </button>
      </div>
    </>
  )
}

function RegisterPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [registered, setRegistered] = useState(false)

  const register = (event) => {
    event.preventDefault()
    const cleanUsername = username.trim()

    if (!cleanUsername || !password || !confirmPassword) {
      setMessage('Completa el usuario y ambos campos de contraseña.')
      return
    }

    if (password !== confirmPassword) {
      setMessage('Las contraseñas no coinciden.')
      return
    }

    const registeredUsers = JSON.parse(localStorage.getItem('battle-naval-users') || '[]')
    if (registeredUsers.some((user) => user.username === cleanUsername)) {
      setMessage('Ese nombre de usuario ya está registrado.')
      return
    }

    registeredUsers.push({ username: cleanUsername, password })
    localStorage.setItem('battle-naval-users', JSON.stringify(registeredUsers))
    localStorage.setItem('battle-naval-current-user', cleanUsername)
    setRegistered(true)
  }

  return (
    <main className="login-page">
      <section className="login-window" aria-labelledby="register-title">
        <h1 id="register-title">puedes registrar tu usuario</h1>
        {!registered ? (
          <form className="login-form" onSubmit={register}>
            <label htmlFor="register-username">ingresar usuario</label>
            <input
              id="register-username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <PasswordField
              id="register-password"
              label="ingresar contraseña"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <PasswordField
              id="confirm-password"
              label="confirmar contraseña"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <div className="form-actions">
              <button className="btn btn-primary form-button" type="submit">registrar usuario</button>
              <button
                className="btn btn-secondary form-button secondary-button"
                type="button"
                onClick={() => { window.location.href = '/' }}
              >
                volver a iniciar sesión
              </button>
            </div>
            <p className="form-message" aria-live="polite">{message}</p>
          </form>
        ) : (
          <div className="registration-success" role="dialog" aria-modal="true" aria-labelledby="success-title">
            <div className="registration-success-window">
              <h2 id="success-title">Usuario registrado exitosamente</h2>
              <p>¿Qué deseas hacer ahora?</p>
              <div className="form-actions">
                <button
                  className="btn btn-primary form-button"
                  type="button"
                  onClick={() => { window.location.href = '/' }}
                >
                  iniciar sesión
                </button>
                <button
                  className="btn btn-secondary form-button secondary-button"
                  type="button"
                  onClick={() => { window.location.href = '/main.html' }}
                >
                  continuar en el sitio
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

createRoot(document.querySelector('#register-app')).render(<RegisterPage />)
