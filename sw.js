/* eslint-env browser, serviceworker */

const planktos = require('.')

// The location of the planktos root directory
const root = location.pathname.substring(0, location.pathname.lastIndexOf('/'))

addEventListener('fetch', onFetch)
addEventListener('install', onInstall)

function onInstall (event) {
  event.waitUntil(planktos.update(root))
}

function onFetch (event) {
  let url = new URL(event.request.url)

  if (url.host !== location.host || event.request.method !== 'GET') return

  // Let the browser handle webseed requests for performance reasons
  if (url.pathname.replace(root, '').startsWith('/planktos/files/')) return

  console.log('PLANKTOS-FETCH', 'url=' + url.pathname)

  // Fallback to browser http if the file was not found in the torrent or an error occurs
  let responsePromise = planktos.fetch(event, {root: root})
  .then(response => response != null ? response : fetch(event.request))
  .catch(err => {
    console.log('PLANKTOS-ERROR', err)
    return fetch(event.request)
  })

  event.respondWith(responsePromise)
}
