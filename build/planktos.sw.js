(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (Buffer){
var global = typeof window !== 'undefined' ? window : self // eslint-disable-line

// Temp bug fix: https://github.com/srijs/rusha/issues/39
if (global.WorkerGlobalScope) delete global.FileReaderSync

var preCached = [
  '/planktos/root.torrent',
  '/planktos/manifest.json',
  '/planktos/planktos.js',
  '/planktos/install.js'
]

// TODO add getFileStream
module.exports.getFileBlob = getFileBlob
module.exports.update = update
module.exports.preCached = preCached // TODO better way to handle preCached
module.exports.getManifest = getManifest
module.exports.getDownloaded = getDownloaded
module.exports.getTorrentMeta = getTorrentMeta
module.exports.getTorrentMetaBuffer = getTorrentMetaBuffer
module.exports.downloader = require('./lib/downloader')

var ChunkStream = require('chunk-store-stream')
var IdbChunkStore = require('indexdb-chunk-store')
var IdbKvStore = require('idb-kv-store')
var toBlob = require('stream-to-blob')
var parseTorrent = require('parse-torrent-file')

var waitingFetches = {}
var persistent = new IdbKvStore('planktos')
var downloaded = new IdbKvStore('planktos-downloaded')
var chunkStore = null
var downloadChannel = null

function getDownloaded () {
  return downloaded.json()
}

function getManifest () {
  return persistent.get('manifest')
}

function getTorrentMeta () {
  return persistent.get('torrentMeta')
}

function getTorrentMetaBuffer () { // TODO Fix parsing bug so this can be removed
  return persistent.get('torrentMetaBuffer')
}

function getFileBlob (filePath) {
  if (typeof BroadcastChannel === 'undefined') throw new Error('No BroadcastChannel support')

  if (!downloadChannel) {
    downloadChannel = new BroadcastChannel('planktos-downloaded')
    downloadChannel.addEventListener('message', onDownload)
  }

  return persistent.get(['manifest', 'torrentMeta']).then(result => {
    var [manifest, torrentMeta] = result

    let getFilename = (filePath) => filePath.slice(filePath.lastIndexOf('/') + 1)
    let filePathIsDir = (filePath) => filePath.endsWith('/')
    let filenameHasExtension = (filename) => filename.indexOf('.') !== -1

    // Try to coerce extension-less files into directories
    if (!filePathIsDir(filePath) && !filenameHasExtension(getFilename(filePath))) {
      // Since directories are not stored in the manifest, we can only safely assume an extension-less
      // file is a diretory if (1) the file isn't in the manifest and (2) there are files which
      // are in subdirectories relative to the file path
      if (Object.keys(manifest).indexOf(filePath) === -1 &&
          Object.keys(manifest).find((fpath) => fpath.startsWith(filePath + '/'))) {
        filePath += '/'
      }
    }

    // Try to find an index file if `filePath` is a directory
    if (filePathIsDir(filePath)) {
      let filesInDirectory = Object.keys(manifest).filter(
        (fpath) => fpath.startsWith(filePath)
      ).map(getFilename)

      // Index files are listed in order of priority
      let indexFilename = ['index.html', 'index.htm'].find((fname) => filesInDirectory.includes(fname))

      if (indexFilename === undefined) throw new Error('File not found')

      filePath += indexFilename
    }

    var hash = manifest[filePath]
    var fileInfo = torrentMeta.files.find(f => f.name === hash)

    if (!fileInfo) {
      return Promise.reject(new Error('File not found'))
    }

    chunkStore = chunkStore || new IdbChunkStore(torrentMeta.pieceLength, {name: torrentMeta.infoHash})

    return downloaded.get(hash).then(isDownloaded => {
      if (isDownloaded) {
        var stream = ChunkStream.read(chunkStore, chunkStore.chunkLength, {
          length: torrentMeta.length
        })
        return new Promise(function (resolve, reject) {
          toBlob(stream, function (err, blob) {
            if (err) return reject(err)
            resolve(blob.slice(fileInfo.offset, fileInfo.offset + fileInfo.length))
          })
        })
      } else {
        // Defer until the file finishes downloading
        return new Promise(function (resolve) {
          if (!waitingFetches[hash]) waitingFetches[hash] = []
          waitingFetches[hash].push(resolve)
        })
      }
    })
  })
}

function update (url) {
  if (!url) url = ''
  if (url.endsWith('/')) url = url.substr(0, url.length - 1)

  var cachePromise = global.caches.open('planktos')
  .then((cache) => cache.addAll(preCached.map(f => url + f)))
  .then(() => global.caches.open('planktos'))

  var manifestPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/manifest.json'))
  .then(response => response.json())
  .then(json => {
    return persistent.set('manifest', json)
  })

  var torrentPromise = cachePromise
  .then(cache => cache.match(url + '/planktos/root.torrent'))
  .then(response => response.arrayBuffer())
  .then(arrayBuffer => {
    var buffer = Buffer.from(arrayBuffer)
    var parsed = parseTorrent(buffer)
    return Promise.all([
      persistent.set('torrentMetaBuffer', buffer),
      persistent.set('torrentMeta', parsed)
    ])
  })

  return Promise.all([
    manifestPromise,
    torrentPromise
  ])
}

function onDownload () {
  return Promise.all([
    persistent.get('manifest'),
    downloaded.json()
  ]).then(result => {
    var [manifest, downloaded] = result
    for (var hash in downloaded) {
      if (hash in waitingFetches) {
        var filePath = Object.keys(manifest).find(fname => manifest[fname] === hash)
        var waiters = waitingFetches[hash]
        delete waitingFetches[hash]
        getFileBlob(filePath)
        .then(b => {
          for (var p of waiters) {
            p(b)
          }
        })
      }
    }
  })
}

}).call(this,require("buffer").Buffer)

},{"./lib/downloader":2,"buffer":12,"chunk-store-stream":13,"idb-kv-store":21,"indexdb-chunk-store":23,"parse-torrent-file":29,"stream-to-blob":42}],2:[function(require,module,exports){
(function (Buffer){
module.exports.install = install

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:downloader')
var WebTorrent = require('webtorrent')
var IdbChunkStore = require('indexdb-chunk-store')
var IdbKvStore = require('idb-kv-store')

var webtorrent = null
var downloaded = null
var installed = false

function install () {
  if (typeof BroadcastChannel === 'undefined') throw new Error('No BroadcastChannel support')
  if (typeof navigator === 'undefined') throw new Error('must be called in a wep page')
  if (!navigator.serviceWorker) throw new Error('No servier worker support')
  if (installed) return

  installed = true
  navigator.serviceWorker.addEventListener('message', onMessage)
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  window.addEventListener('beforeunload', onBeforUnload)

  onControllerChange()
}

function onControllerChange () {
  if (!navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({
    type: 'available',
    planktos: true
  })
}

function onBeforUnload () {
  if (!navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({
    type: 'unavailable',
    planktos: true
  })
}

function onMessage (event) {
  if (!event.data.planktos) return
  debug('MESSAGE', event.data)
  if (event.data.type === 'download') {
    download(new Buffer(event.data.torrentId))
  } else if (event.data.type === 'request_availability') {
    navigator.serviceWorker.controller.postMessage({
      type: 'available',
      planktos: true
    })
  } else if (event.data.type === 'cancel_download') {
    if (webtorrent) webtorrent.destroy()
    webtorrent = null
  } else {
    throw new Error('Unknown type: ' + event.data.type)
  }
}

function download (torrentId) {
  downloaded = downloaded || new IdbKvStore('planktos-downloaded')
  webtorrent = webtorrent || new WebTorrent()

  var opts = {store: IdbChunkStore}
  webtorrent.add(torrentId, opts, function (torrent) {
    if (torrent.urlList.length === 0) {
      var swUrl = navigator.serviceWorker.controller.scriptURL
      torrent.addWebSeed(swUrl.substring(0, swUrl.lastIndexOf('/')))
    }
    torrent.on('done', function () {
      debug('TORRENT DOWNLOADED', torrent.files.map(f => f.name))
      var channel = new BroadcastChannel('planktos-downloaded')
      torrent.files.forEach(function (f) {
        downloaded.set(f.name, true)
        .then(() => channel.postMessage({ name: f.name }))
      })
    })
  })
}

}).call(this,require("buffer").Buffer)

},{"buffer":12,"debug":17,"idb-kv-store":21,"indexdb-chunk-store":23,"webtorrent":10}],3:[function(require,module,exports){
module.exports.iframe = `\
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style type="text/css">
    html {overflow: auto;}
    html, body, div, iframe {margin: 0px; padding: 0px; height: 100%; border: none;}
    iframe {display: block; width: 100%; border: none; overflow-y: auto; overflow-x: hidden;}
  </style>
</head>
<body>
  <iframe id="tree" name="tree" src="{{url}}" frameborder="0" marginheight="0" marginwidth="0" width="100%" height="100%" scrolling="auto"></iframe>
  <script src="{{scope}}/planktos/planktos.js"></script>
  <script>
    planktos.downloader.install()
  </script>
</body>
</html>
`

module.exports.docWrite = `\
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="{{scope}}/planktos/planktos.js"></script>
  <script>
    planktos.downloader.install()
    fetch('{{url}}')
    .then(resp => resp.text())
    .then(text => {
      document.documentElement.innerHTML = text
    })
  </script>
</head>
<body>
</body>
</html>
`

},{}],4:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function placeHoldersCount (b64) {
  var len = b64.length
  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  return b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0
}

function byteLength (b64) {
  // base64 is 4/3 + up to two characters of the original data
  return b64.length * 3 / 4 - placeHoldersCount(b64)
}

function toByteArray (b64) {
  var i, j, l, tmp, placeHolders, arr
  var len = b64.length
  placeHolders = placeHoldersCount(b64)

  arr = new Arr(len * 3 / 4 - placeHolders)

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len

  var L = 0

  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
    arr[L++] = (tmp >> 16) & 0xFF
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[L++] = tmp & 0xFF
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var output = ''
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    output += lookup[tmp >> 2]
    output += lookup[(tmp << 4) & 0x3F]
    output += '=='
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
    output += lookup[tmp >> 10]
    output += lookup[(tmp >> 4) & 0x3F]
    output += lookup[(tmp << 2) & 0x3F]
    output += '='
  }

  parts.push(output)

  return parts.join('')
}

},{}],5:[function(require,module,exports){
(function (Buffer){
/**
 * Decodes bencoded data.
 *
 * @param  {Buffer} data
 * @param  {Number} start (optional)
 * @param  {Number} end (optional)
 * @param  {String} encoding (optional)
 * @return {Object|Array|Buffer|String|Number}
 */
function decode (data, start, end, encoding) {
  if (typeof start !== 'number' && encoding == null) {
    encoding = start
    start = undefined
  }

  if (typeof end !== 'number' && encoding == null) {
    encoding = end
    end = undefined
  }

  decode.position = 0
  decode.encoding = encoding || null

  decode.data = !(Buffer.isBuffer(data))
    ? new Buffer(data)
    : data.slice(start, end)

  decode.bytes = decode.data.length

  return decode.next()
}

decode.bytes = 0
decode.position = 0
decode.data = null
decode.encoding = null

decode.next = function () {
  switch (decode.data[decode.position]) {
    case 0x64:
      return decode.dictionary()
    case 0x6C:
      return decode.list()
    case 0x69:
      return decode.integer()
    default:
      return decode.buffer()
  }
}

decode.find = function (chr) {
  var i = decode.position
  var c = decode.data.length
  var d = decode.data

  while (i < c) {
    if (d[i] === chr) return i
    i++
  }

  throw new Error(
    'Invalid data: Missing delimiter "' +
    String.fromCharCode(chr) + '" [0x' +
    chr.toString(16) + ']'
  )
}

decode.dictionary = function () {
  decode.position++

  var dict = {}

  while (decode.data[decode.position] !== 0x65) {
    dict[decode.buffer()] = decode.next()
  }

  decode.position++

  return dict
}

decode.list = function () {
  decode.position++

  var lst = []

  while (decode.data[decode.position] !== 0x65) {
    lst.push(decode.next())
  }

  decode.position++

  return lst
}

decode.integer = function () {
  var end = decode.find(0x65)
  var number = decode.data.toString('ascii', decode.position + 1, end)

  decode.position += end + 1 - decode.position

  return parseInt(number, 10)
}

decode.buffer = function () {
  var sep = decode.find(0x3A)
  var length = parseInt(decode.data.toString('ascii', decode.position, sep), 10)
  var end = ++sep + length

  decode.position = end

  return decode.encoding
    ? decode.data.toString(decode.encoding, sep, end)
    : decode.data.slice(sep, end)
}

module.exports = decode

}).call(this,require("buffer").Buffer)

},{"buffer":12}],6:[function(require,module,exports){
(function (Buffer){
/**
 * Encodes data in bencode.
 *
 * @param  {Buffer|Array|String|Object|Number|Boolean} data
 * @return {Buffer}
 */
function encode (data, buffer, offset) {
  var buffers = []
  var result = null

  encode._encode(buffers, data)
  result = Buffer.concat(buffers)
  encode.bytes = result.length

  if (Buffer.isBuffer(buffer)) {
    result.copy(buffer, offset)
    return buffer
  }

  return result
}

encode.bytes = -1
encode._floatConversionDetected = false

encode._encode = function (buffers, data) {
  if (Buffer.isBuffer(data)) {
    buffers.push(new Buffer(data.length + ':'))
    buffers.push(data)
    return
  }

  switch (typeof data) {
    case 'string':
      encode.buffer(buffers, data)
      break
    case 'number':
      encode.number(buffers, data)
      break
    case 'object':
      data.constructor === Array
        ? encode.list(buffers, data)
        : encode.dict(buffers, data)
      break
    case 'boolean':
      encode.number(buffers, data ? 1 : 0)
      break
  }
}

var buffE = new Buffer('e')
var buffD = new Buffer('d')
var buffL = new Buffer('l')

encode.buffer = function (buffers, data) {
  buffers.push(new Buffer(Buffer.byteLength(data) + ':' + data))
}

encode.number = function (buffers, data) {
  var maxLo = 0x80000000
  var hi = (data / maxLo) << 0
  var lo = (data % maxLo) << 0
  var val = hi * maxLo + lo

  buffers.push(new Buffer('i' + val + 'e'))

  if (val !== data && !encode._floatConversionDetected) {
    encode._floatConversionDetected = true
    console.warn(
      'WARNING: Possible data corruption detected with value "' + data + '":',
      'Bencoding only defines support for integers, value was converted to "' + val + '"'
    )
    console.trace()
  }
}

encode.dict = function (buffers, data) {
  buffers.push(buffD)

  var j = 0
  var k
  // fix for issue #13 - sorted dicts
  var keys = Object.keys(data).sort()
  var kl = keys.length

  for (; j < kl; j++) {
    k = keys[j]
    encode.buffer(buffers, k)
    encode._encode(buffers, data[k])
  }

  buffers.push(buffE)
}

encode.list = function (buffers, data) {
  var i = 0
  var c = data.length
  buffers.push(buffL)

  for (; i < c; i++) {
    encode._encode(buffers, data[i])
  }

  buffers.push(buffE)
}

module.exports = encode

}).call(this,require("buffer").Buffer)

},{"buffer":12}],7:[function(require,module,exports){
var bencode = module.exports

bencode.encode = require('./encode')
bencode.decode = require('./decode')

/**
 * Determines the amount of bytes
 * needed to encode the given value
 * @param  {Object|Array|Buffer|String|Number|Boolean} value
 * @return {Number} byteCount
 */
bencode.byteLength = bencode.encodingLength = function (value) {
  return bencode.encode(value).length
}

},{"./decode":5,"./encode":6}],8:[function(require,module,exports){
(function (Buffer){
var inherits = require('inherits');
var Transform = require('readable-stream').Transform;
var defined = require('defined');

module.exports = Block;
inherits(Block, Transform);

function Block (size, opts) {
    if (!(this instanceof Block)) return new Block(size, opts);
    Transform.call(this);
    if (!opts) opts = {};
    if (typeof size === 'object') {
        opts = size;
        size = opts.size;
    }
    this.size = size || 512;
    
    if (opts.nopad) this._zeroPadding = false;
    else this._zeroPadding = defined(opts.zeroPadding, true);
    
    this._buffered = [];
    this._bufferedBytes = 0;
}

Block.prototype._transform = function (buf, enc, next) {
    this._bufferedBytes += buf.length;
    this._buffered.push(buf);
    
    while (this._bufferedBytes >= this.size) {
        var b = Buffer.concat(this._buffered);
        this._bufferedBytes -= this.size;
        this.push(b.slice(0, this.size));
        this._buffered = [ b.slice(this.size, b.length) ];
    }
    next();
};

Block.prototype._flush = function () {
    if (this._bufferedBytes && this._zeroPadding) {
        var zeroes = new Buffer(this.size - this._bufferedBytes);
        zeroes.fill(0);
        this._buffered.push(zeroes);
        this.push(Buffer.concat(this._buffered));
        this._buffered = null;
    }
    else if (this._bufferedBytes) {
        this.push(Buffer.concat(this._buffered));
        this._buffered = null;
    }
    this.push(null);
};

}).call(this,require("buffer").Buffer)

},{"buffer":12,"defined":19,"inherits":24,"readable-stream":39}],9:[function(require,module,exports){

},{}],10:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],11:[function(require,module,exports){
(function (global){
'use strict';

var buffer = require('buffer');
var Buffer = buffer.Buffer;
var SlowBuffer = buffer.SlowBuffer;
var MAX_LEN = buffer.kMaxLength || 2147483647;
exports.alloc = function alloc(size, fill, encoding) {
  if (typeof Buffer.alloc === 'function') {
    return Buffer.alloc(size, fill, encoding);
  }
  if (typeof encoding === 'number') {
    throw new TypeError('encoding must not be number');
  }
  if (typeof size !== 'number') {
    throw new TypeError('size must be a number');
  }
  if (size > MAX_LEN) {
    throw new RangeError('size is too large');
  }
  var enc = encoding;
  var _fill = fill;
  if (_fill === undefined) {
    enc = undefined;
    _fill = 0;
  }
  var buf = new Buffer(size);
  if (typeof _fill === 'string') {
    var fillBuf = new Buffer(_fill, enc);
    var flen = fillBuf.length;
    var i = -1;
    while (++i < size) {
      buf[i] = fillBuf[i % flen];
    }
  } else {
    buf.fill(_fill);
  }
  return buf;
}
exports.allocUnsafe = function allocUnsafe(size) {
  if (typeof Buffer.allocUnsafe === 'function') {
    return Buffer.allocUnsafe(size);
  }
  if (typeof size !== 'number') {
    throw new TypeError('size must be a number');
  }
  if (size > MAX_LEN) {
    throw new RangeError('size is too large');
  }
  return new Buffer(size);
}
exports.from = function from(value, encodingOrOffset, length) {
  if (typeof Buffer.from === 'function' && (!global.Uint8Array || Uint8Array.from !== Buffer.from)) {
    return Buffer.from(value, encodingOrOffset, length);
  }
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number');
  }
  if (typeof value === 'string') {
    return new Buffer(value, encodingOrOffset);
  }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    var offset = encodingOrOffset;
    if (arguments.length === 1) {
      return new Buffer(value);
    }
    if (typeof offset === 'undefined') {
      offset = 0;
    }
    var len = length;
    if (typeof len === 'undefined') {
      len = value.byteLength - offset;
    }
    if (offset >= value.byteLength) {
      throw new RangeError('\'offset\' is out of bounds');
    }
    if (len > value.byteLength - offset) {
      throw new RangeError('\'length\' is out of bounds');
    }
    return new Buffer(value.slice(offset, offset + len));
  }
  if (Buffer.isBuffer(value)) {
    var out = new Buffer(value.length);
    value.copy(out, 0, 0, value.length);
    return out;
  }
  if (value) {
    if (Array.isArray(value) || (typeof ArrayBuffer !== 'undefined' && value.buffer instanceof ArrayBuffer) || 'length' in value) {
      return new Buffer(value);
    }
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return new Buffer(value.data);
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ' + 'ArrayBuffer, Array, or array-like object.');
}
exports.allocUnsafeSlow = function allocUnsafeSlow(size) {
  if (typeof Buffer.allocUnsafeSlow === 'function') {
    return Buffer.allocUnsafeSlow(size);
  }
  if (typeof size !== 'number') {
    throw new TypeError('size must be a number');
  }
  if (size >= MAX_LEN) {
    throw new RangeError('size is too large');
  }
  return new SlowBuffer(size);
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"buffer":12}],12:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

/*
 * Export kMaxLength after typed array support is determined.
 */
exports.kMaxLength = kMaxLength()

function typedArraySupport () {
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = {__proto__: Uint8Array.prototype, foo: function () { return 42 }}
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

function createBuffer (that, length) {
  if (kMaxLength() < length) {
    throw new RangeError('Invalid typed array length')
  }
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(length)
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    if (that === null) {
      that = new Buffer(length)
    }
    that.length = length
  }

  return that
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
    return new Buffer(arg, encodingOrOffset, length)
  }

  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(this, arg)
  }
  return from(this, arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192 // not used by this implementation

// TODO: Legacy, not needed anymore. Remove in next major version.
Buffer._augment = function (arr) {
  arr.__proto__ = Buffer.prototype
  return arr
}

function from (that, value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return fromArrayBuffer(that, value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(that, value, encodingOrOffset)
  }

  return fromObject(that, value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(null, value, encodingOrOffset, length)
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
  if (typeof Symbol !== 'undefined' && Symbol.species &&
      Buffer[Symbol.species] === Buffer) {
    // Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
    Object.defineProperty(Buffer, Symbol.species, {
      value: null,
      configurable: true
    })
  }
}

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  } else if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }
}

function alloc (that, size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(that, size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(that, size).fill(fill, encoding)
      : createBuffer(that, size).fill(fill)
  }
  return createBuffer(that, size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(null, size, fill, encoding)
}

function allocUnsafe (that, size) {
  assertSize(size)
  that = createBuffer(that, size < 0 ? 0 : checked(size) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < size; ++i) {
      that[i] = 0
    }
  }
  return that
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(null, size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(null, size)
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('"encoding" must be a valid string encoding')
  }

  var length = byteLength(string, encoding) | 0
  that = createBuffer(that, length)

  var actual = that.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    that = that.slice(0, actual)
  }

  return that
}

function fromArrayLike (that, array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  that = createBuffer(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array, byteOffset, length) {
  array.byteLength // this throws if `array` is not a valid ArrayBuffer

  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('\'offset\' is out of bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('\'length\' is out of bounds')
  }

  if (byteOffset === undefined && length === undefined) {
    array = new Uint8Array(array)
  } else if (length === undefined) {
    array = new Uint8Array(array, byteOffset)
  } else {
    array = new Uint8Array(array, byteOffset, length)
  }

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = array
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromArrayLike(that, array)
  }
  return that
}

function fromObject (that, obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    that = createBuffer(that, len)

    if (that.length === 0) {
      return that
    }

    obj.copy(that, 0, 0, len)
    return that
  }

  if (obj) {
    if ((typeof ArrayBuffer !== 'undefined' &&
        obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
      if (typeof obj.length !== 'number' || isnan(obj.length)) {
        return createBuffer(that, 0)
      }
      return fromArrayLike(that, obj)
    }

    if (obj.type === 'Buffer' && isArray(obj.data)) {
      return fromArrayLike(that, obj.data)
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
}

function checked (length) {
  // Note: cannot use `length < kMaxLength()` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
      (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string
  }

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
// Buffer instances.
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset  // Coerce to Number.
  if (isNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (Buffer.TYPED_ARRAY_SUPPORT &&
        typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = this.subarray(start, end)
    newBuf.__proto__ = Buffer.prototype
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; ++i) {
      newBuf[i] = this[i + start]
    }
  }

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; ++i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if (code < 256) {
        val = code
      }
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : utf8ToBytes(new Buffer(val, encoding).toString())
    var len = bytes.length
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function isnan (val) {
  return val !== val // eslint-disable-line no-self-compare
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"base64-js":4,"ieee754":22,"isarray":26}],13:[function(require,module,exports){
exports.read = require('./read')
exports.write = require('./write')

},{"./read":14,"./write":15}],14:[function(require,module,exports){
module.exports = ChunkStoreReadStream

var inherits = require('inherits')
var stream = require('readable-stream')

inherits(ChunkStoreReadStream, stream.Readable)

function ChunkStoreReadStream (store, chunkLength, opts) {
  if (!(this instanceof ChunkStoreReadStream)) {
    return new ChunkStoreReadStream(store, chunkLength, opts)
  }
  stream.Readable.call(this, opts)
  if (!opts) opts = {}

  if (!store || !store.put || !store.get) {
    throw new Error('First argument must be an abstract-chunk-store compliant store')
  }
  chunkLength = Number(chunkLength)
  if (!chunkLength) throw new Error('Second argument must be a chunk length')

  this._length = opts.length || store.length
  if (!Number.isFinite(this._length)) throw new Error('missing required `length` property')

  this._store = store
  this._chunkLength = chunkLength
  this._index = 0
}

ChunkStoreReadStream.prototype._read = function () {
  var self = this
  if (self._index * self._chunkLength >= self._length) {
    self.push(null)
  } else {
    self._store.get(self._index, function (err, chunk) {
      if (err) return self.destroy(err)
      self.push(chunk)
    })
  }
  self._index += 1
}

ChunkStoreReadStream.prototype.destroy = function (err) {
  if (this.destroyed) return
  this.destroyed = true

  if (err) this.emit('error', err)
  this.emit('close')
}

},{"inherits":24,"readable-stream":39}],15:[function(require,module,exports){
module.exports = ChunkStoreWriteStream

var BlockStream = require('block-stream2')
var inherits = require('inherits')
var stream = require('readable-stream')

inherits(ChunkStoreWriteStream, stream.Writable)

function ChunkStoreWriteStream (store, chunkLength, opts) {
  var self = this
  if (!(self instanceof ChunkStoreWriteStream)) {
    return new ChunkStoreWriteStream(store, chunkLength, opts)
  }
  stream.Writable.call(self, opts)
  if (!opts) opts = {}

  if (!store || !store.put || !store.get) {
    throw new Error('First argument must be an abstract-chunk-store compliant store')
  }
  chunkLength = Number(chunkLength)
  if (!chunkLength) throw new Error('Second argument must be a chunk length')

  self._blockstream = new BlockStream(chunkLength, { zeroPadding: false })

  self._blockstream
    .on('data', onData)
    .on('error', function (err) { self.destroy(err) })

  var index = 0
  function onData (chunk) {
    if (self.destroyed) return
    store.put(index, chunk)
    index += 1
  }

  self.on('finish', function () { this._blockstream.end() })
}

ChunkStoreWriteStream.prototype._write = function (chunk, encoding, callback) {
  this._blockstream.write(chunk, encoding, callback)
}

ChunkStoreWriteStream.prototype.destroy = function (err) {
  if (this.destroyed) return
  this.destroyed = true

  if (err) this.emit('error', err)
  this.emit('close')
}

},{"block-stream2":8,"inherits":24,"readable-stream":39}],16:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.

function isArray(arg) {
  if (Array.isArray) {
    return Array.isArray(arg);
  }
  return objectToString(arg) === '[object Array]';
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = Buffer.isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

}).call(this,{"isBuffer":require("../../is-buffer/index.js")})

},{"../../is-buffer/index.js":25}],17:[function(require,module,exports){
(function (process){
/**
 * This is the web browser implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = require('./debug');
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = 'undefined' != typeof chrome
               && 'undefined' != typeof chrome.storage
                  ? chrome.storage.local
                  : localstorage();

/**
 * Colors.
 */

exports.colors = [
  'lightseagreen',
  'forestgreen',
  'goldenrod',
  'dodgerblue',
  'darkorchid',
  'crimson'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

function useColors() {
  // NB: In an Electron preload script, document will be defined but not fully
  // initialized. Since we know we're in Chrome, we'll just detect this case
  // explicitly
  if (typeof window !== 'undefined' && 'process' in window && window.process.type === 'renderer') {
    return true;
  }

  // is webkit? http://stackoverflow.com/a/16459606/376773
  // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
  return (typeof document !== 'undefined' && 'WebkitAppearance' in document.documentElement.style) ||
    // is firebug? http://stackoverflow.com/a/398120/376773
    (typeof window !== 'undefined' && window.console && (console.firebug || (console.exception && console.table))) ||
    // is firefox >= v31?
    // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    (navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
    // double check webkit in userAgent just in case we are in a worker
    (navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
}

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

exports.formatters.j = function(v) {
  try {
    return JSON.stringify(v);
  } catch (err) {
    return '[UnexpectedJSONParseError]: ' + err.message;
  }
};


/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs(args) {
  var useColors = this.useColors;

  args[0] = (useColors ? '%c' : '')
    + this.namespace
    + (useColors ? ' %c' : ' ')
    + args[0]
    + (useColors ? '%c ' : ' ')
    + '+' + exports.humanize(this.diff);

  if (!useColors) return;

  var c = 'color: ' + this.color;
  args.splice(1, 0, c, 'color: inherit')

  // the final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into
  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-z%]/g, function(match) {
    if ('%%' === match) return;
    index++;
    if ('%c' === match) {
      // we only are interested in the *last* %c
      // (the user may have provided their own)
      lastC = index;
    }
  });

  args.splice(lastC, 0, c);
}

/**
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */

function log() {
  // this hackery is required for IE8/9, where
  // the `console.log` function doesn't have 'apply'
  return 'object' === typeof console
    && console.log
    && Function.prototype.apply.call(console.log, console, arguments);
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  try {
    if (null == namespaces) {
      exports.storage.removeItem('debug');
    } else {
      exports.storage.debug = namespaces;
    }
  } catch(e) {}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  var r;
  try {
    return exports.storage.debug;
  } catch(e) {}

  // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
  if (typeof process !== 'undefined' && 'env' in process) {
    return process.env.DEBUG;
  }
}

/**
 * Enable namespaces listed in `localStorage.debug` initially.
 */

exports.enable(load());

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage() {
  try {
    return window.localStorage;
  } catch (e) {}
}

}).call(this,require('_process'))

},{"./debug":18,"_process":32}],18:[function(require,module,exports){

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = createDebug.debug = createDebug.default = createDebug;
exports.coerce = coerce;
exports.disable = disable;
exports.enable = enable;
exports.enabled = enabled;
exports.humanize = require('ms');

/**
 * The currently active debug mode names, and names to skip.
 */

exports.names = [];
exports.skips = [];

/**
 * Map of special "%n" handling functions, for the debug "format" argument.
 *
 * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
 */

exports.formatters = {};

/**
 * Previous log timestamp.
 */

var prevTime;

/**
 * Select a color.
 * @param {String} namespace
 * @return {Number}
 * @api private
 */

function selectColor(namespace) {
  var hash = 0, i;

  for (i in namespace) {
    hash  = ((hash << 5) - hash) + namespace.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  return exports.colors[Math.abs(hash) % exports.colors.length];
}

/**
 * Create a debugger with the given `namespace`.
 *
 * @param {String} namespace
 * @return {Function}
 * @api public
 */

function createDebug(namespace) {

  function debug() {
    // disabled?
    if (!debug.enabled) return;

    var self = debug;

    // set `diff` timestamp
    var curr = +new Date();
    var ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;

    // turn the `arguments` into a proper Array
    var args = new Array(arguments.length);
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i];
    }

    args[0] = exports.coerce(args[0]);

    if ('string' !== typeof args[0]) {
      // anything else let's inspect with %O
      args.unshift('%O');
    }

    // apply any `formatters` transformations
    var index = 0;
    args[0] = args[0].replace(/%([a-zA-Z%])/g, function(match, format) {
      // if we encounter an escaped % then don't increase the array index
      if (match === '%%') return match;
      index++;
      var formatter = exports.formatters[format];
      if ('function' === typeof formatter) {
        var val = args[index];
        match = formatter.call(self, val);

        // now we need to remove `args[index]` since it's inlined in the `format`
        args.splice(index, 1);
        index--;
      }
      return match;
    });

    // apply env-specific formatting (colors, etc.)
    exports.formatArgs.call(self, args);

    var logFn = enabled.log || exports.log || console.log.bind(console);
    logFn.apply(self, args);
  }

  debug.namespace = namespace;
  debug.enabled = exports.enabled(namespace);
  debug.useColors = exports.useColors();
  debug.color = selectColor(namespace);

  // env-specific initialization logic for debug instances
  if ('function' === typeof exports.init) {
    exports.init(debug);
  }

  return debug;
}

/**
 * Enables a debug mode by namespaces. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} namespaces
 * @api public
 */

function enable(namespaces) {
  exports.save(namespaces);

  var split = (namespaces || '').split(/[\s,]+/);
  var len = split.length;

  for (var i = 0; i < len; i++) {
    if (!split[i]) continue; // ignore empty strings
    namespaces = split[i].replace(/\*/g, '.*?');
    if (namespaces[0] === '-') {
      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    } else {
      exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
}

/**
 * Disable debug output.
 *
 * @api public
 */

function disable() {
  exports.enable('');
}

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

function enabled(name) {
  var i, len;
  for (i = 0, len = exports.skips.length; i < len; i++) {
    if (exports.skips[i].test(name)) {
      return false;
    }
  }
  for (i = 0, len = exports.names.length; i < len; i++) {
    if (exports.names[i].test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Coerce `val`.
 *
 * @param {Mixed} val
 * @return {Mixed}
 * @api private
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}

},{"ms":27}],19:[function(require,module,exports){
module.exports = function () {
    for (var i = 0; i < arguments.length; i++) {
        if (arguments[i] !== undefined) return arguments[i];
    }
};

},{}],20:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        // At least give some kind of context to the user
        var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
        err.context = er;
        throw err;
      }
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    args = Array.prototype.slice.call(arguments, 1);
    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else if (listeners) {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.prototype.listenerCount = function(type) {
  if (this._events) {
    var evlistener = this._events[type];

    if (isFunction(evlistener))
      return 1;
    else if (evlistener)
      return evlistener.length;
  }
  return 0;
};

EventEmitter.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],21:[function(require,module,exports){
module.exports = IdbKeyStore

var scope = typeof window === 'undefined' ? self : window // eslint-disable-line
var IDB = scope.indexedDB || scope.mozIndexedDB || scope.webkitIndexedDB || scope.msIndexedDB

function IdbKeyStore (name, opts) {
  var self = this
  if (typeof name !== 'string') throw new Error('A name must be supplied of type string')
  if (!(this instanceof IdbKeyStore)) return new IdbKeyStore(name, opts)
  if (!opts) opts = {}

  self._db = null
  self._queue = []

  var request = IDB.open(name)

  request.onerror = function (event) {
    onerror(event, opts.onerror)
  }

  request.onsuccess = function (event) {
    self._db = event.target.result
    self._drainQueue()
    if (opts.onready) opts.onready()
  }

  request.onupgradeneeded = function (event) {
    var db = event.target.result
    db.createObjectStore('kv')
  }
}

IdbKeyStore.prototype.get = function (key, cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'get',
      key: key,
      cb: defer.cb
    })
  } else if (Array.isArray(key)) {
    var result = []
    var erroredOut = false
    var successes = 0
    key.forEach(function (_, index) {
      self.get(key[index], function (err, val) {
        if (erroredOut) return
        if (err) {
          erroredOut = true
          defer.cb(err)
        }
        result[index] = val
        successes++
        if (successes === key.length) defer.cb(null, result)
      })
    })
  } else {
    var transaction = self._db.transaction('kv', 'readonly')
    var request = transaction.objectStore('kv').get(key)

    request.onsuccess = function (event) {
      defer.cb(null, event.target.result)
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype.set = function (key, value, cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'set',
      key: key,
      value: value,
      cb: defer.cb
    })
  } else {
    var transaction = self._db.transaction('kv', 'readwrite')
    var request = transaction.objectStore('kv').put(value, key)

    request.onsuccess = function () {
      defer.cb(null)
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype.json = function (cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'json',
      cb: defer.cb
    })
  } else {
    var transaction = self._db.transaction('kv', 'readonly')
    var request = transaction.objectStore('kv').openCursor()

    var json = {}
    request.onsuccess = function (event) {
      var cursor = event.target.result
      if (cursor) {
        json[cursor.key] = cursor.value
        cursor.continue()
      } else {
        defer.cb(null, json)
      }
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype.keys = function (cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'keys',
      cb: defer.cb
    })
  } else {
    var transaction = self._db.transaction('kv', 'readonly')
    var request = transaction.objectStore('kv').openCursor()

    var keys = []
    request.onsuccess = function (event) {
      var cursor = event.target.result
      if (cursor) {
        keys.push(cursor.key)
        cursor.continue()
      } else {
        defer.cb(null, keys)
      }
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype.remove = function (key, cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'remove',
      key: key,
      cb: defer.cb
    })
  } else {
    var transaction = self._db.transaction('kv', 'readwrite')
    var request = transaction.objectStore('kv').delete(key)

    request.onsuccess = function (event) {
      defer.cb(null)
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype.clear = function (cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'clear',
      cb: defer.cb
    })
  } else {
    var transaction = self._db.transaction('kv', 'readwrite')
    var request = transaction.objectStore('kv').clear()

    request.onsuccess = function (event) {
      defer.cb(null)
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype.count = function (cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'count',
      cb: defer.cb
    })
  } else {
    var transaction = self._db.transaction('kv', 'readonly')
    var request = transaction.objectStore('kv').count()

    request.onsuccess = function (event) {
      defer.cb(null, event.target.result)
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype.add = function (key, value, cb) {
  var self = this
  var defer = promisify(cb)

  if (!self._db) {
    self._queue.push({
      type: 'add',
      key: key,
      value: value,
      cb: defer.cb
    })
  } else {
    var transaction = self._db.transaction('kv', 'readwrite')
    var request = transaction.objectStore('kv').add(value, key)

    request.onsuccess = function (event) {
      defer.cb(null)
    }

    transaction.onerror = function (event) {
      onerror(event, defer.cb)
    }
  }

  return defer.promise
}

IdbKeyStore.prototype._drainQueue = function () {
  var self = this
  for (var i = 0; i < self._queue.length; i++) {
    var item = self._queue[i]
    if (item.type === 'get') {
      self.get(item.key, item.cb)
    } else if (item.type === 'set') {
      self.set(item.key, item.value, item.cb)
    } else if (item.type === 'json') {
      self.json(item.cb)
    } else if (item.type === 'keys') {
      self.keys(item.cb)
    } else if (item.type === 'remove') {
      self.remove(item.key, item.cb)
    } else if (item.type === 'clear') {
      self.clear(item.cb)
    } else if (item.type === 'count') {
      self.count(item.cb)
    } else if (item.type === 'add') {
      self.add(item.key, item.value, item.cb)
    }
  }
  self._queue = null
}

function promisify (cb) {
  var defer = {cb: cb}

  if (typeof Promise === 'function' && cb == null) {
    defer.promise = new Promise(function (resolve, reject) {
      defer.cb = function (err, result) {
        if (err) return reject(err)
        else return resolve(result)
      }
    })
  }

  if (!defer.cb) defer.cb = function noop () {}

  return defer
}

function onerror (event, cb) {
  var err = new Error('IDB error')
  err.event = event

  if (cb) {
    cb(err)
  } else {
    throw err
  }
}

},{}],22:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],23:[function(require,module,exports){
(function (process,Buffer){
module.exports = IdbChunkStore

var IdbKvStore = require('idb-kv-store')

function IdbChunkStore (chunkLength, opts) {
  var self = this
  if (typeof chunkLength !== 'number') throw new Error('chunkLength must be a number')
  if (!(self instanceof IdbChunkStore)) return new IdbChunkStore(chunkLength, opts)
  if (!opts) opts = {}

  self.chunkLength = chunkLength
  self.length = Number(opts.length) || Infinity

  if (self.length !== Infinity) {
    this.lastChunkLength = (this.length % this.chunkLength) || this.chunkLength
    self.lastChunkIndex = Math.ceil(self.length / self.chunkLength) - 1
  }

  var name = opts.name || '' + Math.round(9e16 * Math.random())
  // for webtorrent
  if (opts.torrent && opts.torrent.infoHash) name = opts.torrent.infoHash
  self._store = new IdbKvStore(name)
}

IdbChunkStore.prototype.put = function (index, buffer, cb) {
  var self = this
  if (!cb) cb = noop
  if (!self._store) throw new Error('Store is closed')
  if (typeof index !== 'number') throw new Error('index must be a number')
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(buffer)

  var isLastChunk = (index === self.lastChunkIndex)
  var badLength = (isLastChunk && buffer.length !== self.lastChunkLength) ||
                  (!isLastChunk && buffer.length !== self.chunkLength)
  if (badLength) return process.nextTick(cb, new Error('Invalid buffer length'))

  self._store.set(index, buffer, cb)
}

IdbChunkStore.prototype.get = function (index, opts, cb) {
  var self = this
  if (typeof opts === 'function') return self.get(index, null, opts)
  if (typeof cb !== 'function') throw new Error('cb must be a function')
  if (!self._store) throw new Error('Store is closed')
  if (typeof index !== 'number') throw new Error('index must be a number')
  if (!opts) opts = {}

  self._store.get(index, function (err, buffer) {
    if (err) return cb(err)
    if (typeof buffer === 'undefined') return cb(new Error('Chunk does not exist'))
    var offset = 'offset' in opts ? opts.offset : 0
    var length = 'length' in opts ? opts.length : buffer.length - offset
    cb(null, (new Buffer(buffer)).slice(offset, offset + length))
  })
}

IdbChunkStore.prototype.close = function (cb) {
  var self = this
  if (!cb) cb = noop
  if (!self._store) throw new Error('Store is closed')

  self._store = null
  process.nextTick(cb, null)
}

IdbChunkStore.prototype.destroy = function (cb) {
  var self = this
  if (!cb) cb = noop
  if (!self._store) throw new Error('Store is closed')

  var s = self._store
  self._store = null
  s.clear(cb)
}

function noop () {
  // do nothing
}

}).call(this,require('_process'),require("buffer").Buffer)

},{"_process":32,"buffer":12,"idb-kv-store":21}],24:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],25:[function(require,module,exports){
/*!
 * Determine if an object is a Buffer
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

// The _isBuffer check is for Safari 5-7 support, because it's missing
// Object.prototype.constructor. Remove this eventually
module.exports = function (obj) {
  return obj != null && (isBuffer(obj) || isSlowBuffer(obj) || !!obj._isBuffer)
}

function isBuffer (obj) {
  return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
}

// For Node v0.10 support. Remove this eventually.
function isSlowBuffer (obj) {
  return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isBuffer(obj.slice(0, 0))
}

},{}],26:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],27:[function(require,module,exports){
/**
 * Helpers.
 */

var s = 1000
var m = s * 60
var h = m * 60
var d = h * 24
var y = d * 365.25

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} options
 * @throws {Error} throw an error if val is not a non-empty string or a number
 * @return {String|Number}
 * @api public
 */

module.exports = function (val, options) {
  options = options || {}
  var type = typeof val
  if (type === 'string' && val.length > 0) {
    return parse(val)
  } else if (type === 'number' && isNaN(val) === false) {
    return options.long ?
			fmtLong(val) :
			fmtShort(val)
  }
  throw new Error('val is not a non-empty string or a valid number. val=' + JSON.stringify(val))
}

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = String(str)
  if (str.length > 10000) {
    return
  }
  var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(str)
  if (!match) {
    return
  }
  var n = parseFloat(match[1])
  var type = (match[2] || 'ms').toLowerCase()
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y
    case 'days':
    case 'day':
    case 'd':
      return n * d
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n
    default:
      return undefined
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtShort(ms) {
  if (ms >= d) {
    return Math.round(ms / d) + 'd'
  }
  if (ms >= h) {
    return Math.round(ms / h) + 'h'
  }
  if (ms >= m) {
    return Math.round(ms / m) + 'm'
  }
  if (ms >= s) {
    return Math.round(ms / s) + 's'
  }
  return ms + 'ms'
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtLong(ms) {
  return plural(ms, d, 'day') ||
    plural(ms, h, 'hour') ||
    plural(ms, m, 'minute') ||
    plural(ms, s, 'second') ||
    ms + ' ms'
}

/**
 * Pluralization helper.
 */

function plural(ms, n, name) {
  if (ms < n) {
    return
  }
  if (ms < n * 1.5) {
    return Math.floor(ms / n) + ' ' + name
  }
  return Math.ceil(ms / n) + ' ' + name + 's'
}

},{}],28:[function(require,module,exports){
var wrappy = require('wrappy')
module.exports = wrappy(once)
module.exports.strict = wrappy(onceStrict)

once.proto = once(function () {
  Object.defineProperty(Function.prototype, 'once', {
    value: function () {
      return once(this)
    },
    configurable: true
  })

  Object.defineProperty(Function.prototype, 'onceStrict', {
    value: function () {
      return onceStrict(this)
    },
    configurable: true
  })
})

function once (fn) {
  var f = function () {
    if (f.called) return f.value
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  f.called = false
  return f
}

function onceStrict (fn) {
  var f = function () {
    if (f.called)
      throw new Error(f.onceError)
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  var name = fn.name || 'Function wrapped with `once`'
  f.onceError = name + " shouldn't be called more than once"
  f.called = false
  return f
}

},{"wrappy":46}],29:[function(require,module,exports){
(function (Buffer){
module.exports = decodeTorrentFile
module.exports.decode = decodeTorrentFile
module.exports.encode = encodeTorrentFile

var bencode = require('bencode')
var path = require('path')
var sha1 = require('simple-sha1')
var uniq = require('uniq')

/**
 * Parse a torrent. Throws an exception if the torrent is missing required fields.
 * @param  {Buffer|Object} torrent
 * @return {Object}        parsed torrent
 */
function decodeTorrentFile (torrent) {
  if (Buffer.isBuffer(torrent)) {
    torrent = bencode.decode(torrent)
  }

  // sanity check
  ensure(torrent.info, 'info')
  ensure(torrent.info['name.utf-8'] || torrent.info.name, 'info.name')
  ensure(torrent.info['piece length'], 'info[\'piece length\']')
  ensure(torrent.info.pieces, 'info.pieces')

  if (torrent.info.files) {
    torrent.info.files.forEach(function (file) {
      ensure(typeof file.length === 'number', 'info.files[0].length')
      ensure(file['path.utf-8'] || file.path, 'info.files[0].path')
    })
  } else {
    ensure(typeof torrent.info.length === 'number', 'info.length')
  }

  var result = {}
  result.info = torrent.info
  result.infoBuffer = bencode.encode(torrent.info)
  result.infoHash = sha1.sync(result.infoBuffer)
  result.infoHashBuffer = new Buffer(result.infoHash, 'hex')

  result.name = (torrent.info['name.utf-8'] || torrent.info.name).toString()

  if (torrent.info.private !== undefined) result.private = !!torrent.info.private

  if (torrent['creation date']) result.created = new Date(torrent['creation date'] * 1000)
  if (torrent['created by']) result.createdBy = torrent['created by'].toString()

  if (Buffer.isBuffer(torrent.comment)) result.comment = torrent.comment.toString()

  // announce and announce-list will be missing if metadata fetched via ut_metadata
  result.announce = []
  if (torrent['announce-list'] && torrent['announce-list'].length) {
    torrent['announce-list'].forEach(function (urls) {
      urls.forEach(function (url) {
        result.announce.push(url.toString())
      })
    })
  } else if (torrent.announce) {
    result.announce.push(torrent.announce.toString())
  }

  // handle url-list (BEP19 / web seeding)
  if (Buffer.isBuffer(torrent['url-list'])) {
    // some clients set url-list to empty string
    torrent['url-list'] = torrent['url-list'].length > 0
      ? [ torrent['url-list'] ]
      : []
  }
  result.urlList = (torrent['url-list'] || []).map(function (url) {
    return url.toString()
  })

  uniq(result.announce)
  uniq(result.urlList)

  var files = torrent.info.files || [ torrent.info ]
  result.files = files.map(function (file, i) {
    var parts = [].concat(result.name, file['path.utf-8'] || file.path || []).map(function (p) {
      return p.toString()
    })
    return {
      path: path.join.apply(null, [path.sep].concat(parts)).slice(1),
      name: parts[parts.length - 1],
      length: file.length,
      offset: files.slice(0, i).reduce(sumLength, 0)
    }
  })

  result.length = files.reduce(sumLength, 0)

  var lastFile = result.files[result.files.length - 1]

  result.pieceLength = torrent.info['piece length']
  result.lastPieceLength = ((lastFile.offset + lastFile.length) % result.pieceLength) || result.pieceLength
  result.pieces = splitPieces(torrent.info.pieces)

  return result
}

/**
 * Convert a parsed torrent object back into a .torrent file buffer.
 * @param  {Object} parsed parsed torrent
 * @return {Buffer}
 */
function encodeTorrentFile (parsed) {
  var torrent = {
    info: parsed.info
  }

  torrent['announce-list'] = (parsed.announce || []).map(function (url) {
    if (!torrent.announce) torrent.announce = url
    url = new Buffer(url, 'utf8')
    return [ url ]
  })

  torrent['url-list'] = parsed.urlList || []

  if (parsed.created) {
    torrent['creation date'] = (parsed.created.getTime() / 1000) | 0
  }

  if (parsed.createdBy) {
    torrent['created by'] = parsed.createdBy
  }

  if (parsed.comment) {
    torrent.comment = parsed.comment
  }

  return bencode.encode(torrent)
}

function sumLength (sum, file) {
  return sum + file.length
}

function splitPieces (buf) {
  var pieces = []
  for (var i = 0; i < buf.length; i += 20) {
    pieces.push(buf.slice(i, i + 20).toString('hex'))
  }
  return pieces
}

function ensure (bool, fieldName) {
  if (!bool) throw new Error('Torrent is missing required field: ' + fieldName)
}

}).call(this,require("buffer").Buffer)

},{"bencode":7,"buffer":12,"path":30,"simple-sha1":41,"uniq":44}],30:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))

},{"_process":32}],31:[function(require,module,exports){
(function (process){
'use strict';

if (!process.version ||
    process.version.indexOf('v0.') === 0 ||
    process.version.indexOf('v1.') === 0 && process.version.indexOf('v1.8.') !== 0) {
  module.exports = nextTick;
} else {
  module.exports = process.nextTick;
}

function nextTick(fn, arg1, arg2, arg3) {
  if (typeof fn !== 'function') {
    throw new TypeError('"callback" argument must be a function');
  }
  var len = arguments.length;
  var args, i;
  switch (len) {
  case 0:
  case 1:
    return process.nextTick(fn);
  case 2:
    return process.nextTick(function afterTickOne() {
      fn.call(null, arg1);
    });
  case 3:
    return process.nextTick(function afterTickTwo() {
      fn.call(null, arg1, arg2);
    });
  case 4:
    return process.nextTick(function afterTickThree() {
      fn.call(null, arg1, arg2, arg3);
    });
  default:
    args = new Array(len - 1);
    i = 0;
    while (i < args.length) {
      args[i++] = arguments[i];
    }
    return process.nextTick(function afterTick() {
      fn.apply(null, args);
    });
  }
}

}).call(this,require('_process'))

},{"_process":32}],32:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],33:[function(require,module,exports){
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

'use strict';

/*<replacement>*/

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    keys.push(key);
  }return keys;
};
/*</replacement>*/

module.exports = Duplex;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

var keys = objectKeys(Writable.prototype);
for (var v = 0; v < keys.length; v++) {
  var method = keys[v];
  if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
}

function Duplex(options) {
  if (!(this instanceof Duplex)) return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false) this.readable = false;

  if (options && options.writable === false) this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended) return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  processNextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}
},{"./_stream_readable":35,"./_stream_writable":37,"core-util-is":16,"inherits":24,"process-nextick-args":31}],34:[function(require,module,exports){
// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

'use strict';

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough)) return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function (chunk, encoding, cb) {
  cb(null, chunk);
};
},{"./_stream_transform":36,"core-util-is":16,"inherits":24}],35:[function(require,module,exports){
(function (process){
'use strict';

module.exports = Readable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/

/*<replacement>*/
var Duplex;
/*</replacement>*/

Readable.ReadableState = ReadableState;

/*<replacement>*/
var EE = require('events').EventEmitter;

var EElistenerCount = function (emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

/*<replacement>*/
var Stream;
(function () {
  try {
    Stream = require('st' + 'ream');
  } catch (_) {} finally {
    if (!Stream) Stream = require('events').EventEmitter;
  }
})();
/*</replacement>*/

var Buffer = require('buffer').Buffer;
/*<replacement>*/
var bufferShim = require('buffer-shims');
/*</replacement>*/

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var debugUtil = require('util');
var debug = void 0;
if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/

var BufferList = require('./internal/streams/BufferList');
var StringDecoder;

util.inherits(Readable, Stream);

function prependListener(emitter, event, fn) {
  // Sadly this is not cacheable as some libraries bundle their own
  // event emitter implementation with them.
  if (typeof emitter.prependListener === 'function') {
    return emitter.prependListener(event, fn);
  } else {
    // This is a hack to make sure that our error handler is attached before any
    // userland ones.  NEVER DO THIS. This is here only because this code needs
    // to continue to work with older versions of Node.js that do not include
    // the prependListener() method. The goal is to eventually remove this hack.
    if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);else if (isArray(emitter._events[event])) emitter._events[event].unshift(fn);else emitter._events[event] = [fn, emitter._events[event]];
  }
}

function ReadableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  // A linked list is used to store data chunks instead of an array because the
  // linked list can remove elements from the beginning faster than
  // array.shift()
  this.buffer = new BufferList();
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  if (!(this instanceof Readable)) return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options && typeof options.read === 'function') this._read = options.read;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function (chunk, encoding) {
  var state = this._readableState;

  if (!state.objectMode && typeof chunk === 'string') {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = bufferShim.from(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function (chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

Readable.prototype.isPaused = function () {
  return this._readableState.flowing === false;
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var _e = new Error('stream.unshift() after end event');
      stream.emit('error', _e);
    } else {
      var skipAdd;
      if (state.decoder && !addToFront && !encoding) {
        chunk = state.decoder.write(chunk);
        skipAdd = !state.objectMode && chunk.length === 0;
      }

      if (!addToFront) state.reading = false;

      // Don't add to the buffer if we've decoded to an empty string chunk and
      // we're not in object mode
      if (!skipAdd) {
        // if we want the data now, just emit it.
        if (state.flowing && state.length === 0 && !state.sync) {
          stream.emit('data', chunk);
          stream.read(0);
        } else {
          // update the buffer info.
          state.length += state.objectMode ? 1 : chunk.length;
          if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);

          if (state.needReadable) emitReadable(stream);
        }
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}

// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function (enc) {
  if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 8MB
var MAX_HWM = 0x800000;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2 to prevent increasing hwm excessively in
    // tiny amounts
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function howMuchToRead(n, state) {
  if (n <= 0 || state.length === 0 && state.ended) return 0;
  if (state.objectMode) return 1;
  if (n !== n) {
    // Only flow one buffer at a time
    if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
  }
  // If we're asking for more than the current hwm, then raise the hwm.
  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
  if (n <= state.length) return n;
  // Don't have enough
  if (!state.ended) {
    state.needReadable = true;
    return 0;
  }
  return state.length;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function (n) {
  debug('read', n);
  n = parseInt(n, 10);
  var state = this._readableState;
  var nOrig = n;

  if (n !== 0) state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0) endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  } else if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
    // If _read pushed data synchronously, then `reading` will be false,
    // and we need to re-evaluate how much data we can return to the user.
    if (!state.reading) n = howMuchToRead(nOrig, state);
  }

  var ret;
  if (n > 0) ret = fromList(n, state);else ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  } else {
    state.length -= n;
  }

  if (state.length === 0) {
    // If we have nothing in the buffer, then we want to know
    // as soon as we *do* get something into the buffer.
    if (!state.ended) state.needReadable = true;

    // If we tried to read() past the EOF, then emit end on the next tick.
    if (nOrig !== n && state.ended) endReadable(this);
  }

  if (ret !== null) this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}

function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync) processNextTick(emitReadable_, stream);else emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}

// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    processNextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;else len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function (n) {
  this.emit('error', new Error('_read() is not implemented'));
};

Readable.prototype.pipe = function (dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted) processNextTick(endFn);else src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  var cleanedUp = false;
  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    cleanedUp = true;

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  // If the user pushes more data while we're writing to dest then we'll end up
  // in ondata again. However, we only want to increase awaitDrain once because
  // dest will only emit one 'drain' event for the multiple writes.
  // => Introduce a guard on increasing awaitDrain.
  var increasedAwaitDrain = false;
  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    increasedAwaitDrain = false;
    var ret = dest.write(chunk);
    if (false === ret && !increasedAwaitDrain) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      // => Check whether `dest` is still a piping destination.
      if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
        debug('false write response, pause', src._readableState.awaitDrain);
        src._readableState.awaitDrain++;
        increasedAwaitDrain = true;
      }
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EElistenerCount(dest, 'error') === 0) dest.emit('error', er);
  }

  // Make sure our error handler is attached before userland ones.
  prependListener(dest, 'error', onerror);

  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function () {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain) state.awaitDrain--;
    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}

Readable.prototype.unpipe = function (dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0) return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes) return this;

    if (!dest) dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest) dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++) {
      dests[i].emit('unpipe', this);
    }return this;
  }

  // try to find the right one.
  var index = indexOf(state.pipes, dest);
  if (index === -1) return this;

  state.pipes.splice(index, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1) state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function (ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  if (ev === 'data') {
    // Start flowing on next tick if stream isn't explicitly paused
    if (this._readableState.flowing !== false) this.resume();
  } else if (ev === 'readable') {
    var state = this._readableState;
    if (!state.endEmitted && !state.readableListening) {
      state.readableListening = state.needReadable = true;
      state.emittedReadable = false;
      if (!state.reading) {
        processNextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function () {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    processNextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  state.awaitDrain = 0;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

Readable.prototype.pause = function () {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  while (state.flowing && stream.read() !== null) {}
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function (stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function () {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function (chunk) {
    debug('wrapped data');
    if (state.decoder) chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function (method) {
        return function () {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function (ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function (n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};

// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromList(n, state) {
  // nothing buffered
  if (state.length === 0) return null;

  var ret;
  if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
    // read it all, truncate the list
    if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.head.data;else ret = state.buffer.concat(state.length);
    state.buffer.clear();
  } else {
    // read part of list
    ret = fromListPartial(n, state.buffer, state.decoder);
  }

  return ret;
}

// Extracts only enough buffered data to satisfy the amount requested.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromListPartial(n, list, hasStrings) {
  var ret;
  if (n < list.head.data.length) {
    // slice is the same for buffers and strings
    ret = list.head.data.slice(0, n);
    list.head.data = list.head.data.slice(n);
  } else if (n === list.head.data.length) {
    // first chunk is a perfect match
    ret = list.shift();
  } else {
    // result spans more than one buffer
    ret = hasStrings ? copyFromBufferString(n, list) : copyFromBuffer(n, list);
  }
  return ret;
}

// Copies a specified amount of characters from the list of buffered data
// chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBufferString(n, list) {
  var p = list.head;
  var c = 1;
  var ret = p.data;
  n -= ret.length;
  while (p = p.next) {
    var str = p.data;
    var nb = n > str.length ? str.length : n;
    if (nb === str.length) ret += str;else ret += str.slice(0, n);
    n -= nb;
    if (n === 0) {
      if (nb === str.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = str.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

// Copies a specified amount of bytes from the list of buffered data chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBuffer(n, list) {
  var ret = bufferShim.allocUnsafe(n);
  var p = list.head;
  var c = 1;
  p.data.copy(ret);
  n -= p.data.length;
  while (p = p.next) {
    var buf = p.data;
    var nb = n > buf.length ? buf.length : n;
    buf.copy(ret, ret.length - n, 0, nb);
    n -= nb;
    if (n === 0) {
      if (nb === buf.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = buf.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0) throw new Error('"endReadable()" called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    processNextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}
}).call(this,require('_process'))

},{"./_stream_duplex":33,"./internal/streams/BufferList":38,"_process":32,"buffer":12,"buffer-shims":11,"core-util-is":16,"events":20,"inherits":24,"isarray":26,"process-nextick-args":31,"string_decoder/":43,"util":9}],36:[function(require,module,exports){
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

'use strict';

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);

function TransformState(stream) {
  this.afterTransform = function (er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
  this.writeencoding = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb) return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined) stream.push(data);

  cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}

function Transform(options) {
  if (!(this instanceof Transform)) return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(this);

  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function') this._transform = options.transform;

    if (typeof options.flush === 'function') this._flush = options.flush;
  }

  // When the writable side finishes, then flush out anything remaining.
  this.once('prefinish', function () {
    if (typeof this._flush === 'function') this._flush(function (er, data) {
      done(stream, er, data);
    });else done(stream);
  });
}

Transform.prototype.push = function (chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function (chunk, encoding, cb) {
  throw new Error('_transform() is not implemented');
};

Transform.prototype._write = function (chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function (n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};

function done(stream, er, data) {
  if (er) return stream.emit('error', er);

  if (data !== null && data !== undefined) stream.push(data);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length) throw new Error('Calling transform done when ws.length != 0');

  if (ts.transforming) throw new Error('Calling transform done when still transforming');

  return stream.push(null);
}
},{"./_stream_duplex":33,"core-util-is":16,"inherits":24}],37:[function(require,module,exports){
(function (process){
// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

'use strict';

module.exports = Writable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var asyncWrite = !process.browser && ['v0.10', 'v0.9.'].indexOf(process.version.slice(0, 5)) > -1 ? setImmediate : processNextTick;
/*</replacement>*/

/*<replacement>*/
var Duplex;
/*</replacement>*/

Writable.WritableState = WritableState;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var internalUtil = {
  deprecate: require('util-deprecate')
};
/*</replacement>*/

/*<replacement>*/
var Stream;
(function () {
  try {
    Stream = require('st' + 'ream');
  } catch (_) {} finally {
    if (!Stream) Stream = require('events').EventEmitter;
  }
})();
/*</replacement>*/

var Buffer = require('buffer').Buffer;
/*<replacement>*/
var bufferShim = require('buffer-shims');
/*</replacement>*/

util.inherits(Writable, Stream);

function nop() {}

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

function WritableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  // drain event flag.
  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function (er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;

  // count buffered requests
  this.bufferedRequestCount = 0;

  // allocate the first CorkedRequest, there is always
  // one allocated and free to use, and we maintain at most two
  this.corkedRequestsFree = new CorkedRequest(this);
}

WritableState.prototype.getBuffer = function getBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

(function () {
  try {
    Object.defineProperty(WritableState.prototype, 'buffer', {
      get: internalUtil.deprecate(function () {
        return this.getBuffer();
      }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.')
    });
  } catch (_) {}
})();

// Test _writableState for inheritance to account for Duplex streams,
// whose prototype chain only points to Readable.
var realHasInstance;
if (typeof Symbol === 'function' && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === 'function') {
  realHasInstance = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Writable, Symbol.hasInstance, {
    value: function (object) {
      if (realHasInstance.call(this, object)) return true;

      return object && object._writableState instanceof WritableState;
    }
  });
} else {
  realHasInstance = function (object) {
    return object instanceof this;
  };
}

function Writable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, too.
  // `realHasInstance` is necessary because using plain `instanceof`
  // would return false, as no `_writableState` property is attached.

  // Trying to use the custom `instanceof` for Writable here will also break the
  // Node.js LazyTransform implementation, which has a non-trivial getter for
  // `_writableState` that would lead to infinite recursion.
  if (!realHasInstance.call(Writable, this) && !(this instanceof Duplex)) {
    return new Writable(options);
  }

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function') this._write = options.write;

    if (typeof options.writev === 'function') this._writev = options.writev;
  }

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function () {
  this.emit('error', new Error('Cannot pipe, not readable'));
};

function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  processNextTick(cb, er);
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  var er = false;
  // Always throw error if a null is written
  // if we are not in object mode then throw
  // if it is not a buffer, string, or undefined.
  if (chunk === null) {
    er = new TypeError('May not write null values to stream');
  } else if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  if (er) {
    stream.emit('error', er);
    processNextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function (chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;

  if (typeof cb !== 'function') cb = nop;

  if (state.ended) writeAfterEnd(this, cb);else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function () {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function () {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string') encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
    chunk = bufferShim.from(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret) state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
    state.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;
  if (sync) processNextTick(cb, er);else cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er) onwriteError(stream, state, sync, er, cb);else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      /*<replacement>*/
      asyncWrite(afterWrite, stream, state, finished, cb);
      /*</replacement>*/
    } else {
        afterWrite(stream, state, finished, cb);
      }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished) onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}

// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var l = state.bufferedRequestCount;
    var buffer = new Array(l);
    var holder = state.corkedRequestsFree;
    holder.entry = entry;

    var count = 0;
    while (entry) {
      buffer[count] = entry;
      entry = entry.next;
      count += 1;
    }

    doWrite(stream, state, true, state.length, buffer, '', holder.finish);

    // doWrite is almost always async, defer these to save a bit of time
    // as the hot path ends with doWrite
    state.pendingcb++;
    state.lastBufferedRequest = null;
    if (holder.next) {
      state.corkedRequestsFree = holder.next;
      holder.next = null;
    } else {
      state.corkedRequestsFree = new CorkedRequest(state);
    }
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null) state.lastBufferedRequest = null;
  }

  state.bufferedRequestCount = 0;
  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function (chunk, encoding, cb) {
  cb(new Error('_write() is not implemented'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function (chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished) endWritable(this, state, cb);
};

function needFinish(state) {
  return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else {
      prefinish(stream, state);
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished) processNextTick(cb);else stream.once('finish', cb);
  }
  state.ended = true;
  stream.writable = false;
}

// It seems a linked list but it is not
// there will be only 2 of these for each stream
function CorkedRequest(state) {
  var _this = this;

  this.next = null;
  this.entry = null;

  this.finish = function (err) {
    var entry = _this.entry;
    _this.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }
    if (state.corkedRequestsFree) {
      state.corkedRequestsFree.next = _this;
    } else {
      state.corkedRequestsFree = _this;
    }
  };
}
}).call(this,require('_process'))

},{"./_stream_duplex":33,"_process":32,"buffer":12,"buffer-shims":11,"core-util-is":16,"events":20,"inherits":24,"process-nextick-args":31,"util-deprecate":45}],38:[function(require,module,exports){
'use strict';

var Buffer = require('buffer').Buffer;
/*<replacement>*/
var bufferShim = require('buffer-shims');
/*</replacement>*/

module.exports = BufferList;

function BufferList() {
  this.head = null;
  this.tail = null;
  this.length = 0;
}

BufferList.prototype.push = function (v) {
  var entry = { data: v, next: null };
  if (this.length > 0) this.tail.next = entry;else this.head = entry;
  this.tail = entry;
  ++this.length;
};

BufferList.prototype.unshift = function (v) {
  var entry = { data: v, next: this.head };
  if (this.length === 0) this.tail = entry;
  this.head = entry;
  ++this.length;
};

BufferList.prototype.shift = function () {
  if (this.length === 0) return;
  var ret = this.head.data;
  if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
  --this.length;
  return ret;
};

BufferList.prototype.clear = function () {
  this.head = this.tail = null;
  this.length = 0;
};

BufferList.prototype.join = function (s) {
  if (this.length === 0) return '';
  var p = this.head;
  var ret = '' + p.data;
  while (p = p.next) {
    ret += s + p.data;
  }return ret;
};

BufferList.prototype.concat = function (n) {
  if (this.length === 0) return bufferShim.alloc(0);
  if (this.length === 1) return this.head.data;
  var ret = bufferShim.allocUnsafe(n >>> 0);
  var p = this.head;
  var i = 0;
  while (p) {
    p.data.copy(ret, i);
    i += p.data.length;
    p = p.next;
  }
  return ret;
};
},{"buffer":12,"buffer-shims":11}],39:[function(require,module,exports){
(function (process){
var Stream = (function (){
  try {
    return require('st' + 'ream'); // hack to fix a circular dependency issue when used with browserify
  } catch(_){}
}());
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = Stream || exports;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

if (!process.browser && process.env.READABLE_STREAM === 'disable' && Stream) {
  module.exports = Stream;
}

}).call(this,require('_process'))

},{"./lib/_stream_duplex.js":33,"./lib/_stream_passthrough.js":34,"./lib/_stream_readable.js":35,"./lib/_stream_transform.js":36,"./lib/_stream_writable.js":37,"_process":32}],40:[function(require,module,exports){
(function (global){
(function () {
    var /*
 * Rusha, a JavaScript implementation of the Secure Hash Algorithm, SHA-1,
 * as defined in FIPS PUB 180-1, tuned for high performance with large inputs.
 * (http://github.com/srijs/rusha)
 *
 * Inspired by Paul Johnstons implementation (http://pajhome.org.uk/crypt/md5).
 *
 * Copyright (c) 2013 Sam Rijs (http://awesam.de).
 * Released under the terms of the MIT license as follows:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */
    util = {
        getDataType: function (data) {
            if (typeof data === 'string') {
                return 'string';
            }
            if (data instanceof Array) {
                return 'array';
            }
            if (typeof global !== 'undefined' && global.Buffer && global.Buffer.isBuffer(data)) {
                return 'buffer';
            }
            if (data instanceof ArrayBuffer) {
                return 'arraybuffer';
            }
            if (data.buffer instanceof ArrayBuffer) {
                return 'view';
            }
            if (data instanceof Blob) {
                return 'blob';
            }
            throw new Error('Unsupported data type.');
        }
    };
    function Rusha(chunkSize) {
        'use strict';
        var // Private object structure.
        self$2 = { fill: 0 };
        var // Calculate the length of buffer that the sha1 routine uses
        // including the padding.
        padlen = function (len) {
            for (len += 9; len % 64 > 0; len += 1);
            return len;
        };
        var padZeroes = function (bin, len) {
            var h8 = new Uint8Array(bin.buffer);
            var om = len % 4, align = len - om;
            switch (om) {
            case 0:
                h8[align + 3] = 0;
            case 1:
                h8[align + 2] = 0;
            case 2:
                h8[align + 1] = 0;
            case 3:
                h8[align + 0] = 0;
            }
            for (var i$2 = (len >> 2) + 1; i$2 < bin.length; i$2++)
                bin[i$2] = 0;
        };
        var padData = function (bin, chunkLen, msgLen) {
            bin[chunkLen >> 2] |= 128 << 24 - (chunkLen % 4 << 3);
            // To support msgLen >= 2 GiB, use a float division when computing the
            // high 32-bits of the big-endian message length in bits.
            bin[((chunkLen >> 2) + 2 & ~15) + 14] = msgLen / (1 << 29) | 0;
            bin[((chunkLen >> 2) + 2 & ~15) + 15] = msgLen << 3;
        };
        var // Convert a binary string and write it to the heap.
        // A binary string is expected to only contain char codes < 256.
        convStr = function (H8, H32, start, len, off) {
            var str = this, i$2, om = off % 4, lm = (len + om) % 4, j = len - lm;
            switch (om) {
            case 0:
                H8[off] = str.charCodeAt(start + 3);
            case 1:
                H8[off + 1 - (om << 1) | 0] = str.charCodeAt(start + 2);
            case 2:
                H8[off + 2 - (om << 1) | 0] = str.charCodeAt(start + 1);
            case 3:
                H8[off + 3 - (om << 1) | 0] = str.charCodeAt(start);
            }
            if (len < lm + om) {
                return;
            }
            for (i$2 = 4 - om; i$2 < j; i$2 = i$2 + 4 | 0) {
                H32[off + i$2 >> 2] = str.charCodeAt(start + i$2) << 24 | str.charCodeAt(start + i$2 + 1) << 16 | str.charCodeAt(start + i$2 + 2) << 8 | str.charCodeAt(start + i$2 + 3);
            }
            switch (lm) {
            case 3:
                H8[off + j + 1 | 0] = str.charCodeAt(start + j + 2);
            case 2:
                H8[off + j + 2 | 0] = str.charCodeAt(start + j + 1);
            case 1:
                H8[off + j + 3 | 0] = str.charCodeAt(start + j);
            }
        };
        var // Convert a buffer or array and write it to the heap.
        // The buffer or array is expected to only contain elements < 256.
        convBuf = function (H8, H32, start, len, off) {
            var buf = this, i$2, om = off % 4, lm = (len + om) % 4, j = len - lm;
            switch (om) {
            case 0:
                H8[off] = buf[start + 3];
            case 1:
                H8[off + 1 - (om << 1) | 0] = buf[start + 2];
            case 2:
                H8[off + 2 - (om << 1) | 0] = buf[start + 1];
            case 3:
                H8[off + 3 - (om << 1) | 0] = buf[start];
            }
            if (len < lm + om) {
                return;
            }
            for (i$2 = 4 - om; i$2 < j; i$2 = i$2 + 4 | 0) {
                H32[off + i$2 >> 2 | 0] = buf[start + i$2] << 24 | buf[start + i$2 + 1] << 16 | buf[start + i$2 + 2] << 8 | buf[start + i$2 + 3];
            }
            switch (lm) {
            case 3:
                H8[off + j + 1 | 0] = buf[start + j + 2];
            case 2:
                H8[off + j + 2 | 0] = buf[start + j + 1];
            case 1:
                H8[off + j + 3 | 0] = buf[start + j];
            }
        };
        var convBlob = function (H8, H32, start, len, off) {
            var blob = this, i$2, om = off % 4, lm = (len + om) % 4, j = len - lm;
            var buf = new Uint8Array(reader.readAsArrayBuffer(blob.slice(start, start + len)));
            switch (om) {
            case 0:
                H8[off] = buf[3];
            case 1:
                H8[off + 1 - (om << 1) | 0] = buf[2];
            case 2:
                H8[off + 2 - (om << 1) | 0] = buf[1];
            case 3:
                H8[off + 3 - (om << 1) | 0] = buf[0];
            }
            if (len < lm + om) {
                return;
            }
            for (i$2 = 4 - om; i$2 < j; i$2 = i$2 + 4 | 0) {
                H32[off + i$2 >> 2 | 0] = buf[i$2] << 24 | buf[i$2 + 1] << 16 | buf[i$2 + 2] << 8 | buf[i$2 + 3];
            }
            switch (lm) {
            case 3:
                H8[off + j + 1 | 0] = buf[j + 2];
            case 2:
                H8[off + j + 2 | 0] = buf[j + 1];
            case 1:
                H8[off + j + 3 | 0] = buf[j];
            }
        };
        var convFn = function (data) {
            switch (util.getDataType(data)) {
            case 'string':
                return convStr.bind(data);
            case 'array':
                return convBuf.bind(data);
            case 'buffer':
                return convBuf.bind(data);
            case 'arraybuffer':
                return convBuf.bind(new Uint8Array(data));
            case 'view':
                return convBuf.bind(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            case 'blob':
                return convBlob.bind(data);
            }
        };
        var slice = function (data, offset) {
            switch (util.getDataType(data)) {
            case 'string':
                return data.slice(offset);
            case 'array':
                return data.slice(offset);
            case 'buffer':
                return data.slice(offset);
            case 'arraybuffer':
                return data.slice(offset);
            case 'view':
                return data.buffer.slice(offset);
            }
        };
        var // Precompute 00 - ff strings
        precomputedHex = new Array(256);
        for (var i = 0; i < 256; i++) {
            precomputedHex[i] = (i < 16 ? '0' : '') + i.toString(16);
        }
        var // Convert an ArrayBuffer into its hexadecimal string representation.
        hex = function (arrayBuffer) {
            var binarray = new Uint8Array(arrayBuffer);
            var res = new Array(arrayBuffer.byteLength);
            for (var i$2 = 0; i$2 < res.length; i$2++) {
                res[i$2] = precomputedHex[binarray[i$2]];
            }
            return res.join('');
        };
        var ceilHeapSize = function (v) {
            // The asm.js spec says:
            // The heap object's byteLength must be either
            // 2^n for n in [12, 24) or 2^24 * n for n ≥ 1.
            // Also, byteLengths smaller than 2^16 are deprecated.
            var p;
            if (// If v is smaller than 2^16, the smallest possible solution
                // is 2^16.
                v <= 65536)
                return 65536;
            if (// If v < 2^24, we round up to 2^n,
                // otherwise we round up to 2^24 * n.
                v < 16777216) {
                for (p = 1; p < v; p = p << 1);
            } else {
                for (p = 16777216; p < v; p += 16777216);
            }
            return p;
        };
        var // Initialize the internal data structures to a new capacity.
        init = function (size) {
            if (size % 64 > 0) {
                throw new Error('Chunk size must be a multiple of 128 bit');
            }
            self$2.offset = 0;
            self$2.maxChunkLen = size;
            self$2.padMaxChunkLen = padlen(size);
            // The size of the heap is the sum of:
            // 1. The padded input message size
            // 2. The extended space the algorithm needs (320 byte)
            // 3. The 160 bit state the algoritm uses
            self$2.heap = new ArrayBuffer(ceilHeapSize(self$2.padMaxChunkLen + 320 + 20));
            self$2.h32 = new Int32Array(self$2.heap);
            self$2.h8 = new Int8Array(self$2.heap);
            self$2.core = new Rusha._core({
                Int32Array: Int32Array,
                DataView: DataView
            }, {}, self$2.heap);
            self$2.buffer = null;
        };
        // Iinitializethe datastructures according
        // to a chunk siyze.
        init(chunkSize || 64 * 1024);
        var initState = function (heap, padMsgLen) {
            self$2.offset = 0;
            var io = new Int32Array(heap, padMsgLen + 320, 5);
            io[0] = 1732584193;
            io[1] = -271733879;
            io[2] = -1732584194;
            io[3] = 271733878;
            io[4] = -1009589776;
        };
        var padChunk = function (chunkLen, msgLen) {
            var padChunkLen = padlen(chunkLen);
            var view = new Int32Array(self$2.heap, 0, padChunkLen >> 2);
            padZeroes(view, chunkLen);
            padData(view, chunkLen, msgLen);
            return padChunkLen;
        };
        var // Write data to the heap.
        write = function (data, chunkOffset, chunkLen, off) {
            convFn(data)(self$2.h8, self$2.h32, chunkOffset, chunkLen, off || 0);
        };
        var // Initialize and call the RushaCore,
        // assuming an input buffer of length len * 4.
        coreCall = function (data, chunkOffset, chunkLen, msgLen, finalize) {
            var padChunkLen = chunkLen;
            write(data, chunkOffset, chunkLen);
            if (finalize) {
                padChunkLen = padChunk(chunkLen, msgLen);
            }
            self$2.core.hash(padChunkLen, self$2.padMaxChunkLen);
        };
        var getRawDigest = function (heap, padMaxChunkLen) {
            var io = new Int32Array(heap, padMaxChunkLen + 320, 5);
            var out = new Int32Array(5);
            var arr = new DataView(out.buffer);
            arr.setInt32(0, io[0], false);
            arr.setInt32(4, io[1], false);
            arr.setInt32(8, io[2], false);
            arr.setInt32(12, io[3], false);
            arr.setInt32(16, io[4], false);
            return out;
        };
        var // Calculate the hash digest as an array of 5 32bit integers.
        rawDigest = this.rawDigest = function (str) {
            var msgLen = str.byteLength || str.length || str.size || 0;
            initState(self$2.heap, self$2.padMaxChunkLen);
            var chunkOffset = 0, chunkLen = self$2.maxChunkLen, last;
            for (chunkOffset = 0; msgLen > chunkOffset + chunkLen; chunkOffset += chunkLen) {
                coreCall(str, chunkOffset, chunkLen, msgLen, false);
            }
            coreCall(str, chunkOffset, msgLen - chunkOffset, msgLen, true);
            return getRawDigest(self$2.heap, self$2.padMaxChunkLen);
        };
        // The digest and digestFrom* interface returns the hash digest
        // as a hex string.
        this.digest = this.digestFromString = this.digestFromBuffer = this.digestFromArrayBuffer = function (str) {
            return hex(rawDigest(str).buffer);
        };
        this.resetState = function () {
            initState(self$2.heap, self$2.padMaxChunkLen);
            return this;
        };
        this.append = function (chunk) {
            var chunkOffset = 0;
            var chunkLen = chunk.byteLength || chunk.length || chunk.size || 0;
            var turnOffset = self$2.offset % self$2.maxChunkLen;
            var inputLen;
            self$2.offset += chunkLen;
            while (chunkOffset < chunkLen) {
                inputLen = Math.min(chunkLen - chunkOffset, self$2.maxChunkLen - turnOffset);
                write(chunk, chunkOffset, inputLen, turnOffset);
                turnOffset += inputLen;
                chunkOffset += inputLen;
                if (turnOffset === self$2.maxChunkLen) {
                    self$2.core.hash(self$2.maxChunkLen, self$2.padMaxChunkLen);
                    turnOffset = 0;
                }
            }
            return this;
        };
        this.getState = function () {
            var turnOffset = self$2.offset % self$2.maxChunkLen;
            var heap;
            if (!turnOffset) {
                var io = new Int32Array(self$2.heap, self$2.padMaxChunkLen + 320, 5);
                heap = io.buffer.slice(io.byteOffset, io.byteOffset + io.byteLength);
            } else {
                heap = self$2.heap.slice(0);
            }
            return {
                offset: self$2.offset,
                heap: heap
            };
        };
        this.setState = function (state) {
            self$2.offset = state.offset;
            if (state.heap.byteLength === 20) {
                var io = new Int32Array(self$2.heap, self$2.padMaxChunkLen + 320, 5);
                io.set(new Int32Array(state.heap));
            } else {
                self$2.h32.set(new Int32Array(state.heap));
            }
            return this;
        };
        var rawEnd = this.rawEnd = function () {
            var msgLen = self$2.offset;
            var chunkLen = msgLen % self$2.maxChunkLen;
            var padChunkLen = padChunk(chunkLen, msgLen);
            self$2.core.hash(padChunkLen, self$2.padMaxChunkLen);
            var result = getRawDigest(self$2.heap, self$2.padMaxChunkLen);
            initState(self$2.heap, self$2.padMaxChunkLen);
            return result;
        };
        this.end = function () {
            return hex(rawEnd().buffer);
        };
    }
    ;
    // The low-level RushCore module provides the heart of Rusha,
    // a high-speed sha1 implementation working on an Int32Array heap.
    // At first glance, the implementation seems complicated, however
    // with the SHA1 spec at hand, it is obvious this almost a textbook
    // implementation that has a few functions hand-inlined and a few loops
    // hand-unrolled.
    Rusha._core = function RushaCore(stdlib, foreign, heap) {
        'use asm';
        var H = new stdlib.Int32Array(heap);
        function hash(k, x) {
            // k in bytes
            k = k | 0;
            x = x | 0;
            var i = 0, j = 0, y0 = 0, z0 = 0, y1 = 0, z1 = 0, y2 = 0, z2 = 0, y3 = 0, z3 = 0, y4 = 0, z4 = 0, t0 = 0, t1 = 0;
            y0 = H[x + 320 >> 2] | 0;
            y1 = H[x + 324 >> 2] | 0;
            y2 = H[x + 328 >> 2] | 0;
            y3 = H[x + 332 >> 2] | 0;
            y4 = H[x + 336 >> 2] | 0;
            for (i = 0; (i | 0) < (k | 0); i = i + 64 | 0) {
                z0 = y0;
                z1 = y1;
                z2 = y2;
                z3 = y3;
                z4 = y4;
                for (j = 0; (j | 0) < 64; j = j + 4 | 0) {
                    t1 = H[i + j >> 2] | 0;
                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 & y2 | ~y1 & y3) | 0) + ((t1 + y4 | 0) + 1518500249 | 0) | 0;
                    y4 = y3;
                    y3 = y2;
                    y2 = y1 << 30 | y1 >>> 2;
                    y1 = y0;
                    y0 = t0;
                    H[k + j >> 2] = t1;
                }
                for (j = k + 64 | 0; (j | 0) < (k + 80 | 0); j = j + 4 | 0) {
                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 & y2 | ~y1 & y3) | 0) + ((t1 + y4 | 0) + 1518500249 | 0) | 0;
                    y4 = y3;
                    y3 = y2;
                    y2 = y1 << 30 | y1 >>> 2;
                    y1 = y0;
                    y0 = t0;
                    H[j >> 2] = t1;
                }
                for (j = k + 80 | 0; (j | 0) < (k + 160 | 0); j = j + 4 | 0) {
                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 ^ y2 ^ y3) | 0) + ((t1 + y4 | 0) + 1859775393 | 0) | 0;
                    y4 = y3;
                    y3 = y2;
                    y2 = y1 << 30 | y1 >>> 2;
                    y1 = y0;
                    y0 = t0;
                    H[j >> 2] = t1;
                }
                for (j = k + 160 | 0; (j | 0) < (k + 240 | 0); j = j + 4 | 0) {
                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 & y2 | y1 & y3 | y2 & y3) | 0) + ((t1 + y4 | 0) - 1894007588 | 0) | 0;
                    y4 = y3;
                    y3 = y2;
                    y2 = y1 << 30 | y1 >>> 2;
                    y1 = y0;
                    y0 = t0;
                    H[j >> 2] = t1;
                }
                for (j = k + 240 | 0; (j | 0) < (k + 320 | 0); j = j + 4 | 0) {
                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 ^ y2 ^ y3) | 0) + ((t1 + y4 | 0) - 899497514 | 0) | 0;
                    y4 = y3;
                    y3 = y2;
                    y2 = y1 << 30 | y1 >>> 2;
                    y1 = y0;
                    y0 = t0;
                    H[j >> 2] = t1;
                }
                y0 = y0 + z0 | 0;
                y1 = y1 + z1 | 0;
                y2 = y2 + z2 | 0;
                y3 = y3 + z3 | 0;
                y4 = y4 + z4 | 0;
            }
            H[x + 320 >> 2] = y0;
            H[x + 324 >> 2] = y1;
            H[x + 328 >> 2] = y2;
            H[x + 332 >> 2] = y3;
            H[x + 336 >> 2] = y4;
        }
        return { hash: hash };
    };
    if (// If we'e running in Node.JS, export a module.
        typeof module !== 'undefined') {
        module.exports = Rusha;
    } else if (// If we're running in a DOM context, export
        // the Rusha object to toplevel.
        typeof window !== 'undefined') {
        window.Rusha = Rusha;
    }
    if (// If we're running in a webworker, accept
        // messages containing a jobid and a buffer
        // or blob object, and return the hash result.
        typeof FileReaderSync !== 'undefined') {
        var reader = new FileReaderSync(), hasher = new Rusha(4 * 1024 * 1024);
        self.onmessage = function onMessage(event) {
            var hash, data = event.data.data;
            try {
                hash = hasher.digest(data);
                self.postMessage({
                    id: event.data.id,
                    hash: hash
                });
            } catch (e) {
                self.postMessage({
                    id: event.data.id,
                    error: e.name
                });
            }
        };
    }
}());
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],41:[function(require,module,exports){
var Rusha = require('rusha')

var rusha = new Rusha
var scope = typeof window !== 'undefined' ? window : self
var crypto = scope.crypto || scope.msCrypto || {}
var subtle = crypto.subtle || crypto.webkitSubtle

function sha1sync (buf) {
  return rusha.digest(buf)
}

// Browsers throw if they lack support for an algorithm.
// Promise will be rejected on non-secure origins. (http://goo.gl/lq4gCo)
try {
  subtle.digest({ name: 'sha-1' }, new Uint8Array).catch(function () {
    subtle = false
  })
} catch (err) { subtle = false }

function sha1 (buf, cb) {
  if (!subtle) {
    // Use Rusha
    setTimeout(cb, 0, sha1sync(buf))
    return
  }

  if (typeof buf === 'string') {
    buf = uint8array(buf)
  }

  subtle.digest({ name: 'sha-1' }, buf)
    .then(function succeed (result) {
      cb(hex(new Uint8Array(result)))
    },
    function fail (error) {
      cb(sha1sync(buf))
    })
}

function uint8array (s) {
  var l = s.length
  var array = new Uint8Array(l)
  for (var i = 0; i < l; i++) {
    array[i] = s.charCodeAt(i)
  }
  return array
}

function hex (buf) {
  var l = buf.length
  var chars = []
  for (var i = 0; i < l; i++) {
    var bite = buf[i]
    chars.push((bite >>> 4).toString(16))
    chars.push((bite & 0x0f).toString(16))
  }
  return chars.join('')
}

module.exports = sha1
module.exports.sync = sha1sync

},{"rusha":40}],42:[function(require,module,exports){
/* global Blob */

var once = require('once')

module.exports = function getBlob (stream, mimeType, cb) {
  if (typeof mimeType === 'function') return getBlob(stream, null, mimeType)
  cb = once(cb)
  var chunks = []
  stream
    .on('data', function (chunk) {
      chunks.push(chunk)
    })
    .on('end', function () {
      var blob = mimeType
        ? new Blob(chunks, { type: mimeType })
        : new Blob(chunks)
      cb(null, blob)
    })
    .on('error', cb)
}

},{"once":28}],43:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":12}],44:[function(require,module,exports){
"use strict"

function unique_pred(list, compare) {
  var ptr = 1
    , len = list.length
    , a=list[0], b=list[0]
  for(var i=1; i<len; ++i) {
    b = a
    a = list[i]
    if(compare(a, b)) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique_eq(list) {
  var ptr = 1
    , len = list.length
    , a=list[0], b = list[0]
  for(var i=1; i<len; ++i, b=a) {
    b = a
    a = list[i]
    if(a !== b) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique(list, compare, sorted) {
  if(list.length === 0) {
    return list
  }
  if(compare) {
    if(!sorted) {
      list.sort(compare)
    }
    return unique_pred(list, compare)
  }
  if(!sorted) {
    list.sort()
  }
  return unique_eq(list)
}

module.exports = unique

},{}],45:[function(require,module,exports){
(function (global){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],46:[function(require,module,exports){
// Returns a wrapper function that returns a wrapped callback
// The wrapper function should do some stuff, and return a
// presumably different callback function.
// This makes sure that own properties are retained, so that
// decorations and such are not lost along the way.
module.exports = wrappy
function wrappy (fn, cb) {
  if (fn && cb) return wrappy(fn)(cb)

  if (typeof fn !== 'function')
    throw new TypeError('need wrapper function')

  Object.keys(fn).forEach(function (k) {
    wrapper[k] = fn[k]
  })

  return wrapper

  function wrapper() {
    var args = new Array(arguments.length)
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i]
    }
    var ret = fn.apply(this, args)
    var cb = args[args.length-1]
    if (typeof ret === 'function' && ret !== cb) {
      Object.keys(cb).forEach(function (k) {
        ret[k] = cb[k]
      })
    }
    return ret
  }
}

},{}],47:[function(require,module,exports){
(function (global){
self.global = self // eslint-disable-line

require('debug').enable('planktos:*')
var debug = require('debug')('planktos:sw')
var planktos = require('.')
var injection = require('./lib/injection')

var scope = global.location.pathname.substring(0, global.location.pathname.lastIndexOf('/'))
var available = {}
var delegator = null

global.addEventListener('fetch', onFetch)
global.addEventListener('activate', onActivate)
global.addEventListener('install', onInstall)
global.addEventListener('message', onMessage)

assignDelegator()

function onFetch (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.replace(scope, '').substr(1)
  var search = url.search.substr(1).split('&')

  if (url.host !== global.location.host || event.request.method !== 'GET') return
  if (planktos.preCached.indexOf('/' + name) === -1 && name.startsWith('planktos/')) return
  if (name === '') name = 'index.html' // TODO handle case when file is not top level

  assignDelegator()

  debug('FETCH', 'clientId=' + event.clientId, 'url=' + name)

  // TODO let browser handle request if file is not in torrent
  if (planktos.preCached.indexOf('/' + name) !== -1) {
    return event.respondWith(global.caches.open('planktos')
    .then(cache => cache.match(scope + '/' + name)))
  } else if (event.clientId == null && search.indexOf('noPlanktosInjection') === -1) {
    var modUrl = new URL(url.toString())
    modUrl.search = (url.search === '' ? '?' : url.search + '&') + 'noPlanktosInjection'
    var template = name.endsWith('html') || name.endsWith('htm')
      ? injection.docWrite : injection.iframe
    var html = template.replace('{{url}}', modUrl.toString()).replace('{{scope}}', scope)
    return event.respondWith(new Response(new Blob([html], {type: 'text/html'})))
  } else {
    // TODO handle RANGE header
    return event.respondWith(planktos.getFileBlob(name)
    .then(blob => new Response(blob))
    .catch(err => {
      if (err.message !== 'File not found') debug('FETCH-ERROR', err)
      return global.fetch(event.request)
    }))
  }
}

function onActivate () {
  debug('ACTIVATE')
}

function onInstall (event) {
  debug('INSTALL')
  var update = planktos.update(scope)
  update.then(() => planktos.getManifest())
  .then((manifest) => debug('MANIFEST', manifest))
  .then(() => planktos.getTorrentMeta())
  .then((torrentMeta) => debug('TORRENT', torrentMeta))
  event.waitUntil(update)
}

function onMessage (event) {
  if (!event.data.planktos) return
  debug('MESSAGE', event.data)
  if (event.data.type === 'available') {
    available[event.source.id] = true
    assignDelegator()
  } else if (event.data.type === 'unavailable') {
    delete available[event.source.id]
    assignDelegator()
  }
}

function assignDelegator () {
  this.clients.matchAll({type: 'window'}).then(clients => {
    var potentials = clients.filter(c => c.id in available)
    var redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    if (potentials.length === 0) {
      clients.forEach(c => c.postMessage({
        type: 'request_availability',
        planktos: true
      }))
    } else if (redelegate) {
      debug('ASSIGN', 'old=' + (delegator ? delegator.id : null), 'new=' + potentials[0].id)
      delegator = potentials[0]
      planktos.getTorrentMetaBuffer().then(buffer => {
        if (delegator !== potentials[0]) return
        clients.filter(c => c.id !== delegator.id).forEach(c => c.postMessage({
          type: 'cancel_download',
          planktos: true
        }))
        delegator.postMessage({
          type: 'download',
          torrentId: buffer,
          planktos: true
        })
      })
    }
  })
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{".":1,"./lib/injection":3,"debug":17}]},{},[47])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9kb3dubG9hZGVyLmpzIiwibGliL2luamVjdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9iYXNlNjQtanMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYmVuY29kZS9saWIvZGVjb2RlLmpzIiwibm9kZV9tb2R1bGVzL2JlbmNvZGUvbGliL2VuY29kZS5qcyIsIm5vZGVfbW9kdWxlcy9iZW5jb2RlL2xpYi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9ibG9jay1zdHJlYW0yL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Jyb3dzZXItcmVzb2x2ZS9lbXB0eS5qcyIsIm5vZGVfbW9kdWxlcy9idWZmZXItc2hpbXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2NodW5rLXN0b3JlLXN0cmVhbS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9jaHVuay1zdG9yZS1zdHJlYW0vcmVhZC5qcyIsIm5vZGVfbW9kdWxlcy9jaHVuay1zdG9yZS1zdHJlYW0vd3JpdGUuanMiLCJub2RlX21vZHVsZXMvY29yZS11dGlsLWlzL2xpYi91dGlsLmpzIiwibm9kZV9tb2R1bGVzL2RlYnVnL2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvZGVidWcvZGVidWcuanMiLCJub2RlX21vZHVsZXMvZGVmaW5lZC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIiwibm9kZV9tb2R1bGVzL2lkYi1rdi1zdG9yZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2luZGV4ZGItY2h1bmstc3RvcmUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvaW5oZXJpdHMvaW5oZXJpdHNfYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9pcy1idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvaXNhcnJheS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9tcy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9vbmNlL29uY2UuanMiLCJub2RlX21vZHVsZXMvcGFyc2UtdG9ycmVudC1maWxlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BhdGgtYnJvd3NlcmlmeS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wcm9jZXNzLW5leHRpY2stYXJncy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9fc3RyZWFtX2R1cGxleC5qcyIsIm5vZGVfbW9kdWxlcy9yZWFkYWJsZS1zdHJlYW0vbGliL19zdHJlYW1fcGFzc3Rocm91Z2guanMiLCJub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9fc3RyZWFtX3JlYWRhYmxlLmpzIiwibm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9saWIvX3N0cmVhbV90cmFuc2Zvcm0uanMiLCJub2RlX21vZHVsZXMvcmVhZGFibGUtc3RyZWFtL2xpYi9fc3RyZWFtX3dyaXRhYmxlLmpzIiwibm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9saWIvaW50ZXJuYWwvc3RyZWFtcy9CdWZmZXJMaXN0LmpzIiwibm9kZV9tb2R1bGVzL3JlYWRhYmxlLXN0cmVhbS9yZWFkYWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9ydXNoYS9ydXNoYS5qcyIsIm5vZGVfbW9kdWxlcy9zaW1wbGUtc2hhMS9icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3N0cmVhbS10by1ibG9iL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3N0cmluZ19kZWNvZGVyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3VuaXEvdW5pcS5qcyIsIm5vZGVfbW9kdWxlcy91dGlsLWRlcHJlY2F0ZS9icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3dyYXBweS93cmFwcHkuanMiLCJzdy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQy9LQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDbEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3JIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUMzR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ25EQTs7Ozs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUM1R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzd2REE7QUFDQTtBQUNBOztBQ0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQzNHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ3ZMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNySkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNuSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2hPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDM0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDNTZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNyTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ3ppQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDN2VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDekRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNuRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBnbG9iYWwgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdyA6IHNlbGYgLy8gZXNsaW50LWRpc2FibGUtbGluZVxuXG4vLyBUZW1wIGJ1ZyBmaXg6IGh0dHBzOi8vZ2l0aHViLmNvbS9zcmlqcy9ydXNoYS9pc3N1ZXMvMzlcbmlmIChnbG9iYWwuV29ya2VyR2xvYmFsU2NvcGUpIGRlbGV0ZSBnbG9iYWwuRmlsZVJlYWRlclN5bmNcblxudmFyIHByZUNhY2hlZCA9IFtcbiAgJy9wbGFua3Rvcy9yb290LnRvcnJlbnQnLFxuICAnL3BsYW5rdG9zL21hbmlmZXN0Lmpzb24nLFxuICAnL3BsYW5rdG9zL3BsYW5rdG9zLmpzJyxcbiAgJy9wbGFua3Rvcy9pbnN0YWxsLmpzJ1xuXVxuXG4vLyBUT0RPIGFkZCBnZXRGaWxlU3RyZWFtXG5tb2R1bGUuZXhwb3J0cy5nZXRGaWxlQmxvYiA9IGdldEZpbGVCbG9iXG5tb2R1bGUuZXhwb3J0cy51cGRhdGUgPSB1cGRhdGVcbm1vZHVsZS5leHBvcnRzLnByZUNhY2hlZCA9IHByZUNhY2hlZCAvLyBUT0RPIGJldHRlciB3YXkgdG8gaGFuZGxlIHByZUNhY2hlZFxubW9kdWxlLmV4cG9ydHMuZ2V0TWFuaWZlc3QgPSBnZXRNYW5pZmVzdFxubW9kdWxlLmV4cG9ydHMuZ2V0RG93bmxvYWRlZCA9IGdldERvd25sb2FkZWRcbm1vZHVsZS5leHBvcnRzLmdldFRvcnJlbnRNZXRhID0gZ2V0VG9ycmVudE1ldGFcbm1vZHVsZS5leHBvcnRzLmdldFRvcnJlbnRNZXRhQnVmZmVyID0gZ2V0VG9ycmVudE1ldGFCdWZmZXJcbm1vZHVsZS5leHBvcnRzLmRvd25sb2FkZXIgPSByZXF1aXJlKCcuL2xpYi9kb3dubG9hZGVyJylcblxudmFyIENodW5rU3RyZWFtID0gcmVxdWlyZSgnY2h1bmstc3RvcmUtc3RyZWFtJylcbnZhciBJZGJDaHVua1N0b3JlID0gcmVxdWlyZSgnaW5kZXhkYi1jaHVuay1zdG9yZScpXG52YXIgSWRiS3ZTdG9yZSA9IHJlcXVpcmUoJ2lkYi1rdi1zdG9yZScpXG52YXIgdG9CbG9iID0gcmVxdWlyZSgnc3RyZWFtLXRvLWJsb2InKVxudmFyIHBhcnNlVG9ycmVudCA9IHJlcXVpcmUoJ3BhcnNlLXRvcnJlbnQtZmlsZScpXG5cbnZhciB3YWl0aW5nRmV0Y2hlcyA9IHt9XG52YXIgcGVyc2lzdGVudCA9IG5ldyBJZGJLdlN0b3JlKCdwbGFua3RvcycpXG52YXIgZG93bmxvYWRlZCA9IG5ldyBJZGJLdlN0b3JlKCdwbGFua3Rvcy1kb3dubG9hZGVkJylcbnZhciBjaHVua1N0b3JlID0gbnVsbFxudmFyIGRvd25sb2FkQ2hhbm5lbCA9IG51bGxcblxuZnVuY3Rpb24gZ2V0RG93bmxvYWRlZCAoKSB7XG4gIHJldHVybiBkb3dubG9hZGVkLmpzb24oKVxufVxuXG5mdW5jdGlvbiBnZXRNYW5pZmVzdCAoKSB7XG4gIHJldHVybiBwZXJzaXN0ZW50LmdldCgnbWFuaWZlc3QnKVxufVxuXG5mdW5jdGlvbiBnZXRUb3JyZW50TWV0YSAoKSB7XG4gIHJldHVybiBwZXJzaXN0ZW50LmdldCgndG9ycmVudE1ldGEnKVxufVxuXG5mdW5jdGlvbiBnZXRUb3JyZW50TWV0YUJ1ZmZlciAoKSB7IC8vIFRPRE8gRml4IHBhcnNpbmcgYnVnIHNvIHRoaXMgY2FuIGJlIHJlbW92ZWRcbiAgcmV0dXJuIHBlcnNpc3RlbnQuZ2V0KCd0b3JyZW50TWV0YUJ1ZmZlcicpXG59XG5cbmZ1bmN0aW9uIGdldEZpbGVCbG9iIChmaWxlUGF0aCkge1xuICBpZiAodHlwZW9mIEJyb2FkY2FzdENoYW5uZWwgPT09ICd1bmRlZmluZWQnKSB0aHJvdyBuZXcgRXJyb3IoJ05vIEJyb2FkY2FzdENoYW5uZWwgc3VwcG9ydCcpXG5cbiAgaWYgKCFkb3dubG9hZENoYW5uZWwpIHtcbiAgICBkb3dubG9hZENoYW5uZWwgPSBuZXcgQnJvYWRjYXN0Q2hhbm5lbCgncGxhbmt0b3MtZG93bmxvYWRlZCcpXG4gICAgZG93bmxvYWRDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBvbkRvd25sb2FkKVxuICB9XG5cbiAgcmV0dXJuIHBlcnNpc3RlbnQuZ2V0KFsnbWFuaWZlc3QnLCAndG9ycmVudE1ldGEnXSkudGhlbihyZXN1bHQgPT4ge1xuICAgIHZhciBbbWFuaWZlc3QsIHRvcnJlbnRNZXRhXSA9IHJlc3VsdFxuXG4gICAgbGV0IGdldEZpbGVuYW1lID0gKGZpbGVQYXRoKSA9PiBmaWxlUGF0aC5zbGljZShmaWxlUGF0aC5sYXN0SW5kZXhPZignLycpICsgMSlcbiAgICBsZXQgZmlsZVBhdGhJc0RpciA9IChmaWxlUGF0aCkgPT4gZmlsZVBhdGguZW5kc1dpdGgoJy8nKVxuICAgIGxldCBmaWxlbmFtZUhhc0V4dGVuc2lvbiA9IChmaWxlbmFtZSkgPT4gZmlsZW5hbWUuaW5kZXhPZignLicpICE9PSAtMVxuXG4gICAgLy8gVHJ5IHRvIGNvZXJjZSBleHRlbnNpb24tbGVzcyBmaWxlcyBpbnRvIGRpcmVjdG9yaWVzXG4gICAgaWYgKCFmaWxlUGF0aElzRGlyKGZpbGVQYXRoKSAmJiAhZmlsZW5hbWVIYXNFeHRlbnNpb24oZ2V0RmlsZW5hbWUoZmlsZVBhdGgpKSkge1xuICAgICAgLy8gU2luY2UgZGlyZWN0b3JpZXMgYXJlIG5vdCBzdG9yZWQgaW4gdGhlIG1hbmlmZXN0LCB3ZSBjYW4gb25seSBzYWZlbHkgYXNzdW1lIGFuIGV4dGVuc2lvbi1sZXNzXG4gICAgICAvLyBmaWxlIGlzIGEgZGlyZXRvcnkgaWYgKDEpIHRoZSBmaWxlIGlzbid0IGluIHRoZSBtYW5pZmVzdCBhbmQgKDIpIHRoZXJlIGFyZSBmaWxlcyB3aGljaFxuICAgICAgLy8gYXJlIGluIHN1YmRpcmVjdG9yaWVzIHJlbGF0aXZlIHRvIHRoZSBmaWxlIHBhdGhcbiAgICAgIGlmIChPYmplY3Qua2V5cyhtYW5pZmVzdCkuaW5kZXhPZihmaWxlUGF0aCkgPT09IC0xICYmXG4gICAgICAgICAgT2JqZWN0LmtleXMobWFuaWZlc3QpLmZpbmQoKGZwYXRoKSA9PiBmcGF0aC5zdGFydHNXaXRoKGZpbGVQYXRoICsgJy8nKSkpIHtcbiAgICAgICAgZmlsZVBhdGggKz0gJy8nXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVHJ5IHRvIGZpbmQgYW4gaW5kZXggZmlsZSBpZiBgZmlsZVBhdGhgIGlzIGEgZGlyZWN0b3J5XG4gICAgaWYgKGZpbGVQYXRoSXNEaXIoZmlsZVBhdGgpKSB7XG4gICAgICBsZXQgZmlsZXNJbkRpcmVjdG9yeSA9IE9iamVjdC5rZXlzKG1hbmlmZXN0KS5maWx0ZXIoXG4gICAgICAgIChmcGF0aCkgPT4gZnBhdGguc3RhcnRzV2l0aChmaWxlUGF0aClcbiAgICAgICkubWFwKGdldEZpbGVuYW1lKVxuXG4gICAgICAvLyBJbmRleCBmaWxlcyBhcmUgbGlzdGVkIGluIG9yZGVyIG9mIHByaW9yaXR5XG4gICAgICBsZXQgaW5kZXhGaWxlbmFtZSA9IFsnaW5kZXguaHRtbCcsICdpbmRleC5odG0nXS5maW5kKChmbmFtZSkgPT4gZmlsZXNJbkRpcmVjdG9yeS5pbmNsdWRlcyhmbmFtZSkpXG5cbiAgICAgIGlmIChpbmRleEZpbGVuYW1lID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcignRmlsZSBub3QgZm91bmQnKVxuXG4gICAgICBmaWxlUGF0aCArPSBpbmRleEZpbGVuYW1lXG4gICAgfVxuXG4gICAgdmFyIGhhc2ggPSBtYW5pZmVzdFtmaWxlUGF0aF1cbiAgICB2YXIgZmlsZUluZm8gPSB0b3JyZW50TWV0YS5maWxlcy5maW5kKGYgPT4gZi5uYW1lID09PSBoYXNoKVxuXG4gICAgaWYgKCFmaWxlSW5mbykge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBFcnJvcignRmlsZSBub3QgZm91bmQnKSlcbiAgICB9XG5cbiAgICBjaHVua1N0b3JlID0gY2h1bmtTdG9yZSB8fCBuZXcgSWRiQ2h1bmtTdG9yZSh0b3JyZW50TWV0YS5waWVjZUxlbmd0aCwge25hbWU6IHRvcnJlbnRNZXRhLmluZm9IYXNofSlcblxuICAgIHJldHVybiBkb3dubG9hZGVkLmdldChoYXNoKS50aGVuKGlzRG93bmxvYWRlZCA9PiB7XG4gICAgICBpZiAoaXNEb3dubG9hZGVkKSB7XG4gICAgICAgIHZhciBzdHJlYW0gPSBDaHVua1N0cmVhbS5yZWFkKGNodW5rU3RvcmUsIGNodW5rU3RvcmUuY2h1bmtMZW5ndGgsIHtcbiAgICAgICAgICBsZW5ndGg6IHRvcnJlbnRNZXRhLmxlbmd0aFxuICAgICAgICB9KVxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICAgIHRvQmxvYihzdHJlYW0sIGZ1bmN0aW9uIChlcnIsIGJsb2IpIHtcbiAgICAgICAgICAgIGlmIChlcnIpIHJldHVybiByZWplY3QoZXJyKVxuICAgICAgICAgICAgcmVzb2x2ZShibG9iLnNsaWNlKGZpbGVJbmZvLm9mZnNldCwgZmlsZUluZm8ub2Zmc2V0ICsgZmlsZUluZm8ubGVuZ3RoKSlcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRGVmZXIgdW50aWwgdGhlIGZpbGUgZmluaXNoZXMgZG93bmxvYWRpbmdcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlKSB7XG4gICAgICAgICAgaWYgKCF3YWl0aW5nRmV0Y2hlc1toYXNoXSkgd2FpdGluZ0ZldGNoZXNbaGFzaF0gPSBbXVxuICAgICAgICAgIHdhaXRpbmdGZXRjaGVzW2hhc2hdLnB1c2gocmVzb2x2ZSlcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9KVxuICB9KVxufVxuXG5mdW5jdGlvbiB1cGRhdGUgKHVybCkge1xuICBpZiAoIXVybCkgdXJsID0gJydcbiAgaWYgKHVybC5lbmRzV2l0aCgnLycpKSB1cmwgPSB1cmwuc3Vic3RyKDAsIHVybC5sZW5ndGggLSAxKVxuXG4gIHZhciBjYWNoZVByb21pc2UgPSBnbG9iYWwuY2FjaGVzLm9wZW4oJ3BsYW5rdG9zJylcbiAgLnRoZW4oKGNhY2hlKSA9PiBjYWNoZS5hZGRBbGwocHJlQ2FjaGVkLm1hcChmID0+IHVybCArIGYpKSlcbiAgLnRoZW4oKCkgPT4gZ2xvYmFsLmNhY2hlcy5vcGVuKCdwbGFua3RvcycpKVxuXG4gIHZhciBtYW5pZmVzdFByb21pc2UgPSBjYWNoZVByb21pc2VcbiAgLnRoZW4oY2FjaGUgPT4gY2FjaGUubWF0Y2godXJsICsgJy9wbGFua3Rvcy9tYW5pZmVzdC5qc29uJykpXG4gIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSlcbiAgLnRoZW4oanNvbiA9PiB7XG4gICAgcmV0dXJuIHBlcnNpc3RlbnQuc2V0KCdtYW5pZmVzdCcsIGpzb24pXG4gIH0pXG5cbiAgdmFyIHRvcnJlbnRQcm9taXNlID0gY2FjaGVQcm9taXNlXG4gIC50aGVuKGNhY2hlID0+IGNhY2hlLm1hdGNoKHVybCArICcvcGxhbmt0b3Mvcm9vdC50b3JyZW50JykpXG4gIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmFycmF5QnVmZmVyKCkpXG4gIC50aGVuKGFycmF5QnVmZmVyID0+IHtcbiAgICB2YXIgYnVmZmVyID0gQnVmZmVyLmZyb20oYXJyYXlCdWZmZXIpXG4gICAgdmFyIHBhcnNlZCA9IHBhcnNlVG9ycmVudChidWZmZXIpXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFtcbiAgICAgIHBlcnNpc3RlbnQuc2V0KCd0b3JyZW50TWV0YUJ1ZmZlcicsIGJ1ZmZlciksXG4gICAgICBwZXJzaXN0ZW50LnNldCgndG9ycmVudE1ldGEnLCBwYXJzZWQpXG4gICAgXSlcbiAgfSlcblxuICByZXR1cm4gUHJvbWlzZS5hbGwoW1xuICAgIG1hbmlmZXN0UHJvbWlzZSxcbiAgICB0b3JyZW50UHJvbWlzZVxuICBdKVxufVxuXG5mdW5jdGlvbiBvbkRvd25sb2FkICgpIHtcbiAgcmV0dXJuIFByb21pc2UuYWxsKFtcbiAgICBwZXJzaXN0ZW50LmdldCgnbWFuaWZlc3QnKSxcbiAgICBkb3dubG9hZGVkLmpzb24oKVxuICBdKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgdmFyIFttYW5pZmVzdCwgZG93bmxvYWRlZF0gPSByZXN1bHRcbiAgICBmb3IgKHZhciBoYXNoIGluIGRvd25sb2FkZWQpIHtcbiAgICAgIGlmIChoYXNoIGluIHdhaXRpbmdGZXRjaGVzKSB7XG4gICAgICAgIHZhciBmaWxlUGF0aCA9IE9iamVjdC5rZXlzKG1hbmlmZXN0KS5maW5kKGZuYW1lID0+IG1hbmlmZXN0W2ZuYW1lXSA9PT0gaGFzaClcbiAgICAgICAgdmFyIHdhaXRlcnMgPSB3YWl0aW5nRmV0Y2hlc1toYXNoXVxuICAgICAgICBkZWxldGUgd2FpdGluZ0ZldGNoZXNbaGFzaF1cbiAgICAgICAgZ2V0RmlsZUJsb2IoZmlsZVBhdGgpXG4gICAgICAgIC50aGVuKGIgPT4ge1xuICAgICAgICAgIGZvciAodmFyIHAgb2Ygd2FpdGVycykge1xuICAgICAgICAgICAgcChiKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gIH0pXG59XG4iLCJtb2R1bGUuZXhwb3J0cy5pbnN0YWxsID0gaW5zdGFsbFxuXG5yZXF1aXJlKCdkZWJ1ZycpLmVuYWJsZSgncGxhbmt0b3M6KicpXG52YXIgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdwbGFua3Rvczpkb3dubG9hZGVyJylcbnZhciBXZWJUb3JyZW50ID0gcmVxdWlyZSgnd2VidG9ycmVudCcpXG52YXIgSWRiQ2h1bmtTdG9yZSA9IHJlcXVpcmUoJ2luZGV4ZGItY2h1bmstc3RvcmUnKVxudmFyIElkYkt2U3RvcmUgPSByZXF1aXJlKCdpZGIta3Ytc3RvcmUnKVxuXG52YXIgd2VidG9ycmVudCA9IG51bGxcbnZhciBkb3dubG9hZGVkID0gbnVsbFxudmFyIGluc3RhbGxlZCA9IGZhbHNlXG5cbmZ1bmN0aW9uIGluc3RhbGwgKCkge1xuICBpZiAodHlwZW9mIEJyb2FkY2FzdENoYW5uZWwgPT09ICd1bmRlZmluZWQnKSB0aHJvdyBuZXcgRXJyb3IoJ05vIEJyb2FkY2FzdENoYW5uZWwgc3VwcG9ydCcpXG4gIGlmICh0eXBlb2YgbmF2aWdhdG9yID09PSAndW5kZWZpbmVkJykgdGhyb3cgbmV3IEVycm9yKCdtdXN0IGJlIGNhbGxlZCBpbiBhIHdlcCBwYWdlJylcbiAgaWYgKCFuYXZpZ2F0b3Iuc2VydmljZVdvcmtlcikgdGhyb3cgbmV3IEVycm9yKCdObyBzZXJ2aWVyIHdvcmtlciBzdXBwb3J0JylcbiAgaWYgKGluc3RhbGxlZCkgcmV0dXJuXG5cbiAgaW5zdGFsbGVkID0gdHJ1ZVxuICBuYXZpZ2F0b3Iuc2VydmljZVdvcmtlci5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgb25NZXNzYWdlKVxuICBuYXZpZ2F0b3Iuc2VydmljZVdvcmtlci5hZGRFdmVudExpc3RlbmVyKCdjb250cm9sbGVyY2hhbmdlJywgb25Db250cm9sbGVyQ2hhbmdlKVxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignYmVmb3JldW5sb2FkJywgb25CZWZvclVubG9hZClcblxuICBvbkNvbnRyb2xsZXJDaGFuZ2UoKVxufVxuXG5mdW5jdGlvbiBvbkNvbnRyb2xsZXJDaGFuZ2UgKCkge1xuICBpZiAoIW5hdmlnYXRvci5zZXJ2aWNlV29ya2VyLmNvbnRyb2xsZXIpIHJldHVyblxuICBuYXZpZ2F0b3Iuc2VydmljZVdvcmtlci5jb250cm9sbGVyLnBvc3RNZXNzYWdlKHtcbiAgICB0eXBlOiAnYXZhaWxhYmxlJyxcbiAgICBwbGFua3RvczogdHJ1ZVxuICB9KVxufVxuXG5mdW5jdGlvbiBvbkJlZm9yVW5sb2FkICgpIHtcbiAgaWYgKCFuYXZpZ2F0b3Iuc2VydmljZVdvcmtlci5jb250cm9sbGVyKSByZXR1cm5cbiAgbmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIuY29udHJvbGxlci5wb3N0TWVzc2FnZSh7XG4gICAgdHlwZTogJ3VuYXZhaWxhYmxlJyxcbiAgICBwbGFua3RvczogdHJ1ZVxuICB9KVxufVxuXG5mdW5jdGlvbiBvbk1lc3NhZ2UgKGV2ZW50KSB7XG4gIGlmICghZXZlbnQuZGF0YS5wbGFua3RvcykgcmV0dXJuXG4gIGRlYnVnKCdNRVNTQUdFJywgZXZlbnQuZGF0YSlcbiAgaWYgKGV2ZW50LmRhdGEudHlwZSA9PT0gJ2Rvd25sb2FkJykge1xuICAgIGRvd25sb2FkKG5ldyBCdWZmZXIoZXZlbnQuZGF0YS50b3JyZW50SWQpKVxuICB9IGVsc2UgaWYgKGV2ZW50LmRhdGEudHlwZSA9PT0gJ3JlcXVlc3RfYXZhaWxhYmlsaXR5Jykge1xuICAgIG5hdmlnYXRvci5zZXJ2aWNlV29ya2VyLmNvbnRyb2xsZXIucG9zdE1lc3NhZ2Uoe1xuICAgICAgdHlwZTogJ2F2YWlsYWJsZScsXG4gICAgICBwbGFua3RvczogdHJ1ZVxuICAgIH0pXG4gIH0gZWxzZSBpZiAoZXZlbnQuZGF0YS50eXBlID09PSAnY2FuY2VsX2Rvd25sb2FkJykge1xuICAgIGlmICh3ZWJ0b3JyZW50KSB3ZWJ0b3JyZW50LmRlc3Ryb3koKVxuICAgIHdlYnRvcnJlbnQgPSBudWxsXG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIHR5cGU6ICcgKyBldmVudC5kYXRhLnR5cGUpXG4gIH1cbn1cblxuZnVuY3Rpb24gZG93bmxvYWQgKHRvcnJlbnRJZCkge1xuICBkb3dubG9hZGVkID0gZG93bmxvYWRlZCB8fCBuZXcgSWRiS3ZTdG9yZSgncGxhbmt0b3MtZG93bmxvYWRlZCcpXG4gIHdlYnRvcnJlbnQgPSB3ZWJ0b3JyZW50IHx8IG5ldyBXZWJUb3JyZW50KClcblxuICB2YXIgb3B0cyA9IHtzdG9yZTogSWRiQ2h1bmtTdG9yZX1cbiAgd2VidG9ycmVudC5hZGQodG9ycmVudElkLCBvcHRzLCBmdW5jdGlvbiAodG9ycmVudCkge1xuICAgIGlmICh0b3JyZW50LnVybExpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgICB2YXIgc3dVcmwgPSBuYXZpZ2F0b3Iuc2VydmljZVdvcmtlci5jb250cm9sbGVyLnNjcmlwdFVSTFxuICAgICAgdG9ycmVudC5hZGRXZWJTZWVkKHN3VXJsLnN1YnN0cmluZygwLCBzd1VybC5sYXN0SW5kZXhPZignLycpKSlcbiAgICB9XG4gICAgdG9ycmVudC5vbignZG9uZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgIGRlYnVnKCdUT1JSRU5UIERPV05MT0FERUQnLCB0b3JyZW50LmZpbGVzLm1hcChmID0+IGYubmFtZSkpXG4gICAgICB2YXIgY2hhbm5lbCA9IG5ldyBCcm9hZGNhc3RDaGFubmVsKCdwbGFua3Rvcy1kb3dubG9hZGVkJylcbiAgICAgIHRvcnJlbnQuZmlsZXMuZm9yRWFjaChmdW5jdGlvbiAoZikge1xuICAgICAgICBkb3dubG9hZGVkLnNldChmLm5hbWUsIHRydWUpXG4gICAgICAgIC50aGVuKCgpID0+IGNoYW5uZWwucG9zdE1lc3NhZ2UoeyBuYW1lOiBmLm5hbWUgfSkpXG4gICAgICB9KVxuICAgIH0pXG4gIH0pXG59XG4iLCJtb2R1bGUuZXhwb3J0cy5pZnJhbWUgPSBgXFxcbjwhZG9jdHlwZSBodG1sPlxuPGh0bWw+XG48aGVhZD5cbiAgPG1ldGEgY2hhcnNldD1cInV0Zi04XCI+XG4gIDxtZXRhIG5hbWU9XCJ2aWV3cG9ydFwiIGNvbnRlbnQ9XCJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MVwiPlxuICA8c3R5bGUgdHlwZT1cInRleHQvY3NzXCI+XG4gICAgaHRtbCB7b3ZlcmZsb3c6IGF1dG87fVxuICAgIGh0bWwsIGJvZHksIGRpdiwgaWZyYW1lIHttYXJnaW46IDBweDsgcGFkZGluZzogMHB4OyBoZWlnaHQ6IDEwMCU7IGJvcmRlcjogbm9uZTt9XG4gICAgaWZyYW1lIHtkaXNwbGF5OiBibG9jazsgd2lkdGg6IDEwMCU7IGJvcmRlcjogbm9uZTsgb3ZlcmZsb3cteTogYXV0bzsgb3ZlcmZsb3cteDogaGlkZGVuO31cbiAgPC9zdHlsZT5cbjwvaGVhZD5cbjxib2R5PlxuICA8aWZyYW1lIGlkPVwidHJlZVwiIG5hbWU9XCJ0cmVlXCIgc3JjPVwie3t1cmx9fVwiIGZyYW1lYm9yZGVyPVwiMFwiIG1hcmdpbmhlaWdodD1cIjBcIiBtYXJnaW53aWR0aD1cIjBcIiB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgc2Nyb2xsaW5nPVwiYXV0b1wiPjwvaWZyYW1lPlxuICA8c2NyaXB0IHNyYz1cInt7c2NvcGV9fS9wbGFua3Rvcy9wbGFua3Rvcy5qc1wiPjwvc2NyaXB0PlxuICA8c2NyaXB0PlxuICAgIHBsYW5rdG9zLmRvd25sb2FkZXIuaW5zdGFsbCgpXG4gIDwvc2NyaXB0PlxuPC9ib2R5PlxuPC9odG1sPlxuYFxuXG5tb2R1bGUuZXhwb3J0cy5kb2NXcml0ZSA9IGBcXFxuPCFkb2N0eXBlIGh0bWw+XG48aHRtbD5cbjxoZWFkPlxuICA8bWV0YSBjaGFyc2V0PVwidXRmLThcIj5cbiAgPHNjcmlwdCBzcmM9XCJ7e3Njb3BlfX0vcGxhbmt0b3MvcGxhbmt0b3MuanNcIj48L3NjcmlwdD5cbiAgPHNjcmlwdD5cbiAgICBwbGFua3Rvcy5kb3dubG9hZGVyLmluc3RhbGwoKVxuICAgIGZldGNoKCd7e3VybH19JylcbiAgICAudGhlbihyZXNwID0+IHJlc3AudGV4dCgpKVxuICAgIC50aGVuKHRleHQgPT4ge1xuICAgICAgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmlubmVySFRNTCA9IHRleHRcbiAgICB9KVxuICA8L3NjcmlwdD5cbjwvaGVhZD5cbjxib2R5PlxuPC9ib2R5PlxuPC9odG1sPlxuYFxuIiwiJ3VzZSBzdHJpY3QnXG5cbmV4cG9ydHMuYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGhcbmV4cG9ydHMudG9CeXRlQXJyYXkgPSB0b0J5dGVBcnJheVxuZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gZnJvbUJ5dGVBcnJheVxuXG52YXIgbG9va3VwID0gW11cbnZhciByZXZMb29rdXAgPSBbXVxudmFyIEFyciA9IHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJyA/IFVpbnQ4QXJyYXkgOiBBcnJheVxuXG52YXIgY29kZSA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJ1xuZm9yICh2YXIgaSA9IDAsIGxlbiA9IGNvZGUubGVuZ3RoOyBpIDwgbGVuOyArK2kpIHtcbiAgbG9va3VwW2ldID0gY29kZVtpXVxuICByZXZMb29rdXBbY29kZS5jaGFyQ29kZUF0KGkpXSA9IGlcbn1cblxucmV2TG9va3VwWyctJy5jaGFyQ29kZUF0KDApXSA9IDYyXG5yZXZMb29rdXBbJ18nLmNoYXJDb2RlQXQoMCldID0gNjNcblxuZnVuY3Rpb24gcGxhY2VIb2xkZXJzQ291bnQgKGI2NCkge1xuICB2YXIgbGVuID0gYjY0Lmxlbmd0aFxuICBpZiAobGVuICUgNCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuICB9XG5cbiAgLy8gdGhlIG51bWJlciBvZiBlcXVhbCBzaWducyAocGxhY2UgaG9sZGVycylcbiAgLy8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuICAvLyByZXByZXNlbnQgb25lIGJ5dGVcbiAgLy8gaWYgdGhlcmUgaXMgb25seSBvbmUsIHRoZW4gdGhlIHRocmVlIGNoYXJhY3RlcnMgYmVmb3JlIGl0IHJlcHJlc2VudCAyIGJ5dGVzXG4gIC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2VcbiAgcmV0dXJuIGI2NFtsZW4gLSAyXSA9PT0gJz0nID8gMiA6IGI2NFtsZW4gLSAxXSA9PT0gJz0nID8gMSA6IDBcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoYjY0KSB7XG4gIC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuICByZXR1cm4gYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzQ291bnQoYjY0KVxufVxuXG5mdW5jdGlvbiB0b0J5dGVBcnJheSAoYjY0KSB7XG4gIHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG4gIHZhciBsZW4gPSBiNjQubGVuZ3RoXG4gIHBsYWNlSG9sZGVycyA9IHBsYWNlSG9sZGVyc0NvdW50KGI2NClcblxuICBhcnIgPSBuZXcgQXJyKGxlbiAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG4gIC8vIGlmIHRoZXJlIGFyZSBwbGFjZWhvbGRlcnMsIG9ubHkgZ2V0IHVwIHRvIHRoZSBsYXN0IGNvbXBsZXRlIDQgY2hhcnNcbiAgbCA9IHBsYWNlSG9sZGVycyA+IDAgPyBsZW4gLSA0IDogbGVuXG5cbiAgdmFyIEwgPSAwXG5cbiAgZm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuICAgIHRtcCA9IChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSldIDw8IDE4KSB8IChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSArIDEpXSA8PCAxMikgfCAocmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkgKyAyKV0gPDwgNikgfCByZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSArIDMpXVxuICAgIGFycltMKytdID0gKHRtcCA+PiAxNikgJiAweEZGXG4gICAgYXJyW0wrK10gPSAodG1wID4+IDgpICYgMHhGRlxuICAgIGFycltMKytdID0gdG1wICYgMHhGRlxuICB9XG5cbiAgaWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuICAgIHRtcCA9IChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSldIDw8IDIpIHwgKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMSldID4+IDQpXG4gICAgYXJyW0wrK10gPSB0bXAgJiAweEZGXG4gIH0gZWxzZSBpZiAocGxhY2VIb2xkZXJzID09PSAxKSB7XG4gICAgdG1wID0gKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpKV0gPDwgMTApIHwgKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMSldIDw8IDQpIHwgKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMildID4+IDIpXG4gICAgYXJyW0wrK10gPSAodG1wID4+IDgpICYgMHhGRlxuICAgIGFycltMKytdID0gdG1wICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIGFyclxufVxuXG5mdW5jdGlvbiB0cmlwbGV0VG9CYXNlNjQgKG51bSkge1xuICByZXR1cm4gbG9va3VwW251bSA+PiAxOCAmIDB4M0ZdICsgbG9va3VwW251bSA+PiAxMiAmIDB4M0ZdICsgbG9va3VwW251bSA+PiA2ICYgMHgzRl0gKyBsb29rdXBbbnVtICYgMHgzRl1cbn1cblxuZnVuY3Rpb24gZW5jb2RlQ2h1bmsgKHVpbnQ4LCBzdGFydCwgZW5kKSB7XG4gIHZhciB0bXBcbiAgdmFyIG91dHB1dCA9IFtdXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSArPSAzKSB7XG4gICAgdG1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuICAgIG91dHB1dC5wdXNoKHRyaXBsZXRUb0Jhc2U2NCh0bXApKVxuICB9XG4gIHJldHVybiBvdXRwdXQuam9pbignJylcbn1cblxuZnVuY3Rpb24gZnJvbUJ5dGVBcnJheSAodWludDgpIHtcbiAgdmFyIHRtcFxuICB2YXIgbGVuID0gdWludDgubGVuZ3RoXG4gIHZhciBleHRyYUJ5dGVzID0gbGVuICUgMyAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuICB2YXIgb3V0cHV0ID0gJydcbiAgdmFyIHBhcnRzID0gW11cbiAgdmFyIG1heENodW5rTGVuZ3RoID0gMTYzODMgLy8gbXVzdCBiZSBtdWx0aXBsZSBvZiAzXG5cbiAgLy8gZ28gdGhyb3VnaCB0aGUgYXJyYXkgZXZlcnkgdGhyZWUgYnl0ZXMsIHdlJ2xsIGRlYWwgd2l0aCB0cmFpbGluZyBzdHVmZiBsYXRlclxuICBmb3IgKHZhciBpID0gMCwgbGVuMiA9IGxlbiAtIGV4dHJhQnl0ZXM7IGkgPCBsZW4yOyBpICs9IG1heENodW5rTGVuZ3RoKSB7XG4gICAgcGFydHMucHVzaChlbmNvZGVDaHVuayh1aW50OCwgaSwgKGkgKyBtYXhDaHVua0xlbmd0aCkgPiBsZW4yID8gbGVuMiA6IChpICsgbWF4Q2h1bmtMZW5ndGgpKSlcbiAgfVxuXG4gIC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcbiAgaWYgKGV4dHJhQnl0ZXMgPT09IDEpIHtcbiAgICB0bXAgPSB1aW50OFtsZW4gLSAxXVxuICAgIG91dHB1dCArPSBsb29rdXBbdG1wID4+IDJdXG4gICAgb3V0cHV0ICs9IGxvb2t1cFsodG1wIDw8IDQpICYgMHgzRl1cbiAgICBvdXRwdXQgKz0gJz09J1xuICB9IGVsc2UgaWYgKGV4dHJhQnl0ZXMgPT09IDIpIHtcbiAgICB0bXAgPSAodWludDhbbGVuIC0gMl0gPDwgOCkgKyAodWludDhbbGVuIC0gMV0pXG4gICAgb3V0cHV0ICs9IGxvb2t1cFt0bXAgPj4gMTBdXG4gICAgb3V0cHV0ICs9IGxvb2t1cFsodG1wID4+IDQpICYgMHgzRl1cbiAgICBvdXRwdXQgKz0gbG9va3VwWyh0bXAgPDwgMikgJiAweDNGXVxuICAgIG91dHB1dCArPSAnPSdcbiAgfVxuXG4gIHBhcnRzLnB1c2gob3V0cHV0KVxuXG4gIHJldHVybiBwYXJ0cy5qb2luKCcnKVxufVxuIiwiLyoqXG4gKiBEZWNvZGVzIGJlbmNvZGVkIGRhdGEuXG4gKlxuICogQHBhcmFtICB7QnVmZmVyfSBkYXRhXG4gKiBAcGFyYW0gIHtOdW1iZXJ9IHN0YXJ0IChvcHRpb25hbClcbiAqIEBwYXJhbSAge051bWJlcn0gZW5kIChvcHRpb25hbClcbiAqIEBwYXJhbSAge1N0cmluZ30gZW5jb2RpbmcgKG9wdGlvbmFsKVxuICogQHJldHVybiB7T2JqZWN0fEFycmF5fEJ1ZmZlcnxTdHJpbmd8TnVtYmVyfVxuICovXG5mdW5jdGlvbiBkZWNvZGUgKGRhdGEsIHN0YXJ0LCBlbmQsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2Ygc3RhcnQgIT09ICdudW1iZXInICYmIGVuY29kaW5nID09IG51bGwpIHtcbiAgICBlbmNvZGluZyA9IHN0YXJ0XG4gICAgc3RhcnQgPSB1bmRlZmluZWRcbiAgfVxuXG4gIGlmICh0eXBlb2YgZW5kICE9PSAnbnVtYmVyJyAmJiBlbmNvZGluZyA9PSBudWxsKSB7XG4gICAgZW5jb2RpbmcgPSBlbmRcbiAgICBlbmQgPSB1bmRlZmluZWRcbiAgfVxuXG4gIGRlY29kZS5wb3NpdGlvbiA9IDBcbiAgZGVjb2RlLmVuY29kaW5nID0gZW5jb2RpbmcgfHwgbnVsbFxuXG4gIGRlY29kZS5kYXRhID0gIShCdWZmZXIuaXNCdWZmZXIoZGF0YSkpXG4gICAgPyBuZXcgQnVmZmVyKGRhdGEpXG4gICAgOiBkYXRhLnNsaWNlKHN0YXJ0LCBlbmQpXG5cbiAgZGVjb2RlLmJ5dGVzID0gZGVjb2RlLmRhdGEubGVuZ3RoXG5cbiAgcmV0dXJuIGRlY29kZS5uZXh0KClcbn1cblxuZGVjb2RlLmJ5dGVzID0gMFxuZGVjb2RlLnBvc2l0aW9uID0gMFxuZGVjb2RlLmRhdGEgPSBudWxsXG5kZWNvZGUuZW5jb2RpbmcgPSBudWxsXG5cbmRlY29kZS5uZXh0ID0gZnVuY3Rpb24gKCkge1xuICBzd2l0Y2ggKGRlY29kZS5kYXRhW2RlY29kZS5wb3NpdGlvbl0pIHtcbiAgICBjYXNlIDB4NjQ6XG4gICAgICByZXR1cm4gZGVjb2RlLmRpY3Rpb25hcnkoKVxuICAgIGNhc2UgMHg2QzpcbiAgICAgIHJldHVybiBkZWNvZGUubGlzdCgpXG4gICAgY2FzZSAweDY5OlxuICAgICAgcmV0dXJuIGRlY29kZS5pbnRlZ2VyKClcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGRlY29kZS5idWZmZXIoKVxuICB9XG59XG5cbmRlY29kZS5maW5kID0gZnVuY3Rpb24gKGNocikge1xuICB2YXIgaSA9IGRlY29kZS5wb3NpdGlvblxuICB2YXIgYyA9IGRlY29kZS5kYXRhLmxlbmd0aFxuICB2YXIgZCA9IGRlY29kZS5kYXRhXG5cbiAgd2hpbGUgKGkgPCBjKSB7XG4gICAgaWYgKGRbaV0gPT09IGNocikgcmV0dXJuIGlcbiAgICBpKytcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcbiAgICAnSW52YWxpZCBkYXRhOiBNaXNzaW5nIGRlbGltaXRlciBcIicgK1xuICAgIFN0cmluZy5mcm9tQ2hhckNvZGUoY2hyKSArICdcIiBbMHgnICtcbiAgICBjaHIudG9TdHJpbmcoMTYpICsgJ10nXG4gIClcbn1cblxuZGVjb2RlLmRpY3Rpb25hcnkgPSBmdW5jdGlvbiAoKSB7XG4gIGRlY29kZS5wb3NpdGlvbisrXG5cbiAgdmFyIGRpY3QgPSB7fVxuXG4gIHdoaWxlIChkZWNvZGUuZGF0YVtkZWNvZGUucG9zaXRpb25dICE9PSAweDY1KSB7XG4gICAgZGljdFtkZWNvZGUuYnVmZmVyKCldID0gZGVjb2RlLm5leHQoKVxuICB9XG5cbiAgZGVjb2RlLnBvc2l0aW9uKytcblxuICByZXR1cm4gZGljdFxufVxuXG5kZWNvZGUubGlzdCA9IGZ1bmN0aW9uICgpIHtcbiAgZGVjb2RlLnBvc2l0aW9uKytcblxuICB2YXIgbHN0ID0gW11cblxuICB3aGlsZSAoZGVjb2RlLmRhdGFbZGVjb2RlLnBvc2l0aW9uXSAhPT0gMHg2NSkge1xuICAgIGxzdC5wdXNoKGRlY29kZS5uZXh0KCkpXG4gIH1cblxuICBkZWNvZGUucG9zaXRpb24rK1xuXG4gIHJldHVybiBsc3Rcbn1cblxuZGVjb2RlLmludGVnZXIgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBlbmQgPSBkZWNvZGUuZmluZCgweDY1KVxuICB2YXIgbnVtYmVyID0gZGVjb2RlLmRhdGEudG9TdHJpbmcoJ2FzY2lpJywgZGVjb2RlLnBvc2l0aW9uICsgMSwgZW5kKVxuXG4gIGRlY29kZS5wb3NpdGlvbiArPSBlbmQgKyAxIC0gZGVjb2RlLnBvc2l0aW9uXG5cbiAgcmV0dXJuIHBhcnNlSW50KG51bWJlciwgMTApXG59XG5cbmRlY29kZS5idWZmZXIgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZXAgPSBkZWNvZGUuZmluZCgweDNBKVxuICB2YXIgbGVuZ3RoID0gcGFyc2VJbnQoZGVjb2RlLmRhdGEudG9TdHJpbmcoJ2FzY2lpJywgZGVjb2RlLnBvc2l0aW9uLCBzZXApLCAxMClcbiAgdmFyIGVuZCA9ICsrc2VwICsgbGVuZ3RoXG5cbiAgZGVjb2RlLnBvc2l0aW9uID0gZW5kXG5cbiAgcmV0dXJuIGRlY29kZS5lbmNvZGluZ1xuICAgID8gZGVjb2RlLmRhdGEudG9TdHJpbmcoZGVjb2RlLmVuY29kaW5nLCBzZXAsIGVuZClcbiAgICA6IGRlY29kZS5kYXRhLnNsaWNlKHNlcCwgZW5kKVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGRlY29kZVxuIiwiLyoqXG4gKiBFbmNvZGVzIGRhdGEgaW4gYmVuY29kZS5cbiAqXG4gKiBAcGFyYW0gIHtCdWZmZXJ8QXJyYXl8U3RyaW5nfE9iamVjdHxOdW1iZXJ8Qm9vbGVhbn0gZGF0YVxuICogQHJldHVybiB7QnVmZmVyfVxuICovXG5mdW5jdGlvbiBlbmNvZGUgKGRhdGEsIGJ1ZmZlciwgb2Zmc2V0KSB7XG4gIHZhciBidWZmZXJzID0gW11cbiAgdmFyIHJlc3VsdCA9IG51bGxcblxuICBlbmNvZGUuX2VuY29kZShidWZmZXJzLCBkYXRhKVxuICByZXN1bHQgPSBCdWZmZXIuY29uY2F0KGJ1ZmZlcnMpXG4gIGVuY29kZS5ieXRlcyA9IHJlc3VsdC5sZW5ndGhcblxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKGJ1ZmZlcikpIHtcbiAgICByZXN1bHQuY29weShidWZmZXIsIG9mZnNldClcbiAgICByZXR1cm4gYnVmZmVyXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbmVuY29kZS5ieXRlcyA9IC0xXG5lbmNvZGUuX2Zsb2F0Q29udmVyc2lvbkRldGVjdGVkID0gZmFsc2VcblxuZW5jb2RlLl9lbmNvZGUgPSBmdW5jdGlvbiAoYnVmZmVycywgZGF0YSkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKGRhdGEpKSB7XG4gICAgYnVmZmVycy5wdXNoKG5ldyBCdWZmZXIoZGF0YS5sZW5ndGggKyAnOicpKVxuICAgIGJ1ZmZlcnMucHVzaChkYXRhKVxuICAgIHJldHVyblxuICB9XG5cbiAgc3dpdGNoICh0eXBlb2YgZGF0YSkge1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICBlbmNvZGUuYnVmZmVyKGJ1ZmZlcnMsIGRhdGEpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICBlbmNvZGUubnVtYmVyKGJ1ZmZlcnMsIGRhdGEpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICBkYXRhLmNvbnN0cnVjdG9yID09PSBBcnJheVxuICAgICAgICA/IGVuY29kZS5saXN0KGJ1ZmZlcnMsIGRhdGEpXG4gICAgICAgIDogZW5jb2RlLmRpY3QoYnVmZmVycywgZGF0YSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICBlbmNvZGUubnVtYmVyKGJ1ZmZlcnMsIGRhdGEgPyAxIDogMClcbiAgICAgIGJyZWFrXG4gIH1cbn1cblxudmFyIGJ1ZmZFID0gbmV3IEJ1ZmZlcignZScpXG52YXIgYnVmZkQgPSBuZXcgQnVmZmVyKCdkJylcbnZhciBidWZmTCA9IG5ldyBCdWZmZXIoJ2wnKVxuXG5lbmNvZGUuYnVmZmVyID0gZnVuY3Rpb24gKGJ1ZmZlcnMsIGRhdGEpIHtcbiAgYnVmZmVycy5wdXNoKG5ldyBCdWZmZXIoQnVmZmVyLmJ5dGVMZW5ndGgoZGF0YSkgKyAnOicgKyBkYXRhKSlcbn1cblxuZW5jb2RlLm51bWJlciA9IGZ1bmN0aW9uIChidWZmZXJzLCBkYXRhKSB7XG4gIHZhciBtYXhMbyA9IDB4ODAwMDAwMDBcbiAgdmFyIGhpID0gKGRhdGEgLyBtYXhMbykgPDwgMFxuICB2YXIgbG8gPSAoZGF0YSAlIG1heExvKSA8PCAwXG4gIHZhciB2YWwgPSBoaSAqIG1heExvICsgbG9cblxuICBidWZmZXJzLnB1c2gobmV3IEJ1ZmZlcignaScgKyB2YWwgKyAnZScpKVxuXG4gIGlmICh2YWwgIT09IGRhdGEgJiYgIWVuY29kZS5fZmxvYXRDb252ZXJzaW9uRGV0ZWN0ZWQpIHtcbiAgICBlbmNvZGUuX2Zsb2F0Q29udmVyc2lvbkRldGVjdGVkID0gdHJ1ZVxuICAgIGNvbnNvbGUud2FybihcbiAgICAgICdXQVJOSU5HOiBQb3NzaWJsZSBkYXRhIGNvcnJ1cHRpb24gZGV0ZWN0ZWQgd2l0aCB2YWx1ZSBcIicgKyBkYXRhICsgJ1wiOicsXG4gICAgICAnQmVuY29kaW5nIG9ubHkgZGVmaW5lcyBzdXBwb3J0IGZvciBpbnRlZ2VycywgdmFsdWUgd2FzIGNvbnZlcnRlZCB0byBcIicgKyB2YWwgKyAnXCInXG4gICAgKVxuICAgIGNvbnNvbGUudHJhY2UoKVxuICB9XG59XG5cbmVuY29kZS5kaWN0ID0gZnVuY3Rpb24gKGJ1ZmZlcnMsIGRhdGEpIHtcbiAgYnVmZmVycy5wdXNoKGJ1ZmZEKVxuXG4gIHZhciBqID0gMFxuICB2YXIga1xuICAvLyBmaXggZm9yIGlzc3VlICMxMyAtIHNvcnRlZCBkaWN0c1xuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGRhdGEpLnNvcnQoKVxuICB2YXIga2wgPSBrZXlzLmxlbmd0aFxuXG4gIGZvciAoOyBqIDwga2w7IGorKykge1xuICAgIGsgPSBrZXlzW2pdXG4gICAgZW5jb2RlLmJ1ZmZlcihidWZmZXJzLCBrKVxuICAgIGVuY29kZS5fZW5jb2RlKGJ1ZmZlcnMsIGRhdGFba10pXG4gIH1cblxuICBidWZmZXJzLnB1c2goYnVmZkUpXG59XG5cbmVuY29kZS5saXN0ID0gZnVuY3Rpb24gKGJ1ZmZlcnMsIGRhdGEpIHtcbiAgdmFyIGkgPSAwXG4gIHZhciBjID0gZGF0YS5sZW5ndGhcbiAgYnVmZmVycy5wdXNoKGJ1ZmZMKVxuXG4gIGZvciAoOyBpIDwgYzsgaSsrKSB7XG4gICAgZW5jb2RlLl9lbmNvZGUoYnVmZmVycywgZGF0YVtpXSlcbiAgfVxuXG4gIGJ1ZmZlcnMucHVzaChidWZmRSlcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBlbmNvZGVcbiIsInZhciBiZW5jb2RlID0gbW9kdWxlLmV4cG9ydHNcblxuYmVuY29kZS5lbmNvZGUgPSByZXF1aXJlKCcuL2VuY29kZScpXG5iZW5jb2RlLmRlY29kZSA9IHJlcXVpcmUoJy4vZGVjb2RlJylcblxuLyoqXG4gKiBEZXRlcm1pbmVzIHRoZSBhbW91bnQgb2YgYnl0ZXNcbiAqIG5lZWRlZCB0byBlbmNvZGUgdGhlIGdpdmVuIHZhbHVlXG4gKiBAcGFyYW0gIHtPYmplY3R8QXJyYXl8QnVmZmVyfFN0cmluZ3xOdW1iZXJ8Qm9vbGVhbn0gdmFsdWVcbiAqIEByZXR1cm4ge051bWJlcn0gYnl0ZUNvdW50XG4gKi9cbmJlbmNvZGUuYnl0ZUxlbmd0aCA9IGJlbmNvZGUuZW5jb2RpbmdMZW5ndGggPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgcmV0dXJuIGJlbmNvZGUuZW5jb2RlKHZhbHVlKS5sZW5ndGhcbn1cbiIsInZhciBpbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG52YXIgVHJhbnNmb3JtID0gcmVxdWlyZSgncmVhZGFibGUtc3RyZWFtJykuVHJhbnNmb3JtO1xudmFyIGRlZmluZWQgPSByZXF1aXJlKCdkZWZpbmVkJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQmxvY2s7XG5pbmhlcml0cyhCbG9jaywgVHJhbnNmb3JtKTtcblxuZnVuY3Rpb24gQmxvY2sgKHNpemUsIG9wdHMpIHtcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQmxvY2spKSByZXR1cm4gbmV3IEJsb2NrKHNpemUsIG9wdHMpO1xuICAgIFRyYW5zZm9ybS5jYWxsKHRoaXMpO1xuICAgIGlmICghb3B0cykgb3B0cyA9IHt9O1xuICAgIGlmICh0eXBlb2Ygc2l6ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgb3B0cyA9IHNpemU7XG4gICAgICAgIHNpemUgPSBvcHRzLnNpemU7XG4gICAgfVxuICAgIHRoaXMuc2l6ZSA9IHNpemUgfHwgNTEyO1xuICAgIFxuICAgIGlmIChvcHRzLm5vcGFkKSB0aGlzLl96ZXJvUGFkZGluZyA9IGZhbHNlO1xuICAgIGVsc2UgdGhpcy5femVyb1BhZGRpbmcgPSBkZWZpbmVkKG9wdHMuemVyb1BhZGRpbmcsIHRydWUpO1xuICAgIFxuICAgIHRoaXMuX2J1ZmZlcmVkID0gW107XG4gICAgdGhpcy5fYnVmZmVyZWRCeXRlcyA9IDA7XG59XG5cbkJsb2NrLnByb3RvdHlwZS5fdHJhbnNmb3JtID0gZnVuY3Rpb24gKGJ1ZiwgZW5jLCBuZXh0KSB7XG4gICAgdGhpcy5fYnVmZmVyZWRCeXRlcyArPSBidWYubGVuZ3RoO1xuICAgIHRoaXMuX2J1ZmZlcmVkLnB1c2goYnVmKTtcbiAgICBcbiAgICB3aGlsZSAodGhpcy5fYnVmZmVyZWRCeXRlcyA+PSB0aGlzLnNpemUpIHtcbiAgICAgICAgdmFyIGIgPSBCdWZmZXIuY29uY2F0KHRoaXMuX2J1ZmZlcmVkKTtcbiAgICAgICAgdGhpcy5fYnVmZmVyZWRCeXRlcyAtPSB0aGlzLnNpemU7XG4gICAgICAgIHRoaXMucHVzaChiLnNsaWNlKDAsIHRoaXMuc2l6ZSkpO1xuICAgICAgICB0aGlzLl9idWZmZXJlZCA9IFsgYi5zbGljZSh0aGlzLnNpemUsIGIubGVuZ3RoKSBdO1xuICAgIH1cbiAgICBuZXh0KCk7XG59O1xuXG5CbG9jay5wcm90b3R5cGUuX2ZsdXNoID0gZnVuY3Rpb24gKCkge1xuICAgIGlmICh0aGlzLl9idWZmZXJlZEJ5dGVzICYmIHRoaXMuX3plcm9QYWRkaW5nKSB7XG4gICAgICAgIHZhciB6ZXJvZXMgPSBuZXcgQnVmZmVyKHRoaXMuc2l6ZSAtIHRoaXMuX2J1ZmZlcmVkQnl0ZXMpO1xuICAgICAgICB6ZXJvZXMuZmlsbCgwKTtcbiAgICAgICAgdGhpcy5fYnVmZmVyZWQucHVzaCh6ZXJvZXMpO1xuICAgICAgICB0aGlzLnB1c2goQnVmZmVyLmNvbmNhdCh0aGlzLl9idWZmZXJlZCkpO1xuICAgICAgICB0aGlzLl9idWZmZXJlZCA9IG51bGw7XG4gICAgfVxuICAgIGVsc2UgaWYgKHRoaXMuX2J1ZmZlcmVkQnl0ZXMpIHtcbiAgICAgICAgdGhpcy5wdXNoKEJ1ZmZlci5jb25jYXQodGhpcy5fYnVmZmVyZWQpKTtcbiAgICAgICAgdGhpcy5fYnVmZmVyZWQgPSBudWxsO1xuICAgIH1cbiAgICB0aGlzLnB1c2gobnVsbCk7XG59O1xuIiwiIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYnVmZmVyID0gcmVxdWlyZSgnYnVmZmVyJyk7XG52YXIgQnVmZmVyID0gYnVmZmVyLkJ1ZmZlcjtcbnZhciBTbG93QnVmZmVyID0gYnVmZmVyLlNsb3dCdWZmZXI7XG52YXIgTUFYX0xFTiA9IGJ1ZmZlci5rTWF4TGVuZ3RoIHx8IDIxNDc0ODM2NDc7XG5leHBvcnRzLmFsbG9jID0gZnVuY3Rpb24gYWxsb2Moc2l6ZSwgZmlsbCwgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIuYWxsb2MgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gQnVmZmVyLmFsbG9jKHNpemUsIGZpbGwsIGVuY29kaW5nKTtcbiAgfVxuICBpZiAodHlwZW9mIGVuY29kaW5nID09PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VuY29kaW5nIG11c3Qgbm90IGJlIG51bWJlcicpO1xuICB9XG4gIGlmICh0eXBlb2Ygc2l6ZSAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaXplIG11c3QgYmUgYSBudW1iZXInKTtcbiAgfVxuICBpZiAoc2l6ZSA+IE1BWF9MRU4pIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc2l6ZSBpcyB0b28gbGFyZ2UnKTtcbiAgfVxuICB2YXIgZW5jID0gZW5jb2Rpbmc7XG4gIHZhciBfZmlsbCA9IGZpbGw7XG4gIGlmIChfZmlsbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jID0gdW5kZWZpbmVkO1xuICAgIF9maWxsID0gMDtcbiAgfVxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzaXplKTtcbiAgaWYgKHR5cGVvZiBfZmlsbCA9PT0gJ3N0cmluZycpIHtcbiAgICB2YXIgZmlsbEJ1ZiA9IG5ldyBCdWZmZXIoX2ZpbGwsIGVuYyk7XG4gICAgdmFyIGZsZW4gPSBmaWxsQnVmLmxlbmd0aDtcbiAgICB2YXIgaSA9IC0xO1xuICAgIHdoaWxlICgrK2kgPCBzaXplKSB7XG4gICAgICBidWZbaV0gPSBmaWxsQnVmW2kgJSBmbGVuXTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgYnVmLmZpbGwoX2ZpbGwpO1xuICB9XG4gIHJldHVybiBidWY7XG59XG5leHBvcnRzLmFsbG9jVW5zYWZlID0gZnVuY3Rpb24gYWxsb2NVbnNhZmUoc2l6ZSkge1xuICBpZiAodHlwZW9mIEJ1ZmZlci5hbGxvY1Vuc2FmZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBCdWZmZXIuYWxsb2NVbnNhZmUoc2l6ZSk7XG4gIH1cbiAgaWYgKHR5cGVvZiBzaXplICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NpemUgbXVzdCBiZSBhIG51bWJlcicpO1xuICB9XG4gIGlmIChzaXplID4gTUFYX0xFTikge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdzaXplIGlzIHRvbyBsYXJnZScpO1xuICB9XG4gIHJldHVybiBuZXcgQnVmZmVyKHNpemUpO1xufVxuZXhwb3J0cy5mcm9tID0gZnVuY3Rpb24gZnJvbSh2YWx1ZSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKSB7XG4gIGlmICh0eXBlb2YgQnVmZmVyLmZyb20gPT09ICdmdW5jdGlvbicgJiYgKCFnbG9iYWwuVWludDhBcnJheSB8fCBVaW50OEFycmF5LmZyb20gIT09IEJ1ZmZlci5mcm9tKSkge1xuICAgIHJldHVybiBCdWZmZXIuZnJvbSh2YWx1ZSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKTtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1widmFsdWVcIiBhcmd1bWVudCBtdXN0IG5vdCBiZSBhIG51bWJlcicpO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIodmFsdWUsIGVuY29kaW5nT3JPZmZzZXQpO1xuICB9XG4gIGlmICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIHZhbHVlIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICB2YXIgb2Zmc2V0ID0gZW5jb2RpbmdPck9mZnNldDtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgcmV0dXJuIG5ldyBCdWZmZXIodmFsdWUpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9mZnNldCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIG9mZnNldCA9IDA7XG4gICAgfVxuICAgIHZhciBsZW4gPSBsZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBsZW4gPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBsZW4gPSB2YWx1ZS5ieXRlTGVuZ3RoIC0gb2Zmc2V0O1xuICAgIH1cbiAgICBpZiAob2Zmc2V0ID49IHZhbHVlLmJ5dGVMZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdcXCdvZmZzZXRcXCcgaXMgb3V0IG9mIGJvdW5kcycpO1xuICAgIH1cbiAgICBpZiAobGVuID4gdmFsdWUuYnl0ZUxlbmd0aCAtIG9mZnNldCkge1xuICAgICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1xcJ2xlbmd0aFxcJyBpcyBvdXQgb2YgYm91bmRzJyk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgQnVmZmVyKHZhbHVlLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgbGVuKSk7XG4gIH1cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpIHtcbiAgICB2YXIgb3V0ID0gbmV3IEJ1ZmZlcih2YWx1ZS5sZW5ndGgpO1xuICAgIHZhbHVlLmNvcHkob3V0LCAwLCAwLCB2YWx1ZS5sZW5ndGgpO1xuICAgIHJldHVybiBvdXQ7XG4gIH1cbiAgaWYgKHZhbHVlKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpIHx8ICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIHZhbHVlLmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB8fCAnbGVuZ3RoJyBpbiB2YWx1ZSkge1xuICAgICAgcmV0dXJuIG5ldyBCdWZmZXIodmFsdWUpO1xuICAgIH1cbiAgICBpZiAodmFsdWUudHlwZSA9PT0gJ0J1ZmZlcicgJiYgQXJyYXkuaXNBcnJheSh2YWx1ZS5kYXRhKSkge1xuICAgICAgcmV0dXJuIG5ldyBCdWZmZXIodmFsdWUuZGF0YSk7XG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcignRmlyc3QgYXJndW1lbnQgbXVzdCBiZSBhIHN0cmluZywgQnVmZmVyLCAnICsgJ0FycmF5QnVmZmVyLCBBcnJheSwgb3IgYXJyYXktbGlrZSBvYmplY3QuJyk7XG59XG5leHBvcnRzLmFsbG9jVW5zYWZlU2xvdyA9IGZ1bmN0aW9uIGFsbG9jVW5zYWZlU2xvdyhzaXplKSB7XG4gIGlmICh0eXBlb2YgQnVmZmVyLmFsbG9jVW5zYWZlU2xvdyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBCdWZmZXIuYWxsb2NVbnNhZmVTbG93KHNpemUpO1xuICB9XG4gIGlmICh0eXBlb2Ygc2l6ZSAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaXplIG11c3QgYmUgYSBudW1iZXInKTtcbiAgfVxuICBpZiAoc2l6ZSA+PSBNQVhfTEVOKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NpemUgaXMgdG9vIGxhcmdlJyk7XG4gIH1cbiAgcmV0dXJuIG5ldyBTbG93QnVmZmVyKHNpemUpO1xufVxuIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuLyogZXNsaW50LWRpc2FibGUgbm8tcHJvdG8gKi9cblxuJ3VzZSBzdHJpY3QnXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXNhcnJheScpXG5cbmV4cG9ydHMuQnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBTbG93QnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogRHVlIHRvIHZhcmlvdXMgYnJvd3NlciBidWdzLCBzb21ldGltZXMgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiB3aWxsIGJlIHVzZWQgZXZlblxuICogd2hlbiB0aGUgYnJvd3NlciBzdXBwb3J0cyB0eXBlZCBhcnJheXMuXG4gKlxuICogTm90ZTpcbiAqXG4gKiAgIC0gRmlyZWZveCA0LTI5IGxhY2tzIHN1cHBvcnQgZm9yIGFkZGluZyBuZXcgcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLFxuICogICAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAgLSBDaHJvbWUgOS0xMCBpcyBtaXNzaW5nIHRoZSBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uLlxuICpcbiAqICAgLSBJRTEwIGhhcyBhIGJyb2tlbiBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYXJyYXlzIG9mXG4gKiAgICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG5cbiAqIFdlIGRldGVjdCB0aGVzZSBidWdneSBicm93c2VycyBhbmQgc2V0IGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGAgdG8gYGZhbHNlYCBzbyB0aGV5XG4gKiBnZXQgdGhlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiwgd2hpY2ggaXMgc2xvd2VyIGJ1dCBiZWhhdmVzIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSBnbG9iYWwuVFlQRURfQVJSQVlfU1VQUE9SVCAhPT0gdW5kZWZpbmVkXG4gID8gZ2xvYmFsLlRZUEVEX0FSUkFZX1NVUFBPUlRcbiAgOiB0eXBlZEFycmF5U3VwcG9ydCgpXG5cbi8qXG4gKiBFeHBvcnQga01heExlbmd0aCBhZnRlciB0eXBlZCBhcnJheSBzdXBwb3J0IGlzIGRldGVybWluZWQuXG4gKi9cbmV4cG9ydHMua01heExlbmd0aCA9IGtNYXhMZW5ndGgoKVxuXG5mdW5jdGlvbiB0eXBlZEFycmF5U3VwcG9ydCAoKSB7XG4gIHRyeSB7XG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KDEpXG4gICAgYXJyLl9fcHJvdG9fXyA9IHtfX3Byb3RvX186IFVpbnQ4QXJyYXkucHJvdG90eXBlLCBmb286IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH19XG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgYXJyLnN1YmFycmF5KDEsIDEpLmJ5dGVMZW5ndGggPT09IDAgLy8gaWUxMCBoYXMgYnJva2VuIGBzdWJhcnJheWBcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbmZ1bmN0aW9uIGtNYXhMZW5ndGggKCkge1xuICByZXR1cm4gQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRcbiAgICA/IDB4N2ZmZmZmZmZcbiAgICA6IDB4M2ZmZmZmZmZcbn1cblxuZnVuY3Rpb24gY3JlYXRlQnVmZmVyICh0aGF0LCBsZW5ndGgpIHtcbiAgaWYgKGtNYXhMZW5ndGgoKSA8IGxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdJbnZhbGlkIHR5cGVkIGFycmF5IGxlbmd0aCcpXG4gIH1cbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhhdCA9IG5ldyBVaW50OEFycmF5KGxlbmd0aClcbiAgICB0aGF0Ll9fcHJvdG9fXyA9IEJ1ZmZlci5wcm90b3R5cGVcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgaWYgKHRoYXQgPT09IG51bGwpIHtcbiAgICAgIHRoYXQgPSBuZXcgQnVmZmVyKGxlbmd0aClcbiAgICB9XG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgfVxuXG4gIHJldHVybiB0aGF0XG59XG5cbi8qKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBoYXZlIHRoZWlyXG4gKiBwcm90b3R5cGUgY2hhbmdlZCB0byBgQnVmZmVyLnByb3RvdHlwZWAuIEZ1cnRoZXJtb3JlLCBgQnVmZmVyYCBpcyBhIHN1YmNsYXNzIG9mXG4gKiBgVWludDhBcnJheWAsIHNvIHRoZSByZXR1cm5lZCBpbnN0YW5jZXMgd2lsbCBoYXZlIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBtZXRob2RzXG4gKiBhbmQgdGhlIGBVaW50OEFycmF5YCBtZXRob2RzLiBTcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdFxuICogcmV0dXJucyBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBUaGUgYFVpbnQ4QXJyYXlgIHByb3RvdHlwZSByZW1haW5zIHVubW9kaWZpZWQuXG4gKi9cblxuZnVuY3Rpb24gQnVmZmVyIChhcmcsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aCkge1xuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmICEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihhcmcsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aClcbiAgfVxuXG4gIC8vIENvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAodHlwZW9mIGVuY29kaW5nT3JPZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdJZiBlbmNvZGluZyBpcyBzcGVjaWZpZWQgdGhlbiB0aGUgZmlyc3QgYXJndW1lbnQgbXVzdCBiZSBhIHN0cmluZydcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIGFsbG9jVW5zYWZlKHRoaXMsIGFyZylcbiAgfVxuICByZXR1cm4gZnJvbSh0aGlzLCBhcmcsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aClcbn1cblxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbi8vIFRPRE86IExlZ2FjeSwgbm90IG5lZWRlZCBhbnltb3JlLiBSZW1vdmUgaW4gbmV4dCBtYWpvciB2ZXJzaW9uLlxuQnVmZmVyLl9hdWdtZW50ID0gZnVuY3Rpb24gKGFycikge1xuICBhcnIuX19wcm90b19fID0gQnVmZmVyLnByb3RvdHlwZVxuICByZXR1cm4gYXJyXG59XG5cbmZ1bmN0aW9uIGZyb20gKHRoYXQsIHZhbHVlLCBlbmNvZGluZ09yT2Zmc2V0LCBsZW5ndGgpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcInZhbHVlXCIgYXJndW1lbnQgbXVzdCBub3QgYmUgYSBudW1iZXInKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgdmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgIHJldHVybiBmcm9tQXJyYXlCdWZmZXIodGhhdCwgdmFsdWUsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZyb21TdHJpbmcodGhhdCwgdmFsdWUsIGVuY29kaW5nT3JPZmZzZXQpXG4gIH1cblxuICByZXR1cm4gZnJvbU9iamVjdCh0aGF0LCB2YWx1ZSlcbn1cblxuLyoqXG4gKiBGdW5jdGlvbmFsbHkgZXF1aXZhbGVudCB0byBCdWZmZXIoYXJnLCBlbmNvZGluZykgYnV0IHRocm93cyBhIFR5cGVFcnJvclxuICogaWYgdmFsdWUgaXMgYSBudW1iZXIuXG4gKiBCdWZmZXIuZnJvbShzdHJbLCBlbmNvZGluZ10pXG4gKiBCdWZmZXIuZnJvbShhcnJheSlcbiAqIEJ1ZmZlci5mcm9tKGJ1ZmZlcilcbiAqIEJ1ZmZlci5mcm9tKGFycmF5QnVmZmVyWywgYnl0ZU9mZnNldFssIGxlbmd0aF1dKVxuICoqL1xuQnVmZmVyLmZyb20gPSBmdW5jdGlvbiAodmFsdWUsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gZnJvbShudWxsLCB2YWx1ZSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKVxufVxuXG5pZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgQnVmZmVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBVaW50OEFycmF5LnByb3RvdHlwZVxuICBCdWZmZXIuX19wcm90b19fID0gVWludDhBcnJheVxuICBpZiAodHlwZW9mIFN5bWJvbCAhPT0gJ3VuZGVmaW5lZCcgJiYgU3ltYm9sLnNwZWNpZXMgJiZcbiAgICAgIEJ1ZmZlcltTeW1ib2wuc3BlY2llc10gPT09IEJ1ZmZlcikge1xuICAgIC8vIEZpeCBzdWJhcnJheSgpIGluIEVTMjAxNi4gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vZmVyb3NzL2J1ZmZlci9wdWxsLzk3XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KEJ1ZmZlciwgU3ltYm9sLnNwZWNpZXMsIHtcbiAgICAgIHZhbHVlOiBudWxsLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfSlcbiAgfVxufVxuXG5mdW5jdGlvbiBhc3NlcnRTaXplIChzaXplKSB7XG4gIGlmICh0eXBlb2Ygc2l6ZSAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcInNpemVcIiBhcmd1bWVudCBtdXN0IGJlIGEgbnVtYmVyJylcbiAgfSBlbHNlIGlmIChzaXplIDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdcInNpemVcIiBhcmd1bWVudCBtdXN0IG5vdCBiZSBuZWdhdGl2ZScpXG4gIH1cbn1cblxuZnVuY3Rpb24gYWxsb2MgKHRoYXQsIHNpemUsIGZpbGwsIGVuY29kaW5nKSB7XG4gIGFzc2VydFNpemUoc2l6ZSlcbiAgaWYgKHNpemUgPD0gMCkge1xuICAgIHJldHVybiBjcmVhdGVCdWZmZXIodGhhdCwgc2l6ZSlcbiAgfVxuICBpZiAoZmlsbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gT25seSBwYXkgYXR0ZW50aW9uIHRvIGVuY29kaW5nIGlmIGl0J3MgYSBzdHJpbmcuIFRoaXNcbiAgICAvLyBwcmV2ZW50cyBhY2NpZGVudGFsbHkgc2VuZGluZyBpbiBhIG51bWJlciB0aGF0IHdvdWxkXG4gICAgLy8gYmUgaW50ZXJwcmV0dGVkIGFzIGEgc3RhcnQgb2Zmc2V0LlxuICAgIHJldHVybiB0eXBlb2YgZW5jb2RpbmcgPT09ICdzdHJpbmcnXG4gICAgICA/IGNyZWF0ZUJ1ZmZlcih0aGF0LCBzaXplKS5maWxsKGZpbGwsIGVuY29kaW5nKVxuICAgICAgOiBjcmVhdGVCdWZmZXIodGhhdCwgc2l6ZSkuZmlsbChmaWxsKVxuICB9XG4gIHJldHVybiBjcmVhdGVCdWZmZXIodGhhdCwgc2l6ZSlcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGZpbGxlZCBCdWZmZXIgaW5zdGFuY2UuXG4gKiBhbGxvYyhzaXplWywgZmlsbFssIGVuY29kaW5nXV0pXG4gKiovXG5CdWZmZXIuYWxsb2MgPSBmdW5jdGlvbiAoc2l6ZSwgZmlsbCwgZW5jb2RpbmcpIHtcbiAgcmV0dXJuIGFsbG9jKG51bGwsIHNpemUsIGZpbGwsIGVuY29kaW5nKVxufVxuXG5mdW5jdGlvbiBhbGxvY1Vuc2FmZSAodGhhdCwgc2l6ZSkge1xuICBhc3NlcnRTaXplKHNpemUpXG4gIHRoYXQgPSBjcmVhdGVCdWZmZXIodGhhdCwgc2l6ZSA8IDAgPyAwIDogY2hlY2tlZChzaXplKSB8IDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNpemU7ICsraSkge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLyoqXG4gKiBFcXVpdmFsZW50IHRvIEJ1ZmZlcihudW0pLCBieSBkZWZhdWx0IGNyZWF0ZXMgYSBub24temVyby1maWxsZWQgQnVmZmVyIGluc3RhbmNlLlxuICogKi9cbkJ1ZmZlci5hbGxvY1Vuc2FmZSA9IGZ1bmN0aW9uIChzaXplKSB7XG4gIHJldHVybiBhbGxvY1Vuc2FmZShudWxsLCBzaXplKVxufVxuLyoqXG4gKiBFcXVpdmFsZW50IHRvIFNsb3dCdWZmZXIobnVtKSwgYnkgZGVmYXVsdCBjcmVhdGVzIGEgbm9uLXplcm8tZmlsbGVkIEJ1ZmZlciBpbnN0YW5jZS5cbiAqL1xuQnVmZmVyLmFsbG9jVW5zYWZlU2xvdyA9IGZ1bmN0aW9uIChzaXplKSB7XG4gIHJldHVybiBhbGxvY1Vuc2FmZShudWxsLCBzaXplKVxufVxuXG5mdW5jdGlvbiBmcm9tU3RyaW5nICh0aGF0LCBzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2YgZW5jb2RpbmcgIT09ICdzdHJpbmcnIHx8IGVuY29kaW5nID09PSAnJykge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gIH1cblxuICBpZiAoIUJ1ZmZlci5pc0VuY29kaW5nKGVuY29kaW5nKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wiZW5jb2RpbmdcIiBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIGVuY29kaW5nJylcbiAgfVxuXG4gIHZhciBsZW5ndGggPSBieXRlTGVuZ3RoKHN0cmluZywgZW5jb2RpbmcpIHwgMFxuICB0aGF0ID0gY3JlYXRlQnVmZmVyKHRoYXQsIGxlbmd0aClcblxuICB2YXIgYWN0dWFsID0gdGhhdC53cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuXG4gIGlmIChhY3R1YWwgIT09IGxlbmd0aCkge1xuICAgIC8vIFdyaXRpbmcgYSBoZXggc3RyaW5nLCBmb3IgZXhhbXBsZSwgdGhhdCBjb250YWlucyBpbnZhbGlkIGNoYXJhY3RlcnMgd2lsbFxuICAgIC8vIGNhdXNlIGV2ZXJ5dGhpbmcgYWZ0ZXIgdGhlIGZpcnN0IGludmFsaWQgY2hhcmFjdGVyIHRvIGJlIGlnbm9yZWQuIChlLmcuXG4gICAgLy8gJ2FieHhjZCcgd2lsbCBiZSB0cmVhdGVkIGFzICdhYicpXG4gICAgdGhhdCA9IHRoYXQuc2xpY2UoMCwgYWN0dWFsKVxuICB9XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aCA8IDAgPyAwIDogY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gY3JlYXRlQnVmZmVyKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUJ1ZmZlciAodGhhdCwgYXJyYXksIGJ5dGVPZmZzZXQsIGxlbmd0aCkge1xuICBhcnJheS5ieXRlTGVuZ3RoIC8vIHRoaXMgdGhyb3dzIGlmIGBhcnJheWAgaXMgbm90IGEgdmFsaWQgQXJyYXlCdWZmZXJcblxuICBpZiAoYnl0ZU9mZnNldCA8IDAgfHwgYXJyYXkuYnl0ZUxlbmd0aCA8IGJ5dGVPZmZzZXQpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignXFwnb2Zmc2V0XFwnIGlzIG91dCBvZiBib3VuZHMnKVxuICB9XG5cbiAgaWYgKGFycmF5LmJ5dGVMZW5ndGggPCBieXRlT2Zmc2V0ICsgKGxlbmd0aCB8fCAwKSkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdcXCdsZW5ndGhcXCcgaXMgb3V0IG9mIGJvdW5kcycpXG4gIH1cblxuICBpZiAoYnl0ZU9mZnNldCA9PT0gdW5kZWZpbmVkICYmIGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgYXJyYXkgPSBuZXcgVWludDhBcnJheShhcnJheSlcbiAgfSBlbHNlIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIGFycmF5ID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXksIGJ5dGVPZmZzZXQpXG4gIH0gZWxzZSB7XG4gICAgYXJyYXkgPSBuZXcgVWludDhBcnJheShhcnJheSwgYnl0ZU9mZnNldCwgbGVuZ3RoKVxuICB9XG5cbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhhdCA9IGFycmF5XG4gICAgdGhhdC5fX3Byb3RvX18gPSBCdWZmZXIucHJvdG90eXBlXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQgPSBmcm9tQXJyYXlMaWtlKHRoYXQsIGFycmF5KVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iaikge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iaikpIHtcbiAgICB2YXIgbGVuID0gY2hlY2tlZChvYmoubGVuZ3RoKSB8IDBcbiAgICB0aGF0ID0gY3JlYXRlQnVmZmVyKHRoYXQsIGxlbilcblxuICAgIGlmICh0aGF0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRoYXRcbiAgICB9XG5cbiAgICBvYmouY29weSh0aGF0LCAwLCAwLCBsZW4pXG4gICAgcmV0dXJuIHRoYXRcbiAgfVxuXG4gIGlmIChvYmopIHtcbiAgICBpZiAoKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgICAgb2JqLmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB8fCAnbGVuZ3RoJyBpbiBvYmopIHtcbiAgICAgIGlmICh0eXBlb2Ygb2JqLmxlbmd0aCAhPT0gJ251bWJlcicgfHwgaXNuYW4ob2JqLmxlbmd0aCkpIHtcbiAgICAgICAgcmV0dXJuIGNyZWF0ZUJ1ZmZlcih0aGF0LCAwKVxuICAgICAgfVxuICAgICAgcmV0dXJuIGZyb21BcnJheUxpa2UodGhhdCwgb2JqKVxuICAgIH1cblxuICAgIGlmIChvYmoudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShvYmouZGF0YSkpIHtcbiAgICAgIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iai5kYXRhKVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ZpcnN0IGFyZ3VtZW50IG11c3QgYmUgYSBzdHJpbmcsIEJ1ZmZlciwgQXJyYXlCdWZmZXIsIEFycmF5LCBvciBhcnJheS1saWtlIG9iamVjdC4nKVxufVxuXG5mdW5jdGlvbiBjaGVja2VkIChsZW5ndGgpIHtcbiAgLy8gTm90ZTogY2Fubm90IHVzZSBgbGVuZ3RoIDwga01heExlbmd0aCgpYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IGtNYXhMZW5ndGgoKSkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoKCkudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAobGVuZ3RoKSB7XG4gIGlmICgrbGVuZ3RoICE9IGxlbmd0aCkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGVxZXFlcVxuICAgIGxlbmd0aCA9IDBcbiAgfVxuICByZXR1cm4gQnVmZmVyLmFsbG9jKCtsZW5ndGgpXG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIGlzQnVmZmVyIChiKSB7XG4gIHJldHVybiAhIShiICE9IG51bGwgJiYgYi5faXNCdWZmZXIpXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYSwgYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihhKSB8fCAhQnVmZmVyLmlzQnVmZmVyKGIpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIG11c3QgYmUgQnVmZmVycycpXG4gIH1cblxuICBpZiAoYSA9PT0gYikgcmV0dXJuIDBcblxuICB2YXIgeCA9IGEubGVuZ3RoXG4gIHZhciB5ID0gYi5sZW5ndGhcblxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gTWF0aC5taW4oeCwgeSk7IGkgPCBsZW47ICsraSkge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSB7XG4gICAgICB4ID0gYVtpXVxuICAgICAgeSA9IGJbaV1cbiAgICAgIGJyZWFrXG4gICAgfVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2xhdGluMSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJsaXN0XCIgYXJndW1lbnQgbXVzdCBiZSBhbiBBcnJheSBvZiBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBCdWZmZXIuYWxsb2MoMClcbiAgfVxuXG4gIHZhciBpXG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIGxlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7ICsraSkge1xuICAgICAgbGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZmZlciA9IEJ1ZmZlci5hbGxvY1Vuc2FmZShsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgKytpKSB7XG4gICAgdmFyIGJ1ZiA9IGxpc3RbaV1cbiAgICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihidWYpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcImxpc3RcIiBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMnKVxuICAgIH1cbiAgICBidWYuY29weShidWZmZXIsIHBvcylcbiAgICBwb3MgKz0gYnVmLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZmZXJcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHN0cmluZykpIHtcbiAgICByZXR1cm4gc3RyaW5nLmxlbmd0aFxuICB9XG4gIGlmICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBBcnJheUJ1ZmZlci5pc1ZpZXcgPT09ICdmdW5jdGlvbicgJiZcbiAgICAgIChBcnJheUJ1ZmZlci5pc1ZpZXcoc3RyaW5nKSB8fCBzdHJpbmcgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikpIHtcbiAgICByZXR1cm4gc3RyaW5nLmJ5dGVMZW5ndGhcbiAgfVxuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHtcbiAgICBzdHJpbmcgPSAnJyArIHN0cmluZ1xuICB9XG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2xhdGluMSc6XG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gbGVuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIGNhc2UgdW5kZWZpbmVkOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG5mdW5jdGlvbiBzbG93VG9TdHJpbmcgKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgLy8gTm8gbmVlZCB0byB2ZXJpZnkgdGhhdCBcInRoaXMubGVuZ3RoIDw9IE1BWF9VSU5UMzJcIiBzaW5jZSBpdCdzIGEgcmVhZC1vbmx5XG4gIC8vIHByb3BlcnR5IG9mIGEgdHlwZWQgYXJyYXkuXG5cbiAgLy8gVGhpcyBiZWhhdmVzIG5laXRoZXIgbGlrZSBTdHJpbmcgbm9yIFVpbnQ4QXJyYXkgaW4gdGhhdCB3ZSBzZXQgc3RhcnQvZW5kXG4gIC8vIHRvIHRoZWlyIHVwcGVyL2xvd2VyIGJvdW5kcyBpZiB0aGUgdmFsdWUgcGFzc2VkIGlzIG91dCBvZiByYW5nZS5cbiAgLy8gdW5kZWZpbmVkIGlzIGhhbmRsZWQgc3BlY2lhbGx5IGFzIHBlciBFQ01BLTI2MiA2dGggRWRpdGlvbixcbiAgLy8gU2VjdGlvbiAxMy4zLjMuNyBSdW50aW1lIFNlbWFudGljczogS2V5ZWRCaW5kaW5nSW5pdGlhbGl6YXRpb24uXG4gIGlmIChzdGFydCA9PT0gdW5kZWZpbmVkIHx8IHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ID0gMFxuICB9XG4gIC8vIFJldHVybiBlYXJseSBpZiBzdGFydCA+IHRoaXMubGVuZ3RoLiBEb25lIGhlcmUgdG8gcHJldmVudCBwb3RlbnRpYWwgdWludDMyXG4gIC8vIGNvZXJjaW9uIGZhaWwgYmVsb3cuXG4gIGlmIChzdGFydCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuICcnXG4gIH1cblxuICBpZiAoZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHtcbiAgICBlbmQgPSB0aGlzLmxlbmd0aFxuICB9XG5cbiAgaWYgKGVuZCA8PSAwKSB7XG4gICAgcmV0dXJuICcnXG4gIH1cblxuICAvLyBGb3JjZSBjb2Vyc2lvbiB0byB1aW50MzIuIFRoaXMgd2lsbCBhbHNvIGNvZXJjZSBmYWxzZXkvTmFOIHZhbHVlcyB0byAwLlxuICBlbmQgPj4+PSAwXG4gIHN0YXJ0ID4+Pj0gMFxuXG4gIGlmIChlbmQgPD0gc3RhcnQpIHtcbiAgICByZXR1cm4gJydcbiAgfVxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdsYXRpbjEnOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGxhdGluMVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG4vLyBUaGUgcHJvcGVydHkgaXMgdXNlZCBieSBgQnVmZmVyLmlzQnVmZmVyYCBhbmQgYGlzLWJ1ZmZlcmAgKGluIFNhZmFyaSA1LTcpIHRvIGRldGVjdFxuLy8gQnVmZmVyIGluc3RhbmNlcy5cbkJ1ZmZlci5wcm90b3R5cGUuX2lzQnVmZmVyID0gdHJ1ZVxuXG5mdW5jdGlvbiBzd2FwIChiLCBuLCBtKSB7XG4gIHZhciBpID0gYltuXVxuICBiW25dID0gYlttXVxuICBiW21dID0gaVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnN3YXAxNiA9IGZ1bmN0aW9uIHN3YXAxNiAoKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBpZiAobGVuICUgMiAhPT0gMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdCdWZmZXIgc2l6ZSBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgMTYtYml0cycpXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkgKz0gMikge1xuICAgIHN3YXAodGhpcywgaSwgaSArIDEpXG4gIH1cbiAgcmV0dXJuIHRoaXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zd2FwMzIgPSBmdW5jdGlvbiBzd2FwMzIgKCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgaWYgKGxlbiAlIDQgIT09IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQnVmZmVyIHNpemUgbXVzdCBiZSBhIG11bHRpcGxlIG9mIDMyLWJpdHMnKVxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpICs9IDQpIHtcbiAgICBzd2FwKHRoaXMsIGksIGkgKyAzKVxuICAgIHN3YXAodGhpcywgaSArIDEsIGkgKyAyKVxuICB9XG4gIHJldHVybiB0aGlzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc3dhcDY0ID0gZnVuY3Rpb24gc3dhcDY0ICgpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIGlmIChsZW4gJSA4ICE9PSAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0J1ZmZlciBzaXplIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA2NC1iaXRzJylcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSArPSA4KSB7XG4gICAgc3dhcCh0aGlzLCBpLCBpICsgNylcbiAgICBzd2FwKHRoaXMsIGkgKyAxLCBpICsgNilcbiAgICBzd2FwKHRoaXMsIGkgKyAyLCBpICsgNSlcbiAgICBzd2FwKHRoaXMsIGkgKyAzLCBpICsgNClcbiAgfVxuICByZXR1cm4gdGhpc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcgKCkge1xuICB2YXIgbGVuZ3RoID0gdGhpcy5sZW5ndGggfCAwXG4gIGlmIChsZW5ndGggPT09IDApIHJldHVybiAnJ1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCAwLCBsZW5ndGgpXG4gIHJldHVybiBzbG93VG9TdHJpbmcuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIGVxdWFscyAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gdHJ1ZVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gaW5zcGVjdCAoKSB7XG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgbWF4ID0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAodGFyZ2V0LCBzdGFydCwgZW5kLCB0aGlzU3RhcnQsIHRoaXNFbmQpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIodGFyZ2V0KSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICB9XG5cbiAgaWYgKHN0YXJ0ID09PSB1bmRlZmluZWQpIHtcbiAgICBzdGFydCA9IDBcbiAgfVxuICBpZiAoZW5kID09PSB1bmRlZmluZWQpIHtcbiAgICBlbmQgPSB0YXJnZXQgPyB0YXJnZXQubGVuZ3RoIDogMFxuICB9XG4gIGlmICh0aGlzU3RhcnQgPT09IHVuZGVmaW5lZCkge1xuICAgIHRoaXNTdGFydCA9IDBcbiAgfVxuICBpZiAodGhpc0VuZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhpc0VuZCA9IHRoaXMubGVuZ3RoXG4gIH1cblxuICBpZiAoc3RhcnQgPCAwIHx8IGVuZCA+IHRhcmdldC5sZW5ndGggfHwgdGhpc1N0YXJ0IDwgMCB8fCB0aGlzRW5kID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb3V0IG9mIHJhbmdlIGluZGV4JylcbiAgfVxuXG4gIGlmICh0aGlzU3RhcnQgPj0gdGhpc0VuZCAmJiBzdGFydCA+PSBlbmQpIHtcbiAgICByZXR1cm4gMFxuICB9XG4gIGlmICh0aGlzU3RhcnQgPj0gdGhpc0VuZCkge1xuICAgIHJldHVybiAtMVxuICB9XG4gIGlmIChzdGFydCA+PSBlbmQpIHtcbiAgICByZXR1cm4gMVxuICB9XG5cbiAgc3RhcnQgPj4+PSAwXG4gIGVuZCA+Pj49IDBcbiAgdGhpc1N0YXJ0ID4+Pj0gMFxuICB0aGlzRW5kID4+Pj0gMFxuXG4gIGlmICh0aGlzID09PSB0YXJnZXQpIHJldHVybiAwXG5cbiAgdmFyIHggPSB0aGlzRW5kIC0gdGhpc1N0YXJ0XG4gIHZhciB5ID0gZW5kIC0gc3RhcnRcbiAgdmFyIGxlbiA9IE1hdGgubWluKHgsIHkpXG5cbiAgdmFyIHRoaXNDb3B5ID0gdGhpcy5zbGljZSh0aGlzU3RhcnQsIHRoaXNFbmQpXG4gIHZhciB0YXJnZXRDb3B5ID0gdGFyZ2V0LnNsaWNlKHN0YXJ0LCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSkge1xuICAgIGlmICh0aGlzQ29weVtpXSAhPT0gdGFyZ2V0Q29weVtpXSkge1xuICAgICAgeCA9IHRoaXNDb3B5W2ldXG4gICAgICB5ID0gdGFyZ2V0Q29weVtpXVxuICAgICAgYnJlYWtcbiAgICB9XG4gIH1cblxuICBpZiAoeCA8IHkpIHJldHVybiAtMVxuICBpZiAoeSA8IHgpIHJldHVybiAxXG4gIHJldHVybiAwXG59XG5cbi8vIEZpbmRzIGVpdGhlciB0aGUgZmlyc3QgaW5kZXggb2YgYHZhbGAgaW4gYGJ1ZmZlcmAgYXQgb2Zmc2V0ID49IGBieXRlT2Zmc2V0YCxcbi8vIE9SIHRoZSBsYXN0IGluZGV4IG9mIGB2YWxgIGluIGBidWZmZXJgIGF0IG9mZnNldCA8PSBgYnl0ZU9mZnNldGAuXG4vL1xuLy8gQXJndW1lbnRzOlxuLy8gLSBidWZmZXIgLSBhIEJ1ZmZlciB0byBzZWFyY2hcbi8vIC0gdmFsIC0gYSBzdHJpbmcsIEJ1ZmZlciwgb3IgbnVtYmVyXG4vLyAtIGJ5dGVPZmZzZXQgLSBhbiBpbmRleCBpbnRvIGBidWZmZXJgOyB3aWxsIGJlIGNsYW1wZWQgdG8gYW4gaW50MzJcbi8vIC0gZW5jb2RpbmcgLSBhbiBvcHRpb25hbCBlbmNvZGluZywgcmVsZXZhbnQgaXMgdmFsIGlzIGEgc3RyaW5nXG4vLyAtIGRpciAtIHRydWUgZm9yIGluZGV4T2YsIGZhbHNlIGZvciBsYXN0SW5kZXhPZlxuZnVuY3Rpb24gYmlkaXJlY3Rpb25hbEluZGV4T2YgKGJ1ZmZlciwgdmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZywgZGlyKSB7XG4gIC8vIEVtcHR5IGJ1ZmZlciBtZWFucyBubyBtYXRjaFxuICBpZiAoYnVmZmVyLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xXG5cbiAgLy8gTm9ybWFsaXplIGJ5dGVPZmZzZXRcbiAgaWYgKHR5cGVvZiBieXRlT2Zmc2V0ID09PSAnc3RyaW5nJykge1xuICAgIGVuY29kaW5nID0gYnl0ZU9mZnNldFxuICAgIGJ5dGVPZmZzZXQgPSAwXG4gIH0gZWxzZSBpZiAoYnl0ZU9mZnNldCA+IDB4N2ZmZmZmZmYpIHtcbiAgICBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICB9IGVsc2UgaWYgKGJ5dGVPZmZzZXQgPCAtMHg4MDAwMDAwMCkge1xuICAgIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICB9XG4gIGJ5dGVPZmZzZXQgPSArYnl0ZU9mZnNldCAgLy8gQ29lcmNlIHRvIE51bWJlci5cbiAgaWYgKGlzTmFOKGJ5dGVPZmZzZXQpKSB7XG4gICAgLy8gYnl0ZU9mZnNldDogaXQgaXQncyB1bmRlZmluZWQsIG51bGwsIE5hTiwgXCJmb29cIiwgZXRjLCBzZWFyY2ggd2hvbGUgYnVmZmVyXG4gICAgYnl0ZU9mZnNldCA9IGRpciA/IDAgOiAoYnVmZmVyLmxlbmd0aCAtIDEpXG4gIH1cblxuICAvLyBOb3JtYWxpemUgYnl0ZU9mZnNldDogbmVnYXRpdmUgb2Zmc2V0cyBzdGFydCBmcm9tIHRoZSBlbmQgb2YgdGhlIGJ1ZmZlclxuICBpZiAoYnl0ZU9mZnNldCA8IDApIGJ5dGVPZmZzZXQgPSBidWZmZXIubGVuZ3RoICsgYnl0ZU9mZnNldFxuICBpZiAoYnl0ZU9mZnNldCA+PSBidWZmZXIubGVuZ3RoKSB7XG4gICAgaWYgKGRpcikgcmV0dXJuIC0xXG4gICAgZWxzZSBieXRlT2Zmc2V0ID0gYnVmZmVyLmxlbmd0aCAtIDFcbiAgfSBlbHNlIGlmIChieXRlT2Zmc2V0IDwgMCkge1xuICAgIGlmIChkaXIpIGJ5dGVPZmZzZXQgPSAwXG4gICAgZWxzZSByZXR1cm4gLTFcbiAgfVxuXG4gIC8vIE5vcm1hbGl6ZSB2YWxcbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdzdHJpbmcnKSB7XG4gICAgdmFsID0gQnVmZmVyLmZyb20odmFsLCBlbmNvZGluZylcbiAgfVxuXG4gIC8vIEZpbmFsbHksIHNlYXJjaCBlaXRoZXIgaW5kZXhPZiAoaWYgZGlyIGlzIHRydWUpIG9yIGxhc3RJbmRleE9mXG4gIGlmIChCdWZmZXIuaXNCdWZmZXIodmFsKSkge1xuICAgIC8vIFNwZWNpYWwgY2FzZTogbG9va2luZyBmb3IgZW1wdHkgc3RyaW5nL2J1ZmZlciBhbHdheXMgZmFpbHNcbiAgICBpZiAodmFsLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIC0xXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YoYnVmZmVyLCB2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nLCBkaXIpXG4gIH0gZWxzZSBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICB2YWwgPSB2YWwgJiAweEZGIC8vIFNlYXJjaCBmb3IgYSBieXRlIHZhbHVlIFswLTI1NV1cbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiZcbiAgICAgICAgdHlwZW9mIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChkaXIpIHtcbiAgICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbChidWZmZXIsIHZhbCwgYnl0ZU9mZnNldClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBVaW50OEFycmF5LnByb3RvdHlwZS5sYXN0SW5kZXhPZi5jYWxsKGJ1ZmZlciwgdmFsLCBieXRlT2Zmc2V0KVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKGJ1ZmZlciwgWyB2YWwgXSwgYnl0ZU9mZnNldCwgZW5jb2RpbmcsIGRpcilcbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbCBtdXN0IGJlIHN0cmluZywgbnVtYmVyIG9yIEJ1ZmZlcicpXG59XG5cbmZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nLCBkaXIpIHtcbiAgdmFyIGluZGV4U2l6ZSA9IDFcbiAgdmFyIGFyckxlbmd0aCA9IGFyci5sZW5ndGhcbiAgdmFyIHZhbExlbmd0aCA9IHZhbC5sZW5ndGhcblxuICBpZiAoZW5jb2RpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgaWYgKGVuY29kaW5nID09PSAndWNzMicgfHwgZW5jb2RpbmcgPT09ICd1Y3MtMicgfHxcbiAgICAgICAgZW5jb2RpbmcgPT09ICd1dGYxNmxlJyB8fCBlbmNvZGluZyA9PT0gJ3V0Zi0xNmxlJykge1xuICAgICAgaWYgKGFyci5sZW5ndGggPCAyIHx8IHZhbC5sZW5ndGggPCAyKSB7XG4gICAgICAgIHJldHVybiAtMVxuICAgICAgfVxuICAgICAgaW5kZXhTaXplID0gMlxuICAgICAgYXJyTGVuZ3RoIC89IDJcbiAgICAgIHZhbExlbmd0aCAvPSAyXG4gICAgICBieXRlT2Zmc2V0IC89IDJcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiByZWFkIChidWYsIGkpIHtcbiAgICBpZiAoaW5kZXhTaXplID09PSAxKSB7XG4gICAgICByZXR1cm4gYnVmW2ldXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBidWYucmVhZFVJbnQxNkJFKGkgKiBpbmRleFNpemUpXG4gICAgfVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGRpcikge1xuICAgIHZhciBmb3VuZEluZGV4ID0gLTFcbiAgICBmb3IgKGkgPSBieXRlT2Zmc2V0OyBpIDwgYXJyTGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChyZWFkKGFyciwgaSkgPT09IHJlYWQodmFsLCBmb3VuZEluZGV4ID09PSAtMSA/IDAgOiBpIC0gZm91bmRJbmRleCkpIHtcbiAgICAgICAgaWYgKGZvdW5kSW5kZXggPT09IC0xKSBmb3VuZEluZGV4ID0gaVxuICAgICAgICBpZiAoaSAtIGZvdW5kSW5kZXggKyAxID09PSB2YWxMZW5ndGgpIHJldHVybiBmb3VuZEluZGV4ICogaW5kZXhTaXplXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoZm91bmRJbmRleCAhPT0gLTEpIGkgLT0gaSAtIGZvdW5kSW5kZXhcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGlmIChieXRlT2Zmc2V0ICsgdmFsTGVuZ3RoID4gYXJyTGVuZ3RoKSBieXRlT2Zmc2V0ID0gYXJyTGVuZ3RoIC0gdmFsTGVuZ3RoXG4gICAgZm9yIChpID0gYnl0ZU9mZnNldDsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIHZhciBmb3VuZCA9IHRydWVcbiAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgdmFsTGVuZ3RoOyBqKyspIHtcbiAgICAgICAgaWYgKHJlYWQoYXJyLCBpICsgaikgIT09IHJlYWQodmFsLCBqKSkge1xuICAgICAgICAgIGZvdW5kID0gZmFsc2VcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZm91bmQpIHJldHVybiBpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIC0xXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5jbHVkZXMgPSBmdW5jdGlvbiBpbmNsdWRlcyAodmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZykge1xuICByZXR1cm4gdGhpcy5pbmRleE9mKHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcpICE9PSAtMVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nKSB7XG4gIHJldHVybiBiaWRpcmVjdGlvbmFsSW5kZXhPZih0aGlzLCB2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nLCB0cnVlKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmxhc3RJbmRleE9mID0gZnVuY3Rpb24gbGFzdEluZGV4T2YgKHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcpIHtcbiAgcmV0dXJuIGJpZGlyZWN0aW9uYWxJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcsIGZhbHNlKVxufVxuXG5mdW5jdGlvbiBoZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChzdHJMZW4gJSAyICE9PSAwKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSByZXR1cm4gaVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IHBhcnNlZFxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gbGF0aW4xV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiB1Y3MyV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcpXG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgb2Zmc2V0WywgbGVuZ3RoXVssIGVuY29kaW5nXSlcbiAgfSBlbHNlIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICAgIGlmIChpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBsZW5ndGggPSBsZW5ndGggfCAwXG4gICAgICBpZiAoZW5jb2RpbmcgPT09IHVuZGVmaW5lZCkgZW5jb2RpbmcgPSAndXRmOCdcbiAgICB9IGVsc2Uge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgLy8gbGVnYWN5IHdyaXRlKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKSAtIHJlbW92ZSBpbiB2MC4xM1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdCdWZmZXIud3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0WywgbGVuZ3RoXSkgaXMgbm8gbG9uZ2VyIHN1cHBvcnRlZCdcbiAgICApXG4gIH1cblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkIHx8IGxlbmd0aCA+IHJlbWFpbmluZykgbGVuZ3RoID0gcmVtYWluaW5nXG5cbiAgaWYgKChzdHJpbmcubGVuZ3RoID4gMCAmJiAobGVuZ3RoIDwgMCB8fCBvZmZzZXQgPCAwKSkgfHwgb2Zmc2V0ID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQXR0ZW1wdCB0byB3cml0ZSBvdXRzaWRlIGJ1ZmZlciBib3VuZHMnKVxuICB9XG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnbGF0aW4xJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBsYXRpbjFXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAvLyBXYXJuaW5nOiBtYXhMZW5ndGggbm90IHRha2VuIGludG8gYWNjb3VudCBpbiBiYXNlNjRXcml0ZVxuICAgICAgICByZXR1cm4gYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHVjczJXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiB0b0pTT04gKCkge1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdCdWZmZXInLFxuICAgIGRhdGE6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHRoaXMuX2FyciB8fCB0aGlzLCAwKVxuICB9XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKHN0YXJ0ID09PSAwICYmIGVuZCA9PT0gYnVmLmxlbmd0aCkge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYpXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1Zi5zbGljZShzdGFydCwgZW5kKSlcbiAgfVxufVxuXG5mdW5jdGlvbiB1dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG4gIHZhciByZXMgPSBbXVxuXG4gIHZhciBpID0gc3RhcnRcbiAgd2hpbGUgKGkgPCBlbmQpIHtcbiAgICB2YXIgZmlyc3RCeXRlID0gYnVmW2ldXG4gICAgdmFyIGNvZGVQb2ludCA9IG51bGxcbiAgICB2YXIgYnl0ZXNQZXJTZXF1ZW5jZSA9IChmaXJzdEJ5dGUgPiAweEVGKSA/IDRcbiAgICAgIDogKGZpcnN0Qnl0ZSA+IDB4REYpID8gM1xuICAgICAgOiAoZmlyc3RCeXRlID4gMHhCRikgPyAyXG4gICAgICA6IDFcblxuICAgIGlmIChpICsgYnl0ZXNQZXJTZXF1ZW5jZSA8PSBlbmQpIHtcbiAgICAgIHZhciBzZWNvbmRCeXRlLCB0aGlyZEJ5dGUsIGZvdXJ0aEJ5dGUsIHRlbXBDb2RlUG9pbnRcblxuICAgICAgc3dpdGNoIChieXRlc1BlclNlcXVlbmNlKSB7XG4gICAgICAgIGNhc2UgMTpcbiAgICAgICAgICBpZiAoZmlyc3RCeXRlIDwgMHg4MCkge1xuICAgICAgICAgICAgY29kZVBvaW50ID0gZmlyc3RCeXRlXG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgMjpcbiAgICAgICAgICBzZWNvbmRCeXRlID0gYnVmW2kgKyAxXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwKSB7XG4gICAgICAgICAgICB0ZW1wQ29kZVBvaW50ID0gKGZpcnN0Qnl0ZSAmIDB4MUYpIDw8IDB4NiB8IChzZWNvbmRCeXRlICYgMHgzRilcbiAgICAgICAgICAgIGlmICh0ZW1wQ29kZVBvaW50ID4gMHg3Rikge1xuICAgICAgICAgICAgICBjb2RlUG9pbnQgPSB0ZW1wQ29kZVBvaW50XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgMzpcbiAgICAgICAgICBzZWNvbmRCeXRlID0gYnVmW2kgKyAxXVxuICAgICAgICAgIHRoaXJkQnl0ZSA9IGJ1ZltpICsgMl1cbiAgICAgICAgICBpZiAoKHNlY29uZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCAmJiAodGhpcmRCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHhGKSA8PCAweEMgfCAoc2Vjb25kQnl0ZSAmIDB4M0YpIDw8IDB4NiB8ICh0aGlyZEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweDdGRiAmJiAodGVtcENvZGVQb2ludCA8IDB4RDgwMCB8fCB0ZW1wQ29kZVBvaW50ID4gMHhERkZGKSkge1xuICAgICAgICAgICAgICBjb2RlUG9pbnQgPSB0ZW1wQ29kZVBvaW50XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgNDpcbiAgICAgICAgICBzZWNvbmRCeXRlID0gYnVmW2kgKyAxXVxuICAgICAgICAgIHRoaXJkQnl0ZSA9IGJ1ZltpICsgMl1cbiAgICAgICAgICBmb3VydGhCeXRlID0gYnVmW2kgKyAzXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwICYmICh0aGlyZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCAmJiAoZm91cnRoQnl0ZSAmIDB4QzApID09PSAweDgwKSB7XG4gICAgICAgICAgICB0ZW1wQ29kZVBvaW50ID0gKGZpcnN0Qnl0ZSAmIDB4RikgPDwgMHgxMiB8IChzZWNvbmRCeXRlICYgMHgzRikgPDwgMHhDIHwgKHRoaXJkQnl0ZSAmIDB4M0YpIDw8IDB4NiB8IChmb3VydGhCeXRlICYgMHgzRilcbiAgICAgICAgICAgIGlmICh0ZW1wQ29kZVBvaW50ID4gMHhGRkZGICYmIHRlbXBDb2RlUG9pbnQgPCAweDExMDAwMCkge1xuICAgICAgICAgICAgICBjb2RlUG9pbnQgPSB0ZW1wQ29kZVBvaW50XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb2RlUG9pbnQgPT09IG51bGwpIHtcbiAgICAgIC8vIHdlIGRpZCBub3QgZ2VuZXJhdGUgYSB2YWxpZCBjb2RlUG9pbnQgc28gaW5zZXJ0IGFcbiAgICAgIC8vIHJlcGxhY2VtZW50IGNoYXIgKFUrRkZGRCkgYW5kIGFkdmFuY2Ugb25seSAxIGJ5dGVcbiAgICAgIGNvZGVQb2ludCA9IDB4RkZGRFxuICAgICAgYnl0ZXNQZXJTZXF1ZW5jZSA9IDFcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA+IDB4RkZGRikge1xuICAgICAgLy8gZW5jb2RlIHRvIHV0ZjE2IChzdXJyb2dhdGUgcGFpciBkYW5jZSlcbiAgICAgIGNvZGVQb2ludCAtPSAweDEwMDAwXG4gICAgICByZXMucHVzaChjb2RlUG9pbnQgPj4+IDEwICYgMHgzRkYgfCAweEQ4MDApXG4gICAgICBjb2RlUG9pbnQgPSAweERDMDAgfCBjb2RlUG9pbnQgJiAweDNGRlxuICAgIH1cblxuICAgIHJlcy5wdXNoKGNvZGVQb2ludClcbiAgICBpICs9IGJ5dGVzUGVyU2VxdWVuY2VcbiAgfVxuXG4gIHJldHVybiBkZWNvZGVDb2RlUG9pbnRzQXJyYXkocmVzKVxufVxuXG4vLyBCYXNlZCBvbiBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8yMjc0NzI3Mi82ODA3NDIsIHRoZSBicm93c2VyIHdpdGhcbi8vIHRoZSBsb3dlc3QgbGltaXQgaXMgQ2hyb21lLCB3aXRoIDB4MTAwMDAgYXJncy5cbi8vIFdlIGdvIDEgbWFnbml0dWRlIGxlc3MsIGZvciBzYWZldHlcbnZhciBNQVhfQVJHVU1FTlRTX0xFTkdUSCA9IDB4MTAwMFxuXG5mdW5jdGlvbiBkZWNvZGVDb2RlUG9pbnRzQXJyYXkgKGNvZGVQb2ludHMpIHtcbiAgdmFyIGxlbiA9IGNvZGVQb2ludHMubGVuZ3RoXG4gIGlmIChsZW4gPD0gTUFYX0FSR1VNRU5UU19MRU5HVEgpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShTdHJpbmcsIGNvZGVQb2ludHMpIC8vIGF2b2lkIGV4dHJhIHNsaWNlKClcbiAgfVxuXG4gIC8vIERlY29kZSBpbiBjaHVua3MgdG8gYXZvaWQgXCJjYWxsIHN0YWNrIHNpemUgZXhjZWVkZWRcIi5cbiAgdmFyIHJlcyA9ICcnXG4gIHZhciBpID0gMFxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KFxuICAgICAgU3RyaW5nLFxuICAgICAgY29kZVBvaW50cy5zbGljZShpLCBpICs9IE1BWF9BUkdVTUVOVFNfTEVOR1RIKVxuICAgIClcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgKytpKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGxhdGluMVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7ICsraSkge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyArK2kpIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSB0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpXG4gICAgbmV3QnVmLl9fcHJvdG9fXyA9IEJ1ZmZlci5wcm90b3R5cGVcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyArK2kpIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJidWZmZXJcIiBhcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignXCJ2YWx1ZVwiIGFyZ3VtZW50IGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBtYXhCeXRlcyA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSAtIDFcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBtYXhCeXRlcywgMClcbiAgfVxuXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBtYXhCeXRlcyA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSAtIDFcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBtYXhCeXRlcywgMClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uIHdyaXRlVUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHhmZiwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCAyKTsgaSA8IGo7ICsraSkge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkgPCBqOyArK2kpIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50TEUgPSBmdW5jdGlvbiB3cml0ZUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gMFxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICBpZiAodmFsdWUgPCAwICYmIHN1YiA9PT0gMCAmJiB0aGlzW29mZnNldCArIGkgLSAxXSAhPT0gMCkge1xuICAgICAgc3ViID0gMVxuICAgIH1cbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICBpZiAodmFsdWUgPCAwICYmIHN1YiA9PT0gMCAmJiB0aGlzW29mZnNldCArIGkgKyAxXSAhPT0gMCkge1xuICAgICAgc3ViID0gMVxuICAgIH1cbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdJbmRleCBvdXQgb2YgcmFuZ2UnKVxuICBpZiAob2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gd3JpdGVGbG9hdExFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiBjb3B5ICh0YXJnZXQsIHRhcmdldFN0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXRTdGFydCA+PSB0YXJnZXQubGVuZ3RoKSB0YXJnZXRTdGFydCA9IHRhcmdldC5sZW5ndGhcbiAgaWYgKCF0YXJnZXRTdGFydCkgdGFyZ2V0U3RhcnQgPSAwXG4gIGlmIChlbmQgPiAwICYmIGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuIDBcbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgdGhpcy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAodGFyZ2V0U3RhcnQgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICB9XG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0IDwgZW5kIC0gc3RhcnQpIHtcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgKyBzdGFydFxuICB9XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG4gIHZhciBpXG5cbiAgaWYgKHRoaXMgPT09IHRhcmdldCAmJiBzdGFydCA8IHRhcmdldFN0YXJ0ICYmIHRhcmdldFN0YXJ0IDwgZW5kKSB7XG4gICAgLy8gZGVzY2VuZGluZyBjb3B5IGZyb20gZW5kXG4gICAgZm9yIChpID0gbGVuIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2UgaWYgKGxlbiA8IDEwMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gYXNjZW5kaW5nIGNvcHkgZnJvbSBzdGFydFxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47ICsraSkge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgVWludDhBcnJheS5wcm90b3R5cGUuc2V0LmNhbGwoXG4gICAgICB0YXJnZXQsXG4gICAgICB0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksXG4gICAgICB0YXJnZXRTdGFydFxuICAgIClcbiAgfVxuXG4gIHJldHVybiBsZW5cbn1cblxuLy8gVXNhZ2U6XG4vLyAgICBidWZmZXIuZmlsbChudW1iZXJbLCBvZmZzZXRbLCBlbmRdXSlcbi8vICAgIGJ1ZmZlci5maWxsKGJ1ZmZlclssIG9mZnNldFssIGVuZF1dKVxuLy8gICAgYnVmZmVyLmZpbGwoc3RyaW5nWywgb2Zmc2V0WywgZW5kXV1bLCBlbmNvZGluZ10pXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiBmaWxsICh2YWwsIHN0YXJ0LCBlbmQsIGVuY29kaW5nKSB7XG4gIC8vIEhhbmRsZSBzdHJpbmcgY2FzZXM6XG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh0eXBlb2Ygc3RhcnQgPT09ICdzdHJpbmcnKSB7XG4gICAgICBlbmNvZGluZyA9IHN0YXJ0XG4gICAgICBzdGFydCA9IDBcbiAgICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZW5kID09PSAnc3RyaW5nJykge1xuICAgICAgZW5jb2RpbmcgPSBlbmRcbiAgICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gICAgfVxuICAgIGlmICh2YWwubGVuZ3RoID09PSAxKSB7XG4gICAgICB2YXIgY29kZSA9IHZhbC5jaGFyQ29kZUF0KDApXG4gICAgICBpZiAoY29kZSA8IDI1Nikge1xuICAgICAgICB2YWwgPSBjb2RlXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChlbmNvZGluZyAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VuY29kaW5nIG11c3QgYmUgYSBzdHJpbmcnKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGVuY29kaW5nID09PSAnc3RyaW5nJyAmJiAhQnVmZmVyLmlzRW5jb2RpbmcoZW5jb2RpbmcpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgdmFsID0gdmFsICYgMjU1XG4gIH1cblxuICAvLyBJbnZhbGlkIHJhbmdlcyBhcmUgbm90IHNldCB0byBhIGRlZmF1bHQsIHNvIGNhbiByYW5nZSBjaGVjayBlYXJseS5cbiAgaWYgKHN0YXJ0IDwgMCB8fCB0aGlzLmxlbmd0aCA8IHN0YXJ0IHx8IHRoaXMubGVuZ3RoIDwgZW5kKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ091dCBvZiByYW5nZSBpbmRleCcpXG4gIH1cblxuICBpZiAoZW5kIDw9IHN0YXJ0KSB7XG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHN0YXJ0ID0gc3RhcnQgPj4+IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyB0aGlzLmxlbmd0aCA6IGVuZCA+Pj4gMFxuXG4gIGlmICghdmFsKSB2YWwgPSAwXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7ICsraSkge1xuICAgICAgdGhpc1tpXSA9IHZhbFxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSBCdWZmZXIuaXNCdWZmZXIodmFsKVxuICAgICAgPyB2YWxcbiAgICAgIDogdXRmOFRvQnl0ZXMobmV3IEJ1ZmZlcih2YWwsIGVuY29kaW5nKS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSAwOyBpIDwgZW5kIC0gc3RhcnQ7ICsraSkge1xuICAgICAgdGhpc1tpICsgc3RhcnRdID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXitcXC8wLTlBLVphLXotX10vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgY29udmVydHMgc3RyaW5ncyB3aXRoIGxlbmd0aCA8IDIgdG8gJydcbiAgaWYgKHN0ci5sZW5ndGggPCAyKSByZXR1cm4gJydcbiAgLy8gTm9kZSBhbGxvd3MgZm9yIG5vbi1wYWRkZWQgYmFzZTY0IHN0cmluZ3MgKG1pc3NpbmcgdHJhaWxpbmcgPT09KSwgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHdoaWxlIChzdHIubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgIHN0ciA9IHN0ciArICc9J1xuICB9XG4gIHJldHVybiBzdHJcbn1cblxuZnVuY3Rpb24gc3RyaW5ndHJpbSAoc3RyKSB7XG4gIGlmIChzdHIudHJpbSkgcmV0dXJuIHN0ci50cmltKClcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJylcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyaW5nLCB1bml0cykge1xuICB1bml0cyA9IHVuaXRzIHx8IEluZmluaXR5XG4gIHZhciBjb2RlUG9pbnRcbiAgdmFyIGxlbmd0aCA9IHN0cmluZy5sZW5ndGhcbiAgdmFyIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gIHZhciBieXRlcyA9IFtdXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoIWxlYWRTdXJyb2dhdGUpIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcbiAgICAgICAgaWYgKGNvZGVQb2ludCA+IDB4REJGRikge1xuICAgICAgICAgIC8vIHVuZXhwZWN0ZWQgdHJhaWxcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIDIgbGVhZHMgaW4gYSByb3dcbiAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gdmFsaWQgc3Vycm9nYXRlIHBhaXJcbiAgICAgIGNvZGVQb2ludCA9IChsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwKSArIDB4MTAwMDBcbiAgICB9IGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgIH1cblxuICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDExMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7ICsraSkge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgKytpKSB7XG4gICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG5cbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBpc25hbiAodmFsKSB7XG4gIHJldHVybiB2YWwgIT09IHZhbCAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXNlbGYtY29tcGFyZVxufVxuIiwiZXhwb3J0cy5yZWFkID0gcmVxdWlyZSgnLi9yZWFkJylcbmV4cG9ydHMud3JpdGUgPSByZXF1aXJlKCcuL3dyaXRlJylcbiIsIm1vZHVsZS5leHBvcnRzID0gQ2h1bmtTdG9yZVJlYWRTdHJlYW1cblxudmFyIGluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKVxudmFyIHN0cmVhbSA9IHJlcXVpcmUoJ3JlYWRhYmxlLXN0cmVhbScpXG5cbmluaGVyaXRzKENodW5rU3RvcmVSZWFkU3RyZWFtLCBzdHJlYW0uUmVhZGFibGUpXG5cbmZ1bmN0aW9uIENodW5rU3RvcmVSZWFkU3RyZWFtIChzdG9yZSwgY2h1bmtMZW5ndGgsIG9wdHMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIENodW5rU3RvcmVSZWFkU3RyZWFtKSkge1xuICAgIHJldHVybiBuZXcgQ2h1bmtTdG9yZVJlYWRTdHJlYW0oc3RvcmUsIGNodW5rTGVuZ3RoLCBvcHRzKVxuICB9XG4gIHN0cmVhbS5SZWFkYWJsZS5jYWxsKHRoaXMsIG9wdHMpXG4gIGlmICghb3B0cykgb3B0cyA9IHt9XG5cbiAgaWYgKCFzdG9yZSB8fCAhc3RvcmUucHV0IHx8ICFzdG9yZS5nZXQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpcnN0IGFyZ3VtZW50IG11c3QgYmUgYW4gYWJzdHJhY3QtY2h1bmstc3RvcmUgY29tcGxpYW50IHN0b3JlJylcbiAgfVxuICBjaHVua0xlbmd0aCA9IE51bWJlcihjaHVua0xlbmd0aClcbiAgaWYgKCFjaHVua0xlbmd0aCkgdGhyb3cgbmV3IEVycm9yKCdTZWNvbmQgYXJndW1lbnQgbXVzdCBiZSBhIGNodW5rIGxlbmd0aCcpXG5cbiAgdGhpcy5fbGVuZ3RoID0gb3B0cy5sZW5ndGggfHwgc3RvcmUubGVuZ3RoXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHRoaXMuX2xlbmd0aCkpIHRocm93IG5ldyBFcnJvcignbWlzc2luZyByZXF1aXJlZCBgbGVuZ3RoYCBwcm9wZXJ0eScpXG5cbiAgdGhpcy5fc3RvcmUgPSBzdG9yZVxuICB0aGlzLl9jaHVua0xlbmd0aCA9IGNodW5rTGVuZ3RoXG4gIHRoaXMuX2luZGV4ID0gMFxufVxuXG5DaHVua1N0b3JlUmVhZFN0cmVhbS5wcm90b3R5cGUuX3JlYWQgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuICBpZiAoc2VsZi5faW5kZXggKiBzZWxmLl9jaHVua0xlbmd0aCA+PSBzZWxmLl9sZW5ndGgpIHtcbiAgICBzZWxmLnB1c2gobnVsbClcbiAgfSBlbHNlIHtcbiAgICBzZWxmLl9zdG9yZS5nZXQoc2VsZi5faW5kZXgsIGZ1bmN0aW9uIChlcnIsIGNodW5rKSB7XG4gICAgICBpZiAoZXJyKSByZXR1cm4gc2VsZi5kZXN0cm95KGVycilcbiAgICAgIHNlbGYucHVzaChjaHVuaylcbiAgICB9KVxuICB9XG4gIHNlbGYuX2luZGV4ICs9IDFcbn1cblxuQ2h1bmtTdG9yZVJlYWRTdHJlYW0ucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoZXJyKSB7XG4gIGlmICh0aGlzLmRlc3Ryb3llZCkgcmV0dXJuXG4gIHRoaXMuZGVzdHJveWVkID0gdHJ1ZVxuXG4gIGlmIChlcnIpIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpXG4gIHRoaXMuZW1pdCgnY2xvc2UnKVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBDaHVua1N0b3JlV3JpdGVTdHJlYW1cblxudmFyIEJsb2NrU3RyZWFtID0gcmVxdWlyZSgnYmxvY2stc3RyZWFtMicpXG52YXIgaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpXG52YXIgc3RyZWFtID0gcmVxdWlyZSgncmVhZGFibGUtc3RyZWFtJylcblxuaW5oZXJpdHMoQ2h1bmtTdG9yZVdyaXRlU3RyZWFtLCBzdHJlYW0uV3JpdGFibGUpXG5cbmZ1bmN0aW9uIENodW5rU3RvcmVXcml0ZVN0cmVhbSAoc3RvcmUsIGNodW5rTGVuZ3RoLCBvcHRzKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuICBpZiAoIShzZWxmIGluc3RhbmNlb2YgQ2h1bmtTdG9yZVdyaXRlU3RyZWFtKSkge1xuICAgIHJldHVybiBuZXcgQ2h1bmtTdG9yZVdyaXRlU3RyZWFtKHN0b3JlLCBjaHVua0xlbmd0aCwgb3B0cylcbiAgfVxuICBzdHJlYW0uV3JpdGFibGUuY2FsbChzZWxmLCBvcHRzKVxuICBpZiAoIW9wdHMpIG9wdHMgPSB7fVxuXG4gIGlmICghc3RvcmUgfHwgIXN0b3JlLnB1dCB8fCAhc3RvcmUuZ2V0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdGaXJzdCBhcmd1bWVudCBtdXN0IGJlIGFuIGFic3RyYWN0LWNodW5rLXN0b3JlIGNvbXBsaWFudCBzdG9yZScpXG4gIH1cbiAgY2h1bmtMZW5ndGggPSBOdW1iZXIoY2h1bmtMZW5ndGgpXG4gIGlmICghY2h1bmtMZW5ndGgpIHRocm93IG5ldyBFcnJvcignU2Vjb25kIGFyZ3VtZW50IG11c3QgYmUgYSBjaHVuayBsZW5ndGgnKVxuXG4gIHNlbGYuX2Jsb2Nrc3RyZWFtID0gbmV3IEJsb2NrU3RyZWFtKGNodW5rTGVuZ3RoLCB7IHplcm9QYWRkaW5nOiBmYWxzZSB9KVxuXG4gIHNlbGYuX2Jsb2Nrc3RyZWFtXG4gICAgLm9uKCdkYXRhJywgb25EYXRhKVxuICAgIC5vbignZXJyb3InLCBmdW5jdGlvbiAoZXJyKSB7IHNlbGYuZGVzdHJveShlcnIpIH0pXG5cbiAgdmFyIGluZGV4ID0gMFxuICBmdW5jdGlvbiBvbkRhdGEgKGNodW5rKSB7XG4gICAgaWYgKHNlbGYuZGVzdHJveWVkKSByZXR1cm5cbiAgICBzdG9yZS5wdXQoaW5kZXgsIGNodW5rKVxuICAgIGluZGV4ICs9IDFcbiAgfVxuXG4gIHNlbGYub24oJ2ZpbmlzaCcsIGZ1bmN0aW9uICgpIHsgdGhpcy5fYmxvY2tzdHJlYW0uZW5kKCkgfSlcbn1cblxuQ2h1bmtTdG9yZVdyaXRlU3RyZWFtLnByb3RvdHlwZS5fd3JpdGUgPSBmdW5jdGlvbiAoY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykge1xuICB0aGlzLl9ibG9ja3N0cmVhbS53cml0ZShjaHVuaywgZW5jb2RpbmcsIGNhbGxiYWNrKVxufVxuXG5DaHVua1N0b3JlV3JpdGVTdHJlYW0ucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoZXJyKSB7XG4gIGlmICh0aGlzLmRlc3Ryb3llZCkgcmV0dXJuXG4gIHRoaXMuZGVzdHJveWVkID0gdHJ1ZVxuXG4gIGlmIChlcnIpIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpXG4gIHRoaXMuZW1pdCgnY2xvc2UnKVxufVxuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbi8vIE5PVEU6IFRoZXNlIHR5cGUgY2hlY2tpbmcgZnVuY3Rpb25zIGludGVudGlvbmFsbHkgZG9uJ3QgdXNlIGBpbnN0YW5jZW9mYFxuLy8gYmVjYXVzZSBpdCBpcyBmcmFnaWxlIGFuZCBjYW4gYmUgZWFzaWx5IGZha2VkIHdpdGggYE9iamVjdC5jcmVhdGUoKWAuXG5cbmZ1bmN0aW9uIGlzQXJyYXkoYXJnKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KSB7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoYXJnKTtcbiAgfVxuICByZXR1cm4gb2JqZWN0VG9TdHJpbmcoYXJnKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cbmV4cG9ydHMuaXNBcnJheSA9IGlzQXJyYXk7XG5cbmZ1bmN0aW9uIGlzQm9vbGVhbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdib29sZWFuJztcbn1cbmV4cG9ydHMuaXNCb29sZWFuID0gaXNCb29sZWFuO1xuXG5mdW5jdGlvbiBpc051bGwoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IG51bGw7XG59XG5leHBvcnRzLmlzTnVsbCA9IGlzTnVsbDtcblxuZnVuY3Rpb24gaXNOdWxsT3JVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT0gbnVsbDtcbn1cbmV4cG9ydHMuaXNOdWxsT3JVbmRlZmluZWQgPSBpc051bGxPclVuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cbmV4cG9ydHMuaXNOdW1iZXIgPSBpc051bWJlcjtcblxuZnVuY3Rpb24gaXNTdHJpbmcoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3RyaW5nJztcbn1cbmV4cG9ydHMuaXNTdHJpbmcgPSBpc1N0cmluZztcblxuZnVuY3Rpb24gaXNTeW1ib2woYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3ltYm9sJztcbn1cbmV4cG9ydHMuaXNTeW1ib2wgPSBpc1N5bWJvbDtcblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbmV4cG9ydHMuaXNVbmRlZmluZWQgPSBpc1VuZGVmaW5lZDtcblxuZnVuY3Rpb24gaXNSZWdFeHAocmUpIHtcbiAgcmV0dXJuIG9iamVjdFRvU3RyaW5nKHJlKSA9PT0gJ1tvYmplY3QgUmVnRXhwXSc7XG59XG5leHBvcnRzLmlzUmVnRXhwID0gaXNSZWdFeHA7XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuZXhwb3J0cy5pc09iamVjdCA9IGlzT2JqZWN0O1xuXG5mdW5jdGlvbiBpc0RhdGUoZCkge1xuICByZXR1cm4gb2JqZWN0VG9TdHJpbmcoZCkgPT09ICdbb2JqZWN0IERhdGVdJztcbn1cbmV4cG9ydHMuaXNEYXRlID0gaXNEYXRlO1xuXG5mdW5jdGlvbiBpc0Vycm9yKGUpIHtcbiAgcmV0dXJuIChvYmplY3RUb1N0cmluZyhlKSA9PT0gJ1tvYmplY3QgRXJyb3JdJyB8fCBlIGluc3RhbmNlb2YgRXJyb3IpO1xufVxuZXhwb3J0cy5pc0Vycm9yID0gaXNFcnJvcjtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5leHBvcnRzLmlzRnVuY3Rpb24gPSBpc0Z1bmN0aW9uO1xuXG5mdW5jdGlvbiBpc1ByaW1pdGl2ZShhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gbnVsbCB8fFxuICAgICAgICAgdHlwZW9mIGFyZyA9PT0gJ2Jvb2xlYW4nIHx8XG4gICAgICAgICB0eXBlb2YgYXJnID09PSAnbnVtYmVyJyB8fFxuICAgICAgICAgdHlwZW9mIGFyZyA9PT0gJ3N0cmluZycgfHxcbiAgICAgICAgIHR5cGVvZiBhcmcgPT09ICdzeW1ib2wnIHx8ICAvLyBFUzYgc3ltYm9sXG4gICAgICAgICB0eXBlb2YgYXJnID09PSAndW5kZWZpbmVkJztcbn1cbmV4cG9ydHMuaXNQcmltaXRpdmUgPSBpc1ByaW1pdGl2ZTtcblxuZXhwb3J0cy5pc0J1ZmZlciA9IEJ1ZmZlci5pc0J1ZmZlcjtcblxuZnVuY3Rpb24gb2JqZWN0VG9TdHJpbmcobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufVxuIiwiLyoqXG4gKiBUaGlzIGlzIHRoZSB3ZWIgYnJvd3NlciBpbXBsZW1lbnRhdGlvbiBvZiBgZGVidWcoKWAuXG4gKlxuICogRXhwb3NlIGBkZWJ1ZygpYCBhcyB0aGUgbW9kdWxlLlxuICovXG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vZGVidWcnKTtcbmV4cG9ydHMubG9nID0gbG9nO1xuZXhwb3J0cy5mb3JtYXRBcmdzID0gZm9ybWF0QXJncztcbmV4cG9ydHMuc2F2ZSA9IHNhdmU7XG5leHBvcnRzLmxvYWQgPSBsb2FkO1xuZXhwb3J0cy51c2VDb2xvcnMgPSB1c2VDb2xvcnM7XG5leHBvcnRzLnN0b3JhZ2UgPSAndW5kZWZpbmVkJyAhPSB0eXBlb2YgY2hyb21lXG4gICAgICAgICAgICAgICAmJiAndW5kZWZpbmVkJyAhPSB0eXBlb2YgY2hyb21lLnN0b3JhZ2VcbiAgICAgICAgICAgICAgICAgID8gY2hyb21lLnN0b3JhZ2UubG9jYWxcbiAgICAgICAgICAgICAgICAgIDogbG9jYWxzdG9yYWdlKCk7XG5cbi8qKlxuICogQ29sb3JzLlxuICovXG5cbmV4cG9ydHMuY29sb3JzID0gW1xuICAnbGlnaHRzZWFncmVlbicsXG4gICdmb3Jlc3RncmVlbicsXG4gICdnb2xkZW5yb2QnLFxuICAnZG9kZ2VyYmx1ZScsXG4gICdkYXJrb3JjaGlkJyxcbiAgJ2NyaW1zb24nXG5dO1xuXG4vKipcbiAqIEN1cnJlbnRseSBvbmx5IFdlYktpdC1iYXNlZCBXZWIgSW5zcGVjdG9ycywgRmlyZWZveCA+PSB2MzEsXG4gKiBhbmQgdGhlIEZpcmVidWcgZXh0ZW5zaW9uIChhbnkgRmlyZWZveCB2ZXJzaW9uKSBhcmUga25vd25cbiAqIHRvIHN1cHBvcnQgXCIlY1wiIENTUyBjdXN0b21pemF0aW9ucy5cbiAqXG4gKiBUT0RPOiBhZGQgYSBgbG9jYWxTdG9yYWdlYCB2YXJpYWJsZSB0byBleHBsaWNpdGx5IGVuYWJsZS9kaXNhYmxlIGNvbG9yc1xuICovXG5cbmZ1bmN0aW9uIHVzZUNvbG9ycygpIHtcbiAgLy8gTkI6IEluIGFuIEVsZWN0cm9uIHByZWxvYWQgc2NyaXB0LCBkb2N1bWVudCB3aWxsIGJlIGRlZmluZWQgYnV0IG5vdCBmdWxseVxuICAvLyBpbml0aWFsaXplZC4gU2luY2Ugd2Uga25vdyB3ZSdyZSBpbiBDaHJvbWUsIHdlJ2xsIGp1c3QgZGV0ZWN0IHRoaXMgY2FzZVxuICAvLyBleHBsaWNpdGx5XG4gIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiAncHJvY2VzcycgaW4gd2luZG93ICYmIHdpbmRvdy5wcm9jZXNzLnR5cGUgPT09ICdyZW5kZXJlcicpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIGlzIHdlYmtpdD8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMTY0NTk2MDYvMzc2NzczXG4gIC8vIGRvY3VtZW50IGlzIHVuZGVmaW5lZCBpbiByZWFjdC1uYXRpdmU6IGh0dHBzOi8vZ2l0aHViLmNvbS9mYWNlYm9vay9yZWFjdC1uYXRpdmUvcHVsbC8xNjMyXG4gIHJldHVybiAodHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiAnV2Via2l0QXBwZWFyYW5jZScgaW4gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlKSB8fFxuICAgIC8vIGlzIGZpcmVidWc/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzM5ODEyMC8zNzY3NzNcbiAgICAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LmNvbnNvbGUgJiYgKGNvbnNvbGUuZmlyZWJ1ZyB8fCAoY29uc29sZS5leGNlcHRpb24gJiYgY29uc29sZS50YWJsZSkpKSB8fFxuICAgIC8vIGlzIGZpcmVmb3ggPj0gdjMxP1xuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvVG9vbHMvV2ViX0NvbnNvbGUjU3R5bGluZ19tZXNzYWdlc1xuICAgIChuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvZmlyZWZveFxcLyhcXGQrKS8pICYmIHBhcnNlSW50KFJlZ0V4cC4kMSwgMTApID49IDMxKSB8fFxuICAgIC8vIGRvdWJsZSBjaGVjayB3ZWJraXQgaW4gdXNlckFnZW50IGp1c3QgaW4gY2FzZSB3ZSBhcmUgaW4gYSB3b3JrZXJcbiAgICAobmF2aWdhdG9yLnVzZXJBZ2VudCAmJiBuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkubWF0Y2goL2FwcGxld2Via2l0XFwvKFxcZCspLykpO1xufVxuXG4vKipcbiAqIE1hcCAlaiB0byBgSlNPTi5zdHJpbmdpZnkoKWAsIHNpbmNlIG5vIFdlYiBJbnNwZWN0b3JzIGRvIHRoYXQgYnkgZGVmYXVsdC5cbiAqL1xuXG5leHBvcnRzLmZvcm1hdHRlcnMuaiA9IGZ1bmN0aW9uKHYpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiAnW1VuZXhwZWN0ZWRKU09OUGFyc2VFcnJvcl06ICcgKyBlcnIubWVzc2FnZTtcbiAgfVxufTtcblxuXG4vKipcbiAqIENvbG9yaXplIGxvZyBhcmd1bWVudHMgaWYgZW5hYmxlZC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGZvcm1hdEFyZ3MoYXJncykge1xuICB2YXIgdXNlQ29sb3JzID0gdGhpcy51c2VDb2xvcnM7XG5cbiAgYXJnc1swXSA9ICh1c2VDb2xvcnMgPyAnJWMnIDogJycpXG4gICAgKyB0aGlzLm5hbWVzcGFjZVxuICAgICsgKHVzZUNvbG9ycyA/ICcgJWMnIDogJyAnKVxuICAgICsgYXJnc1swXVxuICAgICsgKHVzZUNvbG9ycyA/ICclYyAnIDogJyAnKVxuICAgICsgJysnICsgZXhwb3J0cy5odW1hbml6ZSh0aGlzLmRpZmYpO1xuXG4gIGlmICghdXNlQ29sb3JzKSByZXR1cm47XG5cbiAgdmFyIGMgPSAnY29sb3I6ICcgKyB0aGlzLmNvbG9yO1xuICBhcmdzLnNwbGljZSgxLCAwLCBjLCAnY29sb3I6IGluaGVyaXQnKVxuXG4gIC8vIHRoZSBmaW5hbCBcIiVjXCIgaXMgc29tZXdoYXQgdHJpY2t5LCBiZWNhdXNlIHRoZXJlIGNvdWxkIGJlIG90aGVyXG4gIC8vIGFyZ3VtZW50cyBwYXNzZWQgZWl0aGVyIGJlZm9yZSBvciBhZnRlciB0aGUgJWMsIHNvIHdlIG5lZWQgdG9cbiAgLy8gZmlndXJlIG91dCB0aGUgY29ycmVjdCBpbmRleCB0byBpbnNlcnQgdGhlIENTUyBpbnRvXG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBsYXN0QyA9IDA7XG4gIGFyZ3NbMF0ucmVwbGFjZSgvJVthLXolXS9nLCBmdW5jdGlvbihtYXRjaCkge1xuICAgIGlmICgnJSUnID09PSBtYXRjaCkgcmV0dXJuO1xuICAgIGluZGV4Kys7XG4gICAgaWYgKCclYycgPT09IG1hdGNoKSB7XG4gICAgICAvLyB3ZSBvbmx5IGFyZSBpbnRlcmVzdGVkIGluIHRoZSAqbGFzdCogJWNcbiAgICAgIC8vICh0aGUgdXNlciBtYXkgaGF2ZSBwcm92aWRlZCB0aGVpciBvd24pXG4gICAgICBsYXN0QyA9IGluZGV4O1xuICAgIH1cbiAgfSk7XG5cbiAgYXJncy5zcGxpY2UobGFzdEMsIDAsIGMpO1xufVxuXG4vKipcbiAqIEludm9rZXMgYGNvbnNvbGUubG9nKClgIHdoZW4gYXZhaWxhYmxlLlxuICogTm8tb3Agd2hlbiBgY29uc29sZS5sb2dgIGlzIG5vdCBhIFwiZnVuY3Rpb25cIi5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gdGhpcyBoYWNrZXJ5IGlzIHJlcXVpcmVkIGZvciBJRTgvOSwgd2hlcmVcbiAgLy8gdGhlIGBjb25zb2xlLmxvZ2AgZnVuY3Rpb24gZG9lc24ndCBoYXZlICdhcHBseSdcbiAgcmV0dXJuICdvYmplY3QnID09PSB0eXBlb2YgY29uc29sZVxuICAgICYmIGNvbnNvbGUubG9nXG4gICAgJiYgRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5LmNhbGwoY29uc29sZS5sb2csIGNvbnNvbGUsIGFyZ3VtZW50cyk7XG59XG5cbi8qKlxuICogU2F2ZSBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNhdmUobmFtZXNwYWNlcykge1xuICB0cnkge1xuICAgIGlmIChudWxsID09IG5hbWVzcGFjZXMpIHtcbiAgICAgIGV4cG9ydHMuc3RvcmFnZS5yZW1vdmVJdGVtKCdkZWJ1ZycpO1xuICAgIH0gZWxzZSB7XG4gICAgICBleHBvcnRzLnN0b3JhZ2UuZGVidWcgPSBuYW1lc3BhY2VzO1xuICAgIH1cbiAgfSBjYXRjaChlKSB7fVxufVxuXG4vKipcbiAqIExvYWQgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgcHJldmlvdXNseSBwZXJzaXN0ZWQgZGVidWcgbW9kZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvYWQoKSB7XG4gIHZhciByO1xuICB0cnkge1xuICAgIHJldHVybiBleHBvcnRzLnN0b3JhZ2UuZGVidWc7XG4gIH0gY2F0Y2goZSkge31cblxuICAvLyBJZiBkZWJ1ZyBpc24ndCBzZXQgaW4gTFMsIGFuZCB3ZSdyZSBpbiBFbGVjdHJvbiwgdHJ5IHRvIGxvYWQgJERFQlVHXG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgJ2VudicgaW4gcHJvY2Vzcykge1xuICAgIHJldHVybiBwcm9jZXNzLmVudi5ERUJVRztcbiAgfVxufVxuXG4vKipcbiAqIEVuYWJsZSBuYW1lc3BhY2VzIGxpc3RlZCBpbiBgbG9jYWxTdG9yYWdlLmRlYnVnYCBpbml0aWFsbHkuXG4gKi9cblxuZXhwb3J0cy5lbmFibGUobG9hZCgpKTtcblxuLyoqXG4gKiBMb2NhbHN0b3JhZ2UgYXR0ZW1wdHMgdG8gcmV0dXJuIHRoZSBsb2NhbHN0b3JhZ2UuXG4gKlxuICogVGhpcyBpcyBuZWNlc3NhcnkgYmVjYXVzZSBzYWZhcmkgdGhyb3dzXG4gKiB3aGVuIGEgdXNlciBkaXNhYmxlcyBjb29raWVzL2xvY2Fsc3RvcmFnZVxuICogYW5kIHlvdSBhdHRlbXB0IHRvIGFjY2VzcyBpdC5cbiAqXG4gKiBAcmV0dXJuIHtMb2NhbFN0b3JhZ2V9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBsb2NhbHN0b3JhZ2UoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG4gIH0gY2F0Y2ggKGUpIHt9XG59XG4iLCJcbi8qKlxuICogVGhpcyBpcyB0aGUgY29tbW9uIGxvZ2ljIGZvciBib3RoIHRoZSBOb2RlLmpzIGFuZCB3ZWIgYnJvd3NlclxuICogaW1wbGVtZW50YXRpb25zIG9mIGBkZWJ1ZygpYC5cbiAqXG4gKiBFeHBvc2UgYGRlYnVnKClgIGFzIHRoZSBtb2R1bGUuXG4gKi9cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gY3JlYXRlRGVidWcuZGVidWcgPSBjcmVhdGVEZWJ1Zy5kZWZhdWx0ID0gY3JlYXRlRGVidWc7XG5leHBvcnRzLmNvZXJjZSA9IGNvZXJjZTtcbmV4cG9ydHMuZGlzYWJsZSA9IGRpc2FibGU7XG5leHBvcnRzLmVuYWJsZSA9IGVuYWJsZTtcbmV4cG9ydHMuZW5hYmxlZCA9IGVuYWJsZWQ7XG5leHBvcnRzLmh1bWFuaXplID0gcmVxdWlyZSgnbXMnKTtcblxuLyoqXG4gKiBUaGUgY3VycmVudGx5IGFjdGl2ZSBkZWJ1ZyBtb2RlIG5hbWVzLCBhbmQgbmFtZXMgdG8gc2tpcC5cbiAqL1xuXG5leHBvcnRzLm5hbWVzID0gW107XG5leHBvcnRzLnNraXBzID0gW107XG5cbi8qKlxuICogTWFwIG9mIHNwZWNpYWwgXCIlblwiIGhhbmRsaW5nIGZ1bmN0aW9ucywgZm9yIHRoZSBkZWJ1ZyBcImZvcm1hdFwiIGFyZ3VtZW50LlxuICpcbiAqIFZhbGlkIGtleSBuYW1lcyBhcmUgYSBzaW5nbGUsIGxvd2VyIG9yIHVwcGVyLWNhc2UgbGV0dGVyLCBpLmUuIFwiblwiIGFuZCBcIk5cIi5cbiAqL1xuXG5leHBvcnRzLmZvcm1hdHRlcnMgPSB7fTtcblxuLyoqXG4gKiBQcmV2aW91cyBsb2cgdGltZXN0YW1wLlxuICovXG5cbnZhciBwcmV2VGltZTtcblxuLyoqXG4gKiBTZWxlY3QgYSBjb2xvci5cbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNlbGVjdENvbG9yKG5hbWVzcGFjZSkge1xuICB2YXIgaGFzaCA9IDAsIGk7XG5cbiAgZm9yIChpIGluIG5hbWVzcGFjZSkge1xuICAgIGhhc2ggID0gKChoYXNoIDw8IDUpIC0gaGFzaCkgKyBuYW1lc3BhY2UuY2hhckNvZGVBdChpKTtcbiAgICBoYXNoIHw9IDA7IC8vIENvbnZlcnQgdG8gMzJiaXQgaW50ZWdlclxuICB9XG5cbiAgcmV0dXJuIGV4cG9ydHMuY29sb3JzW01hdGguYWJzKGhhc2gpICUgZXhwb3J0cy5jb2xvcnMubGVuZ3RoXTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBkZWJ1Z2dlciB3aXRoIHRoZSBnaXZlbiBgbmFtZXNwYWNlYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gY3JlYXRlRGVidWcobmFtZXNwYWNlKSB7XG5cbiAgZnVuY3Rpb24gZGVidWcoKSB7XG4gICAgLy8gZGlzYWJsZWQ/XG4gICAgaWYgKCFkZWJ1Zy5lbmFibGVkKSByZXR1cm47XG5cbiAgICB2YXIgc2VsZiA9IGRlYnVnO1xuXG4gICAgLy8gc2V0IGBkaWZmYCB0aW1lc3RhbXBcbiAgICB2YXIgY3VyciA9ICtuZXcgRGF0ZSgpO1xuICAgIHZhciBtcyA9IGN1cnIgLSAocHJldlRpbWUgfHwgY3Vycik7XG4gICAgc2VsZi5kaWZmID0gbXM7XG4gICAgc2VsZi5wcmV2ID0gcHJldlRpbWU7XG4gICAgc2VsZi5jdXJyID0gY3VycjtcbiAgICBwcmV2VGltZSA9IGN1cnI7XG5cbiAgICAvLyB0dXJuIHRoZSBgYXJndW1lbnRzYCBpbnRvIGEgcHJvcGVyIEFycmF5XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBhcmdzW2ldID0gYXJndW1lbnRzW2ldO1xuICAgIH1cblxuICAgIGFyZ3NbMF0gPSBleHBvcnRzLmNvZXJjZShhcmdzWzBdKTtcblxuICAgIGlmICgnc3RyaW5nJyAhPT0gdHlwZW9mIGFyZ3NbMF0pIHtcbiAgICAgIC8vIGFueXRoaW5nIGVsc2UgbGV0J3MgaW5zcGVjdCB3aXRoICVPXG4gICAgICBhcmdzLnVuc2hpZnQoJyVPJyk7XG4gICAgfVxuXG4gICAgLy8gYXBwbHkgYW55IGBmb3JtYXR0ZXJzYCB0cmFuc2Zvcm1hdGlvbnNcbiAgICB2YXIgaW5kZXggPSAwO1xuICAgIGFyZ3NbMF0gPSBhcmdzWzBdLnJlcGxhY2UoLyUoW2EtekEtWiVdKS9nLCBmdW5jdGlvbihtYXRjaCwgZm9ybWF0KSB7XG4gICAgICAvLyBpZiB3ZSBlbmNvdW50ZXIgYW4gZXNjYXBlZCAlIHRoZW4gZG9uJ3QgaW5jcmVhc2UgdGhlIGFycmF5IGluZGV4XG4gICAgICBpZiAobWF0Y2ggPT09ICclJScpIHJldHVybiBtYXRjaDtcbiAgICAgIGluZGV4Kys7XG4gICAgICB2YXIgZm9ybWF0dGVyID0gZXhwb3J0cy5mb3JtYXR0ZXJzW2Zvcm1hdF07XG4gICAgICBpZiAoJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGZvcm1hdHRlcikge1xuICAgICAgICB2YXIgdmFsID0gYXJnc1tpbmRleF07XG4gICAgICAgIG1hdGNoID0gZm9ybWF0dGVyLmNhbGwoc2VsZiwgdmFsKTtcblxuICAgICAgICAvLyBub3cgd2UgbmVlZCB0byByZW1vdmUgYGFyZ3NbaW5kZXhdYCBzaW5jZSBpdCdzIGlubGluZWQgaW4gdGhlIGBmb3JtYXRgXG4gICAgICAgIGFyZ3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgaW5kZXgtLTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXRjaDtcbiAgICB9KTtcblxuICAgIC8vIGFwcGx5IGVudi1zcGVjaWZpYyBmb3JtYXR0aW5nIChjb2xvcnMsIGV0Yy4pXG4gICAgZXhwb3J0cy5mb3JtYXRBcmdzLmNhbGwoc2VsZiwgYXJncyk7XG5cbiAgICB2YXIgbG9nRm4gPSBlbmFibGVkLmxvZyB8fCBleHBvcnRzLmxvZyB8fCBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuICAgIGxvZ0ZuLmFwcGx5KHNlbGYsIGFyZ3MpO1xuICB9XG5cbiAgZGVidWcubmFtZXNwYWNlID0gbmFtZXNwYWNlO1xuICBkZWJ1Zy5lbmFibGVkID0gZXhwb3J0cy5lbmFibGVkKG5hbWVzcGFjZSk7XG4gIGRlYnVnLnVzZUNvbG9ycyA9IGV4cG9ydHMudXNlQ29sb3JzKCk7XG4gIGRlYnVnLmNvbG9yID0gc2VsZWN0Q29sb3IobmFtZXNwYWNlKTtcblxuICAvLyBlbnYtc3BlY2lmaWMgaW5pdGlhbGl6YXRpb24gbG9naWMgZm9yIGRlYnVnIGluc3RhbmNlc1xuICBpZiAoJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGV4cG9ydHMuaW5pdCkge1xuICAgIGV4cG9ydHMuaW5pdChkZWJ1Zyk7XG4gIH1cblxuICByZXR1cm4gZGVidWc7XG59XG5cbi8qKlxuICogRW5hYmxlcyBhIGRlYnVnIG1vZGUgYnkgbmFtZXNwYWNlcy4gVGhpcyBjYW4gaW5jbHVkZSBtb2Rlc1xuICogc2VwYXJhdGVkIGJ5IGEgY29sb24gYW5kIHdpbGRjYXJkcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlc1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBlbmFibGUobmFtZXNwYWNlcykge1xuICBleHBvcnRzLnNhdmUobmFtZXNwYWNlcyk7XG5cbiAgdmFyIHNwbGl0ID0gKG5hbWVzcGFjZXMgfHwgJycpLnNwbGl0KC9bXFxzLF0rLyk7XG4gIHZhciBsZW4gPSBzcGxpdC5sZW5ndGg7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIGlmICghc3BsaXRbaV0pIGNvbnRpbnVlOyAvLyBpZ25vcmUgZW1wdHkgc3RyaW5nc1xuICAgIG5hbWVzcGFjZXMgPSBzcGxpdFtpXS5yZXBsYWNlKC9cXCovZywgJy4qPycpO1xuICAgIGlmIChuYW1lc3BhY2VzWzBdID09PSAnLScpIHtcbiAgICAgIGV4cG9ydHMuc2tpcHMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMuc3Vic3RyKDEpICsgJyQnKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cG9ydHMubmFtZXMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMgKyAnJCcpKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBEaXNhYmxlIGRlYnVnIG91dHB1dC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGRpc2FibGUoKSB7XG4gIGV4cG9ydHMuZW5hYmxlKCcnKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRydWUgaWYgdGhlIGdpdmVuIG1vZGUgbmFtZSBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGVuYWJsZWQobmFtZSkge1xuICB2YXIgaSwgbGVuO1xuICBmb3IgKGkgPSAwLCBsZW4gPSBleHBvcnRzLnNraXBzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKGV4cG9ydHMuc2tpcHNbaV0udGVzdChuYW1lKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICBmb3IgKGkgPSAwLCBsZW4gPSBleHBvcnRzLm5hbWVzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKGV4cG9ydHMubmFtZXNbaV0udGVzdChuYW1lKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBDb2VyY2UgYHZhbGAuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtNaXhlZH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGNvZXJjZSh2YWwpIHtcbiAgaWYgKHZhbCBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gdmFsLnN0YWNrIHx8IHZhbC5tZXNzYWdlO1xuICByZXR1cm4gdmFsO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50c1tpXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gYXJndW1lbnRzW2ldO1xuICAgIH1cbn07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuZnVuY3Rpb24gRXZlbnRFbWl0dGVyKCkge1xuICB0aGlzLl9ldmVudHMgPSB0aGlzLl9ldmVudHMgfHwge307XG4gIHRoaXMuX21heExpc3RlbmVycyA9IHRoaXMuX21heExpc3RlbmVycyB8fCB1bmRlZmluZWQ7XG59XG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50RW1pdHRlcjtcblxuLy8gQmFja3dhcmRzLWNvbXBhdCB3aXRoIG5vZGUgMC4xMC54XG5FdmVudEVtaXR0ZXIuRXZlbnRFbWl0dGVyID0gRXZlbnRFbWl0dGVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9ldmVudHMgPSB1bmRlZmluZWQ7XG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9tYXhMaXN0ZW5lcnMgPSB1bmRlZmluZWQ7XG5cbi8vIEJ5IGRlZmF1bHQgRXZlbnRFbWl0dGVycyB3aWxsIHByaW50IGEgd2FybmluZyBpZiBtb3JlIHRoYW4gMTAgbGlzdGVuZXJzIGFyZVxuLy8gYWRkZWQgdG8gaXQuIFRoaXMgaXMgYSB1c2VmdWwgZGVmYXVsdCB3aGljaCBoZWxwcyBmaW5kaW5nIG1lbW9yeSBsZWFrcy5cbkV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzID0gMTA7XG5cbi8vIE9idmlvdXNseSBub3QgYWxsIEVtaXR0ZXJzIHNob3VsZCBiZSBsaW1pdGVkIHRvIDEwLiBUaGlzIGZ1bmN0aW9uIGFsbG93c1xuLy8gdGhhdCB0byBiZSBpbmNyZWFzZWQuIFNldCB0byB6ZXJvIGZvciB1bmxpbWl0ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnNldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uKG4pIHtcbiAgaWYgKCFpc051bWJlcihuKSB8fCBuIDwgMCB8fCBpc05hTihuKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ24gbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpO1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSBuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGVyLCBoYW5kbGVyLCBsZW4sIGFyZ3MsIGksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgaWYgKCF0aGlzLl9ldmVudHMuZXJyb3IgfHxcbiAgICAgICAgKGlzT2JqZWN0KHRoaXMuX2V2ZW50cy5lcnJvcikgJiYgIXRoaXMuX2V2ZW50cy5lcnJvci5sZW5ndGgpKSB7XG4gICAgICBlciA9IGFyZ3VtZW50c1sxXTtcbiAgICAgIGlmIChlciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IGVyOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQXQgbGVhc3QgZ2l2ZSBzb21lIGtpbmQgb2YgY29udGV4dCB0byB0aGUgdXNlclxuICAgICAgICB2YXIgZXJyID0gbmV3IEVycm9yKCdVbmNhdWdodCwgdW5zcGVjaWZpZWQgXCJlcnJvclwiIGV2ZW50LiAoJyArIGVyICsgJyknKTtcbiAgICAgICAgZXJyLmNvbnRleHQgPSBlcjtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGhhbmRsZXIgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzVW5kZWZpbmVkKGhhbmRsZXIpKVxuICAgIHJldHVybiBmYWxzZTtcblxuICBpZiAoaXNGdW5jdGlvbihoYW5kbGVyKSkge1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgICAgY2FzZSAxOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gc2xvd2VyXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAgICAgaGFuZGxlci5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNPYmplY3QoaGFuZGxlcikpIHtcbiAgICBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICBsaXN0ZW5lcnMgPSBoYW5kbGVyLnNsaWNlKCk7XG4gICAgbGVuID0gbGlzdGVuZXJzLmxlbmd0aDtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspXG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gVG8gYXZvaWQgcmVjdXJzaW9uIGluIHRoZSBjYXNlIHRoYXQgdHlwZSA9PT0gXCJuZXdMaXN0ZW5lclwiISBCZWZvcmVcbiAgLy8gYWRkaW5nIGl0IHRvIHRoZSBsaXN0ZW5lcnMsIGZpcnN0IGVtaXQgXCJuZXdMaXN0ZW5lclwiLlxuICBpZiAodGhpcy5fZXZlbnRzLm5ld0xpc3RlbmVyKVxuICAgIHRoaXMuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLFxuICAgICAgICAgICAgICBpc0Z1bmN0aW9uKGxpc3RlbmVyLmxpc3RlbmVyKSA/XG4gICAgICAgICAgICAgIGxpc3RlbmVyLmxpc3RlbmVyIDogbGlzdGVuZXIpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIC8vIE9wdGltaXplIHRoZSBjYXNlIG9mIG9uZSBsaXN0ZW5lci4gRG9uJ3QgbmVlZCB0aGUgZXh0cmEgYXJyYXkgb2JqZWN0LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IGxpc3RlbmVyO1xuICBlbHNlIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgZ290IGFuIGFycmF5LCBqdXN0IGFwcGVuZC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG4gIGVsc2VcbiAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBbdGhpcy5fZXZlbnRzW3R5cGVdLCBsaXN0ZW5lcl07XG5cbiAgLy8gQ2hlY2sgZm9yIGxpc3RlbmVyIGxlYWtcbiAgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkgJiYgIXRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQpIHtcbiAgICBpZiAoIWlzVW5kZWZpbmVkKHRoaXMuX21heExpc3RlbmVycykpIHtcbiAgICAgIG0gPSB0aGlzLl9tYXhMaXN0ZW5lcnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycztcbiAgICB9XG5cbiAgICBpZiAobSAmJiBtID4gMCAmJiB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoID4gbSkge1xuICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCA9IHRydWU7XG4gICAgICBjb25zb2xlLmVycm9yKCcobm9kZSkgd2FybmluZzogcG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSAnICtcbiAgICAgICAgICAgICAgICAgICAgJ2xlYWsgZGV0ZWN0ZWQuICVkIGxpc3RlbmVycyBhZGRlZC4gJyArXG4gICAgICAgICAgICAgICAgICAgICdVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byBpbmNyZWFzZSBsaW1pdC4nLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoKTtcbiAgICAgIGlmICh0eXBlb2YgY29uc29sZS50cmFjZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvLyBub3Qgc3VwcG9ydGVkIGluIElFIDEwXG4gICAgICAgIGNvbnNvbGUudHJhY2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub24gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgdmFyIGZpcmVkID0gZmFsc2U7XG5cbiAgZnVuY3Rpb24gZygpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGcpO1xuXG4gICAgaWYgKCFmaXJlZCkge1xuICAgICAgZmlyZWQgPSB0cnVlO1xuICAgICAgbGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gIH1cblxuICBnLmxpc3RlbmVyID0gbGlzdGVuZXI7XG4gIHRoaXMub24odHlwZSwgZyk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBlbWl0cyBhICdyZW1vdmVMaXN0ZW5lcicgZXZlbnQgaWZmIHRoZSBsaXN0ZW5lciB3YXMgcmVtb3ZlZFxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBsaXN0LCBwb3NpdGlvbiwgbGVuZ3RoLCBpO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIGxpc3QgPSB0aGlzLl9ldmVudHNbdHlwZV07XG4gIGxlbmd0aCA9IGxpc3QubGVuZ3RoO1xuICBwb3NpdGlvbiA9IC0xO1xuXG4gIGlmIChsaXN0ID09PSBsaXN0ZW5lciB8fFxuICAgICAgKGlzRnVuY3Rpb24obGlzdC5saXN0ZW5lcikgJiYgbGlzdC5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcblxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGxpc3QpKSB7XG4gICAgZm9yIChpID0gbGVuZ3RoOyBpLS0gPiAwOykge1xuICAgICAgaWYgKGxpc3RbaV0gPT09IGxpc3RlbmVyIHx8XG4gICAgICAgICAgKGxpc3RbaV0ubGlzdGVuZXIgJiYgbGlzdFtpXS5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgICAgIHBvc2l0aW9uID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBvc2l0aW9uIDwgMClcbiAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgICBsaXN0Lmxlbmd0aCA9IDA7XG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaXN0LnNwbGljZShwb3NpdGlvbiwgMSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIga2V5LCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgLy8gbm90IGxpc3RlbmluZyBmb3IgcmVtb3ZlTGlzdGVuZXIsIG5vIG5lZWQgdG8gZW1pdFxuICBpZiAoIXRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcikge1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKVxuICAgICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgZWxzZSBpZiAodGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIGVtaXQgcmVtb3ZlTGlzdGVuZXIgZm9yIGFsbCBsaXN0ZW5lcnMgb24gYWxsIGV2ZW50c1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGZvciAoa2V5IGluIHRoaXMuX2V2ZW50cykge1xuICAgICAgaWYgKGtleSA9PT0gJ3JlbW92ZUxpc3RlbmVyJykgY29udGludWU7XG4gICAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycyhrZXkpO1xuICAgIH1cbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygncmVtb3ZlTGlzdGVuZXInKTtcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNGdW5jdGlvbihsaXN0ZW5lcnMpKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnMpO1xuICB9IGVsc2UgaWYgKGxpc3RlbmVycykge1xuICAgIC8vIExJRk8gb3JkZXJcbiAgICB3aGlsZSAobGlzdGVuZXJzLmxlbmd0aClcbiAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzW2xpc3RlbmVycy5sZW5ndGggLSAxXSk7XG4gIH1cbiAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IFtdO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gW3RoaXMuX2V2ZW50c1t0eXBlXV07XG4gIGVsc2VcbiAgICByZXQgPSB0aGlzLl9ldmVudHNbdHlwZV0uc2xpY2UoKTtcbiAgcmV0dXJuIHJldDtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJDb3VudCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgaWYgKHRoaXMuX2V2ZW50cykge1xuICAgIHZhciBldmxpc3RlbmVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gICAgaWYgKGlzRnVuY3Rpb24oZXZsaXN0ZW5lcikpXG4gICAgICByZXR1cm4gMTtcbiAgICBlbHNlIGlmIChldmxpc3RlbmVyKVxuICAgICAgcmV0dXJuIGV2bGlzdGVuZXIubGVuZ3RoO1xuICB9XG4gIHJldHVybiAwO1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHJldHVybiBlbWl0dGVyLmxpc3RlbmVyQ291bnQodHlwZSk7XG59O1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiBhcmcgIT09IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkKGFyZykge1xuICByZXR1cm4gYXJnID09PSB2b2lkIDA7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IElkYktleVN0b3JlXG5cbnZhciBzY29wZSA9IHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnID8gc2VsZiA6IHdpbmRvdyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lXG52YXIgSURCID0gc2NvcGUuaW5kZXhlZERCIHx8IHNjb3BlLm1vekluZGV4ZWREQiB8fCBzY29wZS53ZWJraXRJbmRleGVkREIgfHwgc2NvcGUubXNJbmRleGVkREJcblxuZnVuY3Rpb24gSWRiS2V5U3RvcmUgKG5hbWUsIG9wdHMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpIHRocm93IG5ldyBFcnJvcignQSBuYW1lIG11c3QgYmUgc3VwcGxpZWQgb2YgdHlwZSBzdHJpbmcnKVxuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgSWRiS2V5U3RvcmUpKSByZXR1cm4gbmV3IElkYktleVN0b3JlKG5hbWUsIG9wdHMpXG4gIGlmICghb3B0cykgb3B0cyA9IHt9XG5cbiAgc2VsZi5fZGIgPSBudWxsXG4gIHNlbGYuX3F1ZXVlID0gW11cblxuICB2YXIgcmVxdWVzdCA9IElEQi5vcGVuKG5hbWUpXG5cbiAgcmVxdWVzdC5vbmVycm9yID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgb25lcnJvcihldmVudCwgb3B0cy5vbmVycm9yKVxuICB9XG5cbiAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBzZWxmLl9kYiA9IGV2ZW50LnRhcmdldC5yZXN1bHRcbiAgICBzZWxmLl9kcmFpblF1ZXVlKClcbiAgICBpZiAob3B0cy5vbnJlYWR5KSBvcHRzLm9ucmVhZHkoKVxuICB9XG5cbiAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICB2YXIgZGIgPSBldmVudC50YXJnZXQucmVzdWx0XG4gICAgZGIuY3JlYXRlT2JqZWN0U3RvcmUoJ2t2JylcbiAgfVxufVxuXG5JZGJLZXlTdG9yZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKGtleSwgY2IpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIHZhciBkZWZlciA9IHByb21pc2lmeShjYilcblxuICBpZiAoIXNlbGYuX2RiKSB7XG4gICAgc2VsZi5fcXVldWUucHVzaCh7XG4gICAgICB0eXBlOiAnZ2V0JyxcbiAgICAgIGtleToga2V5LFxuICAgICAgY2I6IGRlZmVyLmNiXG4gICAgfSlcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGtleSkpIHtcbiAgICB2YXIgcmVzdWx0ID0gW11cbiAgICB2YXIgZXJyb3JlZE91dCA9IGZhbHNlXG4gICAgdmFyIHN1Y2Nlc3NlcyA9IDBcbiAgICBrZXkuZm9yRWFjaChmdW5jdGlvbiAoXywgaW5kZXgpIHtcbiAgICAgIHNlbGYuZ2V0KGtleVtpbmRleF0sIGZ1bmN0aW9uIChlcnIsIHZhbCkge1xuICAgICAgICBpZiAoZXJyb3JlZE91dCkgcmV0dXJuXG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBlcnJvcmVkT3V0ID0gdHJ1ZVxuICAgICAgICAgIGRlZmVyLmNiKGVycilcbiAgICAgICAgfVxuICAgICAgICByZXN1bHRbaW5kZXhdID0gdmFsXG4gICAgICAgIHN1Y2Nlc3NlcysrXG4gICAgICAgIGlmIChzdWNjZXNzZXMgPT09IGtleS5sZW5ndGgpIGRlZmVyLmNiKG51bGwsIHJlc3VsdClcbiAgICAgIH0pXG4gICAgfSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgdHJhbnNhY3Rpb24gPSBzZWxmLl9kYi50cmFuc2FjdGlvbigna3YnLCAncmVhZG9ubHknKVxuICAgIHZhciByZXF1ZXN0ID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2t2JykuZ2V0KGtleSlcblxuICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICBkZWZlci5jYihudWxsLCBldmVudC50YXJnZXQucmVzdWx0KVxuICAgIH1cblxuICAgIHRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIG9uZXJyb3IoZXZlbnQsIGRlZmVyLmNiKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZlci5wcm9taXNlXG59XG5cbklkYktleVN0b3JlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAoa2V5LCB2YWx1ZSwgY2IpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIHZhciBkZWZlciA9IHByb21pc2lmeShjYilcblxuICBpZiAoIXNlbGYuX2RiKSB7XG4gICAgc2VsZi5fcXVldWUucHVzaCh7XG4gICAgICB0eXBlOiAnc2V0JyxcbiAgICAgIGtleToga2V5LFxuICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgY2I6IGRlZmVyLmNiXG4gICAgfSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgdHJhbnNhY3Rpb24gPSBzZWxmLl9kYi50cmFuc2FjdGlvbigna3YnLCAncmVhZHdyaXRlJylcbiAgICB2YXIgcmVxdWVzdCA9IHRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKCdrdicpLnB1dCh2YWx1ZSwga2V5KVxuXG4gICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgICBkZWZlci5jYihudWxsKVxuICAgIH1cblxuICAgIHRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIG9uZXJyb3IoZXZlbnQsIGRlZmVyLmNiKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZlci5wcm9taXNlXG59XG5cbklkYktleVN0b3JlLnByb3RvdHlwZS5qc29uID0gZnVuY3Rpb24gKGNiKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuICB2YXIgZGVmZXIgPSBwcm9taXNpZnkoY2IpXG5cbiAgaWYgKCFzZWxmLl9kYikge1xuICAgIHNlbGYuX3F1ZXVlLnB1c2goe1xuICAgICAgdHlwZTogJ2pzb24nLFxuICAgICAgY2I6IGRlZmVyLmNiXG4gICAgfSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgdHJhbnNhY3Rpb24gPSBzZWxmLl9kYi50cmFuc2FjdGlvbigna3YnLCAncmVhZG9ubHknKVxuICAgIHZhciByZXF1ZXN0ID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2t2Jykub3BlbkN1cnNvcigpXG5cbiAgICB2YXIganNvbiA9IHt9XG4gICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIHZhciBjdXJzb3IgPSBldmVudC50YXJnZXQucmVzdWx0XG4gICAgICBpZiAoY3Vyc29yKSB7XG4gICAgICAgIGpzb25bY3Vyc29yLmtleV0gPSBjdXJzb3IudmFsdWVcbiAgICAgICAgY3Vyc29yLmNvbnRpbnVlKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlZmVyLmNiKG51bGwsIGpzb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgdHJhbnNhY3Rpb24ub25lcnJvciA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgb25lcnJvcihldmVudCwgZGVmZXIuY2IpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRlZmVyLnByb21pc2Vcbn1cblxuSWRiS2V5U3RvcmUucHJvdG90eXBlLmtleXMgPSBmdW5jdGlvbiAoY2IpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIHZhciBkZWZlciA9IHByb21pc2lmeShjYilcblxuICBpZiAoIXNlbGYuX2RiKSB7XG4gICAgc2VsZi5fcXVldWUucHVzaCh7XG4gICAgICB0eXBlOiAna2V5cycsXG4gICAgICBjYjogZGVmZXIuY2JcbiAgICB9KVxuICB9IGVsc2Uge1xuICAgIHZhciB0cmFuc2FjdGlvbiA9IHNlbGYuX2RiLnRyYW5zYWN0aW9uKCdrdicsICdyZWFkb25seScpXG4gICAgdmFyIHJlcXVlc3QgPSB0cmFuc2FjdGlvbi5vYmplY3RTdG9yZSgna3YnKS5vcGVuQ3Vyc29yKClcblxuICAgIHZhciBrZXlzID0gW11cbiAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgdmFyIGN1cnNvciA9IGV2ZW50LnRhcmdldC5yZXN1bHRcbiAgICAgIGlmIChjdXJzb3IpIHtcbiAgICAgICAga2V5cy5wdXNoKGN1cnNvci5rZXkpXG4gICAgICAgIGN1cnNvci5jb250aW51ZSgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWZlci5jYihudWxsLCBrZXlzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIG9uZXJyb3IoZXZlbnQsIGRlZmVyLmNiKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZlci5wcm9taXNlXG59XG5cbklkYktleVN0b3JlLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiAoa2V5LCBjYikge1xuICB2YXIgc2VsZiA9IHRoaXNcbiAgdmFyIGRlZmVyID0gcHJvbWlzaWZ5KGNiKVxuXG4gIGlmICghc2VsZi5fZGIpIHtcbiAgICBzZWxmLl9xdWV1ZS5wdXNoKHtcbiAgICAgIHR5cGU6ICdyZW1vdmUnLFxuICAgICAga2V5OiBrZXksXG4gICAgICBjYjogZGVmZXIuY2JcbiAgICB9KVxuICB9IGVsc2Uge1xuICAgIHZhciB0cmFuc2FjdGlvbiA9IHNlbGYuX2RiLnRyYW5zYWN0aW9uKCdrdicsICdyZWFkd3JpdGUnKVxuICAgIHZhciByZXF1ZXN0ID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2t2JykuZGVsZXRlKGtleSlcblxuICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICBkZWZlci5jYihudWxsKVxuICAgIH1cblxuICAgIHRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIG9uZXJyb3IoZXZlbnQsIGRlZmVyLmNiKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZlci5wcm9taXNlXG59XG5cbklkYktleVN0b3JlLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uIChjYikge1xuICB2YXIgc2VsZiA9IHRoaXNcbiAgdmFyIGRlZmVyID0gcHJvbWlzaWZ5KGNiKVxuXG4gIGlmICghc2VsZi5fZGIpIHtcbiAgICBzZWxmLl9xdWV1ZS5wdXNoKHtcbiAgICAgIHR5cGU6ICdjbGVhcicsXG4gICAgICBjYjogZGVmZXIuY2JcbiAgICB9KVxuICB9IGVsc2Uge1xuICAgIHZhciB0cmFuc2FjdGlvbiA9IHNlbGYuX2RiLnRyYW5zYWN0aW9uKCdrdicsICdyZWFkd3JpdGUnKVxuICAgIHZhciByZXF1ZXN0ID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2t2JykuY2xlYXIoKVxuXG4gICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIGRlZmVyLmNiKG51bGwpXG4gICAgfVxuXG4gICAgdHJhbnNhY3Rpb24ub25lcnJvciA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgb25lcnJvcihldmVudCwgZGVmZXIuY2IpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRlZmVyLnByb21pc2Vcbn1cblxuSWRiS2V5U3RvcmUucHJvdG90eXBlLmNvdW50ID0gZnVuY3Rpb24gKGNiKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuICB2YXIgZGVmZXIgPSBwcm9taXNpZnkoY2IpXG5cbiAgaWYgKCFzZWxmLl9kYikge1xuICAgIHNlbGYuX3F1ZXVlLnB1c2goe1xuICAgICAgdHlwZTogJ2NvdW50JyxcbiAgICAgIGNiOiBkZWZlci5jYlxuICAgIH0pXG4gIH0gZWxzZSB7XG4gICAgdmFyIHRyYW5zYWN0aW9uID0gc2VsZi5fZGIudHJhbnNhY3Rpb24oJ2t2JywgJ3JlYWRvbmx5JylcbiAgICB2YXIgcmVxdWVzdCA9IHRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKCdrdicpLmNvdW50KClcblxuICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICBkZWZlci5jYihudWxsLCBldmVudC50YXJnZXQucmVzdWx0KVxuICAgIH1cblxuICAgIHRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIG9uZXJyb3IoZXZlbnQsIGRlZmVyLmNiKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZlci5wcm9taXNlXG59XG5cbklkYktleVN0b3JlLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiAoa2V5LCB2YWx1ZSwgY2IpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIHZhciBkZWZlciA9IHByb21pc2lmeShjYilcblxuICBpZiAoIXNlbGYuX2RiKSB7XG4gICAgc2VsZi5fcXVldWUucHVzaCh7XG4gICAgICB0eXBlOiAnYWRkJyxcbiAgICAgIGtleToga2V5LFxuICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgY2I6IGRlZmVyLmNiXG4gICAgfSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgdHJhbnNhY3Rpb24gPSBzZWxmLl9kYi50cmFuc2FjdGlvbigna3YnLCAncmVhZHdyaXRlJylcbiAgICB2YXIgcmVxdWVzdCA9IHRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKCdrdicpLmFkZCh2YWx1ZSwga2V5KVxuXG4gICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIGRlZmVyLmNiKG51bGwpXG4gICAgfVxuXG4gICAgdHJhbnNhY3Rpb24ub25lcnJvciA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgb25lcnJvcihldmVudCwgZGVmZXIuY2IpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRlZmVyLnByb21pc2Vcbn1cblxuSWRiS2V5U3RvcmUucHJvdG90eXBlLl9kcmFpblF1ZXVlID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXNcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzZWxmLl9xdWV1ZS5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gc2VsZi5fcXVldWVbaV1cbiAgICBpZiAoaXRlbS50eXBlID09PSAnZ2V0Jykge1xuICAgICAgc2VsZi5nZXQoaXRlbS5rZXksIGl0ZW0uY2IpXG4gICAgfSBlbHNlIGlmIChpdGVtLnR5cGUgPT09ICdzZXQnKSB7XG4gICAgICBzZWxmLnNldChpdGVtLmtleSwgaXRlbS52YWx1ZSwgaXRlbS5jYilcbiAgICB9IGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gJ2pzb24nKSB7XG4gICAgICBzZWxmLmpzb24oaXRlbS5jYilcbiAgICB9IGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gJ2tleXMnKSB7XG4gICAgICBzZWxmLmtleXMoaXRlbS5jYilcbiAgICB9IGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gJ3JlbW92ZScpIHtcbiAgICAgIHNlbGYucmVtb3ZlKGl0ZW0ua2V5LCBpdGVtLmNiKVxuICAgIH0gZWxzZSBpZiAoaXRlbS50eXBlID09PSAnY2xlYXInKSB7XG4gICAgICBzZWxmLmNsZWFyKGl0ZW0uY2IpXG4gICAgfSBlbHNlIGlmIChpdGVtLnR5cGUgPT09ICdjb3VudCcpIHtcbiAgICAgIHNlbGYuY291bnQoaXRlbS5jYilcbiAgICB9IGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gJ2FkZCcpIHtcbiAgICAgIHNlbGYuYWRkKGl0ZW0ua2V5LCBpdGVtLnZhbHVlLCBpdGVtLmNiKVxuICAgIH1cbiAgfVxuICBzZWxmLl9xdWV1ZSA9IG51bGxcbn1cblxuZnVuY3Rpb24gcHJvbWlzaWZ5IChjYikge1xuICB2YXIgZGVmZXIgPSB7Y2I6IGNifVxuXG4gIGlmICh0eXBlb2YgUHJvbWlzZSA9PT0gJ2Z1bmN0aW9uJyAmJiBjYiA9PSBudWxsKSB7XG4gICAgZGVmZXIucHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGRlZmVyLmNiID0gZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgICAgIGlmIChlcnIpIHJldHVybiByZWplY3QoZXJyKVxuICAgICAgICBlbHNlIHJldHVybiByZXNvbHZlKHJlc3VsdClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgaWYgKCFkZWZlci5jYikgZGVmZXIuY2IgPSBmdW5jdGlvbiBub29wICgpIHt9XG5cbiAgcmV0dXJuIGRlZmVyXG59XG5cbmZ1bmN0aW9uIG9uZXJyb3IgKGV2ZW50LCBjYikge1xuICB2YXIgZXJyID0gbmV3IEVycm9yKCdJREIgZXJyb3InKVxuICBlcnIuZXZlbnQgPSBldmVudFxuXG4gIGlmIChjYikge1xuICAgIGNiKGVycilcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBlcnJcbiAgfVxufVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24gKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG1cbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBuQml0cyA9IC03XG4gIHZhciBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDBcbiAgdmFyIGQgPSBpc0xFID8gLTEgOiAxXG4gIHZhciBzID0gYnVmZmVyW29mZnNldCArIGldXG5cbiAgaSArPSBkXG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgcyA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gZUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIGUgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IG1MZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXNcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpXG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKVxuICAgIGUgPSBlIC0gZUJpYXNcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKVxufVxuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24gKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApXG4gIHZhciBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSlcbiAgdmFyIGQgPSBpc0xFID8gMSA6IC0xXG4gIHZhciBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwXG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSlcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMFxuICAgIGUgPSBlTWF4XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpXG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tXG4gICAgICBjICo9IDJcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGNcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpXG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrXG4gICAgICBjIC89IDJcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwXG4gICAgICBlID0gZU1heFxuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IGUgKyBlQmlhc1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSAwXG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCkge31cblxuICBlID0gKGUgPDwgbUxlbikgfCBtXG4gIGVMZW4gKz0gbUxlblxuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpIHt9XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IElkYkNodW5rU3RvcmVcblxudmFyIElkYkt2U3RvcmUgPSByZXF1aXJlKCdpZGIta3Ytc3RvcmUnKVxuXG5mdW5jdGlvbiBJZGJDaHVua1N0b3JlIChjaHVua0xlbmd0aCwgb3B0cykge1xuICB2YXIgc2VsZiA9IHRoaXNcbiAgaWYgKHR5cGVvZiBjaHVua0xlbmd0aCAhPT0gJ251bWJlcicpIHRocm93IG5ldyBFcnJvcignY2h1bmtMZW5ndGggbXVzdCBiZSBhIG51bWJlcicpXG4gIGlmICghKHNlbGYgaW5zdGFuY2VvZiBJZGJDaHVua1N0b3JlKSkgcmV0dXJuIG5ldyBJZGJDaHVua1N0b3JlKGNodW5rTGVuZ3RoLCBvcHRzKVxuICBpZiAoIW9wdHMpIG9wdHMgPSB7fVxuXG4gIHNlbGYuY2h1bmtMZW5ndGggPSBjaHVua0xlbmd0aFxuICBzZWxmLmxlbmd0aCA9IE51bWJlcihvcHRzLmxlbmd0aCkgfHwgSW5maW5pdHlcblxuICBpZiAoc2VsZi5sZW5ndGggIT09IEluZmluaXR5KSB7XG4gICAgdGhpcy5sYXN0Q2h1bmtMZW5ndGggPSAodGhpcy5sZW5ndGggJSB0aGlzLmNodW5rTGVuZ3RoKSB8fCB0aGlzLmNodW5rTGVuZ3RoXG4gICAgc2VsZi5sYXN0Q2h1bmtJbmRleCA9IE1hdGguY2VpbChzZWxmLmxlbmd0aCAvIHNlbGYuY2h1bmtMZW5ndGgpIC0gMVxuICB9XG5cbiAgdmFyIG5hbWUgPSBvcHRzLm5hbWUgfHwgJycgKyBNYXRoLnJvdW5kKDllMTYgKiBNYXRoLnJhbmRvbSgpKVxuICAvLyBmb3Igd2VidG9ycmVudFxuICBpZiAob3B0cy50b3JyZW50ICYmIG9wdHMudG9ycmVudC5pbmZvSGFzaCkgbmFtZSA9IG9wdHMudG9ycmVudC5pbmZvSGFzaFxuICBzZWxmLl9zdG9yZSA9IG5ldyBJZGJLdlN0b3JlKG5hbWUpXG59XG5cbklkYkNodW5rU3RvcmUucHJvdG90eXBlLnB1dCA9IGZ1bmN0aW9uIChpbmRleCwgYnVmZmVyLCBjYikge1xuICB2YXIgc2VsZiA9IHRoaXNcbiAgaWYgKCFjYikgY2IgPSBub29wXG4gIGlmICghc2VsZi5fc3RvcmUpIHRocm93IG5ldyBFcnJvcignU3RvcmUgaXMgY2xvc2VkJylcbiAgaWYgKHR5cGVvZiBpbmRleCAhPT0gJ251bWJlcicpIHRocm93IG5ldyBFcnJvcignaW5kZXggbXVzdCBiZSBhIG51bWJlcicpXG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZmZlcikpIGJ1ZmZlciA9IG5ldyBCdWZmZXIoYnVmZmVyKVxuXG4gIHZhciBpc0xhc3RDaHVuayA9IChpbmRleCA9PT0gc2VsZi5sYXN0Q2h1bmtJbmRleClcbiAgdmFyIGJhZExlbmd0aCA9IChpc0xhc3RDaHVuayAmJiBidWZmZXIubGVuZ3RoICE9PSBzZWxmLmxhc3RDaHVua0xlbmd0aCkgfHxcbiAgICAgICAgICAgICAgICAgICghaXNMYXN0Q2h1bmsgJiYgYnVmZmVyLmxlbmd0aCAhPT0gc2VsZi5jaHVua0xlbmd0aClcbiAgaWYgKGJhZExlbmd0aCkgcmV0dXJuIHByb2Nlc3MubmV4dFRpY2soY2IsIG5ldyBFcnJvcignSW52YWxpZCBidWZmZXIgbGVuZ3RoJykpXG5cbiAgc2VsZi5fc3RvcmUuc2V0KGluZGV4LCBidWZmZXIsIGNiKVxufVxuXG5JZGJDaHVua1N0b3JlLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAoaW5kZXgsIG9wdHMsIGNiKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHJldHVybiBzZWxmLmdldChpbmRleCwgbnVsbCwgb3B0cylcbiAgaWYgKHR5cGVvZiBjYiAhPT0gJ2Z1bmN0aW9uJykgdGhyb3cgbmV3IEVycm9yKCdjYiBtdXN0IGJlIGEgZnVuY3Rpb24nKVxuICBpZiAoIXNlbGYuX3N0b3JlKSB0aHJvdyBuZXcgRXJyb3IoJ1N0b3JlIGlzIGNsb3NlZCcpXG4gIGlmICh0eXBlb2YgaW5kZXggIT09ICdudW1iZXInKSB0aHJvdyBuZXcgRXJyb3IoJ2luZGV4IG11c3QgYmUgYSBudW1iZXInKVxuICBpZiAoIW9wdHMpIG9wdHMgPSB7fVxuXG4gIHNlbGYuX3N0b3JlLmdldChpbmRleCwgZnVuY3Rpb24gKGVyciwgYnVmZmVyKSB7XG4gICAgaWYgKGVycikgcmV0dXJuIGNiKGVycilcbiAgICBpZiAodHlwZW9mIGJ1ZmZlciA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybiBjYihuZXcgRXJyb3IoJ0NodW5rIGRvZXMgbm90IGV4aXN0JykpXG4gICAgdmFyIG9mZnNldCA9ICdvZmZzZXQnIGluIG9wdHMgPyBvcHRzLm9mZnNldCA6IDBcbiAgICB2YXIgbGVuZ3RoID0gJ2xlbmd0aCcgaW4gb3B0cyA/IG9wdHMubGVuZ3RoIDogYnVmZmVyLmxlbmd0aCAtIG9mZnNldFxuICAgIGNiKG51bGwsIChuZXcgQnVmZmVyKGJ1ZmZlcikpLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgbGVuZ3RoKSlcbiAgfSlcbn1cblxuSWRiQ2h1bmtTdG9yZS5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiAoY2IpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIGlmICghY2IpIGNiID0gbm9vcFxuICBpZiAoIXNlbGYuX3N0b3JlKSB0aHJvdyBuZXcgRXJyb3IoJ1N0b3JlIGlzIGNsb3NlZCcpXG5cbiAgc2VsZi5fc3RvcmUgPSBudWxsXG4gIHByb2Nlc3MubmV4dFRpY2soY2IsIG51bGwpXG59XG5cbklkYkNodW5rU3RvcmUucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoY2IpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIGlmICghY2IpIGNiID0gbm9vcFxuICBpZiAoIXNlbGYuX3N0b3JlKSB0aHJvdyBuZXcgRXJyb3IoJ1N0b3JlIGlzIGNsb3NlZCcpXG5cbiAgdmFyIHMgPSBzZWxmLl9zdG9yZVxuICBzZWxmLl9zdG9yZSA9IG51bGxcbiAgcy5jbGVhcihjYilcbn1cblxuZnVuY3Rpb24gbm9vcCAoKSB7XG4gIC8vIGRvIG5vdGhpbmdcbn1cbiIsImlmICh0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAvLyBpbXBsZW1lbnRhdGlvbiBmcm9tIHN0YW5kYXJkIG5vZGUuanMgJ3V0aWwnIG1vZHVsZVxuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICAgIGNvbnN0cnVjdG9yOiB7XG4gICAgICAgIHZhbHVlOiBjdG9yLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuICB9O1xufSBlbHNlIHtcbiAgLy8gb2xkIHNjaG9vbCBzaGltIGZvciBvbGQgYnJvd3NlcnNcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgIHZhciBUZW1wQ3RvciA9IGZ1bmN0aW9uICgpIHt9XG4gICAgVGVtcEN0b3IucHJvdG90eXBlID0gc3VwZXJDdG9yLnByb3RvdHlwZVxuICAgIGN0b3IucHJvdG90eXBlID0gbmV3IFRlbXBDdG9yKClcbiAgICBjdG9yLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGN0b3JcbiAgfVxufVxuIiwiLyohXG4gKiBEZXRlcm1pbmUgaWYgYW4gb2JqZWN0IGlzIGEgQnVmZmVyXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxuLy8gVGhlIF9pc0J1ZmZlciBjaGVjayBpcyBmb3IgU2FmYXJpIDUtNyBzdXBwb3J0LCBiZWNhdXNlIGl0J3MgbWlzc2luZ1xuLy8gT2JqZWN0LnByb3RvdHlwZS5jb25zdHJ1Y3Rvci4gUmVtb3ZlIHRoaXMgZXZlbnR1YWxseVxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiBvYmogIT0gbnVsbCAmJiAoaXNCdWZmZXIob2JqKSB8fCBpc1Nsb3dCdWZmZXIob2JqKSB8fCAhIW9iai5faXNCdWZmZXIpXG59XG5cbmZ1bmN0aW9uIGlzQnVmZmVyIChvYmopIHtcbiAgcmV0dXJuICEhb2JqLmNvbnN0cnVjdG9yICYmIHR5cGVvZiBvYmouY29uc3RydWN0b3IuaXNCdWZmZXIgPT09ICdmdW5jdGlvbicgJiYgb2JqLmNvbnN0cnVjdG9yLmlzQnVmZmVyKG9iailcbn1cblxuLy8gRm9yIE5vZGUgdjAuMTAgc3VwcG9ydC4gUmVtb3ZlIHRoaXMgZXZlbnR1YWxseS5cbmZ1bmN0aW9uIGlzU2xvd0J1ZmZlciAob2JqKSB7XG4gIHJldHVybiB0eXBlb2Ygb2JqLnJlYWRGbG9hdExFID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiBvYmouc2xpY2UgPT09ICdmdW5jdGlvbicgJiYgaXNCdWZmZXIob2JqLnNsaWNlKDAsIDApKVxufVxuIiwidmFyIHRvU3RyaW5nID0ge30udG9TdHJpbmc7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbiAoYXJyKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKGFycikgPT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG4iLCIvKipcbiAqIEhlbHBlcnMuXG4gKi9cblxudmFyIHMgPSAxMDAwXG52YXIgbSA9IHMgKiA2MFxudmFyIGggPSBtICogNjBcbnZhciBkID0gaCAqIDI0XG52YXIgeSA9IGQgKiAzNjUuMjVcblxuLyoqXG4gKiBQYXJzZSBvciBmb3JtYXQgdGhlIGdpdmVuIGB2YWxgLlxuICpcbiAqIE9wdGlvbnM6XG4gKlxuICogIC0gYGxvbmdgIHZlcmJvc2UgZm9ybWF0dGluZyBbZmFsc2VdXG4gKlxuICogQHBhcmFtIHtTdHJpbmd8TnVtYmVyfSB2YWxcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gKiBAdGhyb3dzIHtFcnJvcn0gdGhyb3cgYW4gZXJyb3IgaWYgdmFsIGlzIG5vdCBhIG5vbi1lbXB0eSBzdHJpbmcgb3IgYSBudW1iZXJcbiAqIEByZXR1cm4ge1N0cmluZ3xOdW1iZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHZhbCwgb3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fVxuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWxcbiAgaWYgKHR5cGUgPT09ICdzdHJpbmcnICYmIHZhbC5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHBhcnNlKHZhbClcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiBpc05hTih2YWwpID09PSBmYWxzZSkge1xuICAgIHJldHVybiBvcHRpb25zLmxvbmcgP1xuXHRcdFx0Zm10TG9uZyh2YWwpIDpcblx0XHRcdGZtdFNob3J0KHZhbClcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoJ3ZhbCBpcyBub3QgYSBub24tZW1wdHkgc3RyaW5nIG9yIGEgdmFsaWQgbnVtYmVyLiB2YWw9JyArIEpTT04uc3RyaW5naWZ5KHZhbCkpXG59XG5cbi8qKlxuICogUGFyc2UgdGhlIGdpdmVuIGBzdHJgIGFuZCByZXR1cm4gbWlsbGlzZWNvbmRzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHBhcnNlKHN0cikge1xuICBzdHIgPSBTdHJpbmcoc3RyKVxuICBpZiAoc3RyLmxlbmd0aCA+IDEwMDAwKSB7XG4gICAgcmV0dXJuXG4gIH1cbiAgdmFyIG1hdGNoID0gL14oKD86XFxkKyk/XFwuP1xcZCspICoobWlsbGlzZWNvbmRzP3xtc2Vjcz98bXN8c2Vjb25kcz98c2Vjcz98c3xtaW51dGVzP3xtaW5zP3xtfGhvdXJzP3xocnM/fGh8ZGF5cz98ZHx5ZWFycz98eXJzP3x5KT8kL2kuZXhlYyhzdHIpXG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm5cbiAgfVxuICB2YXIgbiA9IHBhcnNlRmxvYXQobWF0Y2hbMV0pXG4gIHZhciB0eXBlID0gKG1hdGNoWzJdIHx8ICdtcycpLnRvTG93ZXJDYXNlKClcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAneWVhcnMnOlxuICAgIGNhc2UgJ3llYXInOlxuICAgIGNhc2UgJ3lycyc6XG4gICAgY2FzZSAneXInOlxuICAgIGNhc2UgJ3knOlxuICAgICAgcmV0dXJuIG4gKiB5XG4gICAgY2FzZSAnZGF5cyc6XG4gICAgY2FzZSAnZGF5JzpcbiAgICBjYXNlICdkJzpcbiAgICAgIHJldHVybiBuICogZFxuICAgIGNhc2UgJ2hvdXJzJzpcbiAgICBjYXNlICdob3VyJzpcbiAgICBjYXNlICdocnMnOlxuICAgIGNhc2UgJ2hyJzpcbiAgICBjYXNlICdoJzpcbiAgICAgIHJldHVybiBuICogaFxuICAgIGNhc2UgJ21pbnV0ZXMnOlxuICAgIGNhc2UgJ21pbnV0ZSc6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWluJzpcbiAgICBjYXNlICdtJzpcbiAgICAgIHJldHVybiBuICogbVxuICAgIGNhc2UgJ3NlY29uZHMnOlxuICAgIGNhc2UgJ3NlY29uZCc6XG4gICAgY2FzZSAnc2Vjcyc6XG4gICAgY2FzZSAnc2VjJzpcbiAgICBjYXNlICdzJzpcbiAgICAgIHJldHVybiBuICogc1xuICAgIGNhc2UgJ21pbGxpc2Vjb25kcyc6XG4gICAgY2FzZSAnbWlsbGlzZWNvbmQnOlxuICAgIGNhc2UgJ21zZWNzJzpcbiAgICBjYXNlICdtc2VjJzpcbiAgICBjYXNlICdtcyc6XG4gICAgICByZXR1cm4gblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cblxuLyoqXG4gKiBTaG9ydCBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBmbXRTaG9ydChtcykge1xuICBpZiAobXMgPj0gZCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gZCkgKyAnZCdcbiAgfVxuICBpZiAobXMgPj0gaCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gaCkgKyAnaCdcbiAgfVxuICBpZiAobXMgPj0gbSkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gbSkgKyAnbSdcbiAgfVxuICBpZiAobXMgPj0gcykge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gcykgKyAncydcbiAgfVxuICByZXR1cm4gbXMgKyAnbXMnXG59XG5cbi8qKlxuICogTG9uZyBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBmbXRMb25nKG1zKSB7XG4gIHJldHVybiBwbHVyYWwobXMsIGQsICdkYXknKSB8fFxuICAgIHBsdXJhbChtcywgaCwgJ2hvdXInKSB8fFxuICAgIHBsdXJhbChtcywgbSwgJ21pbnV0ZScpIHx8XG4gICAgcGx1cmFsKG1zLCBzLCAnc2Vjb25kJykgfHxcbiAgICBtcyArICcgbXMnXG59XG5cbi8qKlxuICogUGx1cmFsaXphdGlvbiBoZWxwZXIuXG4gKi9cblxuZnVuY3Rpb24gcGx1cmFsKG1zLCBuLCBuYW1lKSB7XG4gIGlmIChtcyA8IG4pIHtcbiAgICByZXR1cm5cbiAgfVxuICBpZiAobXMgPCBuICogMS41KSB7XG4gICAgcmV0dXJuIE1hdGguZmxvb3IobXMgLyBuKSArICcgJyArIG5hbWVcbiAgfVxuICByZXR1cm4gTWF0aC5jZWlsKG1zIC8gbikgKyAnICcgKyBuYW1lICsgJ3MnXG59XG4iLCJ2YXIgd3JhcHB5ID0gcmVxdWlyZSgnd3JhcHB5Jylcbm1vZHVsZS5leHBvcnRzID0gd3JhcHB5KG9uY2UpXG5tb2R1bGUuZXhwb3J0cy5zdHJpY3QgPSB3cmFwcHkob25jZVN0cmljdClcblxub25jZS5wcm90byA9IG9uY2UoZnVuY3Rpb24gKCkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRnVuY3Rpb24ucHJvdG90eXBlLCAnb25jZScsIHtcbiAgICB2YWx1ZTogZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIG9uY2UodGhpcylcbiAgICB9LFxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICB9KVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShGdW5jdGlvbi5wcm90b3R5cGUsICdvbmNlU3RyaWN0Jywge1xuICAgIHZhbHVlOiBmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gb25jZVN0cmljdCh0aGlzKVxuICAgIH0sXG4gICAgY29uZmlndXJhYmxlOiB0cnVlXG4gIH0pXG59KVxuXG5mdW5jdGlvbiBvbmNlIChmbikge1xuICB2YXIgZiA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoZi5jYWxsZWQpIHJldHVybiBmLnZhbHVlXG4gICAgZi5jYWxsZWQgPSB0cnVlXG4gICAgcmV0dXJuIGYudmFsdWUgPSBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gIH1cbiAgZi5jYWxsZWQgPSBmYWxzZVxuICByZXR1cm4gZlxufVxuXG5mdW5jdGlvbiBvbmNlU3RyaWN0IChmbikge1xuICB2YXIgZiA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoZi5jYWxsZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZi5vbmNlRXJyb3IpXG4gICAgZi5jYWxsZWQgPSB0cnVlXG4gICAgcmV0dXJuIGYudmFsdWUgPSBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gIH1cbiAgdmFyIG5hbWUgPSBmbi5uYW1lIHx8ICdGdW5jdGlvbiB3cmFwcGVkIHdpdGggYG9uY2VgJ1xuICBmLm9uY2VFcnJvciA9IG5hbWUgKyBcIiBzaG91bGRuJ3QgYmUgY2FsbGVkIG1vcmUgdGhhbiBvbmNlXCJcbiAgZi5jYWxsZWQgPSBmYWxzZVxuICByZXR1cm4gZlxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBkZWNvZGVUb3JyZW50RmlsZVxubW9kdWxlLmV4cG9ydHMuZGVjb2RlID0gZGVjb2RlVG9ycmVudEZpbGVcbm1vZHVsZS5leHBvcnRzLmVuY29kZSA9IGVuY29kZVRvcnJlbnRGaWxlXG5cbnZhciBiZW5jb2RlID0gcmVxdWlyZSgnYmVuY29kZScpXG52YXIgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKVxudmFyIHNoYTEgPSByZXF1aXJlKCdzaW1wbGUtc2hhMScpXG52YXIgdW5pcSA9IHJlcXVpcmUoJ3VuaXEnKVxuXG4vKipcbiAqIFBhcnNlIGEgdG9ycmVudC4gVGhyb3dzIGFuIGV4Y2VwdGlvbiBpZiB0aGUgdG9ycmVudCBpcyBtaXNzaW5nIHJlcXVpcmVkIGZpZWxkcy5cbiAqIEBwYXJhbSAge0J1ZmZlcnxPYmplY3R9IHRvcnJlbnRcbiAqIEByZXR1cm4ge09iamVjdH0gICAgICAgIHBhcnNlZCB0b3JyZW50XG4gKi9cbmZ1bmN0aW9uIGRlY29kZVRvcnJlbnRGaWxlICh0b3JyZW50KSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIodG9ycmVudCkpIHtcbiAgICB0b3JyZW50ID0gYmVuY29kZS5kZWNvZGUodG9ycmVudClcbiAgfVxuXG4gIC8vIHNhbml0eSBjaGVja1xuICBlbnN1cmUodG9ycmVudC5pbmZvLCAnaW5mbycpXG4gIGVuc3VyZSh0b3JyZW50LmluZm9bJ25hbWUudXRmLTgnXSB8fCB0b3JyZW50LmluZm8ubmFtZSwgJ2luZm8ubmFtZScpXG4gIGVuc3VyZSh0b3JyZW50LmluZm9bJ3BpZWNlIGxlbmd0aCddLCAnaW5mb1tcXCdwaWVjZSBsZW5ndGhcXCddJylcbiAgZW5zdXJlKHRvcnJlbnQuaW5mby5waWVjZXMsICdpbmZvLnBpZWNlcycpXG5cbiAgaWYgKHRvcnJlbnQuaW5mby5maWxlcykge1xuICAgIHRvcnJlbnQuaW5mby5maWxlcy5mb3JFYWNoKGZ1bmN0aW9uIChmaWxlKSB7XG4gICAgICBlbnN1cmUodHlwZW9mIGZpbGUubGVuZ3RoID09PSAnbnVtYmVyJywgJ2luZm8uZmlsZXNbMF0ubGVuZ3RoJylcbiAgICAgIGVuc3VyZShmaWxlWydwYXRoLnV0Zi04J10gfHwgZmlsZS5wYXRoLCAnaW5mby5maWxlc1swXS5wYXRoJylcbiAgICB9KVxuICB9IGVsc2Uge1xuICAgIGVuc3VyZSh0eXBlb2YgdG9ycmVudC5pbmZvLmxlbmd0aCA9PT0gJ251bWJlcicsICdpbmZvLmxlbmd0aCcpXG4gIH1cblxuICB2YXIgcmVzdWx0ID0ge31cbiAgcmVzdWx0LmluZm8gPSB0b3JyZW50LmluZm9cbiAgcmVzdWx0LmluZm9CdWZmZXIgPSBiZW5jb2RlLmVuY29kZSh0b3JyZW50LmluZm8pXG4gIHJlc3VsdC5pbmZvSGFzaCA9IHNoYTEuc3luYyhyZXN1bHQuaW5mb0J1ZmZlcilcbiAgcmVzdWx0LmluZm9IYXNoQnVmZmVyID0gbmV3IEJ1ZmZlcihyZXN1bHQuaW5mb0hhc2gsICdoZXgnKVxuXG4gIHJlc3VsdC5uYW1lID0gKHRvcnJlbnQuaW5mb1snbmFtZS51dGYtOCddIHx8IHRvcnJlbnQuaW5mby5uYW1lKS50b1N0cmluZygpXG5cbiAgaWYgKHRvcnJlbnQuaW5mby5wcml2YXRlICE9PSB1bmRlZmluZWQpIHJlc3VsdC5wcml2YXRlID0gISF0b3JyZW50LmluZm8ucHJpdmF0ZVxuXG4gIGlmICh0b3JyZW50WydjcmVhdGlvbiBkYXRlJ10pIHJlc3VsdC5jcmVhdGVkID0gbmV3IERhdGUodG9ycmVudFsnY3JlYXRpb24gZGF0ZSddICogMTAwMClcbiAgaWYgKHRvcnJlbnRbJ2NyZWF0ZWQgYnknXSkgcmVzdWx0LmNyZWF0ZWRCeSA9IHRvcnJlbnRbJ2NyZWF0ZWQgYnknXS50b1N0cmluZygpXG5cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih0b3JyZW50LmNvbW1lbnQpKSByZXN1bHQuY29tbWVudCA9IHRvcnJlbnQuY29tbWVudC50b1N0cmluZygpXG5cbiAgLy8gYW5ub3VuY2UgYW5kIGFubm91bmNlLWxpc3Qgd2lsbCBiZSBtaXNzaW5nIGlmIG1ldGFkYXRhIGZldGNoZWQgdmlhIHV0X21ldGFkYXRhXG4gIHJlc3VsdC5hbm5vdW5jZSA9IFtdXG4gIGlmICh0b3JyZW50Wydhbm5vdW5jZS1saXN0J10gJiYgdG9ycmVudFsnYW5ub3VuY2UtbGlzdCddLmxlbmd0aCkge1xuICAgIHRvcnJlbnRbJ2Fubm91bmNlLWxpc3QnXS5mb3JFYWNoKGZ1bmN0aW9uICh1cmxzKSB7XG4gICAgICB1cmxzLmZvckVhY2goZnVuY3Rpb24gKHVybCkge1xuICAgICAgICByZXN1bHQuYW5ub3VuY2UucHVzaCh1cmwudG9TdHJpbmcoKSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfSBlbHNlIGlmICh0b3JyZW50LmFubm91bmNlKSB7XG4gICAgcmVzdWx0LmFubm91bmNlLnB1c2godG9ycmVudC5hbm5vdW5jZS50b1N0cmluZygpKVxuICB9XG5cbiAgLy8gaGFuZGxlIHVybC1saXN0IChCRVAxOSAvIHdlYiBzZWVkaW5nKVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHRvcnJlbnRbJ3VybC1saXN0J10pKSB7XG4gICAgLy8gc29tZSBjbGllbnRzIHNldCB1cmwtbGlzdCB0byBlbXB0eSBzdHJpbmdcbiAgICB0b3JyZW50Wyd1cmwtbGlzdCddID0gdG9ycmVudFsndXJsLWxpc3QnXS5sZW5ndGggPiAwXG4gICAgICA/IFsgdG9ycmVudFsndXJsLWxpc3QnXSBdXG4gICAgICA6IFtdXG4gIH1cbiAgcmVzdWx0LnVybExpc3QgPSAodG9ycmVudFsndXJsLWxpc3QnXSB8fCBbXSkubWFwKGZ1bmN0aW9uICh1cmwpIHtcbiAgICByZXR1cm4gdXJsLnRvU3RyaW5nKClcbiAgfSlcblxuICB1bmlxKHJlc3VsdC5hbm5vdW5jZSlcbiAgdW5pcShyZXN1bHQudXJsTGlzdClcblxuICB2YXIgZmlsZXMgPSB0b3JyZW50LmluZm8uZmlsZXMgfHwgWyB0b3JyZW50LmluZm8gXVxuICByZXN1bHQuZmlsZXMgPSBmaWxlcy5tYXAoZnVuY3Rpb24gKGZpbGUsIGkpIHtcbiAgICB2YXIgcGFydHMgPSBbXS5jb25jYXQocmVzdWx0Lm5hbWUsIGZpbGVbJ3BhdGgudXRmLTgnXSB8fCBmaWxlLnBhdGggfHwgW10pLm1hcChmdW5jdGlvbiAocCkge1xuICAgICAgcmV0dXJuIHAudG9TdHJpbmcoKVxuICAgIH0pXG4gICAgcmV0dXJuIHtcbiAgICAgIHBhdGg6IHBhdGguam9pbi5hcHBseShudWxsLCBbcGF0aC5zZXBdLmNvbmNhdChwYXJ0cykpLnNsaWNlKDEpLFxuICAgICAgbmFtZTogcGFydHNbcGFydHMubGVuZ3RoIC0gMV0sXG4gICAgICBsZW5ndGg6IGZpbGUubGVuZ3RoLFxuICAgICAgb2Zmc2V0OiBmaWxlcy5zbGljZSgwLCBpKS5yZWR1Y2Uoc3VtTGVuZ3RoLCAwKVxuICAgIH1cbiAgfSlcblxuICByZXN1bHQubGVuZ3RoID0gZmlsZXMucmVkdWNlKHN1bUxlbmd0aCwgMClcblxuICB2YXIgbGFzdEZpbGUgPSByZXN1bHQuZmlsZXNbcmVzdWx0LmZpbGVzLmxlbmd0aCAtIDFdXG5cbiAgcmVzdWx0LnBpZWNlTGVuZ3RoID0gdG9ycmVudC5pbmZvWydwaWVjZSBsZW5ndGgnXVxuICByZXN1bHQubGFzdFBpZWNlTGVuZ3RoID0gKChsYXN0RmlsZS5vZmZzZXQgKyBsYXN0RmlsZS5sZW5ndGgpICUgcmVzdWx0LnBpZWNlTGVuZ3RoKSB8fCByZXN1bHQucGllY2VMZW5ndGhcbiAgcmVzdWx0LnBpZWNlcyA9IHNwbGl0UGllY2VzKHRvcnJlbnQuaW5mby5waWVjZXMpXG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vKipcbiAqIENvbnZlcnQgYSBwYXJzZWQgdG9ycmVudCBvYmplY3QgYmFjayBpbnRvIGEgLnRvcnJlbnQgZmlsZSBidWZmZXIuXG4gKiBAcGFyYW0gIHtPYmplY3R9IHBhcnNlZCBwYXJzZWQgdG9ycmVudFxuICogQHJldHVybiB7QnVmZmVyfVxuICovXG5mdW5jdGlvbiBlbmNvZGVUb3JyZW50RmlsZSAocGFyc2VkKSB7XG4gIHZhciB0b3JyZW50ID0ge1xuICAgIGluZm86IHBhcnNlZC5pbmZvXG4gIH1cblxuICB0b3JyZW50Wydhbm5vdW5jZS1saXN0J10gPSAocGFyc2VkLmFubm91bmNlIHx8IFtdKS5tYXAoZnVuY3Rpb24gKHVybCkge1xuICAgIGlmICghdG9ycmVudC5hbm5vdW5jZSkgdG9ycmVudC5hbm5vdW5jZSA9IHVybFxuICAgIHVybCA9IG5ldyBCdWZmZXIodXJsLCAndXRmOCcpXG4gICAgcmV0dXJuIFsgdXJsIF1cbiAgfSlcblxuICB0b3JyZW50Wyd1cmwtbGlzdCddID0gcGFyc2VkLnVybExpc3QgfHwgW11cblxuICBpZiAocGFyc2VkLmNyZWF0ZWQpIHtcbiAgICB0b3JyZW50WydjcmVhdGlvbiBkYXRlJ10gPSAocGFyc2VkLmNyZWF0ZWQuZ2V0VGltZSgpIC8gMTAwMCkgfCAwXG4gIH1cblxuICBpZiAocGFyc2VkLmNyZWF0ZWRCeSkge1xuICAgIHRvcnJlbnRbJ2NyZWF0ZWQgYnknXSA9IHBhcnNlZC5jcmVhdGVkQnlcbiAgfVxuXG4gIGlmIChwYXJzZWQuY29tbWVudCkge1xuICAgIHRvcnJlbnQuY29tbWVudCA9IHBhcnNlZC5jb21tZW50XG4gIH1cblxuICByZXR1cm4gYmVuY29kZS5lbmNvZGUodG9ycmVudClcbn1cblxuZnVuY3Rpb24gc3VtTGVuZ3RoIChzdW0sIGZpbGUpIHtcbiAgcmV0dXJuIHN1bSArIGZpbGUubGVuZ3RoXG59XG5cbmZ1bmN0aW9uIHNwbGl0UGllY2VzIChidWYpIHtcbiAgdmFyIHBpZWNlcyA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnVmLmxlbmd0aDsgaSArPSAyMCkge1xuICAgIHBpZWNlcy5wdXNoKGJ1Zi5zbGljZShpLCBpICsgMjApLnRvU3RyaW5nKCdoZXgnKSlcbiAgfVxuICByZXR1cm4gcGllY2VzXG59XG5cbmZ1bmN0aW9uIGVuc3VyZSAoYm9vbCwgZmllbGROYW1lKSB7XG4gIGlmICghYm9vbCkgdGhyb3cgbmV3IEVycm9yKCdUb3JyZW50IGlzIG1pc3NpbmcgcmVxdWlyZWQgZmllbGQ6ICcgKyBmaWVsZE5hbWUpXG59XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuLy8gcmVzb2x2ZXMgLiBhbmQgLi4gZWxlbWVudHMgaW4gYSBwYXRoIGFycmF5IHdpdGggZGlyZWN0b3J5IG5hbWVzIHRoZXJlXG4vLyBtdXN0IGJlIG5vIHNsYXNoZXMsIGVtcHR5IGVsZW1lbnRzLCBvciBkZXZpY2UgbmFtZXMgKGM6XFwpIGluIHRoZSBhcnJheVxuLy8gKHNvIGFsc28gbm8gbGVhZGluZyBhbmQgdHJhaWxpbmcgc2xhc2hlcyAtIGl0IGRvZXMgbm90IGRpc3Rpbmd1aXNoXG4vLyByZWxhdGl2ZSBhbmQgYWJzb2x1dGUgcGF0aHMpXG5mdW5jdGlvbiBub3JtYWxpemVBcnJheShwYXJ0cywgYWxsb3dBYm92ZVJvb3QpIHtcbiAgLy8gaWYgdGhlIHBhdGggdHJpZXMgdG8gZ28gYWJvdmUgdGhlIHJvb3QsIGB1cGAgZW5kcyB1cCA+IDBcbiAgdmFyIHVwID0gMDtcbiAgZm9yICh2YXIgaSA9IHBhcnRzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgdmFyIGxhc3QgPSBwYXJ0c1tpXTtcbiAgICBpZiAobGFzdCA9PT0gJy4nKSB7XG4gICAgICBwYXJ0cy5zcGxpY2UoaSwgMSk7XG4gICAgfSBlbHNlIGlmIChsYXN0ID09PSAnLi4nKSB7XG4gICAgICBwYXJ0cy5zcGxpY2UoaSwgMSk7XG4gICAgICB1cCsrO1xuICAgIH0gZWxzZSBpZiAodXApIHtcbiAgICAgIHBhcnRzLnNwbGljZShpLCAxKTtcbiAgICAgIHVwLS07XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgdGhlIHBhdGggaXMgYWxsb3dlZCB0byBnbyBhYm92ZSB0aGUgcm9vdCwgcmVzdG9yZSBsZWFkaW5nIC4uc1xuICBpZiAoYWxsb3dBYm92ZVJvb3QpIHtcbiAgICBmb3IgKDsgdXAtLTsgdXApIHtcbiAgICAgIHBhcnRzLnVuc2hpZnQoJy4uJyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHBhcnRzO1xufVxuXG4vLyBTcGxpdCBhIGZpbGVuYW1lIGludG8gW3Jvb3QsIGRpciwgYmFzZW5hbWUsIGV4dF0sIHVuaXggdmVyc2lvblxuLy8gJ3Jvb3QnIGlzIGp1c3QgYSBzbGFzaCwgb3Igbm90aGluZy5cbnZhciBzcGxpdFBhdGhSZSA9XG4gICAgL14oXFwvP3wpKFtcXHNcXFNdKj8pKCg/OlxcLnsxLDJ9fFteXFwvXSs/fCkoXFwuW14uXFwvXSp8KSkoPzpbXFwvXSopJC87XG52YXIgc3BsaXRQYXRoID0gZnVuY3Rpb24oZmlsZW5hbWUpIHtcbiAgcmV0dXJuIHNwbGl0UGF0aFJlLmV4ZWMoZmlsZW5hbWUpLnNsaWNlKDEpO1xufTtcblxuLy8gcGF0aC5yZXNvbHZlKFtmcm9tIC4uLl0sIHRvKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5yZXNvbHZlID0gZnVuY3Rpb24oKSB7XG4gIHZhciByZXNvbHZlZFBhdGggPSAnJyxcbiAgICAgIHJlc29sdmVkQWJzb2x1dGUgPSBmYWxzZTtcblxuICBmb3IgKHZhciBpID0gYXJndW1lbnRzLmxlbmd0aCAtIDE7IGkgPj0gLTEgJiYgIXJlc29sdmVkQWJzb2x1dGU7IGktLSkge1xuICAgIHZhciBwYXRoID0gKGkgPj0gMCkgPyBhcmd1bWVudHNbaV0gOiBwcm9jZXNzLmN3ZCgpO1xuXG4gICAgLy8gU2tpcCBlbXB0eSBhbmQgaW52YWxpZCBlbnRyaWVzXG4gICAgaWYgKHR5cGVvZiBwYXRoICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIHRvIHBhdGgucmVzb2x2ZSBtdXN0IGJlIHN0cmluZ3MnKTtcbiAgICB9IGVsc2UgaWYgKCFwYXRoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICByZXNvbHZlZFBhdGggPSBwYXRoICsgJy8nICsgcmVzb2x2ZWRQYXRoO1xuICAgIHJlc29sdmVkQWJzb2x1dGUgPSBwYXRoLmNoYXJBdCgwKSA9PT0gJy8nO1xuICB9XG5cbiAgLy8gQXQgdGhpcyBwb2ludCB0aGUgcGF0aCBzaG91bGQgYmUgcmVzb2x2ZWQgdG8gYSBmdWxsIGFic29sdXRlIHBhdGgsIGJ1dFxuICAvLyBoYW5kbGUgcmVsYXRpdmUgcGF0aHMgdG8gYmUgc2FmZSAobWlnaHQgaGFwcGVuIHdoZW4gcHJvY2Vzcy5jd2QoKSBmYWlscylcblxuICAvLyBOb3JtYWxpemUgdGhlIHBhdGhcbiAgcmVzb2x2ZWRQYXRoID0gbm9ybWFsaXplQXJyYXkoZmlsdGVyKHJlc29sdmVkUGF0aC5zcGxpdCgnLycpLCBmdW5jdGlvbihwKSB7XG4gICAgcmV0dXJuICEhcDtcbiAgfSksICFyZXNvbHZlZEFic29sdXRlKS5qb2luKCcvJyk7XG5cbiAgcmV0dXJuICgocmVzb2x2ZWRBYnNvbHV0ZSA/ICcvJyA6ICcnKSArIHJlc29sdmVkUGF0aCkgfHwgJy4nO1xufTtcblxuLy8gcGF0aC5ub3JtYWxpemUocGF0aClcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMubm9ybWFsaXplID0gZnVuY3Rpb24ocGF0aCkge1xuICB2YXIgaXNBYnNvbHV0ZSA9IGV4cG9ydHMuaXNBYnNvbHV0ZShwYXRoKSxcbiAgICAgIHRyYWlsaW5nU2xhc2ggPSBzdWJzdHIocGF0aCwgLTEpID09PSAnLyc7XG5cbiAgLy8gTm9ybWFsaXplIHRoZSBwYXRoXG4gIHBhdGggPSBub3JtYWxpemVBcnJheShmaWx0ZXIocGF0aC5zcGxpdCgnLycpLCBmdW5jdGlvbihwKSB7XG4gICAgcmV0dXJuICEhcDtcbiAgfSksICFpc0Fic29sdXRlKS5qb2luKCcvJyk7XG5cbiAgaWYgKCFwYXRoICYmICFpc0Fic29sdXRlKSB7XG4gICAgcGF0aCA9ICcuJztcbiAgfVxuICBpZiAocGF0aCAmJiB0cmFpbGluZ1NsYXNoKSB7XG4gICAgcGF0aCArPSAnLyc7XG4gIH1cblxuICByZXR1cm4gKGlzQWJzb2x1dGUgPyAnLycgOiAnJykgKyBwYXRoO1xufTtcblxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5pc0Fic29sdXRlID0gZnVuY3Rpb24ocGF0aCkge1xuICByZXR1cm4gcGF0aC5jaGFyQXQoMCkgPT09ICcvJztcbn07XG5cbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMuam9pbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcGF0aHMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDApO1xuICByZXR1cm4gZXhwb3J0cy5ub3JtYWxpemUoZmlsdGVyKHBhdGhzLCBmdW5jdGlvbihwLCBpbmRleCkge1xuICAgIGlmICh0eXBlb2YgcCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyB0byBwYXRoLmpvaW4gbXVzdCBiZSBzdHJpbmdzJyk7XG4gICAgfVxuICAgIHJldHVybiBwO1xuICB9KS5qb2luKCcvJykpO1xufTtcblxuXG4vLyBwYXRoLnJlbGF0aXZlKGZyb20sIHRvKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5yZWxhdGl2ZSA9IGZ1bmN0aW9uKGZyb20sIHRvKSB7XG4gIGZyb20gPSBleHBvcnRzLnJlc29sdmUoZnJvbSkuc3Vic3RyKDEpO1xuICB0byA9IGV4cG9ydHMucmVzb2x2ZSh0bykuc3Vic3RyKDEpO1xuXG4gIGZ1bmN0aW9uIHRyaW0oYXJyKSB7XG4gICAgdmFyIHN0YXJ0ID0gMDtcbiAgICBmb3IgKDsgc3RhcnQgPCBhcnIubGVuZ3RoOyBzdGFydCsrKSB7XG4gICAgICBpZiAoYXJyW3N0YXJ0XSAhPT0gJycpIGJyZWFrO1xuICAgIH1cblxuICAgIHZhciBlbmQgPSBhcnIubGVuZ3RoIC0gMTtcbiAgICBmb3IgKDsgZW5kID49IDA7IGVuZC0tKSB7XG4gICAgICBpZiAoYXJyW2VuZF0gIT09ICcnKSBicmVhaztcbiAgICB9XG5cbiAgICBpZiAoc3RhcnQgPiBlbmQpIHJldHVybiBbXTtcbiAgICByZXR1cm4gYXJyLnNsaWNlKHN0YXJ0LCBlbmQgLSBzdGFydCArIDEpO1xuICB9XG5cbiAgdmFyIGZyb21QYXJ0cyA9IHRyaW0oZnJvbS5zcGxpdCgnLycpKTtcbiAgdmFyIHRvUGFydHMgPSB0cmltKHRvLnNwbGl0KCcvJykpO1xuXG4gIHZhciBsZW5ndGggPSBNYXRoLm1pbihmcm9tUGFydHMubGVuZ3RoLCB0b1BhcnRzLmxlbmd0aCk7XG4gIHZhciBzYW1lUGFydHNMZW5ndGggPSBsZW5ndGg7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZnJvbVBhcnRzW2ldICE9PSB0b1BhcnRzW2ldKSB7XG4gICAgICBzYW1lUGFydHNMZW5ndGggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgdmFyIG91dHB1dFBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSBzYW1lUGFydHNMZW5ndGg7IGkgPCBmcm9tUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXRwdXRQYXJ0cy5wdXNoKCcuLicpO1xuICB9XG5cbiAgb3V0cHV0UGFydHMgPSBvdXRwdXRQYXJ0cy5jb25jYXQodG9QYXJ0cy5zbGljZShzYW1lUGFydHNMZW5ndGgpKTtcblxuICByZXR1cm4gb3V0cHV0UGFydHMuam9pbignLycpO1xufTtcblxuZXhwb3J0cy5zZXAgPSAnLyc7XG5leHBvcnRzLmRlbGltaXRlciA9ICc6JztcblxuZXhwb3J0cy5kaXJuYW1lID0gZnVuY3Rpb24ocGF0aCkge1xuICB2YXIgcmVzdWx0ID0gc3BsaXRQYXRoKHBhdGgpLFxuICAgICAgcm9vdCA9IHJlc3VsdFswXSxcbiAgICAgIGRpciA9IHJlc3VsdFsxXTtcblxuICBpZiAoIXJvb3QgJiYgIWRpcikge1xuICAgIC8vIE5vIGRpcm5hbWUgd2hhdHNvZXZlclxuICAgIHJldHVybiAnLic7XG4gIH1cblxuICBpZiAoZGlyKSB7XG4gICAgLy8gSXQgaGFzIGEgZGlybmFtZSwgc3RyaXAgdHJhaWxpbmcgc2xhc2hcbiAgICBkaXIgPSBkaXIuc3Vic3RyKDAsIGRpci5sZW5ndGggLSAxKTtcbiAgfVxuXG4gIHJldHVybiByb290ICsgZGlyO1xufTtcblxuXG5leHBvcnRzLmJhc2VuYW1lID0gZnVuY3Rpb24ocGF0aCwgZXh0KSB7XG4gIHZhciBmID0gc3BsaXRQYXRoKHBhdGgpWzJdO1xuICAvLyBUT0RPOiBtYWtlIHRoaXMgY29tcGFyaXNvbiBjYXNlLWluc2Vuc2l0aXZlIG9uIHdpbmRvd3M/XG4gIGlmIChleHQgJiYgZi5zdWJzdHIoLTEgKiBleHQubGVuZ3RoKSA9PT0gZXh0KSB7XG4gICAgZiA9IGYuc3Vic3RyKDAsIGYubGVuZ3RoIC0gZXh0Lmxlbmd0aCk7XG4gIH1cbiAgcmV0dXJuIGY7XG59O1xuXG5cbmV4cG9ydHMuZXh0bmFtZSA9IGZ1bmN0aW9uKHBhdGgpIHtcbiAgcmV0dXJuIHNwbGl0UGF0aChwYXRoKVszXTtcbn07XG5cbmZ1bmN0aW9uIGZpbHRlciAoeHMsIGYpIHtcbiAgICBpZiAoeHMuZmlsdGVyKSByZXR1cm4geHMuZmlsdGVyKGYpO1xuICAgIHZhciByZXMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChmKHhzW2ldLCBpLCB4cykpIHJlcy5wdXNoKHhzW2ldKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbn1cblxuLy8gU3RyaW5nLnByb3RvdHlwZS5zdWJzdHIgLSBuZWdhdGl2ZSBpbmRleCBkb24ndCB3b3JrIGluIElFOFxudmFyIHN1YnN0ciA9ICdhYicuc3Vic3RyKC0xKSA9PT0gJ2InXG4gICAgPyBmdW5jdGlvbiAoc3RyLCBzdGFydCwgbGVuKSB7IHJldHVybiBzdHIuc3Vic3RyKHN0YXJ0LCBsZW4pIH1cbiAgICA6IGZ1bmN0aW9uIChzdHIsIHN0YXJ0LCBsZW4pIHtcbiAgICAgICAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSBzdHIubGVuZ3RoICsgc3RhcnQ7XG4gICAgICAgIHJldHVybiBzdHIuc3Vic3RyKHN0YXJ0LCBsZW4pO1xuICAgIH1cbjtcbiIsIid1c2Ugc3RyaWN0JztcblxuaWYgKCFwcm9jZXNzLnZlcnNpb24gfHxcbiAgICBwcm9jZXNzLnZlcnNpb24uaW5kZXhPZigndjAuJykgPT09IDAgfHxcbiAgICBwcm9jZXNzLnZlcnNpb24uaW5kZXhPZigndjEuJykgPT09IDAgJiYgcHJvY2Vzcy52ZXJzaW9uLmluZGV4T2YoJ3YxLjguJykgIT09IDApIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBuZXh0VGljaztcbn0gZWxzZSB7XG4gIG1vZHVsZS5leHBvcnRzID0gcHJvY2Vzcy5uZXh0VGljaztcbn1cblxuZnVuY3Rpb24gbmV4dFRpY2soZm4sIGFyZzEsIGFyZzIsIGFyZzMpIHtcbiAgaWYgKHR5cGVvZiBmbiAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wiY2FsbGJhY2tcIiBhcmd1bWVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICB2YXIgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgdmFyIGFyZ3MsIGk7XG4gIHN3aXRjaCAobGVuKSB7XG4gIGNhc2UgMDpcbiAgY2FzZSAxOlxuICAgIHJldHVybiBwcm9jZXNzLm5leHRUaWNrKGZuKTtcbiAgY2FzZSAyOlxuICAgIHJldHVybiBwcm9jZXNzLm5leHRUaWNrKGZ1bmN0aW9uIGFmdGVyVGlja09uZSgpIHtcbiAgICAgIGZuLmNhbGwobnVsbCwgYXJnMSk7XG4gICAgfSk7XG4gIGNhc2UgMzpcbiAgICByZXR1cm4gcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbiBhZnRlclRpY2tUd28oKSB7XG4gICAgICBmbi5jYWxsKG51bGwsIGFyZzEsIGFyZzIpO1xuICAgIH0pO1xuICBjYXNlIDQ6XG4gICAgcmV0dXJuIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gYWZ0ZXJUaWNrVGhyZWUoKSB7XG4gICAgICBmbi5jYWxsKG51bGwsIGFyZzEsIGFyZzIsIGFyZzMpO1xuICAgIH0pO1xuICBkZWZhdWx0OlxuICAgIGFyZ3MgPSBuZXcgQXJyYXkobGVuIC0gMSk7XG4gICAgaSA9IDA7XG4gICAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgICAgYXJnc1tpKytdID0gYXJndW1lbnRzW2ldO1xuICAgIH1cbiAgICByZXR1cm4gcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbiBhZnRlclRpY2soKSB7XG4gICAgICBmbi5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9KTtcbiAgfVxufVxuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbi8vIGNhY2hlZCBmcm9tIHdoYXRldmVyIGdsb2JhbCBpcyBwcmVzZW50IHNvIHRoYXQgdGVzdCBydW5uZXJzIHRoYXQgc3R1YiBpdFxuLy8gZG9uJ3QgYnJlYWsgdGhpbmdzLiAgQnV0IHdlIG5lZWQgdG8gd3JhcCBpdCBpbiBhIHRyeSBjYXRjaCBpbiBjYXNlIGl0IGlzXG4vLyB3cmFwcGVkIGluIHN0cmljdCBtb2RlIGNvZGUgd2hpY2ggZG9lc24ndCBkZWZpbmUgYW55IGdsb2JhbHMuICBJdCdzIGluc2lkZSBhXG4vLyBmdW5jdGlvbiBiZWNhdXNlIHRyeS9jYXRjaGVzIGRlb3B0aW1pemUgaW4gY2VydGFpbiBlbmdpbmVzLlxuXG52YXIgY2FjaGVkU2V0VGltZW91dDtcbnZhciBjYWNoZWRDbGVhclRpbWVvdXQ7XG5cbmZ1bmN0aW9uIGRlZmF1bHRTZXRUaW1vdXQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzZXRUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG5mdW5jdGlvbiBkZWZhdWx0Q2xlYXJUaW1lb3V0ICgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyVGltZW91dCBoYXMgbm90IGJlZW4gZGVmaW5lZCcpO1xufVxuKGZ1bmN0aW9uICgpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAodHlwZW9mIHNldFRpbWVvdXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBzZXRUaW1lb3V0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBkZWZhdWx0U2V0VGltb3V0O1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICBpZiAodHlwZW9mIGNsZWFyVGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gY2xlYXJUaW1lb3V0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gZGVmYXVsdENsZWFyVGltZW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gZGVmYXVsdENsZWFyVGltZW91dDtcbiAgICB9XG59ICgpKVxuZnVuY3Rpb24gcnVuVGltZW91dChmdW4pIHtcbiAgICBpZiAoY2FjaGVkU2V0VGltZW91dCA9PT0gc2V0VGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgLy8gaWYgc2V0VGltZW91dCB3YXNuJ3QgYXZhaWxhYmxlIGJ1dCB3YXMgbGF0dGVyIGRlZmluZWRcbiAgICBpZiAoKGNhY2hlZFNldFRpbWVvdXQgPT09IGRlZmF1bHRTZXRUaW1vdXQgfHwgIWNhY2hlZFNldFRpbWVvdXQpICYmIHNldFRpbWVvdXQpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIC8vIHdoZW4gd2hlbiBzb21lYm9keSBoYXMgc2NyZXdlZCB3aXRoIHNldFRpbWVvdXQgYnV0IG5vIEkuRS4gbWFkZG5lc3NcbiAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9IGNhdGNoKGUpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gV2hlbiB3ZSBhcmUgaW4gSS5FLiBidXQgdGhlIHNjcmlwdCBoYXMgYmVlbiBldmFsZWQgc28gSS5FLiBkb2Vzbid0IHRydXN0IHRoZSBnbG9iYWwgb2JqZWN0IHdoZW4gY2FsbGVkIG5vcm1hbGx5XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKG51bGwsIGZ1biwgMCk7XG4gICAgICAgIH0gY2F0Y2goZSl7XG4gICAgICAgICAgICAvLyBzYW1lIGFzIGFib3ZlIGJ1dCB3aGVuIGl0J3MgYSB2ZXJzaW9uIG9mIEkuRS4gdGhhdCBtdXN0IGhhdmUgdGhlIGdsb2JhbCBvYmplY3QgZm9yICd0aGlzJywgaG9wZnVsbHkgb3VyIGNvbnRleHQgY29ycmVjdCBvdGhlcndpc2UgaXQgd2lsbCB0aHJvdyBhIGdsb2JhbCBlcnJvclxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQuY2FsbCh0aGlzLCBmdW4sIDApO1xuICAgICAgICB9XG4gICAgfVxuXG5cbn1cbmZ1bmN0aW9uIHJ1bkNsZWFyVGltZW91dChtYXJrZXIpIHtcbiAgICBpZiAoY2FjaGVkQ2xlYXJUaW1lb3V0ID09PSBjbGVhclRpbWVvdXQpIHtcbiAgICAgICAgLy9ub3JtYWwgZW52aXJvbWVudHMgaW4gc2FuZSBzaXR1YXRpb25zXG4gICAgICAgIHJldHVybiBjbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9XG4gICAgLy8gaWYgY2xlYXJUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkQ2xlYXJUaW1lb3V0ID09PSBkZWZhdWx0Q2xlYXJUaW1lb3V0IHx8ICFjYWNoZWRDbGVhclRpbWVvdXQpICYmIGNsZWFyVGltZW91dCkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIHJldHVybiBjbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfSBjYXRjaCAoZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgIHRydXN0IHRoZSBnbG9iYWwgb2JqZWN0IHdoZW4gY2FsbGVkIG5vcm1hbGx5XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0LmNhbGwobnVsbCwgbWFya2VyKTtcbiAgICAgICAgfSBjYXRjaCAoZSl7XG4gICAgICAgICAgICAvLyBzYW1lIGFzIGFib3ZlIGJ1dCB3aGVuIGl0J3MgYSB2ZXJzaW9uIG9mIEkuRS4gdGhhdCBtdXN0IGhhdmUgdGhlIGdsb2JhbCBvYmplY3QgZm9yICd0aGlzJywgaG9wZnVsbHkgb3VyIGNvbnRleHQgY29ycmVjdCBvdGhlcndpc2UgaXQgd2lsbCB0aHJvdyBhIGdsb2JhbCBlcnJvci5cbiAgICAgICAgICAgIC8vIFNvbWUgdmVyc2lvbnMgb2YgSS5FLiBoYXZlIGRpZmZlcmVudCBydWxlcyBmb3IgY2xlYXJUaW1lb3V0IHZzIHNldFRpbWVvdXRcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbCh0aGlzLCBtYXJrZXIpO1xuICAgICAgICB9XG4gICAgfVxuXG5cblxufVxudmFyIHF1ZXVlID0gW107XG52YXIgZHJhaW5pbmcgPSBmYWxzZTtcbnZhciBjdXJyZW50UXVldWU7XG52YXIgcXVldWVJbmRleCA9IC0xO1xuXG5mdW5jdGlvbiBjbGVhblVwTmV4dFRpY2soKSB7XG4gICAgaWYgKCFkcmFpbmluZyB8fCAhY3VycmVudFF1ZXVlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBpZiAoY3VycmVudFF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBxdWV1ZSA9IGN1cnJlbnRRdWV1ZS5jb25jYXQocXVldWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICB9XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCkge1xuICAgICAgICBkcmFpblF1ZXVlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkcmFpblF1ZXVlKCkge1xuICAgIGlmIChkcmFpbmluZykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciB0aW1lb3V0ID0gcnVuVGltZW91dChjbGVhblVwTmV4dFRpY2spO1xuICAgIGRyYWluaW5nID0gdHJ1ZTtcblxuICAgIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUobGVuKSB7XG4gICAgICAgIGN1cnJlbnRRdWV1ZSA9IHF1ZXVlO1xuICAgICAgICBxdWV1ZSA9IFtdO1xuICAgICAgICB3aGlsZSAoKytxdWV1ZUluZGV4IDwgbGVuKSB7XG4gICAgICAgICAgICBpZiAoY3VycmVudFF1ZXVlKSB7XG4gICAgICAgICAgICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdLnJ1bigpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBjdXJyZW50UXVldWUgPSBudWxsO1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgcnVuQ2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xufVxuXG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHF1ZXVlLnB1c2gobmV3IEl0ZW0oZnVuLCBhcmdzKSk7XG4gICAgaWYgKHF1ZXVlLmxlbmd0aCA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICAgICAgcnVuVGltZW91dChkcmFpblF1ZXVlKTtcbiAgICB9XG59O1xuXG4vLyB2OCBsaWtlcyBwcmVkaWN0aWJsZSBvYmplY3RzXG5mdW5jdGlvbiBJdGVtKGZ1biwgYXJyYXkpIHtcbiAgICB0aGlzLmZ1biA9IGZ1bjtcbiAgICB0aGlzLmFycmF5ID0gYXJyYXk7XG59XG5JdGVtLnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5mdW4uYXBwbHkobnVsbCwgdGhpcy5hcnJheSk7XG59O1xucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xucHJvY2Vzcy51bWFzayA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gMDsgfTtcbiIsIi8vIGEgZHVwbGV4IHN0cmVhbSBpcyBqdXN0IGEgc3RyZWFtIHRoYXQgaXMgYm90aCByZWFkYWJsZSBhbmQgd3JpdGFibGUuXG4vLyBTaW5jZSBKUyBkb2Vzbid0IGhhdmUgbXVsdGlwbGUgcHJvdG90eXBhbCBpbmhlcml0YW5jZSwgdGhpcyBjbGFzc1xuLy8gcHJvdG90eXBhbGx5IGluaGVyaXRzIGZyb20gUmVhZGFibGUsIGFuZCB0aGVuIHBhcmFzaXRpY2FsbHkgZnJvbVxuLy8gV3JpdGFibGUuXG5cbid1c2Ugc3RyaWN0JztcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cblxudmFyIG9iamVjdEtleXMgPSBPYmplY3Qua2V5cyB8fCBmdW5jdGlvbiAob2JqKSB7XG4gIHZhciBrZXlzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICBrZXlzLnB1c2goa2V5KTtcbiAgfXJldHVybiBrZXlzO1xufTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG5tb2R1bGUuZXhwb3J0cyA9IER1cGxleDtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciBwcm9jZXNzTmV4dFRpY2sgPSByZXF1aXJlKCdwcm9jZXNzLW5leHRpY2stYXJncycpO1xuLyo8L3JlcGxhY2VtZW50PiovXG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgdXRpbCA9IHJlcXVpcmUoJ2NvcmUtdXRpbC1pcycpO1xudXRpbC5pbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxudmFyIFJlYWRhYmxlID0gcmVxdWlyZSgnLi9fc3RyZWFtX3JlYWRhYmxlJyk7XG52YXIgV3JpdGFibGUgPSByZXF1aXJlKCcuL19zdHJlYW1fd3JpdGFibGUnKTtcblxudXRpbC5pbmhlcml0cyhEdXBsZXgsIFJlYWRhYmxlKTtcblxudmFyIGtleXMgPSBvYmplY3RLZXlzKFdyaXRhYmxlLnByb3RvdHlwZSk7XG5mb3IgKHZhciB2ID0gMDsgdiA8IGtleXMubGVuZ3RoOyB2KyspIHtcbiAgdmFyIG1ldGhvZCA9IGtleXNbdl07XG4gIGlmICghRHVwbGV4LnByb3RvdHlwZVttZXRob2RdKSBEdXBsZXgucHJvdG90eXBlW21ldGhvZF0gPSBXcml0YWJsZS5wcm90b3R5cGVbbWV0aG9kXTtcbn1cblxuZnVuY3Rpb24gRHVwbGV4KG9wdGlvbnMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIER1cGxleCkpIHJldHVybiBuZXcgRHVwbGV4KG9wdGlvbnMpO1xuXG4gIFJlYWRhYmxlLmNhbGwodGhpcywgb3B0aW9ucyk7XG4gIFdyaXRhYmxlLmNhbGwodGhpcywgb3B0aW9ucyk7XG5cbiAgaWYgKG9wdGlvbnMgJiYgb3B0aW9ucy5yZWFkYWJsZSA9PT0gZmFsc2UpIHRoaXMucmVhZGFibGUgPSBmYWxzZTtcblxuICBpZiAob3B0aW9ucyAmJiBvcHRpb25zLndyaXRhYmxlID09PSBmYWxzZSkgdGhpcy53cml0YWJsZSA9IGZhbHNlO1xuXG4gIHRoaXMuYWxsb3dIYWxmT3BlbiA9IHRydWU7XG4gIGlmIChvcHRpb25zICYmIG9wdGlvbnMuYWxsb3dIYWxmT3BlbiA9PT0gZmFsc2UpIHRoaXMuYWxsb3dIYWxmT3BlbiA9IGZhbHNlO1xuXG4gIHRoaXMub25jZSgnZW5kJywgb25lbmQpO1xufVxuXG4vLyB0aGUgbm8taGFsZi1vcGVuIGVuZm9yY2VyXG5mdW5jdGlvbiBvbmVuZCgpIHtcbiAgLy8gaWYgd2UgYWxsb3cgaGFsZi1vcGVuIHN0YXRlLCBvciBpZiB0aGUgd3JpdGFibGUgc2lkZSBlbmRlZCxcbiAgLy8gdGhlbiB3ZSdyZSBvay5cbiAgaWYgKHRoaXMuYWxsb3dIYWxmT3BlbiB8fCB0aGlzLl93cml0YWJsZVN0YXRlLmVuZGVkKSByZXR1cm47XG5cbiAgLy8gbm8gbW9yZSBkYXRhIGNhbiBiZSB3cml0dGVuLlxuICAvLyBCdXQgYWxsb3cgbW9yZSB3cml0ZXMgdG8gaGFwcGVuIGluIHRoaXMgdGljay5cbiAgcHJvY2Vzc05leHRUaWNrKG9uRW5kTlQsIHRoaXMpO1xufVxuXG5mdW5jdGlvbiBvbkVuZE5UKHNlbGYpIHtcbiAgc2VsZi5lbmQoKTtcbn1cblxuZnVuY3Rpb24gZm9yRWFjaCh4cywgZikge1xuICBmb3IgKHZhciBpID0gMCwgbCA9IHhzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgIGYoeHNbaV0sIGkpO1xuICB9XG59IiwiLy8gYSBwYXNzdGhyb3VnaCBzdHJlYW0uXG4vLyBiYXNpY2FsbHkganVzdCB0aGUgbW9zdCBtaW5pbWFsIHNvcnQgb2YgVHJhbnNmb3JtIHN0cmVhbS5cbi8vIEV2ZXJ5IHdyaXR0ZW4gY2h1bmsgZ2V0cyBvdXRwdXQgYXMtaXMuXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBQYXNzVGhyb3VnaDtcblxudmFyIFRyYW5zZm9ybSA9IHJlcXVpcmUoJy4vX3N0cmVhbV90cmFuc2Zvcm0nKTtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciB1dGlsID0gcmVxdWlyZSgnY29yZS11dGlsLWlzJyk7XG51dGlsLmluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG51dGlsLmluaGVyaXRzKFBhc3NUaHJvdWdoLCBUcmFuc2Zvcm0pO1xuXG5mdW5jdGlvbiBQYXNzVGhyb3VnaChvcHRpb25zKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBQYXNzVGhyb3VnaCkpIHJldHVybiBuZXcgUGFzc1Rocm91Z2gob3B0aW9ucyk7XG5cbiAgVHJhbnNmb3JtLmNhbGwodGhpcywgb3B0aW9ucyk7XG59XG5cblBhc3NUaHJvdWdoLnByb3RvdHlwZS5fdHJhbnNmb3JtID0gZnVuY3Rpb24gKGNodW5rLCBlbmNvZGluZywgY2IpIHtcbiAgY2IobnVsbCwgY2h1bmspO1xufTsiLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gUmVhZGFibGU7XG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgcHJvY2Vzc05leHRUaWNrID0gcmVxdWlyZSgncHJvY2Vzcy1uZXh0aWNrLWFyZ3MnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIGlzQXJyYXkgPSByZXF1aXJlKCdpc2FycmF5Jyk7XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciBEdXBsZXg7XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxuUmVhZGFibGUuUmVhZGFibGVTdGF0ZSA9IFJlYWRhYmxlU3RhdGU7XG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgRUUgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXI7XG5cbnZhciBFRWxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbiAoZW1pdHRlciwgdHlwZSkge1xuICByZXR1cm4gZW1pdHRlci5saXN0ZW5lcnModHlwZSkubGVuZ3RoO1xufTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIFN0cmVhbTtcbihmdW5jdGlvbiAoKSB7XG4gIHRyeSB7XG4gICAgU3RyZWFtID0gcmVxdWlyZSgnc3QnICsgJ3JlYW0nKTtcbiAgfSBjYXRjaCAoXykge30gZmluYWxseSB7XG4gICAgaWYgKCFTdHJlYW0pIFN0cmVhbSA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcbiAgfVxufSkoKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG52YXIgQnVmZmVyID0gcmVxdWlyZSgnYnVmZmVyJykuQnVmZmVyO1xuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciBidWZmZXJTaGltID0gcmVxdWlyZSgnYnVmZmVyLXNoaW1zJyk7XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciB1dGlsID0gcmVxdWlyZSgnY29yZS11dGlsLWlzJyk7XG51dGlsLmluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIGRlYnVnVXRpbCA9IHJlcXVpcmUoJ3V0aWwnKTtcbnZhciBkZWJ1ZyA9IHZvaWQgMDtcbmlmIChkZWJ1Z1V0aWwgJiYgZGVidWdVdGlsLmRlYnVnbG9nKSB7XG4gIGRlYnVnID0gZGVidWdVdGlsLmRlYnVnbG9nKCdzdHJlYW0nKTtcbn0gZWxzZSB7XG4gIGRlYnVnID0gZnVuY3Rpb24gKCkge307XG59XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxudmFyIEJ1ZmZlckxpc3QgPSByZXF1aXJlKCcuL2ludGVybmFsL3N0cmVhbXMvQnVmZmVyTGlzdCcpO1xudmFyIFN0cmluZ0RlY29kZXI7XG5cbnV0aWwuaW5oZXJpdHMoUmVhZGFibGUsIFN0cmVhbSk7XG5cbmZ1bmN0aW9uIHByZXBlbmRMaXN0ZW5lcihlbWl0dGVyLCBldmVudCwgZm4pIHtcbiAgLy8gU2FkbHkgdGhpcyBpcyBub3QgY2FjaGVhYmxlIGFzIHNvbWUgbGlicmFyaWVzIGJ1bmRsZSB0aGVpciBvd25cbiAgLy8gZXZlbnQgZW1pdHRlciBpbXBsZW1lbnRhdGlvbiB3aXRoIHRoZW0uXG4gIGlmICh0eXBlb2YgZW1pdHRlci5wcmVwZW5kTGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gZW1pdHRlci5wcmVwZW5kTGlzdGVuZXIoZXZlbnQsIGZuKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBUaGlzIGlzIGEgaGFjayB0byBtYWtlIHN1cmUgdGhhdCBvdXIgZXJyb3IgaGFuZGxlciBpcyBhdHRhY2hlZCBiZWZvcmUgYW55XG4gICAgLy8gdXNlcmxhbmQgb25lcy4gIE5FVkVSIERPIFRISVMuIFRoaXMgaXMgaGVyZSBvbmx5IGJlY2F1c2UgdGhpcyBjb2RlIG5lZWRzXG4gICAgLy8gdG8gY29udGludWUgdG8gd29yayB3aXRoIG9sZGVyIHZlcnNpb25zIG9mIE5vZGUuanMgdGhhdCBkbyBub3QgaW5jbHVkZVxuICAgIC8vIHRoZSBwcmVwZW5kTGlzdGVuZXIoKSBtZXRob2QuIFRoZSBnb2FsIGlzIHRvIGV2ZW50dWFsbHkgcmVtb3ZlIHRoaXMgaGFjay5cbiAgICBpZiAoIWVtaXR0ZXIuX2V2ZW50cyB8fCAhZW1pdHRlci5fZXZlbnRzW2V2ZW50XSkgZW1pdHRlci5vbihldmVudCwgZm4pO2Vsc2UgaWYgKGlzQXJyYXkoZW1pdHRlci5fZXZlbnRzW2V2ZW50XSkpIGVtaXR0ZXIuX2V2ZW50c1tldmVudF0udW5zaGlmdChmbik7ZWxzZSBlbWl0dGVyLl9ldmVudHNbZXZlbnRdID0gW2ZuLCBlbWl0dGVyLl9ldmVudHNbZXZlbnRdXTtcbiAgfVxufVxuXG5mdW5jdGlvbiBSZWFkYWJsZVN0YXRlKG9wdGlvbnMsIHN0cmVhbSkge1xuICBEdXBsZXggPSBEdXBsZXggfHwgcmVxdWlyZSgnLi9fc3RyZWFtX2R1cGxleCcpO1xuXG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gIC8vIG9iamVjdCBzdHJlYW0gZmxhZy4gVXNlZCB0byBtYWtlIHJlYWQobikgaWdub3JlIG4gYW5kIHRvXG4gIC8vIG1ha2UgYWxsIHRoZSBidWZmZXIgbWVyZ2luZyBhbmQgbGVuZ3RoIGNoZWNrcyBnbyBhd2F5XG4gIHRoaXMub2JqZWN0TW9kZSA9ICEhb3B0aW9ucy5vYmplY3RNb2RlO1xuXG4gIGlmIChzdHJlYW0gaW5zdGFuY2VvZiBEdXBsZXgpIHRoaXMub2JqZWN0TW9kZSA9IHRoaXMub2JqZWN0TW9kZSB8fCAhIW9wdGlvbnMucmVhZGFibGVPYmplY3RNb2RlO1xuXG4gIC8vIHRoZSBwb2ludCBhdCB3aGljaCBpdCBzdG9wcyBjYWxsaW5nIF9yZWFkKCkgdG8gZmlsbCB0aGUgYnVmZmVyXG4gIC8vIE5vdGU6IDAgaXMgYSB2YWxpZCB2YWx1ZSwgbWVhbnMgXCJkb24ndCBjYWxsIF9yZWFkIHByZWVtcHRpdmVseSBldmVyXCJcbiAgdmFyIGh3bSA9IG9wdGlvbnMuaGlnaFdhdGVyTWFyaztcbiAgdmFyIGRlZmF1bHRId20gPSB0aGlzLm9iamVjdE1vZGUgPyAxNiA6IDE2ICogMTAyNDtcbiAgdGhpcy5oaWdoV2F0ZXJNYXJrID0gaHdtIHx8IGh3bSA9PT0gMCA/IGh3bSA6IGRlZmF1bHRId207XG5cbiAgLy8gY2FzdCB0byBpbnRzLlxuICB0aGlzLmhpZ2hXYXRlck1hcmsgPSB+IH50aGlzLmhpZ2hXYXRlck1hcms7XG5cbiAgLy8gQSBsaW5rZWQgbGlzdCBpcyB1c2VkIHRvIHN0b3JlIGRhdGEgY2h1bmtzIGluc3RlYWQgb2YgYW4gYXJyYXkgYmVjYXVzZSB0aGVcbiAgLy8gbGlua2VkIGxpc3QgY2FuIHJlbW92ZSBlbGVtZW50cyBmcm9tIHRoZSBiZWdpbm5pbmcgZmFzdGVyIHRoYW5cbiAgLy8gYXJyYXkuc2hpZnQoKVxuICB0aGlzLmJ1ZmZlciA9IG5ldyBCdWZmZXJMaXN0KCk7XG4gIHRoaXMubGVuZ3RoID0gMDtcbiAgdGhpcy5waXBlcyA9IG51bGw7XG4gIHRoaXMucGlwZXNDb3VudCA9IDA7XG4gIHRoaXMuZmxvd2luZyA9IG51bGw7XG4gIHRoaXMuZW5kZWQgPSBmYWxzZTtcbiAgdGhpcy5lbmRFbWl0dGVkID0gZmFsc2U7XG4gIHRoaXMucmVhZGluZyA9IGZhbHNlO1xuXG4gIC8vIGEgZmxhZyB0byBiZSBhYmxlIHRvIHRlbGwgaWYgdGhlIG9ud3JpdGUgY2IgaXMgY2FsbGVkIGltbWVkaWF0ZWx5LFxuICAvLyBvciBvbiBhIGxhdGVyIHRpY2suICBXZSBzZXQgdGhpcyB0byB0cnVlIGF0IGZpcnN0LCBiZWNhdXNlIGFueVxuICAvLyBhY3Rpb25zIHRoYXQgc2hvdWxkbid0IGhhcHBlbiB1bnRpbCBcImxhdGVyXCIgc2hvdWxkIGdlbmVyYWxseSBhbHNvXG4gIC8vIG5vdCBoYXBwZW4gYmVmb3JlIHRoZSBmaXJzdCB3cml0ZSBjYWxsLlxuICB0aGlzLnN5bmMgPSB0cnVlO1xuXG4gIC8vIHdoZW5ldmVyIHdlIHJldHVybiBudWxsLCB0aGVuIHdlIHNldCBhIGZsYWcgdG8gc2F5XG4gIC8vIHRoYXQgd2UncmUgYXdhaXRpbmcgYSAncmVhZGFibGUnIGV2ZW50IGVtaXNzaW9uLlxuICB0aGlzLm5lZWRSZWFkYWJsZSA9IGZhbHNlO1xuICB0aGlzLmVtaXR0ZWRSZWFkYWJsZSA9IGZhbHNlO1xuICB0aGlzLnJlYWRhYmxlTGlzdGVuaW5nID0gZmFsc2U7XG4gIHRoaXMucmVzdW1lU2NoZWR1bGVkID0gZmFsc2U7XG5cbiAgLy8gQ3J5cHRvIGlzIGtpbmQgb2Ygb2xkIGFuZCBjcnVzdHkuICBIaXN0b3JpY2FsbHksIGl0cyBkZWZhdWx0IHN0cmluZ1xuICAvLyBlbmNvZGluZyBpcyAnYmluYXJ5JyBzbyB3ZSBoYXZlIHRvIG1ha2UgdGhpcyBjb25maWd1cmFibGUuXG4gIC8vIEV2ZXJ5dGhpbmcgZWxzZSBpbiB0aGUgdW5pdmVyc2UgdXNlcyAndXRmOCcsIHRob3VnaC5cbiAgdGhpcy5kZWZhdWx0RW5jb2RpbmcgPSBvcHRpb25zLmRlZmF1bHRFbmNvZGluZyB8fCAndXRmOCc7XG5cbiAgLy8gd2hlbiBwaXBpbmcsIHdlIG9ubHkgY2FyZSBhYm91dCAncmVhZGFibGUnIGV2ZW50cyB0aGF0IGhhcHBlblxuICAvLyBhZnRlciByZWFkKClpbmcgYWxsIHRoZSBieXRlcyBhbmQgbm90IGdldHRpbmcgYW55IHB1c2hiYWNrLlxuICB0aGlzLnJhbk91dCA9IGZhbHNlO1xuXG4gIC8vIHRoZSBudW1iZXIgb2Ygd3JpdGVycyB0aGF0IGFyZSBhd2FpdGluZyBhIGRyYWluIGV2ZW50IGluIC5waXBlKClzXG4gIHRoaXMuYXdhaXREcmFpbiA9IDA7XG5cbiAgLy8gaWYgdHJ1ZSwgYSBtYXliZVJlYWRNb3JlIGhhcyBiZWVuIHNjaGVkdWxlZFxuICB0aGlzLnJlYWRpbmdNb3JlID0gZmFsc2U7XG5cbiAgdGhpcy5kZWNvZGVyID0gbnVsbDtcbiAgdGhpcy5lbmNvZGluZyA9IG51bGw7XG4gIGlmIChvcHRpb25zLmVuY29kaW5nKSB7XG4gICAgaWYgKCFTdHJpbmdEZWNvZGVyKSBTdHJpbmdEZWNvZGVyID0gcmVxdWlyZSgnc3RyaW5nX2RlY29kZXIvJykuU3RyaW5nRGVjb2RlcjtcbiAgICB0aGlzLmRlY29kZXIgPSBuZXcgU3RyaW5nRGVjb2RlcihvcHRpb25zLmVuY29kaW5nKTtcbiAgICB0aGlzLmVuY29kaW5nID0gb3B0aW9ucy5lbmNvZGluZztcbiAgfVxufVxuXG5mdW5jdGlvbiBSZWFkYWJsZShvcHRpb25zKSB7XG4gIER1cGxleCA9IER1cGxleCB8fCByZXF1aXJlKCcuL19zdHJlYW1fZHVwbGV4Jyk7XG5cbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFJlYWRhYmxlKSkgcmV0dXJuIG5ldyBSZWFkYWJsZShvcHRpb25zKTtcblxuICB0aGlzLl9yZWFkYWJsZVN0YXRlID0gbmV3IFJlYWRhYmxlU3RhdGUob3B0aW9ucywgdGhpcyk7XG5cbiAgLy8gbGVnYWN5XG4gIHRoaXMucmVhZGFibGUgPSB0cnVlO1xuXG4gIGlmIChvcHRpb25zICYmIHR5cGVvZiBvcHRpb25zLnJlYWQgPT09ICdmdW5jdGlvbicpIHRoaXMuX3JlYWQgPSBvcHRpb25zLnJlYWQ7XG5cbiAgU3RyZWFtLmNhbGwodGhpcyk7XG59XG5cbi8vIE1hbnVhbGx5IHNob3ZlIHNvbWV0aGluZyBpbnRvIHRoZSByZWFkKCkgYnVmZmVyLlxuLy8gVGhpcyByZXR1cm5zIHRydWUgaWYgdGhlIGhpZ2hXYXRlck1hcmsgaGFzIG5vdCBiZWVuIGhpdCB5ZXQsXG4vLyBzaW1pbGFyIHRvIGhvdyBXcml0YWJsZS53cml0ZSgpIHJldHVybnMgdHJ1ZSBpZiB5b3Ugc2hvdWxkXG4vLyB3cml0ZSgpIHNvbWUgbW9yZS5cblJlYWRhYmxlLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24gKGNodW5rLCBlbmNvZGluZykge1xuICB2YXIgc3RhdGUgPSB0aGlzLl9yZWFkYWJsZVN0YXRlO1xuXG4gIGlmICghc3RhdGUub2JqZWN0TW9kZSAmJiB0eXBlb2YgY2h1bmsgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBlbmNvZGluZyB8fCBzdGF0ZS5kZWZhdWx0RW5jb2Rpbmc7XG4gICAgaWYgKGVuY29kaW5nICE9PSBzdGF0ZS5lbmNvZGluZykge1xuICAgICAgY2h1bmsgPSBidWZmZXJTaGltLmZyb20oY2h1bmssIGVuY29kaW5nKTtcbiAgICAgIGVuY29kaW5nID0gJyc7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlYWRhYmxlQWRkQ2h1bmsodGhpcywgc3RhdGUsIGNodW5rLCBlbmNvZGluZywgZmFsc2UpO1xufTtcblxuLy8gVW5zaGlmdCBzaG91bGQgKmFsd2F5cyogYmUgc29tZXRoaW5nIGRpcmVjdGx5IG91dCBvZiByZWFkKClcblJlYWRhYmxlLnByb3RvdHlwZS51bnNoaWZ0ID0gZnVuY3Rpb24gKGNodW5rKSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG4gIHJldHVybiByZWFkYWJsZUFkZENodW5rKHRoaXMsIHN0YXRlLCBjaHVuaywgJycsIHRydWUpO1xufTtcblxuUmVhZGFibGUucHJvdG90eXBlLmlzUGF1c2VkID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gdGhpcy5fcmVhZGFibGVTdGF0ZS5mbG93aW5nID09PSBmYWxzZTtcbn07XG5cbmZ1bmN0aW9uIHJlYWRhYmxlQWRkQ2h1bmsoc3RyZWFtLCBzdGF0ZSwgY2h1bmssIGVuY29kaW5nLCBhZGRUb0Zyb250KSB7XG4gIHZhciBlciA9IGNodW5rSW52YWxpZChzdGF0ZSwgY2h1bmspO1xuICBpZiAoZXIpIHtcbiAgICBzdHJlYW0uZW1pdCgnZXJyb3InLCBlcik7XG4gIH0gZWxzZSBpZiAoY2h1bmsgPT09IG51bGwpIHtcbiAgICBzdGF0ZS5yZWFkaW5nID0gZmFsc2U7XG4gICAgb25Fb2ZDaHVuayhzdHJlYW0sIHN0YXRlKTtcbiAgfSBlbHNlIGlmIChzdGF0ZS5vYmplY3RNb2RlIHx8IGNodW5rICYmIGNodW5rLmxlbmd0aCA+IDApIHtcbiAgICBpZiAoc3RhdGUuZW5kZWQgJiYgIWFkZFRvRnJvbnQpIHtcbiAgICAgIHZhciBlID0gbmV3IEVycm9yKCdzdHJlYW0ucHVzaCgpIGFmdGVyIEVPRicpO1xuICAgICAgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZSk7XG4gICAgfSBlbHNlIGlmIChzdGF0ZS5lbmRFbWl0dGVkICYmIGFkZFRvRnJvbnQpIHtcbiAgICAgIHZhciBfZSA9IG5ldyBFcnJvcignc3RyZWFtLnVuc2hpZnQoKSBhZnRlciBlbmQgZXZlbnQnKTtcbiAgICAgIHN0cmVhbS5lbWl0KCdlcnJvcicsIF9lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHNraXBBZGQ7XG4gICAgICBpZiAoc3RhdGUuZGVjb2RlciAmJiAhYWRkVG9Gcm9udCAmJiAhZW5jb2RpbmcpIHtcbiAgICAgICAgY2h1bmsgPSBzdGF0ZS5kZWNvZGVyLndyaXRlKGNodW5rKTtcbiAgICAgICAgc2tpcEFkZCA9ICFzdGF0ZS5vYmplY3RNb2RlICYmIGNodW5rLmxlbmd0aCA9PT0gMDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFhZGRUb0Zyb250KSBzdGF0ZS5yZWFkaW5nID0gZmFsc2U7XG5cbiAgICAgIC8vIERvbid0IGFkZCB0byB0aGUgYnVmZmVyIGlmIHdlJ3ZlIGRlY29kZWQgdG8gYW4gZW1wdHkgc3RyaW5nIGNodW5rIGFuZFxuICAgICAgLy8gd2UncmUgbm90IGluIG9iamVjdCBtb2RlXG4gICAgICBpZiAoIXNraXBBZGQpIHtcbiAgICAgICAgLy8gaWYgd2Ugd2FudCB0aGUgZGF0YSBub3csIGp1c3QgZW1pdCBpdC5cbiAgICAgICAgaWYgKHN0YXRlLmZsb3dpbmcgJiYgc3RhdGUubGVuZ3RoID09PSAwICYmICFzdGF0ZS5zeW5jKSB7XG4gICAgICAgICAgc3RyZWFtLmVtaXQoJ2RhdGEnLCBjaHVuayk7XG4gICAgICAgICAgc3RyZWFtLnJlYWQoMCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdXBkYXRlIHRoZSBidWZmZXIgaW5mby5cbiAgICAgICAgICBzdGF0ZS5sZW5ndGggKz0gc3RhdGUub2JqZWN0TW9kZSA/IDEgOiBjaHVuay5sZW5ndGg7XG4gICAgICAgICAgaWYgKGFkZFRvRnJvbnQpIHN0YXRlLmJ1ZmZlci51bnNoaWZ0KGNodW5rKTtlbHNlIHN0YXRlLmJ1ZmZlci5wdXNoKGNodW5rKTtcblxuICAgICAgICAgIGlmIChzdGF0ZS5uZWVkUmVhZGFibGUpIGVtaXRSZWFkYWJsZShzdHJlYW0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG1heWJlUmVhZE1vcmUoc3RyZWFtLCBzdGF0ZSk7XG4gICAgfVxuICB9IGVsc2UgaWYgKCFhZGRUb0Zyb250KSB7XG4gICAgc3RhdGUucmVhZGluZyA9IGZhbHNlO1xuICB9XG5cbiAgcmV0dXJuIG5lZWRNb3JlRGF0YShzdGF0ZSk7XG59XG5cbi8vIGlmIGl0J3MgcGFzdCB0aGUgaGlnaCB3YXRlciBtYXJrLCB3ZSBjYW4gcHVzaCBpbiBzb21lIG1vcmUuXG4vLyBBbHNvLCBpZiB3ZSBoYXZlIG5vIGRhdGEgeWV0LCB3ZSBjYW4gc3RhbmQgc29tZVxuLy8gbW9yZSBieXRlcy4gIFRoaXMgaXMgdG8gd29yayBhcm91bmQgY2FzZXMgd2hlcmUgaHdtPTAsXG4vLyBzdWNoIGFzIHRoZSByZXBsLiAgQWxzbywgaWYgdGhlIHB1c2goKSB0cmlnZ2VyZWQgYVxuLy8gcmVhZGFibGUgZXZlbnQsIGFuZCB0aGUgdXNlciBjYWxsZWQgcmVhZChsYXJnZU51bWJlcikgc3VjaCB0aGF0XG4vLyBuZWVkUmVhZGFibGUgd2FzIHNldCwgdGhlbiB3ZSBvdWdodCB0byBwdXNoIG1vcmUsIHNvIHRoYXQgYW5vdGhlclxuLy8gJ3JlYWRhYmxlJyBldmVudCB3aWxsIGJlIHRyaWdnZXJlZC5cbmZ1bmN0aW9uIG5lZWRNb3JlRGF0YShzdGF0ZSkge1xuICByZXR1cm4gIXN0YXRlLmVuZGVkICYmIChzdGF0ZS5uZWVkUmVhZGFibGUgfHwgc3RhdGUubGVuZ3RoIDwgc3RhdGUuaGlnaFdhdGVyTWFyayB8fCBzdGF0ZS5sZW5ndGggPT09IDApO1xufVxuXG4vLyBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eS5cblJlYWRhYmxlLnByb3RvdHlwZS5zZXRFbmNvZGluZyA9IGZ1bmN0aW9uIChlbmMpIHtcbiAgaWYgKCFTdHJpbmdEZWNvZGVyKSBTdHJpbmdEZWNvZGVyID0gcmVxdWlyZSgnc3RyaW5nX2RlY29kZXIvJykuU3RyaW5nRGVjb2RlcjtcbiAgdGhpcy5fcmVhZGFibGVTdGF0ZS5kZWNvZGVyID0gbmV3IFN0cmluZ0RlY29kZXIoZW5jKTtcbiAgdGhpcy5fcmVhZGFibGVTdGF0ZS5lbmNvZGluZyA9IGVuYztcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBEb24ndCByYWlzZSB0aGUgaHdtID4gOE1CXG52YXIgTUFYX0hXTSA9IDB4ODAwMDAwO1xuZnVuY3Rpb24gY29tcHV0ZU5ld0hpZ2hXYXRlck1hcmsobikge1xuICBpZiAobiA+PSBNQVhfSFdNKSB7XG4gICAgbiA9IE1BWF9IV007XG4gIH0gZWxzZSB7XG4gICAgLy8gR2V0IHRoZSBuZXh0IGhpZ2hlc3QgcG93ZXIgb2YgMiB0byBwcmV2ZW50IGluY3JlYXNpbmcgaHdtIGV4Y2Vzc2l2ZWx5IGluXG4gICAgLy8gdGlueSBhbW91bnRzXG4gICAgbi0tO1xuICAgIG4gfD0gbiA+Pj4gMTtcbiAgICBuIHw9IG4gPj4+IDI7XG4gICAgbiB8PSBuID4+PiA0O1xuICAgIG4gfD0gbiA+Pj4gODtcbiAgICBuIHw9IG4gPj4+IDE2O1xuICAgIG4rKztcbiAgfVxuICByZXR1cm4gbjtcbn1cblxuLy8gVGhpcyBmdW5jdGlvbiBpcyBkZXNpZ25lZCB0byBiZSBpbmxpbmFibGUsIHNvIHBsZWFzZSB0YWtlIGNhcmUgd2hlbiBtYWtpbmdcbi8vIGNoYW5nZXMgdG8gdGhlIGZ1bmN0aW9uIGJvZHkuXG5mdW5jdGlvbiBob3dNdWNoVG9SZWFkKG4sIHN0YXRlKSB7XG4gIGlmIChuIDw9IDAgfHwgc3RhdGUubGVuZ3RoID09PSAwICYmIHN0YXRlLmVuZGVkKSByZXR1cm4gMDtcbiAgaWYgKHN0YXRlLm9iamVjdE1vZGUpIHJldHVybiAxO1xuICBpZiAobiAhPT0gbikge1xuICAgIC8vIE9ubHkgZmxvdyBvbmUgYnVmZmVyIGF0IGEgdGltZVxuICAgIGlmIChzdGF0ZS5mbG93aW5nICYmIHN0YXRlLmxlbmd0aCkgcmV0dXJuIHN0YXRlLmJ1ZmZlci5oZWFkLmRhdGEubGVuZ3RoO2Vsc2UgcmV0dXJuIHN0YXRlLmxlbmd0aDtcbiAgfVxuICAvLyBJZiB3ZSdyZSBhc2tpbmcgZm9yIG1vcmUgdGhhbiB0aGUgY3VycmVudCBod20sIHRoZW4gcmFpc2UgdGhlIGh3bS5cbiAgaWYgKG4gPiBzdGF0ZS5oaWdoV2F0ZXJNYXJrKSBzdGF0ZS5oaWdoV2F0ZXJNYXJrID0gY29tcHV0ZU5ld0hpZ2hXYXRlck1hcmsobik7XG4gIGlmIChuIDw9IHN0YXRlLmxlbmd0aCkgcmV0dXJuIG47XG4gIC8vIERvbid0IGhhdmUgZW5vdWdoXG4gIGlmICghc3RhdGUuZW5kZWQpIHtcbiAgICBzdGF0ZS5uZWVkUmVhZGFibGUgPSB0cnVlO1xuICAgIHJldHVybiAwO1xuICB9XG4gIHJldHVybiBzdGF0ZS5sZW5ndGg7XG59XG5cbi8vIHlvdSBjYW4gb3ZlcnJpZGUgZWl0aGVyIHRoaXMgbWV0aG9kLCBvciB0aGUgYXN5bmMgX3JlYWQobikgYmVsb3cuXG5SZWFkYWJsZS5wcm90b3R5cGUucmVhZCA9IGZ1bmN0aW9uIChuKSB7XG4gIGRlYnVnKCdyZWFkJywgbik7XG4gIG4gPSBwYXJzZUludChuLCAxMCk7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG4gIHZhciBuT3JpZyA9IG47XG5cbiAgaWYgKG4gIT09IDApIHN0YXRlLmVtaXR0ZWRSZWFkYWJsZSA9IGZhbHNlO1xuXG4gIC8vIGlmIHdlJ3JlIGRvaW5nIHJlYWQoMCkgdG8gdHJpZ2dlciBhIHJlYWRhYmxlIGV2ZW50LCBidXQgd2VcbiAgLy8gYWxyZWFkeSBoYXZlIGEgYnVuY2ggb2YgZGF0YSBpbiB0aGUgYnVmZmVyLCB0aGVuIGp1c3QgdHJpZ2dlclxuICAvLyB0aGUgJ3JlYWRhYmxlJyBldmVudCBhbmQgbW92ZSBvbi5cbiAgaWYgKG4gPT09IDAgJiYgc3RhdGUubmVlZFJlYWRhYmxlICYmIChzdGF0ZS5sZW5ndGggPj0gc3RhdGUuaGlnaFdhdGVyTWFyayB8fCBzdGF0ZS5lbmRlZCkpIHtcbiAgICBkZWJ1ZygncmVhZDogZW1pdFJlYWRhYmxlJywgc3RhdGUubGVuZ3RoLCBzdGF0ZS5lbmRlZCk7XG4gICAgaWYgKHN0YXRlLmxlbmd0aCA9PT0gMCAmJiBzdGF0ZS5lbmRlZCkgZW5kUmVhZGFibGUodGhpcyk7ZWxzZSBlbWl0UmVhZGFibGUodGhpcyk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBuID0gaG93TXVjaFRvUmVhZChuLCBzdGF0ZSk7XG5cbiAgLy8gaWYgd2UndmUgZW5kZWQsIGFuZCB3ZSdyZSBub3cgY2xlYXIsIHRoZW4gZmluaXNoIGl0IHVwLlxuICBpZiAobiA9PT0gMCAmJiBzdGF0ZS5lbmRlZCkge1xuICAgIGlmIChzdGF0ZS5sZW5ndGggPT09IDApIGVuZFJlYWRhYmxlKHRoaXMpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gQWxsIHRoZSBhY3R1YWwgY2h1bmsgZ2VuZXJhdGlvbiBsb2dpYyBuZWVkcyB0byBiZVxuICAvLyAqYmVsb3cqIHRoZSBjYWxsIHRvIF9yZWFkLiAgVGhlIHJlYXNvbiBpcyB0aGF0IGluIGNlcnRhaW5cbiAgLy8gc3ludGhldGljIHN0cmVhbSBjYXNlcywgc3VjaCBhcyBwYXNzdGhyb3VnaCBzdHJlYW1zLCBfcmVhZFxuICAvLyBtYXkgYmUgYSBjb21wbGV0ZWx5IHN5bmNocm9ub3VzIG9wZXJhdGlvbiB3aGljaCBtYXkgY2hhbmdlXG4gIC8vIHRoZSBzdGF0ZSBvZiB0aGUgcmVhZCBidWZmZXIsIHByb3ZpZGluZyBlbm91Z2ggZGF0YSB3aGVuXG4gIC8vIGJlZm9yZSB0aGVyZSB3YXMgKm5vdCogZW5vdWdoLlxuICAvL1xuICAvLyBTbywgdGhlIHN0ZXBzIGFyZTpcbiAgLy8gMS4gRmlndXJlIG91dCB3aGF0IHRoZSBzdGF0ZSBvZiB0aGluZ3Mgd2lsbCBiZSBhZnRlciB3ZSBkb1xuICAvLyBhIHJlYWQgZnJvbSB0aGUgYnVmZmVyLlxuICAvL1xuICAvLyAyLiBJZiB0aGF0IHJlc3VsdGluZyBzdGF0ZSB3aWxsIHRyaWdnZXIgYSBfcmVhZCwgdGhlbiBjYWxsIF9yZWFkLlxuICAvLyBOb3RlIHRoYXQgdGhpcyBtYXkgYmUgYXN5bmNocm9ub3VzLCBvciBzeW5jaHJvbm91cy4gIFllcywgaXQgaXNcbiAgLy8gZGVlcGx5IHVnbHkgdG8gd3JpdGUgQVBJcyB0aGlzIHdheSwgYnV0IHRoYXQgc3RpbGwgZG9lc24ndCBtZWFuXG4gIC8vIHRoYXQgdGhlIFJlYWRhYmxlIGNsYXNzIHNob3VsZCBiZWhhdmUgaW1wcm9wZXJseSwgYXMgc3RyZWFtcyBhcmVcbiAgLy8gZGVzaWduZWQgdG8gYmUgc3luYy9hc3luYyBhZ25vc3RpYy5cbiAgLy8gVGFrZSBub3RlIGlmIHRoZSBfcmVhZCBjYWxsIGlzIHN5bmMgb3IgYXN5bmMgKGllLCBpZiB0aGUgcmVhZCBjYWxsXG4gIC8vIGhhcyByZXR1cm5lZCB5ZXQpLCBzbyB0aGF0IHdlIGtub3cgd2hldGhlciBvciBub3QgaXQncyBzYWZlIHRvIGVtaXRcbiAgLy8gJ3JlYWRhYmxlJyBldGMuXG4gIC8vXG4gIC8vIDMuIEFjdHVhbGx5IHB1bGwgdGhlIHJlcXVlc3RlZCBjaHVua3Mgb3V0IG9mIHRoZSBidWZmZXIgYW5kIHJldHVybi5cblxuICAvLyBpZiB3ZSBuZWVkIGEgcmVhZGFibGUgZXZlbnQsIHRoZW4gd2UgbmVlZCB0byBkbyBzb21lIHJlYWRpbmcuXG4gIHZhciBkb1JlYWQgPSBzdGF0ZS5uZWVkUmVhZGFibGU7XG4gIGRlYnVnKCduZWVkIHJlYWRhYmxlJywgZG9SZWFkKTtcblxuICAvLyBpZiB3ZSBjdXJyZW50bHkgaGF2ZSBsZXNzIHRoYW4gdGhlIGhpZ2hXYXRlck1hcmssIHRoZW4gYWxzbyByZWFkIHNvbWVcbiAgaWYgKHN0YXRlLmxlbmd0aCA9PT0gMCB8fCBzdGF0ZS5sZW5ndGggLSBuIDwgc3RhdGUuaGlnaFdhdGVyTWFyaykge1xuICAgIGRvUmVhZCA9IHRydWU7XG4gICAgZGVidWcoJ2xlbmd0aCBsZXNzIHRoYW4gd2F0ZXJtYXJrJywgZG9SZWFkKTtcbiAgfVxuXG4gIC8vIGhvd2V2ZXIsIGlmIHdlJ3ZlIGVuZGVkLCB0aGVuIHRoZXJlJ3Mgbm8gcG9pbnQsIGFuZCBpZiB3ZSdyZSBhbHJlYWR5XG4gIC8vIHJlYWRpbmcsIHRoZW4gaXQncyB1bm5lY2Vzc2FyeS5cbiAgaWYgKHN0YXRlLmVuZGVkIHx8IHN0YXRlLnJlYWRpbmcpIHtcbiAgICBkb1JlYWQgPSBmYWxzZTtcbiAgICBkZWJ1ZygncmVhZGluZyBvciBlbmRlZCcsIGRvUmVhZCk7XG4gIH0gZWxzZSBpZiAoZG9SZWFkKSB7XG4gICAgZGVidWcoJ2RvIHJlYWQnKTtcbiAgICBzdGF0ZS5yZWFkaW5nID0gdHJ1ZTtcbiAgICBzdGF0ZS5zeW5jID0gdHJ1ZTtcbiAgICAvLyBpZiB0aGUgbGVuZ3RoIGlzIGN1cnJlbnRseSB6ZXJvLCB0aGVuIHdlICpuZWVkKiBhIHJlYWRhYmxlIGV2ZW50LlxuICAgIGlmIChzdGF0ZS5sZW5ndGggPT09IDApIHN0YXRlLm5lZWRSZWFkYWJsZSA9IHRydWU7XG4gICAgLy8gY2FsbCBpbnRlcm5hbCByZWFkIG1ldGhvZFxuICAgIHRoaXMuX3JlYWQoc3RhdGUuaGlnaFdhdGVyTWFyayk7XG4gICAgc3RhdGUuc3luYyA9IGZhbHNlO1xuICAgIC8vIElmIF9yZWFkIHB1c2hlZCBkYXRhIHN5bmNocm9ub3VzbHksIHRoZW4gYHJlYWRpbmdgIHdpbGwgYmUgZmFsc2UsXG4gICAgLy8gYW5kIHdlIG5lZWQgdG8gcmUtZXZhbHVhdGUgaG93IG11Y2ggZGF0YSB3ZSBjYW4gcmV0dXJuIHRvIHRoZSB1c2VyLlxuICAgIGlmICghc3RhdGUucmVhZGluZykgbiA9IGhvd011Y2hUb1JlYWQobk9yaWcsIHN0YXRlKTtcbiAgfVxuXG4gIHZhciByZXQ7XG4gIGlmIChuID4gMCkgcmV0ID0gZnJvbUxpc3Qobiwgc3RhdGUpO2Vsc2UgcmV0ID0gbnVsbDtcblxuICBpZiAocmV0ID09PSBudWxsKSB7XG4gICAgc3RhdGUubmVlZFJlYWRhYmxlID0gdHJ1ZTtcbiAgICBuID0gMDtcbiAgfSBlbHNlIHtcbiAgICBzdGF0ZS5sZW5ndGggLT0gbjtcbiAgfVxuXG4gIGlmIChzdGF0ZS5sZW5ndGggPT09IDApIHtcbiAgICAvLyBJZiB3ZSBoYXZlIG5vdGhpbmcgaW4gdGhlIGJ1ZmZlciwgdGhlbiB3ZSB3YW50IHRvIGtub3dcbiAgICAvLyBhcyBzb29uIGFzIHdlICpkbyogZ2V0IHNvbWV0aGluZyBpbnRvIHRoZSBidWZmZXIuXG4gICAgaWYgKCFzdGF0ZS5lbmRlZCkgc3RhdGUubmVlZFJlYWRhYmxlID0gdHJ1ZTtcblxuICAgIC8vIElmIHdlIHRyaWVkIHRvIHJlYWQoKSBwYXN0IHRoZSBFT0YsIHRoZW4gZW1pdCBlbmQgb24gdGhlIG5leHQgdGljay5cbiAgICBpZiAobk9yaWcgIT09IG4gJiYgc3RhdGUuZW5kZWQpIGVuZFJlYWRhYmxlKHRoaXMpO1xuICB9XG5cbiAgaWYgKHJldCAhPT0gbnVsbCkgdGhpcy5lbWl0KCdkYXRhJywgcmV0KTtcblxuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gY2h1bmtJbnZhbGlkKHN0YXRlLCBjaHVuaykge1xuICB2YXIgZXIgPSBudWxsO1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihjaHVuaykgJiYgdHlwZW9mIGNodW5rICE9PSAnc3RyaW5nJyAmJiBjaHVuayAhPT0gbnVsbCAmJiBjaHVuayAhPT0gdW5kZWZpbmVkICYmICFzdGF0ZS5vYmplY3RNb2RlKSB7XG4gICAgZXIgPSBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIG5vbi1zdHJpbmcvYnVmZmVyIGNodW5rJyk7XG4gIH1cbiAgcmV0dXJuIGVyO1xufVxuXG5mdW5jdGlvbiBvbkVvZkNodW5rKHN0cmVhbSwgc3RhdGUpIHtcbiAgaWYgKHN0YXRlLmVuZGVkKSByZXR1cm47XG4gIGlmIChzdGF0ZS5kZWNvZGVyKSB7XG4gICAgdmFyIGNodW5rID0gc3RhdGUuZGVjb2Rlci5lbmQoKTtcbiAgICBpZiAoY2h1bmsgJiYgY2h1bmsubGVuZ3RoKSB7XG4gICAgICBzdGF0ZS5idWZmZXIucHVzaChjaHVuayk7XG4gICAgICBzdGF0ZS5sZW5ndGggKz0gc3RhdGUub2JqZWN0TW9kZSA/IDEgOiBjaHVuay5sZW5ndGg7XG4gICAgfVxuICB9XG4gIHN0YXRlLmVuZGVkID0gdHJ1ZTtcblxuICAvLyBlbWl0ICdyZWFkYWJsZScgbm93IHRvIG1ha2Ugc3VyZSBpdCBnZXRzIHBpY2tlZCB1cC5cbiAgZW1pdFJlYWRhYmxlKHN0cmVhbSk7XG59XG5cbi8vIERvbid0IGVtaXQgcmVhZGFibGUgcmlnaHQgYXdheSBpbiBzeW5jIG1vZGUsIGJlY2F1c2UgdGhpcyBjYW4gdHJpZ2dlclxuLy8gYW5vdGhlciByZWFkKCkgY2FsbCA9PiBzdGFjayBvdmVyZmxvdy4gIFRoaXMgd2F5LCBpdCBtaWdodCB0cmlnZ2VyXG4vLyBhIG5leHRUaWNrIHJlY3Vyc2lvbiB3YXJuaW5nLCBidXQgdGhhdCdzIG5vdCBzbyBiYWQuXG5mdW5jdGlvbiBlbWl0UmVhZGFibGUoc3RyZWFtKSB7XG4gIHZhciBzdGF0ZSA9IHN0cmVhbS5fcmVhZGFibGVTdGF0ZTtcbiAgc3RhdGUubmVlZFJlYWRhYmxlID0gZmFsc2U7XG4gIGlmICghc3RhdGUuZW1pdHRlZFJlYWRhYmxlKSB7XG4gICAgZGVidWcoJ2VtaXRSZWFkYWJsZScsIHN0YXRlLmZsb3dpbmcpO1xuICAgIHN0YXRlLmVtaXR0ZWRSZWFkYWJsZSA9IHRydWU7XG4gICAgaWYgKHN0YXRlLnN5bmMpIHByb2Nlc3NOZXh0VGljayhlbWl0UmVhZGFibGVfLCBzdHJlYW0pO2Vsc2UgZW1pdFJlYWRhYmxlXyhzdHJlYW0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGVtaXRSZWFkYWJsZV8oc3RyZWFtKSB7XG4gIGRlYnVnKCdlbWl0IHJlYWRhYmxlJyk7XG4gIHN0cmVhbS5lbWl0KCdyZWFkYWJsZScpO1xuICBmbG93KHN0cmVhbSk7XG59XG5cbi8vIGF0IHRoaXMgcG9pbnQsIHRoZSB1c2VyIGhhcyBwcmVzdW1hYmx5IHNlZW4gdGhlICdyZWFkYWJsZScgZXZlbnQsXG4vLyBhbmQgY2FsbGVkIHJlYWQoKSB0byBjb25zdW1lIHNvbWUgZGF0YS4gIHRoYXQgbWF5IGhhdmUgdHJpZ2dlcmVkXG4vLyBpbiB0dXJuIGFub3RoZXIgX3JlYWQobikgY2FsbCwgaW4gd2hpY2ggY2FzZSByZWFkaW5nID0gdHJ1ZSBpZlxuLy8gaXQncyBpbiBwcm9ncmVzcy5cbi8vIEhvd2V2ZXIsIGlmIHdlJ3JlIG5vdCBlbmRlZCwgb3IgcmVhZGluZywgYW5kIHRoZSBsZW5ndGggPCBod20sXG4vLyB0aGVuIGdvIGFoZWFkIGFuZCB0cnkgdG8gcmVhZCBzb21lIG1vcmUgcHJlZW1wdGl2ZWx5LlxuZnVuY3Rpb24gbWF5YmVSZWFkTW9yZShzdHJlYW0sIHN0YXRlKSB7XG4gIGlmICghc3RhdGUucmVhZGluZ01vcmUpIHtcbiAgICBzdGF0ZS5yZWFkaW5nTW9yZSA9IHRydWU7XG4gICAgcHJvY2Vzc05leHRUaWNrKG1heWJlUmVhZE1vcmVfLCBzdHJlYW0sIHN0YXRlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXliZVJlYWRNb3JlXyhzdHJlYW0sIHN0YXRlKSB7XG4gIHZhciBsZW4gPSBzdGF0ZS5sZW5ndGg7XG4gIHdoaWxlICghc3RhdGUucmVhZGluZyAmJiAhc3RhdGUuZmxvd2luZyAmJiAhc3RhdGUuZW5kZWQgJiYgc3RhdGUubGVuZ3RoIDwgc3RhdGUuaGlnaFdhdGVyTWFyaykge1xuICAgIGRlYnVnKCdtYXliZVJlYWRNb3JlIHJlYWQgMCcpO1xuICAgIHN0cmVhbS5yZWFkKDApO1xuICAgIGlmIChsZW4gPT09IHN0YXRlLmxlbmd0aClcbiAgICAgIC8vIGRpZG4ndCBnZXQgYW55IGRhdGEsIHN0b3Agc3Bpbm5pbmcuXG4gICAgICBicmVhaztlbHNlIGxlbiA9IHN0YXRlLmxlbmd0aDtcbiAgfVxuICBzdGF0ZS5yZWFkaW5nTW9yZSA9IGZhbHNlO1xufVxuXG4vLyBhYnN0cmFjdCBtZXRob2QuICB0byBiZSBvdmVycmlkZGVuIGluIHNwZWNpZmljIGltcGxlbWVudGF0aW9uIGNsYXNzZXMuXG4vLyBjYWxsIGNiKGVyLCBkYXRhKSB3aGVyZSBkYXRhIGlzIDw9IG4gaW4gbGVuZ3RoLlxuLy8gZm9yIHZpcnR1YWwgKG5vbi1zdHJpbmcsIG5vbi1idWZmZXIpIHN0cmVhbXMsIFwibGVuZ3RoXCIgaXMgc29tZXdoYXRcbi8vIGFyYml0cmFyeSwgYW5kIHBlcmhhcHMgbm90IHZlcnkgbWVhbmluZ2Z1bC5cblJlYWRhYmxlLnByb3RvdHlwZS5fcmVhZCA9IGZ1bmN0aW9uIChuKSB7XG4gIHRoaXMuZW1pdCgnZXJyb3InLCBuZXcgRXJyb3IoJ19yZWFkKCkgaXMgbm90IGltcGxlbWVudGVkJykpO1xufTtcblxuUmVhZGFibGUucHJvdG90eXBlLnBpcGUgPSBmdW5jdGlvbiAoZGVzdCwgcGlwZU9wdHMpIHtcbiAgdmFyIHNyYyA9IHRoaXM7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG5cbiAgc3dpdGNoIChzdGF0ZS5waXBlc0NvdW50KSB7XG4gICAgY2FzZSAwOlxuICAgICAgc3RhdGUucGlwZXMgPSBkZXN0O1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAxOlxuICAgICAgc3RhdGUucGlwZXMgPSBbc3RhdGUucGlwZXMsIGRlc3RdO1xuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIHN0YXRlLnBpcGVzLnB1c2goZGVzdCk7XG4gICAgICBicmVhaztcbiAgfVxuICBzdGF0ZS5waXBlc0NvdW50ICs9IDE7XG4gIGRlYnVnKCdwaXBlIGNvdW50PSVkIG9wdHM9JWonLCBzdGF0ZS5waXBlc0NvdW50LCBwaXBlT3B0cyk7XG5cbiAgdmFyIGRvRW5kID0gKCFwaXBlT3B0cyB8fCBwaXBlT3B0cy5lbmQgIT09IGZhbHNlKSAmJiBkZXN0ICE9PSBwcm9jZXNzLnN0ZG91dCAmJiBkZXN0ICE9PSBwcm9jZXNzLnN0ZGVycjtcblxuICB2YXIgZW5kRm4gPSBkb0VuZCA/IG9uZW5kIDogY2xlYW51cDtcbiAgaWYgKHN0YXRlLmVuZEVtaXR0ZWQpIHByb2Nlc3NOZXh0VGljayhlbmRGbik7ZWxzZSBzcmMub25jZSgnZW5kJywgZW5kRm4pO1xuXG4gIGRlc3Qub24oJ3VucGlwZScsIG9udW5waXBlKTtcbiAgZnVuY3Rpb24gb251bnBpcGUocmVhZGFibGUpIHtcbiAgICBkZWJ1Zygnb251bnBpcGUnKTtcbiAgICBpZiAocmVhZGFibGUgPT09IHNyYykge1xuICAgICAgY2xlYW51cCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIG9uZW5kKCkge1xuICAgIGRlYnVnKCdvbmVuZCcpO1xuICAgIGRlc3QuZW5kKCk7XG4gIH1cblxuICAvLyB3aGVuIHRoZSBkZXN0IGRyYWlucywgaXQgcmVkdWNlcyB0aGUgYXdhaXREcmFpbiBjb3VudGVyXG4gIC8vIG9uIHRoZSBzb3VyY2UuICBUaGlzIHdvdWxkIGJlIG1vcmUgZWxlZ2FudCB3aXRoIGEgLm9uY2UoKVxuICAvLyBoYW5kbGVyIGluIGZsb3coKSwgYnV0IGFkZGluZyBhbmQgcmVtb3ZpbmcgcmVwZWF0ZWRseSBpc1xuICAvLyB0b28gc2xvdy5cbiAgdmFyIG9uZHJhaW4gPSBwaXBlT25EcmFpbihzcmMpO1xuICBkZXN0Lm9uKCdkcmFpbicsIG9uZHJhaW4pO1xuXG4gIHZhciBjbGVhbmVkVXAgPSBmYWxzZTtcbiAgZnVuY3Rpb24gY2xlYW51cCgpIHtcbiAgICBkZWJ1ZygnY2xlYW51cCcpO1xuICAgIC8vIGNsZWFudXAgZXZlbnQgaGFuZGxlcnMgb25jZSB0aGUgcGlwZSBpcyBicm9rZW5cbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdjbG9zZScsIG9uY2xvc2UpO1xuICAgIGRlc3QucmVtb3ZlTGlzdGVuZXIoJ2ZpbmlzaCcsIG9uZmluaXNoKTtcbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdkcmFpbicsIG9uZHJhaW4pO1xuICAgIGRlc3QucmVtb3ZlTGlzdGVuZXIoJ2Vycm9yJywgb25lcnJvcik7XG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcigndW5waXBlJywgb251bnBpcGUpO1xuICAgIHNyYy5yZW1vdmVMaXN0ZW5lcignZW5kJywgb25lbmQpO1xuICAgIHNyYy5yZW1vdmVMaXN0ZW5lcignZW5kJywgY2xlYW51cCk7XG4gICAgc3JjLnJlbW92ZUxpc3RlbmVyKCdkYXRhJywgb25kYXRhKTtcblxuICAgIGNsZWFuZWRVcCA9IHRydWU7XG5cbiAgICAvLyBpZiB0aGUgcmVhZGVyIGlzIHdhaXRpbmcgZm9yIGEgZHJhaW4gZXZlbnQgZnJvbSB0aGlzXG4gICAgLy8gc3BlY2lmaWMgd3JpdGVyLCB0aGVuIGl0IHdvdWxkIGNhdXNlIGl0IHRvIG5ldmVyIHN0YXJ0XG4gICAgLy8gZmxvd2luZyBhZ2Fpbi5cbiAgICAvLyBTbywgaWYgdGhpcyBpcyBhd2FpdGluZyBhIGRyYWluLCB0aGVuIHdlIGp1c3QgY2FsbCBpdCBub3cuXG4gICAgLy8gSWYgd2UgZG9uJ3Qga25vdywgdGhlbiBhc3N1bWUgdGhhdCB3ZSBhcmUgd2FpdGluZyBmb3Igb25lLlxuICAgIGlmIChzdGF0ZS5hd2FpdERyYWluICYmICghZGVzdC5fd3JpdGFibGVTdGF0ZSB8fCBkZXN0Ll93cml0YWJsZVN0YXRlLm5lZWREcmFpbikpIG9uZHJhaW4oKTtcbiAgfVxuXG4gIC8vIElmIHRoZSB1c2VyIHB1c2hlcyBtb3JlIGRhdGEgd2hpbGUgd2UncmUgd3JpdGluZyB0byBkZXN0IHRoZW4gd2UnbGwgZW5kIHVwXG4gIC8vIGluIG9uZGF0YSBhZ2Fpbi4gSG93ZXZlciwgd2Ugb25seSB3YW50IHRvIGluY3JlYXNlIGF3YWl0RHJhaW4gb25jZSBiZWNhdXNlXG4gIC8vIGRlc3Qgd2lsbCBvbmx5IGVtaXQgb25lICdkcmFpbicgZXZlbnQgZm9yIHRoZSBtdWx0aXBsZSB3cml0ZXMuXG4gIC8vID0+IEludHJvZHVjZSBhIGd1YXJkIG9uIGluY3JlYXNpbmcgYXdhaXREcmFpbi5cbiAgdmFyIGluY3JlYXNlZEF3YWl0RHJhaW4gPSBmYWxzZTtcbiAgc3JjLm9uKCdkYXRhJywgb25kYXRhKTtcbiAgZnVuY3Rpb24gb25kYXRhKGNodW5rKSB7XG4gICAgZGVidWcoJ29uZGF0YScpO1xuICAgIGluY3JlYXNlZEF3YWl0RHJhaW4gPSBmYWxzZTtcbiAgICB2YXIgcmV0ID0gZGVzdC53cml0ZShjaHVuayk7XG4gICAgaWYgKGZhbHNlID09PSByZXQgJiYgIWluY3JlYXNlZEF3YWl0RHJhaW4pIHtcbiAgICAgIC8vIElmIHRoZSB1c2VyIHVucGlwZWQgZHVyaW5nIGBkZXN0LndyaXRlKClgLCBpdCBpcyBwb3NzaWJsZVxuICAgICAgLy8gdG8gZ2V0IHN0dWNrIGluIGEgcGVybWFuZW50bHkgcGF1c2VkIHN0YXRlIGlmIHRoYXQgd3JpdGVcbiAgICAgIC8vIGFsc28gcmV0dXJuZWQgZmFsc2UuXG4gICAgICAvLyA9PiBDaGVjayB3aGV0aGVyIGBkZXN0YCBpcyBzdGlsbCBhIHBpcGluZyBkZXN0aW5hdGlvbi5cbiAgICAgIGlmICgoc3RhdGUucGlwZXNDb3VudCA9PT0gMSAmJiBzdGF0ZS5waXBlcyA9PT0gZGVzdCB8fCBzdGF0ZS5waXBlc0NvdW50ID4gMSAmJiBpbmRleE9mKHN0YXRlLnBpcGVzLCBkZXN0KSAhPT0gLTEpICYmICFjbGVhbmVkVXApIHtcbiAgICAgICAgZGVidWcoJ2ZhbHNlIHdyaXRlIHJlc3BvbnNlLCBwYXVzZScsIHNyYy5fcmVhZGFibGVTdGF0ZS5hd2FpdERyYWluKTtcbiAgICAgICAgc3JjLl9yZWFkYWJsZVN0YXRlLmF3YWl0RHJhaW4rKztcbiAgICAgICAgaW5jcmVhc2VkQXdhaXREcmFpbiA9IHRydWU7XG4gICAgICB9XG4gICAgICBzcmMucGF1c2UoKTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiB0aGUgZGVzdCBoYXMgYW4gZXJyb3IsIHRoZW4gc3RvcCBwaXBpbmcgaW50byBpdC5cbiAgLy8gaG93ZXZlciwgZG9uJ3Qgc3VwcHJlc3MgdGhlIHRocm93aW5nIGJlaGF2aW9yIGZvciB0aGlzLlxuICBmdW5jdGlvbiBvbmVycm9yKGVyKSB7XG4gICAgZGVidWcoJ29uZXJyb3InLCBlcik7XG4gICAgdW5waXBlKCk7XG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignZXJyb3InLCBvbmVycm9yKTtcbiAgICBpZiAoRUVsaXN0ZW5lckNvdW50KGRlc3QsICdlcnJvcicpID09PSAwKSBkZXN0LmVtaXQoJ2Vycm9yJywgZXIpO1xuICB9XG5cbiAgLy8gTWFrZSBzdXJlIG91ciBlcnJvciBoYW5kbGVyIGlzIGF0dGFjaGVkIGJlZm9yZSB1c2VybGFuZCBvbmVzLlxuICBwcmVwZW5kTGlzdGVuZXIoZGVzdCwgJ2Vycm9yJywgb25lcnJvcik7XG5cbiAgLy8gQm90aCBjbG9zZSBhbmQgZmluaXNoIHNob3VsZCB0cmlnZ2VyIHVucGlwZSwgYnV0IG9ubHkgb25jZS5cbiAgZnVuY3Rpb24gb25jbG9zZSgpIHtcbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdmaW5pc2gnLCBvbmZpbmlzaCk7XG4gICAgdW5waXBlKCk7XG4gIH1cbiAgZGVzdC5vbmNlKCdjbG9zZScsIG9uY2xvc2UpO1xuICBmdW5jdGlvbiBvbmZpbmlzaCgpIHtcbiAgICBkZWJ1Zygnb25maW5pc2gnKTtcbiAgICBkZXN0LnJlbW92ZUxpc3RlbmVyKCdjbG9zZScsIG9uY2xvc2UpO1xuICAgIHVucGlwZSgpO1xuICB9XG4gIGRlc3Qub25jZSgnZmluaXNoJywgb25maW5pc2gpO1xuXG4gIGZ1bmN0aW9uIHVucGlwZSgpIHtcbiAgICBkZWJ1ZygndW5waXBlJyk7XG4gICAgc3JjLnVucGlwZShkZXN0KTtcbiAgfVxuXG4gIC8vIHRlbGwgdGhlIGRlc3QgdGhhdCBpdCdzIGJlaW5nIHBpcGVkIHRvXG4gIGRlc3QuZW1pdCgncGlwZScsIHNyYyk7XG5cbiAgLy8gc3RhcnQgdGhlIGZsb3cgaWYgaXQgaGFzbid0IGJlZW4gc3RhcnRlZCBhbHJlYWR5LlxuICBpZiAoIXN0YXRlLmZsb3dpbmcpIHtcbiAgICBkZWJ1ZygncGlwZSByZXN1bWUnKTtcbiAgICBzcmMucmVzdW1lKCk7XG4gIH1cblxuICByZXR1cm4gZGVzdDtcbn07XG5cbmZ1bmN0aW9uIHBpcGVPbkRyYWluKHNyYykge1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzdGF0ZSA9IHNyYy5fcmVhZGFibGVTdGF0ZTtcbiAgICBkZWJ1ZygncGlwZU9uRHJhaW4nLCBzdGF0ZS5hd2FpdERyYWluKTtcbiAgICBpZiAoc3RhdGUuYXdhaXREcmFpbikgc3RhdGUuYXdhaXREcmFpbi0tO1xuICAgIGlmIChzdGF0ZS5hd2FpdERyYWluID09PSAwICYmIEVFbGlzdGVuZXJDb3VudChzcmMsICdkYXRhJykpIHtcbiAgICAgIHN0YXRlLmZsb3dpbmcgPSB0cnVlO1xuICAgICAgZmxvdyhzcmMpO1xuICAgIH1cbiAgfTtcbn1cblxuUmVhZGFibGUucHJvdG90eXBlLnVucGlwZSA9IGZ1bmN0aW9uIChkZXN0KSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG5cbiAgLy8gaWYgd2UncmUgbm90IHBpcGluZyBhbnl3aGVyZSwgdGhlbiBkbyBub3RoaW5nLlxuICBpZiAoc3RhdGUucGlwZXNDb3VudCA9PT0gMCkgcmV0dXJuIHRoaXM7XG5cbiAgLy8ganVzdCBvbmUgZGVzdGluYXRpb24uICBtb3N0IGNvbW1vbiBjYXNlLlxuICBpZiAoc3RhdGUucGlwZXNDb3VudCA9PT0gMSkge1xuICAgIC8vIHBhc3NlZCBpbiBvbmUsIGJ1dCBpdCdzIG5vdCB0aGUgcmlnaHQgb25lLlxuICAgIGlmIChkZXN0ICYmIGRlc3QgIT09IHN0YXRlLnBpcGVzKSByZXR1cm4gdGhpcztcblxuICAgIGlmICghZGVzdCkgZGVzdCA9IHN0YXRlLnBpcGVzO1xuXG4gICAgLy8gZ290IGEgbWF0Y2guXG4gICAgc3RhdGUucGlwZXMgPSBudWxsO1xuICAgIHN0YXRlLnBpcGVzQ291bnQgPSAwO1xuICAgIHN0YXRlLmZsb3dpbmcgPSBmYWxzZTtcbiAgICBpZiAoZGVzdCkgZGVzdC5lbWl0KCd1bnBpcGUnLCB0aGlzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIHNsb3cgY2FzZS4gbXVsdGlwbGUgcGlwZSBkZXN0aW5hdGlvbnMuXG5cbiAgaWYgKCFkZXN0KSB7XG4gICAgLy8gcmVtb3ZlIGFsbC5cbiAgICB2YXIgZGVzdHMgPSBzdGF0ZS5waXBlcztcbiAgICB2YXIgbGVuID0gc3RhdGUucGlwZXNDb3VudDtcbiAgICBzdGF0ZS5waXBlcyA9IG51bGw7XG4gICAgc3RhdGUucGlwZXNDb3VudCA9IDA7XG4gICAgc3RhdGUuZmxvd2luZyA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgZGVzdHNbaV0uZW1pdCgndW5waXBlJywgdGhpcyk7XG4gICAgfXJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gdHJ5IHRvIGZpbmQgdGhlIHJpZ2h0IG9uZS5cbiAgdmFyIGluZGV4ID0gaW5kZXhPZihzdGF0ZS5waXBlcywgZGVzdCk7XG4gIGlmIChpbmRleCA9PT0gLTEpIHJldHVybiB0aGlzO1xuXG4gIHN0YXRlLnBpcGVzLnNwbGljZShpbmRleCwgMSk7XG4gIHN0YXRlLnBpcGVzQ291bnQgLT0gMTtcbiAgaWYgKHN0YXRlLnBpcGVzQ291bnQgPT09IDEpIHN0YXRlLnBpcGVzID0gc3RhdGUucGlwZXNbMF07XG5cbiAgZGVzdC5lbWl0KCd1bnBpcGUnLCB0aGlzKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIHNldCB1cCBkYXRhIGV2ZW50cyBpZiB0aGV5IGFyZSBhc2tlZCBmb3Jcbi8vIEVuc3VyZSByZWFkYWJsZSBsaXN0ZW5lcnMgZXZlbnR1YWxseSBnZXQgc29tZXRoaW5nXG5SZWFkYWJsZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbiAoZXYsIGZuKSB7XG4gIHZhciByZXMgPSBTdHJlYW0ucHJvdG90eXBlLm9uLmNhbGwodGhpcywgZXYsIGZuKTtcblxuICBpZiAoZXYgPT09ICdkYXRhJykge1xuICAgIC8vIFN0YXJ0IGZsb3dpbmcgb24gbmV4dCB0aWNrIGlmIHN0cmVhbSBpc24ndCBleHBsaWNpdGx5IHBhdXNlZFxuICAgIGlmICh0aGlzLl9yZWFkYWJsZVN0YXRlLmZsb3dpbmcgIT09IGZhbHNlKSB0aGlzLnJlc3VtZSgpO1xuICB9IGVsc2UgaWYgKGV2ID09PSAncmVhZGFibGUnKSB7XG4gICAgdmFyIHN0YXRlID0gdGhpcy5fcmVhZGFibGVTdGF0ZTtcbiAgICBpZiAoIXN0YXRlLmVuZEVtaXR0ZWQgJiYgIXN0YXRlLnJlYWRhYmxlTGlzdGVuaW5nKSB7XG4gICAgICBzdGF0ZS5yZWFkYWJsZUxpc3RlbmluZyA9IHN0YXRlLm5lZWRSZWFkYWJsZSA9IHRydWU7XG4gICAgICBzdGF0ZS5lbWl0dGVkUmVhZGFibGUgPSBmYWxzZTtcbiAgICAgIGlmICghc3RhdGUucmVhZGluZykge1xuICAgICAgICBwcm9jZXNzTmV4dFRpY2soblJlYWRpbmdOZXh0VGljaywgdGhpcyk7XG4gICAgICB9IGVsc2UgaWYgKHN0YXRlLmxlbmd0aCkge1xuICAgICAgICBlbWl0UmVhZGFibGUodGhpcywgc3RhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXM7XG59O1xuUmVhZGFibGUucHJvdG90eXBlLmFkZExpc3RlbmVyID0gUmVhZGFibGUucHJvdG90eXBlLm9uO1xuXG5mdW5jdGlvbiBuUmVhZGluZ05leHRUaWNrKHNlbGYpIHtcbiAgZGVidWcoJ3JlYWRhYmxlIG5leHR0aWNrIHJlYWQgMCcpO1xuICBzZWxmLnJlYWQoMCk7XG59XG5cbi8vIHBhdXNlKCkgYW5kIHJlc3VtZSgpIGFyZSByZW1uYW50cyBvZiB0aGUgbGVnYWN5IHJlYWRhYmxlIHN0cmVhbSBBUElcbi8vIElmIHRoZSB1c2VyIHVzZXMgdGhlbSwgdGhlbiBzd2l0Y2ggaW50byBvbGQgbW9kZS5cblJlYWRhYmxlLnByb3RvdHlwZS5yZXN1bWUgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3JlYWRhYmxlU3RhdGU7XG4gIGlmICghc3RhdGUuZmxvd2luZykge1xuICAgIGRlYnVnKCdyZXN1bWUnKTtcbiAgICBzdGF0ZS5mbG93aW5nID0gdHJ1ZTtcbiAgICByZXN1bWUodGhpcywgc3RhdGUpO1xuICB9XG4gIHJldHVybiB0aGlzO1xufTtcblxuZnVuY3Rpb24gcmVzdW1lKHN0cmVhbSwgc3RhdGUpIHtcbiAgaWYgKCFzdGF0ZS5yZXN1bWVTY2hlZHVsZWQpIHtcbiAgICBzdGF0ZS5yZXN1bWVTY2hlZHVsZWQgPSB0cnVlO1xuICAgIHByb2Nlc3NOZXh0VGljayhyZXN1bWVfLCBzdHJlYW0sIHN0YXRlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZXN1bWVfKHN0cmVhbSwgc3RhdGUpIHtcbiAgaWYgKCFzdGF0ZS5yZWFkaW5nKSB7XG4gICAgZGVidWcoJ3Jlc3VtZSByZWFkIDAnKTtcbiAgICBzdHJlYW0ucmVhZCgwKTtcbiAgfVxuXG4gIHN0YXRlLnJlc3VtZVNjaGVkdWxlZCA9IGZhbHNlO1xuICBzdGF0ZS5hd2FpdERyYWluID0gMDtcbiAgc3RyZWFtLmVtaXQoJ3Jlc3VtZScpO1xuICBmbG93KHN0cmVhbSk7XG4gIGlmIChzdGF0ZS5mbG93aW5nICYmICFzdGF0ZS5yZWFkaW5nKSBzdHJlYW0ucmVhZCgwKTtcbn1cblxuUmVhZGFibGUucHJvdG90eXBlLnBhdXNlID0gZnVuY3Rpb24gKCkge1xuICBkZWJ1ZygnY2FsbCBwYXVzZSBmbG93aW5nPSVqJywgdGhpcy5fcmVhZGFibGVTdGF0ZS5mbG93aW5nKTtcbiAgaWYgKGZhbHNlICE9PSB0aGlzLl9yZWFkYWJsZVN0YXRlLmZsb3dpbmcpIHtcbiAgICBkZWJ1ZygncGF1c2UnKTtcbiAgICB0aGlzLl9yZWFkYWJsZVN0YXRlLmZsb3dpbmcgPSBmYWxzZTtcbiAgICB0aGlzLmVtaXQoJ3BhdXNlJyk7XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5mdW5jdGlvbiBmbG93KHN0cmVhbSkge1xuICB2YXIgc3RhdGUgPSBzdHJlYW0uX3JlYWRhYmxlU3RhdGU7XG4gIGRlYnVnKCdmbG93Jywgc3RhdGUuZmxvd2luZyk7XG4gIHdoaWxlIChzdGF0ZS5mbG93aW5nICYmIHN0cmVhbS5yZWFkKCkgIT09IG51bGwpIHt9XG59XG5cbi8vIHdyYXAgYW4gb2xkLXN0eWxlIHN0cmVhbSBhcyB0aGUgYXN5bmMgZGF0YSBzb3VyY2UuXG4vLyBUaGlzIGlzICpub3QqIHBhcnQgb2YgdGhlIHJlYWRhYmxlIHN0cmVhbSBpbnRlcmZhY2UuXG4vLyBJdCBpcyBhbiB1Z2x5IHVuZm9ydHVuYXRlIG1lc3Mgb2YgaGlzdG9yeS5cblJlYWRhYmxlLnByb3RvdHlwZS53cmFwID0gZnVuY3Rpb24gKHN0cmVhbSkge1xuICB2YXIgc3RhdGUgPSB0aGlzLl9yZWFkYWJsZVN0YXRlO1xuICB2YXIgcGF1c2VkID0gZmFsc2U7XG5cbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzdHJlYW0ub24oJ2VuZCcsIGZ1bmN0aW9uICgpIHtcbiAgICBkZWJ1Zygnd3JhcHBlZCBlbmQnKTtcbiAgICBpZiAoc3RhdGUuZGVjb2RlciAmJiAhc3RhdGUuZW5kZWQpIHtcbiAgICAgIHZhciBjaHVuayA9IHN0YXRlLmRlY29kZXIuZW5kKCk7XG4gICAgICBpZiAoY2h1bmsgJiYgY2h1bmsubGVuZ3RoKSBzZWxmLnB1c2goY2h1bmspO1xuICAgIH1cblxuICAgIHNlbGYucHVzaChudWxsKTtcbiAgfSk7XG5cbiAgc3RyZWFtLm9uKCdkYXRhJywgZnVuY3Rpb24gKGNodW5rKSB7XG4gICAgZGVidWcoJ3dyYXBwZWQgZGF0YScpO1xuICAgIGlmIChzdGF0ZS5kZWNvZGVyKSBjaHVuayA9IHN0YXRlLmRlY29kZXIud3JpdGUoY2h1bmspO1xuXG4gICAgLy8gZG9uJ3Qgc2tpcCBvdmVyIGZhbHN5IHZhbHVlcyBpbiBvYmplY3RNb2RlXG4gICAgaWYgKHN0YXRlLm9iamVjdE1vZGUgJiYgKGNodW5rID09PSBudWxsIHx8IGNodW5rID09PSB1bmRlZmluZWQpKSByZXR1cm47ZWxzZSBpZiAoIXN0YXRlLm9iamVjdE1vZGUgJiYgKCFjaHVuayB8fCAhY2h1bmsubGVuZ3RoKSkgcmV0dXJuO1xuXG4gICAgdmFyIHJldCA9IHNlbGYucHVzaChjaHVuayk7XG4gICAgaWYgKCFyZXQpIHtcbiAgICAgIHBhdXNlZCA9IHRydWU7XG4gICAgICBzdHJlYW0ucGF1c2UoKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIHByb3h5IGFsbCB0aGUgb3RoZXIgbWV0aG9kcy5cbiAgLy8gaW1wb3J0YW50IHdoZW4gd3JhcHBpbmcgZmlsdGVycyBhbmQgZHVwbGV4ZXMuXG4gIGZvciAodmFyIGkgaW4gc3RyZWFtKSB7XG4gICAgaWYgKHRoaXNbaV0gPT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygc3RyZWFtW2ldID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzW2ldID0gZnVuY3Rpb24gKG1ldGhvZCkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgIHJldHVybiBzdHJlYW1bbWV0aG9kXS5hcHBseShzdHJlYW0sIGFyZ3VtZW50cyk7XG4gICAgICAgIH07XG4gICAgICB9KGkpO1xuICAgIH1cbiAgfVxuXG4gIC8vIHByb3h5IGNlcnRhaW4gaW1wb3J0YW50IGV2ZW50cy5cbiAgdmFyIGV2ZW50cyA9IFsnZXJyb3InLCAnY2xvc2UnLCAnZGVzdHJveScsICdwYXVzZScsICdyZXN1bWUnXTtcbiAgZm9yRWFjaChldmVudHMsIGZ1bmN0aW9uIChldikge1xuICAgIHN0cmVhbS5vbihldiwgc2VsZi5lbWl0LmJpbmQoc2VsZiwgZXYpKTtcbiAgfSk7XG5cbiAgLy8gd2hlbiB3ZSB0cnkgdG8gY29uc3VtZSBzb21lIG1vcmUgYnl0ZXMsIHNpbXBseSB1bnBhdXNlIHRoZVxuICAvLyB1bmRlcmx5aW5nIHN0cmVhbS5cbiAgc2VsZi5fcmVhZCA9IGZ1bmN0aW9uIChuKSB7XG4gICAgZGVidWcoJ3dyYXBwZWQgX3JlYWQnLCBuKTtcbiAgICBpZiAocGF1c2VkKSB7XG4gICAgICBwYXVzZWQgPSBmYWxzZTtcbiAgICAgIHN0cmVhbS5yZXN1bWUoKTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIHNlbGY7XG59O1xuXG4vLyBleHBvc2VkIGZvciB0ZXN0aW5nIHB1cnBvc2VzIG9ubHkuXG5SZWFkYWJsZS5fZnJvbUxpc3QgPSBmcm9tTGlzdDtcblxuLy8gUGx1Y2sgb2ZmIG4gYnl0ZXMgZnJvbSBhbiBhcnJheSBvZiBidWZmZXJzLlxuLy8gTGVuZ3RoIGlzIHRoZSBjb21iaW5lZCBsZW5ndGhzIG9mIGFsbCB0aGUgYnVmZmVycyBpbiB0aGUgbGlzdC5cbi8vIFRoaXMgZnVuY3Rpb24gaXMgZGVzaWduZWQgdG8gYmUgaW5saW5hYmxlLCBzbyBwbGVhc2UgdGFrZSBjYXJlIHdoZW4gbWFraW5nXG4vLyBjaGFuZ2VzIHRvIHRoZSBmdW5jdGlvbiBib2R5LlxuZnVuY3Rpb24gZnJvbUxpc3Qobiwgc3RhdGUpIHtcbiAgLy8gbm90aGluZyBidWZmZXJlZFxuICBpZiAoc3RhdGUubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICB2YXIgcmV0O1xuICBpZiAoc3RhdGUub2JqZWN0TW9kZSkgcmV0ID0gc3RhdGUuYnVmZmVyLnNoaWZ0KCk7ZWxzZSBpZiAoIW4gfHwgbiA+PSBzdGF0ZS5sZW5ndGgpIHtcbiAgICAvLyByZWFkIGl0IGFsbCwgdHJ1bmNhdGUgdGhlIGxpc3RcbiAgICBpZiAoc3RhdGUuZGVjb2RlcikgcmV0ID0gc3RhdGUuYnVmZmVyLmpvaW4oJycpO2Vsc2UgaWYgKHN0YXRlLmJ1ZmZlci5sZW5ndGggPT09IDEpIHJldCA9IHN0YXRlLmJ1ZmZlci5oZWFkLmRhdGE7ZWxzZSByZXQgPSBzdGF0ZS5idWZmZXIuY29uY2F0KHN0YXRlLmxlbmd0aCk7XG4gICAgc3RhdGUuYnVmZmVyLmNsZWFyKCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gcmVhZCBwYXJ0IG9mIGxpc3RcbiAgICByZXQgPSBmcm9tTGlzdFBhcnRpYWwobiwgc3RhdGUuYnVmZmVyLCBzdGF0ZS5kZWNvZGVyKTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbi8vIEV4dHJhY3RzIG9ubHkgZW5vdWdoIGJ1ZmZlcmVkIGRhdGEgdG8gc2F0aXNmeSB0aGUgYW1vdW50IHJlcXVlc3RlZC5cbi8vIFRoaXMgZnVuY3Rpb24gaXMgZGVzaWduZWQgdG8gYmUgaW5saW5hYmxlLCBzbyBwbGVhc2UgdGFrZSBjYXJlIHdoZW4gbWFraW5nXG4vLyBjaGFuZ2VzIHRvIHRoZSBmdW5jdGlvbiBib2R5LlxuZnVuY3Rpb24gZnJvbUxpc3RQYXJ0aWFsKG4sIGxpc3QsIGhhc1N0cmluZ3MpIHtcbiAgdmFyIHJldDtcbiAgaWYgKG4gPCBsaXN0LmhlYWQuZGF0YS5sZW5ndGgpIHtcbiAgICAvLyBzbGljZSBpcyB0aGUgc2FtZSBmb3IgYnVmZmVycyBhbmQgc3RyaW5nc1xuICAgIHJldCA9IGxpc3QuaGVhZC5kYXRhLnNsaWNlKDAsIG4pO1xuICAgIGxpc3QuaGVhZC5kYXRhID0gbGlzdC5oZWFkLmRhdGEuc2xpY2Uobik7XG4gIH0gZWxzZSBpZiAobiA9PT0gbGlzdC5oZWFkLmRhdGEubGVuZ3RoKSB7XG4gICAgLy8gZmlyc3QgY2h1bmsgaXMgYSBwZXJmZWN0IG1hdGNoXG4gICAgcmV0ID0gbGlzdC5zaGlmdCgpO1xuICB9IGVsc2Uge1xuICAgIC8vIHJlc3VsdCBzcGFucyBtb3JlIHRoYW4gb25lIGJ1ZmZlclxuICAgIHJldCA9IGhhc1N0cmluZ3MgPyBjb3B5RnJvbUJ1ZmZlclN0cmluZyhuLCBsaXN0KSA6IGNvcHlGcm9tQnVmZmVyKG4sIGxpc3QpO1xuICB9XG4gIHJldHVybiByZXQ7XG59XG5cbi8vIENvcGllcyBhIHNwZWNpZmllZCBhbW91bnQgb2YgY2hhcmFjdGVycyBmcm9tIHRoZSBsaXN0IG9mIGJ1ZmZlcmVkIGRhdGFcbi8vIGNodW5rcy5cbi8vIFRoaXMgZnVuY3Rpb24gaXMgZGVzaWduZWQgdG8gYmUgaW5saW5hYmxlLCBzbyBwbGVhc2UgdGFrZSBjYXJlIHdoZW4gbWFraW5nXG4vLyBjaGFuZ2VzIHRvIHRoZSBmdW5jdGlvbiBib2R5LlxuZnVuY3Rpb24gY29weUZyb21CdWZmZXJTdHJpbmcobiwgbGlzdCkge1xuICB2YXIgcCA9IGxpc3QuaGVhZDtcbiAgdmFyIGMgPSAxO1xuICB2YXIgcmV0ID0gcC5kYXRhO1xuICBuIC09IHJldC5sZW5ndGg7XG4gIHdoaWxlIChwID0gcC5uZXh0KSB7XG4gICAgdmFyIHN0ciA9IHAuZGF0YTtcbiAgICB2YXIgbmIgPSBuID4gc3RyLmxlbmd0aCA/IHN0ci5sZW5ndGggOiBuO1xuICAgIGlmIChuYiA9PT0gc3RyLmxlbmd0aCkgcmV0ICs9IHN0cjtlbHNlIHJldCArPSBzdHIuc2xpY2UoMCwgbik7XG4gICAgbiAtPSBuYjtcbiAgICBpZiAobiA9PT0gMCkge1xuICAgICAgaWYgKG5iID09PSBzdHIubGVuZ3RoKSB7XG4gICAgICAgICsrYztcbiAgICAgICAgaWYgKHAubmV4dCkgbGlzdC5oZWFkID0gcC5uZXh0O2Vsc2UgbGlzdC5oZWFkID0gbGlzdC50YWlsID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxpc3QuaGVhZCA9IHA7XG4gICAgICAgIHAuZGF0YSA9IHN0ci5zbGljZShuYik7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgKytjO1xuICB9XG4gIGxpc3QubGVuZ3RoIC09IGM7XG4gIHJldHVybiByZXQ7XG59XG5cbi8vIENvcGllcyBhIHNwZWNpZmllZCBhbW91bnQgb2YgYnl0ZXMgZnJvbSB0aGUgbGlzdCBvZiBidWZmZXJlZCBkYXRhIGNodW5rcy5cbi8vIFRoaXMgZnVuY3Rpb24gaXMgZGVzaWduZWQgdG8gYmUgaW5saW5hYmxlLCBzbyBwbGVhc2UgdGFrZSBjYXJlIHdoZW4gbWFraW5nXG4vLyBjaGFuZ2VzIHRvIHRoZSBmdW5jdGlvbiBib2R5LlxuZnVuY3Rpb24gY29weUZyb21CdWZmZXIobiwgbGlzdCkge1xuICB2YXIgcmV0ID0gYnVmZmVyU2hpbS5hbGxvY1Vuc2FmZShuKTtcbiAgdmFyIHAgPSBsaXN0LmhlYWQ7XG4gIHZhciBjID0gMTtcbiAgcC5kYXRhLmNvcHkocmV0KTtcbiAgbiAtPSBwLmRhdGEubGVuZ3RoO1xuICB3aGlsZSAocCA9IHAubmV4dCkge1xuICAgIHZhciBidWYgPSBwLmRhdGE7XG4gICAgdmFyIG5iID0gbiA+IGJ1Zi5sZW5ndGggPyBidWYubGVuZ3RoIDogbjtcbiAgICBidWYuY29weShyZXQsIHJldC5sZW5ndGggLSBuLCAwLCBuYik7XG4gICAgbiAtPSBuYjtcbiAgICBpZiAobiA9PT0gMCkge1xuICAgICAgaWYgKG5iID09PSBidWYubGVuZ3RoKSB7XG4gICAgICAgICsrYztcbiAgICAgICAgaWYgKHAubmV4dCkgbGlzdC5oZWFkID0gcC5uZXh0O2Vsc2UgbGlzdC5oZWFkID0gbGlzdC50YWlsID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxpc3QuaGVhZCA9IHA7XG4gICAgICAgIHAuZGF0YSA9IGJ1Zi5zbGljZShuYik7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgKytjO1xuICB9XG4gIGxpc3QubGVuZ3RoIC09IGM7XG4gIHJldHVybiByZXQ7XG59XG5cbmZ1bmN0aW9uIGVuZFJlYWRhYmxlKHN0cmVhbSkge1xuICB2YXIgc3RhdGUgPSBzdHJlYW0uX3JlYWRhYmxlU3RhdGU7XG5cbiAgLy8gSWYgd2UgZ2V0IGhlcmUgYmVmb3JlIGNvbnN1bWluZyBhbGwgdGhlIGJ5dGVzLCB0aGVuIHRoYXQgaXMgYVxuICAvLyBidWcgaW4gbm9kZS4gIFNob3VsZCBuZXZlciBoYXBwZW4uXG4gIGlmIChzdGF0ZS5sZW5ndGggPiAwKSB0aHJvdyBuZXcgRXJyb3IoJ1wiZW5kUmVhZGFibGUoKVwiIGNhbGxlZCBvbiBub24tZW1wdHkgc3RyZWFtJyk7XG5cbiAgaWYgKCFzdGF0ZS5lbmRFbWl0dGVkKSB7XG4gICAgc3RhdGUuZW5kZWQgPSB0cnVlO1xuICAgIHByb2Nlc3NOZXh0VGljayhlbmRSZWFkYWJsZU5ULCBzdGF0ZSwgc3RyZWFtKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBlbmRSZWFkYWJsZU5UKHN0YXRlLCBzdHJlYW0pIHtcbiAgLy8gQ2hlY2sgdGhhdCB3ZSBkaWRuJ3QgZ2V0IG9uZSBsYXN0IHVuc2hpZnQuXG4gIGlmICghc3RhdGUuZW5kRW1pdHRlZCAmJiBzdGF0ZS5sZW5ndGggPT09IDApIHtcbiAgICBzdGF0ZS5lbmRFbWl0dGVkID0gdHJ1ZTtcbiAgICBzdHJlYW0ucmVhZGFibGUgPSBmYWxzZTtcbiAgICBzdHJlYW0uZW1pdCgnZW5kJyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZm9yRWFjaCh4cywgZikge1xuICBmb3IgKHZhciBpID0gMCwgbCA9IHhzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgIGYoeHNbaV0sIGkpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGluZGV4T2YoeHMsIHgpIHtcbiAgZm9yICh2YXIgaSA9IDAsIGwgPSB4cy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICBpZiAoeHNbaV0gPT09IHgpIHJldHVybiBpO1xuICB9XG4gIHJldHVybiAtMTtcbn0iLCIvLyBhIHRyYW5zZm9ybSBzdHJlYW0gaXMgYSByZWFkYWJsZS93cml0YWJsZSBzdHJlYW0gd2hlcmUgeW91IGRvXG4vLyBzb21ldGhpbmcgd2l0aCB0aGUgZGF0YS4gIFNvbWV0aW1lcyBpdCdzIGNhbGxlZCBhIFwiZmlsdGVyXCIsXG4vLyBidXQgdGhhdCdzIG5vdCBhIGdyZWF0IG5hbWUgZm9yIGl0LCBzaW5jZSB0aGF0IGltcGxpZXMgYSB0aGluZyB3aGVyZVxuLy8gc29tZSBiaXRzIHBhc3MgdGhyb3VnaCwgYW5kIG90aGVycyBhcmUgc2ltcGx5IGlnbm9yZWQuICAoVGhhdCB3b3VsZFxuLy8gYmUgYSB2YWxpZCBleGFtcGxlIG9mIGEgdHJhbnNmb3JtLCBvZiBjb3Vyc2UuKVxuLy9cbi8vIFdoaWxlIHRoZSBvdXRwdXQgaXMgY2F1c2FsbHkgcmVsYXRlZCB0byB0aGUgaW5wdXQsIGl0J3Mgbm90IGFcbi8vIG5lY2Vzc2FyaWx5IHN5bW1ldHJpYyBvciBzeW5jaHJvbm91cyB0cmFuc2Zvcm1hdGlvbi4gIEZvciBleGFtcGxlLFxuLy8gYSB6bGliIHN0cmVhbSBtaWdodCB0YWtlIG11bHRpcGxlIHBsYWluLXRleHQgd3JpdGVzKCksIGFuZCB0aGVuXG4vLyBlbWl0IGEgc2luZ2xlIGNvbXByZXNzZWQgY2h1bmsgc29tZSB0aW1lIGluIHRoZSBmdXR1cmUuXG4vL1xuLy8gSGVyZSdzIGhvdyB0aGlzIHdvcmtzOlxuLy9cbi8vIFRoZSBUcmFuc2Zvcm0gc3RyZWFtIGhhcyBhbGwgdGhlIGFzcGVjdHMgb2YgdGhlIHJlYWRhYmxlIGFuZCB3cml0YWJsZVxuLy8gc3RyZWFtIGNsYXNzZXMuICBXaGVuIHlvdSB3cml0ZShjaHVuayksIHRoYXQgY2FsbHMgX3dyaXRlKGNodW5rLGNiKVxuLy8gaW50ZXJuYWxseSwgYW5kIHJldHVybnMgZmFsc2UgaWYgdGhlcmUncyBhIGxvdCBvZiBwZW5kaW5nIHdyaXRlc1xuLy8gYnVmZmVyZWQgdXAuICBXaGVuIHlvdSBjYWxsIHJlYWQoKSwgdGhhdCBjYWxscyBfcmVhZChuKSB1bnRpbFxuLy8gdGhlcmUncyBlbm91Z2ggcGVuZGluZyByZWFkYWJsZSBkYXRhIGJ1ZmZlcmVkIHVwLlxuLy9cbi8vIEluIGEgdHJhbnNmb3JtIHN0cmVhbSwgdGhlIHdyaXR0ZW4gZGF0YSBpcyBwbGFjZWQgaW4gYSBidWZmZXIuICBXaGVuXG4vLyBfcmVhZChuKSBpcyBjYWxsZWQsIGl0IHRyYW5zZm9ybXMgdGhlIHF1ZXVlZCB1cCBkYXRhLCBjYWxsaW5nIHRoZVxuLy8gYnVmZmVyZWQgX3dyaXRlIGNiJ3MgYXMgaXQgY29uc3VtZXMgY2h1bmtzLiAgSWYgY29uc3VtaW5nIGEgc2luZ2xlXG4vLyB3cml0dGVuIGNodW5rIHdvdWxkIHJlc3VsdCBpbiBtdWx0aXBsZSBvdXRwdXQgY2h1bmtzLCB0aGVuIHRoZSBmaXJzdFxuLy8gb3V0cHV0dGVkIGJpdCBjYWxscyB0aGUgcmVhZGNiLCBhbmQgc3Vic2VxdWVudCBjaHVua3MganVzdCBnbyBpbnRvXG4vLyB0aGUgcmVhZCBidWZmZXIsIGFuZCB3aWxsIGNhdXNlIGl0IHRvIGVtaXQgJ3JlYWRhYmxlJyBpZiBuZWNlc3NhcnkuXG4vL1xuLy8gVGhpcyB3YXksIGJhY2stcHJlc3N1cmUgaXMgYWN0dWFsbHkgZGV0ZXJtaW5lZCBieSB0aGUgcmVhZGluZyBzaWRlLFxuLy8gc2luY2UgX3JlYWQgaGFzIHRvIGJlIGNhbGxlZCB0byBzdGFydCBwcm9jZXNzaW5nIGEgbmV3IGNodW5rLiAgSG93ZXZlcixcbi8vIGEgcGF0aG9sb2dpY2FsIGluZmxhdGUgdHlwZSBvZiB0cmFuc2Zvcm0gY2FuIGNhdXNlIGV4Y2Vzc2l2ZSBidWZmZXJpbmdcbi8vIGhlcmUuICBGb3IgZXhhbXBsZSwgaW1hZ2luZSBhIHN0cmVhbSB3aGVyZSBldmVyeSBieXRlIG9mIGlucHV0IGlzXG4vLyBpbnRlcnByZXRlZCBhcyBhbiBpbnRlZ2VyIGZyb20gMC0yNTUsIGFuZCB0aGVuIHJlc3VsdHMgaW4gdGhhdCBtYW55XG4vLyBieXRlcyBvZiBvdXRwdXQuICBXcml0aW5nIHRoZSA0IGJ5dGVzIHtmZixmZixmZixmZn0gd291bGQgcmVzdWx0IGluXG4vLyAxa2Igb2YgZGF0YSBiZWluZyBvdXRwdXQuICBJbiB0aGlzIGNhc2UsIHlvdSBjb3VsZCB3cml0ZSBhIHZlcnkgc21hbGxcbi8vIGFtb3VudCBvZiBpbnB1dCwgYW5kIGVuZCB1cCB3aXRoIGEgdmVyeSBsYXJnZSBhbW91bnQgb2Ygb3V0cHV0LiAgSW5cbi8vIHN1Y2ggYSBwYXRob2xvZ2ljYWwgaW5mbGF0aW5nIG1lY2hhbmlzbSwgdGhlcmUnZCBiZSBubyB3YXkgdG8gdGVsbFxuLy8gdGhlIHN5c3RlbSB0byBzdG9wIGRvaW5nIHRoZSB0cmFuc2Zvcm0uICBBIHNpbmdsZSA0TUIgd3JpdGUgY291bGRcbi8vIGNhdXNlIHRoZSBzeXN0ZW0gdG8gcnVuIG91dCBvZiBtZW1vcnkuXG4vL1xuLy8gSG93ZXZlciwgZXZlbiBpbiBzdWNoIGEgcGF0aG9sb2dpY2FsIGNhc2UsIG9ubHkgYSBzaW5nbGUgd3JpdHRlbiBjaHVua1xuLy8gd291bGQgYmUgY29uc3VtZWQsIGFuZCB0aGVuIHRoZSByZXN0IHdvdWxkIHdhaXQgKHVuLXRyYW5zZm9ybWVkKSB1bnRpbFxuLy8gdGhlIHJlc3VsdHMgb2YgdGhlIHByZXZpb3VzIHRyYW5zZm9ybWVkIGNodW5rIHdlcmUgY29uc3VtZWQuXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBUcmFuc2Zvcm07XG5cbnZhciBEdXBsZXggPSByZXF1aXJlKCcuL19zdHJlYW1fZHVwbGV4Jyk7XG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgdXRpbCA9IHJlcXVpcmUoJ2NvcmUtdXRpbC1pcycpO1xudXRpbC5pbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG4vKjwvcmVwbGFjZW1lbnQ+Ki9cblxudXRpbC5pbmhlcml0cyhUcmFuc2Zvcm0sIER1cGxleCk7XG5cbmZ1bmN0aW9uIFRyYW5zZm9ybVN0YXRlKHN0cmVhbSkge1xuICB0aGlzLmFmdGVyVHJhbnNmb3JtID0gZnVuY3Rpb24gKGVyLCBkYXRhKSB7XG4gICAgcmV0dXJuIGFmdGVyVHJhbnNmb3JtKHN0cmVhbSwgZXIsIGRhdGEpO1xuICB9O1xuXG4gIHRoaXMubmVlZFRyYW5zZm9ybSA9IGZhbHNlO1xuICB0aGlzLnRyYW5zZm9ybWluZyA9IGZhbHNlO1xuICB0aGlzLndyaXRlY2IgPSBudWxsO1xuICB0aGlzLndyaXRlY2h1bmsgPSBudWxsO1xuICB0aGlzLndyaXRlZW5jb2RpbmcgPSBudWxsO1xufVxuXG5mdW5jdGlvbiBhZnRlclRyYW5zZm9ybShzdHJlYW0sIGVyLCBkYXRhKSB7XG4gIHZhciB0cyA9IHN0cmVhbS5fdHJhbnNmb3JtU3RhdGU7XG4gIHRzLnRyYW5zZm9ybWluZyA9IGZhbHNlO1xuXG4gIHZhciBjYiA9IHRzLndyaXRlY2I7XG5cbiAgaWYgKCFjYikgcmV0dXJuIHN0cmVhbS5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignbm8gd3JpdGVjYiBpbiBUcmFuc2Zvcm0gY2xhc3MnKSk7XG5cbiAgdHMud3JpdGVjaHVuayA9IG51bGw7XG4gIHRzLndyaXRlY2IgPSBudWxsO1xuXG4gIGlmIChkYXRhICE9PSBudWxsICYmIGRhdGEgIT09IHVuZGVmaW5lZCkgc3RyZWFtLnB1c2goZGF0YSk7XG5cbiAgY2IoZXIpO1xuXG4gIHZhciBycyA9IHN0cmVhbS5fcmVhZGFibGVTdGF0ZTtcbiAgcnMucmVhZGluZyA9IGZhbHNlO1xuICBpZiAocnMubmVlZFJlYWRhYmxlIHx8IHJzLmxlbmd0aCA8IHJzLmhpZ2hXYXRlck1hcmspIHtcbiAgICBzdHJlYW0uX3JlYWQocnMuaGlnaFdhdGVyTWFyayk7XG4gIH1cbn1cblxuZnVuY3Rpb24gVHJhbnNmb3JtKG9wdGlvbnMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFRyYW5zZm9ybSkpIHJldHVybiBuZXcgVHJhbnNmb3JtKG9wdGlvbnMpO1xuXG4gIER1cGxleC5jYWxsKHRoaXMsIG9wdGlvbnMpO1xuXG4gIHRoaXMuX3RyYW5zZm9ybVN0YXRlID0gbmV3IFRyYW5zZm9ybVN0YXRlKHRoaXMpO1xuXG4gIHZhciBzdHJlYW0gPSB0aGlzO1xuXG4gIC8vIHN0YXJ0IG91dCBhc2tpbmcgZm9yIGEgcmVhZGFibGUgZXZlbnQgb25jZSBkYXRhIGlzIHRyYW5zZm9ybWVkLlxuICB0aGlzLl9yZWFkYWJsZVN0YXRlLm5lZWRSZWFkYWJsZSA9IHRydWU7XG5cbiAgLy8gd2UgaGF2ZSBpbXBsZW1lbnRlZCB0aGUgX3JlYWQgbWV0aG9kLCBhbmQgZG9uZSB0aGUgb3RoZXIgdGhpbmdzXG4gIC8vIHRoYXQgUmVhZGFibGUgd2FudHMgYmVmb3JlIHRoZSBmaXJzdCBfcmVhZCBjYWxsLCBzbyB1bnNldCB0aGVcbiAgLy8gc3luYyBndWFyZCBmbGFnLlxuICB0aGlzLl9yZWFkYWJsZVN0YXRlLnN5bmMgPSBmYWxzZTtcblxuICBpZiAob3B0aW9ucykge1xuICAgIGlmICh0eXBlb2Ygb3B0aW9ucy50cmFuc2Zvcm0gPT09ICdmdW5jdGlvbicpIHRoaXMuX3RyYW5zZm9ybSA9IG9wdGlvbnMudHJhbnNmb3JtO1xuXG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLmZsdXNoID09PSAnZnVuY3Rpb24nKSB0aGlzLl9mbHVzaCA9IG9wdGlvbnMuZmx1c2g7XG4gIH1cblxuICAvLyBXaGVuIHRoZSB3cml0YWJsZSBzaWRlIGZpbmlzaGVzLCB0aGVuIGZsdXNoIG91dCBhbnl0aGluZyByZW1haW5pbmcuXG4gIHRoaXMub25jZSgncHJlZmluaXNoJywgZnVuY3Rpb24gKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5fZmx1c2ggPT09ICdmdW5jdGlvbicpIHRoaXMuX2ZsdXNoKGZ1bmN0aW9uIChlciwgZGF0YSkge1xuICAgICAgZG9uZShzdHJlYW0sIGVyLCBkYXRhKTtcbiAgICB9KTtlbHNlIGRvbmUoc3RyZWFtKTtcbiAgfSk7XG59XG5cblRyYW5zZm9ybS5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uIChjaHVuaywgZW5jb2RpbmcpIHtcbiAgdGhpcy5fdHJhbnNmb3JtU3RhdGUubmVlZFRyYW5zZm9ybSA9IGZhbHNlO1xuICByZXR1cm4gRHVwbGV4LnByb3RvdHlwZS5wdXNoLmNhbGwodGhpcywgY2h1bmssIGVuY29kaW5nKTtcbn07XG5cbi8vIFRoaXMgaXMgdGhlIHBhcnQgd2hlcmUgeW91IGRvIHN0dWZmIVxuLy8gb3ZlcnJpZGUgdGhpcyBmdW5jdGlvbiBpbiBpbXBsZW1lbnRhdGlvbiBjbGFzc2VzLlxuLy8gJ2NodW5rJyBpcyBhbiBpbnB1dCBjaHVuay5cbi8vXG4vLyBDYWxsIGBwdXNoKG5ld0NodW5rKWAgdG8gcGFzcyBhbG9uZyB0cmFuc2Zvcm1lZCBvdXRwdXRcbi8vIHRvIHRoZSByZWFkYWJsZSBzaWRlLiAgWW91IG1heSBjYWxsICdwdXNoJyB6ZXJvIG9yIG1vcmUgdGltZXMuXG4vL1xuLy8gQ2FsbCBgY2IoZXJyKWAgd2hlbiB5b3UgYXJlIGRvbmUgd2l0aCB0aGlzIGNodW5rLiAgSWYgeW91IHBhc3Ncbi8vIGFuIGVycm9yLCB0aGVuIHRoYXQnbGwgcHV0IHRoZSBodXJ0IG9uIHRoZSB3aG9sZSBvcGVyYXRpb24uICBJZiB5b3Vcbi8vIG5ldmVyIGNhbGwgY2IoKSwgdGhlbiB5b3UnbGwgbmV2ZXIgZ2V0IGFub3RoZXIgY2h1bmsuXG5UcmFuc2Zvcm0ucHJvdG90eXBlLl90cmFuc2Zvcm0gPSBmdW5jdGlvbiAoY2h1bmssIGVuY29kaW5nLCBjYikge1xuICB0aHJvdyBuZXcgRXJyb3IoJ190cmFuc2Zvcm0oKSBpcyBub3QgaW1wbGVtZW50ZWQnKTtcbn07XG5cblRyYW5zZm9ybS5wcm90b3R5cGUuX3dyaXRlID0gZnVuY3Rpb24gKGNodW5rLCBlbmNvZGluZywgY2IpIHtcbiAgdmFyIHRzID0gdGhpcy5fdHJhbnNmb3JtU3RhdGU7XG4gIHRzLndyaXRlY2IgPSBjYjtcbiAgdHMud3JpdGVjaHVuayA9IGNodW5rO1xuICB0cy53cml0ZWVuY29kaW5nID0gZW5jb2Rpbmc7XG4gIGlmICghdHMudHJhbnNmb3JtaW5nKSB7XG4gICAgdmFyIHJzID0gdGhpcy5fcmVhZGFibGVTdGF0ZTtcbiAgICBpZiAodHMubmVlZFRyYW5zZm9ybSB8fCBycy5uZWVkUmVhZGFibGUgfHwgcnMubGVuZ3RoIDwgcnMuaGlnaFdhdGVyTWFyaykgdGhpcy5fcmVhZChycy5oaWdoV2F0ZXJNYXJrKTtcbiAgfVxufTtcblxuLy8gRG9lc24ndCBtYXR0ZXIgd2hhdCB0aGUgYXJncyBhcmUgaGVyZS5cbi8vIF90cmFuc2Zvcm0gZG9lcyBhbGwgdGhlIHdvcmsuXG4vLyBUaGF0IHdlIGdvdCBoZXJlIG1lYW5zIHRoYXQgdGhlIHJlYWRhYmxlIHNpZGUgd2FudHMgbW9yZSBkYXRhLlxuVHJhbnNmb3JtLnByb3RvdHlwZS5fcmVhZCA9IGZ1bmN0aW9uIChuKSB7XG4gIHZhciB0cyA9IHRoaXMuX3RyYW5zZm9ybVN0YXRlO1xuXG4gIGlmICh0cy53cml0ZWNodW5rICE9PSBudWxsICYmIHRzLndyaXRlY2IgJiYgIXRzLnRyYW5zZm9ybWluZykge1xuICAgIHRzLnRyYW5zZm9ybWluZyA9IHRydWU7XG4gICAgdGhpcy5fdHJhbnNmb3JtKHRzLndyaXRlY2h1bmssIHRzLndyaXRlZW5jb2RpbmcsIHRzLmFmdGVyVHJhbnNmb3JtKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBtYXJrIHRoYXQgd2UgbmVlZCBhIHRyYW5zZm9ybSwgc28gdGhhdCBhbnkgZGF0YSB0aGF0IGNvbWVzIGluXG4gICAgLy8gd2lsbCBnZXQgcHJvY2Vzc2VkLCBub3cgdGhhdCB3ZSd2ZSBhc2tlZCBmb3IgaXQuXG4gICAgdHMubmVlZFRyYW5zZm9ybSA9IHRydWU7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIGRvbmUoc3RyZWFtLCBlciwgZGF0YSkge1xuICBpZiAoZXIpIHJldHVybiBzdHJlYW0uZW1pdCgnZXJyb3InLCBlcik7XG5cbiAgaWYgKGRhdGEgIT09IG51bGwgJiYgZGF0YSAhPT0gdW5kZWZpbmVkKSBzdHJlYW0ucHVzaChkYXRhKTtcblxuICAvLyBpZiB0aGVyZSdzIG5vdGhpbmcgaW4gdGhlIHdyaXRlIGJ1ZmZlciwgdGhlbiB0aGF0IG1lYW5zXG4gIC8vIHRoYXQgbm90aGluZyBtb3JlIHdpbGwgZXZlciBiZSBwcm92aWRlZFxuICB2YXIgd3MgPSBzdHJlYW0uX3dyaXRhYmxlU3RhdGU7XG4gIHZhciB0cyA9IHN0cmVhbS5fdHJhbnNmb3JtU3RhdGU7XG5cbiAgaWYgKHdzLmxlbmd0aCkgdGhyb3cgbmV3IEVycm9yKCdDYWxsaW5nIHRyYW5zZm9ybSBkb25lIHdoZW4gd3MubGVuZ3RoICE9IDAnKTtcblxuICBpZiAodHMudHJhbnNmb3JtaW5nKSB0aHJvdyBuZXcgRXJyb3IoJ0NhbGxpbmcgdHJhbnNmb3JtIGRvbmUgd2hlbiBzdGlsbCB0cmFuc2Zvcm1pbmcnKTtcblxuICByZXR1cm4gc3RyZWFtLnB1c2gobnVsbCk7XG59IiwiLy8gQSBiaXQgc2ltcGxlciB0aGFuIHJlYWRhYmxlIHN0cmVhbXMuXG4vLyBJbXBsZW1lbnQgYW4gYXN5bmMgLl93cml0ZShjaHVuaywgZW5jb2RpbmcsIGNiKSwgYW5kIGl0J2xsIGhhbmRsZSBhbGxcbi8vIHRoZSBkcmFpbiBldmVudCBlbWlzc2lvbiBhbmQgYnVmZmVyaW5nLlxuXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gV3JpdGFibGU7XG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgcHJvY2Vzc05leHRUaWNrID0gcmVxdWlyZSgncHJvY2Vzcy1uZXh0aWNrLWFyZ3MnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIGFzeW5jV3JpdGUgPSAhcHJvY2Vzcy5icm93c2VyICYmIFsndjAuMTAnLCAndjAuOS4nXS5pbmRleE9mKHByb2Nlc3MudmVyc2lvbi5zbGljZSgwLCA1KSkgPiAtMSA/IHNldEltbWVkaWF0ZSA6IHByb2Nlc3NOZXh0VGljaztcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIER1cGxleDtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG5Xcml0YWJsZS5Xcml0YWJsZVN0YXRlID0gV3JpdGFibGVTdGF0ZTtcblxuLyo8cmVwbGFjZW1lbnQ+Ki9cbnZhciB1dGlsID0gcmVxdWlyZSgnY29yZS11dGlsLWlzJyk7XG51dGlsLmluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIGludGVybmFsVXRpbCA9IHtcbiAgZGVwcmVjYXRlOiByZXF1aXJlKCd1dGlsLWRlcHJlY2F0ZScpXG59O1xuLyo8L3JlcGxhY2VtZW50PiovXG5cbi8qPHJlcGxhY2VtZW50PiovXG52YXIgU3RyZWFtO1xuKGZ1bmN0aW9uICgpIHtcbiAgdHJ5IHtcbiAgICBTdHJlYW0gPSByZXF1aXJlKCdzdCcgKyAncmVhbScpO1xuICB9IGNhdGNoIChfKSB7fSBmaW5hbGx5IHtcbiAgICBpZiAoIVN0cmVhbSkgU3RyZWFtID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuICB9XG59KSgpO1xuLyo8L3JlcGxhY2VtZW50PiovXG5cbnZhciBCdWZmZXIgPSByZXF1aXJlKCdidWZmZXInKS5CdWZmZXI7XG4vKjxyZXBsYWNlbWVudD4qL1xudmFyIGJ1ZmZlclNoaW0gPSByZXF1aXJlKCdidWZmZXItc2hpbXMnKTtcbi8qPC9yZXBsYWNlbWVudD4qL1xuXG51dGlsLmluaGVyaXRzKFdyaXRhYmxlLCBTdHJlYW0pO1xuXG5mdW5jdGlvbiBub3AoKSB7fVxuXG5mdW5jdGlvbiBXcml0ZVJlcShjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIHRoaXMuY2h1bmsgPSBjaHVuaztcbiAgdGhpcy5lbmNvZGluZyA9IGVuY29kaW5nO1xuICB0aGlzLmNhbGxiYWNrID0gY2I7XG4gIHRoaXMubmV4dCA9IG51bGw7XG59XG5cbmZ1bmN0aW9uIFdyaXRhYmxlU3RhdGUob3B0aW9ucywgc3RyZWFtKSB7XG4gIER1cGxleCA9IER1cGxleCB8fCByZXF1aXJlKCcuL19zdHJlYW1fZHVwbGV4Jyk7XG5cbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgLy8gb2JqZWN0IHN0cmVhbSBmbGFnIHRvIGluZGljYXRlIHdoZXRoZXIgb3Igbm90IHRoaXMgc3RyZWFtXG4gIC8vIGNvbnRhaW5zIGJ1ZmZlcnMgb3Igb2JqZWN0cy5cbiAgdGhpcy5vYmplY3RNb2RlID0gISFvcHRpb25zLm9iamVjdE1vZGU7XG5cbiAgaWYgKHN0cmVhbSBpbnN0YW5jZW9mIER1cGxleCkgdGhpcy5vYmplY3RNb2RlID0gdGhpcy5vYmplY3RNb2RlIHx8ICEhb3B0aW9ucy53cml0YWJsZU9iamVjdE1vZGU7XG5cbiAgLy8gdGhlIHBvaW50IGF0IHdoaWNoIHdyaXRlKCkgc3RhcnRzIHJldHVybmluZyBmYWxzZVxuICAvLyBOb3RlOiAwIGlzIGEgdmFsaWQgdmFsdWUsIG1lYW5zIHRoYXQgd2UgYWx3YXlzIHJldHVybiBmYWxzZSBpZlxuICAvLyB0aGUgZW50aXJlIGJ1ZmZlciBpcyBub3QgZmx1c2hlZCBpbW1lZGlhdGVseSBvbiB3cml0ZSgpXG4gIHZhciBod20gPSBvcHRpb25zLmhpZ2hXYXRlck1hcms7XG4gIHZhciBkZWZhdWx0SHdtID0gdGhpcy5vYmplY3RNb2RlID8gMTYgOiAxNiAqIDEwMjQ7XG4gIHRoaXMuaGlnaFdhdGVyTWFyayA9IGh3bSB8fCBod20gPT09IDAgPyBod20gOiBkZWZhdWx0SHdtO1xuXG4gIC8vIGNhc3QgdG8gaW50cy5cbiAgdGhpcy5oaWdoV2F0ZXJNYXJrID0gfiB+dGhpcy5oaWdoV2F0ZXJNYXJrO1xuXG4gIC8vIGRyYWluIGV2ZW50IGZsYWcuXG4gIHRoaXMubmVlZERyYWluID0gZmFsc2U7XG4gIC8vIGF0IHRoZSBzdGFydCBvZiBjYWxsaW5nIGVuZCgpXG4gIHRoaXMuZW5kaW5nID0gZmFsc2U7XG4gIC8vIHdoZW4gZW5kKCkgaGFzIGJlZW4gY2FsbGVkLCBhbmQgcmV0dXJuZWRcbiAgdGhpcy5lbmRlZCA9IGZhbHNlO1xuICAvLyB3aGVuICdmaW5pc2gnIGlzIGVtaXR0ZWRcbiAgdGhpcy5maW5pc2hlZCA9IGZhbHNlO1xuXG4gIC8vIHNob3VsZCB3ZSBkZWNvZGUgc3RyaW5ncyBpbnRvIGJ1ZmZlcnMgYmVmb3JlIHBhc3NpbmcgdG8gX3dyaXRlP1xuICAvLyB0aGlzIGlzIGhlcmUgc28gdGhhdCBzb21lIG5vZGUtY29yZSBzdHJlYW1zIGNhbiBvcHRpbWl6ZSBzdHJpbmdcbiAgLy8gaGFuZGxpbmcgYXQgYSBsb3dlciBsZXZlbC5cbiAgdmFyIG5vRGVjb2RlID0gb3B0aW9ucy5kZWNvZGVTdHJpbmdzID09PSBmYWxzZTtcbiAgdGhpcy5kZWNvZGVTdHJpbmdzID0gIW5vRGVjb2RlO1xuXG4gIC8vIENyeXB0byBpcyBraW5kIG9mIG9sZCBhbmQgY3J1c3R5LiAgSGlzdG9yaWNhbGx5LCBpdHMgZGVmYXVsdCBzdHJpbmdcbiAgLy8gZW5jb2RpbmcgaXMgJ2JpbmFyeScgc28gd2UgaGF2ZSB0byBtYWtlIHRoaXMgY29uZmlndXJhYmxlLlxuICAvLyBFdmVyeXRoaW5nIGVsc2UgaW4gdGhlIHVuaXZlcnNlIHVzZXMgJ3V0ZjgnLCB0aG91Z2guXG4gIHRoaXMuZGVmYXVsdEVuY29kaW5nID0gb3B0aW9ucy5kZWZhdWx0RW5jb2RpbmcgfHwgJ3V0ZjgnO1xuXG4gIC8vIG5vdCBhbiBhY3R1YWwgYnVmZmVyIHdlIGtlZXAgdHJhY2sgb2YsIGJ1dCBhIG1lYXN1cmVtZW50XG4gIC8vIG9mIGhvdyBtdWNoIHdlJ3JlIHdhaXRpbmcgdG8gZ2V0IHB1c2hlZCB0byBzb21lIHVuZGVybHlpbmdcbiAgLy8gc29ja2V0IG9yIGZpbGUuXG4gIHRoaXMubGVuZ3RoID0gMDtcblxuICAvLyBhIGZsYWcgdG8gc2VlIHdoZW4gd2UncmUgaW4gdGhlIG1pZGRsZSBvZiBhIHdyaXRlLlxuICB0aGlzLndyaXRpbmcgPSBmYWxzZTtcblxuICAvLyB3aGVuIHRydWUgYWxsIHdyaXRlcyB3aWxsIGJlIGJ1ZmZlcmVkIHVudGlsIC51bmNvcmsoKSBjYWxsXG4gIHRoaXMuY29ya2VkID0gMDtcblxuICAvLyBhIGZsYWcgdG8gYmUgYWJsZSB0byB0ZWxsIGlmIHRoZSBvbndyaXRlIGNiIGlzIGNhbGxlZCBpbW1lZGlhdGVseSxcbiAgLy8gb3Igb24gYSBsYXRlciB0aWNrLiAgV2Ugc2V0IHRoaXMgdG8gdHJ1ZSBhdCBmaXJzdCwgYmVjYXVzZSBhbnlcbiAgLy8gYWN0aW9ucyB0aGF0IHNob3VsZG4ndCBoYXBwZW4gdW50aWwgXCJsYXRlclwiIHNob3VsZCBnZW5lcmFsbHkgYWxzb1xuICAvLyBub3QgaGFwcGVuIGJlZm9yZSB0aGUgZmlyc3Qgd3JpdGUgY2FsbC5cbiAgdGhpcy5zeW5jID0gdHJ1ZTtcblxuICAvLyBhIGZsYWcgdG8ga25vdyBpZiB3ZSdyZSBwcm9jZXNzaW5nIHByZXZpb3VzbHkgYnVmZmVyZWQgaXRlbXMsIHdoaWNoXG4gIC8vIG1heSBjYWxsIHRoZSBfd3JpdGUoKSBjYWxsYmFjayBpbiB0aGUgc2FtZSB0aWNrLCBzbyB0aGF0IHdlIGRvbid0XG4gIC8vIGVuZCB1cCBpbiBhbiBvdmVybGFwcGVkIG9ud3JpdGUgc2l0dWF0aW9uLlxuICB0aGlzLmJ1ZmZlclByb2Nlc3NpbmcgPSBmYWxzZTtcblxuICAvLyB0aGUgY2FsbGJhY2sgdGhhdCdzIHBhc3NlZCB0byBfd3JpdGUoY2h1bmssY2IpXG4gIHRoaXMub253cml0ZSA9IGZ1bmN0aW9uIChlcikge1xuICAgIG9ud3JpdGUoc3RyZWFtLCBlcik7XG4gIH07XG5cbiAgLy8gdGhlIGNhbGxiYWNrIHRoYXQgdGhlIHVzZXIgc3VwcGxpZXMgdG8gd3JpdGUoY2h1bmssZW5jb2RpbmcsY2IpXG4gIHRoaXMud3JpdGVjYiA9IG51bGw7XG5cbiAgLy8gdGhlIGFtb3VudCB0aGF0IGlzIGJlaW5nIHdyaXR0ZW4gd2hlbiBfd3JpdGUgaXMgY2FsbGVkLlxuICB0aGlzLndyaXRlbGVuID0gMDtcblxuICB0aGlzLmJ1ZmZlcmVkUmVxdWVzdCA9IG51bGw7XG4gIHRoaXMubGFzdEJ1ZmZlcmVkUmVxdWVzdCA9IG51bGw7XG5cbiAgLy8gbnVtYmVyIG9mIHBlbmRpbmcgdXNlci1zdXBwbGllZCB3cml0ZSBjYWxsYmFja3NcbiAgLy8gdGhpcyBtdXN0IGJlIDAgYmVmb3JlICdmaW5pc2gnIGNhbiBiZSBlbWl0dGVkXG4gIHRoaXMucGVuZGluZ2NiID0gMDtcblxuICAvLyBlbWl0IHByZWZpbmlzaCBpZiB0aGUgb25seSB0aGluZyB3ZSdyZSB3YWl0aW5nIGZvciBpcyBfd3JpdGUgY2JzXG4gIC8vIFRoaXMgaXMgcmVsZXZhbnQgZm9yIHN5bmNocm9ub3VzIFRyYW5zZm9ybSBzdHJlYW1zXG4gIHRoaXMucHJlZmluaXNoZWQgPSBmYWxzZTtcblxuICAvLyBUcnVlIGlmIHRoZSBlcnJvciB3YXMgYWxyZWFkeSBlbWl0dGVkIGFuZCBzaG91bGQgbm90IGJlIHRocm93biBhZ2FpblxuICB0aGlzLmVycm9yRW1pdHRlZCA9IGZhbHNlO1xuXG4gIC8vIGNvdW50IGJ1ZmZlcmVkIHJlcXVlc3RzXG4gIHRoaXMuYnVmZmVyZWRSZXF1ZXN0Q291bnQgPSAwO1xuXG4gIC8vIGFsbG9jYXRlIHRoZSBmaXJzdCBDb3JrZWRSZXF1ZXN0LCB0aGVyZSBpcyBhbHdheXNcbiAgLy8gb25lIGFsbG9jYXRlZCBhbmQgZnJlZSB0byB1c2UsIGFuZCB3ZSBtYWludGFpbiBhdCBtb3N0IHR3b1xuICB0aGlzLmNvcmtlZFJlcXVlc3RzRnJlZSA9IG5ldyBDb3JrZWRSZXF1ZXN0KHRoaXMpO1xufVxuXG5Xcml0YWJsZVN0YXRlLnByb3RvdHlwZS5nZXRCdWZmZXIgPSBmdW5jdGlvbiBnZXRCdWZmZXIoKSB7XG4gIHZhciBjdXJyZW50ID0gdGhpcy5idWZmZXJlZFJlcXVlc3Q7XG4gIHZhciBvdXQgPSBbXTtcbiAgd2hpbGUgKGN1cnJlbnQpIHtcbiAgICBvdXQucHVzaChjdXJyZW50KTtcbiAgICBjdXJyZW50ID0gY3VycmVudC5uZXh0O1xuICB9XG4gIHJldHVybiBvdXQ7XG59O1xuXG4oZnVuY3Rpb24gKCkge1xuICB0cnkge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShXcml0YWJsZVN0YXRlLnByb3RvdHlwZSwgJ2J1ZmZlcicsIHtcbiAgICAgIGdldDogaW50ZXJuYWxVdGlsLmRlcHJlY2F0ZShmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEJ1ZmZlcigpO1xuICAgICAgfSwgJ193cml0YWJsZVN0YXRlLmJ1ZmZlciBpcyBkZXByZWNhdGVkLiBVc2UgX3dyaXRhYmxlU3RhdGUuZ2V0QnVmZmVyICcgKyAnaW5zdGVhZC4nKVxuICAgIH0pO1xuICB9IGNhdGNoIChfKSB7fVxufSkoKTtcblxuLy8gVGVzdCBfd3JpdGFibGVTdGF0ZSBmb3IgaW5oZXJpdGFuY2UgdG8gYWNjb3VudCBmb3IgRHVwbGV4IHN0cmVhbXMsXG4vLyB3aG9zZSBwcm90b3R5cGUgY2hhaW4gb25seSBwb2ludHMgdG8gUmVhZGFibGUuXG52YXIgcmVhbEhhc0luc3RhbmNlO1xuaWYgKHR5cGVvZiBTeW1ib2wgPT09ICdmdW5jdGlvbicgJiYgU3ltYm9sLmhhc0luc3RhbmNlICYmIHR5cGVvZiBGdW5jdGlvbi5wcm90b3R5cGVbU3ltYm9sLmhhc0luc3RhbmNlXSA9PT0gJ2Z1bmN0aW9uJykge1xuICByZWFsSGFzSW5zdGFuY2UgPSBGdW5jdGlvbi5wcm90b3R5cGVbU3ltYm9sLmhhc0luc3RhbmNlXTtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFdyaXRhYmxlLCBTeW1ib2wuaGFzSW5zdGFuY2UsIHtcbiAgICB2YWx1ZTogZnVuY3Rpb24gKG9iamVjdCkge1xuICAgICAgaWYgKHJlYWxIYXNJbnN0YW5jZS5jYWxsKHRoaXMsIG9iamVjdCkpIHJldHVybiB0cnVlO1xuXG4gICAgICByZXR1cm4gb2JqZWN0ICYmIG9iamVjdC5fd3JpdGFibGVTdGF0ZSBpbnN0YW5jZW9mIFdyaXRhYmxlU3RhdGU7XG4gICAgfVxuICB9KTtcbn0gZWxzZSB7XG4gIHJlYWxIYXNJbnN0YW5jZSA9IGZ1bmN0aW9uIChvYmplY3QpIHtcbiAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgdGhpcztcbiAgfTtcbn1cblxuZnVuY3Rpb24gV3JpdGFibGUob3B0aW9ucykge1xuICBEdXBsZXggPSBEdXBsZXggfHwgcmVxdWlyZSgnLi9fc3RyZWFtX2R1cGxleCcpO1xuXG4gIC8vIFdyaXRhYmxlIGN0b3IgaXMgYXBwbGllZCB0byBEdXBsZXhlcywgdG9vLlxuICAvLyBgcmVhbEhhc0luc3RhbmNlYCBpcyBuZWNlc3NhcnkgYmVjYXVzZSB1c2luZyBwbGFpbiBgaW5zdGFuY2VvZmBcbiAgLy8gd291bGQgcmV0dXJuIGZhbHNlLCBhcyBubyBgX3dyaXRhYmxlU3RhdGVgIHByb3BlcnR5IGlzIGF0dGFjaGVkLlxuXG4gIC8vIFRyeWluZyB0byB1c2UgdGhlIGN1c3RvbSBgaW5zdGFuY2VvZmAgZm9yIFdyaXRhYmxlIGhlcmUgd2lsbCBhbHNvIGJyZWFrIHRoZVxuICAvLyBOb2RlLmpzIExhenlUcmFuc2Zvcm0gaW1wbGVtZW50YXRpb24sIHdoaWNoIGhhcyBhIG5vbi10cml2aWFsIGdldHRlciBmb3JcbiAgLy8gYF93cml0YWJsZVN0YXRlYCB0aGF0IHdvdWxkIGxlYWQgdG8gaW5maW5pdGUgcmVjdXJzaW9uLlxuICBpZiAoIXJlYWxIYXNJbnN0YW5jZS5jYWxsKFdyaXRhYmxlLCB0aGlzKSAmJiAhKHRoaXMgaW5zdGFuY2VvZiBEdXBsZXgpKSB7XG4gICAgcmV0dXJuIG5ldyBXcml0YWJsZShvcHRpb25zKTtcbiAgfVxuXG4gIHRoaXMuX3dyaXRhYmxlU3RhdGUgPSBuZXcgV3JpdGFibGVTdGF0ZShvcHRpb25zLCB0aGlzKTtcblxuICAvLyBsZWdhY3kuXG4gIHRoaXMud3JpdGFibGUgPSB0cnVlO1xuXG4gIGlmIChvcHRpb25zKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLndyaXRlID09PSAnZnVuY3Rpb24nKSB0aGlzLl93cml0ZSA9IG9wdGlvbnMud3JpdGU7XG5cbiAgICBpZiAodHlwZW9mIG9wdGlvbnMud3JpdGV2ID09PSAnZnVuY3Rpb24nKSB0aGlzLl93cml0ZXYgPSBvcHRpb25zLndyaXRldjtcbiAgfVxuXG4gIFN0cmVhbS5jYWxsKHRoaXMpO1xufVxuXG4vLyBPdGhlcndpc2UgcGVvcGxlIGNhbiBwaXBlIFdyaXRhYmxlIHN0cmVhbXMsIHdoaWNoIGlzIGp1c3Qgd3JvbmcuXG5Xcml0YWJsZS5wcm90b3R5cGUucGlwZSA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignQ2Fubm90IHBpcGUsIG5vdCByZWFkYWJsZScpKTtcbn07XG5cbmZ1bmN0aW9uIHdyaXRlQWZ0ZXJFbmQoc3RyZWFtLCBjYikge1xuICB2YXIgZXIgPSBuZXcgRXJyb3IoJ3dyaXRlIGFmdGVyIGVuZCcpO1xuICAvLyBUT0RPOiBkZWZlciBlcnJvciBldmVudHMgY29uc2lzdGVudGx5IGV2ZXJ5d2hlcmUsIG5vdCBqdXN0IHRoZSBjYlxuICBzdHJlYW0uZW1pdCgnZXJyb3InLCBlcik7XG4gIHByb2Nlc3NOZXh0VGljayhjYiwgZXIpO1xufVxuXG4vLyBJZiB3ZSBnZXQgc29tZXRoaW5nIHRoYXQgaXMgbm90IGEgYnVmZmVyLCBzdHJpbmcsIG51bGwsIG9yIHVuZGVmaW5lZCxcbi8vIGFuZCB3ZSdyZSBub3QgaW4gb2JqZWN0TW9kZSwgdGhlbiB0aGF0J3MgYW4gZXJyb3IuXG4vLyBPdGhlcndpc2Ugc3RyZWFtIGNodW5rcyBhcmUgYWxsIGNvbnNpZGVyZWQgdG8gYmUgb2YgbGVuZ3RoPTEsIGFuZCB0aGVcbi8vIHdhdGVybWFya3MgZGV0ZXJtaW5lIGhvdyBtYW55IG9iamVjdHMgdG8ga2VlcCBpbiB0aGUgYnVmZmVyLCByYXRoZXIgdGhhblxuLy8gaG93IG1hbnkgYnl0ZXMgb3IgY2hhcmFjdGVycy5cbmZ1bmN0aW9uIHZhbGlkQ2h1bmsoc3RyZWFtLCBzdGF0ZSwgY2h1bmssIGNiKSB7XG4gIHZhciB2YWxpZCA9IHRydWU7XG4gIHZhciBlciA9IGZhbHNlO1xuICAvLyBBbHdheXMgdGhyb3cgZXJyb3IgaWYgYSBudWxsIGlzIHdyaXR0ZW5cbiAgLy8gaWYgd2UgYXJlIG5vdCBpbiBvYmplY3QgbW9kZSB0aGVuIHRocm93XG4gIC8vIGlmIGl0IGlzIG5vdCBhIGJ1ZmZlciwgc3RyaW5nLCBvciB1bmRlZmluZWQuXG4gIGlmIChjaHVuayA9PT0gbnVsbCkge1xuICAgIGVyID0gbmV3IFR5cGVFcnJvcignTWF5IG5vdCB3cml0ZSBudWxsIHZhbHVlcyB0byBzdHJlYW0nKTtcbiAgfSBlbHNlIGlmICghQnVmZmVyLmlzQnVmZmVyKGNodW5rKSAmJiB0eXBlb2YgY2h1bmsgIT09ICdzdHJpbmcnICYmIGNodW5rICE9PSB1bmRlZmluZWQgJiYgIXN0YXRlLm9iamVjdE1vZGUpIHtcbiAgICBlciA9IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgbm9uLXN0cmluZy9idWZmZXIgY2h1bmsnKTtcbiAgfVxuICBpZiAoZXIpIHtcbiAgICBzdHJlYW0uZW1pdCgnZXJyb3InLCBlcik7XG4gICAgcHJvY2Vzc05leHRUaWNrKGNiLCBlcik7XG4gICAgdmFsaWQgPSBmYWxzZTtcbiAgfVxuICByZXR1cm4gdmFsaWQ7XG59XG5cbldyaXRhYmxlLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIChjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIHZhciBzdGF0ZSA9IHRoaXMuX3dyaXRhYmxlU3RhdGU7XG4gIHZhciByZXQgPSBmYWxzZTtcblxuICBpZiAodHlwZW9mIGVuY29kaW5nID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2IgPSBlbmNvZGluZztcbiAgICBlbmNvZGluZyA9IG51bGw7XG4gIH1cblxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKGNodW5rKSkgZW5jb2RpbmcgPSAnYnVmZmVyJztlbHNlIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gc3RhdGUuZGVmYXVsdEVuY29kaW5nO1xuXG4gIGlmICh0eXBlb2YgY2IgIT09ICdmdW5jdGlvbicpIGNiID0gbm9wO1xuXG4gIGlmIChzdGF0ZS5lbmRlZCkgd3JpdGVBZnRlckVuZCh0aGlzLCBjYik7ZWxzZSBpZiAodmFsaWRDaHVuayh0aGlzLCBzdGF0ZSwgY2h1bmssIGNiKSkge1xuICAgIHN0YXRlLnBlbmRpbmdjYisrO1xuICAgIHJldCA9IHdyaXRlT3JCdWZmZXIodGhpcywgc3RhdGUsIGNodW5rLCBlbmNvZGluZywgY2IpO1xuICB9XG5cbiAgcmV0dXJuIHJldDtcbn07XG5cbldyaXRhYmxlLnByb3RvdHlwZS5jb3JrID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc3RhdGUgPSB0aGlzLl93cml0YWJsZVN0YXRlO1xuXG4gIHN0YXRlLmNvcmtlZCsrO1xufTtcblxuV3JpdGFibGUucHJvdG90eXBlLnVuY29yayA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHN0YXRlID0gdGhpcy5fd3JpdGFibGVTdGF0ZTtcblxuICBpZiAoc3RhdGUuY29ya2VkKSB7XG4gICAgc3RhdGUuY29ya2VkLS07XG5cbiAgICBpZiAoIXN0YXRlLndyaXRpbmcgJiYgIXN0YXRlLmNvcmtlZCAmJiAhc3RhdGUuZmluaXNoZWQgJiYgIXN0YXRlLmJ1ZmZlclByb2Nlc3NpbmcgJiYgc3RhdGUuYnVmZmVyZWRSZXF1ZXN0KSBjbGVhckJ1ZmZlcih0aGlzLCBzdGF0ZSk7XG4gIH1cbn07XG5cbldyaXRhYmxlLnByb3RvdHlwZS5zZXREZWZhdWx0RW5jb2RpbmcgPSBmdW5jdGlvbiBzZXREZWZhdWx0RW5jb2RpbmcoZW5jb2RpbmcpIHtcbiAgLy8gbm9kZTo6UGFyc2VFbmNvZGluZygpIHJlcXVpcmVzIGxvd2VyIGNhc2UuXG4gIGlmICh0eXBlb2YgZW5jb2RpbmcgPT09ICdzdHJpbmcnKSBlbmNvZGluZyA9IGVuY29kaW5nLnRvTG93ZXJDYXNlKCk7XG4gIGlmICghKFsnaGV4JywgJ3V0ZjgnLCAndXRmLTgnLCAnYXNjaWknLCAnYmluYXJ5JywgJ2Jhc2U2NCcsICd1Y3MyJywgJ3Vjcy0yJywgJ3V0ZjE2bGUnLCAndXRmLTE2bGUnLCAncmF3J10uaW5kZXhPZigoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKSkgPiAtMSkpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZyk7XG4gIHRoaXMuX3dyaXRhYmxlU3RhdGUuZGVmYXVsdEVuY29kaW5nID0gZW5jb2Rpbmc7XG4gIHJldHVybiB0aGlzO1xufTtcblxuZnVuY3Rpb24gZGVjb2RlQ2h1bmsoc3RhdGUsIGNodW5rLCBlbmNvZGluZykge1xuICBpZiAoIXN0YXRlLm9iamVjdE1vZGUgJiYgc3RhdGUuZGVjb2RlU3RyaW5ncyAhPT0gZmFsc2UgJiYgdHlwZW9mIGNodW5rID09PSAnc3RyaW5nJykge1xuICAgIGNodW5rID0gYnVmZmVyU2hpbS5mcm9tKGNodW5rLCBlbmNvZGluZyk7XG4gIH1cbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vLyBpZiB3ZSdyZSBhbHJlYWR5IHdyaXRpbmcgc29tZXRoaW5nLCB0aGVuIGp1c3QgcHV0IHRoaXNcbi8vIGluIHRoZSBxdWV1ZSwgYW5kIHdhaXQgb3VyIHR1cm4uICBPdGhlcndpc2UsIGNhbGwgX3dyaXRlXG4vLyBJZiB3ZSByZXR1cm4gZmFsc2UsIHRoZW4gd2UgbmVlZCBhIGRyYWluIGV2ZW50LCBzbyBzZXQgdGhhdCBmbGFnLlxuZnVuY3Rpb24gd3JpdGVPckJ1ZmZlcihzdHJlYW0sIHN0YXRlLCBjaHVuaywgZW5jb2RpbmcsIGNiKSB7XG4gIGNodW5rID0gZGVjb2RlQ2h1bmsoc3RhdGUsIGNodW5rLCBlbmNvZGluZyk7XG5cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihjaHVuaykpIGVuY29kaW5nID0gJ2J1ZmZlcic7XG4gIHZhciBsZW4gPSBzdGF0ZS5vYmplY3RNb2RlID8gMSA6IGNodW5rLmxlbmd0aDtcblxuICBzdGF0ZS5sZW5ndGggKz0gbGVuO1xuXG4gIHZhciByZXQgPSBzdGF0ZS5sZW5ndGggPCBzdGF0ZS5oaWdoV2F0ZXJNYXJrO1xuICAvLyB3ZSBtdXN0IGVuc3VyZSB0aGF0IHByZXZpb3VzIG5lZWREcmFpbiB3aWxsIG5vdCBiZSByZXNldCB0byBmYWxzZS5cbiAgaWYgKCFyZXQpIHN0YXRlLm5lZWREcmFpbiA9IHRydWU7XG5cbiAgaWYgKHN0YXRlLndyaXRpbmcgfHwgc3RhdGUuY29ya2VkKSB7XG4gICAgdmFyIGxhc3QgPSBzdGF0ZS5sYXN0QnVmZmVyZWRSZXF1ZXN0O1xuICAgIHN0YXRlLmxhc3RCdWZmZXJlZFJlcXVlc3QgPSBuZXcgV3JpdGVSZXEoY2h1bmssIGVuY29kaW5nLCBjYik7XG4gICAgaWYgKGxhc3QpIHtcbiAgICAgIGxhc3QubmV4dCA9IHN0YXRlLmxhc3RCdWZmZXJlZFJlcXVlc3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN0YXRlLmJ1ZmZlcmVkUmVxdWVzdCA9IHN0YXRlLmxhc3RCdWZmZXJlZFJlcXVlc3Q7XG4gICAgfVxuICAgIHN0YXRlLmJ1ZmZlcmVkUmVxdWVzdENvdW50ICs9IDE7XG4gIH0gZWxzZSB7XG4gICAgZG9Xcml0ZShzdHJlYW0sIHN0YXRlLCBmYWxzZSwgbGVuLCBjaHVuaywgZW5jb2RpbmcsIGNiKTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbmZ1bmN0aW9uIGRvV3JpdGUoc3RyZWFtLCBzdGF0ZSwgd3JpdGV2LCBsZW4sIGNodW5rLCBlbmNvZGluZywgY2IpIHtcbiAgc3RhdGUud3JpdGVsZW4gPSBsZW47XG4gIHN0YXRlLndyaXRlY2IgPSBjYjtcbiAgc3RhdGUud3JpdGluZyA9IHRydWU7XG4gIHN0YXRlLnN5bmMgPSB0cnVlO1xuICBpZiAod3JpdGV2KSBzdHJlYW0uX3dyaXRldihjaHVuaywgc3RhdGUub253cml0ZSk7ZWxzZSBzdHJlYW0uX3dyaXRlKGNodW5rLCBlbmNvZGluZywgc3RhdGUub253cml0ZSk7XG4gIHN0YXRlLnN5bmMgPSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gb253cml0ZUVycm9yKHN0cmVhbSwgc3RhdGUsIHN5bmMsIGVyLCBjYikge1xuICAtLXN0YXRlLnBlbmRpbmdjYjtcbiAgaWYgKHN5bmMpIHByb2Nlc3NOZXh0VGljayhjYiwgZXIpO2Vsc2UgY2IoZXIpO1xuXG4gIHN0cmVhbS5fd3JpdGFibGVTdGF0ZS5lcnJvckVtaXR0ZWQgPSB0cnVlO1xuICBzdHJlYW0uZW1pdCgnZXJyb3InLCBlcik7XG59XG5cbmZ1bmN0aW9uIG9ud3JpdGVTdGF0ZVVwZGF0ZShzdGF0ZSkge1xuICBzdGF0ZS53cml0aW5nID0gZmFsc2U7XG4gIHN0YXRlLndyaXRlY2IgPSBudWxsO1xuICBzdGF0ZS5sZW5ndGggLT0gc3RhdGUud3JpdGVsZW47XG4gIHN0YXRlLndyaXRlbGVuID0gMDtcbn1cblxuZnVuY3Rpb24gb253cml0ZShzdHJlYW0sIGVyKSB7XG4gIHZhciBzdGF0ZSA9IHN0cmVhbS5fd3JpdGFibGVTdGF0ZTtcbiAgdmFyIHN5bmMgPSBzdGF0ZS5zeW5jO1xuICB2YXIgY2IgPSBzdGF0ZS53cml0ZWNiO1xuXG4gIG9ud3JpdGVTdGF0ZVVwZGF0ZShzdGF0ZSk7XG5cbiAgaWYgKGVyKSBvbndyaXRlRXJyb3Ioc3RyZWFtLCBzdGF0ZSwgc3luYywgZXIsIGNiKTtlbHNlIHtcbiAgICAvLyBDaGVjayBpZiB3ZSdyZSBhY3R1YWxseSByZWFkeSB0byBmaW5pc2gsIGJ1dCBkb24ndCBlbWl0IHlldFxuICAgIHZhciBmaW5pc2hlZCA9IG5lZWRGaW5pc2goc3RhdGUpO1xuXG4gICAgaWYgKCFmaW5pc2hlZCAmJiAhc3RhdGUuY29ya2VkICYmICFzdGF0ZS5idWZmZXJQcm9jZXNzaW5nICYmIHN0YXRlLmJ1ZmZlcmVkUmVxdWVzdCkge1xuICAgICAgY2xlYXJCdWZmZXIoc3RyZWFtLCBzdGF0ZSk7XG4gICAgfVxuXG4gICAgaWYgKHN5bmMpIHtcbiAgICAgIC8qPHJlcGxhY2VtZW50PiovXG4gICAgICBhc3luY1dyaXRlKGFmdGVyV3JpdGUsIHN0cmVhbSwgc3RhdGUsIGZpbmlzaGVkLCBjYik7XG4gICAgICAvKjwvcmVwbGFjZW1lbnQ+Ki9cbiAgICB9IGVsc2Uge1xuICAgICAgICBhZnRlcldyaXRlKHN0cmVhbSwgc3RhdGUsIGZpbmlzaGVkLCBjYik7XG4gICAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYWZ0ZXJXcml0ZShzdHJlYW0sIHN0YXRlLCBmaW5pc2hlZCwgY2IpIHtcbiAgaWYgKCFmaW5pc2hlZCkgb253cml0ZURyYWluKHN0cmVhbSwgc3RhdGUpO1xuICBzdGF0ZS5wZW5kaW5nY2ItLTtcbiAgY2IoKTtcbiAgZmluaXNoTWF5YmUoc3RyZWFtLCBzdGF0ZSk7XG59XG5cbi8vIE11c3QgZm9yY2UgY2FsbGJhY2sgdG8gYmUgY2FsbGVkIG9uIG5leHRUaWNrLCBzbyB0aGF0IHdlIGRvbid0XG4vLyBlbWl0ICdkcmFpbicgYmVmb3JlIHRoZSB3cml0ZSgpIGNvbnN1bWVyIGdldHMgdGhlICdmYWxzZScgcmV0dXJuXG4vLyB2YWx1ZSwgYW5kIGhhcyBhIGNoYW5jZSB0byBhdHRhY2ggYSAnZHJhaW4nIGxpc3RlbmVyLlxuZnVuY3Rpb24gb253cml0ZURyYWluKHN0cmVhbSwgc3RhdGUpIHtcbiAgaWYgKHN0YXRlLmxlbmd0aCA9PT0gMCAmJiBzdGF0ZS5uZWVkRHJhaW4pIHtcbiAgICBzdGF0ZS5uZWVkRHJhaW4gPSBmYWxzZTtcbiAgICBzdHJlYW0uZW1pdCgnZHJhaW4nKTtcbiAgfVxufVxuXG4vLyBpZiB0aGVyZSdzIHNvbWV0aGluZyBpbiB0aGUgYnVmZmVyIHdhaXRpbmcsIHRoZW4gcHJvY2VzcyBpdFxuZnVuY3Rpb24gY2xlYXJCdWZmZXIoc3RyZWFtLCBzdGF0ZSkge1xuICBzdGF0ZS5idWZmZXJQcm9jZXNzaW5nID0gdHJ1ZTtcbiAgdmFyIGVudHJ5ID0gc3RhdGUuYnVmZmVyZWRSZXF1ZXN0O1xuXG4gIGlmIChzdHJlYW0uX3dyaXRldiAmJiBlbnRyeSAmJiBlbnRyeS5uZXh0KSB7XG4gICAgLy8gRmFzdCBjYXNlLCB3cml0ZSBldmVyeXRoaW5nIHVzaW5nIF93cml0ZXYoKVxuICAgIHZhciBsID0gc3RhdGUuYnVmZmVyZWRSZXF1ZXN0Q291bnQ7XG4gICAgdmFyIGJ1ZmZlciA9IG5ldyBBcnJheShsKTtcbiAgICB2YXIgaG9sZGVyID0gc3RhdGUuY29ya2VkUmVxdWVzdHNGcmVlO1xuICAgIGhvbGRlci5lbnRyeSA9IGVudHJ5O1xuXG4gICAgdmFyIGNvdW50ID0gMDtcbiAgICB3aGlsZSAoZW50cnkpIHtcbiAgICAgIGJ1ZmZlcltjb3VudF0gPSBlbnRyeTtcbiAgICAgIGVudHJ5ID0gZW50cnkubmV4dDtcbiAgICAgIGNvdW50ICs9IDE7XG4gICAgfVxuXG4gICAgZG9Xcml0ZShzdHJlYW0sIHN0YXRlLCB0cnVlLCBzdGF0ZS5sZW5ndGgsIGJ1ZmZlciwgJycsIGhvbGRlci5maW5pc2gpO1xuXG4gICAgLy8gZG9Xcml0ZSBpcyBhbG1vc3QgYWx3YXlzIGFzeW5jLCBkZWZlciB0aGVzZSB0byBzYXZlIGEgYml0IG9mIHRpbWVcbiAgICAvLyBhcyB0aGUgaG90IHBhdGggZW5kcyB3aXRoIGRvV3JpdGVcbiAgICBzdGF0ZS5wZW5kaW5nY2IrKztcbiAgICBzdGF0ZS5sYXN0QnVmZmVyZWRSZXF1ZXN0ID0gbnVsbDtcbiAgICBpZiAoaG9sZGVyLm5leHQpIHtcbiAgICAgIHN0YXRlLmNvcmtlZFJlcXVlc3RzRnJlZSA9IGhvbGRlci5uZXh0O1xuICAgICAgaG9sZGVyLm5leHQgPSBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBzdGF0ZS5jb3JrZWRSZXF1ZXN0c0ZyZWUgPSBuZXcgQ29ya2VkUmVxdWVzdChzdGF0ZSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIFNsb3cgY2FzZSwgd3JpdGUgY2h1bmtzIG9uZS1ieS1vbmVcbiAgICB3aGlsZSAoZW50cnkpIHtcbiAgICAgIHZhciBjaHVuayA9IGVudHJ5LmNodW5rO1xuICAgICAgdmFyIGVuY29kaW5nID0gZW50cnkuZW5jb2Rpbmc7XG4gICAgICB2YXIgY2IgPSBlbnRyeS5jYWxsYmFjaztcbiAgICAgIHZhciBsZW4gPSBzdGF0ZS5vYmplY3RNb2RlID8gMSA6IGNodW5rLmxlbmd0aDtcblxuICAgICAgZG9Xcml0ZShzdHJlYW0sIHN0YXRlLCBmYWxzZSwgbGVuLCBjaHVuaywgZW5jb2RpbmcsIGNiKTtcbiAgICAgIGVudHJ5ID0gZW50cnkubmV4dDtcbiAgICAgIC8vIGlmIHdlIGRpZG4ndCBjYWxsIHRoZSBvbndyaXRlIGltbWVkaWF0ZWx5LCB0aGVuXG4gICAgICAvLyBpdCBtZWFucyB0aGF0IHdlIG5lZWQgdG8gd2FpdCB1bnRpbCBpdCBkb2VzLlxuICAgICAgLy8gYWxzbywgdGhhdCBtZWFucyB0aGF0IHRoZSBjaHVuayBhbmQgY2IgYXJlIGN1cnJlbnRseVxuICAgICAgLy8gYmVpbmcgcHJvY2Vzc2VkLCBzbyBtb3ZlIHRoZSBidWZmZXIgY291bnRlciBwYXN0IHRoZW0uXG4gICAgICBpZiAoc3RhdGUud3JpdGluZykge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZW50cnkgPT09IG51bGwpIHN0YXRlLmxhc3RCdWZmZXJlZFJlcXVlc3QgPSBudWxsO1xuICB9XG5cbiAgc3RhdGUuYnVmZmVyZWRSZXF1ZXN0Q291bnQgPSAwO1xuICBzdGF0ZS5idWZmZXJlZFJlcXVlc3QgPSBlbnRyeTtcbiAgc3RhdGUuYnVmZmVyUHJvY2Vzc2luZyA9IGZhbHNlO1xufVxuXG5Xcml0YWJsZS5wcm90b3R5cGUuX3dyaXRlID0gZnVuY3Rpb24gKGNodW5rLCBlbmNvZGluZywgY2IpIHtcbiAgY2IobmV3IEVycm9yKCdfd3JpdGUoKSBpcyBub3QgaW1wbGVtZW50ZWQnKSk7XG59O1xuXG5Xcml0YWJsZS5wcm90b3R5cGUuX3dyaXRldiA9IG51bGw7XG5cbldyaXRhYmxlLnByb3RvdHlwZS5lbmQgPSBmdW5jdGlvbiAoY2h1bmssIGVuY29kaW5nLCBjYikge1xuICB2YXIgc3RhdGUgPSB0aGlzLl93cml0YWJsZVN0YXRlO1xuXG4gIGlmICh0eXBlb2YgY2h1bmsgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYiA9IGNodW5rO1xuICAgIGNodW5rID0gbnVsbDtcbiAgICBlbmNvZGluZyA9IG51bGw7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGVuY29kaW5nID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2IgPSBlbmNvZGluZztcbiAgICBlbmNvZGluZyA9IG51bGw7XG4gIH1cblxuICBpZiAoY2h1bmsgIT09IG51bGwgJiYgY2h1bmsgIT09IHVuZGVmaW5lZCkgdGhpcy53cml0ZShjaHVuaywgZW5jb2RpbmcpO1xuXG4gIC8vIC5lbmQoKSBmdWxseSB1bmNvcmtzXG4gIGlmIChzdGF0ZS5jb3JrZWQpIHtcbiAgICBzdGF0ZS5jb3JrZWQgPSAxO1xuICAgIHRoaXMudW5jb3JrKCk7XG4gIH1cblxuICAvLyBpZ25vcmUgdW5uZWNlc3NhcnkgZW5kKCkgY2FsbHMuXG4gIGlmICghc3RhdGUuZW5kaW5nICYmICFzdGF0ZS5maW5pc2hlZCkgZW5kV3JpdGFibGUodGhpcywgc3RhdGUsIGNiKTtcbn07XG5cbmZ1bmN0aW9uIG5lZWRGaW5pc2goc3RhdGUpIHtcbiAgcmV0dXJuIHN0YXRlLmVuZGluZyAmJiBzdGF0ZS5sZW5ndGggPT09IDAgJiYgc3RhdGUuYnVmZmVyZWRSZXF1ZXN0ID09PSBudWxsICYmICFzdGF0ZS5maW5pc2hlZCAmJiAhc3RhdGUud3JpdGluZztcbn1cblxuZnVuY3Rpb24gcHJlZmluaXNoKHN0cmVhbSwgc3RhdGUpIHtcbiAgaWYgKCFzdGF0ZS5wcmVmaW5pc2hlZCkge1xuICAgIHN0YXRlLnByZWZpbmlzaGVkID0gdHJ1ZTtcbiAgICBzdHJlYW0uZW1pdCgncHJlZmluaXNoJyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZmluaXNoTWF5YmUoc3RyZWFtLCBzdGF0ZSkge1xuICB2YXIgbmVlZCA9IG5lZWRGaW5pc2goc3RhdGUpO1xuICBpZiAobmVlZCkge1xuICAgIGlmIChzdGF0ZS5wZW5kaW5nY2IgPT09IDApIHtcbiAgICAgIHByZWZpbmlzaChzdHJlYW0sIHN0YXRlKTtcbiAgICAgIHN0YXRlLmZpbmlzaGVkID0gdHJ1ZTtcbiAgICAgIHN0cmVhbS5lbWl0KCdmaW5pc2gnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcHJlZmluaXNoKHN0cmVhbSwgc3RhdGUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmVlZDtcbn1cblxuZnVuY3Rpb24gZW5kV3JpdGFibGUoc3RyZWFtLCBzdGF0ZSwgY2IpIHtcbiAgc3RhdGUuZW5kaW5nID0gdHJ1ZTtcbiAgZmluaXNoTWF5YmUoc3RyZWFtLCBzdGF0ZSk7XG4gIGlmIChjYikge1xuICAgIGlmIChzdGF0ZS5maW5pc2hlZCkgcHJvY2Vzc05leHRUaWNrKGNiKTtlbHNlIHN0cmVhbS5vbmNlKCdmaW5pc2gnLCBjYik7XG4gIH1cbiAgc3RhdGUuZW5kZWQgPSB0cnVlO1xuICBzdHJlYW0ud3JpdGFibGUgPSBmYWxzZTtcbn1cblxuLy8gSXQgc2VlbXMgYSBsaW5rZWQgbGlzdCBidXQgaXQgaXMgbm90XG4vLyB0aGVyZSB3aWxsIGJlIG9ubHkgMiBvZiB0aGVzZSBmb3IgZWFjaCBzdHJlYW1cbmZ1bmN0aW9uIENvcmtlZFJlcXVlc3Qoc3RhdGUpIHtcbiAgdmFyIF90aGlzID0gdGhpcztcblxuICB0aGlzLm5leHQgPSBudWxsO1xuICB0aGlzLmVudHJ5ID0gbnVsbDtcblxuICB0aGlzLmZpbmlzaCA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICB2YXIgZW50cnkgPSBfdGhpcy5lbnRyeTtcbiAgICBfdGhpcy5lbnRyeSA9IG51bGw7XG4gICAgd2hpbGUgKGVudHJ5KSB7XG4gICAgICB2YXIgY2IgPSBlbnRyeS5jYWxsYmFjaztcbiAgICAgIHN0YXRlLnBlbmRpbmdjYi0tO1xuICAgICAgY2IoZXJyKTtcbiAgICAgIGVudHJ5ID0gZW50cnkubmV4dDtcbiAgICB9XG4gICAgaWYgKHN0YXRlLmNvcmtlZFJlcXVlc3RzRnJlZSkge1xuICAgICAgc3RhdGUuY29ya2VkUmVxdWVzdHNGcmVlLm5leHQgPSBfdGhpcztcbiAgICB9IGVsc2Uge1xuICAgICAgc3RhdGUuY29ya2VkUmVxdWVzdHNGcmVlID0gX3RoaXM7XG4gICAgfVxuICB9O1xufSIsIid1c2Ugc3RyaWN0JztcblxudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJ2J1ZmZlcicpLkJ1ZmZlcjtcbi8qPHJlcGxhY2VtZW50PiovXG52YXIgYnVmZmVyU2hpbSA9IHJlcXVpcmUoJ2J1ZmZlci1zaGltcycpO1xuLyo8L3JlcGxhY2VtZW50PiovXG5cbm1vZHVsZS5leHBvcnRzID0gQnVmZmVyTGlzdDtcblxuZnVuY3Rpb24gQnVmZmVyTGlzdCgpIHtcbiAgdGhpcy5oZWFkID0gbnVsbDtcbiAgdGhpcy50YWlsID0gbnVsbDtcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5CdWZmZXJMaXN0LnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24gKHYpIHtcbiAgdmFyIGVudHJ5ID0geyBkYXRhOiB2LCBuZXh0OiBudWxsIH07XG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHRoaXMudGFpbC5uZXh0ID0gZW50cnk7ZWxzZSB0aGlzLmhlYWQgPSBlbnRyeTtcbiAgdGhpcy50YWlsID0gZW50cnk7XG4gICsrdGhpcy5sZW5ndGg7XG59O1xuXG5CdWZmZXJMaXN0LnByb3RvdHlwZS51bnNoaWZ0ID0gZnVuY3Rpb24gKHYpIHtcbiAgdmFyIGVudHJ5ID0geyBkYXRhOiB2LCBuZXh0OiB0aGlzLmhlYWQgfTtcbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSB0aGlzLnRhaWwgPSBlbnRyeTtcbiAgdGhpcy5oZWFkID0gZW50cnk7XG4gICsrdGhpcy5sZW5ndGg7XG59O1xuXG5CdWZmZXJMaXN0LnByb3RvdHlwZS5zaGlmdCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIHZhciByZXQgPSB0aGlzLmhlYWQuZGF0YTtcbiAgaWYgKHRoaXMubGVuZ3RoID09PSAxKSB0aGlzLmhlYWQgPSB0aGlzLnRhaWwgPSBudWxsO2Vsc2UgdGhpcy5oZWFkID0gdGhpcy5oZWFkLm5leHQ7XG4gIC0tdGhpcy5sZW5ndGg7XG4gIHJldHVybiByZXQ7XG59O1xuXG5CdWZmZXJMaXN0LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy5oZWFkID0gdGhpcy50YWlsID0gbnVsbDtcbiAgdGhpcy5sZW5ndGggPSAwO1xufTtcblxuQnVmZmVyTGlzdC5wcm90b3R5cGUuam9pbiA9IGZ1bmN0aW9uIChzKSB7XG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICB2YXIgcCA9IHRoaXMuaGVhZDtcbiAgdmFyIHJldCA9ICcnICsgcC5kYXRhO1xuICB3aGlsZSAocCA9IHAubmV4dCkge1xuICAgIHJldCArPSBzICsgcC5kYXRhO1xuICB9cmV0dXJuIHJldDtcbn07XG5cbkJ1ZmZlckxpc3QucHJvdG90eXBlLmNvbmNhdCA9IGZ1bmN0aW9uIChuKSB7XG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGJ1ZmZlclNoaW0uYWxsb2MoMCk7XG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHRoaXMuaGVhZC5kYXRhO1xuICB2YXIgcmV0ID0gYnVmZmVyU2hpbS5hbGxvY1Vuc2FmZShuID4+PiAwKTtcbiAgdmFyIHAgPSB0aGlzLmhlYWQ7XG4gIHZhciBpID0gMDtcbiAgd2hpbGUgKHApIHtcbiAgICBwLmRhdGEuY29weShyZXQsIGkpO1xuICAgIGkgKz0gcC5kYXRhLmxlbmd0aDtcbiAgICBwID0gcC5uZXh0O1xuICB9XG4gIHJldHVybiByZXQ7XG59OyIsInZhciBTdHJlYW0gPSAoZnVuY3Rpb24gKCl7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlcXVpcmUoJ3N0JyArICdyZWFtJyk7IC8vIGhhY2sgdG8gZml4IGEgY2lyY3VsYXIgZGVwZW5kZW5jeSBpc3N1ZSB3aGVuIHVzZWQgd2l0aCBicm93c2VyaWZ5XG4gIH0gY2F0Y2goXyl7fVxufSgpKTtcbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vbGliL19zdHJlYW1fcmVhZGFibGUuanMnKTtcbmV4cG9ydHMuU3RyZWFtID0gU3RyZWFtIHx8IGV4cG9ydHM7XG5leHBvcnRzLlJlYWRhYmxlID0gZXhwb3J0cztcbmV4cG9ydHMuV3JpdGFibGUgPSByZXF1aXJlKCcuL2xpYi9fc3RyZWFtX3dyaXRhYmxlLmpzJyk7XG5leHBvcnRzLkR1cGxleCA9IHJlcXVpcmUoJy4vbGliL19zdHJlYW1fZHVwbGV4LmpzJyk7XG5leHBvcnRzLlRyYW5zZm9ybSA9IHJlcXVpcmUoJy4vbGliL19zdHJlYW1fdHJhbnNmb3JtLmpzJyk7XG5leHBvcnRzLlBhc3NUaHJvdWdoID0gcmVxdWlyZSgnLi9saWIvX3N0cmVhbV9wYXNzdGhyb3VnaC5qcycpO1xuXG5pZiAoIXByb2Nlc3MuYnJvd3NlciAmJiBwcm9jZXNzLmVudi5SRUFEQUJMRV9TVFJFQU0gPT09ICdkaXNhYmxlJyAmJiBTdHJlYW0pIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBTdHJlYW07XG59XG4iLCIoZnVuY3Rpb24gKCkge1xuICAgIHZhciAvKlxuICogUnVzaGEsIGEgSmF2YVNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiB0aGUgU2VjdXJlIEhhc2ggQWxnb3JpdGhtLCBTSEEtMSxcbiAqIGFzIGRlZmluZWQgaW4gRklQUyBQVUIgMTgwLTEsIHR1bmVkIGZvciBoaWdoIHBlcmZvcm1hbmNlIHdpdGggbGFyZ2UgaW5wdXRzLlxuICogKGh0dHA6Ly9naXRodWIuY29tL3NyaWpzL3J1c2hhKVxuICpcbiAqIEluc3BpcmVkIGJ5IFBhdWwgSm9obnN0b25zIGltcGxlbWVudGF0aW9uIChodHRwOi8vcGFqaG9tZS5vcmcudWsvY3J5cHQvbWQ1KS5cbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTMgU2FtIFJpanMgKGh0dHA6Ly9hd2VzYW0uZGUpLlxuICogUmVsZWFzZWQgdW5kZXIgdGhlIHRlcm1zIG9mIHRoZSBNSVQgbGljZW5zZSBhcyBmb2xsb3dzOlxuICpcbiAqIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4gKiBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksXG4gKiB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uXG4gKiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSxcbiAqIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZVxuICogU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcbiAqXG4gKiBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuICogYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4gKlxuICogVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuICogSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG4gKiBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbiAqIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbiAqIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HXG4gKiBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTXG4gKiBJTiBUSEUgU09GVFdBUkUuXG4gKi9cbiAgICB1dGlsID0ge1xuICAgICAgICBnZXREYXRhVHlwZTogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZGF0YSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ3N0cmluZyc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGF0YSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdhcnJheSc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZW9mIGdsb2JhbCAhPT0gJ3VuZGVmaW5lZCcgJiYgZ2xvYmFsLkJ1ZmZlciAmJiBnbG9iYWwuQnVmZmVyLmlzQnVmZmVyKGRhdGEpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdidWZmZXInO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgICAgICAgICAgIHJldHVybiAnYXJyYXlidWZmZXInO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRhdGEuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ3ZpZXcnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRhdGEgaW5zdGFuY2VvZiBCbG9iKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdibG9iJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVW5zdXBwb3J0ZWQgZGF0YSB0eXBlLicpO1xuICAgICAgICB9XG4gICAgfTtcbiAgICBmdW5jdGlvbiBSdXNoYShjaHVua1NpemUpIHtcbiAgICAgICAgJ3VzZSBzdHJpY3QnO1xuICAgICAgICB2YXIgLy8gUHJpdmF0ZSBvYmplY3Qgc3RydWN0dXJlLlxuICAgICAgICBzZWxmJDIgPSB7IGZpbGw6IDAgfTtcbiAgICAgICAgdmFyIC8vIENhbGN1bGF0ZSB0aGUgbGVuZ3RoIG9mIGJ1ZmZlciB0aGF0IHRoZSBzaGExIHJvdXRpbmUgdXNlc1xuICAgICAgICAvLyBpbmNsdWRpbmcgdGhlIHBhZGRpbmcuXG4gICAgICAgIHBhZGxlbiA9IGZ1bmN0aW9uIChsZW4pIHtcbiAgICAgICAgICAgIGZvciAobGVuICs9IDk7IGxlbiAlIDY0ID4gMDsgbGVuICs9IDEpO1xuICAgICAgICAgICAgcmV0dXJuIGxlbjtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIHBhZFplcm9lcyA9IGZ1bmN0aW9uIChiaW4sIGxlbikge1xuICAgICAgICAgICAgdmFyIGg4ID0gbmV3IFVpbnQ4QXJyYXkoYmluLmJ1ZmZlcik7XG4gICAgICAgICAgICB2YXIgb20gPSBsZW4gJSA0LCBhbGlnbiA9IGxlbiAtIG9tO1xuICAgICAgICAgICAgc3dpdGNoIChvbSkge1xuICAgICAgICAgICAgY2FzZSAwOlxuICAgICAgICAgICAgICAgIGg4W2FsaWduICsgM10gPSAwO1xuICAgICAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgICAgIGg4W2FsaWduICsgMl0gPSAwO1xuICAgICAgICAgICAgY2FzZSAyOlxuICAgICAgICAgICAgICAgIGg4W2FsaWduICsgMV0gPSAwO1xuICAgICAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgICAgIGg4W2FsaWduICsgMF0gPSAwO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yICh2YXIgaSQyID0gKGxlbiA+PiAyKSArIDE7IGkkMiA8IGJpbi5sZW5ndGg7IGkkMisrKVxuICAgICAgICAgICAgICAgIGJpbltpJDJdID0gMDtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIHBhZERhdGEgPSBmdW5jdGlvbiAoYmluLCBjaHVua0xlbiwgbXNnTGVuKSB7XG4gICAgICAgICAgICBiaW5bY2h1bmtMZW4gPj4gMl0gfD0gMTI4IDw8IDI0IC0gKGNodW5rTGVuICUgNCA8PCAzKTtcbiAgICAgICAgICAgIC8vIFRvIHN1cHBvcnQgbXNnTGVuID49IDIgR2lCLCB1c2UgYSBmbG9hdCBkaXZpc2lvbiB3aGVuIGNvbXB1dGluZyB0aGVcbiAgICAgICAgICAgIC8vIGhpZ2ggMzItYml0cyBvZiB0aGUgYmlnLWVuZGlhbiBtZXNzYWdlIGxlbmd0aCBpbiBiaXRzLlxuICAgICAgICAgICAgYmluWygoY2h1bmtMZW4gPj4gMikgKyAyICYgfjE1KSArIDE0XSA9IG1zZ0xlbiAvICgxIDw8IDI5KSB8IDA7XG4gICAgICAgICAgICBiaW5bKChjaHVua0xlbiA+PiAyKSArIDIgJiB+MTUpICsgMTVdID0gbXNnTGVuIDw8IDM7XG4gICAgICAgIH07XG4gICAgICAgIHZhciAvLyBDb252ZXJ0IGEgYmluYXJ5IHN0cmluZyBhbmQgd3JpdGUgaXQgdG8gdGhlIGhlYXAuXG4gICAgICAgIC8vIEEgYmluYXJ5IHN0cmluZyBpcyBleHBlY3RlZCB0byBvbmx5IGNvbnRhaW4gY2hhciBjb2RlcyA8IDI1Ni5cbiAgICAgICAgY29udlN0ciA9IGZ1bmN0aW9uIChIOCwgSDMyLCBzdGFydCwgbGVuLCBvZmYpIHtcbiAgICAgICAgICAgIHZhciBzdHIgPSB0aGlzLCBpJDIsIG9tID0gb2ZmICUgNCwgbG0gPSAobGVuICsgb20pICUgNCwgaiA9IGxlbiAtIGxtO1xuICAgICAgICAgICAgc3dpdGNoIChvbSkge1xuICAgICAgICAgICAgY2FzZSAwOlxuICAgICAgICAgICAgICAgIEg4W29mZl0gPSBzdHIuY2hhckNvZGVBdChzdGFydCArIDMpO1xuICAgICAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIDEgLSAob20gPDwgMSkgfCAwXSA9IHN0ci5jaGFyQ29kZUF0KHN0YXJ0ICsgMik7XG4gICAgICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgICAgICAgSDhbb2ZmICsgMiAtIChvbSA8PCAxKSB8IDBdID0gc3RyLmNoYXJDb2RlQXQoc3RhcnQgKyAxKTtcbiAgICAgICAgICAgIGNhc2UgMzpcbiAgICAgICAgICAgICAgICBIOFtvZmYgKyAzIC0gKG9tIDw8IDEpIHwgMF0gPSBzdHIuY2hhckNvZGVBdChzdGFydCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobGVuIDwgbG0gKyBvbSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvciAoaSQyID0gNCAtIG9tOyBpJDIgPCBqOyBpJDIgPSBpJDIgKyA0IHwgMCkge1xuICAgICAgICAgICAgICAgIEgzMltvZmYgKyBpJDIgPj4gMl0gPSBzdHIuY2hhckNvZGVBdChzdGFydCArIGkkMikgPDwgMjQgfCBzdHIuY2hhckNvZGVBdChzdGFydCArIGkkMiArIDEpIDw8IDE2IHwgc3RyLmNoYXJDb2RlQXQoc3RhcnQgKyBpJDIgKyAyKSA8PCA4IHwgc3RyLmNoYXJDb2RlQXQoc3RhcnQgKyBpJDIgKyAzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN3aXRjaCAobG0pIHtcbiAgICAgICAgICAgIGNhc2UgMzpcbiAgICAgICAgICAgICAgICBIOFtvZmYgKyBqICsgMSB8IDBdID0gc3RyLmNoYXJDb2RlQXQoc3RhcnQgKyBqICsgMik7XG4gICAgICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgICAgICAgSDhbb2ZmICsgaiArIDIgfCAwXSA9IHN0ci5jaGFyQ29kZUF0KHN0YXJ0ICsgaiArIDEpO1xuICAgICAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIGogKyAzIHwgMF0gPSBzdHIuY2hhckNvZGVBdChzdGFydCArIGopO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICB2YXIgLy8gQ29udmVydCBhIGJ1ZmZlciBvciBhcnJheSBhbmQgd3JpdGUgaXQgdG8gdGhlIGhlYXAuXG4gICAgICAgIC8vIFRoZSBidWZmZXIgb3IgYXJyYXkgaXMgZXhwZWN0ZWQgdG8gb25seSBjb250YWluIGVsZW1lbnRzIDwgMjU2LlxuICAgICAgICBjb252QnVmID0gZnVuY3Rpb24gKEg4LCBIMzIsIHN0YXJ0LCBsZW4sIG9mZikge1xuICAgICAgICAgICAgdmFyIGJ1ZiA9IHRoaXMsIGkkMiwgb20gPSBvZmYgJSA0LCBsbSA9IChsZW4gKyBvbSkgJSA0LCBqID0gbGVuIC0gbG07XG4gICAgICAgICAgICBzd2l0Y2ggKG9tKSB7XG4gICAgICAgICAgICBjYXNlIDA6XG4gICAgICAgICAgICAgICAgSDhbb2ZmXSA9IGJ1ZltzdGFydCArIDNdO1xuICAgICAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIDEgLSAob20gPDwgMSkgfCAwXSA9IGJ1ZltzdGFydCArIDJdO1xuICAgICAgICAgICAgY2FzZSAyOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIDIgLSAob20gPDwgMSkgfCAwXSA9IGJ1ZltzdGFydCArIDFdO1xuICAgICAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIDMgLSAob20gPDwgMSkgfCAwXSA9IGJ1ZltzdGFydF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobGVuIDwgbG0gKyBvbSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvciAoaSQyID0gNCAtIG9tOyBpJDIgPCBqOyBpJDIgPSBpJDIgKyA0IHwgMCkge1xuICAgICAgICAgICAgICAgIEgzMltvZmYgKyBpJDIgPj4gMiB8IDBdID0gYnVmW3N0YXJ0ICsgaSQyXSA8PCAyNCB8IGJ1ZltzdGFydCArIGkkMiArIDFdIDw8IDE2IHwgYnVmW3N0YXJ0ICsgaSQyICsgMl0gPDwgOCB8IGJ1ZltzdGFydCArIGkkMiArIDNdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3dpdGNoIChsbSkge1xuICAgICAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIGogKyAxIHwgMF0gPSBidWZbc3RhcnQgKyBqICsgMl07XG4gICAgICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgICAgICAgSDhbb2ZmICsgaiArIDIgfCAwXSA9IGJ1ZltzdGFydCArIGogKyAxXTtcbiAgICAgICAgICAgIGNhc2UgMTpcbiAgICAgICAgICAgICAgICBIOFtvZmYgKyBqICsgMyB8IDBdID0gYnVmW3N0YXJ0ICsgal07XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHZhciBjb252QmxvYiA9IGZ1bmN0aW9uIChIOCwgSDMyLCBzdGFydCwgbGVuLCBvZmYpIHtcbiAgICAgICAgICAgIHZhciBibG9iID0gdGhpcywgaSQyLCBvbSA9IG9mZiAlIDQsIGxtID0gKGxlbiArIG9tKSAlIDQsIGogPSBsZW4gLSBsbTtcbiAgICAgICAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheShyZWFkZXIucmVhZEFzQXJyYXlCdWZmZXIoYmxvYi5zbGljZShzdGFydCwgc3RhcnQgKyBsZW4pKSk7XG4gICAgICAgICAgICBzd2l0Y2ggKG9tKSB7XG4gICAgICAgICAgICBjYXNlIDA6XG4gICAgICAgICAgICAgICAgSDhbb2ZmXSA9IGJ1ZlszXTtcbiAgICAgICAgICAgIGNhc2UgMTpcbiAgICAgICAgICAgICAgICBIOFtvZmYgKyAxIC0gKG9tIDw8IDEpIHwgMF0gPSBidWZbMl07XG4gICAgICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgICAgICAgSDhbb2ZmICsgMiAtIChvbSA8PCAxKSB8IDBdID0gYnVmWzFdO1xuICAgICAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIDMgLSAob20gPDwgMSkgfCAwXSA9IGJ1ZlswXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChsZW4gPCBsbSArIG9tKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChpJDIgPSA0IC0gb207IGkkMiA8IGo7IGkkMiA9IGkkMiArIDQgfCAwKSB7XG4gICAgICAgICAgICAgICAgSDMyW29mZiArIGkkMiA+PiAyIHwgMF0gPSBidWZbaSQyXSA8PCAyNCB8IGJ1ZltpJDIgKyAxXSA8PCAxNiB8IGJ1ZltpJDIgKyAyXSA8PCA4IHwgYnVmW2kkMiArIDNdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3dpdGNoIChsbSkge1xuICAgICAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIGogKyAxIHwgMF0gPSBidWZbaiArIDJdO1xuICAgICAgICAgICAgY2FzZSAyOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIGogKyAyIHwgMF0gPSBidWZbaiArIDFdO1xuICAgICAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgICAgIEg4W29mZiArIGogKyAzIHwgMF0gPSBidWZbal07XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHZhciBjb252Rm4gPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3dpdGNoICh1dGlsLmdldERhdGFUeXBlKGRhdGEpKSB7XG4gICAgICAgICAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgICAgICAgICAgIHJldHVybiBjb252U3RyLmJpbmQoZGF0YSk7XG4gICAgICAgICAgICBjYXNlICdhcnJheSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnZCdWYuYmluZChkYXRhKTtcbiAgICAgICAgICAgIGNhc2UgJ2J1ZmZlcic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnZCdWYuYmluZChkYXRhKTtcbiAgICAgICAgICAgIGNhc2UgJ2FycmF5YnVmZmVyJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udkJ1Zi5iaW5kKG5ldyBVaW50OEFycmF5KGRhdGEpKTtcbiAgICAgICAgICAgIGNhc2UgJ3ZpZXcnOlxuICAgICAgICAgICAgICAgIHJldHVybiBjb252QnVmLmJpbmQobmV3IFVpbnQ4QXJyYXkoZGF0YS5idWZmZXIsIGRhdGEuYnl0ZU9mZnNldCwgZGF0YS5ieXRlTGVuZ3RoKSk7XG4gICAgICAgICAgICBjYXNlICdibG9iJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udkJsb2IuYmluZChkYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIHNsaWNlID0gZnVuY3Rpb24gKGRhdGEsIG9mZnNldCkge1xuICAgICAgICAgICAgc3dpdGNoICh1dGlsLmdldERhdGFUeXBlKGRhdGEpKSB7XG4gICAgICAgICAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgICAgICAgICAgIHJldHVybiBkYXRhLnNsaWNlKG9mZnNldCk7XG4gICAgICAgICAgICBjYXNlICdhcnJheSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRhdGEuc2xpY2Uob2Zmc2V0KTtcbiAgICAgICAgICAgIGNhc2UgJ2J1ZmZlcic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRhdGEuc2xpY2Uob2Zmc2V0KTtcbiAgICAgICAgICAgIGNhc2UgJ2FycmF5YnVmZmVyJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gZGF0YS5zbGljZShvZmZzZXQpO1xuICAgICAgICAgICAgY2FzZSAndmlldyc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGRhdGEuYnVmZmVyLnNsaWNlKG9mZnNldCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHZhciAvLyBQcmVjb21wdXRlIDAwIC0gZmYgc3RyaW5nc1xuICAgICAgICBwcmVjb21wdXRlZEhleCA9IG5ldyBBcnJheSgyNTYpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDI1NjsgaSsrKSB7XG4gICAgICAgICAgICBwcmVjb21wdXRlZEhleFtpXSA9IChpIDwgMTYgPyAnMCcgOiAnJykgKyBpLnRvU3RyaW5nKDE2KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgLy8gQ29udmVydCBhbiBBcnJheUJ1ZmZlciBpbnRvIGl0cyBoZXhhZGVjaW1hbCBzdHJpbmcgcmVwcmVzZW50YXRpb24uXG4gICAgICAgIGhleCA9IGZ1bmN0aW9uIChhcnJheUJ1ZmZlcikge1xuICAgICAgICAgICAgdmFyIGJpbmFycmF5ID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXlCdWZmZXIpO1xuICAgICAgICAgICAgdmFyIHJlcyA9IG5ldyBBcnJheShhcnJheUJ1ZmZlci5ieXRlTGVuZ3RoKTtcbiAgICAgICAgICAgIGZvciAodmFyIGkkMiA9IDA7IGkkMiA8IHJlcy5sZW5ndGg7IGkkMisrKSB7XG4gICAgICAgICAgICAgICAgcmVzW2kkMl0gPSBwcmVjb21wdXRlZEhleFtiaW5hcnJheVtpJDJdXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXMuam9pbignJyk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBjZWlsSGVhcFNpemUgPSBmdW5jdGlvbiAodikge1xuICAgICAgICAgICAgLy8gVGhlIGFzbS5qcyBzcGVjIHNheXM6XG4gICAgICAgICAgICAvLyBUaGUgaGVhcCBvYmplY3QncyBieXRlTGVuZ3RoIG11c3QgYmUgZWl0aGVyXG4gICAgICAgICAgICAvLyAyXm4gZm9yIG4gaW4gWzEyLCAyNCkgb3IgMl4yNCAqIG4gZm9yIG4g4omlIDEuXG4gICAgICAgICAgICAvLyBBbHNvLCBieXRlTGVuZ3RocyBzbWFsbGVyIHRoYW4gMl4xNiBhcmUgZGVwcmVjYXRlZC5cbiAgICAgICAgICAgIHZhciBwO1xuICAgICAgICAgICAgaWYgKC8vIElmIHYgaXMgc21hbGxlciB0aGFuIDJeMTYsIHRoZSBzbWFsbGVzdCBwb3NzaWJsZSBzb2x1dGlvblxuICAgICAgICAgICAgICAgIC8vIGlzIDJeMTYuXG4gICAgICAgICAgICAgICAgdiA8PSA2NTUzNilcbiAgICAgICAgICAgICAgICByZXR1cm4gNjU1MzY7XG4gICAgICAgICAgICBpZiAoLy8gSWYgdiA8IDJeMjQsIHdlIHJvdW5kIHVwIHRvIDJebixcbiAgICAgICAgICAgICAgICAvLyBvdGhlcndpc2Ugd2Ugcm91bmQgdXAgdG8gMl4yNCAqIG4uXG4gICAgICAgICAgICAgICAgdiA8IDE2Nzc3MjE2KSB7XG4gICAgICAgICAgICAgICAgZm9yIChwID0gMTsgcCA8IHY7IHAgPSBwIDw8IDEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBmb3IgKHAgPSAxNjc3NzIxNjsgcCA8IHY7IHAgKz0gMTY3NzcyMTYpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHA7XG4gICAgICAgIH07XG4gICAgICAgIHZhciAvLyBJbml0aWFsaXplIHRoZSBpbnRlcm5hbCBkYXRhIHN0cnVjdHVyZXMgdG8gYSBuZXcgY2FwYWNpdHkuXG4gICAgICAgIGluaXQgPSBmdW5jdGlvbiAoc2l6ZSkge1xuICAgICAgICAgICAgaWYgKHNpemUgJSA2NCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NodW5rIHNpemUgbXVzdCBiZSBhIG11bHRpcGxlIG9mIDEyOCBiaXQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGYkMi5vZmZzZXQgPSAwO1xuICAgICAgICAgICAgc2VsZiQyLm1heENodW5rTGVuID0gc2l6ZTtcbiAgICAgICAgICAgIHNlbGYkMi5wYWRNYXhDaHVua0xlbiA9IHBhZGxlbihzaXplKTtcbiAgICAgICAgICAgIC8vIFRoZSBzaXplIG9mIHRoZSBoZWFwIGlzIHRoZSBzdW0gb2Y6XG4gICAgICAgICAgICAvLyAxLiBUaGUgcGFkZGVkIGlucHV0IG1lc3NhZ2Ugc2l6ZVxuICAgICAgICAgICAgLy8gMi4gVGhlIGV4dGVuZGVkIHNwYWNlIHRoZSBhbGdvcml0aG0gbmVlZHMgKDMyMCBieXRlKVxuICAgICAgICAgICAgLy8gMy4gVGhlIDE2MCBiaXQgc3RhdGUgdGhlIGFsZ29yaXRtIHVzZXNcbiAgICAgICAgICAgIHNlbGYkMi5oZWFwID0gbmV3IEFycmF5QnVmZmVyKGNlaWxIZWFwU2l6ZShzZWxmJDIucGFkTWF4Q2h1bmtMZW4gKyAzMjAgKyAyMCkpO1xuICAgICAgICAgICAgc2VsZiQyLmgzMiA9IG5ldyBJbnQzMkFycmF5KHNlbGYkMi5oZWFwKTtcbiAgICAgICAgICAgIHNlbGYkMi5oOCA9IG5ldyBJbnQ4QXJyYXkoc2VsZiQyLmhlYXApO1xuICAgICAgICAgICAgc2VsZiQyLmNvcmUgPSBuZXcgUnVzaGEuX2NvcmUoe1xuICAgICAgICAgICAgICAgIEludDMyQXJyYXk6IEludDMyQXJyYXksXG4gICAgICAgICAgICAgICAgRGF0YVZpZXc6IERhdGFWaWV3XG4gICAgICAgICAgICB9LCB7fSwgc2VsZiQyLmhlYXApO1xuICAgICAgICAgICAgc2VsZiQyLmJ1ZmZlciA9IG51bGw7XG4gICAgICAgIH07XG4gICAgICAgIC8vIElpbml0aWFsaXpldGhlIGRhdGFzdHJ1Y3R1cmVzIGFjY29yZGluZ1xuICAgICAgICAvLyB0byBhIGNodW5rIHNpeXplLlxuICAgICAgICBpbml0KGNodW5rU2l6ZSB8fCA2NCAqIDEwMjQpO1xuICAgICAgICB2YXIgaW5pdFN0YXRlID0gZnVuY3Rpb24gKGhlYXAsIHBhZE1zZ0xlbikge1xuICAgICAgICAgICAgc2VsZiQyLm9mZnNldCA9IDA7XG4gICAgICAgICAgICB2YXIgaW8gPSBuZXcgSW50MzJBcnJheShoZWFwLCBwYWRNc2dMZW4gKyAzMjAsIDUpO1xuICAgICAgICAgICAgaW9bMF0gPSAxNzMyNTg0MTkzO1xuICAgICAgICAgICAgaW9bMV0gPSAtMjcxNzMzODc5O1xuICAgICAgICAgICAgaW9bMl0gPSAtMTczMjU4NDE5NDtcbiAgICAgICAgICAgIGlvWzNdID0gMjcxNzMzODc4O1xuICAgICAgICAgICAgaW9bNF0gPSAtMTAwOTU4OTc3NjtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIHBhZENodW5rID0gZnVuY3Rpb24gKGNodW5rTGVuLCBtc2dMZW4pIHtcbiAgICAgICAgICAgIHZhciBwYWRDaHVua0xlbiA9IHBhZGxlbihjaHVua0xlbik7XG4gICAgICAgICAgICB2YXIgdmlldyA9IG5ldyBJbnQzMkFycmF5KHNlbGYkMi5oZWFwLCAwLCBwYWRDaHVua0xlbiA+PiAyKTtcbiAgICAgICAgICAgIHBhZFplcm9lcyh2aWV3LCBjaHVua0xlbik7XG4gICAgICAgICAgICBwYWREYXRhKHZpZXcsIGNodW5rTGVuLCBtc2dMZW4pO1xuICAgICAgICAgICAgcmV0dXJuIHBhZENodW5rTGVuO1xuICAgICAgICB9O1xuICAgICAgICB2YXIgLy8gV3JpdGUgZGF0YSB0byB0aGUgaGVhcC5cbiAgICAgICAgd3JpdGUgPSBmdW5jdGlvbiAoZGF0YSwgY2h1bmtPZmZzZXQsIGNodW5rTGVuLCBvZmYpIHtcbiAgICAgICAgICAgIGNvbnZGbihkYXRhKShzZWxmJDIuaDgsIHNlbGYkMi5oMzIsIGNodW5rT2Zmc2V0LCBjaHVua0xlbiwgb2ZmIHx8IDApO1xuICAgICAgICB9O1xuICAgICAgICB2YXIgLy8gSW5pdGlhbGl6ZSBhbmQgY2FsbCB0aGUgUnVzaGFDb3JlLFxuICAgICAgICAvLyBhc3N1bWluZyBhbiBpbnB1dCBidWZmZXIgb2YgbGVuZ3RoIGxlbiAqIDQuXG4gICAgICAgIGNvcmVDYWxsID0gZnVuY3Rpb24gKGRhdGEsIGNodW5rT2Zmc2V0LCBjaHVua0xlbiwgbXNnTGVuLCBmaW5hbGl6ZSkge1xuICAgICAgICAgICAgdmFyIHBhZENodW5rTGVuID0gY2h1bmtMZW47XG4gICAgICAgICAgICB3cml0ZShkYXRhLCBjaHVua09mZnNldCwgY2h1bmtMZW4pO1xuICAgICAgICAgICAgaWYgKGZpbmFsaXplKSB7XG4gICAgICAgICAgICAgICAgcGFkQ2h1bmtMZW4gPSBwYWRDaHVuayhjaHVua0xlbiwgbXNnTGVuKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGYkMi5jb3JlLmhhc2gocGFkQ2h1bmtMZW4sIHNlbGYkMi5wYWRNYXhDaHVua0xlbik7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBnZXRSYXdEaWdlc3QgPSBmdW5jdGlvbiAoaGVhcCwgcGFkTWF4Q2h1bmtMZW4pIHtcbiAgICAgICAgICAgIHZhciBpbyA9IG5ldyBJbnQzMkFycmF5KGhlYXAsIHBhZE1heENodW5rTGVuICsgMzIwLCA1KTtcbiAgICAgICAgICAgIHZhciBvdXQgPSBuZXcgSW50MzJBcnJheSg1KTtcbiAgICAgICAgICAgIHZhciBhcnIgPSBuZXcgRGF0YVZpZXcob3V0LmJ1ZmZlcik7XG4gICAgICAgICAgICBhcnIuc2V0SW50MzIoMCwgaW9bMF0sIGZhbHNlKTtcbiAgICAgICAgICAgIGFyci5zZXRJbnQzMig0LCBpb1sxXSwgZmFsc2UpO1xuICAgICAgICAgICAgYXJyLnNldEludDMyKDgsIGlvWzJdLCBmYWxzZSk7XG4gICAgICAgICAgICBhcnIuc2V0SW50MzIoMTIsIGlvWzNdLCBmYWxzZSk7XG4gICAgICAgICAgICBhcnIuc2V0SW50MzIoMTYsIGlvWzRdLCBmYWxzZSk7XG4gICAgICAgICAgICByZXR1cm4gb3V0O1xuICAgICAgICB9O1xuICAgICAgICB2YXIgLy8gQ2FsY3VsYXRlIHRoZSBoYXNoIGRpZ2VzdCBhcyBhbiBhcnJheSBvZiA1IDMyYml0IGludGVnZXJzLlxuICAgICAgICByYXdEaWdlc3QgPSB0aGlzLnJhd0RpZ2VzdCA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgICAgIHZhciBtc2dMZW4gPSBzdHIuYnl0ZUxlbmd0aCB8fCBzdHIubGVuZ3RoIHx8IHN0ci5zaXplIHx8IDA7XG4gICAgICAgICAgICBpbml0U3RhdGUoc2VsZiQyLmhlYXAsIHNlbGYkMi5wYWRNYXhDaHVua0xlbik7XG4gICAgICAgICAgICB2YXIgY2h1bmtPZmZzZXQgPSAwLCBjaHVua0xlbiA9IHNlbGYkMi5tYXhDaHVua0xlbiwgbGFzdDtcbiAgICAgICAgICAgIGZvciAoY2h1bmtPZmZzZXQgPSAwOyBtc2dMZW4gPiBjaHVua09mZnNldCArIGNodW5rTGVuOyBjaHVua09mZnNldCArPSBjaHVua0xlbikge1xuICAgICAgICAgICAgICAgIGNvcmVDYWxsKHN0ciwgY2h1bmtPZmZzZXQsIGNodW5rTGVuLCBtc2dMZW4sIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvcmVDYWxsKHN0ciwgY2h1bmtPZmZzZXQsIG1zZ0xlbiAtIGNodW5rT2Zmc2V0LCBtc2dMZW4sIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuIGdldFJhd0RpZ2VzdChzZWxmJDIuaGVhcCwgc2VsZiQyLnBhZE1heENodW5rTGVuKTtcbiAgICAgICAgfTtcbiAgICAgICAgLy8gVGhlIGRpZ2VzdCBhbmQgZGlnZXN0RnJvbSogaW50ZXJmYWNlIHJldHVybnMgdGhlIGhhc2ggZGlnZXN0XG4gICAgICAgIC8vIGFzIGEgaGV4IHN0cmluZy5cbiAgICAgICAgdGhpcy5kaWdlc3QgPSB0aGlzLmRpZ2VzdEZyb21TdHJpbmcgPSB0aGlzLmRpZ2VzdEZyb21CdWZmZXIgPSB0aGlzLmRpZ2VzdEZyb21BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgICAgIHJldHVybiBoZXgocmF3RGlnZXN0KHN0cikuYnVmZmVyKTtcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5yZXNldFN0YXRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaW5pdFN0YXRlKHNlbGYkMi5oZWFwLCBzZWxmJDIucGFkTWF4Q2h1bmtMZW4pO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuYXBwZW5kID0gZnVuY3Rpb24gKGNodW5rKSB7XG4gICAgICAgICAgICB2YXIgY2h1bmtPZmZzZXQgPSAwO1xuICAgICAgICAgICAgdmFyIGNodW5rTGVuID0gY2h1bmsuYnl0ZUxlbmd0aCB8fCBjaHVuay5sZW5ndGggfHwgY2h1bmsuc2l6ZSB8fCAwO1xuICAgICAgICAgICAgdmFyIHR1cm5PZmZzZXQgPSBzZWxmJDIub2Zmc2V0ICUgc2VsZiQyLm1heENodW5rTGVuO1xuICAgICAgICAgICAgdmFyIGlucHV0TGVuO1xuICAgICAgICAgICAgc2VsZiQyLm9mZnNldCArPSBjaHVua0xlbjtcbiAgICAgICAgICAgIHdoaWxlIChjaHVua09mZnNldCA8IGNodW5rTGVuKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRMZW4gPSBNYXRoLm1pbihjaHVua0xlbiAtIGNodW5rT2Zmc2V0LCBzZWxmJDIubWF4Q2h1bmtMZW4gLSB0dXJuT2Zmc2V0KTtcbiAgICAgICAgICAgICAgICB3cml0ZShjaHVuaywgY2h1bmtPZmZzZXQsIGlucHV0TGVuLCB0dXJuT2Zmc2V0KTtcbiAgICAgICAgICAgICAgICB0dXJuT2Zmc2V0ICs9IGlucHV0TGVuO1xuICAgICAgICAgICAgICAgIGNodW5rT2Zmc2V0ICs9IGlucHV0TGVuO1xuICAgICAgICAgICAgICAgIGlmICh0dXJuT2Zmc2V0ID09PSBzZWxmJDIubWF4Q2h1bmtMZW4pIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZiQyLmNvcmUuaGFzaChzZWxmJDIubWF4Q2h1bmtMZW4sIHNlbGYkMi5wYWRNYXhDaHVua0xlbik7XG4gICAgICAgICAgICAgICAgICAgIHR1cm5PZmZzZXQgPSAwO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9O1xuICAgICAgICB0aGlzLmdldFN0YXRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHR1cm5PZmZzZXQgPSBzZWxmJDIub2Zmc2V0ICUgc2VsZiQyLm1heENodW5rTGVuO1xuICAgICAgICAgICAgdmFyIGhlYXA7XG4gICAgICAgICAgICBpZiAoIXR1cm5PZmZzZXQpIHtcbiAgICAgICAgICAgICAgICB2YXIgaW8gPSBuZXcgSW50MzJBcnJheShzZWxmJDIuaGVhcCwgc2VsZiQyLnBhZE1heENodW5rTGVuICsgMzIwLCA1KTtcbiAgICAgICAgICAgICAgICBoZWFwID0gaW8uYnVmZmVyLnNsaWNlKGlvLmJ5dGVPZmZzZXQsIGlvLmJ5dGVPZmZzZXQgKyBpby5ieXRlTGVuZ3RoKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaGVhcCA9IHNlbGYkMi5oZWFwLnNsaWNlKDApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBvZmZzZXQ6IHNlbGYkMi5vZmZzZXQsXG4gICAgICAgICAgICAgICAgaGVhcDogaGVhcFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSA9IGZ1bmN0aW9uIChzdGF0ZSkge1xuICAgICAgICAgICAgc2VsZiQyLm9mZnNldCA9IHN0YXRlLm9mZnNldDtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5oZWFwLmJ5dGVMZW5ndGggPT09IDIwKSB7XG4gICAgICAgICAgICAgICAgdmFyIGlvID0gbmV3IEludDMyQXJyYXkoc2VsZiQyLmhlYXAsIHNlbGYkMi5wYWRNYXhDaHVua0xlbiArIDMyMCwgNSk7XG4gICAgICAgICAgICAgICAgaW8uc2V0KG5ldyBJbnQzMkFycmF5KHN0YXRlLmhlYXApKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZiQyLmgzMi5zZXQobmV3IEludDMyQXJyYXkoc3RhdGUuaGVhcCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH07XG4gICAgICAgIHZhciByYXdFbmQgPSB0aGlzLnJhd0VuZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBtc2dMZW4gPSBzZWxmJDIub2Zmc2V0O1xuICAgICAgICAgICAgdmFyIGNodW5rTGVuID0gbXNnTGVuICUgc2VsZiQyLm1heENodW5rTGVuO1xuICAgICAgICAgICAgdmFyIHBhZENodW5rTGVuID0gcGFkQ2h1bmsoY2h1bmtMZW4sIG1zZ0xlbik7XG4gICAgICAgICAgICBzZWxmJDIuY29yZS5oYXNoKHBhZENodW5rTGVuLCBzZWxmJDIucGFkTWF4Q2h1bmtMZW4pO1xuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IGdldFJhd0RpZ2VzdChzZWxmJDIuaGVhcCwgc2VsZiQyLnBhZE1heENodW5rTGVuKTtcbiAgICAgICAgICAgIGluaXRTdGF0ZShzZWxmJDIuaGVhcCwgc2VsZiQyLnBhZE1heENodW5rTGVuKTtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuZW5kID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGhleChyYXdFbmQoKS5idWZmZXIpO1xuICAgICAgICB9O1xuICAgIH1cbiAgICA7XG4gICAgLy8gVGhlIGxvdy1sZXZlbCBSdXNoQ29yZSBtb2R1bGUgcHJvdmlkZXMgdGhlIGhlYXJ0IG9mIFJ1c2hhLFxuICAgIC8vIGEgaGlnaC1zcGVlZCBzaGExIGltcGxlbWVudGF0aW9uIHdvcmtpbmcgb24gYW4gSW50MzJBcnJheSBoZWFwLlxuICAgIC8vIEF0IGZpcnN0IGdsYW5jZSwgdGhlIGltcGxlbWVudGF0aW9uIHNlZW1zIGNvbXBsaWNhdGVkLCBob3dldmVyXG4gICAgLy8gd2l0aCB0aGUgU0hBMSBzcGVjIGF0IGhhbmQsIGl0IGlzIG9idmlvdXMgdGhpcyBhbG1vc3QgYSB0ZXh0Ym9va1xuICAgIC8vIGltcGxlbWVudGF0aW9uIHRoYXQgaGFzIGEgZmV3IGZ1bmN0aW9ucyBoYW5kLWlubGluZWQgYW5kIGEgZmV3IGxvb3BzXG4gICAgLy8gaGFuZC11bnJvbGxlZC5cbiAgICBSdXNoYS5fY29yZSA9IGZ1bmN0aW9uIFJ1c2hhQ29yZShzdGRsaWIsIGZvcmVpZ24sIGhlYXApIHtcbiAgICAgICAgJ3VzZSBhc20nO1xuICAgICAgICB2YXIgSCA9IG5ldyBzdGRsaWIuSW50MzJBcnJheShoZWFwKTtcbiAgICAgICAgZnVuY3Rpb24gaGFzaChrLCB4KSB7XG4gICAgICAgICAgICAvLyBrIGluIGJ5dGVzXG4gICAgICAgICAgICBrID0gayB8IDA7XG4gICAgICAgICAgICB4ID0geCB8IDA7XG4gICAgICAgICAgICB2YXIgaSA9IDAsIGogPSAwLCB5MCA9IDAsIHowID0gMCwgeTEgPSAwLCB6MSA9IDAsIHkyID0gMCwgejIgPSAwLCB5MyA9IDAsIHozID0gMCwgeTQgPSAwLCB6NCA9IDAsIHQwID0gMCwgdDEgPSAwO1xuICAgICAgICAgICAgeTAgPSBIW3ggKyAzMjAgPj4gMl0gfCAwO1xuICAgICAgICAgICAgeTEgPSBIW3ggKyAzMjQgPj4gMl0gfCAwO1xuICAgICAgICAgICAgeTIgPSBIW3ggKyAzMjggPj4gMl0gfCAwO1xuICAgICAgICAgICAgeTMgPSBIW3ggKyAzMzIgPj4gMl0gfCAwO1xuICAgICAgICAgICAgeTQgPSBIW3ggKyAzMzYgPj4gMl0gfCAwO1xuICAgICAgICAgICAgZm9yIChpID0gMDsgKGkgfCAwKSA8IChrIHwgMCk7IGkgPSBpICsgNjQgfCAwKSB7XG4gICAgICAgICAgICAgICAgejAgPSB5MDtcbiAgICAgICAgICAgICAgICB6MSA9IHkxO1xuICAgICAgICAgICAgICAgIHoyID0geTI7XG4gICAgICAgICAgICAgICAgejMgPSB5MztcbiAgICAgICAgICAgICAgICB6NCA9IHk0O1xuICAgICAgICAgICAgICAgIGZvciAoaiA9IDA7IChqIHwgMCkgPCA2NDsgaiA9IGogKyA0IHwgMCkge1xuICAgICAgICAgICAgICAgICAgICB0MSA9IEhbaSArIGogPj4gMl0gfCAwO1xuICAgICAgICAgICAgICAgICAgICB0MCA9ICgoeTAgPDwgNSB8IHkwID4+PiAyNykgKyAoeTEgJiB5MiB8IH55MSAmIHkzKSB8IDApICsgKCh0MSArIHk0IHwgMCkgKyAxNTE4NTAwMjQ5IHwgMCkgfCAwO1xuICAgICAgICAgICAgICAgICAgICB5NCA9IHkzO1xuICAgICAgICAgICAgICAgICAgICB5MyA9IHkyO1xuICAgICAgICAgICAgICAgICAgICB5MiA9IHkxIDw8IDMwIHwgeTEgPj4+IDI7XG4gICAgICAgICAgICAgICAgICAgIHkxID0geTA7XG4gICAgICAgICAgICAgICAgICAgIHkwID0gdDA7XG4gICAgICAgICAgICAgICAgICAgIEhbayArIGogPj4gMl0gPSB0MTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZm9yIChqID0gayArIDY0IHwgMDsgKGogfCAwKSA8IChrICsgODAgfCAwKTsgaiA9IGogKyA0IHwgMCkge1xuICAgICAgICAgICAgICAgICAgICB0MSA9IChIW2ogLSAxMiA+PiAyXSBeIEhbaiAtIDMyID4+IDJdIF4gSFtqIC0gNTYgPj4gMl0gXiBIW2ogLSA2NCA+PiAyXSkgPDwgMSB8IChIW2ogLSAxMiA+PiAyXSBeIEhbaiAtIDMyID4+IDJdIF4gSFtqIC0gNTYgPj4gMl0gXiBIW2ogLSA2NCA+PiAyXSkgPj4+IDMxO1xuICAgICAgICAgICAgICAgICAgICB0MCA9ICgoeTAgPDwgNSB8IHkwID4+PiAyNykgKyAoeTEgJiB5MiB8IH55MSAmIHkzKSB8IDApICsgKCh0MSArIHk0IHwgMCkgKyAxNTE4NTAwMjQ5IHwgMCkgfCAwO1xuICAgICAgICAgICAgICAgICAgICB5NCA9IHkzO1xuICAgICAgICAgICAgICAgICAgICB5MyA9IHkyO1xuICAgICAgICAgICAgICAgICAgICB5MiA9IHkxIDw8IDMwIHwgeTEgPj4+IDI7XG4gICAgICAgICAgICAgICAgICAgIHkxID0geTA7XG4gICAgICAgICAgICAgICAgICAgIHkwID0gdDA7XG4gICAgICAgICAgICAgICAgICAgIEhbaiA+PiAyXSA9IHQxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmb3IgKGogPSBrICsgODAgfCAwOyAoaiB8IDApIDwgKGsgKyAxNjAgfCAwKTsgaiA9IGogKyA0IHwgMCkge1xuICAgICAgICAgICAgICAgICAgICB0MSA9IChIW2ogLSAxMiA+PiAyXSBeIEhbaiAtIDMyID4+IDJdIF4gSFtqIC0gNTYgPj4gMl0gXiBIW2ogLSA2NCA+PiAyXSkgPDwgMSB8IChIW2ogLSAxMiA+PiAyXSBeIEhbaiAtIDMyID4+IDJdIF4gSFtqIC0gNTYgPj4gMl0gXiBIW2ogLSA2NCA+PiAyXSkgPj4+IDMxO1xuICAgICAgICAgICAgICAgICAgICB0MCA9ICgoeTAgPDwgNSB8IHkwID4+PiAyNykgKyAoeTEgXiB5MiBeIHkzKSB8IDApICsgKCh0MSArIHk0IHwgMCkgKyAxODU5Nzc1MzkzIHwgMCkgfCAwO1xuICAgICAgICAgICAgICAgICAgICB5NCA9IHkzO1xuICAgICAgICAgICAgICAgICAgICB5MyA9IHkyO1xuICAgICAgICAgICAgICAgICAgICB5MiA9IHkxIDw8IDMwIHwgeTEgPj4+IDI7XG4gICAgICAgICAgICAgICAgICAgIHkxID0geTA7XG4gICAgICAgICAgICAgICAgICAgIHkwID0gdDA7XG4gICAgICAgICAgICAgICAgICAgIEhbaiA+PiAyXSA9IHQxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmb3IgKGogPSBrICsgMTYwIHwgMDsgKGogfCAwKSA8IChrICsgMjQwIHwgMCk7IGogPSBqICsgNCB8IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdDEgPSAoSFtqIC0gMTIgPj4gMl0gXiBIW2ogLSAzMiA+PiAyXSBeIEhbaiAtIDU2ID4+IDJdIF4gSFtqIC0gNjQgPj4gMl0pIDw8IDEgfCAoSFtqIC0gMTIgPj4gMl0gXiBIW2ogLSAzMiA+PiAyXSBeIEhbaiAtIDU2ID4+IDJdIF4gSFtqIC0gNjQgPj4gMl0pID4+PiAzMTtcbiAgICAgICAgICAgICAgICAgICAgdDAgPSAoKHkwIDw8IDUgfCB5MCA+Pj4gMjcpICsgKHkxICYgeTIgfCB5MSAmIHkzIHwgeTIgJiB5MykgfCAwKSArICgodDEgKyB5NCB8IDApIC0gMTg5NDAwNzU4OCB8IDApIHwgMDtcbiAgICAgICAgICAgICAgICAgICAgeTQgPSB5MztcbiAgICAgICAgICAgICAgICAgICAgeTMgPSB5MjtcbiAgICAgICAgICAgICAgICAgICAgeTIgPSB5MSA8PCAzMCB8IHkxID4+PiAyO1xuICAgICAgICAgICAgICAgICAgICB5MSA9IHkwO1xuICAgICAgICAgICAgICAgICAgICB5MCA9IHQwO1xuICAgICAgICAgICAgICAgICAgICBIW2ogPj4gMl0gPSB0MTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZm9yIChqID0gayArIDI0MCB8IDA7IChqIHwgMCkgPCAoayArIDMyMCB8IDApOyBqID0gaiArIDQgfCAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHQxID0gKEhbaiAtIDEyID4+IDJdIF4gSFtqIC0gMzIgPj4gMl0gXiBIW2ogLSA1NiA+PiAyXSBeIEhbaiAtIDY0ID4+IDJdKSA8PCAxIHwgKEhbaiAtIDEyID4+IDJdIF4gSFtqIC0gMzIgPj4gMl0gXiBIW2ogLSA1NiA+PiAyXSBeIEhbaiAtIDY0ID4+IDJdKSA+Pj4gMzE7XG4gICAgICAgICAgICAgICAgICAgIHQwID0gKCh5MCA8PCA1IHwgeTAgPj4+IDI3KSArICh5MSBeIHkyIF4geTMpIHwgMCkgKyAoKHQxICsgeTQgfCAwKSAtIDg5OTQ5NzUxNCB8IDApIHwgMDtcbiAgICAgICAgICAgICAgICAgICAgeTQgPSB5MztcbiAgICAgICAgICAgICAgICAgICAgeTMgPSB5MjtcbiAgICAgICAgICAgICAgICAgICAgeTIgPSB5MSA8PCAzMCB8IHkxID4+PiAyO1xuICAgICAgICAgICAgICAgICAgICB5MSA9IHkwO1xuICAgICAgICAgICAgICAgICAgICB5MCA9IHQwO1xuICAgICAgICAgICAgICAgICAgICBIW2ogPj4gMl0gPSB0MTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgeTAgPSB5MCArIHowIHwgMDtcbiAgICAgICAgICAgICAgICB5MSA9IHkxICsgejEgfCAwO1xuICAgICAgICAgICAgICAgIHkyID0geTIgKyB6MiB8IDA7XG4gICAgICAgICAgICAgICAgeTMgPSB5MyArIHozIHwgMDtcbiAgICAgICAgICAgICAgICB5NCA9IHk0ICsgejQgfCAwO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgSFt4ICsgMzIwID4+IDJdID0geTA7XG4gICAgICAgICAgICBIW3ggKyAzMjQgPj4gMl0gPSB5MTtcbiAgICAgICAgICAgIEhbeCArIDMyOCA+PiAyXSA9IHkyO1xuICAgICAgICAgICAgSFt4ICsgMzMyID4+IDJdID0geTM7XG4gICAgICAgICAgICBIW3ggKyAzMzYgPj4gMl0gPSB5NDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBoYXNoOiBoYXNoIH07XG4gICAgfTtcbiAgICBpZiAoLy8gSWYgd2UnZSBydW5uaW5nIGluIE5vZGUuSlMsIGV4cG9ydCBhIG1vZHVsZS5cbiAgICAgICAgdHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgbW9kdWxlLmV4cG9ydHMgPSBSdXNoYTtcbiAgICB9IGVsc2UgaWYgKC8vIElmIHdlJ3JlIHJ1bm5pbmcgaW4gYSBET00gY29udGV4dCwgZXhwb3J0XG4gICAgICAgIC8vIHRoZSBSdXNoYSBvYmplY3QgdG8gdG9wbGV2ZWwuXG4gICAgICAgIHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHdpbmRvdy5SdXNoYSA9IFJ1c2hhO1xuICAgIH1cbiAgICBpZiAoLy8gSWYgd2UncmUgcnVubmluZyBpbiBhIHdlYndvcmtlciwgYWNjZXB0XG4gICAgICAgIC8vIG1lc3NhZ2VzIGNvbnRhaW5pbmcgYSBqb2JpZCBhbmQgYSBidWZmZXJcbiAgICAgICAgLy8gb3IgYmxvYiBvYmplY3QsIGFuZCByZXR1cm4gdGhlIGhhc2ggcmVzdWx0LlxuICAgICAgICB0eXBlb2YgRmlsZVJlYWRlclN5bmMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHZhciByZWFkZXIgPSBuZXcgRmlsZVJlYWRlclN5bmMoKSwgaGFzaGVyID0gbmV3IFJ1c2hhKDQgKiAxMDI0ICogMTAyNCk7XG4gICAgICAgIHNlbGYub25tZXNzYWdlID0gZnVuY3Rpb24gb25NZXNzYWdlKGV2ZW50KSB7XG4gICAgICAgICAgICB2YXIgaGFzaCwgZGF0YSA9IGV2ZW50LmRhdGEuZGF0YTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaGFzaCA9IGhhc2hlci5kaWdlc3QoZGF0YSk7XG4gICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBldmVudC5kYXRhLmlkLFxuICAgICAgICAgICAgICAgICAgICBoYXNoOiBoYXNoXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBldmVudC5kYXRhLmlkLFxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogZS5uYW1lXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxufSgpKTsiLCJ2YXIgUnVzaGEgPSByZXF1aXJlKCdydXNoYScpXG5cbnZhciBydXNoYSA9IG5ldyBSdXNoYVxudmFyIHNjb3BlID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiBzZWxmXG52YXIgY3J5cHRvID0gc2NvcGUuY3J5cHRvIHx8IHNjb3BlLm1zQ3J5cHRvIHx8IHt9XG52YXIgc3VidGxlID0gY3J5cHRvLnN1YnRsZSB8fCBjcnlwdG8ud2Via2l0U3VidGxlXG5cbmZ1bmN0aW9uIHNoYTFzeW5jIChidWYpIHtcbiAgcmV0dXJuIHJ1c2hhLmRpZ2VzdChidWYpXG59XG5cbi8vIEJyb3dzZXJzIHRocm93IGlmIHRoZXkgbGFjayBzdXBwb3J0IGZvciBhbiBhbGdvcml0aG0uXG4vLyBQcm9taXNlIHdpbGwgYmUgcmVqZWN0ZWQgb24gbm9uLXNlY3VyZSBvcmlnaW5zLiAoaHR0cDovL2dvby5nbC9scTRnQ28pXG50cnkge1xuICBzdWJ0bGUuZGlnZXN0KHsgbmFtZTogJ3NoYS0xJyB9LCBuZXcgVWludDhBcnJheSkuY2F0Y2goZnVuY3Rpb24gKCkge1xuICAgIHN1YnRsZSA9IGZhbHNlXG4gIH0pXG59IGNhdGNoIChlcnIpIHsgc3VidGxlID0gZmFsc2UgfVxuXG5mdW5jdGlvbiBzaGExIChidWYsIGNiKSB7XG4gIGlmICghc3VidGxlKSB7XG4gICAgLy8gVXNlIFJ1c2hhXG4gICAgc2V0VGltZW91dChjYiwgMCwgc2hhMXN5bmMoYnVmKSlcbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICh0eXBlb2YgYnVmID09PSAnc3RyaW5nJykge1xuICAgIGJ1ZiA9IHVpbnQ4YXJyYXkoYnVmKVxuICB9XG5cbiAgc3VidGxlLmRpZ2VzdCh7IG5hbWU6ICdzaGEtMScgfSwgYnVmKVxuICAgIC50aGVuKGZ1bmN0aW9uIHN1Y2NlZWQgKHJlc3VsdCkge1xuICAgICAgY2IoaGV4KG5ldyBVaW50OEFycmF5KHJlc3VsdCkpKVxuICAgIH0sXG4gICAgZnVuY3Rpb24gZmFpbCAoZXJyb3IpIHtcbiAgICAgIGNiKHNoYTFzeW5jKGJ1ZikpXG4gICAgfSlcbn1cblxuZnVuY3Rpb24gdWludDhhcnJheSAocykge1xuICB2YXIgbCA9IHMubGVuZ3RoXG4gIHZhciBhcnJheSA9IG5ldyBVaW50OEFycmF5KGwpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbDsgaSsrKSB7XG4gICAgYXJyYXlbaV0gPSBzLmNoYXJDb2RlQXQoaSlcbiAgfVxuICByZXR1cm4gYXJyYXlcbn1cblxuZnVuY3Rpb24gaGV4IChidWYpIHtcbiAgdmFyIGwgPSBidWYubGVuZ3RoXG4gIHZhciBjaGFycyA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbDsgaSsrKSB7XG4gICAgdmFyIGJpdGUgPSBidWZbaV1cbiAgICBjaGFycy5wdXNoKChiaXRlID4+PiA0KS50b1N0cmluZygxNikpXG4gICAgY2hhcnMucHVzaCgoYml0ZSAmIDB4MGYpLnRvU3RyaW5nKDE2KSlcbiAgfVxuICByZXR1cm4gY2hhcnMuam9pbignJylcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzaGExXG5tb2R1bGUuZXhwb3J0cy5zeW5jID0gc2hhMXN5bmNcbiIsIi8qIGdsb2JhbCBCbG9iICovXG5cbnZhciBvbmNlID0gcmVxdWlyZSgnb25jZScpXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZ2V0QmxvYiAoc3RyZWFtLCBtaW1lVHlwZSwgY2IpIHtcbiAgaWYgKHR5cGVvZiBtaW1lVHlwZSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGdldEJsb2Ioc3RyZWFtLCBudWxsLCBtaW1lVHlwZSlcbiAgY2IgPSBvbmNlKGNiKVxuICB2YXIgY2h1bmtzID0gW11cbiAgc3RyZWFtXG4gICAgLm9uKCdkYXRhJywgZnVuY3Rpb24gKGNodW5rKSB7XG4gICAgICBjaHVua3MucHVzaChjaHVuaylcbiAgICB9KVxuICAgIC5vbignZW5kJywgZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIGJsb2IgPSBtaW1lVHlwZVxuICAgICAgICA/IG5ldyBCbG9iKGNodW5rcywgeyB0eXBlOiBtaW1lVHlwZSB9KVxuICAgICAgICA6IG5ldyBCbG9iKGNodW5rcylcbiAgICAgIGNiKG51bGwsIGJsb2IpXG4gICAgfSlcbiAgICAub24oJ2Vycm9yJywgY2IpXG59XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJ2J1ZmZlcicpLkJ1ZmZlcjtcblxudmFyIGlzQnVmZmVyRW5jb2RpbmcgPSBCdWZmZXIuaXNFbmNvZGluZ1xuICB8fCBmdW5jdGlvbihlbmNvZGluZykge1xuICAgICAgIHN3aXRjaCAoZW5jb2RpbmcgJiYgZW5jb2RpbmcudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgY2FzZSAnaGV4JzogY2FzZSAndXRmOCc6IGNhc2UgJ3V0Zi04JzogY2FzZSAnYXNjaWknOiBjYXNlICdiaW5hcnknOiBjYXNlICdiYXNlNjQnOiBjYXNlICd1Y3MyJzogY2FzZSAndWNzLTInOiBjYXNlICd1dGYxNmxlJzogY2FzZSAndXRmLTE2bGUnOiBjYXNlICdyYXcnOiByZXR1cm4gdHJ1ZTtcbiAgICAgICAgIGRlZmF1bHQ6IHJldHVybiBmYWxzZTtcbiAgICAgICB9XG4gICAgIH1cblxuXG5mdW5jdGlvbiBhc3NlcnRFbmNvZGluZyhlbmNvZGluZykge1xuICBpZiAoZW5jb2RpbmcgJiYgIWlzQnVmZmVyRW5jb2RpbmcoZW5jb2RpbmcpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpO1xuICB9XG59XG5cbi8vIFN0cmluZ0RlY29kZXIgcHJvdmlkZXMgYW4gaW50ZXJmYWNlIGZvciBlZmZpY2llbnRseSBzcGxpdHRpbmcgYSBzZXJpZXMgb2Zcbi8vIGJ1ZmZlcnMgaW50byBhIHNlcmllcyBvZiBKUyBzdHJpbmdzIHdpdGhvdXQgYnJlYWtpbmcgYXBhcnQgbXVsdGktYnl0ZVxuLy8gY2hhcmFjdGVycy4gQ0VTVS04IGlzIGhhbmRsZWQgYXMgcGFydCBvZiB0aGUgVVRGLTggZW5jb2RpbmcuXG4vL1xuLy8gQFRPRE8gSGFuZGxpbmcgYWxsIGVuY29kaW5ncyBpbnNpZGUgYSBzaW5nbGUgb2JqZWN0IG1ha2VzIGl0IHZlcnkgZGlmZmljdWx0XG4vLyB0byByZWFzb24gYWJvdXQgdGhpcyBjb2RlLCBzbyBpdCBzaG91bGQgYmUgc3BsaXQgdXAgaW4gdGhlIGZ1dHVyZS5cbi8vIEBUT0RPIFRoZXJlIHNob3VsZCBiZSBhIHV0Zjgtc3RyaWN0IGVuY29kaW5nIHRoYXQgcmVqZWN0cyBpbnZhbGlkIFVURi04IGNvZGVcbi8vIHBvaW50cyBhcyB1c2VkIGJ5IENFU1UtOC5cbnZhciBTdHJpbmdEZWNvZGVyID0gZXhwb3J0cy5TdHJpbmdEZWNvZGVyID0gZnVuY3Rpb24oZW5jb2RpbmcpIHtcbiAgdGhpcy5lbmNvZGluZyA9IChlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvWy1fXS8sICcnKTtcbiAgYXNzZXJ0RW5jb2RpbmcoZW5jb2RpbmcpO1xuICBzd2l0Y2ggKHRoaXMuZW5jb2RpbmcpIHtcbiAgICBjYXNlICd1dGY4JzpcbiAgICAgIC8vIENFU1UtOCByZXByZXNlbnRzIGVhY2ggb2YgU3Vycm9nYXRlIFBhaXIgYnkgMy1ieXRlc1xuICAgICAgdGhpcy5zdXJyb2dhdGVTaXplID0gMztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgLy8gVVRGLTE2IHJlcHJlc2VudHMgZWFjaCBvZiBTdXJyb2dhdGUgUGFpciBieSAyLWJ5dGVzXG4gICAgICB0aGlzLnN1cnJvZ2F0ZVNpemUgPSAyO1xuICAgICAgdGhpcy5kZXRlY3RJbmNvbXBsZXRlQ2hhciA9IHV0ZjE2RGV0ZWN0SW5jb21wbGV0ZUNoYXI7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgLy8gQmFzZS02NCBzdG9yZXMgMyBieXRlcyBpbiA0IGNoYXJzLCBhbmQgcGFkcyB0aGUgcmVtYWluZGVyLlxuICAgICAgdGhpcy5zdXJyb2dhdGVTaXplID0gMztcbiAgICAgIHRoaXMuZGV0ZWN0SW5jb21wbGV0ZUNoYXIgPSBiYXNlNjREZXRlY3RJbmNvbXBsZXRlQ2hhcjtcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aGlzLndyaXRlID0gcGFzc1Rocm91Z2hXcml0ZTtcbiAgICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEVub3VnaCBzcGFjZSB0byBzdG9yZSBhbGwgYnl0ZXMgb2YgYSBzaW5nbGUgY2hhcmFjdGVyLiBVVEYtOCBuZWVkcyA0XG4gIC8vIGJ5dGVzLCBidXQgQ0VTVS04IG1heSByZXF1aXJlIHVwIHRvIDYgKDMgYnl0ZXMgcGVyIHN1cnJvZ2F0ZSkuXG4gIHRoaXMuY2hhckJ1ZmZlciA9IG5ldyBCdWZmZXIoNik7XG4gIC8vIE51bWJlciBvZiBieXRlcyByZWNlaXZlZCBmb3IgdGhlIGN1cnJlbnQgaW5jb21wbGV0ZSBtdWx0aS1ieXRlIGNoYXJhY3Rlci5cbiAgdGhpcy5jaGFyUmVjZWl2ZWQgPSAwO1xuICAvLyBOdW1iZXIgb2YgYnl0ZXMgZXhwZWN0ZWQgZm9yIHRoZSBjdXJyZW50IGluY29tcGxldGUgbXVsdGktYnl0ZSBjaGFyYWN0ZXIuXG4gIHRoaXMuY2hhckxlbmd0aCA9IDA7XG59O1xuXG5cbi8vIHdyaXRlIGRlY29kZXMgdGhlIGdpdmVuIGJ1ZmZlciBhbmQgcmV0dXJucyBpdCBhcyBKUyBzdHJpbmcgdGhhdCBpc1xuLy8gZ3VhcmFudGVlZCB0byBub3QgY29udGFpbiBhbnkgcGFydGlhbCBtdWx0aS1ieXRlIGNoYXJhY3RlcnMuIEFueSBwYXJ0aWFsXG4vLyBjaGFyYWN0ZXIgZm91bmQgYXQgdGhlIGVuZCBvZiB0aGUgYnVmZmVyIGlzIGJ1ZmZlcmVkIHVwLCBhbmQgd2lsbCBiZVxuLy8gcmV0dXJuZWQgd2hlbiBjYWxsaW5nIHdyaXRlIGFnYWluIHdpdGggdGhlIHJlbWFpbmluZyBieXRlcy5cbi8vXG4vLyBOb3RlOiBDb252ZXJ0aW5nIGEgQnVmZmVyIGNvbnRhaW5pbmcgYW4gb3JwaGFuIHN1cnJvZ2F0ZSB0byBhIFN0cmluZ1xuLy8gY3VycmVudGx5IHdvcmtzLCBidXQgY29udmVydGluZyBhIFN0cmluZyB0byBhIEJ1ZmZlciAodmlhIGBuZXcgQnVmZmVyYCwgb3Jcbi8vIEJ1ZmZlciN3cml0ZSkgd2lsbCByZXBsYWNlIGluY29tcGxldGUgc3Vycm9nYXRlcyB3aXRoIHRoZSB1bmljb2RlXG4vLyByZXBsYWNlbWVudCBjaGFyYWN0ZXIuIFNlZSBodHRwczovL2NvZGVyZXZpZXcuY2hyb21pdW0ub3JnLzEyMTE3MzAwOS8gLlxuU3RyaW5nRGVjb2Rlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGNoYXJTdHIgPSAnJztcbiAgLy8gaWYgb3VyIGxhc3Qgd3JpdGUgZW5kZWQgd2l0aCBhbiBpbmNvbXBsZXRlIG11bHRpYnl0ZSBjaGFyYWN0ZXJcbiAgd2hpbGUgKHRoaXMuY2hhckxlbmd0aCkge1xuICAgIC8vIGRldGVybWluZSBob3cgbWFueSByZW1haW5pbmcgYnl0ZXMgdGhpcyBidWZmZXIgaGFzIHRvIG9mZmVyIGZvciB0aGlzIGNoYXJcbiAgICB2YXIgYXZhaWxhYmxlID0gKGJ1ZmZlci5sZW5ndGggPj0gdGhpcy5jaGFyTGVuZ3RoIC0gdGhpcy5jaGFyUmVjZWl2ZWQpID9cbiAgICAgICAgdGhpcy5jaGFyTGVuZ3RoIC0gdGhpcy5jaGFyUmVjZWl2ZWQgOlxuICAgICAgICBidWZmZXIubGVuZ3RoO1xuXG4gICAgLy8gYWRkIHRoZSBuZXcgYnl0ZXMgdG8gdGhlIGNoYXIgYnVmZmVyXG4gICAgYnVmZmVyLmNvcHkodGhpcy5jaGFyQnVmZmVyLCB0aGlzLmNoYXJSZWNlaXZlZCwgMCwgYXZhaWxhYmxlKTtcbiAgICB0aGlzLmNoYXJSZWNlaXZlZCArPSBhdmFpbGFibGU7XG5cbiAgICBpZiAodGhpcy5jaGFyUmVjZWl2ZWQgPCB0aGlzLmNoYXJMZW5ndGgpIHtcbiAgICAgIC8vIHN0aWxsIG5vdCBlbm91Z2ggY2hhcnMgaW4gdGhpcyBidWZmZXI/IHdhaXQgZm9yIG1vcmUgLi4uXG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgLy8gcmVtb3ZlIGJ5dGVzIGJlbG9uZ2luZyB0byB0aGUgY3VycmVudCBjaGFyYWN0ZXIgZnJvbSB0aGUgYnVmZmVyXG4gICAgYnVmZmVyID0gYnVmZmVyLnNsaWNlKGF2YWlsYWJsZSwgYnVmZmVyLmxlbmd0aCk7XG5cbiAgICAvLyBnZXQgdGhlIGNoYXJhY3RlciB0aGF0IHdhcyBzcGxpdFxuICAgIGNoYXJTdHIgPSB0aGlzLmNoYXJCdWZmZXIuc2xpY2UoMCwgdGhpcy5jaGFyTGVuZ3RoKS50b1N0cmluZyh0aGlzLmVuY29kaW5nKTtcblxuICAgIC8vIENFU1UtODogbGVhZCBzdXJyb2dhdGUgKEQ4MDAtREJGRikgaXMgYWxzbyB0aGUgaW5jb21wbGV0ZSBjaGFyYWN0ZXJcbiAgICB2YXIgY2hhckNvZGUgPSBjaGFyU3RyLmNoYXJDb2RlQXQoY2hhclN0ci5sZW5ndGggLSAxKTtcbiAgICBpZiAoY2hhckNvZGUgPj0gMHhEODAwICYmIGNoYXJDb2RlIDw9IDB4REJGRikge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoICs9IHRoaXMuc3Vycm9nYXRlU2l6ZTtcbiAgICAgIGNoYXJTdHIgPSAnJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICB0aGlzLmNoYXJSZWNlaXZlZCA9IHRoaXMuY2hhckxlbmd0aCA9IDA7XG5cbiAgICAvLyBpZiB0aGVyZSBhcmUgbm8gbW9yZSBieXRlcyBpbiB0aGlzIGJ1ZmZlciwganVzdCBlbWl0IG91ciBjaGFyXG4gICAgaWYgKGJ1ZmZlci5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBjaGFyU3RyO1xuICAgIH1cbiAgICBicmVhaztcbiAgfVxuXG4gIC8vIGRldGVybWluZSBhbmQgc2V0IGNoYXJMZW5ndGggLyBjaGFyUmVjZWl2ZWRcbiAgdGhpcy5kZXRlY3RJbmNvbXBsZXRlQ2hhcihidWZmZXIpO1xuXG4gIHZhciBlbmQgPSBidWZmZXIubGVuZ3RoO1xuICBpZiAodGhpcy5jaGFyTGVuZ3RoKSB7XG4gICAgLy8gYnVmZmVyIHRoZSBpbmNvbXBsZXRlIGNoYXJhY3RlciBieXRlcyB3ZSBnb3RcbiAgICBidWZmZXIuY29weSh0aGlzLmNoYXJCdWZmZXIsIDAsIGJ1ZmZlci5sZW5ndGggLSB0aGlzLmNoYXJSZWNlaXZlZCwgZW5kKTtcbiAgICBlbmQgLT0gdGhpcy5jaGFyUmVjZWl2ZWQ7XG4gIH1cblxuICBjaGFyU3RyICs9IGJ1ZmZlci50b1N0cmluZyh0aGlzLmVuY29kaW5nLCAwLCBlbmQpO1xuXG4gIHZhciBlbmQgPSBjaGFyU3RyLmxlbmd0aCAtIDE7XG4gIHZhciBjaGFyQ29kZSA9IGNoYXJTdHIuY2hhckNvZGVBdChlbmQpO1xuICAvLyBDRVNVLTg6IGxlYWQgc3Vycm9nYXRlIChEODAwLURCRkYpIGlzIGFsc28gdGhlIGluY29tcGxldGUgY2hhcmFjdGVyXG4gIGlmIChjaGFyQ29kZSA+PSAweEQ4MDAgJiYgY2hhckNvZGUgPD0gMHhEQkZGKSB7XG4gICAgdmFyIHNpemUgPSB0aGlzLnN1cnJvZ2F0ZVNpemU7XG4gICAgdGhpcy5jaGFyTGVuZ3RoICs9IHNpemU7XG4gICAgdGhpcy5jaGFyUmVjZWl2ZWQgKz0gc2l6ZTtcbiAgICB0aGlzLmNoYXJCdWZmZXIuY29weSh0aGlzLmNoYXJCdWZmZXIsIHNpemUsIDAsIHNpemUpO1xuICAgIGJ1ZmZlci5jb3B5KHRoaXMuY2hhckJ1ZmZlciwgMCwgMCwgc2l6ZSk7XG4gICAgcmV0dXJuIGNoYXJTdHIuc3Vic3RyaW5nKDAsIGVuZCk7XG4gIH1cblxuICAvLyBvciBqdXN0IGVtaXQgdGhlIGNoYXJTdHJcbiAgcmV0dXJuIGNoYXJTdHI7XG59O1xuXG4vLyBkZXRlY3RJbmNvbXBsZXRlQ2hhciBkZXRlcm1pbmVzIGlmIHRoZXJlIGlzIGFuIGluY29tcGxldGUgVVRGLTggY2hhcmFjdGVyIGF0XG4vLyB0aGUgZW5kIG9mIHRoZSBnaXZlbiBidWZmZXIuIElmIHNvLCBpdCBzZXRzIHRoaXMuY2hhckxlbmd0aCB0byB0aGUgYnl0ZVxuLy8gbGVuZ3RoIHRoYXQgY2hhcmFjdGVyLCBhbmQgc2V0cyB0aGlzLmNoYXJSZWNlaXZlZCB0byB0aGUgbnVtYmVyIG9mIGJ5dGVzXG4vLyB0aGF0IGFyZSBhdmFpbGFibGUgZm9yIHRoaXMgY2hhcmFjdGVyLlxuU3RyaW5nRGVjb2Rlci5wcm90b3R5cGUuZGV0ZWN0SW5jb21wbGV0ZUNoYXIgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgLy8gZGV0ZXJtaW5lIGhvdyBtYW55IGJ5dGVzIHdlIGhhdmUgdG8gY2hlY2sgYXQgdGhlIGVuZCBvZiB0aGlzIGJ1ZmZlclxuICB2YXIgaSA9IChidWZmZXIubGVuZ3RoID49IDMpID8gMyA6IGJ1ZmZlci5sZW5ndGg7XG5cbiAgLy8gRmlndXJlIG91dCBpZiBvbmUgb2YgdGhlIGxhc3QgaSBieXRlcyBvZiBvdXIgYnVmZmVyIGFubm91bmNlcyBhblxuICAvLyBpbmNvbXBsZXRlIGNoYXIuXG4gIGZvciAoOyBpID4gMDsgaS0tKSB7XG4gICAgdmFyIGMgPSBidWZmZXJbYnVmZmVyLmxlbmd0aCAtIGldO1xuXG4gICAgLy8gU2VlIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvVVRGLTgjRGVzY3JpcHRpb25cblxuICAgIC8vIDExMFhYWFhYXG4gICAgaWYgKGkgPT0gMSAmJiBjID4+IDUgPT0gMHgwNikge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoID0gMjtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIC8vIDExMTBYWFhYXG4gICAgaWYgKGkgPD0gMiAmJiBjID4+IDQgPT0gMHgwRSkge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoID0gMztcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIC8vIDExMTEwWFhYXG4gICAgaWYgKGkgPD0gMyAmJiBjID4+IDMgPT0gMHgxRSkge1xuICAgICAgdGhpcy5jaGFyTGVuZ3RoID0gNDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICB0aGlzLmNoYXJSZWNlaXZlZCA9IGk7XG59O1xuXG5TdHJpbmdEZWNvZGVyLnByb3RvdHlwZS5lbmQgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIHJlcyA9ICcnO1xuICBpZiAoYnVmZmVyICYmIGJ1ZmZlci5sZW5ndGgpXG4gICAgcmVzID0gdGhpcy53cml0ZShidWZmZXIpO1xuXG4gIGlmICh0aGlzLmNoYXJSZWNlaXZlZCkge1xuICAgIHZhciBjciA9IHRoaXMuY2hhclJlY2VpdmVkO1xuICAgIHZhciBidWYgPSB0aGlzLmNoYXJCdWZmZXI7XG4gICAgdmFyIGVuYyA9IHRoaXMuZW5jb2Rpbmc7XG4gICAgcmVzICs9IGJ1Zi5zbGljZSgwLCBjcikudG9TdHJpbmcoZW5jKTtcbiAgfVxuXG4gIHJldHVybiByZXM7XG59O1xuXG5mdW5jdGlvbiBwYXNzVGhyb3VnaFdyaXRlKGJ1ZmZlcikge1xuICByZXR1cm4gYnVmZmVyLnRvU3RyaW5nKHRoaXMuZW5jb2RpbmcpO1xufVxuXG5mdW5jdGlvbiB1dGYxNkRldGVjdEluY29tcGxldGVDaGFyKGJ1ZmZlcikge1xuICB0aGlzLmNoYXJSZWNlaXZlZCA9IGJ1ZmZlci5sZW5ndGggJSAyO1xuICB0aGlzLmNoYXJMZW5ndGggPSB0aGlzLmNoYXJSZWNlaXZlZCA/IDIgOiAwO1xufVxuXG5mdW5jdGlvbiBiYXNlNjREZXRlY3RJbmNvbXBsZXRlQ2hhcihidWZmZXIpIHtcbiAgdGhpcy5jaGFyUmVjZWl2ZWQgPSBidWZmZXIubGVuZ3RoICUgMztcbiAgdGhpcy5jaGFyTGVuZ3RoID0gdGhpcy5jaGFyUmVjZWl2ZWQgPyAzIDogMDtcbn1cbiIsIlwidXNlIHN0cmljdFwiXG5cbmZ1bmN0aW9uIHVuaXF1ZV9wcmVkKGxpc3QsIGNvbXBhcmUpIHtcbiAgdmFyIHB0ciA9IDFcbiAgICAsIGxlbiA9IGxpc3QubGVuZ3RoXG4gICAgLCBhPWxpc3RbMF0sIGI9bGlzdFswXVxuICBmb3IodmFyIGk9MTsgaTxsZW47ICsraSkge1xuICAgIGIgPSBhXG4gICAgYSA9IGxpc3RbaV1cbiAgICBpZihjb21wYXJlKGEsIGIpKSB7XG4gICAgICBpZihpID09PSBwdHIpIHtcbiAgICAgICAgcHRyKytcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGxpc3RbcHRyKytdID0gYVxuICAgIH1cbiAgfVxuICBsaXN0Lmxlbmd0aCA9IHB0clxuICByZXR1cm4gbGlzdFxufVxuXG5mdW5jdGlvbiB1bmlxdWVfZXEobGlzdCkge1xuICB2YXIgcHRyID0gMVxuICAgICwgbGVuID0gbGlzdC5sZW5ndGhcbiAgICAsIGE9bGlzdFswXSwgYiA9IGxpc3RbMF1cbiAgZm9yKHZhciBpPTE7IGk8bGVuOyArK2ksIGI9YSkge1xuICAgIGIgPSBhXG4gICAgYSA9IGxpc3RbaV1cbiAgICBpZihhICE9PSBiKSB7XG4gICAgICBpZihpID09PSBwdHIpIHtcbiAgICAgICAgcHRyKytcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGxpc3RbcHRyKytdID0gYVxuICAgIH1cbiAgfVxuICBsaXN0Lmxlbmd0aCA9IHB0clxuICByZXR1cm4gbGlzdFxufVxuXG5mdW5jdGlvbiB1bmlxdWUobGlzdCwgY29tcGFyZSwgc29ydGVkKSB7XG4gIGlmKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGxpc3RcbiAgfVxuICBpZihjb21wYXJlKSB7XG4gICAgaWYoIXNvcnRlZCkge1xuICAgICAgbGlzdC5zb3J0KGNvbXBhcmUpXG4gICAgfVxuICAgIHJldHVybiB1bmlxdWVfcHJlZChsaXN0LCBjb21wYXJlKVxuICB9XG4gIGlmKCFzb3J0ZWQpIHtcbiAgICBsaXN0LnNvcnQoKVxuICB9XG4gIHJldHVybiB1bmlxdWVfZXEobGlzdClcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB1bmlxdWVcbiIsIlxuLyoqXG4gKiBNb2R1bGUgZXhwb3J0cy5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRlcHJlY2F0ZTtcblxuLyoqXG4gKiBNYXJrIHRoYXQgYSBtZXRob2Qgc2hvdWxkIG5vdCBiZSB1c2VkLlxuICogUmV0dXJucyBhIG1vZGlmaWVkIGZ1bmN0aW9uIHdoaWNoIHdhcm5zIG9uY2UgYnkgZGVmYXVsdC5cbiAqXG4gKiBJZiBgbG9jYWxTdG9yYWdlLm5vRGVwcmVjYXRpb24gPSB0cnVlYCBpcyBzZXQsIHRoZW4gaXQgaXMgYSBuby1vcC5cbiAqXG4gKiBJZiBgbG9jYWxTdG9yYWdlLnRocm93RGVwcmVjYXRpb24gPSB0cnVlYCBpcyBzZXQsIHRoZW4gZGVwcmVjYXRlZCBmdW5jdGlvbnNcbiAqIHdpbGwgdGhyb3cgYW4gRXJyb3Igd2hlbiBpbnZva2VkLlxuICpcbiAqIElmIGBsb2NhbFN0b3JhZ2UudHJhY2VEZXByZWNhdGlvbiA9IHRydWVgIGlzIHNldCwgdGhlbiBkZXByZWNhdGVkIGZ1bmN0aW9uc1xuICogd2lsbCBpbnZva2UgYGNvbnNvbGUudHJhY2UoKWAgaW5zdGVhZCBvZiBgY29uc29sZS5lcnJvcigpYC5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiAtIHRoZSBmdW5jdGlvbiB0byBkZXByZWNhdGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBtc2cgLSB0aGUgc3RyaW5nIHRvIHByaW50IHRvIHRoZSBjb25zb2xlIHdoZW4gYGZuYCBpcyBpbnZva2VkXG4gKiBAcmV0dXJucyB7RnVuY3Rpb259IGEgbmV3IFwiZGVwcmVjYXRlZFwiIHZlcnNpb24gb2YgYGZuYFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBkZXByZWNhdGUgKGZuLCBtc2cpIHtcbiAgaWYgKGNvbmZpZygnbm9EZXByZWNhdGlvbicpKSB7XG4gICAgcmV0dXJuIGZuO1xuICB9XG5cbiAgdmFyIHdhcm5lZCA9IGZhbHNlO1xuICBmdW5jdGlvbiBkZXByZWNhdGVkKCkge1xuICAgIGlmICghd2FybmVkKSB7XG4gICAgICBpZiAoY29uZmlnKCd0aHJvd0RlcHJlY2F0aW9uJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICB9IGVsc2UgaWYgKGNvbmZpZygndHJhY2VEZXByZWNhdGlvbicpKSB7XG4gICAgICAgIGNvbnNvbGUudHJhY2UobXNnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUud2Fybihtc2cpO1xuICAgICAgfVxuICAgICAgd2FybmVkID0gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH1cblxuICByZXR1cm4gZGVwcmVjYXRlZDtcbn1cblxuLyoqXG4gKiBDaGVja3MgYGxvY2FsU3RvcmFnZWAgZm9yIGJvb2xlYW4gdmFsdWVzIGZvciB0aGUgZ2l2ZW4gYG5hbWVgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gKiBAcmV0dXJucyB7Qm9vbGVhbn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGNvbmZpZyAobmFtZSkge1xuICAvLyBhY2Nlc3NpbmcgZ2xvYmFsLmxvY2FsU3RvcmFnZSBjYW4gdHJpZ2dlciBhIERPTUV4Y2VwdGlvbiBpbiBzYW5kYm94ZWQgaWZyYW1lc1xuICB0cnkge1xuICAgIGlmICghZ2xvYmFsLmxvY2FsU3RvcmFnZSkgcmV0dXJuIGZhbHNlO1xuICB9IGNhdGNoIChfKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHZhciB2YWwgPSBnbG9iYWwubG9jYWxTdG9yYWdlW25hbWVdO1xuICBpZiAobnVsbCA9PSB2YWwpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIFN0cmluZyh2YWwpLnRvTG93ZXJDYXNlKCkgPT09ICd0cnVlJztcbn1cbiIsIi8vIFJldHVybnMgYSB3cmFwcGVyIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIHdyYXBwZWQgY2FsbGJhY2tcbi8vIFRoZSB3cmFwcGVyIGZ1bmN0aW9uIHNob3VsZCBkbyBzb21lIHN0dWZmLCBhbmQgcmV0dXJuIGFcbi8vIHByZXN1bWFibHkgZGlmZmVyZW50IGNhbGxiYWNrIGZ1bmN0aW9uLlxuLy8gVGhpcyBtYWtlcyBzdXJlIHRoYXQgb3duIHByb3BlcnRpZXMgYXJlIHJldGFpbmVkLCBzbyB0aGF0XG4vLyBkZWNvcmF0aW9ucyBhbmQgc3VjaCBhcmUgbm90IGxvc3QgYWxvbmcgdGhlIHdheS5cbm1vZHVsZS5leHBvcnRzID0gd3JhcHB5XG5mdW5jdGlvbiB3cmFwcHkgKGZuLCBjYikge1xuICBpZiAoZm4gJiYgY2IpIHJldHVybiB3cmFwcHkoZm4pKGNiKVxuXG4gIGlmICh0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbmVlZCB3cmFwcGVyIGZ1bmN0aW9uJylcblxuICBPYmplY3Qua2V5cyhmbikuZm9yRWFjaChmdW5jdGlvbiAoaykge1xuICAgIHdyYXBwZXJba10gPSBmbltrXVxuICB9KVxuXG4gIHJldHVybiB3cmFwcGVyXG5cbiAgZnVuY3Rpb24gd3JhcHBlcigpIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXVxuICAgIH1cbiAgICB2YXIgcmV0ID0gZm4uYXBwbHkodGhpcywgYXJncylcbiAgICB2YXIgY2IgPSBhcmdzW2FyZ3MubGVuZ3RoLTFdXG4gICAgaWYgKHR5cGVvZiByZXQgPT09ICdmdW5jdGlvbicgJiYgcmV0ICE9PSBjYikge1xuICAgICAgT2JqZWN0LmtleXMoY2IpLmZvckVhY2goZnVuY3Rpb24gKGspIHtcbiAgICAgICAgcmV0W2tdID0gY2Jba11cbiAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiByZXRcbiAgfVxufVxuIiwic2VsZi5nbG9iYWwgPSBzZWxmIC8vIGVzbGludC1kaXNhYmxlLWxpbmVcblxucmVxdWlyZSgnZGVidWcnKS5lbmFibGUoJ3BsYW5rdG9zOionKVxudmFyIGRlYnVnID0gcmVxdWlyZSgnZGVidWcnKSgncGxhbmt0b3M6c3cnKVxudmFyIHBsYW5rdG9zID0gcmVxdWlyZSgnLicpXG52YXIgaW5qZWN0aW9uID0gcmVxdWlyZSgnLi9saWIvaW5qZWN0aW9uJylcblxudmFyIHNjb3BlID0gZ2xvYmFsLmxvY2F0aW9uLnBhdGhuYW1lLnN1YnN0cmluZygwLCBnbG9iYWwubG9jYXRpb24ucGF0aG5hbWUubGFzdEluZGV4T2YoJy8nKSlcbnZhciBhdmFpbGFibGUgPSB7fVxudmFyIGRlbGVnYXRvciA9IG51bGxcblxuZ2xvYmFsLmFkZEV2ZW50TGlzdGVuZXIoJ2ZldGNoJywgb25GZXRjaClcbmdsb2JhbC5hZGRFdmVudExpc3RlbmVyKCdhY3RpdmF0ZScsIG9uQWN0aXZhdGUpXG5nbG9iYWwuYWRkRXZlbnRMaXN0ZW5lcignaW5zdGFsbCcsIG9uSW5zdGFsbClcbmdsb2JhbC5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgb25NZXNzYWdlKVxuXG5hc3NpZ25EZWxlZ2F0b3IoKVxuXG5mdW5jdGlvbiBvbkZldGNoIChldmVudCkge1xuICB2YXIgdXJsID0gbmV3IFVSTChldmVudC5yZXF1ZXN0LnVybClcbiAgdmFyIG5hbWUgPSB1cmwucGF0aG5hbWUucmVwbGFjZShzY29wZSwgJycpLnN1YnN0cigxKVxuICB2YXIgc2VhcmNoID0gdXJsLnNlYXJjaC5zdWJzdHIoMSkuc3BsaXQoJyYnKVxuXG4gIGlmICh1cmwuaG9zdCAhPT0gZ2xvYmFsLmxvY2F0aW9uLmhvc3QgfHwgZXZlbnQucmVxdWVzdC5tZXRob2QgIT09ICdHRVQnKSByZXR1cm5cbiAgaWYgKHBsYW5rdG9zLnByZUNhY2hlZC5pbmRleE9mKCcvJyArIG5hbWUpID09PSAtMSAmJiBuYW1lLnN0YXJ0c1dpdGgoJ3BsYW5rdG9zLycpKSByZXR1cm5cbiAgaWYgKG5hbWUgPT09ICcnKSBuYW1lID0gJ2luZGV4Lmh0bWwnIC8vIFRPRE8gaGFuZGxlIGNhc2Ugd2hlbiBmaWxlIGlzIG5vdCB0b3AgbGV2ZWxcblxuICBhc3NpZ25EZWxlZ2F0b3IoKVxuXG4gIGRlYnVnKCdGRVRDSCcsICdjbGllbnRJZD0nICsgZXZlbnQuY2xpZW50SWQsICd1cmw9JyArIG5hbWUpXG5cbiAgLy8gVE9ETyBsZXQgYnJvd3NlciBoYW5kbGUgcmVxdWVzdCBpZiBmaWxlIGlzIG5vdCBpbiB0b3JyZW50XG4gIGlmIChwbGFua3Rvcy5wcmVDYWNoZWQuaW5kZXhPZignLycgKyBuYW1lKSAhPT0gLTEpIHtcbiAgICByZXR1cm4gZXZlbnQucmVzcG9uZFdpdGgoZ2xvYmFsLmNhY2hlcy5vcGVuKCdwbGFua3RvcycpXG4gICAgLnRoZW4oY2FjaGUgPT4gY2FjaGUubWF0Y2goc2NvcGUgKyAnLycgKyBuYW1lKSkpXG4gIH0gZWxzZSBpZiAoZXZlbnQuY2xpZW50SWQgPT0gbnVsbCAmJiBzZWFyY2guaW5kZXhPZignbm9QbGFua3Rvc0luamVjdGlvbicpID09PSAtMSkge1xuICAgIHZhciBtb2RVcmwgPSBuZXcgVVJMKHVybC50b1N0cmluZygpKVxuICAgIG1vZFVybC5zZWFyY2ggPSAodXJsLnNlYXJjaCA9PT0gJycgPyAnPycgOiB1cmwuc2VhcmNoICsgJyYnKSArICdub1BsYW5rdG9zSW5qZWN0aW9uJ1xuICAgIHZhciB0ZW1wbGF0ZSA9IG5hbWUuZW5kc1dpdGgoJ2h0bWwnKSB8fCBuYW1lLmVuZHNXaXRoKCdodG0nKVxuICAgICAgPyBpbmplY3Rpb24uZG9jV3JpdGUgOiBpbmplY3Rpb24uaWZyYW1lXG4gICAgdmFyIGh0bWwgPSB0ZW1wbGF0ZS5yZXBsYWNlKCd7e3VybH19JywgbW9kVXJsLnRvU3RyaW5nKCkpLnJlcGxhY2UoJ3t7c2NvcGV9fScsIHNjb3BlKVxuICAgIHJldHVybiBldmVudC5yZXNwb25kV2l0aChuZXcgUmVzcG9uc2UobmV3IEJsb2IoW2h0bWxdLCB7dHlwZTogJ3RleHQvaHRtbCd9KSkpXG4gIH0gZWxzZSB7XG4gICAgLy8gVE9ETyBoYW5kbGUgUkFOR0UgaGVhZGVyXG4gICAgcmV0dXJuIGV2ZW50LnJlc3BvbmRXaXRoKHBsYW5rdG9zLmdldEZpbGVCbG9iKG5hbWUpXG4gICAgLnRoZW4oYmxvYiA9PiBuZXcgUmVzcG9uc2UoYmxvYikpXG4gICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICBpZiAoZXJyLm1lc3NhZ2UgIT09ICdGaWxlIG5vdCBmb3VuZCcpIGRlYnVnKCdGRVRDSC1FUlJPUicsIGVycilcbiAgICAgIHJldHVybiBnbG9iYWwuZmV0Y2goZXZlbnQucmVxdWVzdClcbiAgICB9KSlcbiAgfVxufVxuXG5mdW5jdGlvbiBvbkFjdGl2YXRlICgpIHtcbiAgZGVidWcoJ0FDVElWQVRFJylcbn1cblxuZnVuY3Rpb24gb25JbnN0YWxsIChldmVudCkge1xuICBkZWJ1ZygnSU5TVEFMTCcpXG4gIHZhciB1cGRhdGUgPSBwbGFua3Rvcy51cGRhdGUoc2NvcGUpXG4gIHVwZGF0ZS50aGVuKCgpID0+IHBsYW5rdG9zLmdldE1hbmlmZXN0KCkpXG4gIC50aGVuKChtYW5pZmVzdCkgPT4gZGVidWcoJ01BTklGRVNUJywgbWFuaWZlc3QpKVxuICAudGhlbigoKSA9PiBwbGFua3Rvcy5nZXRUb3JyZW50TWV0YSgpKVxuICAudGhlbigodG9ycmVudE1ldGEpID0+IGRlYnVnKCdUT1JSRU5UJywgdG9ycmVudE1ldGEpKVxuICBldmVudC53YWl0VW50aWwodXBkYXRlKVxufVxuXG5mdW5jdGlvbiBvbk1lc3NhZ2UgKGV2ZW50KSB7XG4gIGlmICghZXZlbnQuZGF0YS5wbGFua3RvcykgcmV0dXJuXG4gIGRlYnVnKCdNRVNTQUdFJywgZXZlbnQuZGF0YSlcbiAgaWYgKGV2ZW50LmRhdGEudHlwZSA9PT0gJ2F2YWlsYWJsZScpIHtcbiAgICBhdmFpbGFibGVbZXZlbnQuc291cmNlLmlkXSA9IHRydWVcbiAgICBhc3NpZ25EZWxlZ2F0b3IoKVxuICB9IGVsc2UgaWYgKGV2ZW50LmRhdGEudHlwZSA9PT0gJ3VuYXZhaWxhYmxlJykge1xuICAgIGRlbGV0ZSBhdmFpbGFibGVbZXZlbnQuc291cmNlLmlkXVxuICAgIGFzc2lnbkRlbGVnYXRvcigpXG4gIH1cbn1cblxuZnVuY3Rpb24gYXNzaWduRGVsZWdhdG9yICgpIHtcbiAgdGhpcy5jbGllbnRzLm1hdGNoQWxsKHt0eXBlOiAnd2luZG93J30pLnRoZW4oY2xpZW50cyA9PiB7XG4gICAgdmFyIHBvdGVudGlhbHMgPSBjbGllbnRzLmZpbHRlcihjID0+IGMuaWQgaW4gYXZhaWxhYmxlKVxuICAgIHZhciByZWRlbGVnYXRlID0gIWRlbGVnYXRvciB8fCAhcG90ZW50aWFscy5maW5kKGMgPT4gYy5pZCA9PT0gZGVsZWdhdG9yLmlkKVxuICAgIGlmIChwb3RlbnRpYWxzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgY2xpZW50cy5mb3JFYWNoKGMgPT4gYy5wb3N0TWVzc2FnZSh7XG4gICAgICAgIHR5cGU6ICdyZXF1ZXN0X2F2YWlsYWJpbGl0eScsXG4gICAgICAgIHBsYW5rdG9zOiB0cnVlXG4gICAgICB9KSlcbiAgICB9IGVsc2UgaWYgKHJlZGVsZWdhdGUpIHtcbiAgICAgIGRlYnVnKCdBU1NJR04nLCAnb2xkPScgKyAoZGVsZWdhdG9yID8gZGVsZWdhdG9yLmlkIDogbnVsbCksICduZXc9JyArIHBvdGVudGlhbHNbMF0uaWQpXG4gICAgICBkZWxlZ2F0b3IgPSBwb3RlbnRpYWxzWzBdXG4gICAgICBwbGFua3Rvcy5nZXRUb3JyZW50TWV0YUJ1ZmZlcigpLnRoZW4oYnVmZmVyID0+IHtcbiAgICAgICAgaWYgKGRlbGVnYXRvciAhPT0gcG90ZW50aWFsc1swXSkgcmV0dXJuXG4gICAgICAgIGNsaWVudHMuZmlsdGVyKGMgPT4gYy5pZCAhPT0gZGVsZWdhdG9yLmlkKS5mb3JFYWNoKGMgPT4gYy5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgdHlwZTogJ2NhbmNlbF9kb3dubG9hZCcsXG4gICAgICAgICAgcGxhbmt0b3M6IHRydWVcbiAgICAgICAgfSkpXG4gICAgICAgIGRlbGVnYXRvci5wb3N0TWVzc2FnZSh7XG4gICAgICAgICAgdHlwZTogJ2Rvd25sb2FkJyxcbiAgICAgICAgICB0b3JyZW50SWQ6IGJ1ZmZlcixcbiAgICAgICAgICBwbGFua3RvczogdHJ1ZVxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICB9XG4gIH0pXG59XG4iXX0=
