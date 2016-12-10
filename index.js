
module.exports.getFileBlob = getFileBlob

var ChunkStream = require('chunk-store-stream')
var IdbChunkStore = require('indexdb-chunk-store')
var IdbKvStore = require('idb-kv-store')
var toBlob = require('stream-to-blob')

var waitingFetches = {}
var persistent = new IdbKvStore('planktos')
var downloaded = new IdbKvStore('planktos-downloaded')
var chunkStore = null
var downloadChannel = new BroadcastChannel('planktos')
downloadChannel.addEventListener('message', onDownload)

function getFileBlob (filename) {
  return persistent.get(['manifest', 'torrentMeta']).then(result => {
    var [manifest, torrentMeta] = result
    var hash = manifest[filename]
    var fileInfo = torrentMeta.files.find(f => f.name === hash)

    if (!fileInfo) {
      return Promise.resolve(null) // TODO actually reject promise
    }

    chunkStore = chunkStore || new IdbChunkStore(torrentMeta.pieceLength, {name: torrentMeta.infoHash})

    return downloaded.get(hash).then(isDownloaded => {
      if (isDownloaded) {
        var stream = ChunkStream.read(chunkStore, chunkStore.chunkLength, {
          length: torrentMeta.length
        })
        return new Promise(function (resolve, reject) {
          toBlob(stream, function (err, blob) {
            if (err) return reject(err)
            resolve(blob.slice(fileInfo.offset, fileInfo.offset + fileInfo.length))
          })
        })
      } else {
        // Defer until the file finishes downloading
        return new Promise(function (resolve) {
          if (!waitingFetches[hash]) waitingFetches[hash] = []
          waitingFetches[hash].push(resolve)
        })
      }
    })
  })
}

function onDownload () {
  return Promise.all([
    persistent.get('manifest'),
    downloaded.json()
  ]).then(result => {
    var [manifest, downloaded] = result
    for (var hash in downloaded) {
      if (hash in waitingFetches) {
        var filename = Object.keys(manifest).find(fname => manifest[fname] === hash)
        var waiters = waitingFetches[hash]
        delete waitingFetches[hash]
        getFileBlob(filename)
        .then(b => {
          for (var p of waiters) {
            p(b)
          }
        })
      }
    }
  })
}
