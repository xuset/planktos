
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
var config = null
var torrentFileBuffer = null
var torrentFile = null
var delegator = null
var available = {}
var chunkStore = null

loadConfig()
assignDelegator()

addEventListener('fetch', function (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)
  var search = url.search.substr(1).split('&')

  if (url.host !== location.host) return
  if (name === '') name = 'index.html'
  if (name === 'bundle.js' && !(name in files)) return

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  if (event.clientId == null && search.indexOf('forceSW') === -1) {
    return event.respondWith(createInjector(url))
  } else if (name in files) {
    return event.respondWith(getTorrentFile(name).then(b => new Response(b)))
  } else {
    event.respondWith(new Promise(function (resolve) {
      filePromises[name] = resolve
    }))
  }
})

addEventListener('message', function (event) {
  debug('MESSAGE', JSON.stringify(event.data))
  if (event.data.type === 'file') {
    files[event.data.name] = true
    resolvePromises()
    event.ports[0].postMessage({})
  } else if (event.data.type === 'available') {
    available[event.source.id] = true
    assignDelegator()
  } else if (event.data.type === 'unavailable') {
    delete available[event.source.id]
    assignDelegator()
  } else {
    event.ports[0].postMessage({error: 'message type not supported'})
  }
})

function resolvePromises () {
  for (var name in files) {
    if (name in filePromises) {
      var promise = filePromises[name]
      delete filePromises[name]
      getTorrentFile(name)
      .then(b => promise(new Response(b)))
    }
  }
}

addEventListener('activate', function (event) {
  debug('ACTIVATE')
})

addEventListener('install', function (event) {
  debug('INSTALL')

  var urls = [
    '/planktos.config.json',
    '/root.torrent',
    '/injector.html'
  ]
  event.waitUntil(caches.open('planktosV1')
    .then((cache) => cache.addAll(urls))
    .then(() => loadConfig()))
})

function loadConfig () {
  var cachePromise = caches.open('planktosV1')

  var configPromise = cachePromise
    .then(cache => cache.match(new Request('/planktos.config.json')))
    .then(response => response ? response.json() : null)
    .then(json => {
      config = json || config
      return config
    })

  var torrentPromise = cachePromise
    .then(cache => cache.match(new Request('/root.torrent')))
    .then(response => response ? response.arrayBuffer() : null)
    .then(arrayBuffer => {
      if (arrayBuffer) {
        torrentFileBuffer = arrayBuffer || torrentFileBuffer
        torrentFile = parseTorrent(new Buffer(torrentFileBuffer))
        chunkStore = new IdbChunkStore(torrentFile.pieceLength, torrentFile.infoHash)
        debug('TORRENT META', torrentFile)
      }
      return torrentFile
    })
  return Promise.all([configPromise, torrentPromise])
}

function assignDelegator () {
  this.clients.matchAll().then(clients => {
    var potentials = clients.filter(c => c.id in available)
    var redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    if (redelegate && potentials.length > 0) {
      if (config.torrentId == null) throw new Error('cannot start download. torrentId unkown.')
      delegator = potentials[0]
      var msg = {
        type: 'download',
        torrentId: config.torrentId
      }
      delegator.postMessage(msg)
    }
  })
}

function getTorrentFile (fname, cb) {
  return new Promise(function (resolve, reject) {
    var file = torrentFile.files.find(f => f.name === fname)
    if (!file) return reject(new Error('File does not exist'))

    var stream = ChunkStream.read(chunkStore, chunkStore.chunkLength, {length: torrentFile.length})

    toBlob(stream, function (err, blob) {
      blob = blob.slice(file.offset, file.offset + file.length)
      if (err) reject(err)
      else resolve(blob)
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
    var blob = new Blob([text.replace('{{url}}', modUrl.toString())], {type: 'text/html'})
    return new Response(blob)
  })
}
