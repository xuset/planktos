# Planktos

Run `npm install` once to install all the dependencies

Run `./bin/setup.js -s example -w http://localhost:8080` to setup the example directory so it can be served by a torrent

Run `./bin/server example` to start a http server for the example

After you have made file changes, rebundle the scripts with `npm run bundle` and re-setup the example directory by re-running the setup.js script.
