var assert = require('assert')
var planktos = require('../')

describe('sanity check', function () {
  this.timeout(20000)
  it('end-to-end', function (done) {
    var base = '/base/test/www/'
    var iframe = null
    loadIframe(base)
    .then(elem => {
      // register the service worker in the iframe and wait for it to activate
      iframe = elem
      iframe.contentWindow.navigator.serviceWorker.register(base + 'planktos.sw.js')
      return iframe.contentWindow.navigator.serviceWorker.ready
    })
    .then(() => new Promise(function (resolve) {
      // refresh the iframe and wait for the page to be loaded
      iframe.onload = function () {
        resolve()
      }
      iframe.contentWindow.location.reload()
    }))
    .then(() => planktos.getFileBlob('foobar.txt'))
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'foobar\n')
      return iframe.contentWindow.fetch(base + 'foobar.txt')
    })
    .then(resp => resp.text())
    .then(text => {
      assert.equal(text, 'foobar\n')
      return planktos.getFileBlob('/foo/')
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'bar\n')
      return planktos.getFileBlob('/foo')
    })
    .then(blob => blobToText(blob))
    .then(text => {
      assert.equal(text, 'bar\n')
      done()
    })
    .catch(err => done(err))
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
