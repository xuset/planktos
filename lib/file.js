module.exports = File

/* global ReadableStream */

const ChunkStream = require('chunk-store-read-stream')
const toBlob = require('stream-to-blob')

File.WEBSTREAM_SUPPORT = typeof ReadableStream !== 'undefined'

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
  opts = opts || {}
  let start = opts.start || 0
  let end = opts.end || (this.length - 1)

  if (start < 0 || end < 0 || start > this.length - 1 || end > this.length - 1) {
    throw new Error('Range out of bounds')
  }

  if (this.length === 0) throw new Error('Cannot read empty file')

  // Add in the file's byte offset inside the torrent
  start += this.offset
  end += this.offset

  this._snapshot._priority.add({ start: start, end: end }) // TODO only add if necessary

  return Promise.resolve(new ChunkStream(this._snapshot._chunkStore, {
    start: start,
    end: end,
    onmiss: this._onChunkMiss.bind(this)
  }))
}

File.prototype.getWebStream = function (opts) {
  if (!File.WEBSTREAM_SUPPORT) throw new Error('No web ReadableStream support')

  opts = opts || {}
  return this.getStream(opts)
  .then(stream => {
    let webStream = new ReadableStream({start: start, pull: pull, cancel: cancel})
    webStream.length = (opts.end || (this.length - 1)) - (opts.start || 0) + 1
    return webStream

    function start (controller) {
      stream.on('data', chunk => {
        controller.enqueue(chunk)
        stream.pause()
      })
      stream.on('end', () => controller.close())
      stream.on('error', (e) => controller.error(e))
      stream.pause()
    }

    function pull () {
      stream.resume()
    }

    function cancel () {
      stream.destroy()
    }
  })
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
