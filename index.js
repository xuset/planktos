(function () {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.register('/planktos.sw.js')
  .catch(function (err) {
    console.log('Service worker registration failed with ' + err)
  })
})()
