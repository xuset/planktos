module.exports = Planktos

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:delegate')
var WebTorrent = require('webtorrent')
var IdbChunkStore = require('indexdb-chunk-store')

function Planktos () {
  var self = this
  if (!(self instanceof Planktos)) return new Planktos()

  self.webtorrent = new WebTorrent()

  navigator.serviceWorker.addEventListener('message', function (event) {
    self._onSwMessage(event)
  })

  window.addEventListener('beforeunload', function () {
    navigator.serviceWorker.controller.postMessage({type: 'unavailable'})
  })

  navigator.serviceWorker.controller.postMessage({type: 'available'})
}

Planktos.prototype._download = function (torrentId) {
  var self = this
  var opts = {store: IdbChunkStore}
  self.webtorrent.add(torrentId, opts, function (torrent) {
    torrent.on('done', function () {
      debug('TORRENT DOWNLOADED', torrent.files.map(f => f.name))
      for (var f of torrent.files) {
        var message = {
          type: 'file',
          name: f.name
        }
        navigator.serviceWorker.controller.postMessage(message)
      }
    })
  })
}

Planktos.prototype._onSwMessage = function (event) {
  var self = this
  debug('MESSAGE', event.data)
  if (event.data.type === 'download') {
    self._download(new Buffer(event.data.torrentId))
  } else {
    throw new Error('Unknown type: ' + event.data.type)
  }
}
