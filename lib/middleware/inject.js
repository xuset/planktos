const PassThrough = require('readable-stream').PassThrough

/* global URL */

module.exports = function (snapshot) {
  return inject.bind(null, snapshot.hash)
}

const docWriteInjection = `\
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

const rendermediaInjection = `\
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

const htmlStreamInjection = `\
<script src="{{root}}/planktos/planktos.min.js"></script>
<script>
    _planktos = new Planktos()
</script>
`

function inject (snapshotHash, req, rsp) {
  // Inject only if it's the initial page load
  if (req.planktosInject !== true && (!req.fetchEvent || req.fetchEvent.clientId)) return

  rsp.status = 200
  rsp.statusText = 'OK'
  rsp.headers.set('Content-Type', 'text/html')

  const url = new URL(req.url)
  const fname = url.pathname.substr(url.pathname.lastIndexOf('/') + 1)
  const isHTML = fname.endsWith('.html') || fname.endsWith('.htm') || !fname.includes('.')
  const template = isHTML ? (rsp.shouldStream ? htmlStreamInjection : docWriteInjection)
                   : rendermediaInjection
  const html = template
  .replace(/{{url}}/g, url.toString())
  .replace(/{{root}}/g, req.planktosRoot || '')
  .replace(/{{snapshotHash}}/g, snapshotHash)
  const injector = rsp.shouldStream && isHTML ? injectAsStream : injectAsString

  injector(rsp, html)
}

function injectAsString (rsp, html) {
  rsp.headers.set('Content-Length', html.length)

  rsp.createReadStream = function () {
    const s = new PassThrough()
    s.push(html)
    s.push(null)
    return s
  }
}

function injectAsStream (rsp, html) {
  rsp.headers.set('Content-Length', Number(rsp.headers.get('Content-Length')) + html.length)

  const old = rsp.createReadStream
  rsp.createReadStream = function () {
    var stream = new PassThrough()
    stream.write(html)
    return old().pipe(stream)
  }
}
