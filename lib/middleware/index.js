module.exports.getTorrentFile = require('./getTorrentFile.js')
module.exports.inject = require('./inject.js')
module.exports.range = require('./range.js')
module.exports.cache = require('./cache.js')

module.exports.run = function (middlewares, req, rsp) {
  return new Promise((resolve, reject) => {
    let index = 0
    next()

    function next () {
      if (index === middlewares.length) return resolve(rsp)
      let result = middlewares[index](req, rsp)
      index++
      handleResult(result)
    }

    function handleResult (result) {
      if (result instanceof Promise) result.then(handleResult).catch(handleResult)
      else if (result instanceof Error) reject(result)
      else if (result === false) resolve() // Short circuit. Do not produce response
      else if (result != null) reject(new Error('Received unexpected return value: ' + result))
      else next()
    }
  })
}
