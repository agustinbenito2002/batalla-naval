import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './battle.css'
import { useModal } from './Modal.jsx'

const BOARD_SIZE = 15
const BOARD_CELLS = Array.from({ length: BOARD_SIZE ** 2 }, (_, index) => index)
const COLUMN_LABELS = 'ABCDEFGHIJKLMNO'.split('')
const SHIP_LENGTHS = [2, 3, 4]
const PLACEMENT_ORIENTATIONS = ['horizontal', 'vertical', 'horizontal-reverse', 'vertical-reverse']
const BOMBARDMENT_OFFSETS = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 5 }, (_, column) => [row - 2, column - 2]),
).flat().filter(([row, column]) => (row + column) % 2 === 0)
const ENEMY_SHIPS = [
  [[2, 3], [2, 4], [2, 5], [2, 6]],
  [[7, 8], [7, 9], [7, 10], [7, 11]],
  [[12, 2], [12, 3], [12, 4], [12, 5]],
].map((ship) => ship.map(([row, column]) => row * BOARD_SIZE + column))
const ENEMY_FLEET_CELLS = ENEMY_SHIPS.flat()
const SPECTATOR_FLEET_CELLS = [
  [0, 2], [0, 3], [0, 4], [2, 2], [3, 2], [4, 2], [6, 2],
  [7, 2], [8, 2], [8, 3], [8, 4], [5, 5], [6, 5], [7, 5],
].map(([row, column]) => row * BOARD_SIZE + column)

const getAttackOffsets = (attackType) => {
  if (attackType === 'cross') return [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
  if (attackType === 'bombardment') return BOMBARDMENT_OFFSETS
  return [[0, 0]]
}

const getAffectedCells = (center, offsets) => {
  const centerRow = Math.floor(center / BOARD_SIZE)
  const centerColumn = center % BOARD_SIZE
  return offsets.flatMap(([rowOffset, columnOffset]) => {
    const row = centerRow + rowOffset
    const column = centerColumn + columnOffset
    return row < 0 || row >= BOARD_SIZE || column < 0 || column >= BOARD_SIZE
      ? []
      : [row * BOARD_SIZE + column]
  })
}

function BattlePage() {
  const isSpectatorMode = new URLSearchParams(window.location.search).get('mode') === 'spectator'
  const username = localStorage.getItem('battle-naval-current-user') || 'Capitán jugador'
  const [ships, setShips] = useState([])
  const [selectedShipLength, setSelectedShipLength] = useState(2)
  const [orientationIndex, setOrientationIndex] = useState(0)
  const [isShipPlaced, setIsShipPlaced] = useState(false)
  const [placementMessage, setPlacementMessage] = useState('')
  const [shipPreview, setShipPreview] = useState([])
  const [selectedAttack, setSelectedAttack] = useState('normal')
  const [attackPreview, setAttackPreview] = useState([])
  const [enemyHits, setEnemyHits] = useState(() => new Set())
  const [playerHits, setPlayerHits] = useState(() => new Set())
  const [attackedEnemyCells, setAttackedEnemyCells] = useState(() => new Set())
  const [enemyAttackedCells, setEnemyAttackedCells] = useState(() => new Set())
  const [turnNumber, setTurnNumber] = useState(1)
  const [hasGameEnded, setHasGameEnded] = useState(false)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const { dialog, showModal } = useModal()

  const placedShipCells = ships.flat()
  const shipCount = ships.length
  const selectedOffsets = getAttackOffsets(selectedAttack)

  const previewShipAt = (startCell, length = selectedShipLength, direction = orientationIndex) => {
    const row = Math.floor(startCell / BOARD_SIZE)
    const column = startCell % BOARD_SIZE
    const cells = Array.from({ length }, (_, index) => {
      const nextRow = row + (direction === 1 ? index : direction === 3 ? -index : 0)
      const nextColumn = column + (direction === 0 ? index : direction === 2 ? -index : 0)
      return nextRow < 0 || nextRow >= BOARD_SIZE || nextColumn < 0 || nextColumn >= BOARD_SIZE
        ? -1
        : nextRow * BOARD_SIZE + nextColumn
    })

    setShipPreview(
      cells.every((cell) => cell >= 0 && !placedShipCells.includes(cell))
        ? cells
        : [],
    )
  }

  const undoLastShip = () => {
    if (isShipPlaced || ships.length === 0) return
    const lastShip = ships[ships.length - 1]
    setShips((current) => current.slice(0, -1))
    setSelectedShipLength(lastShip.length)
    setShipPreview([])
    setPlacementMessage('')
  }

  const finishGame = async (resultMessage) => {
    if (hasGameEnded) return
    setHasGameEnded(true)
    const shouldLeave = await showModal(resultMessage, {
      title: 'Fin de la partida',
      confirmText: 'Salir',
      cancelText: 'Continuar aquí',
    })
    if (shouldLeave) window.location.href = '/main.html'
  }

  const placeShip = async (cell) => {
    if (isSpectatorMode || isShipPlaced) return
    if (shipCount >= 4) {
      await showModal('Máximo de 4 barcos alcanzado. Deshaz el último barco para cambiar tu flota.', {
        title: 'Límite de barcos',
      })
      return
    }

    const cells = previewShipAtWithoutState(cell, selectedShipLength, orientationIndex)
    if (!cells.length) {
      await showModal('No se puede colocar ahí: está fuera del tablero o en una zona no válida.', {
        title: 'Posición no válida',
      })
      return
    }
    if (cells.some((shipCell) => placedShipCells.includes(shipCell))) {
      await showModal('No se puede colocar ahí: la casilla está ocupada por otro barco.', {
        title: 'Posición ocupada',
      })
      return
    }

    const nextShips = [...ships, cells]
    setShips(nextShips)
    setShipPreview([])
    setPlacementMessage('')

    if (nextShips.length === 4) {
      const confirmed = await showModal('Has llegado al límite de 4 barcos. ¿Quieres confirmar tu flota?', {
        title: 'Confirmar flota',
        confirmText: 'Confirmar',
        cancelText: 'Volver a colocar',
      })
      if (!confirmed) {
        setShips((current) => current.slice(0, -1))
        setSelectedShipLength(cells.length)
        return
      }
      setIsShipPlaced(true)
    }
  }

  const attack = async (cell) => {
    if (isSpectatorMode || hasGameEnded) return
    if (!isShipPlaced) {
      setPlacementMessage('Primero completa tu flota de 4 barcos antes de disparar.')
      return
    }

    const targets = getAffectedCells(cell, selectedOffsets)
    const newHits = new Set(enemyHits)
    const newAttackedCells = new Set(attackedEnemyCells)
    targets.forEach((target) => {
      newAttackedCells.add(target)
      if (ENEMY_FLEET_CELLS.includes(target)) newHits.add(target)
    })
    setEnemyHits(newHits)
    setAttackedEnemyCells(newAttackedCells)

    if (ENEMY_FLEET_CELLS.every((target) => newHits.has(target))) {
      await finishGame('¡Has ganado la partida! Destruiste el barco enemigo. ¿Quieres salir de la partida?')
      return
    }

    const availableTargets = BOARD_CELLS.filter((target) => !enemyAttackedCells.has(target))
    if (availableTargets.length === 0) return

    const enemyTarget = availableTargets[Math.floor(Math.random() * availableTargets.length)]
    const newEnemyAttackedCells = new Set(enemyAttackedCells)
    const newPlayerHits = new Set(playerHits)
    getAffectedCells(enemyTarget, BOMBARDMENT_OFFSETS).forEach((target) => {
      newEnemyAttackedCells.add(target)
      if (placedShipCells.includes(target)) newPlayerHits.add(target)
    })
    setEnemyAttackedCells(newEnemyAttackedCells)
    setPlayerHits(newPlayerHits)
    setTurnNumber((turn) => turn + 1)

    const fleetDestroyed = ships.length > 0
      && ships.every((ship) => ship.every((target) => newPlayerHits.has(target)))
    if (fleetDestroyed) {
      await finishGame('¡Has perdido la partida! Tu flota ha sido destruida. ¿Quieres salir de la partida?')
    }
  }

  const submitMessage = (event) => {
    event.preventDefault()
    const trimmedMessage = message.trim()
    if (!trimmedMessage) return
    setMessages((current) => [...current, trimmedMessage])
    setMessage('')
  }

  const leaveBattle = async () => {
    if (await showModal('¿Seguro que quieres salir de la batalla?', {
      title: 'Salir de la batalla',
      confirmText: 'Salir',
      cancelText: 'Seguir jugando',
    })) {
      window.location.href = '/main.html'
    }
  }

  return (
    <div id="battle-app" className={isSpectatorMode ? 'spectator-mode' : ''}>
      <main className="battle-layout">
        <section className="board-area">
          <header className="battle-header">
            <div className="player-card">
              <span className="status-dot" />
              <strong>{username}</strong>
              <small>Tu flota</small>
            </div>
            <div className="turn-badge">Turno {turnNumber}</div>
            <div className="player-card enemy-card">
              <small>Rival en línea</small>
              <strong>Almirante enemigo</strong>
              <span className="status-dot" />
            </div>
          </header>

          <button className="btn btn-danger leave-battle-button" type="button" onClick={leaveBattle}>
            salir batalla
          </button>

          {!isSpectatorMode && (
            <div className="placement-toolbar">
              <div className="placement-options">
                {SHIP_LENGTHS.map((length) => (
                  <button
                    className={`btn btn-outline-primary ship-size-button${length === selectedShipLength ? ' selected' : ''}`}
                    data-length={length}
                    type="button"
                    key={length}
                    disabled={isShipPlaced || shipCount >= 4}
                    onClick={() => {
                      setSelectedShipLength(length)
                      setShipPreview([])
                    }}
                  >
                    {length} casillas
                  </button>
                ))}
                <button
                  className="btn btn-outline-danger"
                  type="button"
                  disabled={isShipPlaced || shipCount === 0}
                  onClick={undoLastShip}
                >
                  Deshacer último barco
                </button>
              </div>
              <span id="placement-status">
                {isShipPlaced
                  ? 'Tu flota está completa. Puedes lanzar tus misiles.'
                  : placementMessage || (shipCount >= 4
                    ? 'Flota completa. Deshaz el último barco para cambiar tu flota o confirma para continuar.'
                    : `Barcos colocados: ${shipCount}/4. Longitud actual: ${selectedShipLength} casillas.`)}
              </span>
            </div>
          )}

          <div className="boards">
            <section className="board-card">
              <div className="board-title">
                <span>{isSpectatorMode ? 'Jugador 1' : 'Estado actual del mapa del jugador'}</span>
                <b>⚓</b>
              </div>
              <div className="grid-labels"><span />{COLUMN_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="board-with-numbers">
                <div className="row-labels">
                  {COLUMN_LABELS.map((_, index) => <span key={index}>{index + 1}</span>)}
                </div>
                <div className="sea-grid fleet-grid">
                  {BOARD_CELLS.map((cell) => {
                    const hasShip = isSpectatorMode
                      ? SPECTATOR_FLEET_CELLS.includes(cell)
                      : placedShipCells.includes(cell)
                    const isHit = playerHits.has(cell) && hasShip
                    return (
                      <button
                        className={[
                          'sea-cell',
                          hasShip && 'ship-cell',
                          !isSpectatorMode && shipPreview.includes(cell) && 'ship-preview',
                          isHit && 'hit-cell',
                        ].filter(Boolean).join(' ')}
                        type="button"
                        key={cell}
                        aria-label={`Casilla ${cell + 1} de tu flota`}
                        disabled={isSpectatorMode || isShipPlaced}
                        onMouseEnter={() => !isSpectatorMode && !isShipPlaced && previewShipAt(cell)}
                        onMouseLeave={() => setShipPreview([])}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          if (isSpectatorMode || isShipPlaced) return
                          const nextIndex = (orientationIndex + 1) % PLACEMENT_ORIENTATIONS.length
                          setOrientationIndex(nextIndex)
                          previewShipAt(cell, selectedShipLength, nextIndex)
                          setPlacementMessage(`Barco rotado: ${PLACEMENT_ORIENTATIONS[nextIndex]}. Click izquierdo para colocar.`)
                        }}
                        onClick={() => placeShip(cell)}
                      />
                    )
                  })}
                </div>
              </div>
              <p className="board-hint">{isSpectatorMode ? 'Flota del jugador 1' : 'Tu flota está lista para el combate'}</p>
            </section>

            <section className="board-card">
              <div className="board-title">
                <span>{isSpectatorMode ? 'Jugador 2' : 'Mapa enemigo'}</span>
                <b>?</b>
              </div>
              <div className="grid-labels"><span />{COLUMN_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="board-with-numbers">
                <div className="row-labels">
                  {COLUMN_LABELS.map((_, index) => <span key={index}>{index + 1}</span>)}
                </div>
                <div className="sea-grid enemy-state-grid">
                  {BOARD_CELLS.map((cell) => {
                    const isHit = enemyHits.has(cell)
                    const sunkenShip = ENEMY_SHIPS.some((ship) =>
                      ship.includes(cell) && ship.every((shipCell) => enemyHits.has(shipCell)))
                    const isSpectatorShip = isSpectatorMode && ENEMY_FLEET_CELLS.includes(cell)
                    return (
                      <button
                        className={[
                          'sea-cell',
                          'unknown-cell',
                          (isSpectatorShip || sunkenShip) && 'ship-cell',
                          attackedEnemyCells.has(cell) && 'attacked-cell',
                          isHit && !sunkenShip && 'enemy-hit-cell',
                          sunkenShip && 'sunken-cell',
                          attackPreview.includes(cell) && 'attack-preview',
                        ].filter(Boolean).join(' ')}
                        type="button"
                        key={cell}
                        aria-label={`${isSpectatorMode ? 'Casilla' : 'Atacar casilla'} ${cell + 1} del jugador 2`}
                        disabled={isSpectatorMode || !isShipPlaced || hasGameEnded}
                        onMouseEnter={() => setAttackPreview(getAffectedCells(cell, selectedOffsets))}
                        onMouseLeave={() => setAttackPreview([])}
                        onClick={() => attack(cell)}
                      />
                    )
                  })}
                </div>
              </div>
              <p className="board-hint">
                {isSpectatorMode ? 'Flota del jugador 2' : 'Selecciona una casilla para atacar; los impactos se muestran aquí'}
              </p>
            </section>
          </div>

          {!isSpectatorMode && (
            <section className="ammo-panel">
              <div className="section-heading">
                <h2>Municiones</h2>
                <span>selecciona un ataque</span>
              </div>
              <div className="ammo-list">
                <button
                  className={`btn btn-outline-secondary ammo-button${selectedAttack === 'normal' ? ' selected' : ''}`}
                  type="button"
                  disabled={hasGameEnded}
                  onClick={() => setSelectedAttack('normal')}
                >
                  <span className="ammo-icon">✦</span>
                  <span><strong>Ataque normal</strong><small>Gratis e infinito</small></span>
                </button>
                <button
                  className={`btn btn-outline-secondary ammo-button${selectedAttack === 'cross' ? ' selected' : ''}`}
                  type="button"
                  disabled={hasGameEnded}
                  onClick={() => setSelectedAttack('cross')}
                >
                  <span className="ammo-icon">◈</span>
                  <span><strong>Ataque en cruz</strong><small>Ignora corazas 3x3</small></span>
                </button>
                <button
                  className={`btn btn-outline-secondary ammo-button${selectedAttack === 'bombardment' ? ' selected' : ''}`}
                  type="button"
                  disabled={hasGameEnded}
                  onClick={() => setSelectedAttack('bombardment')}
                >
                  <span className="ammo-icon">✚</span>
                  <span><strong>Bombardeo</strong><small>Imposible de interceptar en área 5x5</small></span>
                </button>
              </div>
            </section>
          )}
        </section>

        <aside className="chat-panel">
          <div className="chat-topbar"><strong>Batalla naval</strong><span>2 usuarios</span></div>
          <div className="chat-log" aria-live="polite">
            {messages.map((chatMessage, index) => (
              <p key={`${index}-${chatMessage}`}>
                <b className="blue-name">{username}:</b> {chatMessage}
              </p>
            ))}
          </div>
          <form className="chat-form" onSubmit={submitMessage}>
            <input
              type="text"
              placeholder="Escribe en el chat..."
              autoComplete="off"
              aria-label="Escribe en el chat"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button className="btn btn-primary" type="submit" aria-label="Enviar mensaje">➤</button>
          </form>
        </aside>
      </main>
      {dialog}
    </div>
  )
}

function previewShipAtWithoutState(startCell, length, direction) {
  const row = Math.floor(startCell / BOARD_SIZE)
  const column = startCell % BOARD_SIZE
  const cells = Array.from({ length }, (_, index) => {
    const nextRow = row + (direction === 1 ? index : direction === 3 ? -index : 0)
    const nextColumn = column + (direction === 0 ? index : direction === 2 ? -index : 0)
    return nextRow < 0 || nextRow >= BOARD_SIZE || nextColumn < 0 || nextColumn >= BOARD_SIZE
      ? -1
      : nextRow * BOARD_SIZE + nextColumn
  })
  return cells.some((cell) => cell < 0) ? [] : cells
}

createRoot(document.querySelector('#battle-app')).render(<BattlePage />)
