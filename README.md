<h1 align="center">
  <a href="https://xuset.github.io/planktos/">
    <img src="https://xuset.github.io/planktos/planktos-logo.png" width="35" alt="planktos">
  </a>
  Planktos
</h1>
<p align="center">
   <a href="https://www.npmjs.com/package/planktos">
     <img src="https://badge.fury.io/js/planktos.svg" alt="npm version" height="18">
   </a>
</p>

Planktos enables websites to serve their static content over BitTorrent by turning users into seeders. This allows website owners to almost entirely eliminate hosting costs for static content and scale in realtime without provisioning more web servers. Planktos works in vanilla Chrome and Firefox (no browser extensions needed), using the widely adopted WebRTC standard for peer to peer file transfers.

Installing Planktos into a website is as simple as including the Planktos install script and using the Planktos command line interface to bundle your static files into a torrent.

A special thanks to the [webtorrent](https://webtorrent.io) project, which we use to interface with torrents from the browser.

## Setup

The Planktos command line interface (CLI) copies the necessary library files and packages the website's files into a torrent. To install the tool run:

`npm install -g planktos`

Now change your current working directory to the directory you want to be served by Planktos. To copy the library files run:

`planktos --lib-only`

The Planktos service worker, which intercepts network calls, needs to be registered, which can be done by including this script:      

`<script src="/planktos/install.js"></script>`

Finally, the website files need to be packaged into a torrent, so they can be served over BitTorrent. To package all files into a torrent run:

`planktos [directories and/or files]`

NOTE: If no files or directories are passed in, Planktos packages everything in the current working directory.

That was it. To test that everything is working as expected, use devtools to inspect the network requests. To update files simply run the Planktos command again.

Requirements for Planktos Websites:
 * The site must be served over https (or http on localhost), because service workers have restrictions on which types of sites can register them
 * The web server must support the `HTTP Range` header, because the server is used as the initial seeder (see WebTorrent webseed). Most web servers support this feature; however, some, like Python's simplehttpserver, do not.

## How it works

Once the planktos service worker is installed, it intercepts all http requests made by the browser. When a fetch request is intercepted, planktos looks to see if the requested file is in the torrent for the website. If it is, planktos responds with the file's data it retreived over bittorrent. If the requested file is not in the torrent, the request goes to the web server over http like it would without planktos installed. Planktos uses the awesome [webtorrent](https://github.com/feross/webtorrent) project for everything bittorrent. One gotcha you may have noticed is that webtorrent relies on [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) for it's peer connections, and the WebRTC api is not accessible from within service workers. Planktos gets around this by injecting a downloader script in the initial webpage request which handles all the webtorrent downloading and seeding operations since this cannot be done in a service worker currently. See the [W3C issue](https://github.com/w3c/webrtc-pc/issues/230) for more info on WebRTC in web workers.

If the browser does not have service worker support than everything goes over http like it would without planktos.

Planktos is still early on in development, and is not recommended for production use yet. Some issues that are holding back production use are:
 * Cannot selectively download files within a torrent; the entire torrent is downloaded. This is fine for small sites but this will get out of hand quick with larger sites.
 * No streaming support. The requested file must be downloaded in it's entirety before it can be displayed to the user. Currently only chrome supports streaming from the service worker while Firefox has an [open issue](https://bugzilla.mozilla.org/show_bug.cgi?id=1128959) for it.

## Developing

To hack on planktos, this process seems to work well:

* `npm run standard` will run the style and syntax checker
* `npm run bundle` will build the code and store the bundled output in the build directory.
* `./bin/setup.js -r example` will run the main planktos executable on the example directory
* `./bin/server.js example` will start a http server that will serve the example directories files
* Then opening `http://localhost:8080` in a web browser, and making sure everything still works. Automated tests will come soon!

Keep in mind that for changes to be reflected you'll have to unregister or update the existing planktos service worker and refresh. This can be done by simply closing all windows and opening a new window.

Upon updating files served by planktos, the data stored in IndexedDB may no longer be representative of the files that need to be displayed, resulting in errors on page loads. A good workaround for now is to clear all locally stored data in your browser.

To delete locally stored data in Chrome: [cookies and site data](chrome://settings/cookies)

## License

MIT. Copyright (c) Austin Middleton.
