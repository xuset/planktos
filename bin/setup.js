#!/usr/bin/env node

module.exports = setup

var fs = require('fs')
var path = require('path')
var parallelLimit = require('run-parallel-limit')
var crypto = require('crypto')
var createTorrent = require('create-torrent')
var minimist = require('minimist')

var RESERVED_DIR = 'planktos'

function setup (rootDir, includes, webseedUrls) {
  rootDir = absPath(rootDir)
  includes = includes.map(p => absPath(p))
  var dstDir = rootDir + '/' + RESERVED_DIR

  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)

  copyAsHash(rootDir, includes, dstDir, function (err, mappings) {
    if (err) throw err

    var opts = {
      urlList: webseedUrls,
      name: RESERVED_DIR
    }

    var torrentFiles = mappings.map(e => e.dst)
    createTorrent(torrentFiles, opts, function (err, torrent) {
      if (err) throw err

      copyFile(path.join(__dirname, '../injection.html'), path.join(dstDir, 'injection.html'))
      copyFile(path.join(__dirname, '../injection.bundle.js'), path.join(dstDir, 'injection.bundle.js'))
      copyFile(path.join(__dirname, '../install.js'), path.join(dstDir, 'install.js'))
      copyFile(path.join(__dirname, '../sw.bundle.js'), path.join(rootDir, 'planktos.sw.js'))
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
  // console.log('MANIFEST', mappings, relMappings)
  var buff = new Buffer(JSON.stringify(relMappings))
  fs.writeFileSync(dstDir + '/manifest.json', buff)
}

function copyAsHash (rootDir, srcList, dstDir, cb) {
  var files = []

  for (var item of srcList) {
    var ignore = [dstDir]
    walk(item, ignore, files) // populates files
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

function walk (dir, ignore, filelist) {
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
    if (ignore.indexOf(name) !== -1) continue
    if (fs.statSync(name).isDirectory()) {
      walk(name, ignore, filelist)
    } else {
      filelist.push(name)
    }
  }
  return filelist
}

function absPath (fpath) {
  return path.isAbsolute(fpath) ? fpath : process.cwd() + '/' + fpath
}

function noop () {
  // does nothing
}

if (require.main === module) {
  var argv = minimist(process.argv.slice(2))
  var rootDir = argv.s || process.cwd()
  var includes = argv['_'].length === 0 ? [rootDir] : argv['_']
  var webseedUrls = argv.w
  if (!webseedUrls) {
    console.error('Must specify at least one web server using -w')
    process.exit(1)
  }
  setup(rootDir, includes, webseedUrls)
}
