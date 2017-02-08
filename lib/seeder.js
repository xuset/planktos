module.exports = Seeder

const WebTorrent = require('webtorrent')
const IdbChunkStore = require('indexeddb-chunk-store')
const TabElect = require('tab-elect')
const path = require('path')

function Seeder () {
  if (typeof window === 'undefined') throw new Error('must be called in a wep page')

  this.destroyed = false
  this._seeds = {}
  this._webtorrent = null

  this._tabElect = new TabElect('planktos')
  this._tabElect.on('elected', this._onElected.bind(this))
  this._tabElect.on('deposed', this._onDeposed.bind(this))
}

Seeder.prototype.add = function (snapshot) {
  if (this.destroyed) throw new Error('Seeder has been destroyed')
  if (snapshot.hash in this._seeds) return

  let listener = this._prioritize.bind(this, snapshot)

  this._seeds[snapshot.hash] = {
    snapshot: snapshot,
    listener: listener
  }

  if (this._tabElect.isLeader) this._onElected()
}

Seeder.prototype._onElected = function () {
  for (let hash in this._seeds) {
    this._seeds[hash].snapshot._priority.on('add', this._seeds[hash].listener)
    this._seed(this._seeds[hash].snapshot)
  }
}

Seeder.prototype._onDeposed = function () {
  if (this._webtorrent) this._webtorrent.destroy()
  this._webtorrent = null

  for (let hash in this._seeds) {
    this._seeds[hash].snapshot._priority.removeListener('add', this._seeds[hash].listener)
  }
}

Seeder.prototype._seed = function (snapshot) {
  var self = this
  if (self.destroyed) return
  self._webtorrent = self._webtorrent || new WebTorrent()

  if (self._webtorrent.get(snapshot.torrentMetaBuffer)) return

  let opts = {store: IdbChunkStore}
  self._webtorrent.add(snapshot.torrentMetaBuffer, opts, function (torrent) {
    if (self.destroyed) return
    if (torrent.urlList.length === 0) {
      const isSingleFile = torrent.files.length === 1
      let url = new URL(snapshot.rootUrl)
      if (isSingleFile) url.pathname = path.join(url.pathname, 'planktos/files', torrent.files[0].name)
      torrent.addWebSeed(url.toString())
    }

    // Process any priority requests that came in before the listener was added
    snapshot._priority.values()
    .then(values => values.forEach(v => self._prioritize(snapshot, v)))

    torrent.on('done', function () {
      snapshot._priority.clear()
    })
  })
}

Seeder.prototype._prioritize = function (snapshot, hash) {
  if (this.destroyed || this._webtorrent == null) return
  if (hash.value) hash = hash.value
  let torrentMeta = snapshot.torrentMeta
  let fileInfo = torrentMeta.files.find(f => f.name === hash)
  let start = Math.floor(fileInfo.offset / torrentMeta.pieceLength)
  let end = Math.floor((fileInfo.offset + fileInfo.length - 1) / torrentMeta.pieceLength)
  let torrent = this._webtorrent.get(torrentMeta.infoHash)

  if (torrent == null) return // Webtorrent has not finished initializing

  let file = torrent.files.find(f => f.name === hash)

  if (file.downloaded !== file.length) {
    torrent.select(start, end, 1)
  } else {
    var transaction = snapshot._priority.transaction()
    transaction.json().then(json => {
      var rm = Object.keys(json).filter(k => json[k] === hash)
      rm.forEach(k => transaction.remove(k))
    })
  }
}

Seeder.prototype.destroy = function () {
  if (this.destroyed) return
  this.destroyed = true

  if (this._webtorrent) this._webtorrent.destroy()
  this._webtorrent = null

  this._tabElect.destroy()
  this._tabElect = null

  for (let hash in this._seeds) {
    this._seeds[hash].snapshot._priority.removeListener('add', this._seeds[hash].listener)
  }
  this._seeds = null
}
