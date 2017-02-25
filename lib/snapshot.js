module.exports = Snapshot

const parseTorrent = require('parse-torrent-file')
const path = require('path')
const IdbKvStore = require('idb-kv-store')
const IdbChunkStore = require('indexeddb-chunk-store')
const injection = require('./injection')
const File = require('./file')

const global = typeof window !== 'undefined' ? window : self // eslint-disable-line

function Snapshot (obj, namespace) {
  this.closed = false
  this.manifest = obj.manifest
  this.torrentMetaBuffer = Buffer.isBuffer(obj.torrentMetaBuffer)
                           ? obj.torrentMetaBuffer : new Buffer(obj.torrentMetaBuffer)
  this.torrentMeta = parseTorrent(this.torrentMetaBuffer)
  this.hash = obj.hash
  this.rootUrl = obj.rootUrl

  this._namespace = namespace
  this._priorityDbName = 'planktos-priority-' + this.hash + '-' + namespace
  this._priority = new IdbKvStore(this._priorityDbName)
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
  req = parseRequest(req)

  let range = req.range
  let bodyPromise = null
  let fpath = opts.root ? req.url.pathname.replace(opts.root, '') : req.url.pathname
  let file = this.getFile(fpath)
  let responseMeta = {
    status: 200,
    statusText: 'OK',
    headers: { 'Accept-Ranges': 'bytes' }
  }

  if (req.url.origin !== global.location.origin) throw new Error('Cannot Fetch. Origin differs')

  if (opts.inject != null ? opts.inject : req.inject) {
    bodyPromise = Promise.resolve(createInjection(req.url, opts.root))
  } else if (file != null) {
    if (range && (!range.end || range.end > file.length - 1)) range.end = file.length - 1
    if (range && range.start > range.end) range = null // Invalid range so ignore it

    if (range) {
      responseMeta.status = 206
      responseMeta.statusText = 'Partial Content'
      responseMeta.headers['Content-Range'] = 'bytes ' + range.start + '-' +
                                              range.end + '/' + file.length
    }

    let shouldStream = opts.stream != null ? opts.stream : File.WEBSTREAM_SUPPORT
    bodyPromise = shouldStream ? file.getWebStream(range) : file.getBlob(range)
  } else {
    bodyPromise = global.caches.open('planktos-' + this._namespace)
    .then(c => c.match(req.url.pathname))
    .then(resp => resp ? resp.blob() : undefined)
  }

  return bodyPromise.then(body => {
    if (body == null) return undefined
    responseMeta.headers['Content-Length'] = body.size || body.length
    return new Response(body, responseMeta)
  })
}

Snapshot.prototype.close = function () {
  if (this.closed) return
  this.closed = true

  this._priority.close()
  this._priority = null

  this._chunkStore.close()
  this._chunkStore = null
}

Snapshot.prototype.destroy = function () {
  this.close()
  global.indexedDB.deleteDatabase(this.hash)
  global.indexedDB.deleteDatabase(this._priorityDbName)
}

function parseRequest (req) {
  let inject = false
  let url = null
  let range = null

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

    let rangeHeader = /^bytes=(\d+)-(\d+)?$/g.exec(req.headers.get('range'))
    if (rangeHeader && rangeHeader[1]) {
      range = { start: Number(rangeHeader[1]) }
      if (rangeHeader[2]) range.end = Number(rangeHeader[2])
    }
  } else if (req instanceof URL) {
    url = req
  } else if (typeof req === 'string') {
    url = new URL(req, global.location.origin)
  }

  if (url == null) throw new Error('Must provide a FetchEvent, Request, URL, or a url string')

  return {
    inject: inject,
    url: url,
    range: range
  }
}

function createInjection (url, root) {
  let fname = url.pathname.substr(url.pathname.lastIndexOf('/') + 1)
  const isHTML = fname.endsWith('.html') || fname.endsWith('.htm') || !fname.includes('.')
  let modUrl = new URL(url.toString())
  modUrl.search = (modUrl.search === '' ? '?' : modUrl.search + '&') + 'noPlanktosInjection'
  let html = (isHTML ? injection.docWrite : injection.iframe)
             .replace(/{{url}}/g, modUrl.toString())
             .replace(/{{root}}/g, root != null ? root : '')
  return new Blob([html], {type: 'text/html'})
}
