/* eslint-env mocha, browser */
/* global planktos */

const assert = require('assert')
const parseTorrent = require('parse-torrent-file')

describe('sanity check', function () {
  this.timeout(20000)

  const base = '/base/test/www/'
  let iframe = null

  before(function () {
    return loadIframe(base)
    .then(elem => {
      // register the service worker in the iframe and wait for it to activate
      iframe = elem
      iframe.contentWindow.navigator.serviceWorker.register(base + 'planktos.sw.min.js')
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

  it('getManifest()', function () {
    return planktos.getManifest()
    .then(manifest => assert('index.html' in manifest))
  })

  it('getTorrentMeta()', function () {
    return planktos.getTorrentMeta()
    .then(torrentMeta => parseTorrent.encode(torrentMeta))
  })

  it('getTorrentMetaBuffer()', function () {
    return planktos.getTorrentMetaBuffer()
    .then(buffer => assert.notEqual(buffer.length, 0))
  })

  it('getFile()', function () {
    return planktos.getFile('/foo')
    .then(f => {
      assert.equal(f.path, 'foo/index.html')
      assert.equal(f.hash, 'e242ed3bffccdf271b7fbaf34ed72d089537b42f')
      assert.equal(f.length, 4)
      assert(typeof f.offset === 'number')
      assert('torrentMeta' in f)
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
    return planktos.fetch(new Request(base + 'foobar.txt'), {root: base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() - non normalized url', function () {
    return planktos.fetch(new Request(base + '///.////foobar.txt'), {root: base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() with string', function () {
    return planktos.fetch(location.origin + base + 'foobar.txt', {root: base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'foobar\n'))
  })

  it('planktos.fetch() implied index html', function () {
    return planktos.fetch(location.origin + base + 'foo', {root: base})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => assert.equal(text, 'bar\n'))
  })

  it('planktos.fetch() with invalid request', function () {
    assert.throws(() => {
      planktos.fetch({}, {root: base})
    })
    assert.throws(() => {
      planktos.fetch(null, {root: base})
    })
    assert.throws(() => {
      planktos.fetch('http://example.com' + base + 'foobar.txt', {root: base})
    })
    assert.throws(() => {
      planktos.fetch(new Request(base + 'foobar.txt', {method: 'POST'}), {root: base})
    })
  })

  it('planktos.fetch() and inject for non-html files', function () {
    return planktos.fetch(location.origin + base + 'foobar.txt', {root: base, inject: true})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => {
      assert(text.startsWith('<!doctype html>'))
      assert(text.includes('<iframe'))
    })
  })

  it('planktos.fetch() and inject for html files', function () {
    return planktos.fetch(location.origin + base + 'foo/', {root: base, inject: true})
    .then(response => response.blob())
    .then(blob => blobToText(blob))
    .then(text => {
      assert(text.startsWith('<!doctype html>'))
      assert(text.includes('document.documentElement.innerHTML = '))
    })
  })

  it('planktos.fetch() preCached', function () {
    let preCached = [
      base + 'planktos/root.torrent',
      base + 'planktos/manifest.json',
      base + 'planktos/planktos.min.js',
      base + 'planktos/install.js'
    ]
    return Promise.all(preCached.map(fpath => {
      return planktos.fetch(new Request(fpath), {root: base})
    }))
    .then(responses => responses.forEach(r => {
      assert.notEqual(r, undefined)
    }))
  })

  it('planktos.fetch() preCached non normalized url', function () {
    return planktos.fetch(new Request(base + '//planktos/./root.torrent'))
    .then(response => assert.notEqual(response, undefined))
  })

  it('window.fetch()', function () {
    return iframe.contentWindow.fetch(base + 'foobar.txt')
    .then(resp => resp.text())
    .then(text => {
      assert.equal(text, 'foobar\n')
    })
  })

  it('window.fetch() implied index html', function () {
    return iframe.contentWindow.fetch(base + 'foo')
    .then(resp => resp.text())
    .then(text => {
      assert.equal(text, 'bar\n')
    })
  })

  it('getFile() - file does not exist', function () {
    return planktos.getFile('/doesNotExist.html')
    .then(file => assert.equal(file, undefined))
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
