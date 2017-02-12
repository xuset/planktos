module.exports = Snapshot

const parseTorrent = require('parse-torrent-file')
const path = require('path')
const IdbKvStore = require('idb-kv-store')
const IdbChunkStore = require('indexeddb-chunk-store')
const injection = require('./injection')
const File = require('./file')

const global = typeof window !== 'undefined' ? window : self // eslint-disable-line

function Snapshot (obj) {
  this.closed = false
  this.manifest = obj.manifest
  this.torrentMetaBuffer = Buffer.isBuffer(obj.torrentMetaBuffer)
                           ? obj.torrentMetaBuffer : new Buffer(obj.torrentMetaBuffer)
  this.torrentMeta = parseTorrent(this.torrentMetaBuffer)
  this.hash = obj.hash
  this.rootUrl = obj.rootUrl

  this._priority = new IdbKvStore('planktos-priority-' + this.hash)
  this._missingChunks = null
  this._chunkStore = new IdbChunkStore(this.torrentMeta.pieceLength, {
    name: this.hash
  })
}

Snapshot.prototype.getFile = function (fpath) {
  if (this.closed) throw new Error('Snapshot is closed')
  fpath = path.normalize(fpath)
  if (fpath.startsWith('/') || fpath === '.') fpath = fpath.substr(1)

  // If the `fpath` cannot be found in the manifest, try to search for the index file
  fpath = ['', 'index.html', 'index.htm']
             .map(name => path.join(fpath, name))
             .find(fpath => fpath in this.manifest)
  let hash = this.manifest[fpath]
  let fileInfo = this.torrentMeta.files.find(f => f.name === hash)
  return fileInfo ? new File(this, fpath, fileInfo) : undefined
}

Snapshot.prototype.fetch = function (req, opts) {
  if (this.closed) throw new Error('Snapshot is closed')
  opts = opts || {}
  let inject = false
  let url = null

  // Convert a FetchEvent to Request
  if (global.FetchEvent && req instanceof global.FetchEvent) {
    inject = req.clientId == null // This is the initial request of a new webpage
    req = req.request // req is now an instance of Request
  }

  // Convert a Request to an URL
  if (req instanceof global.Request) {
    url = new URL(req.url)
    inject = inject && url.search.substr(1)
             .split('&').find(s => s === 'noPlanktosInjection') == null
    if (req.method !== 'GET') throw new Error('Only HTTP GET requests supported')
  } else if (req instanceof URL) {
    url = req
  } else if (typeof req === 'string') {
    url = new URL(req)
  }

  if (url == null) throw new Error('Must provide a FetchEvent, Request, URL, or a url string')
  if (url.origin !== global.location.origin) throw new Error('Cannot Fetch. Origin differs')

  inject = 'inject' in opts ? opts.inject : inject

  // Generate response blob. Depends on if the downloader should be injected or not
  let blobPromise = null
  if (inject) {
    let fname = url.pathname.substr(url.pathname.lastIndexOf('/') + 1)
    const isHTML = fname.endsWith('.html') || fname.endsWith('.htm') || !fname.includes('.')
    let modUrl = new URL(url.toString())
    modUrl.search = (modUrl.search === '' ? '?' : modUrl.search + '&') + 'noPlanktosInjection'
    let html = (isHTML ? injection.docWrite : injection.iframe)
               .replace(/{{url}}/g, modUrl.toString())
               .replace(/{{root}}/g, opts.root ? opts.root : '')
    blobPromise = Promise.resolve(new Blob([html], {type: 'text/html'}))
  } else {
    // fpath is relative to the service worker scope if opts.root was given
    let fpath = opts.root ? url.pathname.replace(opts.root, '') : url.pathname
    let file = this.getFile(fpath)
    if (file != null) {
      blobPromise = file.getBlob()
    } else {
      blobPromise = global.caches.open('planktos')
        .then(c => c.match(url.pathname))
        .then(resp => resp ? resp.blob() : undefined)
    }
  }

  return blobPromise
  .then(blob => blob != null ? new Response(blob) : undefined)
}

Snapshot.prototype.close = function () {
  if (this.closed) return
  this.closed = true

  this._priority.close()
  this._priority = null

  this._chunkStore.close()
  this._chunkStore = null
}
