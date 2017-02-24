/* eslint-env mocha, browser */
/* global Planktos */

const assert = require('assert')
const parseTorrent = require('parse-torrent-file')

const v1Base = '/base/test/www/v1/'
const v2Base = '/base/test/www/v2/'
const planktos = new Planktos({ namespace: Math.random() })
planktos.startSeeder()

describe('lib', function () {
  this.timeout(8000)

  it('getAllSnapshots() - empty', function () {
    return planktos.getAllSnapshots().then(snapshots => assert.deepEqual(snapshots, []))
  })

  it('update() to v1', function () {
    return planktos.update(v1Base)
    .then(snapshot => assert('hash' in snapshot))
  })

  it('getAllSnapshots()', function () {
    return planktos.getAllSnapshots()
    .then(snapshots => {
      assert.equal(snapshots.length, 1)
      let snapshot = snapshots[0]
      let parsed = parseTorrent(snapshot.torrentMetaBuffer)
      assert.equal(parsed.infoHash, snapshot.torrentMeta.infoHash)
      assert.equal(snapshot.hash, snapshot.torrentMeta.infoHash)
      assert.equal(new URL(snapshot.rootUrl).origin, location.origin)
      assert('index.html' in snapshot.manifest)
      assert.notEqual(snapshot.torrentMetaBuffer.length, 0)
      assert(snapshot.torrentMeta.files.find(f => f.name === snapshot.manifest['index.html']))
    })
  })

  it('getFile()', function () {
    return planktos.getFile('/foo')
    .then(f => {
      assert.equal(f.path, 'foo/index.html')
      assert.equal(f.hash, 'e242ed3bffccdf271b7fbaf34ed72d089537b42f')
      assert.equal(f.length, 4)
      assert(typeof f.offset === 'number')
    })
  })

  it('getFile() - non normalized url', function () {
    return planktos.getFile('///.//foo////')
    .then(f => assert.equal(f.path, 'foo/index.html'))
  })

  it('file.getStream()', function () {
    return planktos.getFile('foobar.txt')
    .then(f => f.getStream())
    .then(stream => nodeStreamToString(stream))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('file.getStream() - ranged', function () {
    return planktos.getFile('foobar.txt')
    .then(f => f.getStream({start: 2, end: 4}))
    .then(stream => nodeStreamToString(stream))
    .then(text => assert.equal(text, 'oba'))
  })

  it('file.getStream() - bad range', function () {
    return Promise.all([
      planktos.getFile('foobar.txt')
      .then(f => f.getStream({start: -1, end: 4}))
      .then(() => assert(false))
      .catch(err => assert(err instanceof Error)),

      planktos.getFile('foobar.txt')
      .then(f => f.getStream({start: 1, end: 0}))
      .then(() => assert(false))
      .catch(err => assert(err instanceof Error)),

      planktos.getFile('foobar.txt')
      .then(f => f.getStream({start: 8, end: 9}))
      .then(() => assert(false))
      .catch(err => assert(err instanceof Error))
    ])
  })

  it('file.getFileBlob()', function () {
    return planktos.getFile('foobar.txt')
    .then(f => f.getBlob())
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'foobar\n')
    })
  })

  it('file.getBlob() - implied index - with slash', function () {
    return planktos.getFile('/foo/')
    .then(f => f.getBlob())
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'bar\n')
    })
  })

  it('file.getBlob() - implied index - without slash', function () {
    return planktos.getFile('/foo')
    .then(f => f.getBlob())
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'bar\n')
    })
  })

  it('file.getBlob() - ranged', function () {
    return planktos.getFile('/foo')
    .then(f => f.getBlob({start: 0, end: 1}))
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'ba')
    })
  })

  it('file.getWebStream()', function () {
    if (typeof ReadableStream === 'undefined') return Promise.resolve()

    return planktos.getFile('foobar.txt')
    .then(f => f.getWebStream())
    .then(stream => {
      assert.equal(stream.length, 7)
      return webStreamToString(stream)
    })
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('file.getWebStream() ranged', function () {
    if (typeof ReadableStream === 'undefined') return Promise.resolve()

    return planktos.getFile('foobar.txt')
    .then(f => f.getWebStream({start: 1, end: 2}))
    .then(stream => {
      assert.equal(stream.length, 2)
      return webStreamToString(stream)
    })
    .then(text => assert.equal(text, 'oo'))
  })

  it('planktos.fetch()', function () {
    return planktos.fetch(new Request(v1Base + 'foobar.txt'), {root: v1Base})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.equal(response.headers.get('Content-Length'), '7')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() - non normalized url', function () {
    return planktos.fetch(new Request(v1Base + '///.////foobar.txt'), {root: v1Base})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.equal(response.headers.get('Content-Length'), '7')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() with string', function () {
    return planktos.fetch(location.origin + v1Base + 'foobar.txt', {root: v1Base})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.equal(response.headers.get('Content-Length'), '7')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() implied index html', function () {
    return planktos.fetch(location.origin + v1Base + 'foo', {root: v1Base})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.equal(response.headers.get('Content-Length'), '4')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'bar\n'))
  })

  it('planktos.fetch() with invalid request', function () {
    return Promise.all([
      planktos.fetch({}, {root: v1Base})
      .then(() => assert(false))
      .catch(err => assert(err instanceof Error)),

      planktos.fetch(null, {root: v1Base})
      .then(() => assert(false))
      .catch(err => assert(err instanceof Error)),

      planktos.fetch('http://example.com' + v1Base + 'foobar.txt', {root: v1Base})
      .then(() => assert(false))
      .catch(err => assert(err instanceof Error)),

      planktos.fetch(new Request(v1Base + 'foobar.txt', {method: 'POST'}), {root: v1Base})
      .then(() => assert(false))
      .catch(err => assert(err instanceof Error))
    ])
  })

  it('planktos.fetch() and inject for non-html files', function () {
    return planktos.fetch(location.origin + v1Base + 'foobar.txt', {root: v1Base, inject: true})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.notEqual(response.headers.get('Content-Length'), null)
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert(text.startsWith('<!doctype html>'))
      assert(text.includes('<iframe'))
    })
  })

  it('planktos.fetch() and inject for html files', function () {
    return planktos.fetch(location.origin + v1Base + 'foo/', {root: v1Base, inject: true})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.notEqual(response.headers.get('Content-Length'), null)
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert(text.startsWith('<!doctype html>'))
      assert(text.includes('document.documentElement.innerHTML = '))
    })
  })

  it('planktos.fetch() preCached', function () {
    let preCached = [
      v1Base + 'planktos/planktos.min.js',
      v1Base + 'planktos/install.js'
    ]
    return Promise.all(preCached.map(fpath => {
      return planktos.fetch(new Request(fpath), {root: v1Base})
    }))
    .then(responses => responses.forEach(r => {
      assert.notEqual(r, undefined)
      assert.equal(r.status, 200)
      assert.equal(r.statusText, 'OK')
      assert.notEqual(r.headers.get('Content-Length'), null)
      assert.equal(r.headers.get('Accept-Ranges'), 'bytes')
    }))
  })

  it('planktos.fetch() preCached non normalized url', function () {
    return planktos.fetch(new Request(v1Base + 'foo/../planktos/./planktos.min.js'))
    .then(response => assert.notEqual(response, undefined))
  })

  it('planktos.fetch() range header with zero start', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'bytes=0-'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 206)
      assert.equal(response.statusText, 'Partial Content')
      assert.equal(response.headers.get('Content-Range'), 'bytes 0-6/7')
      assert.equal(response.headers.get('Content-Length'), '7')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'foobar\n')
    })
  })

  it('planktos.fetch() range header with start', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'bytes=1-'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 206)
      assert.equal(response.statusText, 'Partial Content')
      assert.equal(response.headers.get('Content-Range'), 'bytes 1-6/7')
      assert.equal(response.headers.get('Content-Length'), '6')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'oobar\n')
    })
  })

  it('planktos.fetch() range header with start and end', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'bytes=1-2'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 206)
      assert.equal(response.statusText, 'Partial Content')
      assert.equal(response.headers.get('Content-Range'), 'bytes 1-2/7')
      assert.equal(response.headers.get('Content-Length'), '2')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'oo')
    })
  })

  it('planktos.fetch() range header with equal start and end', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'bytes=2-2'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 206)
      assert.equal(response.statusText, 'Partial Content')
      assert.equal(response.headers.get('Content-Range'), 'bytes 2-2/7')
      assert.equal(response.headers.get('Content-Length'), '1')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'o')
    })
  })

  it('planktos.fetch() range header with start and over extended end', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'bytes=1-10000'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 206)
      assert.equal(response.statusText, 'Partial Content')
      assert.equal(response.headers.get('Content-Range'), 'bytes 1-6/7')
      assert.equal(response.headers.get('Content-Length'), '6')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'oobar\n')
    })
  })

  it('planktos.fetch() range header with invalid start and end', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'bytes=3-2'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.equal(response.headers.get('Content-Range'), undefined)
      assert.equal(response.headers.get('Content-Length'), '7')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'foobar\n')
    })
  })

  it('planktos.fetch() range header with end but no start', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'bytes=-2'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.equal(response.headers.get('Content-Range'), undefined)
      assert.equal(response.headers.get('Content-Length'), '7')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'foobar\n')
    })
  })

  it('planktos.fetch() range header with malformed header', function () {
    var req = new Request(v1Base + 'foobar.txt', {
      headers: {'Range': 'zzz=1-2'}
    })
    return planktos.fetch(req, {root: v1Base})
    .then(response => {
      assert.equal(response.status, 200)
      assert.equal(response.statusText, 'OK')
      assert.equal(response.headers.get('Content-Range'), undefined)
      assert.equal(response.headers.get('Content-Length'), '7')
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
      return response.blob()
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'foobar\n')
    })
  })

  it('getFile() - file does not exist', function () {
    return planktos.getFile('/doesNotExist.html')
    .then(file => assert.equal(file, undefined))
  })

  it('remove then re-add', function () {
    return planktos.getAllSnapshots()
    .then(snapshots => {
      assert.equal(snapshots.length, 1)
      return planktos.removeSnapshot(snapshots[0].hash)
    })
    .then(() => planktos.getAllSnapshots())
    .then(snapshots => assert.equal(snapshots.length, 0))
    .then(() => planktos.update(v1Base))
    .then(snapshot => assert('hash' in snapshot))
    .then(() => planktos.getAllSnapshots())
    .then(snapshots => {
      assert.equal(snapshots.length, 1)
      return snapshots[0].fetch(new Request('foobar.txt'))
    })
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('update() to v2', function () {
    return planktos.update(v2Base)
    .then(snapshot => assert('hash' in snapshot))
  })

  it('v2 - getAllSnapshots()', function () {
    return planktos.getAllSnapshots()
    .then(snapshots => {
      assert.equal(snapshots.length, 2)
      let snapshot = snapshots[1]
      let parsed = parseTorrent(snapshot.torrentMetaBuffer)
      assert.equal(parsed.infoHash, snapshot.torrentMeta.infoHash)
      assert.equal(snapshot.hash, snapshot.torrentMeta.infoHash)
      assert.equal(new URL(snapshot.rootUrl).origin, location.origin)
      assert('foo.txt' in snapshot.manifest)
      assert.notEqual(snapshot.torrentMetaBuffer.length, 0)
      assert(snapshot.torrentMeta.files.find(f => f.name === snapshot.manifest['foo.txt']))
    })
  })

  it('v2 - getFile()', function () {
    return planktos.getFile('foo.txt')
    .then(f => {
      assert.equal(f.path, 'foo.txt')
      assert.equal(f.hash, 'e242ed3bffccdf271b7fbaf34ed72d089537b42f')
      assert.equal(f.length, 4)
      assert(typeof f.offset === 'number')
    })
  })

  it('v2 - file.getFileBlob()', function () {
    return planktos.getFile('foo.txt')
    .then(f => f.getBlob())
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'bar\n')
    })
  })
})

describe('service worker', function () {
  this.timeout(8000)

  let iframe = null

  before(function () {
    return loadIframe(v1Base + 'index.html')
    .then(elem => {
      // register the service worker in the iframe and wait for it to activate
      iframe = elem
      iframe.contentWindow.navigator.serviceWorker.register(v1Base + 'planktos.sw.js')
      return iframe.contentWindow.navigator.serviceWorker.ready
    })
    .then(() => new Promise(function (resolve) {
      // refresh the iframe and wait for the page to be loaded
      // This ensures the service worker is controlling the page
      iframe.onload = function () {
        resolve()
      }
      iframe.contentWindow.location.reload()
    }))
  })

  it('service worker controls page', function () {
    assert.notEqual(iframe.contentWindow.navigator.serviceWorker.controller, null)
  })

  it('window.fetch()', function () {
    return iframe.contentWindow.fetch(v1Base + 'foobar.txt')
    .then(resp => resp.text())
    .then(text => {
      assert.equal(text, 'foobar\n')
    })
  })

  it('window.fetch() implied index html', function () {
    return iframe.contentWindow.fetch(v1Base + 'foo')
    .then(resp => resp.text())
    .then(text => {
      assert.equal(text, 'bar\n')
    })
  })

  it('no iframe injected into html', function () {
    assert.equal(iframe.contentDocument.getElementsByTagName('iframe').length, 0)
  })
})

function loadIframe (url) {
  return new Promise(function (resolve) {
    let iframe = document.createElement('iframe')
    iframe.onload = onload
    iframe.src = url
    document.body.appendChild(iframe)

    function onload () {
      iframe.onload = null
      resolve(iframe)
    }
  })
}

function blobToText (blob) {
  return new Promise(function (resolve, reject) {
    let fr = new window.FileReader()
    fr.onload = onload
    fr.onerror = onerror
    fr.readAsText(blob)

    function onload () {
      resolve(fr.result)
    }

    function onerror () {
      reject(fr.error)
    }
  })
}

function webStreamToString (stream) {
  return new Promise(function (resolve, reject) {
    let reader = stream.getReader()
    let buffer = ''
    reader.read().then(onRead)

    function onRead (result) {
      if (result.done) return resolve(buffer)

      buffer += result.value.toString()
      reader.read().then(onRead)
    }
  })
}

function nodeStreamToString (stream) {
  return new Promise(function (resolve, reject) {
    let buffer = ''
    stream.on('data', chunk => {
      buffer += chunk.toString()
    })
    stream.on('end', (c) => {
      resolve(buffer)
    })
    stream.on('error', (err) => {
      reject(err)
    })
  })
}
