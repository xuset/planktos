/* eslint-env mocha */
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

  it('file.getStream()', function () {
    return planktos.getFile('foobar.txt')
    .then(f => f.getStream())
    .then(stream => {
      return new Promise(resolve => {
        var buffer = Buffer.alloc(0)
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

  it('fetch()', function () {
    return iframe.contentWindow.fetch(base + 'foobar.txt')
    .then(resp => resp.text())
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

  it('getFile() - file does not exist', function () {
    return planktos.getFile('/doesNotExist.html')
    .catch(err => assert.equal(err.message, 'File not found'))
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
