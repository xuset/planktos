#!/usr/bin/env node

module.exports = setup

/* eslint no-path-concat: "off" */

var fs = require('fs')
var path = require('path')
var parallelLimit = require('run-parallel-limit')
var crypto = require('crypto')
var createTorrent = require('create-torrent')
var minimist = require('minimist')

var RESERVED_DIR = 'planktos'

function copyLib (rootDir) {
  rootDir = absPath(rootDir)
  var dstDir = rootDir + '/' + RESERVED_DIR
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
  var dstDir = rootDir + '/' + RESERVED_DIR

  if (includes.find(f => !isNested(rootDir, f))) {
    throw new Error('Included files must be inside the root directory')
  }

  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)

  copyAsHash(rootDir, includes, dstDir, function (err, mappings) {
    if (err) throw err

    var torrentFiles = mappings.map(e => e.dst)

    // Note that the options should include the name of the file if only one was specified
    var opts = {
      urlList: webseedUrls,
      name: torrentFiles.length == 1 ? torrentFiles[0] : RESERVED_DIR
    }

    createTorrent(torrentFiles, opts, function (err, torrent) {
      if (err) throw err

      copyLib(rootDir)
      fs.writeFileSync(dstDir + '/root.torrent', torrent)
      writeManifest(rootDir, dstDir, mappings)
    })
  })
}

function writeManifest (srcDir, dstDir, mappings) {
  var relMappings = {}
  for (var map of mappings) {
    relMappings[map.src.substr(srcDir.length + 1)] = map.dst.substr(dstDir.length + 1)
  }
  var buff = new Buffer(JSON.stringify(relMappings))
  fs.writeFileSync(dstDir + '/manifest.json', buff)
}

function copyAsHash (rootDir, srcList, dstDir, cb) {
  var files = []

  for (var item of srcList) {
    files = files.concat(walk(item).filter(f => !isNested(dstDir, f)))
  }

  var tasks = files.map(fname => {
    return function (cc) { copyFileAsHash(fname, dstDir, cc) }
  })
  parallelLimit(tasks, 2, cb)
}

function getHash (src, cb) {
  var hash = crypto.createHash('sha1')
  var stream = fs.createReadStream(src)

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
    var dstFile = dstDir + '/' + hash
    copyFile(srcFile, dstFile, 'wx', function (err) {
      if (err) cb(err)
      else cb(null, {src: srcFile, dst: dstFile})
    })
  })
}

function copyFile (srcFile, dstFile, flags, cb) {
  if (typeof flags === 'function') return copyFile(srcFile, dstFile, null, flags)
  if (!cb) cb = noop
  var read = fs.createReadStream(srcFile)
  var write = fs.createWriteStream(dstFile, {flags: flags})

  console.log('COPY', srcFile, '->', dstFile)

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
  var files = []
  filelist = filelist || []
  try {
    files = fs.readdirSync(dir)
  } catch (err) {
    if (err.errno === -20) filelist.push(dir) // ENOTDIR - dir is a file
    else throw err
  }

  for (var file of files) {
    var name = dir + '/' + file
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
  var argv = minimist(process.argv.slice(2), {
    alias: {
      h: 'help',
      r: 'root',
      w: 'webseed',
      c: 'copy-only'
    },
    boolean: [
      'copy-only'
    ]
  })
  if (argv.help) {
    printHelp()
    process.exit(0)
  }
  var rootDir = argv.root || process.cwd()
  var includes = argv['_'].length === 0 ? [rootDir] : argv['_']
  var webseedUrls = argv.webseed

  if (argv['lib-only']) copyLib(rootDir)
  else setup(rootDir, includes, webseedUrls)
}
