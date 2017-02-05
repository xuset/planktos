module.exports.install = install

const debug = require('debug')('planktos:downloader')
const WebTorrent = require('webtorrent')
const IdbChunkStore = require('indexeddb-chunk-store')
const IdbKvStore = require('idb-kv-store')
const parseTorrent = require('parse-torrent-file')
const TabElect = require('tab-elect')

let webtorrent = null
let installed = false
let priority = null
let torrentMeta = null
let persistent = null
let tabElect = null
let rootUrl = null

function install (root) {
  if (typeof navigator === 'undefined') throw new Error('must be called in a wep page')
  if (!navigator.serviceWorker) throw new Error('No servier worker support')
  if (installed) return

  installed = true
  rootUrl = window.location.origin + root
  tabElect = new TabElect('planktos')
  tabElect.on('elected', onElected)
  tabElect.on('deposed', onDeposed)

  window.addEventListener('beforeunload', onBeforeUnload)
}

function onElected () {
  persistent = persistent || new IdbKvStore('planktos')
  persistent.get('torrentMetaBuffer').then(torrentMetaBuffer => {
    if (!tabElect.isLeader) return
    download(new Buffer(torrentMetaBuffer))
  })
}

function onDeposed () {
  if (webtorrent) webtorrent.destroy()
  webtorrent = null
}

function onBeforeUnload () {
  tabElect.destroy()
}

function download (torrentId) {
  webtorrent = webtorrent || new WebTorrent()

  if (webtorrent.get(torrentId)) return

  let opts = {store: IdbChunkStore}
  webtorrent.add(torrentId, opts, function (torrent) {
    if (torrent.urlList.length === 0) {
      const isSingleFile = torrent.files.length === 1
      if (isSingleFile) rootUrl += '/planktos/files/' + torrent.files[0].name

      torrent.addWebSeed(rootUrl)
    }

    torrentMeta = parseTorrent(torrent.torrentFile)

    if (!priority) {
      priority = new IdbKvStore('planktos-priority')
      priority.on('add', function (change) {
        onPriorityAdd(change.value)
      })
    }

    // Process any priority requests that came in before the listener was added
    priority.values().then(values => values.forEach(v => onPriorityAdd(v)))

    torrent.on('done', function () {
      debug('TORRENT DOWNLOADED', torrent.files.map(f => f.name))
      priority.clear()
    })
  })
}

function onPriorityAdd (hash) {
  let fileInfo = torrentMeta.files.find(f => f.name === hash)
  let start = Math.floor(fileInfo.offset / torrentMeta.pieceLength)
  let end = Math.floor((fileInfo.offset + fileInfo.length - 1) / torrentMeta.pieceLength)
  let torrent = webtorrent.get(torrentMeta.infoHash)
  let file = torrent.files.find(f => f.name === hash)

  if (file.downloaded !== file.length) {
    torrent.select(start, end, 1)
  } else {
    var transaction = priority.transaction()
    transaction.json().then(json => {
      var rm = Object.keys(json).filter(k => json[k] === hash)
      rm.forEach(k => transaction.remove(k))
    })
  }
}
