
/* global URL */

module.exports = function (snapshot) {
  return function (req, rsp) {
    if (rsp.createReadStream) return
    var url = new URL(req.url)
    if (url.origin !== global.location.origin) return new Error('Cannot Fetch. Origin differs')

    let fpath = req.planktosRoot ? url.pathname.replace(req.planktosRoot, '') : url.pathname
    let file = snapshot.getFile(fpath)
    if (!file) return

    rsp.createReadStream = file.getStream.bind(file)
    rsp.status = 200
    rsp.statusText = 'OK'
    rsp.headers.set('Content-Type', file.mime)
    rsp.headers.set('Content-Length', file.length)
  }
}
