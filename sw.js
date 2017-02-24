/* eslint-env browser, serviceworker */
/* global Planktos */

importScripts('planktos/planktos.min.js')
// or const Planktos = require('planktos')

// The location of the planktos root directory
const root = location.pathname.substring(0, location.pathname.lastIndexOf('/'))
const planktos = new Planktos()

addEventListener('install', function (event) {
  event.waitUntil(planktos.update(root))
})

addEventListener('fetch', function (event) {
  let url = new URL(event.request.url)

  // Early return tells the browser to handle the request instead of the service worker
  if (url.host !== location.host || event.request.method !== 'GET') return

  // Let the browser handle webseed requests for performance reasons
  if (url.pathname.replace(root, '').startsWith('/planktos/files/')) return

  // Fallback to http if the file was not found in the torrent or an error occurs
  let responsePromise = planktos.fetch(event, {root: root})
    .catch(err => console.log('PLANKTOS-ERROR', err))
    .then(response => response != null ? response : fetch(event.request))

  event.respondWith(responsePromise)
})
