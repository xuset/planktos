const global = typeof window !== 'undefined' ? window : self // eslint-disable-line

// Temp bug fix: https://github.com/srijs/rusha/issues/39
if (global.WorkerGlobalScope) delete global.FileReaderSync

module.exports.update = update
module.exports.getSnapshot = getSnapshot
module.exports.getFile = getFile
module.exports.fetch = fetch
module.exports.startSeeder = startSeeder

const IdbKvStore = require('idb-kv-store')
const path = require('path')
const parseTorrent = require('parse-torrent-file')
const TabElect = require('tab-elect')
const Snapshot = require('./lib/snapshot')
const Seeder = require('./lib/seeder')

let latestSnapshot = null
let snapshotPromise = null
let snapshotStore = new IdbKvStore('planktos-snapshots')
let seeder = null

const preCached = [
  '/planktos/planktos.min.js',
  '/planktos/install.js'
]

function getFile (fpath) {
  return getSnapshot()
  .then(snapshot => snapshot.getFile(fpath))
}

function fetch (req, opts) {
  return getSnapshot()
  .then(snapshot => snapshot.fetch(req, opts))
}

function getSnapshot () {
  if (latestSnapshot) return Promise.resolve(latestSnapshot)
  if (snapshotPromise) return snapshotPromise

  snapshotPromise = snapshotStore.get('latest')
  .then(latest => {
    snapshotPromise = null
    if (latest == null) throw new Error('No local snapshot. Call planktos.update()')
    latestSnapshot = new Snapshot(latest)
    if (seeder) seeder.add(latestSnapshot)
    return latestSnapshot
  })

  return snapshotPromise
}

function update (rootUrl) {
  if (!(rootUrl instanceof URL)) rootUrl = new URL(rootUrl, global.location.origin)

  let torrentMetaUrl = new URL(path.join(rootUrl.pathname, 'planktos/root.torrent'), rootUrl)
  let manifestUrl = new URL(path.join(rootUrl.pathname, 'planktos/manifest.json'), rootUrl)
  let cacheUrls = preCached.map(f => new URL(path.join(rootUrl.pathname, f), rootUrl))

  return Promise.all([
    global.fetch(manifestUrl).then(response => response.json()),
    global.fetch(torrentMetaUrl).then(response => response.arrayBuffer()),
    snapshotStore.get('latest'),
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
      snapshotStore.set('latest', snapshotObj),
      snapshotStore.set(hash, snapshotObj)
    ])
  })
  .then(() => {
    if (latestSnapshot) latestSnapshot.close()
    latestSnapshot = null
    snapshotPromise = null
    return getSnapshot()
  })
}

function startSeeder () {
  if (seeder) return seeder
  seeder = new Seeder()

  let tabElect = new TabElect('planktos')
  tabElect.on('elected', seeder.start.bind(seeder))
  tabElect.on('deposed', seeder.stop.bind(seeder))

  snapshotStore.on('set', function (change) {
    if (change.key !== 'latest') seeder.add(new Snapshot(change.value))
  })

  snapshotStore.json().then(json => {
    Object.keys(json)
    .filter(hash => hash !== 'latest')
    .forEach(hash => seeder.add(new Snapshot(json[hash])))
  })

  return seeder
}
