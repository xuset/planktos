#!/usr/bin/env node

var fs = require('fs')
var WebTorrent = require('webtorrent-hybrid')
var client = new WebTorrent()

var files = [
  './www/bootstrap.min.css',
  './www/universe.png',
  './www/index.html'
]

client.seed(files, function (torrent) {
  console.log('Client is seeding ' + torrent.magnetURI, torrent.files.map(f => f.name))
  fs.writeFile('./www/root.torrent', torrent.torrentFile, function (err) {
    if (err) throw err
  })
})
