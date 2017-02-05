/* eslint-env mocha */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const parseTorrent = require('parse-torrent-file')
const path = require('path')
const setup = require('../bin/setup.js')

describe('sanity', function () {
  const pathToContents = {
    'foo.txt': 'foo',
    'dir/nested.txt': 'nested'
  }

  it('happy path', function (done) {
    let rootDir = tmpDir()

    createTestDir(rootDir, pathToContents, function (pathToHash) {
      setup.setup(rootDir, [rootDir], function (err) {
        assert(err == null, err)

        const makeAbs = (relPath) => path.normalize(rootDir + '/' + relPath)
        const getContents = (relPath) => fs.readFileSync(makeAbs(relPath))

        let manifest = JSON.parse(getContents('planktos/manifest.json').toString())

        Object.keys(manifest).forEach((relPath) => {
          assert.equal(manifest[relPath], pathToHash[relPath])
        })

        checkTorrent(rootDir, pathToContents, pathToHash)

        assert(getContents('/planktos/files/' + pathToHash['foo.txt']).equals(new Buffer(pathToContents['foo.txt'])))
        assert(getContents('/planktos/files/' + pathToHash['dir/nested.txt']).equals(new Buffer(pathToContents['dir/nested.txt'])))
        assert.notEqual(getContents('/planktos/install.js').length, 0)
        assert.notEqual(getContents('/planktos/planktos.min.js').length, 0)
        assert.notEqual(getContents('/planktos.sw.js').length, 0)

        done()
      })
    })
  })
})

describe('single file torrent', function () {
  const pathToContents = {
    'foo.txt': 'foobar'
  }

  it('validate', function (done) {
    let rootDir = tmpDir()

    createTestDir(rootDir, pathToContents, function (pathToHash) {
      setup.setup(rootDir, [rootDir], function (err) {
        assert(err == null, err)

        const makeAbs = (relPath) => path.normalize(rootDir + '/' + relPath)
        const getContents = (relPath) => fs.readFileSync(makeAbs(relPath))

        let manifest = JSON.parse(getContents('planktos/manifest.json').toString())

        Object.keys(manifest).forEach((relPath) => {
          assert(manifest[relPath] === pathToHash[relPath])
        })

        checkTorrent(rootDir, pathToContents, pathToHash)

        assert(getContents('/planktos/files/' + pathToHash['foo.txt']).equals(new Buffer(pathToContents['foo.txt'])))
        assert.notEqual(getContents('/planktos/install.js').length, 0)
        assert.notEqual(getContents('/planktos/planktos.min.js').length, 0)
        assert.notEqual(getContents('/planktos.sw.js').length, 0)

        done()
      })
    })
  })
})

/********************/
/* HELPER FUNCTIONS */
/********************/

function checkTorrent (rootDir, pathToContents, pathToHash) {
  const torrentMetaPath = rootDir + '/planktos/root.torrent'
  const torrentMeta = parseTorrent(fs.readFileSync(torrentMetaPath))
  const orderedRelFiles = Object.keys(pathToContents).sort()
  const isSingleFileTorrent = torrentMeta.files.length === 1

  // If the torrent is a single file torrent its name should be the hash of the first file
  assert.equal(torrentMeta.name, (!isSingleFileTorrent) ? 'planktos/files' : pathToHash[Object.keys(pathToHash)[0]])
  assert.notEqual(torrentMeta.announce.length, 0)

  assert.deepEqual(
    torrentMeta.files.map((f) => f.name),
    orderedRelFiles.map((relFile) => pathToHash[relFile])
  )
  assert.deepEqual(
    torrentMeta.files.map((f) => f.path),
    orderedRelFiles.map((relFile) => {
      if (!isSingleFileTorrent) return 'planktos/files/' + pathToHash[relFile]
      else return pathToHash[relFile]
    })
  )
  assert.deepEqual(
    torrentMeta.files.map((f) => f.length),
    orderedRelFiles.map((relFile) => pathToContents[relFile].length)
  )
  assert.deepEqual(
    torrentMeta.files.map((f) => f.offset),
    orderedRelFiles.reduce((acc, relFile) => {
      acc.push(pathToContents[relFile].length + acc.slice(-1)[0])
      return acc
    }, [0]).slice(0, -1)
  )
  // Check that the info hash is valid
  assert(torrentMeta.infoHash.length === 40)
}

// Creates a test directory using a schema => {path: buffer}
function createTestDir (rootDir, schema, cb) {
  let promises = []

  Object.keys(schema).forEach((relPath) => {
    const absPath = path.normalize(rootDir + '/' + relPath)
    const filename = absPath.substring(absPath.lastIndexOf(path.sep) + 1)
    const fileContents = schema[relPath]

    // Create the files on disk
    absPath.split(path.sep).map((next) => {
      if (next === '') return
      let curPath = absPath.substring(0, absPath.indexOf(next) + next.length)

      if (!fs.existsSync(curPath)) {
        if (next === filename) fs.writeFileSync(curPath, fileContents)
        else fs.mkdirSync(curPath)
      }

      return curPath
    })

    // Populate the dictionary
    promises.push(new Promise((resolve, reject) => {
      setup.getHash(absPath, (err, hashDigest) => {
        if (err) reject(err)
        // Return the relative path and the hash digest
        resolve([
          absPath.substring(absPath.indexOf(rootDir) + rootDir.length + 1),
          hashDigest
        ])
      })
    }))
  })

  Promise.all(promises).then((values) => {
    let pathToHash = {}
    values.forEach((val) => {
      let [relPath, hash] = val
      pathToHash[relPath] = hash
    })

    cb(pathToHash)
  })
}

function tmpDir () {
  let tmpDirPath = os.tmpDir() + '/' + Math.random().toString(16).substr(2)
  fs.mkdirSync(tmpDirPath)
  return tmpDirPath
}
