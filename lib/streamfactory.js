module.exports = StreamFactory

const IdbChunkStore = require('indexeddb-chunk-store')
const ChunkStream = require('chunk-store-read-stream')
const IdbKvStore = require('idb-kv-store')
const path = require('path')

function StreamFactory (planktos) {
  this.planktos = planktos
  this.priority = null
  this.chunkStore = null
  this.missingChunks = {}
}

StreamFactory.prototype.getNodeStream = function (filePath) {
  var self = this

  filePath = self.planktos._normalizePath(filePath)

  return Promise.all([
    self.planktos.getManifest(),
    self.planktos.getTorrentMeta()
  ])
  .then(result => {
    let [manifest, torrentMeta] = result
    self._initialize(torrentMeta)

    // If the `filePath` cannot be found in the manifest, try to search for the index file
    let impliedPaths = ['index.html', 'index.htm'].map(name => path.join(filePath, name))
    let hash = manifest[filePath] || manifest[impliedPaths.find(fpath => fpath in manifest)]
    let fileInfo = torrentMeta.files.find(f => f.name === hash)

    if (!fileInfo) throw new Error('File not found')
    if (fileInfo.length === 0) throw new Error('Cannot read empty file')

    self.priority.add(hash) // TODO only add if necessary

    return new ChunkStream(self.chunkStore, {
      start: fileInfo.offset,
      end: fileInfo.offset + fileInfo.length - 1,
      onmiss: self._onChunkMiss.bind(self)
    })
  })
}

StreamFactory.prototype._initialize = function (torrentMeta) {
  if (!this.chunkStore) {
    this.chunkStore = new IdbChunkStore(torrentMeta.pieceLength, {name: torrentMeta.infoHash})
    this.chunkStore._store.on('set', this._onChunkPut.bind(this))
  }
  if (!this.priority) {
    this.priority = new IdbKvStore('planktos-priority')
  }
}

StreamFactory.prototype._onChunkMiss = function (err, index, retry) {
  if (err.name === 'MissingChunkError') {
    this.missingChunks[index] = this.missingChunks[index] || []
    this.missingChunks[index].push(retry)
  } else {
    retry(err)
  }
}

StreamFactory.prototype._onChunkPut = function (change) {
  if (this.missingChunks[change.key]) {
    let retries = this.missingChunks[change.key]
    delete this.missingChunks[change.key]
    retries.forEach(retry => retry())
  }
}
