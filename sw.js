
var filePromises = {}
var files = {}
var config = null
var delegator = null
var available = []

loadConfig()
assignDelegator()

addEventListener('fetch', function (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)

  if (url.host !== location.host) return
  if (name === '') name = 'index.html'
  if (name === 'bundle.js' && !(name in files)) return
  if (event.clientId == null && !(name in files)) return

  assignDelegator()

  console.log('SW Fetch', 'clientId: ' + event.clientId, 'name: ' + name)

  if (name in files) {
    return event.respondWith(new Response(files[name]))
  } else {
    event.respondWith(new Promise(function (resolve) {
      console.log('Defferring', name)
      filePromises[name] = resolve
    }))
  }
})

addEventListener('message', function (event) {
  console.log('SW Received: ' + event.data.type, event.data)
  if (event.data.type === 'file') {
    files[event.data.name] = event.data.blob
    resolvePromises()
    event.ports[0].postMessage({})
  } else if (event.data.type === 'available') {
    available.push(event.source.id)
    assignDelegator()
  } else {
    event.ports[0].postMessage({error: 'message type not supported'})
  }
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

addEventListener('activate', function (event) {
  console.log('SW activate EVENT', event)
})

addEventListener('install', function (event) {
  console.log('SW INSTALL EVENT', event)

  var urls = ['/planktos.config.json']
  event.waitUntil(caches.open('planktosV1')
    .then((cache) => cache.addAll(urls))
    .then(() => loadConfig()))
})

function loadConfig () {
  return caches.open('planktosV1')
    .then(cache => cache.match(new Request('/planktos.config.json')))
    .then(response => response ? response.json() : null)
    .then(json => {
      console.log('FOUND CONFIG', json)
      config = json || config
      return config
    })
}

function assignDelegator () {
  this.clients.matchAll().then(clients => {
    var potentials = clients.filter(c => available.indexOf(c.id) !== -1)
    var redelegate = !delegator || !potentials.find(c => c.id === delegator.id)
    console.log('DELG', delegator ? delegator.id : null, potentials)
    if (redelegate && potentials.length > 0) {
      console.log('Found', potentials.length + '/' + clients.length, 'potential delegators')
      console.log('Delegating to', potentials[0].id)
      if (config.torrentId == null) throw new Error('cannot start download. torrentId unkown.')
      delegator = potentials[0]
      var msg = {
        type: 'download',
        torrentId: config.torrentId
      }
      delegator.postMessage(msg)
    }
  })
}
