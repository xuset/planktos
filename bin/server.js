#!/usr/bin/env node

var express = require('express')
var minimist = require('minimist')
var path = require('path')

var argv = minimist(process.argv.slice(2))
var app = express()

var root = argv['_'][0] || process.cwd()
var port = argv.p || 8080

if (!path.isAbsolute(root)) root = process.cwd() + '/' + root

app.use(express.static(root))


app.listen(port, function () {
  console.log('Serving', root, 'on port', port)
})
