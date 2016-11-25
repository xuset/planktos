module.exports = BtFetch

var ChunkStream = require('chunk-store-stream')
var toBlob = require('stream-to-blob')
var IdbBlobStore = require('idb-blob-store')
var BlobChunkStore = require('blob-chunk-store')

var global = self // eslint-disable-line

function BtFetch (persistent) {
  var self = this
  if (!(self instanceof BtFetch)) return new BtFetch(persistent)
  self._persistent = persistent
  self._waiting = {}
  self._downloaded = {}

  global.addEventListener('message', onMessage)

  function onMessage (event) {
    self._onMessage(event)
  }
}

BtFetch.prototype.fetch = function (filename) {
  var self = this
  return self._persistent.get(['manifest', 'torrentMeta']).then(result => {
    var [manifest, torrentMeta] = result
    var hash = manifest[filename]
    var fileInfo = torrentMeta.files.find(f => f.name === hash)

    if (!fileInfo) {
      return Promise.resolve(null)
    }

    if (hash in self._downloaded) {
      return self._getTorrentBlob(fileInfo.offset, fileInfo.length, torrentMeta)
    }

    // Defer until the file finishes downloading
    return new Promise(function (resolve) {
      if (!self._waiting[hash]) self._waiting[hash] = []
      self._waiting[hash].push(resolve)
    })
  })
}

BtFetch.prototype._onMessage = function (event) {
  var self = this
  if (event.data.type === 'file') {
    self._downloaded[event.data.name] = true
    self._resolveWaiters()
  }
}

BtFetch.prototype._resolveWaiters = function () {
  var self = this
  self._persistent.get('manifest').then(manifest => {
    for (var hash in self._downloaded) {
      if (hash in self._waiting) {
        var filename = Object.keys(manifest).find(fname => manifest[fname] === hash)
        var waiters = self._waiting[hash]
        delete self._waiting[hash]
        self.fetch(filename)
        .then(b => {
          for (var p of waiters) {
            p(b)
          }
        })
      }
    }
  })
}

BtFetch.prototype._getTorrentBlob = function (offset, length, torrentMeta) {
  var self = this
  if (!self._chunkStore) {
    self._chunkStore = new IdbChunkStore(torrentMeta.pieceLength, torrentMeta.infoHash)
  }

  var stream = ChunkStream.read(self._chunkStore, self._chunkStore.chunkLength, {
    length: torrentMeta.length
  })

  return new Promise(function (resolve, reject) {
    toBlob(stream, function (err, blob) {
      if (err) return reject(err)
      resolve(blob.slice(offset, offset + length))
    })
  })
}

function IdbChunkStore (chunkLength, infoHash) {
  var idb = new IdbBlobStore({name: infoHash})
  return new BlobChunkStore(chunkLength, idb)
}
