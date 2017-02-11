#!/bin/bash

set -e

PATH=$PATH:./node_modules/.bin

mkdir -p build
rm build/* || true

# Build lib

browserify index.js --debug -s planktos \
 | exorcist build/planktos.js.map \
 > build/planktos.js

uglifyjs build/planktos.js --mangle --compress warnings=false \
  --in-source-map build/planktos.js.map \
  --source-map build/planktos.min.js.map \
  --source-map-url planktos.min.js.map \
 > build/planktos.min.js

# Build tests

browserify test/test.js --debug \
 > build/test.js
