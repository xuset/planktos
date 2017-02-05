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

const debug = require('debug')('planktos:lib')
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
  .then(file => {
    debug('FILE path=' + (file || {}).path, 'found=' + (file != null))
    return file
  })
}

function fetch (req, opts) {
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

  debug('FETCH-REQ url=' + url.pathname, 'inject=' + inject)

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

    blobPromise = Promise.all([
      global.caches.open('planktos')
        .then(c => c.match(path.normalize(url.pathname)))
        .then(resp => resp ? resp.blob() : undefined),
      getFile(fpath)
        .then(file => file ? file.getBlob() : undefined)
    ]).then(blobs => blobs.find(b => b != null))
  }

  return blobPromise
  .then(blob => blob != null ? new Response(blob) : undefined)
  .then(response => {
    debug('FETCH-RSP url=' + url.pathname, 'found=' + (response != null))
    return response
  })
}

function update (url) {
  if (!url) url = ''
  url = path.normalize(url)

  debug('UPDATE url=' + url)

  let cachePromise = global.caches.open('planktos')
  .then(cache => cache.addAll(preCached.map(f => path.join(url, f))))
  .then(() => global.caches.open('planktos'))

  let manifestPromise = cachePromise
  .then(cache => cache.match(path.join(url, 'planktos/manifest.json')))
  .then(response => response.json())
  .then(json => {
    debug('MANIFEST', json)
    return persistent.set('manifest', json)
  })

  let torrentPromise = cachePromise
  .then(cache => cache.match(path.join(url, 'planktos/root.torrent')))
  .then(response => response.arrayBuffer())
  .then(arrayBuffer => {
    let buffer = Buffer.from(arrayBuffer)
    let parsed = parseTorrent(buffer)
    debug('TORRENTMETA', parsed)
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
