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
const FLEET_POINTS = 12
const MAX_STACKED_EFFECTS = 2
const SHIP_TYPES = [
  { type: 'seriousGirl', name: 'Chica seria', length: 2, ability: 'Invisible al radar; esquiva bombardeos' },
  { type: 'vanguard', name: 'Vanguardia Tipo 1', length: 3, ability: 'Intercepta el primer misil que recibe' },
  { type: 'coordinator', name: 'Coordinadora Tipo 2', length: 3, ability: 'Otorga un ataque normal extra por turno' },
  { type: 'battleship', name: 'Acorazado', length: 4, ability: 'El ataque en cruz ignora su resistencia' },
  { type: 'carrier', name: 'Portaaviones', length: 4, ability: 'Munición extra mientras permanezca intacto' },
]
const LEGACY_SHIP_LENGTHS = [2, 3, 4]
const PLACEMENT_ORIENTATIONS = ['horizontal', 'vertical', 'horizontal-reverse', 'vertical-reverse']
const BOMBARDMENT_OFFSETS = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 5 }, (_, column) => [row - 2, column - 2]),
).flat().filter(([row, column]) => (row + column) % 2 === 0)
const RADAR_OFFSETS = Array.from({ length: 7 }, (_, rowIndex) => {
  const rowOffset = rowIndex - 3
  const columnRadius = Math.abs(rowOffset) <= 1 ? 3 : 4 - Math.abs(rowOffset)
  return Array.from({ length: columnRadius * 2 + 1 }, (_, columnIndex) => [
    rowOffset,
    columnIndex - columnRadius,
  ])
}).flat()
const ENEMY_SHIPS = [
  [[2, 3], [2, 4], [2, 5], [2, 6]],
  [[7, 8], [7, 9], [7, 10], [7, 11]],
  [[12, 2], [12, 3], [12, 4], [12, 5]],
].map((ship) => ship.map(([row, column]) => row * BOARD_SIZE + column))

const getSpectatorAttackMap = (actions, playerId) => {
  const attackMap = {
    attacked: new Set(),
    hits: new Set(),
    sunken: new Set(),
    resisted: new Set(),
    evaded: new Set(),
  }
  for (const event of actions) {
    if (event.playerId !== playerId || event.action?.type !== 'attack'
      || !Array.isArray(event.action.results)) continue
    for (const result of event.action.results) {
      attackMap.attacked.add(result.cell)
      if (result.result === 'hit') {
        attackMap.hits.add(result.cell)
        attackMap.evaded.delete(result.cell)
      }
      if (result.result === 'evaded') attackMap.evaded.add(result.cell)
      if (result.resisted) attackMap.resisted.add(result.cell)
      if (result.cellSunk) attackMap.resisted.delete(result.cell)
      if (result.shipSunk && Array.isArray(result.shipCells)) {
        result.shipCells.forEach((cell) => attackMap.sunken.add(cell))
      }
    }
  }
  return attackMap
}

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

const isPreviouslyUsedAttackCenter = (cell, attackCenters, retryableAttackCenters) => (
  attackCenters.has(cell) && !retryableAttackCenters.has(cell)
)

function BattlePage() {
  const searchParams = new URLSearchParams(window.location.search)
  const isSpectatorMode = searchParams.get('mode') === 'spectator'
  const gameId = searchParams.get('gameId')
  const matchId = searchParams.get('matchId')
  const isRealtimeMatch = Boolean(matchId)
  const username = localStorage.getItem('battle-naval-current-user') || 'Capitán jugador'
  const userId = getAuthUserId() || ''
  const [ships, setShips] = useState([])
  const [purchasedShipCounts, setPurchasedShipCounts] = useState(() =>
    Object.fromEntries(SHIP_TYPES.map((ship) => [ship.type, 0])),
  )
  const [isBuyingFleet, setIsBuyingFleet] = useState(true)
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
  const [enemyResistedCells, setEnemyResistedCells] = useState(() => new Set())
  const [playerResistedCells, setPlayerResistedCells] = useState(() => new Set())
  const [enemyEvadedCells, setEnemyEvadedCells] = useState(() => new Set())
  const [radarResults, setRadarResults] = useState([])
  const [attackedEnemyCells, setAttackedEnemyCells] = useState(() => new Set())
  const [attackCenters, setAttackCenters] = useState(() => new Set())
  const [retryableAttackCenters, setRetryableAttackCenters] = useState(() => new Set())
  const [enemyAttackCenters, setEnemyAttackCenters] = useState(() => new Set())
  const [turnNumber, setTurnNumber] = useState(1)
  const [isSendingFleet, setIsSendingFleet] = useState(false)
  const [isSendingAttack, setIsSendingAttack] = useState(false)
  const [hasGameEnded, setHasGameEnded] = useState(false)
  const [gameResultStatus, setGameResultStatus] = useState('')
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
  const purchasedShipCount = Object.values(purchasedShipCounts).reduce((total, count) => total + count, 0)
  const purchasedFleetPoints = SHIP_TYPES.reduce(
    (total, ship) => total + purchasedShipCounts[ship.type] * ship.length,
    0,
  )
  const remainingFleetPoints = FLEET_POINTS - purchasedFleetPoints
  const requiredShipCount = isRealtimeMatch ? purchasedShipCount : 4
  const selectedOffsets = getAttackOffsets(selectedAttack)
  const rival = match?.players?.find((player) => player.id !== userId)
  const matchGame = match?.game
  const winnerUsername = match?.players?.find((player) => player.id === matchGame?.winnerId)?.username
  const spectatorAttackMaps = isSpectatorMode
    ? (match?.players || []).slice(0, 2).map((player) => ({
      player,
      ...getSpectatorAttackMap(matchActions, player.id),
    }))
    : []
  const isFleetReady = isShipPlaced || matchGame?.readyPlayerIds?.includes(userId)
  const isYourTurn = matchGame?.currentTurnId === userId
  const hasAvailableAction = matchGame?.primaryActionAvailable || matchGame?.extraNormalAvailable
  const finishedMatchStatus = isSpectatorMode
    ? winnerUsername ? `Ganador: ${winnerUsername}` : 'Partida finalizada'
    : matchGame?.winnerId
      ? matchGame.winnerId === userId ? '¡Victoria!' : 'Derrota'
      : 'Partida finalizada'
  const turnStatus = gameResultStatus || (
    isSpectatorMode
      ? matchGame?.phase === 'active'
        ? `Turno de ${match?.players?.find((player) => player.id === matchGame.currentTurnId)?.username || 'un jugador'}`
        : matchGame?.phase === 'finished'
          ? finishedMatchStatus
          : 'Esperando flotas'
      : isRealtimeMatch
        ? matchGame?.phase === 'active'
          ? !matchGame.currentTurnId
            ? 'Preparando el turno…'
            : isYourTurn ? 'Tu turno' : 'Turno enemigo'
          : matchGame?.phase === 'finished'
            ? finishedMatchStatus
            : isFleetReady ? 'Esperando flota enemiga' : 'Coloca tu flota'
        : isShipPlaced ? 'Tu turno' : 'Coloca tu flota'
  )
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

  const buyShip = (type) => {
    const ship = SHIP_TYPES.find((option) => option.type === type)
    if (!ship) return
    setPurchasedShipCounts((current) => {
      const currentCount = current[type]
      const currentPoints = SHIP_TYPES.reduce(
        (total, option) => total + current[option.type] * option.length,
        0,
      )
      if (currentPoints + ship.length > FLEET_POINTS) {
        return current
      }
      return { ...current, [type]: currentCount + 1 }
    })
  }

  const refundShip = (type) => {
    setPurchasedShipCounts((current) => (
      current[type] > 0 ? { ...current, [type]: current[type] - 1 } : current
    ))
  }

  const beginFleetPlacement = () => {
    const firstPurchasedShip = SHIP_TYPES.find((ship) => purchasedShipCounts[ship.type] > 0)
    if (!firstPurchasedShip) return
    setSelectedShipType(firstPurchasedShip.type)
    setSelectedShipLength(firstPurchasedShip.length)
    setIsBuyingFleet(false)
    setShipPreview([])
    setPlacementMessage('')
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

  const finishGame = async (resultMessage, statusMessage) => {
    if (hasGameEnded) return
    setHasGameEnded(true)
    if (statusMessage) setGameResultStatus(statusMessage)
    const shouldLeave = await showModal(resultMessage, {
      title: 'Fin de la partida',
      confirmText: 'Salir',
      cancelText: 'Continuar aquí',
    })
    if (shouldLeave) window.location.href = '/main.html'
  }

  const placeShip = async (cell) => {
    if (isSpectatorMode || isFleetReady || isSendingFleet) return
    if (isRealtimeMatch) {
      const placedTypeCount = ships.filter((ship) => ship.type === selectedShipType).length
      if (isBuyingFleet || placedTypeCount >= purchasedShipCounts[selectedShipType]) {
        setPlacementMessage('Compra esta nave antes de colocarla o selecciona otra comprada.')
        return
      }
    }
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
        purchasedShipCounts[ship.type] > nextShips.filter((placedShip) => placedShip.type === ship.type).length)
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
        if (isRealtimeMatch) setSelectedShipType(selectedShipType)
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
    if (selectedAttack !== 'radar'
        && isPreviouslyUsedAttackCenter(cell, attackCenters, retryableAttackCenters)) {
      setGameError('Esa casilla ya fue el centro de un ataque.')
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
    setAttackCenters((current) => new Set(current).add(cell))
    const newHits = new Set(enemyHits)
    const newAttackedCells = new Set(attackedEnemyCells)
    targets.forEach((target) => {
      newAttackedCells.add(target)
      if (ENEMY_FLEET_CELLS.includes(target)) newHits.add(target)
    })
    setEnemyHits(newHits)
    setAttackedEnemyCells(newAttackedCells)

    if (ENEMY_FLEET_CELLS.every((target) => newHits.has(target))) {
      await finishGame(
        '¡Has ganado la partida! Destruiste el barco enemigo. ¿Quieres salir de la partida?',
        '¡Victoria!',
      )
      return
    }

    const availableTargets = BOARD_CELLS.filter((target) => !enemyAttackCenters.has(target))
    if (availableTargets.length === 0) return

    const enemyTarget = availableTargets[Math.floor(Math.random() * availableTargets.length)]
    setEnemyAttackCenters((current) => new Set(current).add(enemyTarget))
    const newPlayerHits = new Set(playerHits)
    getAffectedCells(enemyTarget, BOMBARDMENT_OFFSETS).forEach((target) => {
      if (placedShipCells.includes(target)) newPlayerHits.add(target)
    })
    setPlayerHits(newPlayerHits)
    setTurnNumber((turn) => turn + 1)

    const fleetDestroyed = ships.length > 0
      && ships.every((ship) => ship.cells.every((target) => newPlayerHits.has(target)))
    if (fleetDestroyed) {
      await finishGame(
        '¡Has perdido la partida! Tu flota ha sido destruida. ¿Quieres salir de la partida?',
        'Derrota',
      )
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
      setAttackCenters((current) => {
        const next = new Set(current)
        newAttacks.filter((event) => event.playerId === userId
          && Number.isInteger(event.action.cell))
          .forEach((event) => next.add(event.action.cell))
        return next
      })
      setRetryableAttackCenters((current) => {
        const next = new Set(current)
        for (const result of newAttacks.filter((event) => event.playerId === userId)
          .flatMap((event) => event.action.results)) {
          if (result.result === 'evaded' || result.resisted) next.add(result.cell)
          if (result.cellSunk) next.delete(result.cell)
        }
        return next
      })
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
          .filter((result) => result.shipSunk && Array.isArray(result.shipCells))
          .flatMap((result) => result.shipCells)
          .forEach((cell) => next.add(cell))
        return next
      })
      setEnemyResistedCells((current) => {
        const next = new Set(current)
        for (const result of newAttacks.filter((event) => event.playerId === userId)
          .flatMap((event) => event.action.results)) {
          if (result.resisted) next.add(result.cell)
          if (result.cellSunk) next.delete(result.cell)
        }
        return next
      })
      setEnemyEvadedCells((current) => {
        const next = new Set(current)
        for (const result of newAttacks.filter((event) => event.playerId === userId)
          .flatMap((event) => event.action.results)) {
          if (result.result === 'evaded') next.add(result.cell)
          if (result.result === 'hit') next.delete(result.cell)
        }
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
          .filter((result) => result.shipSunk && Array.isArray(result.shipCells))
          .flatMap((result) => result.shipCells)
          .forEach((cell) => next.add(cell))
        return next
      })
      setPlayerResistedCells((current) => {
        const next = new Set(current)
        for (const result of newAttacks.filter((event) => event.playerId !== userId)
          .flatMap((event) => event.action.results)) {
          if (result.resisted) next.add(result.cell)
          if (result.cellSunk) next.delete(result.cell)
        }
        return next
      })
    }

    if (winnerId && !hasGameEnded) {
      const winner = match?.players?.find((player) => player.id === winnerId)?.username || 'Un jugador'
      const resultMessage = isSpectatorMode
        ? `${winner} ganó la partida.`
        : winnerId === userId
          ? '¡Ganaste! Destruiste toda la flota rival.'
          : 'La flota rival destruyó todos tus barcos.'
      void finishGame(resultMessage)
    }
  }, [
    finishGame,
    hasGameEnded,
    isRealtimeMatch,
    isSpectatorMode,
    match,
    matchActions,
    userId,
  ])

  useEffect(() => {
    if (isRealtimeMatch
        && isYourTurn
        && matchGame?.primaryActionAvailable === false
        && matchGame.extraNormalAvailable) {
      setSelectedAttack('normal')
    }
  }, [
    isRealtimeMatch,
    isYourTurn,
    matchGame?.extraNormalAvailable,
    matchGame?.primaryActionAvailable,
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
              {isRealtimeMatch && isBuyingFleet && !isFleetReady ? (
                <div className="fleet-purchase-panel">
                  <div className="fleet-purchase-list">
                    {SHIP_TYPES.map((ship) => (
                      <div className="fleet-purchase-row" key={ship.type}>
                        <div className="fleet-purchase-description">
                          <strong>{ship.name} · {ship.length} puntos</strong>
                          <small>{ship.ability} · Efecto acumulable hasta {MAX_STACKED_EFFECTS} veces</small>
                        </div>
                        <div className="fleet-purchase-counter">
                          <button
                            className="btn btn-outline-primary"
                            type="button"
                            aria-label={`Quitar ${ship.name}`}
                            disabled={purchasedShipCounts[ship.type] === 0}
                            onClick={() => refundShip(ship.type)}
                          >
                            −
                          </button>
                          <span title="Se pueden comprar más naves; solo dos activan el efecto">
                            {purchasedShipCounts[ship.type]} compradas · {Math.min(
                              purchasedShipCounts[ship.type],
                              MAX_STACKED_EFFECTS,
                            )} con efecto
                          </span>
                          <button
                            className="btn btn-outline-primary"
                            type="button"
                            aria-label={`Comprar ${ship.name}`}
                            disabled={remainingFleetPoints < ship.length}
                            onClick={() => buyShip(ship.type)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="fleet-purchase-footer">
                    <span>
                      Puntos usados: {purchasedFleetPoints}/{FLEET_POINTS}
                      {' · '}Disponibles: {remainingFleetPoints}
                    </span>
                    <small>
                      Los puntos sin gastar se convierten en munición adicional de cada tipo especial
                      (máximo 3 por tipo).
                    </small>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={purchasedShipCount === 0}
                      onClick={beginFleetPlacement}
                    >
                      Confirmar compra y colocar barcos
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="placement-options">
                    {(isRealtimeMatch ? SHIP_TYPES : LEGACY_SHIP_LENGTHS).map((shipOption) => {
                      const type = isRealtimeMatch ? shipOption.type : null
                      const length = isRealtimeMatch ? shipOption.length : shipOption
                      const name = isRealtimeMatch ? shipOption.name : `${length} casillas`
                      const placedTypeCount = isRealtimeMatch
                        ? ships.filter((ship) => ship.type === type).length
                        : 0
                      const remainingTypeCount = isRealtimeMatch
                        ? purchasedShipCounts[type] - placedTypeCount
                        : 1
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
                            || shipCount >= requiredShipCount
                            || (isRealtimeMatch && remainingTypeCount <= 0)}
                          onClick={() => {
                            setSelectedShipLength(length)
                            if (isRealtimeMatch) setSelectedShipType(type)
                            setShipPreview([])
                          }}
                        >
                          {isRealtimeMatch
                            ? `${name} (${length}) · ${remainingTypeCount} por colocar`
                            : name}
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
                        : placementMessage || (shipCount >= requiredShipCount
                          ? 'Flota completa. Deshaz la última nave para cambiarla o confirma para continuar.'
                          : `Naves colocadas: ${shipCount}/${requiredShipCount}. ${isRealtimeMatch
                            ? `Seleccionada: ${SHIP_TYPES.find((ship) => ship.type === selectedShipType).name}.`
                            : `Longitud actual: ${selectedShipLength} casillas.`}`)}
                  </span>
                </>
              )}
            </div>
          )}
          {gameError && <p className="game-error" role="alert">{gameError}</p>}

          <div
            className={`turn-status-card${isRealtimeMatch && matchGame?.phase === 'active'
              ? isYourTurn ? ' is-your-turn' : ' is-enemy-turn'
              : ''}`}
            role="status"
            aria-live="polite"
          >
            {turnStatus}
          </div>

          <div className="boards">
            <section className="board-card">
              <div className="board-title">
                <span>{isSpectatorMode
                  ? `Mapa de ataque de ${spectatorAttackMaps[0]?.player.username || 'Jugador 1'}`
                  : 'Estado actual del mapa del jugador'}</span>
                <b>⚓</b>
              </div>
              <div className="grid-labels"><span />{COLUMN_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="board-with-numbers">
                <div className="row-labels">
                  {COLUMN_LABELS.map((_, index) => <span key={index}>{index + 1}</span>)}
                </div>
                <div className={`sea-grid ${isSpectatorMode ? 'enemy-state-grid' : 'fleet-grid'}`}>
                  {BOARD_CELLS.map((cell) => {
                    const spectatorAttackMap = spectatorAttackMaps[0]
                    const hasShip = !isSpectatorMode && placedShipCells.includes(cell)
                    const isResisted = isSpectatorMode
                      ? spectatorAttackMap?.resisted.has(cell)
                      : playerResistedCells.has(cell)
                    const isSunken = isSpectatorMode
                      ? spectatorAttackMap?.sunken.has(cell)
                      : playerSunkenCells.has(cell)
                    const isHit = isSpectatorMode
                      ? spectatorAttackMap?.hits.has(cell) && !isResisted && !isSunken
                      : playerHits.has(cell) && hasShip && !isResisted && !isSunken
                    return (
                      <button
                        className={[
                          'sea-cell',
                          isSpectatorMode && 'unknown-cell',
                          hasShip && 'ship-cell',
                          !isSpectatorMode && shipPreview.includes(cell) && 'ship-preview',
                          isSpectatorMode && spectatorAttackMap?.attacked.has(cell) && 'attacked-cell',
                          isSpectatorMode && spectatorAttackMap?.evaded.has(cell) && 'evaded-cell',
                          isSpectatorMode && isHit && 'enemy-hit-cell',
                          !isSpectatorMode && isHit && 'hit-cell',
                          isResisted && 'resisted-cell',
                          isSunken && 'sunken-cell',
                        ].filter(Boolean).join(' ')}
                        type="button"
                        key={cell}
                        aria-label={isSpectatorMode
                          ? `Casilla ${cell + 1} del mapa de ataque de ${spectatorAttackMap?.player.username || 'Jugador 1'}`
                          : `Casilla ${cell + 1} de tu flota`}
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
              <p className="board-hint">
                {isSpectatorMode
                  ? `Ataques realizados por ${spectatorAttackMaps[0]?.player.username || 'Jugador 1'}`
                  : 'Tu flota está lista para el combate'}
              </p>
            </section>

            <section className="board-card">
              <div className="board-title">
                <span>{isSpectatorMode
                  ? `Mapa de ataque de ${spectatorAttackMaps[1]?.player.username || 'Jugador 2'}`
                  : 'Mapa enemigo'}</span>
                <b>?</b>
              </div>
              <div className="grid-labels"><span />{COLUMN_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="board-with-numbers">
                <div className="row-labels">
                  {COLUMN_LABELS.map((_, index) => <span key={index}>{index + 1}</span>)}
                </div>
                <div className="sea-grid enemy-state-grid">
                  {BOARD_CELLS.map((cell) => {
                    const spectatorAttackMap = spectatorAttackMaps[1]
                    const isResisted = isSpectatorMode
                      ? spectatorAttackMap?.resisted.has(cell)
                      : enemyResistedCells.has(cell) && !enemySunkenCells.has(cell)
                    const isSunken = isSpectatorMode
                      ? spectatorAttackMap?.sunken.has(cell)
                      : enemySunkenCells.has(cell)
                    const isHit = isSpectatorMode
                      ? spectatorAttackMap?.hits.has(cell) && !isResisted && !isSunken
                      : enemyHits.has(cell)
                    const sunkenShip = !isRealtimeMatch && ENEMY_SHIPS.some((ship) =>
                      ship.includes(cell) && ship.every((shipCell) => enemyHits.has(shipCell)))
                    const radarResult = radarResults.find((result) => result.cell === cell)
                    const isAttacked = isSpectatorMode
                      ? spectatorAttackMap?.attacked.has(cell)
                      : attackedEnemyCells.has(cell)
                    const isEvaded = isSpectatorMode
                      ? spectatorAttackMap?.evaded.has(cell)
                      : enemyEvadedCells.has(cell)
                    const isUsedAttackCenter = selectedAttack !== 'radar'
                      && isPreviouslyUsedAttackCenter(cell, attackCenters, retryableAttackCenters)
                    return (
                      <button
                        className={[
                          'sea-cell',
                          'unknown-cell',
                          !isSpectatorMode && sunkenShip && 'ship-cell',
                          isAttacked && 'attacked-cell',
                          isEvaded && 'evaded-cell',
                          isHit && !isResisted && !sunkenShip && (isSpectatorMode || !enemySunkenCells.has(cell))
                            && 'enemy-hit-cell',
                          isResisted && 'resisted-cell',
                          (sunkenShip || isSunken) && 'sunken-cell',
                          attackPreview.includes(cell) && 'attack-preview',
                          radarResult && (radarResult.detected ? 'radar-detected' : 'radar-clear'),
                        ].filter(Boolean).join(' ')}
                        type="button"
                        key={cell}
                        aria-label={isSpectatorMode
                          ? `Casilla ${cell + 1} del mapa de ataque de ${spectatorAttackMap?.player.username || 'Jugador 2'}`
                          : `Atacar casilla ${cell + 1} del jugador 2${radarResult ? (radarResult.detected ? ', radar detectó nave' : ', radar sin detección') : ''}`}
                        disabled={isSpectatorMode || !canAttack || hasGameEnded || isUsedAttackCenter}
                        onMouseEnter={() => setAttackPreview(getAffectedCells(cell, selectedOffsets))}
                        onMouseLeave={() => setAttackPreview([])}
                        onClick={() => attack(cell)}
                      />
                    )
                  })}
                </div>
              </div>
              <p className="board-hint">
                {isSpectatorMode
                  ? `Ataques realizados por ${spectatorAttackMaps[1]?.player.username || 'Jugador 2'}`
                  : 'Selecciona una casilla para atacar; los impactos se muestran aquí'}
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
                    <span><strong>Radar ({matchGame?.ammo?.radar ?? 0})</strong><small>Escanea 37 casillas en el patrón 7×7; consume el turno</small></span>
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
