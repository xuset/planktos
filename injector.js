module.exports = Planktos

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:delegate')
var WebTorrent = require('webtorrent')
var delegate = require('delegate-job')
var IdbChunkStore = require('indexdb-chunk-store')

function Planktos () {
  var self = this
  if (typeof BroadcastChannel === 'undefined') throw new Error('No BroadcastChannel support')
  if (!(self instanceof Planktos)) return new Planktos()

  self.webtorrent = new WebTorrent()
  self.handler = new delegate.Handler('planktos-download', function (torrentId) {
    self._download(new Buffer(torrentId))
  })
}

Planktos.prototype._download = function (torrentId) {
  var self = this
  var opts = {store: IdbChunkStore}
  self.webtorrent.add(torrentId, opts, function (torrent) {
    torrent.on('done', function () {
      debug('TORRENT DOWNLOADED', torrent.files.map(f => f.name))
      var channel = new BroadcastChannel('planktos')
      for (var f of torrent.files) {
        var message = {
          type: 'file',
          name: f.name
        }
        channel.postMessage(message)
      }
    })
  })
}
