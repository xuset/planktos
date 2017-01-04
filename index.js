var global = typeof window !== 'undefined' ? window : self // eslint-disable-line

// Temp bug fix: https://github.com/srijs/rusha/issues/39
if (global.WorkerGlobalScope) delete global.FileReaderSync

var preCached = [
  '/planktos/root.torrent',
  '/planktos/manifest.json',
  '/planktos/planktos.js',
  '/planktos/install.js'
]

// TODO add getFileStream
module.exports.getFileBlob = getFileBlob
module.exports.update = update
module.exports.preCached = preCached // TODO better way to handle preCached
module.exports.getManifest = getManifest
module.exports.getDownloaded = getDownloaded
module.exports.getTorrentMeta = getTorrentMeta
module.exports.getTorrentMetaBuffer = getTorrentMetaBuffer
module.exports.downloader = require('./lib/downloader')

var ChunkStream = require('chunk-store-stream')
var IdbChunkStore = require('indexdb-chunk-store')
var IdbKvStore = require('idb-kv-store')
var toBlob = require('stream-to-blob')
var parseTorrent = require('parse-torrent-file')

var waitingFetches = {}
var persistent = new IdbKvStore('planktos')
var downloaded = new IdbKvStore('planktos-downloaded')
var chunkStore = null
var downloadChannel = null

function getDownloaded () {
  return downloaded.json()
}

function getManifest () {
  return persistent.get('manifest')
}

function getTorrentMeta () {
  return persistent.get('torrentMeta')
}

function getTorrentMetaBuffer () { // TODO Fix parsing bug so this can be removed
  return persistent.get('torrentMetaBuffer')
}

function getFileBlob (filePath) {
  if (typeof BroadcastChannel === 'undefined') throw new Error('No BroadcastChannel support')

  if (!downloadChannel) {
    downloadChannel = new BroadcastChannel('planktos-downloaded')
    downloadChannel.addEventListener('message', onDownload)
  }

  return persistent.get(['manifest', 'torrentMeta']).then(result => {
    var [manifest, torrentMeta] = result

    let getFilename = (filePath) => filePath.slice(filePath.lastIndexOf('/') + 1)
    let filePathIsDir = (filePath) => filePath.endsWith('/')
    let filenameHasExtension = (filename) => filename.indexOf('.') !== -1

    // Try to coerce extension-less files into directories
    if (!filePathIsDir(filePath) && !filenameHasExtension(getFilename(filePath))) {
      // Since directories are not stored in the manifest, we can only safely assume an extension-less
      // file is a diretory if (1) the file isn't in the manifest and (2) there are files which
      // are in subdirectories relative to the file path
      if (Object.keys(manifest).indexOf(filePath) === -1 &&
          Object.keys(manifest).find((fpath) => fpath.startsWith(filePath + '/'))) {
        filePath += '/'
      }
    }

    // Try to find an index file if `filePath` is a directory
    if (filePathIsDir(filePath)) {
      let filesInDirectory = Object.keys(manifest).filter(
        (fpath) => fpath.startsWith(filePath)
      ).map(getFilename)

      // Index files are listed in order of priority
      let indexFilename = ['index.html', 'index.htm'].find((fname) => filesInDirectory.includes(fname))

      if (indexFilename === undefined) throw new Error('File not found')

      filePath += indexFilename
    }

    var hash = manifest[filePath]
    var fileInfo = torrentMeta.files.find(f => f.name === hash)

    if (!fileInfo) {
      return Promise.reject(new Error('File not found'))
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

function update (url) {
  if (!url) url = ''
  if (url.endsWith('/')) url = url.substr(0, url.length - 1)

  var cachePromise = global.caches.open('planktos')
  .then((cache) => cache.addAll(preCached.map(f => url + f)))
  .then(() => global.caches.open('planktos'))

  var manifestPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/manifest.json'))
  .then(response => response.json())
  .then(json => {
    return persistent.set('manifest', json)
  })

  var torrentPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/root.torrent'))
  .then(response => response.arrayBuffer())
  .then(arrayBuffer => {
    var buffer = Buffer.from(arrayBuffer)
    var parsed = parseTorrent(buffer)
    return Promise.all([
      persistent.set('torrentMetaBuffer', buffer),
      persistent.set('torrentMeta', parsed)
    ])
  })

  return Promise.all([
    manifestPromise,
    torrentPromise
  ])
}

function onDownload () {
  return Promise.all([
    persistent.get('manifest'),
    downloaded.json()
  ]).then(result => {
    var [manifest, downloaded] = result
    for (var hash in downloaded) {
      if (hash in waitingFetches) {
        var filePath = Object.keys(manifest).find(fname => manifest[fname] === hash)
        var waiters = waitingFetches[hash]
        delete waitingFetches[hash]
        getFileBlob(filePath)
        .then(b => {
          for (var p of waiters) {
            p(b)
          }
        })
      }
    }
  })
}
