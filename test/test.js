var assert = require('assert')
var planktos = require('../')

describe('sanity check', function () {
  this.timeout(20000)
  it('update()', function (done) {
    var hash = null

    planktos.update('/base/test/www/')
    .then(() => planktos.getManifest())
    .then(manifest => {
      console.log('MANIFEST', manifest)
      hash = manifest['index.html']
      assert(hash != null)
      return planktos.getTorrentMeta()
    })
    .then(torrentMeta => {
      console.log('TORRENTMETA', torrentMeta)
      torrentMeta.files.forEach(f => console.log('FILE', f.name.toString()))
      assert(torrentMeta.files.find(f => f.name === hash) != null)
      done()
    })
    .catch(err => done(err))
  })
})

