#!/usr/bin/env bash
set -euo pipefail

ide=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
local_tools="$ide/../.local"
for bin in "$local_tools/llvm/usr/bin" "$local_tools/swift/usr/bin" "$local_tools/bin"; do
  if [[ -d "$bin" ]]; then export PATH="$bin:$PATH"; fi
done
if [[ -x "$local_tools/uxplay/usr/bin/uxplay" ]]; then
  export SWIFTFORGE_UXPLAY="${SWIFTFORGE_UXPLAY:-$local_tools/uxplay/usr/bin/uxplay}"
  libs="$local_tools/uxplay/usr/lib/x86_64-linux-gnu"
  export LD_LIBRARY_PATH="$libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export GST_PLUGIN_PATH="$libs/gstreamer-1.0${GST_PLUGIN_PATH:+:$GST_PLUGIN_PATH}"
fi
if [[ -x "$local_tools/iloader/deb/usr/bin/iloader" ]]; then
  export SWIFTFORGE_ILOADER="${SWIFTFORGE_ILOADER:-$local_tools/iloader/deb/usr/bin/iloader}"
fi
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"

cd "$ide"
if [[ "${1:-}" == "--dev" ]]; then
  exec npm run tauri -- dev
fi
if [[ ! -x "$ide/src-tauri/target/debug/swiftforge" ]]; then
  printf '%s\n' 'Build SwiftForge first: cd ide && npm ci && npm run tauri -- build --debug --no-bundle' >&2
  exit 1
fi
exec "$ide/src-tauri/target/debug/swiftforge"
