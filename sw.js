
/* Hack to prevent rusha from setting a event handler for 'message'
 * see: https://github.com/srijs/rusha/issues/39
 */
self.global = self.window = self // eslint-disable-line
delete global.FileReaderSync

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:sw')
var planktos = require('.')

var available = {}
var delegator = null

global.addEventListener('fetch', onFetch)
global.addEventListener('activate', onActivate)
global.addEventListener('install', onInstall)
global.addEventListener('message', onMessage)

assignDelegator()

function onFetch (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)
  var search = url.search.substr(1).split('&')

  if (url.host !== global.location.host) return
  if (planktos.preCached.indexOf('/' + name) === -1 && name.startsWith('planktos/')) return
  if (name === '') name = 'index.html'

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  if (planktos.preCached.indexOf('/' + name) !== -1) {
    return event.respondWith(global.caches.open('planktos')
    .then(cache => cache.match('/' + name)))
  } else if (event.clientId == null && search.indexOf('forceSW') === -1) {
    return event.respondWith(createInjector(url))
  } else {
    return event.respondWith(planktos.getFileBlob(name)
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

function onActivate () {
  debug('ACTIVATE')
}

function onInstall (event) {
  debug('INSTALL')
  var update = planktos.update()
  update.then(() => planktos.getManifest())
  .then((manifest) => debug('MANIFEST', manifest))
  .then(() => planktos.getTorrentMeta())
  .then((torrentMeta) => debug('TORRENT', torrentMeta))
  event.waitUntil(update)
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

function assignDelegator () {
  this.clients.matchAll().then(clients => {
    var potentials = clients.filter(c => c.id in available)
    var redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    if (redelegate && potentials.length > 0) {
      debug('ASSIGN', 'old=' + (delegator ? delegator.id : null), 'new=' + potentials[0].id)
      delegator = potentials[0]
      planktos.getTorrentMetaBuffer().then(buffer => {
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

  return global.caches.open('planktos')
  .then(cache => cache.match('/planktos/injection.html'))
  .then(response => response.text())
  .then(text => {
    var blob = new Blob([text.replace(/{{url}}/g, modUrl.toString())], {type: 'text/html'})
    return new Response(blob)
  })
}
