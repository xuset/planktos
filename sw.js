self.global = self // eslint-disable-line

require('debug').enable('planktos:*')
const debug = require('debug')('planktos:sw')
const planktos = require('.')
const injection = require('./lib/injection')

const scope = global.location.pathname.substring(0, global.location.pathname.lastIndexOf('/'))
let available = {}
let delegator = null

global.addEventListener('fetch', onFetch)
global.addEventListener('activate', onActivate)
global.addEventListener('install', onInstall)
global.addEventListener('message', onMessage)

assignDelegator()

function onFetch (event) {
  let url = new URL(event.request.url)
  let fpath = planktos._normalizePath(url.pathname.replace(scope, ''))
  let search = url.search.substr(1).split('&')

  if (url.host !== global.location.host || event.request.method !== 'GET') return
  if (planktos.preCached.indexOf('/' + fpath) === -1 && fpath.startsWith('planktos/')) return

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + fpath)

  // TODO let browser handle request if file is not in torrent
  if (planktos.preCached.indexOf('/' + fpath) !== -1) {
    return event.respondWith(global.caches.open('planktos')
    .then(cache => cache.match(scope + '/' + fpath)))
  } else if (event.clientId == null && search.indexOf('noPlanktosInjection') === -1) {
    let fname = fpath.substr(fpath.lastIndexOf('/') + 1)
    const isHTML = fname.endsWith('.html') || fname.endsWith('.htm') || !fname.includes('.')
    let modUrl = new URL(url.toString())
    modUrl.search = (url.search === '' ? '?' : url.search + '&') + 'noPlanktosInjection'
    let template = isHTML ? injection.docWrite : injection.iframe
    let html = template.replace('{{url}}', modUrl.toString()).replace('{{scope}}', scope)
    return event.respondWith(new Response(new Blob([html], {type: 'text/html'})))
  } else {
    // TODO handle RANGE header
    return event.respondWith(planktos.getFileBlob(fpath)
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
  let update = planktos.update(scope)
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
  global.clients.matchAll({type: 'window'}).then(clients => {
    let potentials = clients.filter(c => c.id in available)
    let redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
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
