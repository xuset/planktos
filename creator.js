"use strict"

let fs = require('fs')
let parallelLimit = require('run-parallel-limit')
let crypto = require('crypto')
let createTorrent = require('create-torrent')
let argv = require('minimist')(process.argv.slice(2))

function genTorrentDir (srcDir, dstDir, opts) {
  copy(srcDir, dstDir, function (err, results) {
    if (err) throw err
    createTorrent(dstDir, opts, function (err, torrent) {
      if (err) throw err
      fs.writeFile(srcDir + '/root.torrent', torrent)
    })
  })
}

function copy (srcDir, dstDir, cb) {
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir)

  let ignore = [dstDir, srcDir + '/root.torrent']
  let files = walk(srcDir, ignore)
  let tasks = files.map(fname => {
    return function(cc) { copyFile(fname, dstDir, cc) }
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

    read.on('error', function (err) {
      cb(err)
    })
    read.on('end', function (err) {
      cb(null)
    })
    write.on('error', function (err) {
      if (err.errno === -17) cb(null) // EEXIST: file already exists
      else cb(err)
    })

    read.pipe(write)
  })
}

function walk (dir, ignore, filelist) {
  let files = fs.readdirSync(dir)
  filelist = filelist || []

  for (let file of files) {
    let name = dir + '/' + file
    if (ignore.indexOf(name) !== -1) continue
    if (fs.statSync(name).isDirectory()) {
      walk(name, ignore, filelist)
    }
    else {
      filelist.push(name)
    }
  }
  return filelist
}

(function () {
  let siteRoot = argv.s || process.cwd()
  let outputDir = argv.o || siteRoot + '/torrent'
  let webseedUrls = argv.w
  if (webseedUrls && !Array.isArray(webseedUrls)) webseedUrls = [ webseedUrls ]
  if (!webseedUrls) webseedUrls = []

  let opts = {
    urlList: webseedUrls
  }
  
  genTorrentDir(siteRoot, outputDir, opts)
})()
