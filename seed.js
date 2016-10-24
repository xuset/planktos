#!/usr/bin/env node

var WebTorrent = require('webtorrent-hybrid')
var client = new WebTorrent()

var files = [
  './www/bootstrap.min.css',
  './www/image.jpg',
  './www/index.html',
  './www/style.css'
]

client.seed(files, function (torrent) {
  console.log('Client is seeding ' + torrent.magnetURI)
})
