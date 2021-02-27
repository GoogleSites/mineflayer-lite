const Vec3 = require('vec3').Vec3
const Entity = require('prismarine-entity')
const conv = require('../conversions')
const NAMED_ENTITY_HEIGHT = 1.62
const NAMED_ENTITY_WIDTH = 0.6
const CROUCH_HEIGHT = NAMED_ENTITY_HEIGHT - 0.08

module.exports = inject

const animationEvents = {
  0: 'entitySwingArm',
  1: 'entityHurt',
  2: 'entityWake',
  3: 'entityEat',
  4: 'entityCriticalEffect',
  5: 'entityMagicCriticalEffect'
}

const entityStatusEvents = {
  2: 'entityHurt',
  3: 'entityDead',
  6: 'entityTaming',
  7: 'entityTamed',
  8: 'entityShakingOffWater',
  10: 'entityEatingGrass'
}

function inject (bot, { version }) {
  const objects = require('minecraft-data')(version).objects
  const mobs = require('minecraft-data')(version).mobs
  const entitiesArray = require('minecraft-data')(version).entitiesArray
  const Item = require('prismarine-item')(version)
  const ChatMessage = require('prismarine-chat')(version)

  bot.findPlayer = bot.findPlayers = (filter) => {
    const filterFn = (entity) => {
      if (entity.type !== 'player') return false
      if (filter === null) return true
      if (typeof filter === 'object' && filter instanceof RegExp) {
        return entity.username.search(filter) !== -1
      } else if (typeof filter === 'function') {
        return filter(entity)
      } else if (typeof filter === 'string') {
        return entity.username.toLowerCase() === filter.toLowerCase()
      }
      return false
    }
    const resultSet = Object.keys(bot.entities)
      .map(key => bot.entities[key])
      .filter(filterFn)

    if (typeof filter === 'string') {
      switch (resultSet.length) {
        case 0:
          return null
        case 1:
          return resultSet[0]
        default:
          return resultSet
      }
    }
    return resultSet
  }

  bot.players = {}
  bot.uuidToUsername = {}
  bot.entities = {}

  bot.nearestEntity = (match = (entity) => { return true }) => {
    let best = null
    let bestDistance = Number.MAX_VALUE

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !match(entity)) {
        continue
      }

      const dist = bot.entity.position.distanceSquared(entity.position)
      if (dist < bestDistance) {
        best = entity
        bestDistance = dist
      }
    }

    return best
  }

  bot._client.once('login', (packet) => {
    // login
    bot.entity = fetchEntity(packet.entityId)
    bot.username = bot._client.username
    bot.entity.username = bot._client.username
    bot.entity.type = 'player'
  })

  bot._client.on('entity_equipment', (packet) => {
    // entity equipment
    const entity = fetchEntity(packet.entityId)
    if (packet.equipments !== undefined) {
      packet.equipments.forEach(equipment => entity.setEquipment(equipment.slot, equipment.item ? Item.fromNotch(equipment.item) : null))
    } else {
      entity.setEquipment(packet.slot, packet.item ? Item.fromNotch(packet.item) : null)
    }
    bot.emit('entityEquip', entity)
  })

  bot._client.on('animation', (packet) => {
    // animation
    const entity = fetchEntity(packet.entityId)
    const eventName = animationEvents[packet.animation]
    if (eventName) bot.emit(eventName, entity)
  })

  bot._client.on('named_entity_spawn', (packet) => {
    // in case player_info packet was not sent before named_entity_spawn : ignore named_entity_spawn (see #213)
    if (packet.playerUUID in bot.uuidToUsername) {
      // spawn named entity
      const entity = fetchEntity(packet.entityId)
      entity.type = 'player'
      entity.username = bot.uuidToUsername[packet.playerUUID]
      entity.uuid = packet.playerUUID
      entity.dataBlobs = packet.data
      if (bot.supportFeature('fixedPointPosition')) {
        entity.position.set(packet.x / 32, packet.y / 32, packet.z / 32)
      } else if (bot.supportFeature('doublePosition')) {
        entity.position.set(packet.x, packet.y, packet.z)
      }
      entity.yaw = conv.fromNotchianYawByte(packet.yaw)
      entity.pitch = conv.fromNotchianPitchByte(packet.pitch)
      entity.height = NAMED_ENTITY_HEIGHT
      entity.width = NAMED_ENTITY_WIDTH
      entity.metadata = parseMetadata(packet.metadata, entity.metadata)
      if (bot.players[entity.username] !== undefined && !bot.players[entity.username].entity) {
        bot.players[entity.username].entity = entity
      }
      bot.emit('entitySpawn', entity)
    }
  })

  bot.on('entityCrouch', (entity) => {
    entity.height = CROUCH_HEIGHT
  })

  bot.on('entityUncrouch', (entity) => {
    entity.height = NAMED_ENTITY_HEIGHT
  })

  bot._client.on('collect', (packet) => {
    // collect item
    const collector = fetchEntity(packet.collectorEntityId)
    const collected = fetchEntity(packet.collectedEntityId)
    bot.emit('playerCollect', collector, collected)
  })

  bot._client.on('entity_velocity', (packet) => {
    // entity velocity
    const entity = fetchEntity(packet.entityId)
    const notchVel = new Vec3(packet.velocityX, packet.velocityY, packet.velocityZ)
    entity.velocity.update(conv.fromNotchVelocity(notchVel))
  })

  bot._client.on('entity_destroy', (packet) => {
    // destroy entity
    packet.entityIds.forEach((id) => {
      const entity = fetchEntity(id)
      bot.emit('entityGone', entity)
      entity.isValid = false
      if (entity.username && bot.players[entity.username]) {
        bot.players[entity.username].entity = null
      }
      delete bot.entities[id]
    })
  })

  bot._client.on('rel_entity_move', (packet) => {
    // entity relative move
    const entity = fetchEntity(packet.entityId)
    if (bot.supportFeature('fixedPointDelta')) {
      entity.position.translate(packet.dX / 32, packet.dY / 32, packet.dZ / 32)
    } else if (bot.supportFeature('fixedPointDelta128')) {
      entity.position.translate(packet.dX / (128 * 32), packet.dY / (128 * 32), packet.dZ / (128 * 32))
    }
    bot.emit('entityMoved', entity)
  })

  bot._client.on('entity_look', (packet) => {
    // entity look
    const entity = fetchEntity(packet.entityId)
    entity.yaw = conv.fromNotchianYawByte(packet.yaw)
    entity.pitch = conv.fromNotchianPitchByte(packet.pitch)
    bot.emit('entityMoved', entity)
  })

  bot._client.on('entity_move_look', (packet) => {
    // entity look and relative move
    const entity = fetchEntity(packet.entityId)
    if (bot.supportFeature('fixedPointDelta')) {
      entity.position.translate(packet.dX / 32, packet.dY / 32, packet.dZ / 32)
    } else if (bot.supportFeature('fixedPointDelta128')) {
      entity.position.translate(packet.dX / (128 * 32), packet.dY / (128 * 32), packet.dZ / (128 * 32))
    }
    entity.yaw = conv.fromNotchianYawByte(packet.yaw)
    entity.pitch = conv.fromNotchianPitchByte(packet.pitch)
    bot.emit('entityMoved', entity)
  })

  bot._client.on('entity_teleport', (packet) => {
    // entity teleport
    const entity = fetchEntity(packet.entityId)
    if (bot.supportFeature('fixedPointPosition')) {
      entity.position.set(packet.x / 32, packet.y / 32, packet.z / 32)
    }
    if (bot.supportFeature('doublePosition')) {
      entity.position.set(packet.x, packet.y, packet.z)
    }
    entity.yaw = conv.fromNotchianYawByte(packet.yaw)
    entity.pitch = conv.fromNotchianPitchByte(packet.pitch)
    bot.emit('entityMoved', entity)
  })

  bot._client.on('entity_head_rotation', (packet) => {
    // entity head look
    const entity = fetchEntity(packet.entityId)
    entity.headYaw = conv.fromNotchianYawByte(packet.headYaw)
    bot.emit('entityMoved', entity)
  })

  bot._client.on('entity_status', (packet) => {
    // entity status
    const entity = fetchEntity(packet.entityId)
    const eventName = entityStatusEvents[packet.entityStatus]
    if (eventName) bot.emit(eventName, entity)
  })

  bot.on('spawn', () => {
    bot.emit('entitySpawn', bot.entity)
  })

  bot._client.on('player_info', (packet) => {
    // player list item(s)
    packet.data.forEach((item) => {
      const playerEntity = bot.findPlayers(item.name)
      let player = bot.uuidToUsername[item.UUID] ? bot.players[bot.uuidToUsername[item.UUID]] : null
      if (packet.action === 0) {
        let newPlayer = false

        // New Player
        if (!player) {
          player = bot.players[item.name] = {
            username: item.name,
            ping: item.ping,
            uuid: item.UUID,
            displayName: new ChatMessage({ text: '', extra: [{ text: item.name }] })
          }

          bot.uuidToUsername[item.UUID] = item.name
          bot.emit('playerJoined', player)
          newPlayer = true
        } else {
          // Just an Update
          player.gamemode = item.gamemode
          player.ping = item.ping
        }

        if (item.displayName) {
          player.displayName = new ChatMessage(JSON.parse(item.displayName))
        }

        player.entity = playerEntity

        if (playerEntity === bot.entity) {
          bot.player = player
        }

        if (!newPlayer) {
          bot.emit('playerUpdated', player)
        }
      } else if (player) {
        if (packet.action === 1) {
          player.gamemode = item.gamemode
        } else if (packet.action === 2) {
          player.ping = item.ping
        } else if (packet.action === 3 && !item.displayName) {
          player.displayName = new ChatMessage({ text: '', extra: [{ text: player.username }] })
        } else if (packet.action === 3 && item.displayName) {
          player.displayName = new ChatMessage(JSON.parse(item.displayName))
        } else if (packet.action === 4) {
          if (player.entity === bot.entity) return

          player.entity = null
          delete bot.players[player.username]
          delete bot.uuidToUsername[item.UUID]
          bot.emit('playerLeft', player)
          return
        } else {
          return
        }

        bot.emit('playerUpdated', player)
      }
    })
  })

  bot.swingArm = swingArm
  bot.attack = attack
  bot.mount = mount
  bot.dismount = dismount
  bot.useOn = useOn
  bot.moveVehicle = moveVehicle

  function swingArm (arm = 'right') {
    const hand = arm === 'right' ? 0 : 1
    bot._client.write('arm_animation', { hand })
  }

  function useOn (target) {
    // TODO: check if not crouching will make make this action always use the item
    useEntity(target, 0)
  }

  function attack (target, swing = true) {
    useEntity(target, 1)

    if (swing) {
      swingArm()
    }
  }

  function mount (target) {
    // TODO: check if crouching will make make this action always mount
    useEntity(target, 0)
  }

  function moveVehicle (left, forward) {
    bot._client.write('steer_vehicle', {
      sideways: left,
      forward: forward,
      jump: 0x01
    })
  }

  function dismount () {
    if (bot.vehicle) {
      bot._client.write('steer_vehicle', {
        sideways: 0.0,
        forward: 0.0,
        jump: 0x02
      })
    } else {
      bot.emit('error', new Error('dismount: not mounted'))
    }
  }

  function useEntity (target, leftClick, x, y, z) {
    if (x && y && z) {
      bot._client.write('use_entity', {
        target: target.id,
        mouse: leftClick,
        x,
        y,
        z,
        sneaking: false
      })
    } else {
      bot._client.write('use_entity', {
        target: target.id,
        mouse: leftClick,
        sneaking: false
      })
    }
  }

  function fetchEntity (id) {
    return bot.entities[id] || (bot.entities[id] = new Entity(id))
  }
}

function parseMetadata (metadata, entityMetadata = {}) {
  if (metadata !== undefined) {
    for (const { key, value } of metadata) {
      entityMetadata[key] = value
    }
  }

  return entityMetadata
}
