import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './battle.css'
import { useModal } from './Modal.jsx'
import { getAuthUserId, requestBackend } from './backendApi.js'
import { useChatConnection } from './chatPresence.jsx'

const BOARD_SIZE = 15
const BOARD_CELLS = Array.from({ length: BOARD_SIZE ** 2 }, (_, index) => index)
const COLUMN_LABELS = 'ABCDEFGHIJKLMNO'.split('')
const SHIP_TYPES = [
  { type: 'seriousGirl', name: 'Chica seria', length: 2, ability: 'Invisible al radar; esquiva bombardeos' },
  { type: 'vanguard', name: 'Vanguardia Tipo 1', length: 3, ability: 'Intercepta el primer misil que recibe' },
  { type: 'coordinator', name: 'Coordinadora Tipo 2', length: 3, ability: 'Otorga un ataque normal extra por turno' },
  { type: 'battleship', name: 'Acorazado', length: 4, ability: 'Cada casilla necesita dos impactos' },
  { type: 'carrier', name: 'Portaaviones', length: 4, ability: 'Munición extra mientras permanezca intacto' },
]
const LEGACY_SHIP_LENGTHS = [2, 3, 4]
const PLACEMENT_ORIENTATIONS = ['horizontal', 'vertical', 'horizontal-reverse', 'vertical-reverse']
const BOMBARDMENT_OFFSETS = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 5 }, (_, column) => [row - 2, column - 2]),
).flat().filter(([row, column]) => (row + column) % 2 === 0)
const RADAR_OFFSETS = [
  ...Array.from({ length: 5 }, (_, index) => [index - 2, 0]),
  [0, -1],
  [0, 1],
]
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
  if (attackType === 'radar') return RADAR_OFFSETS
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
  const searchParams = new URLSearchParams(window.location.search)
  const isSpectatorMode = searchParams.get('mode') === 'spectator'
  const gameId = searchParams.get('gameId')
  const matchId = searchParams.get('matchId')
  const isRealtimeMatch = Boolean(matchId)
  const username = localStorage.getItem('battle-naval-current-user') || 'Capitán jugador'
  const userId = getAuthUserId() || ''
  const [ships, setShips] = useState([])
  const [selectedShipType, setSelectedShipType] = useState('seriousGirl')
  const [selectedShipLength, setSelectedShipLength] = useState(2)
  const [orientationIndex, setOrientationIndex] = useState(0)
  const [isShipPlaced, setIsShipPlaced] = useState(false)
  const [placementMessage, setPlacementMessage] = useState('')
  const [shipPreview, setShipPreview] = useState([])
  const [selectedAttack, setSelectedAttack] = useState('normal')
  const [attackPreview, setAttackPreview] = useState([])
  const [enemyHits, setEnemyHits] = useState(() => new Set())
  const [playerHits, setPlayerHits] = useState(() => new Set())
  const [enemySunkenCells, setEnemySunkenCells] = useState(() => new Set())
  const [playerSunkenCells, setPlayerSunkenCells] = useState(() => new Set())
  const [radarResults, setRadarResults] = useState([])
  const [attackedEnemyCells, setAttackedEnemyCells] = useState(() => new Set())
  const [enemyAttackedCells, setEnemyAttackedCells] = useState(() => new Set())
  const [turnNumber, setTurnNumber] = useState(1)
  const [isSendingFleet, setIsSendingFleet] = useState(false)
  const [isSendingAttack, setIsSendingAttack] = useState(false)
  const [hasGameEnded, setHasGameEnded] = useState(false)
  const [message, setMessage] = useState('')
  const [chatError, setChatError] = useState('')
  const [gameError, setGameError] = useState('')
  const {
    matchMessages,
    invitations,
    respondToInvitation,
    match,
    matchActions,
    matchError,
    sendMatchAction,
    sendMatchChat,
    radarResults: incomingRadarResults,
    leaveMatch,
    error: realtimeError,
  } = useChatConnection(
    username,
    userId,
    matchId || '',
    isSpectatorMode ? 'spectator' : 'player',
    true,
  )
  const { dialog, showModal } = useModal()
  const processedMatchActionsRef = useRef(new Set())

  const placedShipCells = ships.flatMap((ship) => ship.cells)
  const shipCount = ships.length
  const selectedOffsets = getAttackOffsets(selectedAttack)
  const rival = match?.players?.find((player) => player.id !== userId)
  const matchGame = match?.game
  const isFleetReady = isShipPlaced || matchGame?.readyPlayerIds?.includes(userId)
  const isYourTurn = matchGame?.currentTurnId === userId
  const hasAvailableAction = matchGame?.primaryActionAvailable || matchGame?.extraNormalAvailable
  const selectedAmmo = matchGame?.ammo?.[selectedAttack]
  const canAttack = isRealtimeMatch
    ? isFleetReady
      && matchGame?.phase === 'active'
      && isYourTurn
      && hasAvailableAction
      && (matchGame?.primaryActionAvailable || selectedAttack === 'normal')
      && (selectedAttack === 'normal' || (typeof selectedAmmo === 'number' && selectedAmmo > 0))
      && !isSendingAttack
    : isShipPlaced

  const sendGameAction = async (type, payload) => {
    if (!gameId) {
      throw new Error('No hay una partida asociada. Inicia la batalla desde el menú principal.')
    }

    return requestBackend(`/api/games/${encodeURIComponent(gameId)}/actions`, {
      method: 'POST',
      body: { username, type, payload },
    })
  }

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
    if (isRealtimeMatch) {
      setSelectedShipType(lastShip.type)
      setSelectedShipLength(SHIP_TYPES.find((ship) => ship.type === lastShip.type).length)
    } else {
      setSelectedShipLength(lastShip.cells.length)
    }
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
    if (isSpectatorMode || isFleetReady || isSendingFleet) return
    if (isRealtimeMatch && ships.some((ship) => ship.type === selectedShipType)) {
      setPlacementMessage('Esta nave ya está colocada. Selecciona otra clase.')
      return
    }
    const requiredShipCount = isRealtimeMatch ? SHIP_TYPES.length : 4
    if (shipCount >= requiredShipCount) {
      await showModal(`Máximo de ${requiredShipCount} barcos alcanzado. Deshaz el último barco para cambiar tu flota.`, {
        title: 'Límite de barcos',
      })
      return
    }

    const shipLength = isRealtimeMatch
      ? SHIP_TYPES.find((ship) => ship.type === selectedShipType).length
      : selectedShipLength
    const cells = previewShipAtWithoutState(cell, shipLength, orientationIndex)
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

    const nextShips = [...ships, {
      type: isRealtimeMatch ? selectedShipType : `legacy-${shipCount}`,
      cells,
    }]
    setShips(nextShips)
    if (isRealtimeMatch) {
      const nextShip = SHIP_TYPES.find((ship) =>
        !nextShips.some((placedShip) => placedShip.type === ship.type))
      if (nextShip) {
        setSelectedShipType(nextShip.type)
        setSelectedShipLength(nextShip.length)
      }
    }
    setShipPreview([])
    setPlacementMessage('')

    if (nextShips.length === requiredShipCount) {
      const confirmed = await showModal(`Has colocado las ${requiredShipCount} naves. ¿Quieres confirmar tu flota?`, {
        title: 'Confirmar flota',
        confirmText: 'Confirmar',
        cancelText: 'Volver a colocar',
      })
      if (!confirmed) {
        setShips((current) => current.slice(0, -1))
        setSelectedShipLength(cells.length)
        return
      }
      try {
        if (isRealtimeMatch) {
          setIsSendingFleet(true)
          sendMatchAction(matchId, { type: 'fleet:ready', ships: nextShips })
        } else {
          await sendGameAction('fleet:ready', { ships: nextShips.map((ship) => ship.cells) })
        }
      } catch (error) {
        setIsSendingFleet(false)
        setShips((current) => current.slice(0, -1))
        if (isRealtimeMatch) {
          setSelectedShipType(selectedShipType)
        } else {
          setSelectedShipLength(cells.length)
        }
        setPlacementMessage(error.message)
        return
      }
      if (!isRealtimeMatch) setIsShipPlaced(true)
    }
  }

  const attack = async (cell) => {
    if (isSpectatorMode || hasGameEnded) return
    if (!isFleetReady) {
      setPlacementMessage('Primero completa tu flota de 4 barcos antes de disparar.')
      return
    }

    setGameError('')
    if (isRealtimeMatch) {
      if (!isYourTurn) {
        setGameError('No es tu turno. Espera a que el otro jugador termine.')
        return
      }
      try {
        setIsSendingAttack(true)
        setRadarResults([])
        sendMatchAction(matchId, {
          type: selectedAttack === 'radar' ? 'radar' : 'attack',
          ...(selectedAttack === 'radar' ? {} : { attackType: selectedAttack }),
          cell,
        })
      } catch (error) {
        setIsSendingAttack(false)
        setGameError(error.message)
      }
      return
    }

    try {
      await sendGameAction('attack', { cell, attackType: selectedAttack })
    } catch (error) {
      setGameError(error.message)
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
      && ships.every((ship) => ship.cells.every((target) => newPlayerHits.has(target)))
    if (fleetDestroyed) {
      await finishGame('¡Has perdido la partida! Tu flota ha sido destruida. ¿Quieres salir de la partida?')
    }
  }

  const submitMessage = async (event) => {
    event.preventDefault()
    const trimmedMessage = message.trim()
    if (!trimmedMessage) return

    setChatError('')
    try {
      if (!isRealtimeMatch) {
        throw new Error('El chat aislado requiere una partida en tiempo real.')
      }
      sendMatchChat(trimmedMessage)
      setMessage('')
    } catch (error) {
      setChatError(error.message)
    }
  }

  const answerInvitation = (invitation, accepted) => {
    try {
      respondToInvitation(invitation, accepted)
    } catch (error) {
      setChatError(error.message)
    }
  }

  const leaveBattle = async () => {
    if (await showModal('¿Seguro que quieres salir de la batalla?', {
      title: 'Salir de la batalla',
      confirmText: 'Salir',
      cancelText: 'Seguir jugando',
    })) {
      if (isRealtimeMatch) {
        try {
          leaveMatch(matchId)
        } catch (error) {
          setGameError(error.message)
          return
        }
      }
      window.location.href = '/main.html'
    }
  }

  useEffect(() => {
    if (!isRealtimeMatch || !matchActions.length) return
    const newAttacks = []
    let winnerId = null
    for (const event of matchActions) {
      const eventKey = event.actionId || `${event.playerId}:${event.sentAt}`
      if (processedMatchActionsRef.current.has(eventKey)) continue
      processedMatchActionsRef.current.add(eventKey)

      if (event.action?.type === 'fleet:ready' && event.playerId === userId) {
        setIsSendingFleet(false)
      }
      if (event.action?.type === 'radar') {
        if (event.playerId === userId) setIsSendingAttack(false)
        continue
      }
      if (event.action?.type !== 'attack' || !Array.isArray(event.action.results)) continue
      if (event.playerId === userId) setIsSendingAttack(false)
      newAttacks.push(event)
      winnerId = event.action.winnerId || winnerId
    }

    if (newAttacks.length) {
      setAttackedEnemyCells((current) => {
        const next = new Set(current)
        newAttacks.filter((event) => event.playerId === userId)
          .flatMap((event) => event.action.results)
          .forEach((result) => next.add(result.cell))
        return next
      })
      setEnemyHits((current) => {
        const next = new Set(current)
        newAttacks.filter((event) => event.playerId === userId)
          .flatMap((event) => event.action.results)
          .filter((result) => result.result === 'hit')
          .forEach((result) => next.add(result.cell))
        return next
      })
      setEnemySunkenCells((current) => {
        const next = new Set(current)
        newAttacks.filter((event) => event.playerId === userId)
          .flatMap((event) => event.action.results)
          .filter((result) => result.cellSunk)
          .forEach((result) => next.add(result.cell))
        return next
      })
      setEnemyAttackedCells((current) => {
        const next = new Set(current)
        newAttacks.filter((event) => event.playerId !== userId)
          .flatMap((event) => event.action.results)
          .forEach((result) => next.add(result.cell))
        return next
      })
      setPlayerHits((current) => {
        const next = new Set(current)
        newAttacks.filter((event) => event.playerId !== userId)
          .flatMap((event) => event.action.results)
          .filter((result) => result.result === 'hit')
          .forEach((result) => next.add(result.cell))
        return next
      })
      setPlayerSunkenCells((current) => {
        const next = new Set(current)
        newAttacks.filter((event) => event.playerId !== userId)
          .flatMap((event) => event.action.results)
          .filter((result) => result.cellSunk)
          .forEach((result) => next.add(result.cell))
        return next
      })
    }

    if (winnerId && !hasGameEnded) {
      void finishGame(winnerId === userId
        ? '¡Ganaste! Destruiste toda la flota rival.'
        : 'La flota rival destruyó todos tus barcos.')
    }
  }, [
    finishGame,
    hasGameEnded,
    isRealtimeMatch,
    matchActions,
    userId,
  ])

  useEffect(() => {
    if (incomingRadarResults) setRadarResults(incomingRadarResults)
  }, [incomingRadarResults])

  useEffect(() => {
    if (matchError) {
      setIsSendingFleet(false)
      setIsSendingAttack(false)
      setGameError(matchError)
    }
  }, [matchError])

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
            <div className="turn-badge">
              {isRealtimeMatch
                ? (matchGame?.phase === 'active'
                  ? `Turno ${matchGame.turnNumber}: ${isYourTurn
                    ? matchGame.extraNormalAvailable && !matchGame.primaryActionAvailable
                      ? 'ataque normal extra'
                      : 'tu turno'
                    : `espera a ${rival?.username || 'tu rival'}`}`
                  : matchGame?.phase === 'finished'
                    ? 'Partida finalizada'
                    : 'Esperando flotas')
                : `Turno ${turnNumber}`}
            </div>
            <div className="player-card enemy-card">
              <small>{rival?.online === false ? 'Rival desconectado' : 'Rival en línea'}</small>
              <strong>{rival?.username || (isRealtimeMatch ? 'Esperando rival' : 'Almirante enemigo')}</strong>
              <span className="status-dot" />
            </div>
          </header>

          <button className="btn btn-danger leave-battle-button" type="button" onClick={leaveBattle}>
            salir batalla
          </button>

          {!isSpectatorMode && (
            <div className="placement-toolbar">
              <div className="placement-options">
                {(isRealtimeMatch ? SHIP_TYPES : LEGACY_SHIP_LENGTHS).map((shipOption) => {
                  const type = isRealtimeMatch ? shipOption.type : null
                  const length = isRealtimeMatch ? shipOption.length : shipOption
                  const name = isRealtimeMatch ? shipOption.name : `${length} casillas`
                  const alreadyPlaced = isRealtimeMatch && ships.some((ship) => ship.type === type)
                  const selected = isRealtimeMatch
                    ? selectedShipType === type
                    : selectedShipLength === length
                  return (
                  <button
                    className={`btn btn-outline-primary ship-size-button${selected ? ' selected' : ''}`}
                    data-length={length}
                    type="button"
                    key={type || length}
                    title={isRealtimeMatch ? shipOption.ability : name}
                    disabled={isFleetReady || isSendingFleet
                      || shipCount >= (isRealtimeMatch ? SHIP_TYPES.length : 4)
                      || alreadyPlaced}
                    onClick={() => {
                      setSelectedShipLength(length)
                      if (isRealtimeMatch) setSelectedShipType(type)
                      setShipPreview([])
                    }}
                  >
                    {isRealtimeMatch ? `${name} (${length})` : name}
                  </button>
                  )
                })}
                <button
                  className="btn btn-outline-danger"
                  type="button"
                  disabled={isFleetReady || isSendingFleet || shipCount === 0}
                  onClick={undoLastShip}
                >
                  Deshacer último barco
                </button>
              </div>
              <span id="placement-status">
                {isFleetReady
                  ? isRealtimeMatch && matchGame?.phase !== 'active'
                    ? 'Tu flota está lista. Espera a que tu rival confirme la suya.'
                    : isRealtimeMatch && !isYourTurn
                      ? `Tu flota está lista. Espera el turno de ${rival?.username || 'tu rival'}.`
                      : 'Tu flota está completa. Puedes lanzar tus misiles.'
                  : isSendingFleet
                    ? 'Enviando tu flota al servidor…'
                    : placementMessage || (shipCount >= (isRealtimeMatch ? SHIP_TYPES.length : 4)
                    ? 'Flota completa. Deshaz la última nave para cambiarla o confirma para continuar.'
                    : `Naves colocadas: ${shipCount}/${isRealtimeMatch ? SHIP_TYPES.length : 4}. ${isRealtimeMatch
                      ? `Seleccionada: ${SHIP_TYPES.find((ship) => ship.type === selectedShipType).name}.`
                      : `Longitud actual: ${selectedShipLength} casillas.`}`)}
              </span>
            </div>
          )}
          {gameError && <p className="game-error" role="alert">{gameError}</p>}

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
                          playerSunkenCells.has(cell) && 'sunken-cell',
                        ].filter(Boolean).join(' ')}
                        type="button"
                        key={cell}
                        aria-label={`Casilla ${cell + 1} de tu flota`}
                        disabled={isSpectatorMode || isFleetReady || isSendingFleet}
                        onMouseEnter={() => !isSpectatorMode && !isFleetReady && !isSendingFleet && previewShipAt(cell)}
                        onMouseLeave={() => setShipPreview([])}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          if (isSpectatorMode || isFleetReady || isSendingFleet) return
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
                    const sunkenShip = !isRealtimeMatch && ENEMY_SHIPS.some((ship) =>
                      ship.includes(cell) && ship.every((shipCell) => enemyHits.has(shipCell)))
                    const isSpectatorShip = isSpectatorMode && ENEMY_FLEET_CELLS.includes(cell)
                    const radarResult = radarResults.find((result) => result.cell === cell)
                    return (
                      <button
                        className={[
                          'sea-cell',
                          'unknown-cell',
                          (isSpectatorShip || sunkenShip) && 'ship-cell',
                          attackedEnemyCells.has(cell) && 'attacked-cell',
                          isHit && !sunkenShip && 'enemy-hit-cell',
                          (sunkenShip || enemySunkenCells.has(cell)) && 'sunken-cell',
                          attackPreview.includes(cell) && 'attack-preview',
                          radarResult && (radarResult.detected ? 'radar-detected' : 'radar-clear'),
                        ].filter(Boolean).join(' ')}
                        type="button"
                        key={cell}
                        aria-label={`${isSpectatorMode ? 'Casilla' : 'Atacar casilla'} ${cell + 1} del jugador 2${radarResult ? (radarResult.detected ? ', radar detectó nave' : ', radar sin detección') : ''}`}
                        disabled={isSpectatorMode || !canAttack || hasGameEnded}
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
                  disabled={hasGameEnded || (isRealtimeMatch
                    && !matchGame?.primaryActionAvailable
                    && !matchGame?.extraNormalAvailable)}
                  onClick={() => setSelectedAttack('normal')}
                >
                  <span className="ammo-icon">✦</span>
                  <span><strong>Ataque normal</strong><small>Infinito; extra si la Coordinadora sigue operativa</small></span>
                </button>
                <button
                  className={`btn btn-outline-secondary ammo-button${selectedAttack === 'cross' ? ' selected' : ''}`}
                  type="button"
                  disabled={hasGameEnded || (isRealtimeMatch && (
                    matchGame?.ammo?.cross <= 0 || !matchGame?.primaryActionAvailable
                  ))}
                  onClick={() => setSelectedAttack('cross')}
                >
                  <span className="ammo-icon">◈</span>
                  <span><strong>Ataque en cruz ({matchGame?.ammo?.cross ?? (isRealtimeMatch ? '—' : '∞')})</strong><small>5 casillas en cruz</small></span>
                </button>
                <button
                  className={`btn btn-outline-secondary ammo-button${selectedAttack === 'bombardment' ? ' selected' : ''}`}
                  type="button"
                  disabled={hasGameEnded || (isRealtimeMatch && (
                    matchGame?.ammo?.bombardment <= 0 || !matchGame?.primaryActionAvailable
                  ))}
                  onClick={() => setSelectedAttack('bombardment')}
                >
                  <span className="ammo-icon">✚</span>
                  <span><strong>Bombardeo ({matchGame?.ammo?.bombardment ?? (isRealtimeMatch ? '—' : '∞')})</strong><small>Área 5x5; la Chica seria lo esquiva</small></span>
                </button>
                {isRealtimeMatch && (
                  <button
                    className={`btn btn-outline-secondary ammo-button${selectedAttack === 'radar' ? ' selected' : ''}`}
                    type="button"
                    disabled={hasGameEnded
                      || matchGame?.ammo?.radar <= 0
                      || !matchGame?.primaryActionAvailable}
                    onClick={() => setSelectedAttack('radar')}
                  >
                    <span className="ammo-icon">⌖</span>
                    <span><strong>Radar ({matchGame?.ammo?.radar ?? 0})</strong><small>Escanea una cruz 5×3; consume el turno</small></span>
                  </button>
                )}
              </div>
              {isRealtimeMatch && matchGame?.extraNormalAvailable
                && <p className="ammo-note">La Coordinadora está activa: después de la acción principal puedes hacer un ataque normal extra.</p>}
            </section>
          )}
        </section>

        <aside className="chat-panel">
          <div className="chat-topbar">
            <strong>Chat de la partida</strong>
            <span>{match
              ? match.players.length + match.spectators
              : isRealtimeMatch ? 'Conectando…' : 'Chat no disponible'}</span>
          </div>
          <div className="match-chat-participants" aria-label="Participantes de la partida">
            <h2>Jugadores</h2>
            {match?.players?.length ? (
              <ul>
                {match.players.map((player) => (
                  <li key={player.id}>
                    <span className={`online-user-indicator${player.online ? '' : ' is-offline'}`} aria-hidden="true" />
                    <span>{player.username}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{isRealtimeMatch ? 'Conectando con la partida…' : 'Sin partida en tiempo real.'}</p>
            )}
            <p className="match-chat-spectators">Espectadores: {match?.spectators || 0}</p>
          </div>
          <div className="chat-log" aria-live="polite">
            {!gameId && !matchId && <p className="game-error">No hay una partida asociada.</p>}
            {!isRealtimeMatch && gameId && (
              <p className="game-error">
                El chat de esta partida todavía no está disponible en el modo de juego anterior.
              </p>
            )}
            {invitations.map((invitation) => (
              <div className="chat-invitation" key={invitation.id}>
                <p><b>{invitation.username}</b> te invita a una partida.</p>
                <div>
                  <button className="btn btn-success btn-sm" type="button" onClick={() => answerInvitation(invitation, true)}>
                    Aceptar
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => answerInvitation(invitation, false)}>
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
            {matchMessages.map((chatMessage, index) => (
              <p key={chatMessage.id || `${chatMessage.username}-${chatMessage.receivedAt}-${index}`}>
                <b className={chatMessage.username === username ? 'blue-name' : 'orange-name'}>
                  {chatMessage.username}:
                </b> {chatMessage.text}
              </p>
            ))}
            {realtimeError && <p className="game-error" role="status">{realtimeError}</p>}
            {chatError && <p className="game-error" role="alert">{chatError}</p>}
          </div>
          <form className="chat-form" onSubmit={submitMessage}>
            <input
              type="text"
              placeholder="Escribe en el chat..."
              autoComplete="off"
              aria-label="Escribe en el chat"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!isRealtimeMatch}
            />
            <button
              className="btn btn-primary"
              type="submit"
              aria-label="Enviar mensaje"
              disabled={!isRealtimeMatch}
            >
              ➤
            </button>
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
