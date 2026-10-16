import 'bootstrap/dist/css/bootstrap.min.css'
import './style.css'
import { showModal } from './modal.js'

const username = localStorage.getItem('battle-naval-current-user') || 'nombre usuario'

document.querySelector('#app').innerHTML = `
<main class="game-shell">
  <aside class="menu-panel" aria-label="Menú principal">
    <button class="btn btn-secondary menu-button username" type="button">${username}</button>
    <nav class="menu-actions" aria-label="Opciones de partida">
      <button class="btn btn-primary menu-button battle-option" type="button">PARTIDA ALEATORIA</button>
      <button class="btn btn-info menu-button battle-option" type="button">DESAFÍO A USUARIO</button>
      <button class="btn btn-success menu-button battle-option" type="button">MODO ESPECTADOR</button>
    </nav>
    <button class="btn btn-danger menu-button exit-button" type="button">SALIR</button>
  </aside>

  <section class="chat-panel" aria-label="Chat">
    <div class="chat-history" id="chat-history">
      <h1>chat</h1>
    </div>
    <form class="chat-compose" id="chat-form">
      <input id="chat-input" type="text" placeholder="escribe en el chat" autocomplete="off" aria-label="Escribe en el chat" />
      <button class="btn btn-primary send-button" type="submit" aria-label="Enviar mensaje" title="Enviar mensaje">&#10148;</button>
    </form>
  </section>
</main>
`

document.querySelectorAll('.menu-button').forEach((button) => {
  button.addEventListener('click', () => button.classList.toggle('is-selected'))
})

document.querySelectorAll('.battle-option').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.textContent.trim() === 'modo espectador' ? '?mode=spectator' : ''
    window.location.href = `/battle.html${mode}`
  })
})

document.querySelector('.exit-button').addEventListener('click', async () => {
  if (await showModal('¿Seguro que quieres cerrar sesión?', {
    title: 'Cerrar sesión',
    confirmText: 'Salir',
    cancelText: 'Cancelar',
  })) {
    localStorage.removeItem('battle-naval-current-user')
    window.location.href = '/'
  }
})

const chatForm = document.querySelector('#chat-form')
const chatInput = document.querySelector('#chat-input')
const chatHistory = document.querySelector('#chat-history')

chatForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const message = chatInput.value.trim()

  if (!message) return

  const messageElement = document.createElement('p')
  messageElement.className = 'chat-message'
  messageElement.textContent = `${username}: ${message}`
  chatHistory.append(messageElement)
  chatInput.value = ''
  chatInput.focus()
})
