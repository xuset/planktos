module.exports.docWrite = `\
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="{{root}}/planktos/planktos.min.js"></script>
  <script>
    _planktos = new Planktos()
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

module.exports.rendermedia = `\
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
