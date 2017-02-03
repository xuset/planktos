module.exports = getFile

const IdbChunkStore = require('indexeddb-chunk-store')
const ChunkStream = require('chunk-store-read-stream')
const IdbKvStore = require('idb-kv-store')
const toBlob = require('stream-to-blob')
const path = require('path')

let priority = null
let chunkStore = null
let missingChunks = {}

function getFile (planktos, fpath) {
  return Promise.all([
    planktos.getManifest(),
    planktos.getTorrentMeta()
  ])
  .then(result => {
    let [manifest, torrentMeta] = result

    // If the `fpath` cannot be found in the manifest, try to search for the index file
    fpath = normalizePath(fpath)
    fpath = ['', 'index.html', 'index.htm']
               .map(name => path.join(fpath, name))
               .find(fpath => fpath in manifest)
    let hash = manifest[fpath]
    let fileInfo = torrentMeta.files.find(f => f.name === hash)

    // File not found
    if (!fileInfo) return Promise.resolve(undefined)

    return new File(fpath, fileInfo, torrentMeta)
  })
}

function File (fpath, fileInfo, torrentMeta) {
  this.path = fpath
  this.hash = fileInfo.name
  this.length = fileInfo.length
  this.offset = fileInfo.offset
  this.torrentMeta = torrentMeta
}

File.prototype.getStream = function () {
  initialize(this.torrentMeta)

  priority.add(this.hash) // TODO only add if necessary

  if (this.length === 0) throw new Error('Cannot read empty file')

  return Promise.resolve(new ChunkStream(chunkStore, {
    start: this.offset,
    end: this.offset + this.length - 1,
    onmiss: onChunkMiss
  }))
}

File.prototype.getBlob = function () {
  return this.getStream()
  .then(stream => {
    return new Promise(function (resolve, reject) {
      toBlob(stream, function (err, blob) {
        if (err) return reject(err)
        resolve(blob)
      })
    })
  })
}

function initialize (torrentMeta) {
  if (!chunkStore) {
    chunkStore = new IdbChunkStore(torrentMeta.pieceLength, {name: torrentMeta.infoHash})
    chunkStore._store.on('set', onChunkPut)
  }
  if (!priority) {
    priority = new IdbKvStore('planktos-priority')
  }
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

function normalizePath (filePath) {
  filePath = path.normalize(filePath)
  if (filePath.startsWith('/')) filePath = filePath.substr(1)
  if (filePath === '.') filePath = ''
  return filePath
}
