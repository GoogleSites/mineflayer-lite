if (typeof process !== 'undefined' && parseInt(process.versions.node.split('.')[0]) < 14) {
  console.error('Your node version is currently', process.versions.node)
  console.error('Please update it to a version >= 14.x.x from https://nodejs.org/')
  process.exit(1)
}

const mc = require('minecraft-protocol')
const EventEmitter = require('events').EventEmitter
const pluginLoader = require('./lib/plugin_loader')
const supportFeature = require('./lib/supportFeature')
const plugins = {
  chat: require('./lib/plugins/chat'),
  entities: require('./lib/plugins/entities'),
  game: require('./lib/plugins/game'),
  kick: require('./lib/plugins/kick')
}

const supportedVersions = require('./lib/version').supportedVersions
const testedVersions = require('./lib/version').testedVersions

module.exports = {
  createBot,
  Location: require('./lib/location'),
  ScoreBoard: require('./lib/scoreboard'),
  supportedVersions,
  testedVersions,
  supportFeature
}

function createBot (options = {}) {
  options.username = options.username || 'Player'
  options.version = options.version || false
  options.plugins = options.plugins || {}
  options.hideErrors = options.hideErrors || true
  options.logErrors = options.logErrors === undefined ? true : options.logErrors
  options.loadInternalPlugins = options.loadInternalPlugins !== false
  const bot = new EventEmitter()
  bot._client = null
  bot.end = () => bot._client.end()
  if (options.logErrors) {
    bot.on('error', err => {
      if (!options.hideErrors) {
        console.log(err)
      }
    })
  }

  pluginLoader(bot, options)
  const internalPlugins = Object.keys(plugins)
    .filter(key => {
      if (typeof options.plugins[key] === 'function') return false
      if (options.plugins[key] === false) return false
      return options.plugins[key] || options.loadInternalPlugins
    }).map(key => plugins[key])
  const externalPlugins = Object.keys(options.plugins)
    .filter(key => {
      return typeof options.plugins[key] === 'function'
    }).map(key => options.plugins[key])
  bot.loadPlugins([...internalPlugins, ...externalPlugins])

  bot._client = mc.createClient(options)
  bot._client.on('connect', () => {
    bot.emit('connect')
  })
  bot._client.on('error', (err) => {
    bot.emit('error', err)
  })
  bot._client.on('end', () => {
    bot.emit('end')
  })
  if (!bot._client.wait_connect) next()
  else bot._client.once('connect_allowed', next)
  function next () {
    const version = require('minecraft-data')(bot._client.version).version
    if (supportedVersions.indexOf(version.majorVersion) === -1) {
      throw new Error(`Version ${version.minecraftVersion} is not supported.`)
    }

    const latestTestedVersion = testedVersions[testedVersions.length - 1]
    const latestProtocolVersion = require('minecraft-data')(latestTestedVersion).protocolVersion
    if (version.protocolVersion > latestProtocolVersion) {
      throw new Error(`Version ${version.minecraftVersion} is not supported. Latest supported version is ${latestTestedVersion}.`)
    }

    bot.protocolVersion = version.version
    bot.majorVersion = version.majorVersion
    bot.version = version.minecraftVersion
    options.version = version.minecraftVersion
    bot.supportFeature = feature => supportFeature(feature, version.minecraftVersion)
    bot.emit('inject_allowed')
  }
  return bot
}