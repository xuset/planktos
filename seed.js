#!/usr/bin/env node

var fs = require('fs')
var WebTorrent = require('webtorrent-hybrid')
var client = new WebTorrent()
var parseTorrent = require('parse-torrent-file')

var files = [
  './www/torrent/a',
  './www/torrent/b',
  './www/torrent/c'
]

client.seed(files, function (torrent) {
  console.log('Client is seeding ' + torrent.magnetURI, torrent.files.map(f => f.name))
  console.log('INFO', parseTorrent(torrent.torrentFile).info)
  console.log('WHOLE', parseTorrent(torrent.torrentFile))
  fs.writeFile('./www/root.torrent', torrent.torrentFile, function (err) {
    if (err) throw err
  })
})
