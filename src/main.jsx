import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './style.css'
import { showModal } from './modal.js'

const username = localStorage.getItem('battle-naval-current-user') || 'nombre usuario'

function MainMenu() {
  const [selectedButtons, setSelectedButtons] = useState([])
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const chatInputRef = useRef(null)

  const toggleSelected = (buttonName) => {
    setSelectedButtons((current) => current.includes(buttonName)
      ? current.filter((name) => name !== buttonName)
      : [...current, buttonName])
  }

  const startBattle = (mode) => {
    window.location.href = mode === 'spectator'
      ? '/battle.html?mode=spectator'
      : '/battle.html'
  }

  const exitSession = async () => {
    if (await showModal('¿Seguro que quieres cerrar sesión?', {
      title: 'Cerrar sesión',
      confirmText: 'Salir',
      cancelText: 'Cancelar',
    })) {
      localStorage.removeItem('battle-naval-current-user')
      window.location.href = '/'
    }
  }

  const sendMessage = (event) => {
    event.preventDefault()
    const trimmedMessage = message.trim()

    if (!trimmedMessage) return

    setMessages((current) => [...current, `${username}: ${trimmedMessage}`])
    setMessage('')
    chatInputRef.current?.focus()
  }

  return (
    <main className="game-shell">
      <aside className="menu-panel" aria-label="Menú principal">
        <button
          className={`btn btn-secondary menu-button username${selectedButtons.includes('username') ? ' is-selected' : ''}`}
          type="button"
          onClick={() => toggleSelected('username')}
        >
          {username}
        </button>
        <nav className="menu-actions" aria-label="Opciones de partida">
          <button
            className={`btn btn-primary menu-button battle-option${selectedButtons.includes('random') ? ' is-selected' : ''}`}
            type="button"
            onClick={() => {
              toggleSelected('random')
              startBattle('random')
            }}
          >
            PARTIDA ALEATORIA
          </button>
          <button
            className={`btn btn-info menu-button battle-option${selectedButtons.includes('challenge') ? ' is-selected' : ''}`}
            type="button"
            onClick={() => {
              toggleSelected('challenge')
              startBattle('challenge')
            }}
          >
            DESAFÍO A USUARIO
          </button>
          <button
            className={`btn btn-success menu-button battle-option${selectedButtons.includes('spectator') ? ' is-selected' : ''}`}
            type="button"
            onClick={() => {
              toggleSelected('spectator')
              startBattle('spectator')
            }}
          >
            MODO ESPECTADOR
          </button>
        </nav>
        <button
          className={`btn btn-danger menu-button exit-button${selectedButtons.includes('exit') ? ' is-selected' : ''}`}
          type="button"
          onClick={() => {
            toggleSelected('exit')
            void exitSession()
          }}
        >
          SALIR
        </button>
      </aside>

      <section className="chat-panel" aria-label="Chat">
        <div className="chat-history" id="chat-history" aria-live="polite">
          <h1>chat</h1>
          {messages.map((chatMessage, index) => (
            <p className="chat-message" key={`${index}-${chatMessage}`}>{chatMessage}</p>
          ))}
        </div>
        <form className="chat-compose" id="chat-form" onSubmit={sendMessage}>
          <input
            ref={chatInputRef}
            id="chat-input"
            type="text"
            placeholder="escribe en el chat"
            autoComplete="off"
            aria-label="Escribe en el chat"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button className="btn btn-primary send-button" type="submit" aria-label="Enviar mensaje" title="Enviar mensaje">&#10148;</button>
        </form>
      </section>
    </main>
  )
}

createRoot(document.querySelector('#app')).render(<MainMenu />)
