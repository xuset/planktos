module.exports.install = install

require('debug').enable('planktos:*')
const debug = require('debug')('planktos:downloader')
const WebTorrent = require('webtorrent')
const IdbChunkStore = require('indexeddb-chunk-store')
const IdbKvStore = require('idb-kv-store')
const parseTorrent = require('parse-torrent-file')

let webtorrent = null
let downloaded = null
let installed = false
let priority = null
let torrentMeta = null
let channel = null

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
  channel = channel || new BroadcastChannel('planktos-downloaded')

  if (webtorrent.get(torrentId)) return

  let opts = {store: IdbChunkStore}
  webtorrent.add(torrentId, opts, function (torrent) {
    if (torrent.urlList.length === 0) {
      const isSingleFile = torrent.files.length === 1
      const swUrl = navigator.serviceWorker.controller.scriptURL

      let webSeedUrl = swUrl.substring(0, swUrl.lastIndexOf('/'))
      if (isSingleFile) webSeedUrl += '/planktos/' + torrent.files[0].name

      torrent.addWebSeed(webSeedUrl)
    }

    torrentMeta = parseTorrent(torrent.torrentFile)

    if (!priority) {
      priority = new IdbKvStore('planktos-priority')
      priority.on('add', function (change) {
        onPriorityAdd(change.value)
      })
    }

    priority.values().then(values => values.forEach(v => onPriorityAdd(v)))

    torrent.on('done', function () {
      debug('TORRENT DOWNLOADED', torrent.files.map(f => f.name))
      priority.clear()
      torrent.files.forEach(function (f) {
        downloaded.set(f.name, true)
        .then(() => channel.postMessage({ name: f.name }))
      })
    })
  })
}

function onPriorityAdd (hash) {
  if (!webtorrent.torrents[0]) return // webtorrent not ready yet

  let fileInfo = torrentMeta.files.find(f => f.name === hash)
  let start = Math.floor(fileInfo.offset / torrentMeta.pieceLength)
  let end = Math.floor((fileInfo.offset + fileInfo.length - 1) / torrentMeta.pieceLength)
  let torrent = webtorrent.get(torrentMeta.infoHash)
  let file = torrent.files.find(f => f.name === hash)

  torrent.select(start, end, undefined, onPiece)

  function onPiece () {
    if (file.downloaded) {
      downloaded.set(hash, true)
      .then(() => channel.postMessage({ name: hash }))
    }
  }
}
