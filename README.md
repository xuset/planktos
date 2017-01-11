<h1 align="center">
  <a href="https://xuset.github.io/planktos/">
    <img src="https://xuset.github.io/planktos/planktos-logo.png" width="35" alt="planktos">
  </a>
  Planktos
</h1>

<p align="center">
[![Build Status](https://travis-ci.org/xuset/planktos.svg?branch=master)](https://travis-ci.org/xuset/idb-kv-store)
 [![npm](https://img.shields.io/npm/v/planktos.svg)](https://npmjs.org/package/planktos)
</p>

Planktos enables websites to serve their static content over BitTorrent by turning users into seeders. This allows website owners to significantly reduce hosting costs for static content and scale in realtime without provisioning more web servers. Planktos works in vanilla Chrome and Firefox (no browser extensions needed), using [WebTorrent](https://webtorrent.io) for peer to peer file transfers. Planktos serves as a drop in tool to automatically allow files to be downloaded over BitTorrent when possible, defaulting to a web server when not.

Installing Planktos into a website is as simple as including the Planktos install script and using the Planktos command line interface to bundle your static files into a torrent.

A special thanks to the [WebTorrent](https://webtorrent.io) project, which is used extensively in Planktos.

## Setup

The Planktos command line interface (CLI) copies the necessary library files and packages the website's files into a torrent. To install the tool run:

`npm install -g planktos`

Now change your current working directory to the directory you want to be served by Planktos. To copy the library files run:

`planktos --lib-only`

The Planktos service worker, which intercepts network calls, needs to be registered by including the install script or registering the service worker manually:

`<script src="/planktos/install.js"></script>`

Finally, the website files need to be packaged into a torrent, so they can be served over BitTorrent. To selectively package files into a torrent run:

`planktos [directories and/or files...]`

NOTE: If no files or directories are passed in, Planktos packages everything in the current working directory.

That was it. To test that everything is working as expected, use your browser's devtools to inspect the network requests your website makes. To update files simply run the Planktos command again.

Requirements for Planktos Websites:
 * The site must be served over https (or http on localhost), because service workers have restrictions on which types of sites can register them
 * The web server must support the `HTTP Range` header, because the server is used as the initial seeder (see WebTorrent webseed). Most web servers support this feature; however, some, like Python's _simplehttpserver_, do not.

## How it Works

The Planktos CLI copies the website's static assets to `/planktos/[file_hash]` and packages those files into a torrent at `/planktos/root.torrent`. The CLI then generates a manifest that maps file paths to the their respective hashes, and stores it at `/planktos/manifest.json`. Finally, the CLI copies the Planktos library files including the service worker.

When the webpage is loaded, Planktos installs a service worker that intercepts all http requests made by the webpage. When a request is intercepted, Planktos checks to see if the requested file is in the torrent. If the file is in the torrent, it is downloaded from peers, otherwise, it is downloaded over http as it normally would be.

Due to the fact that service workers cannot use the [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) API, the actual downloading of torrents is delegated to a Planktos controlled webpage. Planktos accomplishes this by injecting a downloader script into the webpage when the fetch request is intercepted. See the [W3C issue](https://github.com/w3c/webrtc-pc/issues/230) for more info on WebRTC in service workers.

NOTE: If the browser does not have service worker support then everything goes over http like it would without
Planktos.

Planktos is still in early stages of development, and is not recommended for production use yet. Some blocking issues include:
 * Planktos cannot selectively download files within a torrent, so the entire torrent is downloaded. This doesn't matter for small sites, but it will not work for larger sites.
 * No streaming support. The requested file must be downloaded in it's entirety before it can be displayed to the user. Currently, only chrome supports streaming from service workers while Firefox has an [open issue](https://bugzilla.mozilla.org/show_bug.cgi?id=1128959) for it.

## Developing

To hack on Planktos, this process seems to work well:

* `npm run standard` will run the style and syntax checker
* `npm run bundle` will build the code and store the bundled output in the build directory.
* `./bin/setup.js -r example` will run the main Planktos executable on the example directory
* `./bin/server.js example` will start an http server that will serve the example directory files
* Now you can open `http://localhost:8080` in the browser to make sure that everything works.

Keep in mind that for changes to be reflected you'll have to unregister or update the existing Planktos service worker and refresh. You can delete all locally stored data and unregister service workers using the browser's developer tools.

## License

MIT. Copyright (c) Austin Middleton.
