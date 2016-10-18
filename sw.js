
let filePromises = {}
let files = {}

this.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url)
  if (url.host !== 'localhost:8080') return
  let name = url.pathname.substr(1)
  console.log('SW Fetch', url, url.host, url.pathname, 'name: ' + name)

  if (name === 'www/' || name === 'planktos.js') return

  event.respondWith(new Promise(function(resolve) {
    filePromises[name] = resolve
    resolvePromises()
  }))
})

self.addEventListener('message', function(event){
  console.log("SW Received Message: " + event.data.name)
  files['www/' + event.data.name] = event.data.blob
  if (event.data.name === 'index.html') files['www/'] = event.data.blob
  resolvePromises()
})

function resolvePromises() {
  console.log('trying to resolve from: ', Object.keys(files))
  for (let name in files) {
    if (name in filePromises) {
      console.log('RESOLVED ' + name)
      let promise = filePromises[name]
      delete filePromises[name]
      promise(new Response(files[name]))
    }
  }
}
