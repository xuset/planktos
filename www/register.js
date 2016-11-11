(function () {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.register('/sw.bundle.js', {scope: '/'})
  .catch(function (err) {
    console.log('Service worker registration failed with ' + err)
  })
})()
