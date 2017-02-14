module.exports = File

const ChunkStream = require('chunk-store-read-stream')
const toBlob = require('stream-to-blob')

function File (snapshot, fpath, fileInfo) {
  this.path = fpath
  this.hash = fileInfo.name
  this.length = fileInfo.length
  this.offset = fileInfo.offset
  this._snapshot = snapshot

  if (this._snapshot._missingChunks == null) {
    this._snapshot._chunkStore._store.on('set', onChunkPut.bind(null, snapshot))
    this._snapshot._missingChunks = {}
  }
}

File.prototype.getStream = function (opts) {
  if (!opts) opts = {}
  this._snapshot._priority.add(this.hash) // TODO only add if necessary

  return Promise.resolve(new ChunkStream(this._snapshot._chunkStore, {
    start: this.offset + (opts.start || 0),
    end: this.offset + (opts.end || (this.length - 1)),
    onmiss: this._onChunkMiss.bind(this)
  }))
}

File.prototype.getBlob = function (opts) {
  return this.getStream(opts)
  .then(stream => {
    return new Promise(function (resolve, reject) {
      toBlob(stream, function (err, blob) {
        if (err) return reject(err)
        resolve(blob)
      })
    })
  })
}

File.prototype._onChunkMiss = function (err, index, retry) {
  if (err.name === 'MissingChunkError') {
    this._snapshot._missingChunks[index] = this._snapshot._missingChunks[index] || []
    this._snapshot._missingChunks[index].push(retry)
  } else {
    retry(err)
  }
}

function onChunkPut (snapshot, change) {
  if (snapshot._missingChunks[change.key] != null) {
    let retries = snapshot._missingChunks[change.key]
    delete snapshot._missingChunks[change.key]
    retries.forEach(retry => retry())
  }
}
