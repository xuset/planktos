#!/usr/bin/env node

module.exports = setup

/* eslint no-path-concat: "off" */

const createTorrent = require('create-torrent')
const crypto = require('crypto')
const fs = require('fs')
const minimist = require('minimist')
const parallelLimit = require('run-parallel-limit')
const path = require('path')

const RESERVED_DIR = 'planktos'

function copyLib (rootDir) {
  rootDir = absPath(rootDir)
  const dstDir = rootDir + '/' + RESERVED_DIR
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)
  copyFile(__dirname + '/../install.js', dstDir + '/install.js')
  copyFile(__dirname + '/../build/planktos.min.js', dstDir + '/planktos.min.js')
  copyFile(__dirname + '/../build/planktos.min.js.map', dstDir + '/planktos.min.js.map')
  copyFile(__dirname + '/../build/planktos.sw.min.js', rootDir + '/planktos.sw.min.js')
  copyFile(__dirname + '/../build/planktos.sw.min.js.map', rootDir + '/planktos.sw.min.js.map')
}

function setup (rootDir, includes, webseedUrls) {
  rootDir = absPath(rootDir)
  includes = includes.map(p => absPath(p))
  const dstDir = rootDir + '/' + RESERVED_DIR

  if (includes.find(f => !isNested(rootDir, f))) {
    throw new Error('Included files must be inside the root directory')
  }

  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)

  copyAsHash(rootDir, includes, dstDir, function (err, mappings) {
    if (err) throw err

    let torrentFiles = mappings.map(e => absPath(e.dst))

    // From BitTorrent Documentation: "In the single file case, the name key is the name of
    // a file, in the multiple file case, it's the name of a directory."
    let opts = {
      urlList: webseedUrls,
      name: torrentFiles.length === 1 ? '/planktos/' + torrentFiles[0].slice(torrentFiles[0].lastIndexOf('/') + 1) : RESERVED_DIR
    }

    createTorrent(torrentFiles, opts, function (err, torrent) {
      if (err) throw err

      copyLib(rootDir)
      fs.writeFileSync(dstDir + '/root.torrent', torrent)
      writeManifest(rootDir, dstDir, mappings)
      console.error('Successfully created torrent')
    })
  })
}

function writeManifest (srcDir, dstDir, mappings) {
  let relMappings = {}
  for (let map of mappings) {
    relMappings[map.src.substr(srcDir.length + 1)] = map.dst.substr(dstDir.length + 1)
  }
  let buff = new Buffer(JSON.stringify(relMappings))
  fs.writeFileSync(dstDir + '/manifest.json', buff)
}

function copyAsHash (rootDir, srcList, dstDir, cb) {
  let files = []

  for (let item of srcList) {
    files = files.concat(walk(item).filter(f => !isNested(dstDir, f)))
  }

  let tasks = files.map(fname => {
    return function (cc) { copyFileAsHash(fname, dstDir, cc) }
  })
  parallelLimit(tasks, 2, cb)
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
    const dstFile = dstDir + '/' + hash
    copyFile(srcFile, dstFile, 'wx', function (err) {
      if (err) cb(err)
      else cb(null, {src: srcFile, dst: dstFile})
    })
  })
}

function copyFile (srcFile, dstFile, flags, cb) {
  if (typeof flags === 'function') return copyFile(srcFile, dstFile, null, flags)
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
  console.error(process.argv[1], '[options] [file or directory...]')
  console.error('')
  console.error('Copies the planktos files into the current working directory and packages the given files and directories into a torrent.')
  console.error('')
  console.error('-r,--root DIR      root directory. All given files and directories must be descendents of the root. Default: cwd')
  console.error('-w,--webseed URL   web seed url to include in the generated torrent. Default: none')
  console.error('-l,--lib-only      only copy the planktos library and service worker. This does not generate the torrent')
}

if (require.main === module) {
  const argv = minimist(process.argv.slice(2), {
    alias: {
      h: 'help',
      r: 'root',
      w: 'webseed',
      l: 'lib-only'
    },
    boolean: [
      'lib-only'
    ]
  })
  if (argv.help) {
    printHelp()
    process.exit(0)
  }
  const rootDir = argv.root || process.cwd()
  const includes = argv['_'].length === 0 ? [rootDir] : argv['_']
  const webseedUrls = argv.webseed

  if (argv['lib-only']) copyLib(rootDir)
  else setup(rootDir, includes, webseedUrls)
}
