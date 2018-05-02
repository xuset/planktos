const ReadableStream = require('readable-stream')

/* global URL */

module.exports = function (snapshot) {
  return inject.bind(null, snapshot.hash)
}

const docWrite = `\
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="{{root}}/planktos/planktos.min.js"></script>
  <script>
    _planktos = new Planktos()
    _planktos.getAllSnapshots()
    .then(snapshots => {
      var snapshot = snapshots.find(function (s) { return s.hash === '{{snapshotHash}}' })
      var fpath = (new URL('{{url}}')).pathname.replace('{{root}}', '')
      return snapshot.getFile(fpath).getBuffer()
    })
    .then(buffer => {
      document.documentElement.innerHTML = buffer.toString()
    })
  </script>
</head>
<body>
</body>
</html>
`

const rendermedia = `\
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
  <script src="{{root}}/planktos/planktos.min.js"></script>
  <script>
    _planktos = new Planktos();
    _planktos.getAllSnapshots().then(snapshots => {
      var snapshot = snapshots.find(function (s) { return s.hash === '{{snapshotHash}}' })
      var fpath = (new URL('{{url}}')).pathname.replace('{{root}}', '')
      snapshot.getFile(fpath).appendTo('body')
    })
  </script>
</head>
</html>
`

function inject (snapshotHash, req, rsp) {
  // Inject only if it's the initial page load
  if (req.planktosInject !== true && (!req.fetchEvent || req.fetchEvent.clientId)) return

  const url = new URL(req.url)
  const fname = url.pathname.substr(url.pathname.lastIndexOf('/') + 1)
  const isHTML = fname.endsWith('.html') || fname.endsWith('.htm') || !fname.includes('.')
  const template = (isHTML ? docWrite : rendermedia)
    .replace(/{{url}}/g, url.toString())
    .replace(/{{root}}/g, req.planktosRoot || '')
    .replace(/{{snapshotHash}}/g, snapshotHash)

  rsp.status = 200
  rsp.statusText = 'OK'
  rsp.headers.set('Content-Length', template.length)
  rsp.headers.set('Content-Type', 'text/html')

  rsp.createReadStream = function () {
    const s = new ReadableStream()
    s._read = function noop () {}
    s.push(template)
    s.push(null)
    return s
  }
}
