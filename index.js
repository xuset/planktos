const global = typeof window !== 'undefined' ? window : self // eslint-disable-line

// Temp bug fix: https://github.com/srijs/rusha/issues/39
if (global.WorkerGlobalScope) delete global.FileReaderSync

module.exports.update = update
module.exports.getManifest = getManifest
module.exports.getTorrentMeta = getTorrentMeta
module.exports.getTorrentMetaBuffer = getTorrentMetaBuffer
module.exports.downloader = require('./lib/downloader')
module.exports.getFile = getFile
module.exports.fetch = fetch

const IdbKvStore = require('idb-kv-store')
const parseTorrent = require('parse-torrent-file')
const _getFile = require('./lib/file')
const injection = require('./lib/injection')
const path = require('path')

let persistent = new IdbKvStore('planktos')

const preCached = [
  '/planktos/root.torrent',
  '/planktos/manifest.json',
  '/planktos/planktos.min.js',
  '/planktos/install.js'
]

function getManifest () {
  return persistent.get('manifest')
}

function getTorrentMeta () {
  return persistent.get('torrentMeta')
}

function getTorrentMetaBuffer () { // TODO Fix parsing bug so this can be removed
  return persistent.get('torrentMetaBuffer')
}

function getFile (fpath) {
  return _getFile(module.exports, fpath)
}

function fetch (req, opts) {
  opts = opts || {}
  let inject = false
  let url = null

  // Convert a FetchEvent to Request
  if (global.FetchEvent && req instanceof global.FetchEvent) {
    inject = req.clientId == null
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

  if (req == null) throw new Error('Must provide a FetchEvent, Request, URL, or a string')
  if (url.origin !== global.location.origin) throw new Error('Cannot Fetch. Origin differs')

  // Generate response blob. Depends on if the downloader should be injected or not
  let blobPromise = null
  if ('inject' in opts ? opts.inject : inject) {
    let fname = url.pathname.substr(url.pathname.lastIndexOf('/') + 1)
    const isHTML = fname.endsWith('.html') || fname.endsWith('.htm') || !fname.includes('.')
    let modUrl = new URL(url.toString())
    modUrl.search = (url.search === '' ? '?' : url.search + '&') + 'noPlanktosInjection'
    let html = (isHTML ? injection.docWrite : injection.iframe)
               .replace('{{url}}', modUrl.toString())
               .replace('{{scope}}', opts.scope ? opts.scope : '')
    blobPromise = Promise.resolve(new Blob([html], {type: 'text/html'}))
  } else {
    // fpath is relative to the service worker scope if opts.scope was given
    let fpath = opts.scope ? url.pathname.replace(opts.scope, '') : url.pathname

    blobPromise = Promise.all([
      global.caches.open('planktos')
        .then(c => c.match(path.normalize(url.pathname)))
        .then(r => r ? r.blob() : undefined),
      getFile(fpath)
        .then(f => f ? f.getBlob() : undefined)
    ]).then(blobs => blobs[0] || blobs[1])
  }

  return blobPromise
  .then(blob => blob != null ? new Response(blob) : undefined)
}

function update (url) {
  if (!url) url = ''
  if (url.endsWith('/')) url = url.substr(0, url.length - 1)

  let cachePromise = global.caches.open('planktos')
  .then((cache) => cache.addAll(preCached.map(f => url + f)))
  .then(() => global.caches.open('planktos'))

  let manifestPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/manifest.json'))
  .then(response => response.json())
  .then(json => {
    return persistent.set('manifest', json)
  })

  let torrentPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/root.torrent'))
  .then(response => response.arrayBuffer())
  .then(arrayBuffer => {
    let buffer = Buffer.from(arrayBuffer)
    let parsed = parseTorrent(buffer)
    return Promise.all([
      persistent.set('torrentMetaBuffer', buffer),
      persistent.set('torrentMeta', parsed)
    ])
  })

  return Promise.all([
    manifestPromise,
    torrentPromise
  ])
}
