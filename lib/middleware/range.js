module.exports = function () {
  return handleRangeRequests
}

function handleRangeRequests (req, rsp) {
  rsp.headers.set('Accept-Ranges', 'bytes')
  if (!rsp.createReadStream) return
  let rangeHeader = /^bytes=(\d+)-(\d+)?$/g.exec(req.headers.get('range'))
  if (rangeHeader && rangeHeader[1]) {
    let oldStream = rsp.createReadStream
    let length = Number(rsp.headers.get('Content-Length'))
    let start = Number(rangeHeader[1])
    let end = Number(rangeHeader[2])
    if (!end || end > length - 1) end = length - 1
    if (start > end) return // Invalid range so ignore it

    rsp.status = 206
    rsp.statusText = 'Partial Content'
    rsp.headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + length)
    rsp.headers.set('Content-Length', end - start + 1)
    rsp.createReadStream = function () {
      return oldStream({start: start, end: end})
    }
  }
}
