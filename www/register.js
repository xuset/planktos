(function () {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.register('/sw.bundle.js', {scope: '/'}).then(function (reg) {
    if (reg.installing) {
      console.log('Service worker installing')
    } else if (reg.waiting) {
      console.log('Service worker installed')
    } else if (reg.active) {
      console.log('Service worker active')
    }
  }).catch(function (err) {
    console.log('Service worker registration failed with ' + err)
  })
})()
