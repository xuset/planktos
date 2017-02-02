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

const IdbKvStore = require('idb-kv-store')
const toBlob = require('stream-to-blob')
const parseTorrent = require('parse-torrent-file')
const path = require('path')
const StreamFactory = require('./lib/streamfactory')

let persistent = new IdbKvStore('planktos')
let streamFactory = new StreamFactory(this)

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

function getNodeStream (filePath) {
  return streamFactory.getNodeStream(filePath)
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
    torrentPromise
  ])
}

function _normalizePath (filePath) {
  if (filePath.startsWith('/')) filePath = filePath.substr(1)
  filePath = path.normalize(filePath)
  if (filePath === '.') filePath = ''
  return filePath
}
