module.exports = Seeder

const ChunkStoreWriteStream = require('chunk-store-stream/write')
const CombinedStream = require('combined-stream')
const File = require('./file')
const IdbChunkStore = require('indexeddb-chunk-store')
const WebTorrent = require('webtorrent')
const path = require('path')
const stream = require('stream')

function Seeder () {
  if (typeof window === 'undefined') throw new Error('must be called in a wep page')

  this.destroyed = false
  this.started = false
  this._seeds = {}
  this._webtorrent = null
}

Seeder.prototype.add = function (snapshot) {
  if (this.destroyed) throw new Error('Seeder has been destroyed')
  if (snapshot.closed || snapshot.hash in this._seeds) return

  let listener = this._prioritize.bind(this, snapshot)

  this._seeds[snapshot.hash] = {
    snapshot: snapshot,
    listener: listener
  }

  if (this.started) {
    snapshot._priority.on('add', listener)
    this._seed(snapshot)
  }
}

Seeder.prototype.remove = function (hash) {
  if (this.destroyed) throw new Error('Seeder has been destroyed')

  let seed = this._seeds[hash]
  delete this._seeds[hash]

  if (this._webtorrent) this._webtorrent.remove(seed.snapshot.torrentMetaBuffer)

  if (seed != null && !seed.snapshot.closed) {
    seed.snapshot._priority.removeListener('add', this._seeds[hash].listener)
  }
}

Seeder.prototype.start = function () {
  if (this.destroyed) throw new Error('Seeder is destroyed')
  if (this.started) return

  this.started = true
  this._webtorrent = this._webtorrent || new WebTorrent()

  for (let hash in this._seeds) {
    let snapshot = this._seeds[hash].snapshot
    if (snapshot.closed) {
      delete this._seeds[hash]
    } else {
      snapshot._priority.on('add', this._seeds[hash].listener)
      this._seed(snapshot)
    }
  }
}

Seeder.prototype.stop = function () {
  if (this.destroyed || !this.started) return

  this.started = false
  if (this._webtorrent) this._webtorrent.destroy()
  this._webtorrent = null

  for (let hash in this._seeds) {
    let snapshot = this._seeds[hash].snapshot
    if (snapshot.closed) delete this._seeds[hash]
    else snapshot._priority.removeListener('add', this._seeds[hash].listener)
  }
}

Seeder.prototype._seed = function (snapshot) {
  let self = this
  if (self.destroyed || self._webtorrent.get(snapshot.torrentMetaBuffer)) return

  const createFile = (snap) => (fileInfo) => new File(snap, fileInfo.name, fileInfo)
  const keyByHash = (files) => files.reduce((mapping, f) => {
    mapping[f.hash] = f
    return mapping
  }, {})

  let desiredFiles = keyByHash(snapshot.torrentMeta.files.map(createFile(snapshot)))

  let oldFiles = Object.values(this._seeds).filter(
    (seed) => seed.snapshot !== snapshot
  ).map((seed) =>
    seed.snapshot.torrentMeta.files.filter((f) =>
      desiredFiles[f.name]
    ).map(createFile(seed.snapshot))
  ).reduce((mapping, files) => {
    Object.assign(mapping, keyByHash(files))
    return mapping
  }, {})

  // Creates a read stream that contains the identical files or zeros
  let combinedReadStream = CombinedStream.create()
  Object.values(desiredFiles).sort((a, b) => a.offset - b.offset).forEach((file) => {
    if (oldFiles[file.hash]) {
      combinedReadStream.append((next) => oldFiles[file.hash].getStream().then(next))
    } else {
      let zeroStream = new stream.Readable()
      zeroStream._read = () => {}

      zeroStream.push(Buffer.alloc(file.length))
      combinedReadStream.append(zeroStream)
    }
  })

  // Copy old files to the new snapshot
  combinedReadStream.pipe(new ChunkStoreWriteStream(
    snapshot._chunkStore,
    snapshot.torrentMeta.pieceLength
  ))
  combinedReadStream.on('end', () => {
    let opts = {store: IdbChunkStore}
    self._webtorrent.add(snapshot.torrentMetaBuffer, opts, (torrent) => {
      if (snapshot.closed || self.destroyed) return
      if (torrent.urlList.length === 0) {
        const isSingleFile = torrent.files.length === 1
        let url = new URL(snapshot.rootUrl)
        if (isSingleFile) url.pathname = path.join(url.pathname, 'planktos/files', torrent.files[0].name)
        torrent.addWebSeed(url.toString())
      }

      // Process any priority requests that came in before the listener was added
      snapshot._priority.values().then((values) =>
        values.forEach(v => self._prioritize(snapshot, v))
      )

      torrent.on('done', () => {
        if (snapshot.closed || self.destroyed) return
        snapshot._priority.clear()
      })
    })
  })
}

Seeder.prototype._prioritize = function (snapshot, range) {
  if (snapshot.closed || this.destroyed || this._webtorrent == null) return
  if (range.value) range = range.value

  let start = Math.floor(range.start / snapshot.torrentMeta.pieceLength)
  let end = Math.floor(range.end / snapshot.torrentMeta.pieceLength)
  let torrent = this._webtorrent.get(snapshot.torrentMeta.infoHash)

  if (torrent != null && torrent.progress !== 1) torrent.select(start, end, 1)
}

Seeder.prototype.destroy = function () {
  if (this.destroyed) return
  this.stop()
  this.destroyed = true
  this._seeds = null
}
