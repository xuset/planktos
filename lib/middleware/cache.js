const ReadableStream = require('readable-stream')

module.exports = function (snapshot) {
  return checkCache.bind(null, snapshot._namespace)
}

function checkCache (namespace, req, rsp) {
  if (rsp.createReadStream) return
  const url = new URL(req.url)
  return global.caches.open('planktos-' + namespace)
  .then(c => c.match(url.pathname))
  .then(cached => {
    if (!cached) return
    rsp.headers.set('Content-Type', cached.headers.get('Content-Type')) // TODO what if the cached header is not set ?
    return cached.arrayBuffer()
  })
  .then(arrayBuffer => {
    if (!arrayBuffer) return
    const s = new ReadableStream()
    s._read = function noop () {}
    s.push(Buffer.from(arrayBuffer))
    s.push(null)
    rsp.createReadStream = () => s
    rsp.status = 200
    rsp.statusText = 'OK'
    rsp.headers.set('Content-Length', arrayBuffer.length)
  })
}
