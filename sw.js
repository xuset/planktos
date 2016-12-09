
/* Hack to prevent rusha from setting a event handler for 'message'
 * see: https://github.com/srijs/rusha/issues/39
 */
self.global = self.window = self // eslint-disable-line
delete global.FileReaderSync

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:sw')
var delegate = require('delegate-job')
var parseTorrent = require('parse-torrent-file')
var IdbKvStore = require('idb-kv-store')

var BtFetch = require('./btfetch')

var persistent = new IdbKvStore('planktos')
var btfetch = new BtFetch(persistent)
var downloadTorrent = delegate('planktos-download')
var downloadJob = null

var preCached = [
  '/planktos/root.torrent',
  '/planktos/manifest.json',
  '/planktos/injection.html',
  '/planktos/injection.bundle.js',
  '/planktos/install.js'
]

global.addEventListener('message', onMessage)
global.addEventListener('fetch', onFetch)
global.addEventListener('activate', onActivate)
global.addEventListener('install', onInstall)

function onFetch (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)
  var search = url.search.substr(1).split('&')

  if (url.host !== global.location.host) return
  if (preCached.indexOf('/' + name) === -1 && name.startsWith('planktos/')) return
  if (name === '') name = 'index.html'

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  if (preCached.indexOf('/' + name) !== -1) {
    return event.respondWith(global.caches.open('planktosV1')
    .then(cache => cache.match('/' + name)))
  } else if (event.clientId == null && search.indexOf('forceSW') === -1) {
    return event.respondWith(createInjector(url))
  } else {
    if (!downloadJob) startDownload()
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

function startDownload () {
  persistent.get('torrentMetaBuffer').then(buffer => {
    downloadJob = downloadTorrent(buffer, function (err) {
      if (err.assigned === false) startDownload()
    })
  })
}

function createInjector (url) {
  var modUrl = new URL(url.toString())
  modUrl.search = (url.search === '' ? '?' : url.search + '&') + 'forceSW'

  return global.caches.open('planktosV1')
  .then(cache => cache.match('/planktos/injection.html'))
  .then(response => response.text())
  .then(text => {
    var blob = new Blob([text.replace(/{{url}}/g, modUrl.toString())], {type: 'text/html'})
    return new Response(blob)
  })
}
