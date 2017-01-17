module.exports.install = install

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:downloader')
var WebTorrent = require('webtorrent')
var IdbChunkStore = require('indexeddb-chunk-store')
var IdbKvStore = require('idb-kv-store')

var webtorrent = null
var downloaded = null
var installed = false

function install () {
  if (typeof BroadcastChannel === 'undefined') throw new Error('No BroadcastChannel support')
  if (typeof navigator === 'undefined') throw new Error('must be called in a wep page')
  if (!navigator.serviceWorker) throw new Error('No servier worker support')
  if (installed) return

  installed = true
  navigator.serviceWorker.addEventListener('message', onMessage)
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  window.addEventListener('beforeunload', onBeforUnload)

  onControllerChange()
}

function onControllerChange () {
  if (!navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({
    type: 'available',
    planktos: true
  })
}

function onBeforUnload () {
  if (!navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({
    type: 'unavailable',
    planktos: true
  })
}

function onMessage (event) {
  if (!event.data.planktos) return
  debug('MESSAGE', event.data)
  if (event.data.type === 'download') {
    download(new Buffer(event.data.torrentId))
  } else if (event.data.type === 'request_availability') {
    navigator.serviceWorker.controller.postMessage({
      type: 'available',
      planktos: true
    })
  } else if (event.data.type === 'cancel_download') {
    if (webtorrent) webtorrent.destroy()
    webtorrent = null
  } else {
    throw new Error('Unknown type: ' + event.data.type)
  }
}

function download (torrentId) {
  downloaded = downloaded || new IdbKvStore('planktos-downloaded')
  webtorrent = webtorrent || new WebTorrent()

  var opts = {store: IdbChunkStore}
  webtorrent.add(torrentId, opts, function (torrent) {
    if (torrent.urlList.length === 0) {
      const isSingleFile = torrent.files.length === 1
      const swUrl = navigator.serviceWorker.controller.scriptURL

      let webSeedUrl = swUrl.substring(0, swUrl.lastIndexOf('/'))
      if (isSingleFile) webSeedUrl += '/planktos/' + torrent.files[0].path

      torrent.addWebSeed(webSeedUrl)
    }

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
