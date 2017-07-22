#!/usr/bin/env node

module.exports.setup = setup
module.exports.getHash = getHash

/* eslint no-path-concat: "off" */

const fs = require('fs')
const path = require('path')
const parallelLimit = require('run-parallel-limit')
const crypto = require('crypto')
const createTorrent = require('create-torrent')
const minimist = require('minimist')
const packageJson = require('../package.json')
const FS_CONCURRENCY = 2

const RESERVED_DIR = 'planktos'

function copyLib (rootDir, cb) {
  rootDir = absPath(rootDir)
  const dstDir = rootDir + '/' + RESERVED_DIR
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)
  const tasks = [
    [__dirname + '/../install.js', dstDir + '/install.js'],
    [__dirname + '/../build/planktos.min.js', dstDir + '/planktos.min.js'],
    [__dirname + '/../sw.js', rootDir + '/planktos.sw.js']
  ].map(t => { return cb => copyFile(t[0], t[1], cb) })
  parallelLimit(tasks, FS_CONCURRENCY, cb)
}

function setup (rootDir, includes, opts, cb) {
  if (typeof opts === 'function') return setup(rootDir, includes, null, opts)
  cb = cb || noop
  rootDir = absPath(rootDir)
  includes = includes.map(p => absPath(p))
  const dstDir = rootDir + '/' + RESERVED_DIR
  const filesDir = dstDir + '/files'
  if (!opts) opts = {}

  if (includes.find(f => !isNested(rootDir, f))) {
    return cb(new Error('Included files must be inside the root directory'))
  }

  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)
  if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir)

  copyAsHash(includes, dstDir, filesDir, function (err, mappings) {
    if (err) return cb(err)

    let torrentFiles = mappings.map(e => absPath(e.dst))

    // From BitTorrent Documentation: "In the single file case, the name key is the name of
    // a file, in the multiple file case, it's the name of a directory."
    opts.name = torrentFiles.length !== 1 ? RESERVED_DIR + '/files'
        : torrentFiles[0].slice(torrentFiles[0].lastIndexOf('/') + 1)

    createTorrent(torrentFiles, opts, function (err, torrent) {
      if (err) return cb(err)

      copyLib(rootDir, (err) => {
        if (err) return cb(err)

        fs.writeFileSync(dstDir + '/root.torrent', torrent)
        writeManifestSync(rootDir, dstDir, filesDir, mappings)
        cb(null)
      })
    })
  })
}

function writeManifestSync (srcDir, dstDir, filesDir, mappings) {
  let relMappings = {}
  for (let map of mappings) {
    relMappings[map.src.substr(srcDir.length + 1)] = map.dst.substr(filesDir.length + 1)
  }
  let buff = Buffer.from(JSON.stringify(relMappings))
  fs.writeFileSync(dstDir + '/manifest.json', buff)
}

function copyAsHash (srcList, dstDir, filesDir, cb) {
  let files = []

  for (let item of srcList) {
    files = files.concat(walk(item).filter(f => !isNested(dstDir, f)))
  }

  let tasks = files.map(fname => {
    return function (cc) { copyFileAsHash(fname, filesDir, cc) }
  })
  parallelLimit(tasks, FS_CONCURRENCY, cb)
}

function getHash (src, cb) {
  let hash = crypto.createHash('sha1')
  let stream = fs.createReadStream(src)

  stream.on('error', function (err) {
    cb(err)
  })

  stream.on('data', function (data) {
    hash.update(data, 'utf8')
  })

  stream.on('end', function () {
    cb(null, hash.digest('hex'))
  })
}

function copyFileAsHash (srcFile, dstDir, cb) {
  getHash(srcFile, function (err, hash) {
    if (err) return cb(err)
    const dstFile = dstDir + '/' + hash + '-' + path.basename(srcFile)
    copyFile(srcFile, dstFile, 'wx', function (err) {
      if (err) cb(err)
      else cb(null, {src: srcFile, dst: dstFile})
    })
  })
}

function copyFile (srcFile, dstFile, flags, cb) {
  if (typeof flags === 'function') return copyFile(srcFile, dstFile, undefined, flags)
  if (!cb) cb = noop
  let read = fs.createReadStream(srcFile)
  let write = fs.createWriteStream(dstFile, {flags: flags})

  read.on('error', function (err) {
    cb(err)
  })
  read.on('end', function () {
    cb(null)
  })
  write.on('error', function (err) {
    if (err.errno === -17) cb(null) // EEXIST: file already exists
    else cb(err)
  })

  read.pipe(write)
}

function walk (dir, filelist) {
  let files = []
  filelist = filelist || []
  try {
    files = fs.readdirSync(dir)
  } catch (err) {
    if (err.errno === -20) filelist.push(dir) // ENOTDIR - dir is a file
    else throw err
  }

  for (let file of files) {
    const name = dir + '/' + file
    if (fs.statSync(name).isDirectory()) {
      walk(name, filelist)
    } else {
      filelist.push(name)
    }
  }
  return filelist
}

function absPath (fpath) {
  return path.normalize(path.isAbsolute(fpath) ? fpath : process.cwd() + '/' + fpath)
}

function isNested (root, sub) {
  return absPath(sub + '/').startsWith(absPath(root + '/'))
}

function noop () {
  // does nothing
}

function printHelp () {
  let filename = process.argv[1].substr(1 + process.argv[1].lastIndexOf('/'))
  console.error(filename, '[options] [file or directory...]')
  console.error('')
  console.error('Copies the planktos files into the current working directory and packages the')
  console.error('given files and directories into a torrent.')
  console.error('')
  console.error('-r,--root DIR      root directory. All given files and directories must be')
  console.error('                   descendents of the root. Default: cwd')
  console.error('-w,--webseed URL   web seed url to include in the generated torrent.')
  console.error('                   Default: none')
  console.error('-l,--lib-only      only copy the planktos library and service worker. This')
  console.error('                   does not generate the torrent')
  console.error('-v,--version       print the version and exit')
}

if (require.main === module) {
  const argv = minimist(process.argv.slice(2), {
    alias: {
      h: 'help',
      r: 'root',
      w: 'webseed',
      l: 'lib-only',
      v: 'version'
    },
    boolean: [
      'lib-only',
      'version'
    ]
  })
  if (argv.help) {
    printHelp()
    process.exit(0)
  }
  const rootDir = argv.root || process.cwd()
  const includes = argv['_'].length === 0 ? [rootDir] : argv['_']
  const opts = {
    urlList: argv.webseed
  }

  if (argv['lib-only']) {
    copyLib(rootDir, function (err) {
      if (err) throw err
      console.log('Successfully copied lib')
    })
  } else if (argv.version) {
    console.log('v' + packageJson.version)
  } else {
    setup(rootDir, includes, opts, function (err) {
      if (err) throw err
      console.log('Successfully created torrent')
    })
  }
}
