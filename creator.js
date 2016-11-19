#!/usr/bin/env node
'use strict'

module.exports = create

var fs = require('fs')
var path = require('path')
var parallelLimit = require('run-parallel-limit')
var crypto = require('crypto')
var createTorrent = require('create-torrent')
var minimist = require('minimist')

function create (rootDir, includes, webseedUrls) {
  rootDir = absPath(rootDir)
  includes = includes.map(p => absPath(p))
  var dstDir = rootDir + '/torrent'

  copy(rootDir, includes, dstDir, function (err, mappings) {
    if (err) throw err

    var opts = {
      urlList: webseedUrls
    }

    createTorrent(dstDir, opts, function (err, torrent) {
      if (err) throw err
      fs.writeFileSync(rootDir + '/root.torrent', torrent)
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
  fs.writeFileSync(srcDir + '/planktos.manifest.json', buff)
}

function copy (rootDir, srcList, dstDir, cb) {
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)
  var files = []

  for (var item of srcList) {
    var ignore = [dstDir, item + '/root.torrent']
    walk(item, ignore, files) // populates files
  }

  var tasks = files.map(fname => {
    return function (cc) { copyFile(fname, dstDir, cc) }
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

function copyFile (srcFile, dstDir, cb) {
  getHash(srcFile, function (err, hash) {
    if (err) return cb(err)
    var dstFile = dstDir + '/' + hash
    console.log('COPY', srcFile, '->', dstFile)
    var result = {src: srcFile, dst: dstFile}
    // return setTimeout(cb, 0, null, result)
    var read = fs.createReadStream(srcFile)
    var write = fs.createWriteStream(dstFile, {flags: 'wx'})

    read.on('error', function (err) {
      cb(err)
    })
    read.on('end', function () {
      cb(null, result)
    })
    write.on('error', function (err) {
      if (err.errno === -17) cb(null, result) // EEXIST: file already exists
      else cb(err)
    })

    read.pipe(write)
  })
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

if (require.main === module) {
  var argv = minimist(process.argv.slice(2))
  var rootDir = argv.s || process.cwd()
  var includes = argv['_'].length === 0 ? [rootDir] : argv['_']
  var webseedUrls = argv.w
  create(rootDir, includes, webseedUrls)
}
