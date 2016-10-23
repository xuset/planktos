
let filePromises = {}
let files = {}

this.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url)
  if (url.host !== 'localhost:8080') return
  let name = url.pathname.substr(1)
  console.log('SW Fetch', 'clientId: ' + event.clientId, 'name: ' + name)

  if (name === 'www/' || name === 'planktos.js') return

  if (!(name in files) && event.clientId == null) {
    event.respondWith(new Response(bootstrapHtml), {headers: 'Content-Type: text/html;charset=UTF-8'})
  } else {
    event.respondWith(new Promise(function(resolve) {
      filePromises[name] = resolve
      resolvePromises()
    }))
  }
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

let bootstrapHtml = new Blob(['<!doctype html><html><head><meta charset="utf-8"><title>Loading...</title><script src="https://cdn.jsdelivr.net/webtorrent/latest/webtorrent.min.js"></script><script src="/planktos.js"></script><meta http-equiv="refresh" content="5"></head></html>'], {type : 'text/html'})
// // In the service worker:
// self.addEventListener('fetch', event => {
//   var html = '…html to serve…';
// 
//   var stream = new ReadableStream({
//     start(controller) {
//       var encoder = new TextEncoder();
//       // Our current position in `html`
//       var pos = 0;
//       // How much to serve on each push
//       var chunkSize = 1;
// 
//       function push() {
//         // Are we done?
//         if (pos >= html.length) {
//           controller.close();
//           return;
//         }
// 
//         // Push some of the html,
//         // converting it into an Uint8Array of utf-8 data
//         controller.enqueue(
//           encoder.encode(html.slice(pos, pos + chunkSize))
//         );
// 
//         // Advance the position
//         pos += chunkSize;
//         // push again in ~5ms
//         setTimeout(push, 5);
//       }
// 
//       // Let's go!
//       push();
//     }
//   });
// 
//   event.respondWith(new Response(stream, {
//     headers: {'Content-Type': 'text/html'}
//   }));
// });
