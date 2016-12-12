require('debug').enable('planktos:*')
var debug = require('debug')('planktos:injection')
var WebTorrent = require('webtorrent')
var IdbChunkStore = require('indexdb-chunk-store')
var IdbKvStore = require('idb-kv-store')

if (typeof BroadcastChannel === 'undefined') throw new Error('No BroadcastChannel support')
if (typeof navigator === 'undefined') throw new Error('injection.js must be run in a wep page')
if (!navigator.serviceWorker) throw new Error('No servier worker support')

navigator.serviceWorker.addEventListener('message', onMessage)
navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
window.addEventListener('beforeunload', onBeforUnload)

var webtorrent = null
var downloaded = null

onControllerChange()

function onControllerChange () {
  if (!navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({type: 'available'})
}

function onBeforUnload () {
  if (!navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({type: 'unavailable'})
}

function onMessage (event) {
  debug('MESSAGE', event.data)
  if (event.data.type === 'download') {
    download(new Buffer(event.data.torrentId))
  } else {
    throw new Error('Unknown type: ' + event.data.type)
  }
}

function download (torrentId) {
  downloaded = downloaded || new IdbKvStore('planktos-downloaded')
  webtorrent = webtorrent || new WebTorrent()

  var opts = {store: IdbChunkStore}
  webtorrent.add(torrentId, opts, function (torrent) {
    torrent.on('done', function () {
      debug('TORRENT DOWNLOADED', torrent.files.map(f => f.name))
      var channel = new BroadcastChannel('planktos-downloaded')
      torrent.files.forEach(function (f) {
        downloaded.set(f.name, true)
        .then(() => channel.postMessage({ name: f.name }))
      })
    })
  })
}
