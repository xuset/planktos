/* eslint-env browser, serviceworker */

const planktos = require('.')

// The location of the planktos root directory
const scope = location.pathname.substring(0, location.pathname.lastIndexOf('/'))
let available = {}
let delegator = null

addEventListener('fetch', onFetch)
addEventListener('install', onInstall)
addEventListener('message', onMessage)

assignDelegator()

function onFetch (event) {
  let url = new URL(event.request.url)

  if (url.host !== location.host || event.request.method !== 'GET') return

  console.log('PLANKTOS-FETCH', 'url=' + url.pathname)

  assignDelegator()

  // Fallback to browser http if the file was not found in the torrent or an error occures
  let promise = planktos.fetch(event, {scope: scope})
  .then(response => response != null ? response : fetch(event.request))
  .catch(err => {
    console.log('PLANKTOS-ERROR', err)
    return fetch(event.request)
  })

  event.respondWith(promise)
}

function onInstall (event) {
  event.waitUntil(planktos.update(scope).then(() => console.log('PLANKTOS-INSTALLED')))
}

function onMessage (event) {
  if (!event.data.planktos) return
  if (event.data.type === 'available') {
    available[event.source.id] = true
    assignDelegator()
  } else if (event.data.type === 'unavailable') {
    delete available[event.source.id]
    assignDelegator()
  }
}

function assignDelegator () {
  clients.matchAll({type: 'window'}).then(clients => {
    let potentials = clients.filter(c => c.id in available)
    let redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    if (potentials.length === 0) {
      clients.forEach(c => c.postMessage({
        type: 'request_availability',
        planktos: true
      }))
    } else if (redelegate) {
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
