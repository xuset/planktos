
/* Hack to prevent rusha from setting a event handler for 'message'
 * see: https://github.com/srijs/rusha/issues/39
 */
delete self.FileReaderSync
self.global = self.window = self // eslint-disable-line

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:sw')
var ChunkStream = require('chunk-store-stream')
var toBlob = require('stream-to-blob')
var parseTorrent = require('parse-torrent-file')
var IdbBlobStore = require('idb-blob-store')
var BlobChunkStore = require('blob-chunk-store')
var LRU = require('lru-cache')

var torrentMeta = null
var manifest = null
var filePromises = {}
var files = {}
var delegator = null
var available = {}
var chunkStore = null
var fileCache = new LRU({
  max: 10 * 1024 * 1024,
  length: function (blob) { return blob.size }
})

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

if (!torrentMeta) loadTorrentMeta()
if (!delegator) assignDelegator()

function onFetch (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)
  var search = url.search.substr(1).split('&')

  if (manifest == null || torrentMeta == null) return // TODO handle case
  if (url.host !== global.location.host) return
  if (name === '') name = 'index.html'
  if (!(name in manifest) && preCached.indexOf('/' + name) === -1) return

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  if (preCached.indexOf('/' + name) !== -1) {
    return event.respondWith(global.caches.open('planktosV1')
    .then(cache => cache.match('/' + name)))
  } else if (event.clientId == null && search.indexOf('forceSW') === -1) {
    return event.respondWith(createInjector(url))
  } else if (name in files) {
    return event.respondWith(getTorrentFile(name).then(b => new Response(b)))
  } else {
    event.respondWith(new Promise(function (resolve) {
      if (!filePromises[name]) filePromises[name] = []
      filePromises[name].push(resolve)
    }))
  }
}

function onMessage (event) {
  debug('MESSAGE', event.data)
  if (event.data.type === 'file') {
    var givenName = Object.keys(manifest).find(name => manifest[name] === event.data.name)
    if (!givenName) throw new Error('File not found: ' + event.data.name)
    files[givenName] = true
    resolvePromises()
  } else if (event.data.type === 'available') {
    available[event.source.id] = true
    assignDelegator()
  } else if (event.data.type === 'unavailable') {
    delete available[event.source.id]
    assignDelegator()
  } else {
    throw new Error('Unsupported message type')
  }
}

function onActivate () {
  debug('ACTIVATE')
}

function onInstall (event) {
  debug('INSTALL')

  event.waitUntil(global.caches.open('planktosV1')
    .then((cache) => cache.addAll(preCached))
    .then(() => loadTorrentMeta()))
}

function resolvePromises () {
  for (var name in files) {
    if (name in filePromises) {
      var promises = filePromises[name]
      delete filePromises[name]
      getTorrentFile(name)
      .then(b => {
        for (var p of promises) {
          p(new Response(b))
        }
      })
    }
  }
}

function loadTorrentMeta () {
  var cache = global.caches.open('planktosV1')

  var torrentPromise = cache.then(cache => cache.match('/planktos/root.torrent'))
  .then(response => response ? response.arrayBuffer() : null)
  .then(arrayBuffer => {
    if (!arrayBuffer) return
    torrentMeta = parseTorrent(new Buffer(arrayBuffer))

    chunkStore = new IdbChunkStore(torrentMeta.pieceLength, torrentMeta.infoHash)
    debug('TORRENT META', torrentMeta)
    return torrentMeta
  })

  var manifestPromise = cache.then(cache => cache.match('/planktos/manifest.json'))
  .then(response => response ? response.json() : null)
  .then(json => {
    manifest = json || manifest
    console.log('MANIFEST', manifest)
    for (var f in manifest) {
      validateFile(f)
    }
    return manifest
  })

  return Promise.all([torrentPromise, manifestPromise])
}

function validateFile (fname) {
  getTorrentFile(fname)
  .then(() => {
    debug('VALIDATE', 'file=' + fname, 'success=true')
    files[fname] = true
    resolvePromises()
  })
  .catch(() => {
    debug('VALIDATE', 'file=' + fname, 'success=false')
  })
}

function assignDelegator () {
  this.clients.matchAll().then(clients => {
    var potentials = clients.filter(c => c.id in available)
    var redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    if (redelegate && potentials.length > 0) {
      debug('ASSIGN', 'old=' + (delegator ? delegator.id : null), 'new=' + potentials[0].id)
      delegator = potentials[0]
      var msg = {
        type: 'download',
        torrentId: parseTorrent.encode(torrentMeta)
      }
      delegator.postMessage(msg)
    }
  })
}

function getTorrentFile (fname) {
  var cached = fileCache.get(fname)
  if (cached) return Promise.resolve(cached)

  return new Promise(function (resolve, reject) {
    var hashName = manifest[fname]
    if (!hashName) return reject(new Error('File does not exist'))
    var file = torrentMeta.files.find(f => f.name === hashName)
    if (!file) return reject(new Error('File does not exist'))

    var stream = ChunkStream.read(chunkStore, chunkStore.chunkLength, {length: torrentMeta.length})

    toBlob(stream, function (err, blob) {
      if (err) return reject(err)
      blob = blob.slice(file.offset, file.offset + file.length)
      fileCache.set(fname, blob)
      resolve(blob)
    })
  })
}

function IdbChunkStore (chunkLength, infoHash) {
  var idb = new IdbBlobStore({name: infoHash})
  return new BlobChunkStore(chunkLength, idb)
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
