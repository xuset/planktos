module.exports = Planktos

const global = typeof window !== 'undefined' ? window : self // eslint-disable-line

// Temp bug fix: https://github.com/srijs/rusha/issues/39
if (global.WorkerGlobalScope) delete global.FileReaderSync

const IdbKvStore = require('idb-kv-store')
const path = require('path')
const parseTorrent = require('parse-torrent-file')
const TabElect = require('tab-elect')
const Snapshot = require('./lib/snapshot')
const Seeder = require('./lib/seeder')

const preCached = [
  '/planktos/planktos.min.js',
  '/planktos/install.js'
]

function Planktos () {
  this._latestSnapshot = null
  this._snapshotPromise = null
  this._snapshotStore = new IdbKvStore('planktos-snapshots')
  this._seeder = null
}

Planktos.prototype.getFile = function (fpath) {
  return this.getSnapshot()
  .then(snapshot => snapshot.getFile(fpath))
}

Planktos.prototype.fetch = function (req, opts) {
  return this.getSnapshot()
  .then(snapshot => snapshot.fetch(req, opts))
}

Planktos.prototype.getSnapshot = function () {
  let self = this
  if (self._latestSnapshot) return Promise.resolve(self._latestSnapshot)
  if (self._snapshotPromise) return self._snapshotPromise

  self._snapshotPromise = self._snapshotStore.get('latest')
  .then(latest => {
    self._snapshotPromise = null
    if (latest == null) throw new Error('No local snapshot. Call planktos.update()')
    self._latestSnapshot = new Snapshot(latest)
    if (self._seeder) self._seeder.add(self._latestSnapshot)
    return self._latestSnapshot
  })

  return self._snapshotPromise
}

Planktos.prototype.update = function (rootUrl) {
  let self = this
  if (!(rootUrl instanceof URL)) rootUrl = new URL(rootUrl, global.location.origin)

  let torrentMetaUrl = new URL(path.join(rootUrl.pathname, 'planktos/root.torrent'), rootUrl)
  let manifestUrl = new URL(path.join(rootUrl.pathname, 'planktos/manifest.json'), rootUrl)
  let cacheUrls = preCached.map(f => new URL(path.join(rootUrl.pathname, f), rootUrl))

  return Promise.all([
    global.fetch(manifestUrl).then(response => response.json()),
    global.fetch(torrentMetaUrl).then(response => response.arrayBuffer()),
    self._snapshotStore.get('latest'),
    global.caches.open('planktos').then(cache => cache.addAll(cacheUrls))
  ])
  .then(results => {
    let [manifest, torrentMetaBuffer, latestObj] = results
    let hash = parseTorrent(new Buffer(torrentMetaBuffer)).infoHash

    if (latestObj != null && latestObj.hash === hash) return

    let snapshotObj = {
      manifest: manifest,
      torrentMetaBuffer: torrentMetaBuffer,
      rootUrl: rootUrl.toString(),
      hash: hash
    }

    return Promise.all([
      self._snapshotStore.set('latest', snapshotObj),
      self._snapshotStore.set(hash, snapshotObj)
    ])
  })
  .then(() => {
    if (self._latestSnapshot) self._latestSnapshot.close()
    self._latestSnapshot = null
    self._snapshotPromise = null
    return self.getSnapshot()
  })
}

Planktos.prototype.startSeeder = function () {
  let self = this
  if (self._seeder) return self._seeder
  self._seeder = new Seeder()

  let tabElect = new TabElect('planktos')
  tabElect.on('elected', self._seeder.start.bind(self._seeder))
  tabElect.on('deposed', self._seeder.stop.bind(self._seeder))

  self._snapshotStore.on('set', function (change) {
    if (change.key !== 'latest') self._seeder.add(new Snapshot(change.value))
  })

  self._snapshotStore.json().then(json => {
    Object.keys(json)
    .filter(hash => hash !== 'latest')
    .forEach(hash => self._seeder.add(new Snapshot(json[hash])))
  })

  return self._seeder
}
