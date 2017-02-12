/* eslint-env mocha, browser */
/* global planktos */

const assert = require('assert')
const parseTorrent = require('parse-torrent-file')

const v1Base = '/base/test/www/v1/'
const v2Base = '/base/test/www/v2/'

describe('lib', function () {
  this.timeout(20000)

  before(function () {
    return planktos.update(v1Base)
    .then(() => planktos.startSeeder())
  })

  it('getSnapshot()', function () {
    return planktos.getSnapshot()
    .then(snapshot => {
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
    .then(stream => {
      return new Promise(resolve => {
        let buffer = Buffer.alloc(0)
        stream.on('data', chunk => {
          buffer = Buffer.concat([buffer, chunk])
        })
        stream.on('end', (c) => {
          assert(buffer.equals(Buffer.from('foobar\n')))
          resolve()
        })
      })
    })
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

  it('planktos.fetch()', function () {
    return planktos.fetch(new Request(v1Base + 'foobar.txt'), {root: v1Base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() - non normalized url', function () {
    return planktos.fetch(new Request(v1Base + '///.////foobar.txt'), {root: v1Base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() with string', function () {
    return planktos.fetch(location.origin + v1Base + 'foobar.txt', {root: v1Base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() implied index html', function () {
    return planktos.fetch(location.origin + v1Base + 'foo', {root: v1Base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'bar\n'))
  })

  it('planktos.fetch() with invalid request', function () {
    planktos.fetch({}, {root: v1Base})
    .then(() => assert(false))
    .catch(err => assert(err instanceof Error))

    planktos.fetch(null, {root: v1Base})
    .then(() => assert(false))
    .catch(err => assert(err instanceof Error))

    planktos.fetch('http://example.com' + v1Base + 'foobar.txt', {root: v1Base})
    .then(() => assert(false))
    .catch(err => assert(err instanceof Error))

    planktos.fetch(new Request(v1Base + 'foobar.txt', {method: 'POST'}), {root: v1Base})
    .then(() => assert(false))
    .catch(err => assert(err instanceof Error))
  })

  it('planktos.fetch() and inject for non-html files', function () {
    return planktos.fetch(location.origin + v1Base + 'foobar.txt', {root: v1Base, inject: true})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => {
      assert(text.startsWith('<!doctype html>'))
      assert(text.includes('<iframe'))
    })
  })

  it('planktos.fetch() and inject for html files', function () {
    return planktos.fetch(location.origin + v1Base + 'foo/', {root: v1Base, inject: true})
    .then(response => response.blob())
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
    }))
  })

  it('planktos.fetch() preCached non normalized url', function () {
    return planktos.fetch(new Request(v1Base + 'foo/../planktos/./planktos.min.js'))
    .then(response => assert.notEqual(response, undefined))
  })

  it('getFile() - file does not exist', function () {
    return planktos.getFile('/doesNotExist.html')
    .then(file => assert.equal(file, undefined))
  })

  it('update() to v2', function () {
    return planktos.update(v2Base)
    .then(() => planktos.startSeeder())
  })

  it('v2 - getSnapshot()', function () {
    return planktos.getSnapshot()
    .then(snapshot => {
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
  this.timeout(20000)

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
