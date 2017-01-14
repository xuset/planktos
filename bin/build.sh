#!/bin/bash

set -e

PATH=$PATH:./node_modules/.bin

mkdir -p build
rm build/* || true

# Build sw

browserify sw.js --ignore webtorrent --debug \
 | exorcist build/planktos.sw.js.map \
 > build/planktos.sw.js

uglifyjs build/planktos.sw.js \
  --in-source-map build/planktos.sw.js.map \
  --source-map build/planktos.sw.min.js.map \
  --source-map-url planktos.sw.min.js.map \
 > build/planktos.sw.min.js

# Build lib

browserify index.js --debug -s planktos \
 | exorcist build/planktos.js.map \
 > build/planktos.js

uglifyjs build/planktos.js \
  --in-source-map build/planktos.js.map \
  --source-map build/planktos.min.js.map \
  --source-map-url planktos.min.js.map \
 > build/planktos.min.js

# Build tests

browserify test/test.js --debug \
 > build/test.js
