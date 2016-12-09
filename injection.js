require('debug').enable('planktos:*')
var debug = require('debug')('planktos:injection')
var WebTorrent = require('webtorrent')
var delegate = require('delegate-job')
var IdbChunkStore = require('indexdb-chunk-store')
var IdbKvStore = require('idb-kv-store')

if (typeof BroadcastChannel === 'undefined') throw new Error('No BroadcastChannel support')

var webtorrent = new WebTorrent()
var downloaded = new IdbKvStore('planktos-downloaded')
delegate.Handler('planktos-download', function (torrentId) {
  download(new Buffer(torrentId))
})

function download (torrentId) {
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
