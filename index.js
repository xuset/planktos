module.exports = Planktos

var WebTorrent = require('webtorrent')
var BlobChunkStore = require('blob-chunk-store')
var IdbBlobStore = require('idb-blob-store')

function Planktos (opts) {
  var self = this
  if (!(self instanceof Planktos)) return new Planktos(opts)
  if (!opts) opts = {}

  self.webtorrent = opts.webtorrent || new WebTorrent()

  self._registerSW(opts)
}

Planktos.prototype._download = function (torrentId) {
  var self = this
  var opts = {store: IdbChunkStore}
  self.webtorrent.add(torrentId, opts, function (torrent) {
    torrent.on('done', function () {
      console.log('Torrent download complete')
      for (var f of torrent.files) {
        sendFileToSW(f)
      }
    })
  })
}

Planktos.prototype._onSwMessage = function (event) {
  var self = this
  console.log('Received sw message', event.data)
  if (event.data.type === 'download') {
    self._download(event.data.torrentId)
  } else {
    throw new Error('Unknown type: ' + event.data.type)
  }
}

Planktos.prototype._registerSW = function (opts) {
  var self = this
  if (!('serviceWorker' in navigator)) return
  var sw = opts.sw || '/sw.js'
  var swOpts = { scope: opts.scope || '/' }

  navigator.serviceWorker.addEventListener('message', function (event) {
    self._onSwMessage(event)
  })

  sendSwRequest({type: 'available'})

  navigator.serviceWorker.register(sw, swOpts).then(function (reg) {
    if (reg.installing) {
      console.log('Service worker installing')
    } else if (reg.waiting) {
      console.log('Service worker installed')
    } else if (reg.active) {
      sendSwRequest({type: 'available'})
      console.log('Service worker active')
    }
  }).catch(function (err) {
    console.log('Registration failed with ' + err)
  })
}

function sendFileToSW (file) {
  file.getBlob(function (err, blob) {
    if (err) throw err
    if (navigator.serviceWorker.controller != null) {
      var message = {
        type: 'file',
        name: file.name,
        blob: blob
      }
      console.log('Sent ' + file.name + ' to service worker')
      sendSwRequest(message)
    }
  })
}

function sendSwRequest (msg) {
  return new Promise(function (resolve, reject) {
    if (!('serviceWorker' in navigator)) return reject(new Error('SW not supported'))
    if (!navigator.serviceWorker.controller) return reject(new Error('SW not active'))

    console.log('Sending request', msg)
    var channel = new MessageChannel()
    channel.port1.onmessage = function (event) {
      console.log('Received response', event.data)
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
