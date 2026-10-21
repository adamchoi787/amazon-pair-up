#!/usr/bin/env bash
# Renders slides.html to gallery/N.png (1500x1000) with headless Chrome.
cd "$(dirname "$0")"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
mkdir -p gallery
for i in 1 2 3 4 5 6 7 8 9; do
  out="$(cygpath -w "$PWD/gallery/$i.png")"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --window-size=1500,1000 \
    --screenshot="$out" "file:///$(cygpath -m "$PWD")/slides.html?s=$i" 2>&1 | tail -1
done
