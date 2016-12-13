<h1 align="center">
  <a href="http://www.planktos.xyz/">
    <img src="http://www.planktos.xyz/planktos-logo.png" width="35" alt="planktos">
  </a>
  Planktos
</h1>
<p align="center">
   <a href="https://badge.fury.io/js/planktos">
     <img src="https://badge.fury.io/js/planktos.svg" alt="npm version" height="18">
   </a>
</p>

Planktos enables the static portions of websites to be served over bittorrent from the website's users instead of over http from the web server. Some benifits in doing this are: offset declining ad revenue by utilizing the user's bandwidth, increased fault tolerence since the static portions are still accessible over bittorrent even if the web server goes down, and better scalabilty since downloads are faster with more peers.

Installing planktos into your site is as simple as registering the planktos service worker and creating a torrent that holds your static assets (or the entire site if it's completely static). There is no need to change your code since the service worker takes care of everything from intercepting the http requests to torrent downloading and seeding.

## Setup

First install the planktos command line tool with: `npm install -g planktos`

Then change your current working directory to the **root of your website**, and use the planktos tool to generate the torrent and neccessary files. You can specify to only include certain directories or files in the torrent with:

`planktos <dir_or_file_1> <dir_or_file_2> ...`

If no files or directories are passed, planktos includes everything in the current working directory.

After the operation has completed you should see a planktos directory and the `planktos.sw.js` service worker in your website's root directory. The planktos service worker needs to be registered, for convinence this script tag can be included which takes care of installing the service worker:

`<script src="/planktos/install.js"></script>`

## How it works

Once the planktos service worker is installed, it intercepts all http requests made by the browser. When a fetch request is intercepted, planktos looks to see if the requested file is in the torrent for the website. If it is, planktos responds with the file's data it retreived over bittorrent. If the requested file is not in the torrent, the request goes to the webserver over http like it would without planktos installed. Planktos uses the awesome [webtorrent](https://github.com/feross/webtorrent) project for everything bittorrent. One gotcha you may have noticed is that webtorrent relies on [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) for it's peer connections, and the WebRTC api is not accessible from within service workers. Planktos gets around this by injecting a downloader script in the initial webpage request which handles all the webtorrent downloading and seeding operations since this cannot be done in a service worker currently. See the [W3C issue](https://github.com/w3c/webrtc-pc/issues/230) for more info on WebRTC in web workers.

If the browser does not have service worker support than everything goes over http like it would without planktos.

Planktos is still early on in developement, and is not recomended for production use yet. Some issues that are holding back production use are:
 * Cannot selectively download files within a torrent; the entire torrent is downloaded. This is fine for small sites but this will get out of hand quick with larger sites.
 * No streaming support. The requested file must be downloaded in it's entirety before it can be displayed to the user. Currently only chrome supports streaming from the service worker while Firefox has an [open issue](https://bugzilla.mozilla.org/show_bug.cgi?id=1128959) for it.
