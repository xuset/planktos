#!/usr/bin/env node

const express = require('express')
const minimist = require('minimist')
const path = require('path')

const argv = minimist(process.argv.slice(2))
let app = express()

let root = argv['_'][0] || process.cwd()
const port = argv.p || 8080

if (!path.isAbsolute(root)) root = process.cwd() + '/' + root

app.use(express.static(root))

app.listen(port, function () {
  console.log('Serving', root, 'on port', port)
})
