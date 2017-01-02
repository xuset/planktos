self.global = self // eslint-disable-line

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:sw')
var planktos = require('.')
var injection = require('./lib/injection')

var scope = global.location.pathname.substring(0, global.location.pathname.lastIndexOf('/'))
var available = {}
var delegator = null

global.addEventListener('fetch', onFetch)
global.addEventListener('activate', onActivate)
global.addEventListener('install', onInstall)
global.addEventListener('message', onMessage)

assignDelegator()

function onFetch (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.replace(scope, '').substr(1)
  var search = url.search.substr(1).split('&')

  if (url.host !== global.location.host || event.request.method !== 'GET') return
  if (planktos.preCached.indexOf('/' + name) === -1 && name.startsWith('planktos/')) return
  if (name === '') name = 'index.html' // TODO handle case when file is not top level

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  // TODO let browser handle request if file is not in torrent
  if (planktos.preCached.indexOf('/' + name) !== -1) {
    return event.respondWith(global.caches.open('planktos')
    .then(cache => cache.match(scope + '/' + name)))
  } else if (event.clientId == null && search.indexOf('noPlanktosInjection') === -1) {
    var modUrl = new URL(url.toString())
    modUrl.search = (url.search === '' ? '?' : url.search + '&') + 'noPlanktosInjection'
    var template = name.endsWith('html') || name.endsWith('htm')
      ? injection.docWrite : injection.iframe
    var html = template.replace('{{url}}', modUrl.toString()).replace('{{scope}}', scope)
    return event.respondWith(new Response(new Blob([html], {type: 'text/html'})))
  } else {
    // TODO handle RANGE header
    return event.respondWith(planktos.getFileBlob(name)
    .then(blob => new Response(blob))
    .catch(err => {
      if (err.message !== 'File not found') debug('FETCH-ERROR', err)
      return global.fetch(event.request)
    }))
  }
}

function onActivate () {
  debug('ACTIVATE')
}

function onInstall (event) {
  debug('INSTALL')
  var update = planktos.update(scope)
  update.then(() => planktos.getManifest())
  .then((manifest) => debug('MANIFEST', manifest))
  .then(() => planktos.getTorrentMeta())
  .then((torrentMeta) => debug('TORRENT', torrentMeta))
  event.waitUntil(update)
}

function onMessage (event) {
  if (!event.data.planktos) return
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
  this.clients.matchAll({type: 'window'}).then(clients => {
    var potentials = clients.filter(c => c.id in available)
    var redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    if (potentials.length === 0) {
      clients.forEach(c => c.postMessage({
        type: 'request_availability',
        planktos: true
      }))
    } else if (redelegate) {
      debug('ASSIGN', 'old=' + (delegator ? delegator.id : null), 'new=' + potentials[0].id)
      delegator = potentials[0]
      planktos.getTorrentMetaBuffer().then(buffer => {
        if (delegator !== potentials[0]) return
        clients.filter(c => c.id !== delegator.id).forEach(c => c.postMessage({
          type: 'cancel_download',
          planktos: true
        }))
        delegator.postMessage({
          type: 'download',
          torrentId: buffer,
          planktos: true
        })
      })
    }
  })
}
