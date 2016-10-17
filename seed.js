#!/usr/bin/env node

var WebTorrent = require('webtorrent-hybrid')
var client = new WebTorrent()

client.seed('./www/', function (torrent) {
  console.log('Client is seeding ' + torrent.magnetURI)
})
