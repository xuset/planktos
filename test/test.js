/* eslint-env mocha */
/* global planktos */

var assert = require('assert')
var parseTorrent = require('parse-torrent-file')

describe('sanity check', function () {
  this.timeout(20000)

  var base = '/base/test/www/'
  var iframe = null

  before(function () {
    return loadIframe(base + 'index.html')
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

  it('getDownloaded()', function () {
    return planktos.getDownloaded()
    .then(downloaded => 'index.html' in downloaded)
  })

  it('getTorrentMeta()', function () {
    return planktos.getTorrentMeta()
    .then(torrentMeta => parseTorrent.encode(torrentMeta))
  })

  it('getTorrentMetaBuffer()', function () {
    return planktos.getTorrentMetaBuffer()
    .then(buffer => assert.notEqual(buffer.length, 0))
  })

  it('getFileBlob()', function () {
    return planktos.getFileBlob('foobar.txt')
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

  it('getFileBlob() - implied index - with slash', function () {
    return planktos.getFileBlob('/foo/')
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'bar\n')
    })
  })

  it('getFileBlob() - implied index - without slash', function () {
    return planktos.getFileBlob('/foo')
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'bar\n')
    })
  })
})

function loadIframe (url) {
  return new Promise(function (resolve) {
    var iframe = document.createElement('iframe')
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
    var fr = new window.FileReader()
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
