#!/bin/sh
set -eu

case "${APP_BIN:-cloud}" in
  cloud|dc|store)
    exec "/usr/local/bin/${APP_BIN:-cloud}"
    ;;
  *)
    echo "APP_BIN must be one of: cloud, dc, store" >&2
    exit 64
    ;;
esac
