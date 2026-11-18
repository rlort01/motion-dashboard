#!/bin/sh
# Bump the ?v= stamp on local scripts and styles so browsers fetch the new files after a change.
V=$(date -u +%Y%m%d%H%M)
sed -i -E "s#(src|href)=\"([a-z]+\.(js|css))(\?v=[0-9]+)?\"#\1=\"\2?v=$V\"#g" index.html
echo "stamped $V"
