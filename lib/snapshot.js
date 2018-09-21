module.exports = Snapshot

/* global Headers, Request, ReadableStream, FetchEvent */ // TODO needed?

const streamToBlob = require('stream-to-blob')
const nodeStreamToWeb = require('readable-stream-node-to-web')
const path = require('path')
const middleware = require('./middleware')

const global = typeof window !== 'undefined' ? window : self // eslint-disable-line

function Snapshot (obj, torrent, namespace) {
  this.closed = false
  this.hash = obj.hash
  this.rootUrl = obj.rootUrl
  this._manifest = obj.manifest
  this._torrent = torrent
  this._namespace = namespace
  this._middlewares = [
    middleware.cache(this),
    middleware.getTorrentFile(this),
    middleware.range(this),
    middleware.inject(this)
  ]
}

Snapshot.prototype._getFilePath = function (fpath) {
  let normalizedFpath = path.normalize(fpath)
  if (normalizedFpath.startsWith('/') || normalizedFpath === '.') normalizedFpath = normalizedFpath.substr(1)

  // If the `normalizedFpath` cannot be found in the manifest, try to search for the index file
  normalizedFpath = ['', 'index.html', 'index.htm']
    .map(name => path.join(normalizedFpath, name))
    .find(normalizedFpath => normalizedFpath in this._manifest)
  return normalizedFpath == null ? fpath : normalizedFpath
}

Snapshot.prototype.getFile = function (fpath) {
  if (this.closed) throw new Error('Snapshot is closed')
  fpath = this._getFilePath(fpath)
  let hash = this._manifest[fpath]
  return this._torrent.files.find(f => f.name === hash)
}

Snapshot.prototype.fetch = function (req, opts) {
  if (this.closed) throw new Error('Snapshot is closed')
  opts = opts || {}

  req = normalizeRequest(req)
  req.planktosRoot = opts.root
  req.planktosSnapshotDir = opts.snapshotDir
  req.planktosInject = opts.inject

  const rsp = {
    createReadStream: null,
    status: null,
    statusText: null,
    headers: new Headers()
  }

  return middleware.run(this._middlewares, req, rsp)
    .then((rsp) => {
      if (!rsp) return
      return streamToBody(rsp.createReadStream(), opts.stream)
        .then(body => new Response(body, rsp))
    })
}

function normalizeRequest (req) {
  let request = null
  if (typeof FetchEvent !== 'undefined' && req instanceof FetchEvent) {
    request = req.request
    request.fetchEvent = req
  } else if (req instanceof Request) {
    request = req
  } else {
    request = new Request(req)
  }
  return request
}

Snapshot.prototype._close = function () {
  if (this.closed) return
  this.closed = true
}

Snapshot.prototype._destroy = function () {
  this._close()
}

function streamToBody (stream, shouldStream) {
  return new Promise((resolve, reject) => {
    if (shouldStream !== false && typeof ReadableStream !== 'undefined') {
      resolve(nodeStreamToWeb(stream))
    } else {
      streamToBlob(stream, function onBlob (err, blob) {
        if (err) reject(err)
        else resolve(blob)
      })
    }
  })
}
