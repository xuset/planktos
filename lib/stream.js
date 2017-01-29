module.exports = Stream

var inherits = require('inherits')
var stream = require('readable-stream')

inherits(Stream, stream.Readable)

function Stream (chunkstore, opts) {
  if (!(this instanceof Stream)) return new Stream(chunkstore, opts)
  if (!opts) opts = {}

  stream.Readable.call(this)

  this.chunkstore = chunkstore
  this.start = opts.start || 0
  this.end = opts.end || chunkstore.length
  this.destroyed = false

  this._startIndex = Math.floor(this.start / chunkstore.chunkLength)
  this._endIndex = Math.floor(this.end / chunkstore.chunkLength)
  this._index = this._startIndex
  this._missing = {}

  if (typeof this.end === 'undefined') {
    throw new Error('Must define opts.end or chunkstore.length')
  }

  this.chunkstore._store.on('set', this._onPiece.bind(this))
}

Stream.prototype._read = function () {
  var self = this

  if (self._index > self._endIndex) return self.push(null)

  self._get(self._index, function (err, chunk) {
    if (err) return self._destroy(err)
    var start = self._index !== self._startIndex ? 0
                : self.start - self._startIndex * self.chunkstore.chunkLength
    var end = self._index !== self._endIndex ? chunk.length
                : self.end - self._endIndex * self.chunkstore.chunkLength
    chunk = chunk.slice(start, end)
    self._index++
    if (self.push(chunk)) self._read()
  })
}

Stream.prototype._get = function (index, cb) {
  var self = this
  check()
  function check () {
    self.chunkstore.get(index, function (err, chunk) {
      if (err && err.name === 'MissingChunkError') self._missing[index] = check
      else cb(err, chunk)
    })
  }
}

Stream.prototype._onPiece = function (change) {
  if (this.destroyed) return // TODO remove listener instead
  if (this._missing[change.key]) this._missing[change.key]()
}

Stream.prototype._destroy = function (err) {
  if (this.destroyed) return
  this.destroyed = true

  this._missing = null
  this.chunkstore = null

  if (err) this.emit('error', err)
  this.emit('close')
}

Stream.prototype.destroy = function () {
  this._destroy()
}
