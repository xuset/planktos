
var filePromises = {}
var files = {}
var config = null

loadConfig()

addEventListener('fetch', function (event) {
  var url = new URL(event.request.url)
  var name = url.pathname.substr(1)

  if (url.host !== location.host) return
  if (name === '') name = 'index.html'
  if (name === 'bundle.js' && !(name in files)) return
  if (event.clientId == null && !(name in files)) return

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
  } else if (event.data.type === 'torrent') {
    event.ports[0].postMessage({torrentId: config.torrentId})
  } else {
    event.ports[0].postMessage({error: new Error('message type not supported')})
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
    .then(response => response.json())
    .then(json => {
      console.log('FOUND CONFIG', json)
      config = config || json
      return config
    })
}

// function openDatabase (name) {
//   return new Promise(function (resolve, reject) {
//     var dbOpenReq = indexedDB.open(name)
//     var upgraded = false
//     dbOpeReq.onerror = function (event) {
//       reject(dbOpeReq.error)
//     }
//     request.onsuccess = function (event) {
//       if (!upgraded) resolve(event.target.result)
//     }
//     request.onupgradeneeded = function (event) {
//       upgraded = true
//       var db = event.target.result
//       var objectStore = db.createObjectStore('files')
//       objectStore.transaction.oncomplete = function (event) {
//         resolve(db)
//       }
//     }
//   }
// }
//
// function getFile(filename) {
//   return new Promise(function (resolve, reject) {
//     var transaction = db.transaction (['files'])
//     var objectStore = transaction.objectStore('files')
//     var request = objectStore.get(filename)
//     request.onerror = function (event) {
//       reject(request.error)
//     }
//     request.onsuccess = function (event) {
//       resolve(request.result)
//     }
//   })
// }
//
// function putFile(filename, blob) {
//   return new Promise(function (resolve, reject) {
//     var transaction = db.transaction (['files'], 'write')
//     transaction.oncomplete = function (event) {
//       // TODO does this need to be handled?
//     }
//
//     transaction.onerror = function (event) {
//       reject(transaction.error)
//     }
//
//     var objectStore = transaction.objectStore('files')
//     var request = objectStore.put(blob, filename)
//     request.onsuccess = function () {
//       resolve()
//     }
//     }
//   })
// }
