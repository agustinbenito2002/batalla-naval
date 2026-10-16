import 'bootstrap/dist/css/bootstrap.min.css'
import './login.css'

document.querySelector('#register-app').innerHTML = `
  <main class="login-page">
    <section class="login-window" aria-labelledby="register-title">
      <h1 id="register-title">puedes registrar tu usuario</h1>

      <form class="login-form" id="register-form">
        <label for="register-username">ingresar usuario</label>
        <input id="register-username" name="username" type="text" autocomplete="username" />

        <label for="register-password">ingresar contraseña</label>
        <div class="password-field">
          <input id="register-password" name="password" type="password" autocomplete="new-password" />
          <button class="btn btn-link password-toggle" type="button" data-password-target="register-password" aria-label="Mostrar contraseña" title="Mostrar contraseña">◉</button>
        </div>

        <label for="confirm-password">confirmar contraseña</label>
        <div class="password-field">
          <input id="confirm-password" name="confirm-password" type="password" autocomplete="new-password" />
          <button class="btn btn-link password-toggle" type="button" data-password-target="confirm-password" aria-label="Mostrar contraseña" title="Mostrar contraseña">◉</button>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary form-button" type="submit">registrar usuario</button>
          <button class="btn btn-secondary form-button secondary-button" id="back-to-login" type="button">volver a iniciar sesión</button>
        </div>
        <p class="form-message" id="register-message" aria-live="polite"></p>
      </form>

      <div class="registration-success" id="registration-success" role="dialog" aria-modal="true" aria-labelledby="success-title" hidden>
        <div class="registration-success-window">
          <h2 id="success-title">Usuario registrado exitosamente</h2>
          <p>¿Qué deseas hacer ahora?</p>
          <div class="form-actions">
            <button class="btn btn-primary form-button" id="success-login" type="button">iniciar sesión</button>
            <button class="btn btn-secondary form-button secondary-button" id="continue-site" type="button">continuar en el sitio</button>
          </div>
        </div>
      </div>
    </section>
  </main>
`

const registerForm = document.querySelector('#register-form')
const registerMessage = document.querySelector('#register-message')
const registrationSuccess = document.querySelector('#registration-success')
let registeredUsername = ''

registerForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const username = document.querySelector('#register-username').value.trim()
  const password = document.querySelector('#register-password').value
  const confirmPassword = document.querySelector('#confirm-password').value

  if (!username || !password || !confirmPassword) {
    registerMessage.textContent = 'Completa el usuario y ambos campos de contraseña.'
    return
  }

  if (password !== confirmPassword) {
    registerMessage.textContent = 'Las contraseñas no coinciden.'
    return
  }

  const registeredUsers = JSON.parse(localStorage.getItem('battle-naval-users') || '[]')

  if (registeredUsers.some((user) => user.username === username)) {
    registerMessage.textContent = 'Ese nombre de usuario ya está registrado.'
    return
  }

  registeredUsername = username
  registeredUsers.push({ username, password })
  localStorage.setItem('battle-naval-users', JSON.stringify(registeredUsers))
  localStorage.setItem('battle-naval-current-user', username)
  registerForm.hidden = true
  registrationSuccess.hidden = false
})

document.querySelectorAll('.password-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const passwordInput = document.querySelector(`#${button.dataset.passwordTarget}`)
    const isVisible = passwordInput.type === 'text'
    passwordInput.type = isVisible ? 'password' : 'text'
    button.textContent = isVisible ? '◉' : '◌'
    button.setAttribute('aria-label', isVisible ? 'Mostrar contraseña' : 'Ocultar contraseña')
    button.setAttribute('title', isVisible ? 'Mostrar contraseña' : 'Ocultar contraseña')
  })
})

document.querySelector('#back-to-login').addEventListener('click', () => {
  window.location.href = '/'
})

document.querySelector('#success-login').addEventListener('click', () => {
  window.location.href = '/'
})

document.querySelector('#continue-site').addEventListener('click', () => {
  window.location.href = '/main.html'
})