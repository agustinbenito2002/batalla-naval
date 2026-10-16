import 'bootstrap/dist/css/bootstrap.min.css'
import './login.css'

document.querySelector('#login-app').innerHTML = `
  <main class="login-page">
    <section class="login-window" aria-labelledby="login-title">
      <h1 id="login-title">iniciar sesion</h1>

      <form class="login-form" id="login-form">
        <label for="username">ingresar usuario</label>
        <input id="username" name="username" type="text" autocomplete="off" value="" />

        <label for="password">ingresar contraseña</label>
        <div class="password-field">
          <input id="password" name="password" type="password" autocomplete="off" value="" />
          <button class="btn btn-link password-toggle" id="toggle-password" type="button" aria-label="Mostrar contraseña" title="Mostrar contraseña">◉</button>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary form-button" type="submit">confirmar</button>
          <button class="btn btn-secondary form-button" id="register-button" type="button">registrar usuario</button>
        </div>
        <p class="form-message" id="form-message" aria-live="polite"></p>
      </form>
    </section>
  </main>
`

document.querySelector('#login-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const username = document.querySelector('#username').value.trim()
  const password = document.querySelector('#password').value
  const formMessage = document.querySelector('#form-message')
  const registeredUsers = JSON.parse(localStorage.getItem('battle-naval-users') || '[]')

  if (!registeredUsers.some((user) => user.username === username && user.password === password)) {
    formMessage.textContent = 'Usuario o contraseña incorrectos.'
    return
  }

  localStorage.setItem('battle-naval-current-user', username)
  window.location.href = '/main.html'
})

document.querySelector('#register-button').addEventListener('click', () => {
  window.location.href = '/register.html'
})

document.querySelector('#toggle-password').addEventListener('click', (event) => {
  const passwordInput = document.querySelector('#password')
  const isVisible = passwordInput.type === 'text'
  passwordInput.type = isVisible ? 'password' : 'text'
  event.currentTarget.textContent = isVisible ? '◉' : '◌'
  event.currentTarget.setAttribute('aria-label', isVisible ? 'Mostrar contraseña' : 'Ocultar contraseña')
  event.currentTarget.setAttribute('title', isVisible ? 'Mostrar contraseña' : 'Ocultar contraseña')
})
