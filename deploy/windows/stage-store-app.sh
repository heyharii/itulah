#!/usr/bin/env bash
# Stages the Central Store desktop app (and the POS discovery module it
# shares) and submits deploy/windows/cloudbuild-store-app.yaml.
#   deploy/windows/stage-store-app.sh
#   REPO=win-store-app deploy/windows/fetch-pos.sh <build id>
set -euo pipefail
cd "$(dirname "$0")/../.."
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/pos-desktop/src-tauri/src" "$STAGE/deploy/windows"
rsync -a --exclude target --exclude node_modules --exclude .DS_Store store-desktop/ "$STAGE/store-desktop/"
cp pos-desktop/src-tauri/src/discovery.rs "$STAGE/pos-desktop/src-tauri/src/"
cp deploy/windows/build-store-app.sh deploy/windows/cloudbuild-store-app.yaml deploy/windows/Dockerfile.out "$STAGE/deploy/windows/"
export CLOUDSDK_PYTHON=${CLOUDSDK_PYTHON:-/Users/hari/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12}
gcloud builds submit "$STAGE" --config "$STAGE/deploy/windows/cloudbuild-store-app.yaml" --async
