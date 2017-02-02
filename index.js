const global = typeof window !== 'undefined' ? window : self // eslint-disable-line

// Temp bug fix: https://github.com/srijs/rusha/issues/39
if (global.WorkerGlobalScope) delete global.FileReaderSync

const preCached = [
  '/planktos/root.torrent',
  '/planktos/manifest.json',
  '/planktos/planktos.min.js',
  '/planktos/install.js'
]

module.exports.getNodeStream = getNodeStream
module.exports.getFileBlob = getFileBlob
module.exports.update = update
module.exports.preCached = preCached // TODO better way to handle preCached
module.exports.getManifest = getManifest
module.exports.getTorrentMeta = getTorrentMeta
module.exports.getTorrentMetaBuffer = getTorrentMetaBuffer
module.exports._normalizePath = _normalizePath
module.exports.downloader = require('./lib/downloader')

const ChunkStream = require('chunk-store-read-stream')
const IdbChunkStore = require('indexeddb-chunk-store')
const IdbKvStore = require('idb-kv-store')
const toBlob = require('stream-to-blob')
const parseTorrent = require('parse-torrent-file')
const path = require('path')

let persistent = new IdbKvStore('planktos')
let priority = new IdbKvStore('planktos-priority')
let chunkStore = null
let missingChunks = {}

function getManifest () {
  return persistent.get('manifest')
}

function getTorrentMeta () {
  return persistent.get('torrentMeta')
}

function getTorrentMetaBuffer () { // TODO Fix parsing bug so this can be removed
  return persistent.get('torrentMetaBuffer')
}

function getNodeStream (filePath) {
  filePath = _normalizePath(filePath)
  return Promise.all([
    persistent.get('manifest'),
    persistent.get('torrentMeta')
  ])
  .then(result => {
    let [manifest, torrentMeta] = result

    // If the `filePath` cannot be found in the manifest, try to search for the index file
    let indexFilePathCandidates = ['index.html', 'index.htm'].map((filename) => path.join(filePath, filename))
    let hash = manifest[filePath] || manifest[indexFilePathCandidates.find((fpath) => Object.keys(manifest).includes(fpath))]
    let fileInfo = torrentMeta.files.find(f => f.name === hash)

    if (!fileInfo) {
      return Promise.reject(new Error('File not found'))
    }

    if (!chunkStore) {
      chunkStore = new IdbChunkStore(torrentMeta.pieceLength, {name: torrentMeta.infoHash})
      chunkStore._store.on('set', onChunkPut)
    }

    priority.add(hash) // TODO only add if necessary

    if (fileInfo.length === 0) throw new Error('Cannot read empty file')

    return new ChunkStream(chunkStore, {
      start: fileInfo.offset,
      end: fileInfo.offset + fileInfo.length - 1,
      onmiss: onChunkMiss
    })
  })
}

function getFileBlob (filePath) {
  return getNodeStream(filePath)
  .then(stream => {
    return new Promise(function (resolve, reject) {
      toBlob(stream, function (err, blob) {
        if (err) return reject(err)
        resolve(blob)
      })
    })
  })
}

function update (url) {
  if (!url) url = ''
  if (url.endsWith('/')) url = url.substr(0, url.length - 1)

  let cachePromise = global.caches.open('planktos')
  .then((cache) => cache.addAll(preCached.map(f => url + f)))
  .then(() => global.caches.open('planktos'))

  let manifestPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/manifest.json'))
  .then(response => response.json())
  .then(json => {
    return persistent.set('manifest', json)
  })

  let torrentPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/root.torrent'))
  .then(response => response.arrayBuffer())
  .then(arrayBuffer => {
    let buffer = Buffer.from(arrayBuffer)
    let parsed = parseTorrent(buffer)
    return Promise.all([
      persistent.set('torrentMetaBuffer', buffer),
      persistent.set('torrentMeta', parsed)
    ])
  })

  return Promise.all([
    manifestPromise,
    torrentPromise,
    priority.clear()
  ])
}

function _normalizePath (filePath) {
  if (filePath.startsWith('/')) filePath = filePath.substr(1)
  filePath = path.normalize(filePath)
  if (filePath === '.') filePath = ''
  return filePath
}

function onChunkMiss (err, index, retry) {
  if (err.name === 'MissingChunkError') {
    missingChunks[index] = missingChunks[index] || []
    missingChunks[index].push(retry)
  } else {
    retry(err)
  }
}

function onChunkPut (change) {
  if (missingChunks[change.key]) {
    let retries = missingChunks[change.key]
    delete missingChunks[change.key]
    retries.forEach(retry => retry())
  }
}
