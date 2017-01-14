(function () {
  if (!('serviceWorker' in navigator)) return

  var attributes = document.currentScript.attributes
  var sw = '/planktos.sw.min.js'
  if (attributes['sw']) sw = attributes['sw'].value
  if (attributes['data-sw']) sw = attributes['data-sw'].value

  navigator.serviceWorker.register(sw)
  .catch(function (err) {
    console.log('Service worker registration failed with ' + err)
  })
})()
