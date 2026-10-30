#!/usr/bin/env bash
# Stages what the POS build needs from the working tree (latest, uncommitted
# included) and submits deploy/windows/cloudbuild-pos.yaml.
#   deploy/windows/stage-pos.sh            POS
#   GUDANG=1 deploy/windows/stage-pos.sh   Gudang
#   DEBUG=1 …                               a debug build (simulated fingers)
set -euo pipefail
cd "$(dirname "$0")/../.."

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
X=(--exclude target --exclude node_modules --exclude dist --exclude dist-web --exclude .DS_Store)

mkdir -p "$STAGE/frontend-store-new/src/lib" "$STAGE/deploy/windows"
rsync -a "${X[@]}" pos-desktop/ "$STAGE/pos-desktop/"
rsync -a "${X[@]}" frontend-contract/ "$STAGE/frontend-contract/"
cp frontend-store-new/src/lib/epc.ts "$STAGE/frontend-store-new/src/lib/"
cp deploy/windows/build-pos.sh deploy/windows/cloudbuild-pos.yaml deploy/windows/Dockerfile.out "$STAGE/deploy/windows/"

export CLOUDSDK_PYTHON=${CLOUDSDK_PYTHON:-/Users/hari/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12}
gcloud builds submit "$STAGE" --config "$STAGE/deploy/windows/cloudbuild-pos.yaml" \
  --substitutions "_GUDANG=${GUDANG:-0},_DEBUG=${DEBUG:-0}" --async
