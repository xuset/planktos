'use strict'

let fs = require('fs')
let path = require('path')
let parallelLimit = require('run-parallel-limit')
let crypto = require('crypto')
let createTorrent = require('create-torrent')
let argv = require('minimist')(process.argv.slice(2))

function writeManifest (srcDir, dstDir, mappings) {
  var relMappings = {}
  for (let map of mappings) {
    relMappings[map.src.substr(srcDir.length + 1)] = map.dst.substr(dstDir.length + 1)
  }

  var buff = new Buffer(JSON.stringify(relMappings))
  fs.writeFileSync(srcDir + '/planktos.manifest.json', buff)
}

function copy (rootDir, srcList, dstDir, cb) {
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)
  let files = []

  for (let item of srcList) {
    let ignore = [dstDir, item + '/root.torrent']
    walk(item, ignore, files) // populates files
  }

  let tasks = files.map(fname => {
    return function (cc) { copyFile(fname, dstDir, cc) }
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

function copyFile (srcFile, dstDir, cb) {
  getHash(srcFile, function (err, hash) {
    if (err) return cb(err)
    let dstFile = dstDir + '/' + hash
    console.log('COPY', srcFile, '->', dstFile)
    let read = fs.createReadStream(srcFile)
    let write = fs.createWriteStream(dstFile, {flags: 'wx'})
    let result = {src: srcFile, dst: dstFile}

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
  let files = []
  filelist = filelist || []
  try {
    files = fs.readdirSync(dir)
  } catch (err) {
    if (err.errno === -20) filelist.push(dir) // ENOTDIR - dir is a file
    else throw err
  }

  for (let file of files) {
    let name = dir + '/' + file
    if (ignore.indexOf(name) !== -1) continue
    if (fs.statSync(name).isDirectory()) {
      walk(name, ignore, filelist)
    } else {
      filelist.push(name)
    }
  }
  return filelist
}

(function () {
  let rootDir = argv.s || process.cwd()
  let dstDir = argv.o || rootDir + '/torrent'
  let includes = argv._
  if (includes.length === 0) includes.push(rootDir)
  let webseedUrls = argv.w
  if (webseedUrls && !Array.isArray(webseedUrls)) webseedUrls = [ webseedUrls ]
  if (!webseedUrls) webseedUrls = []

  for (let i = 0; i < includes.length; i++) {
    if (!path.isAbsolute(includes[i])) includes[i] = process.cwd() + '/' + includes[i]
  }

  copy(rootDir, includes, dstDir, function (err, mappings) {
    if (err) throw err

    let opts = {
      urlList: webseedUrls
    }

    createTorrent(dstDir, opts, function (err, torrent) {
      if (err) throw err
      fs.writeFileSync(rootDir + '/root.torrent', torrent)
      writeManifest(rootDir, dstDir, mappings)
    })
  })
})()
