
var filePromises = {}
var files = {}

addEventListener('fetch', function (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)

  if (url.host !== location.host) return
  if (name === '') name = 'index.html'
  if (event.clientId == null && !(name in files)) return
  if (name === 'planktos.config.js' || name === 'bundle.js') return

  console.log('SW Fetch', 'clientId: ' + event.clientId, 'name: ' + name)

  // if (!(name in files) && event.clientId == null) {
  //   event.respondWith(new Response(bootstrapHtml), {headers: 'Content-Type: text/html;charset=UTF-8'})
  // } else {
  event.respondWith(new Promise(function (resolve) {
    console.log('Defferring', name)
    filePromises[name] = resolve
    resolvePromises()
  }))
  // }
})

addEventListener('message', function (event) {
  console.log('SW Received: ' + event.data.name)
  files[event.data.name] = event.data.blob
  resolvePromises()
})

function resolvePromises () {
  console.log('trying to resolve from: ', Object.keys(files))
  for (var name in files) {
    if (name in filePromises) {
      console.log('RESOLVED ' + name)
      var promise = filePromises[name]
      delete filePromises[name]
      promise(new Response(files[name]))
    }
  }
}
