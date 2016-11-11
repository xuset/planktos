module.exports = Planktos

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:delegate')
var WebTorrent = require('webtorrent')
var BlobChunkStore = require('blob-chunk-store')
var IdbBlobStore = require('idb-blob-store')

function Planktos () {
  var self = this
  if (!(self instanceof Planktos)) return new Planktos()

  self.webtorrent = new WebTorrent()

  navigator.serviceWorker.addEventListener('message', function (event) {
    self._onSwMessage(event)
  })

  window.addEventListener('beforeunload', function () {
    sendSwRequest({type: 'unavailable'})
  })

  sendSwRequest({type: 'available'})
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
        sendSwRequest(message)
      }
    })
  })
}

Planktos.prototype._onSwMessage = function (event) {
  var self = this
  debug('MESSAGE', JSON.stringify(event.data))
  if (event.data.type === 'download') {
    self._download(event.data.torrentId)
  } else {
    throw new Error('Unknown type: ' + event.data.type)
  }
}

function sendSwRequest (msg) {
  return new Promise(function (resolve, reject) {
    if (!('serviceWorker' in navigator)) return reject(new Error('SW not supported'))
    if (!navigator.serviceWorker.controller) return reject(new Error('SW not active'))

    var channel = new MessageChannel()
    channel.port1.onmessage = function (event) {
      debug('MESSAGE', JSON.stringify(event.data))
      resolve(event.data)
    }
    navigator.serviceWorker.controller.postMessage(msg, [channel.port2])
  })
}

function IdbChunkStore (chunkLength, opts) {
  var namespace = opts.torrent.infoHash
  var idb = new IdbBlobStore({name: namespace})
  return new BlobChunkStore(chunkLength, idb)
}
