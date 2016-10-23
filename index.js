module.exports = Planktos

var WebTorrent = require('webtorrent')

function Planktos (torrentId, opts) {
  var self = this
  if (!(self instanceof Planktos)) return new Planktos(torrentId, opts)
  if (!torrentId) throw new Error('torrentId must be specified')
  if (!opts) opts = {}

  self.webtorrent = opts.webtorrent || new WebTorrent()

  self._download(torrentId)
  self._registerSW(opts)
}

Planktos.prototype._download = function (torrentId) {
  var self = this
  self.webtorrent.add(torrentId, function (torrent) {
    torrent.on('done', function () {
      console.log('Torrent download complete')
      for (var f of torrent.files) {
        self._sendFileToSW(f)
      }
    })
  })
}

Planktos.prototype._sendFileToSW = function (file) {
  file.getBlob(function (err, blob) {
    if (err) throw err
    if (navigator.serviceWorker.controller != null) {
      var message = {
        name: file.name,
        blob: blob
      }
      console.log('Sent ' + file.name + ' to service worker')
      navigator.serviceWorker.controller.postMessage(message)
    }
  })
}

Planktos.prototype._registerSW = function (opts) {
  var sw = opts.sw || '/sw.js'
  var swOpts = { scope: opts.scope || '/' }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(sw, swOpts).then(function (reg) {
      if (reg.installing) {
        console.log('Service worker installing')
      } else if (reg.waiting) {
        console.log('Service worker installed')
      } else if (reg.active) {
        console.log('Service worker active')
      }
    }).catch(function (err) {
      console.log('Registration failed with ' + err)
    })
  }
}
