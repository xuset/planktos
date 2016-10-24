module.exports = Planktos

var WebTorrent = require('webtorrent')

function Planktos (opts) {
  var self = this
  if (!(self instanceof Planktos)) return new Planktos(opts)
  if (!opts) opts = {}

  self.webtorrent = opts.webtorrent || new WebTorrent()

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
        type: 'file',
        name: file.name,
        blob: blob
      }
      console.log('Sent ' + file.name + ' to service worker')
      navigator.serviceWorker.controller.postMessage(message)
    }
  })
}

Planktos.prototype._sendSwRequest = function (msg) {
  return new Promise(function (resolve, reject) {
    if (!('serviceWorker' in navigator)) return reject(new Error('SW not supported'))

    console.log('Sending request', msg)
    var channel = new MessageChannel()
    channel.port1.onmessage = function (event) {
      console.log('Received response', event.data)
      if (event.data.error) {
        reject(event.data.error)
      } else {
        resolve(event.data)
      }
    }
    navigator.serviceWorker.controller.postMessage(msg, [channel.port2])
  })
}

Planktos.prototype._registerSW = function (opts) {
  var self = this
  if (!('serviceWorker' in navigator)) return
  var sw = opts.sw || '/sw.js'
  var swOpts = { scope: opts.scope || '/' }

  navigator.serviceWorker.register(sw, swOpts).then(function (reg) {
    if (reg.installing) {
      console.log('Service worker installing')
    } else if (reg.waiting) {
      console.log('Service worker installed')
    } else if (reg.active) {
      console.log('Service worker active')
      self._sendSwRequest({type: 'torrent'}).then(function (response) {
        console.log('Beginning downloaad', response, response.torrentId)
        self._download(response.torrentId)
      })
    }
  }).catch(function (err) {
    console.log('Registration failed with ' + err)
  })
}
