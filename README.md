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

Planktos enables websites to serve their static content over bittorrent from the users of the website. This allows site owners to offset declining ad revenue by utilizing the user's bandwidth and scale easier since downloads get faster with more peers. Planktos works in vanilla Chrome and Firefox by using service workers to intercept http requests, and [webtorrent](https://webtorrent.io/) to download the requested files from other users over bittorrent. Installing planktos into a website is as simple as registering the planktos service worker and creating a torrent that holds the static assets (or the entire site if it's completely static).

## Setup

The planktos command line tool copies the necessary library files, and it packages the website's files into a torrent. To install the tool run:

`npm install -g planktos`

Now change your current working directory to the directory you want to be served by planktos. The library files and service worker file need to be copied into this directory which can be done by running:

`planktos --lib-only`

The service worker needs to be registered which can be done by including this script:

`<script src="/planktos/install.js"></script>`

The final step is packaging the files into a torrent so it can be served over bittorrent which is done by running:

`planktos [directories or files...]`

If no files or directories are passed, planktos includes everything in the current working directory. Everything is setup now, and to test that everything is working open up the dev tools in look in the network tab. After modifying the website's files, the torrent can be repackaged by running the above command again.

There are a few things to keep in mind when using planktos:
 * The site must be served over https (or http on localhost) since service workers have restrictions on which types of sites can register them.
 * The web server must support the Range header since the server is used as a webseed. Most serves support this but python's simplehttpserver is a common one that doesn't.

## How it works

Once the planktos service worker is installed, it intercepts all http requests made by the browser. When a fetch request is intercepted, planktos looks to see if the requested file is in the torrent for the website. If it is, planktos responds with the file's data it retreived over bittorrent. If the requested file is not in the torrent, the request goes to the webserver over http like it would without planktos installed. Planktos uses the awesome [webtorrent](https://github.com/feross/webtorrent) project for everything bittorrent. One gotcha you may have noticed is that webtorrent relies on [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) for it's peer connections, and the WebRTC api is not accessible from within service workers. Planktos gets around this by injecting a downloader script in the initial webpage request which handles all the webtorrent downloading and seeding operations since this cannot be done in a service worker currently. See the [W3C issue](https://github.com/w3c/webrtc-pc/issues/230) for more info on WebRTC in web workers.

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
