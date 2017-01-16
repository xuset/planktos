/* eslint-env mocha */

const os = require('os')
const fs = require('fs')
const assert = require('assert')
const parseTorrent = require('parse-torrent-file')
const setup = require('../bin/setup.js')

describe('sanity', function () {
  it('happy path', function (done) {
    /* fs layout
     *   - root
     *   | - foo.txt
     *   | - dir
     *   | | - nested.txt
     */

    let root = tmpDir()
    let fooPath = root + '/foo.txt'
    let fooBuffer = Buffer.from('foo')
    let fooHash = '0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33'

    let nestedPath = root + '/dir/nested.txt'
    let nestedBuffer = Buffer.from('nested')
    let nestedHash = 'b4b3e0a278988bc15f2913af3f4153ccef74e465'

    fs.writeFileSync(fooPath, fooBuffer)
    fs.mkdirSync(root + '/dir')
    fs.writeFileSync(nestedPath, nestedBuffer)

    setup(root, [root], function (err) {
      assert(err == null, err)
      let manifest = JSON.parse(fs.readFileSync(root + '/planktos/manifest.json').toString())
      let torrentMeta = parseTorrent(fs.readFileSync(root + '/planktos/root.torrent'))
      assert.deepEqual(manifest, {
        'foo.txt': fooHash,
        'dir/nested.txt': nestedHash
      })
      assert.equal(torrentMeta.infoHash, 'a8643993aafc786c6d263a3b2f6b30a731ddb6e1')
      assert.equal(torrentMeta.name, 'planktos')
      assert.notEqual(torrentMeta.announce.length, 0)
      assert.deepEqual(torrentMeta.files, [
        {
          path: 'planktos/b4b3e0a278988bc15f2913af3f4153ccef74e465',
          name: 'b4b3e0a278988bc15f2913af3f4153ccef74e465',
          length: 6,
          offset: 0
        },
        {
          path: 'planktos/0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33',
          name: '0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33',
          length: 3,
          offset: 6
        }
      ])
      assert(fs.readFileSync(root + '/planktos/' + fooHash).equals(fooBuffer))
      assert(fs.readFileSync(root + '/planktos/' + nestedHash).equals(nestedBuffer))
      assert.notEqual(fs.readFileSync(root + '/planktos/install.js').length, 0)
      assert.notEqual(fs.readFileSync(root + '/planktos/planktos.min.js').length, 0)
      assert.notEqual(fs.readFileSync(root + '/planktos.sw.min.js').length, 0)
      done()
    })
  })
})

function tmpDir () {
  let path = os.tmpDir() + '/' + Math.random().toString(16).substr(2)
  fs.mkdirSync(path)
  return path
}
