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
  <script src="{{root}}/planktos/planktos.min.js"></script>
  <script>
    new Planktos().startSeeder()
  </script>
</body>
</html>
`

module.exports.docWrite = `\
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="{{root}}/planktos/planktos.min.js"></script>
  <script>
    new Planktos().startSeeder()
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
