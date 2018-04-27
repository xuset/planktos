const PassThrough = require('readable-stream').PassThrough
const trumpet = require('trumpet')

module.exports = function (snapshot) {
  return sourceTransform.bind(null, snapshot.hash)
}

var inject = `\
<script>
  document.addEventListener("DOMContentLoaded", function () {
    _planktos.getAllSnapshots().then(snaps => {
      var snapshot = snaps.find(s => s.hash === '{{snapshotHash}}')
      var elems = document.querySelectorAll("body *[planktos-src]")
      for (var i = 0; i < elems.length; i++) {
        var file = snapshot.getFile(elems[i].attributes["planktos-src"].value)
        if (file) file.renderTo(elems[i].tagName === "SOURCE" ? elems[i].parentElement : elems[i])
      }
    })
  })
</script>
`

function sourceTransform (snapshotHash, req, rsp) {
  if (!shouldTransform(req, rsp)) return

  var tr = trumpet()
  // TODO test audio tag
  tr.selectAll('video>source', function (elem) {
    elem.getAttribute('src', function (src) {
      if (src == null) return
      // TODO only replace for supported mime types
      elem.removeAttribute('src')
      elem.setAttribute('planktos-src', src)
    })
  })

  var html = inject.replace('{{snapshotHash}}', snapshotHash)
  rsp.headers.set('Content-Length', Number(rsp.headers.get('Content-Length')) + html.length)

  const old = rsp.createReadStream
  rsp.createReadStream = function () {
    var stream = new PassThrough()
    stream.write(html)
    return old().pipe(tr).pipe(stream)
  }
}

function shouldTransform (req, rsp) {
  return req.opts.sourceTransform !== false &&
    rsp.createReadStream &&
    rsp.headers.get('Content-Type') &&
    rsp.headers.get('Content-Type').startsWith('text/html')
}
