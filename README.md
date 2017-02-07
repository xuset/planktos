<h1 align="center">
  <a href="https://xuset.github.io/planktos/">
    <img src="https://xuset.github.io/planktos/planktos-logo.png" width="35" alt="planktos">
  </a>
  Planktos
</h1>

<p align="center">
  <a href="https://travis-ci.org/xuset/planktos">
    <img alt="Build Status" src="https://travis-ci.org/xuset/planktos.svg?branch=master">
  </a>
  <a href="https://npmjs.org/package/planktos">
    <img alt="NPM" src="https://img.shields.io/npm/v/planktos.svg">
  </a>
  <a href="https://www.paypal.me/xuset">
    <img alt="Donate" src="https://img.shields.io/badge/Donate-PayPal-green.svg">
  </a>
</p>

<p align="center">
  <a href="https://saucelabs.com/u/xuset-planktos">
    <img alt="Sauce Test Status" src="https://saucelabs.com/browser-matrix/xuset-planktos.svg">
  </a>
</p>

Planktos enables websites to serve their static content over BitTorrent by turning users into seeders. That means that users viewing a website with Planktos are also serving the website to other users. This allows website owners to significantly reduce hosting costs for static content, scale in real-time without provisioning more web servers, and prevent user impact during an outage. Planktos works in vanilla Chrome and Firefox (no browser extensions needed), using [WebTorrent](https://webtorrent.io) for peer-to-peer file transfers and service workers to reroute network requests over BitTorrent.

Installing Planktos into a website is as simple as including the Planktos `install.js` script and using the Planktos command line interface to bundle the website's static files into a torrent. For typical use cases, Planktos is designed to work out of the box, and for more specialized use cases, Planktos has a very simple interface for customization.

A special thanks to the [WebTorrent](https://webtorrent.io) project, which is used extensively in Planktos.

## Setup

The Planktos command line interface (CLI) copies the necessary library files and packages the website's files into a torrent. To install the tool run:

`npm install -g planktos`

Change your current working directory to the root of the website, and to package the website into a torrent run:

`planktos [directories and/or files...]`

If no directories or files are passed in then the entire current working directory is packaged into the torrent. The tool will also copy the service worker, named `planktos.sw.min.js`, into the directory which reroutes network requests over BitTorrent. The service worker needs to be registered using the below install script or registered manually:

`<script src="/planktos/install.js"></script>`

After updating the website's files, users viewing the website over Planktos won't receive the updated files until after the torrent is repackaged which can be done by running the Planktos CLI again.

That was it. To test that everything is working as expected, use your browser's devtools to inspect the network requests your website makes.

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

## Contribute

Contributions are welcome!

Once you have some changes, you can test them with:

`npm test`

Or to automatically run the tests when the files are changed:

`npm run watch`

When the tests are running in the browser, if the browser is not focused it will sometimes pause the javascript code execution causing tests to timeout.

## License

MIT. Copyright (c) Austin Middleton.
