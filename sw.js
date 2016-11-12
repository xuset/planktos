
/* Hack to prevent rusha from setting a event handler for 'message'
 * see: https://github.com/srijs/rusha/issues/39
 */
delete self.FileReaderSync
self.window = self // eslint-disable-line

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:sw')
var ChunkStream = require('chunk-store-stream')
var toBlob = require('stream-to-blob')
var parseTorrent = require('parse-torrent-file')
var IdbBlobStore = require('idb-blob-store')
var BlobChunkStore = require('blob-chunk-store')

var filePromises = {}
var files = {}
var torrentMetaBuffer = null
var torrentMeta = null
var delegator = null
var available = {}
var chunkStore = null

if (!torrentMeta) loadTorrentMeta()
if (!delegator) assignDelegator()

addEventListener('fetch', function (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)
  var search = url.search.substr(1).split('&')

  if (url.host !== location.host) return
  if (name === '') name = 'index.html'
  if (torrentMeta.files.find(f => f.name === name) == null) return

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  if (event.clientId == null && search.indexOf('forceSW') === -1) {
    return event.respondWith(createInjector(url))
  } else if (name in files) {
    return event.respondWith(getTorrentFile(name).then(b => new Response(b)))
  } else {
    event.respondWith(new Promise(function (resolve) {
      if (!filePromises[name]) filePromises[name] = []
      filePromises[name].push(resolve)
    }))
  }
})

addEventListener('message', function (event) {
  debug('MESSAGE', event.data)
  if (event.data.type === 'file') {
    files[event.data.name] = true
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
})

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

addEventListener('activate', function (event) {
  debug('ACTIVATE')
})

addEventListener('install', function (event) {
  debug('INSTALL')

  var urls = [
    '/root.torrent',
    '/injector.html'
  ]
  event.waitUntil(caches.open('planktosV1')
    .then((cache) => cache.addAll(urls))
    .then(() => loadTorrentMeta()))
})

function loadTorrentMeta () {
  return caches.open('planktosV1')
  .then(cache => cache.match(new Request('/root.torrent')))
  .then(response => response ? response.arrayBuffer() : null)
  .then(arrayBuffer => {
    if (!arrayBuffer) return
    torrentMetaBuffer = new Buffer(arrayBuffer)
    torrentMeta = parseTorrent(torrentMetaBuffer)
    chunkStore = new IdbChunkStore(torrentMeta.pieceLength, torrentMeta.infoHash)
    for (var f of torrentMeta.files) {
      validateFile(f.name)
    }
    debug('TORRENT META', torrentMeta)
    return torrentMeta
  })
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
        torrentId: torrentMetaBuffer
      }
      delegator.postMessage(msg)
    }
  })
}

function getTorrentFile (fname) {
  return new Promise(function (resolve, reject) {
    var file = torrentMeta.files.find(f => f.name === fname)
    if (!file) return reject(new Error('File does not exist'))

    var stream = ChunkStream.read(chunkStore, chunkStore.chunkLength, {length: torrentMeta.length})

    toBlob(stream, function (err, blob) {
      if (err) reject(err)
      else resolve(blob.slice(file.offset, file.offset + file.length))
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

  return caches.open('planktosV1')
  .then(cache => cache.match(new Request('/injector.html')))
  .then(response => response.text())
  .then(text => {
    var blob = new Blob([text.replace(/{{url}}/g, modUrl.toString())], {type: 'text/html'})
    return new Response(blob)
  })
}
