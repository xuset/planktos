
/* Hack to prevent rusha from setting a event handler for 'message'
 * see: https://github.com/srijs/rusha/issues/39
 */
self.global = self.window = self // eslint-disable-line
delete global.FileReaderSync

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:sw')
var parseTorrent = require('parse-torrent-file')
var IdbKvStore = require('idb-kv-store')

var BtFetch = require('./btfetch')

var persistent = new IdbKvStore('planktos')
var btfetch = new BtFetch(persistent)
var delegator = null
var available = {}
var startTime = (new Date()).getMilliseconds()

var preCached = [
  '/planktos/root.torrent',
  '/planktos/manifest.json',
  '/planktos/injector.html',
  '/planktos/injector.bundle.js',
  '/planktos/index.js'
]

global.addEventListener('message', onMessage)
global.addEventListener('fetch', onFetch)
global.addEventListener('activate', onActivate)
global.addEventListener('install', onInstall)

assignDelegator()

function onFetch (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)
  var search = url.search.substr(1).split('&')

  if (url.host !== global.location.host) return
  if (preCached.indexOf('/' + name) === -1 && name.startsWith('planktos/')) return
  if (name === '') name = 'index.html'

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  if (preCached.indexOf('/' + name) !== -1) {
    return event.respondWith(global.caches.open('planktosV1')
    .then(cache => cache.match('/' + name)))
  } else if (event.clientId == null && search.indexOf('forceSW') === -1) {
    return event.respondWith(createInjector(url))
  } else {
    return event.respondWith(btfetch.fetch(name)
    .then(blob => {
      if (blob) return new Response(blob)
      else return global.fetch(event.request)
    })
    .catch(err => {
      debug('FETCH-ERROR', err)
      return global.fetch(event.request)
    }))
  }
}

function onMessage (event) {
  debug('MESSAGE', event.data)
  if (event.data.type === 'available') {
    available[event.source.id] = true
    assignDelegator()
  } else if (event.data.type === 'unavailable') {
    delete available[event.source.id]
    assignDelegator()
  }
}

function onActivate () {
  debug('ACTIVATE')
}

function onInstall (event) {
  debug('INSTALL')

  var cachePromise = global.caches.open('planktosV1')
  .then((cache) => cache.addAll(preCached))

  var manifestPromise = global.fetch('/planktos/manifest.json')
  .then(response => response.json())
  .then(json => {
    debug('MANIFEST', json)
    return persistent.set('manifest', json)
  })

  var torrentPromise = global.fetch('/planktos/root.torrent')
  .then(response => response.arrayBuffer())
  .then(arrayBuffer => {
    var buffer = Buffer.from(arrayBuffer)
    var parsed = parseTorrent(buffer)
    debug('TORRENT', parsed)
    return Promise.all([
      persistent.set('torrentMetaBuffer', buffer),
      persistent.set('torrentMeta', parsed)
    ])
  })

  var downloadedPromise = persistent.get('downloaded')
  .then(downloaded => {
    if (!downloaded) return persistent.set('downloaded', {})
  })

  event.waitUntil(Promise.all([
    cachePromise,
    manifestPromise,
    torrentPromise,
    downloadedPromise
  ]))
}

function assignDelegator () {
  this.clients.matchAll().then(clients => {
    var potentials = clients.filter(c => c.id in available)
    var redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    if (redelegate && potentials.length > 0) {
      debug('ASSIGN', 'old=' + (delegator ? delegator.id : null), 'new=' + potentials[0].id)
      if (delegator == null) debug('DELTA-TIME', (new Date()).getMilliseconds() - startTime)
      delegator = potentials[0]
      persistent.get('torrentMetaBuffer').then(buffer => {
        var msg = {
          type: 'download',
          torrentId: buffer
        }
        delegator.postMessage(msg)
      })
    }
  })
}

function createInjector (url) {
  var modUrl = new URL(url.toString())
  modUrl.search = (url.search === '' ? '?' : url.search + '&') + 'forceSW'

  return global.caches.open('planktosV1')
  .then(cache => cache.match('/planktos/injector.html'))
  .then(response => response.text())
  .then(text => {
    var blob = new Blob([text.replace(/{{url}}/g, modUrl.toString())], {type: 'text/html'})
    return new Response(blob)
  })
}
