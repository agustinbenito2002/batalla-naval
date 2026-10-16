import 'bootstrap/dist/css/bootstrap.min.css'
import './battle.css'
import { showModal } from './modal.js'

const BOARD_SIZE = 15
const attackCells = Array.from({ length: BOARD_SIZE ** 2 }, (_, index) => index)
const fleetCells = [[0, 2], [0, 3], [0, 4], [2, 2], [3, 2], [4, 2], [6, 2], [7, 2], [8, 2], [8, 3], [8, 4], [5, 5], [6, 5], [7, 5]]
  .map(([row, column]) => row * BOARD_SIZE + column)

const app = document.querySelector('#battle-app')
const isSpectatorMode = new URLSearchParams(window.location.search).get('mode') === 'spectator'
app.classList.toggle('spectator-mode', isSpectatorMode)
const placementShipLengths = [2, 3, 4]
const maxShipsToPlace = 4
const placementOrientations = ['horizontal', 'vertical', 'horizontal-reverse', 'vertical-reverse']
const bombardmentOffsets = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => [row - 2, column - 2]))
  .flat()
  .filter(([row, column]) => (row + column) % 2 === 0)
let isShipPlaced = false
let selectedShipLength = 2
let shipsPlaced = 0
let placementOrientation = placementOrientations[0]
let placedShipCells = []
let playerShips = []
let turnNumber = 1
const enemyShips = [
  [[2, 3], [2, 4], [2, 5], [2, 6]],
  [[7, 8], [7, 9], [7, 10], [7, 11]],
  [[12, 2], [12, 3], [12, 4], [12, 5]],
]
const enemyFleetCells = enemyShips
  .flat()
  .map(([row, column]) => row * BOARD_SIZE + column)
const enemyHits = new Set()
let hasShownVictoryPopup = false
let hasGameEnded = false
const enemyAttackedCells = new Set()

const getOccupiedFleetCells = () => [...placedShipCells]
const playerHits = new Set()

const updatePlacementStatus = () => {
  const placementStatus = document.querySelector('#placement-status')
  const shipButtons = document.querySelectorAll('.ship-size-button')
  const undoButton = document.querySelector('#undo-placement')

  if (!placementStatus) return

  placementStatus.textContent = isShipPlaced
    ? 'Tu flota está completa. Puedes lanzar tus misiles.'
    : shipsPlaced >= maxShipsToPlace
      ? 'Flota completa. Deshaz el último barco para cambiar tu flota o confirma para continuar.'
      : `Barcos colocados: ${shipsPlaced}/${maxShipsToPlace}. Longitud actual: ${selectedShipLength} casillas.`

  shipButtons.forEach((button) => {
    const length = Number(button.dataset.length)
    button.classList.toggle('selected', length === selectedShipLength && !isShipPlaced)
    button.disabled = isShipPlaced || shipsPlaced >= maxShipsToPlace
  })

  if (undoButton) undoButton.disabled = isShipPlaced || shipsPlaced === 0

  document.querySelectorAll('.enemy-state-grid .sea-cell').forEach((cell) => {
    cell.disabled = !isShipPlaced || hasGameEnded
  })
}

const undoLastShip = () => {
  if (isShipPlaced || playerShips.length === 0) return

  const lastShip = playerShips.pop()
  const lastShipCells = new Set(lastShip)
  placedShipCells = placedShipCells.filter((cellIndex) => !lastShipCells.has(cellIndex))
  lastShip.forEach((cellIndex) => {
    const fleetCell = document.querySelector(`.fleet-grid .sea-cell[data-cell="${cellIndex}"]`)
    if (fleetCell) fleetCell.classList.remove('ship-cell', 'ship-preview')
  })
  shipsPlaced = playerShips.length
  selectedShipLength = lastShip.length
  clearPreview('.fleet-grid .sea-cell')
  updatePlacementStatus()
}

const canPlaceShip = (startCell, shipLength = selectedShipLength) => {
  const startRow = Math.floor(startCell / BOARD_SIZE)
  const startColumn = startCell % BOARD_SIZE
  const cellsToPlace = []

  for (let index = 0; index < shipLength; index += 1) {
    let nextRow = startRow
    let nextColumn = startColumn

    if (placementOrientation === 'horizontal') nextColumn += index
    else if (placementOrientation === 'vertical') nextRow += index
    else if (placementOrientation === 'horizontal-reverse') nextColumn -= index
    else nextRow -= index

    if (nextRow < 0 || nextRow >= BOARD_SIZE || nextColumn < 0 || nextColumn >= BOARD_SIZE) return []

    cellsToPlace.push(nextRow * BOARD_SIZE + nextColumn)
  }

  return cellsToPlace
}

const getAttackPreviewCells = (centerCell) => {
  const selectedAttack = document.querySelector('.ammo-button.selected')?.dataset.attack || 'normal'
  const offsets = selectedAttack === 'cross'
    ? [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
    : selectedAttack === 'bombardment'
      ? bombardmentOffsets
      : [[0, 0]]

  const centerRow = Math.floor(centerCell / BOARD_SIZE)
  const centerColumn = centerCell % BOARD_SIZE
  const previewCells = []

  offsets.forEach(([rowOffset, columnOffset]) => {
    const row = centerRow + rowOffset
    const column = centerColumn + columnOffset
    if (row < 0 || row >= BOARD_SIZE || column < 0 || column >= BOARD_SIZE) return
    previewCells.push(row * BOARD_SIZE + column)
  })

  return previewCells
}

const clearPreview = (selector) => {
  document.querySelectorAll(selector).forEach((cell) => cell.classList.remove('ship-preview', 'attack-preview'))
}

const showShipPreview = (cellIndex) => {
  if (isShipPlaced) return
  clearPreview('.fleet-grid .sea-cell')
  const previewCells = canPlaceShip(cellIndex, selectedShipLength)
  if (!previewCells.length) return

  const occupiedByFleet = previewCells.some((cellIndexToCheck) => getOccupiedFleetCells().includes(cellIndexToCheck))
  if (occupiedByFleet) return

  previewCells.forEach((previewCell) => {
    const target = document.querySelector(`.fleet-grid .sea-cell[data-cell="${previewCell}"]`)
    if (target) target.classList.add('ship-preview')
  })
}

const endGame = async (message) => {
  if (hasGameEnded) return

  hasGameEnded = true
  hasShownVictoryPopup = true
  document.querySelectorAll('.enemy-state-grid .sea-cell, .ammo-button').forEach((control) => {
    control.disabled = true
  })
  const shouldLeaveBattle = await showModal(message, {
    title: 'Fin de la partida',
    confirmText: 'Salir',
    cancelText: 'Continuar aquí',
  })
  if (shouldLeaveBattle) window.location.href = '/main.html'
}

const checkEnemyVictory = () => {
  if (hasShownVictoryPopup || !enemyFleetCells.every((cellIndex) => enemyHits.has(cellIndex))) return

  endGame('¡Has ganado la partida! Destruiste el barco enemigo. ¿Quieres salir de la partida?')
}

const checkPlayerDefeat = () => {
  const allShipsSunk = playerShips.length > 0
    && playerShips.every((ship) => ship.every((cellIndex) => playerHits.has(cellIndex)))

  if (allShipsSunk) endGame('¡Has perdido la partida! Tu flota ha sido destruida. ¿Quieres salir de la partida?')
}

const updateEnemyBoardState = () => {
  document.querySelectorAll('.enemy-state-grid .sea-cell').forEach((cell) => {
    const cellIndex = Number(cell.dataset.cell)
    const isHit = enemyHits.has(cellIndex)
    const isInSunkenShip = enemyShips.some((ship) => ship.some(([row, column]) => row * BOARD_SIZE + column === cellIndex) && ship.every(([row, column]) => enemyHits.has(row * BOARD_SIZE + column)))

    cell.classList.toggle('enemy-hit-cell', isHit && !isInSunkenShip)
    cell.classList.toggle('sunken-cell', isInSunkenShip)
  })
}

const showAttackPreview = (cellIndex) => {
  if (!isShipPlaced) return
  clearPreview('.enemy-state-grid .sea-cell')
  const previewCells = getAttackPreviewCells(cellIndex)
  previewCells.forEach((previewCell) => {
    const target = document.querySelector(`.enemy-state-grid .sea-cell[data-cell="${previewCell}"]`)
    if (target) target.classList.add('attack-preview')
  })
}

app.innerHTML = `
  <main class="battle-layout">
    <section class="board-area">
      <header class="battle-header">
        <div class="player-card">
          <span class="status-dot"></span>
          <strong>Capitán jugador</strong>
          <small>Tu flota</small>
        </div>
        <div class="turn-badge">Turno 1</div>
        <div class="player-card enemy-card">
          <small>Rival en línea</small>
          <strong>Almirante enemigo</strong>
          <span class="status-dot"></span>
        </div>
      </header>

      <button class="btn btn-danger leave-battle-button" id="leave-battle" type="button">salir batalla</button>

      ${isSpectatorMode ? '' : `<div class="placement-toolbar">
        <div class="placement-options">
          ${placementShipLengths.map((length) => `<button class="btn btn-outline-primary ship-size-button ${length === selectedShipLength ? 'selected' : ''}" data-length="${length}" type="button">${length} casillas</button>`).join('')}
          <button class="btn btn-outline-danger" id="undo-placement" type="button" disabled>Deshacer último barco</button>
        </div>
        <span id="placement-status">Barcos colocados: 0/4. Longitud actual: 2 casillas.</span>
      </div>`}

      <div class="boards">
        <section class="board-card">
          <div class="board-title"><span>${isSpectatorMode ? 'Jugador 1' : 'Estado actual del mapa del jugador'}</span><b>⚓</b></div>
          <div class="grid-labels"><span></span>${'ABCDEFGHIJKLMNO'.split('').map((letter) => `<span>${letter}</span>`).join('')}</div>
          <div class="board-with-numbers"><div class="row-labels">${Array.from({ length: BOARD_SIZE }, (_, index) => `<span>${index + 1}</span>`).join('')}</div><div class="sea-grid fleet-grid">${attackCells.map((cell) => `<span class="sea-cell ${(isSpectatorMode ? fleetCells.includes(cell) : placedShipCells.includes(cell)) ? 'ship-cell' : ''}" data-cell="${cell}"></span>`).join('')}</div></div>
          <p class="board-hint">${isSpectatorMode ? 'Flota del jugador 1' : 'Tu flota está lista para el combate'}</p>
        </section>

        <section class="board-card">
          <div class="board-title"><span>${isSpectatorMode ? 'Jugador 2' : 'Mapa enemigo'}</span><b>?</b></div>
          <div class="grid-labels"><span></span>${'ABCDEFGHIJKLMNO'.split('').map((letter) => `<span>${letter}</span>`).join('')}</div>
          <div class="board-with-numbers"><div class="row-labels">${Array.from({ length: BOARD_SIZE }, (_, index) => `<span>${index + 1}</span>`).join('')}</div><div class="sea-grid enemy-state-grid">${attackCells.map((cell) => `<button class="sea-cell ${isSpectatorMode && enemyFleetCells.includes(cell) ? 'ship-cell' : 'unknown-cell'}" data-cell="${cell}" aria-label="${isSpectatorMode ? `Casilla ${cell + 1} del jugador 2` : `Atacar casilla ${cell + 1}`}" ${isSpectatorMode || !isShipPlaced ? 'disabled' : ''}></button>`).join('')}</div></div>
          <p class="board-hint">${isSpectatorMode ? 'Flota del jugador 2' : 'Selecciona una casilla para atacar; los impactos se muestran aquí'}</p>
        </section>
      </div>

      ${isSpectatorMode ? '' : `<section class="ammo-panel">
        <div class="section-heading"><h2>Municiones</h2><span>selecciona un ataque</span></div>
        <div class="ammo-list">
          <button class="btn btn-outline-secondary ammo-button selected" data-attack="normal" type="button"><span class="ammo-icon">✦</span><span><strong>Ataque normal</strong><small>Gratis e infinito</small></span></button>
          <button class="btn btn-outline-secondary ammo-button" data-attack="cross" type="button"><span class="ammo-icon">◈</span><span><strong>Ataque en cruz</strong><small>Ignora corazas 3x3</small></span></button>
          <button class="btn btn-outline-secondary ammo-button" data-attack="bombardment" type="button"><span class="ammo-icon">✚</span><span><strong>Bombardeo</strong><small>Imposible de interceptar en área 5x5</small></span></button>
        </div>
      </section>`}
    </section>

    <aside class="chat-panel">
      <div class="chat-topbar"><strong>Batalla naval</strong><span>2 usuarios</span></div>
      <div class="chat-log" id="chat-log"></div>
      <form class="chat-form" id="battle-chat-form"><input id="battle-chat-input" type="text" placeholder="Escribe en el chat..." autocomplete="off" /><button class="btn btn-primary" type="submit" aria-label="Enviar mensaje">➤</button></form>
    </aside>
  </main>
`

document.querySelectorAll('.ship-size-button').forEach((button) => {
  button.addEventListener('click', () => {
    if (isShipPlaced || shipsPlaced >= maxShipsToPlace) return

    selectedShipLength = Number(button.dataset.length)
    updatePlacementStatus()
    const hoveredCell = document.querySelector('.fleet-grid .sea-cell:hover')
    if (hoveredCell) showShipPreview(Number(hoveredCell.dataset.cell))
  })
})

document.querySelector('#undo-placement')?.addEventListener('click', undoLastShip)

document.querySelectorAll('.fleet-grid .sea-cell').forEach((cell) => {
  cell.addEventListener('contextmenu', (event) => {
    if (isSpectatorMode) return
    event.preventDefault()
    if (isShipPlaced) return

    const currentIndex = placementOrientations.indexOf(placementOrientation)
    placementOrientation = placementOrientations[(currentIndex + 1) % placementOrientations.length]
    const hoveredCell = document.querySelector('.fleet-grid .sea-cell:hover')
    if (hoveredCell) showShipPreview(Number(hoveredCell.dataset.cell))
    else showShipPreview(Number(cell.dataset.cell))
    document.querySelector('#placement-status').textContent = `Barco rotado: ${placementOrientation}. Click izquierdo para colocar.`
  })

  cell.addEventListener('mouseenter', () => {
    if (isSpectatorMode || isShipPlaced) return
    showShipPreview(Number(cell.dataset.cell))
  })

  cell.addEventListener('mouseleave', () => {
    if (isSpectatorMode || isShipPlaced) return
    clearPreview('.fleet-grid .sea-cell')
  })

  cell.addEventListener('click', async () => {
    if (isSpectatorMode || isShipPlaced) return

    if (shipsPlaced >= maxShipsToPlace) {
      showModal(`Máximo de ${maxShipsToPlace} barcos alcanzado. Ya no puedes colocar más.`, { title: 'Límite de barcos' })
      return
    }

    const startCell = Number(cell.dataset.cell)
    const validCells = canPlaceShip(startCell, selectedShipLength)

    if (!validCells.length) {
      showModal('No se puede colocar ahí: está fuera del tablero o en una zona no válida.', { title: 'Posición no válida' })
      return
    }

    const occupiedByFleet = validCells.some((cellIndex) => getOccupiedFleetCells().includes(cellIndex))
    if (occupiedByFleet) {
      showModal('No se puede colocar ahí: la casilla está ocupada por otro barco.', { title: 'Posición ocupada' })
      return
    }

    clearPreview('.fleet-grid .sea-cell')

    validCells.forEach((cellIndex) => {
      const fleetCell = document.querySelector(`.fleet-grid .sea-cell[data-cell="${cellIndex}"]`)
      if (fleetCell) fleetCell.classList.add('ship-cell')
      placedShipCells.push(cellIndex)
    })
    playerShips.push(validCells)

    shipsPlaced += 1
    if (shipsPlaced >= maxShipsToPlace) {
      const shouldConfirm = await showModal('Has llegado al límite de 4 barcos. ¿Quieres confirmar tu flota?', {
        title: 'Confirmar flota',
        confirmText: 'Confirmar',
        cancelText: 'Volver a colocar',
      })
      if (!shouldConfirm) {
        undoLastShip()
        return
      }
      isShipPlaced = true
    }

    updatePlacementStatus()
  })
})

document.querySelectorAll('.enemy-state-grid .sea-cell').forEach((cell) => {
  cell.addEventListener('mouseenter', () => {
    if (isSpectatorMode || !isShipPlaced) return
    showAttackPreview(Number(cell.dataset.cell))
  })

  cell.addEventListener('mouseleave', () => {
    if (isSpectatorMode || !isShipPlaced) return
    clearPreview('.enemy-state-grid .sea-cell')
  })

  cell.addEventListener('click', () => {
    if (isSpectatorMode) return
    if (!isShipPlaced) {
      document.querySelector('#placement-status').textContent = 'Primero completa tu flota de 4 barcos antes de disparar.'
      return
    }

    const selectedAttack = document.querySelector('.ammo-button.selected').dataset.attack
    const offsets = selectedAttack === 'cross'
      ? [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
      : selectedAttack === 'bombardment'
        ? bombardmentOffsets
        : [[0, 0]]
    const center = Number(cell.dataset.cell)
    const centerRow = Math.floor(center / BOARD_SIZE)
    const centerColumn = center % BOARD_SIZE

    offsets.forEach(([rowOffset, columnOffset]) => {
      const row = centerRow + rowOffset
      const column = centerColumn + columnOffset
      if (row < 0 || row >= BOARD_SIZE || column < 0 || column >= BOARD_SIZE) return

      const targetIndex = row * BOARD_SIZE + column
      const enemyCell = document.querySelector(`.enemy-state-grid .sea-cell[data-cell="${targetIndex}"]`)

      if (enemyCell) enemyCell.classList.add('attacked-cell')

      if (enemyFleetCells.includes(targetIndex)) {
        enemyHits.add(targetIndex)
        if (enemyCell) enemyCell.classList.remove('unknown-cell')
      }

    })

    updateEnemyBoardState()
    checkEnemyVictory()
    if (hasGameEnded) return
    enemyTurn()
  })
})

const markPlayerShipHits = () => {
  document.querySelectorAll('.fleet-grid .sea-cell').forEach((cell) => {
    const cellIndex = Number(cell.dataset.cell)
    const isHit = playerHits.has(cellIndex) && placedShipCells.includes(cellIndex)
    cell.classList.toggle('hit-cell', isHit)
  })
}

const updatePlayerShipHits = (targetIndex) => {
  if (placedShipCells.includes(targetIndex)) {
    playerHits.add(targetIndex)
    markPlayerShipHits()
  }
}

const enemyTurn = () => {
  const availableTargets = attackCells.filter((cellIndex) => !enemyAttackedCells.has(cellIndex))
  if (!availableTargets.length) return

  const enemyTarget = availableTargets[Math.floor(Math.random() * availableTargets.length)]
  const targetRow = Math.floor(enemyTarget / BOARD_SIZE)
  const targetColumn = enemyTarget % BOARD_SIZE
  bombardmentOffsets.forEach(([rowOffset, columnOffset]) => {
    const row = targetRow + rowOffset
    const column = targetColumn + columnOffset
    if (row < 0 || row >= BOARD_SIZE || column < 0 || column >= BOARD_SIZE) return

    const attackedCell = row * BOARD_SIZE + column
    enemyAttackedCells.add(attackedCell)
    updatePlayerShipHits(attackedCell)
  })
  turnNumber += 1
  document.querySelector('.turn-badge').textContent = `Turno ${turnNumber}`
  checkPlayerDefeat()
}

document.querySelectorAll('.ammo-button').forEach((button) => {
  button.addEventListener('click', () => {
    if (hasGameEnded) return
    document.querySelectorAll('.ammo-button').forEach((item) => item.classList.remove('selected'))
    button.classList.add('selected')
  })
})

document.querySelector('#leave-battle').addEventListener('click', async () => {
  if (await showModal('¿Seguro que quieres salir de la batalla?', {
    title: 'Salir de la batalla',
    confirmText: 'Salir',
    cancelText: 'Seguir jugando',
  })) {
    window.location.href = '/main.html'
  }
})

document.querySelector('#battle-chat-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.querySelector('#battle-chat-input')
  const message = input.value.trim()
  if (!message) return
  const paragraph = document.createElement('p')
  paragraph.innerHTML = '<b class="blue-name">Capitán jugador:</b> '
  paragraph.append(document.createTextNode(message))
  document.querySelector('#chat-log').append(paragraph)
  input.value = ''
  input.focus()
})
