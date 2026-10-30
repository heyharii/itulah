#!/usr/bin/env bash
# Stages the hub desktop shell from the working tree (latest, uncommitted
# included) and submits deploy/windows/cloudbuild-central.yaml.
#   deploy/windows/stage-central.sh
#   deploy/windows/fetch-central.sh <build id>   when it is done, then
#   frontend-hub/desktop/scripts/publish.sh <version> windows-x86_64 <setup> <setup>
set -euo pipefail
cd "$(dirname "$0")/../.."

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
X=(--exclude target --exclude node_modules --exclude .DS_Store)

mkdir -p "$STAGE/frontend-hub/desktop" "$STAGE/deploy/windows"
rsync -a "${X[@]}" frontend-hub/desktop/ "$STAGE/frontend-hub/desktop/"
cp deploy/windows/build-central.sh deploy/windows/cloudbuild-central.yaml \
  deploy/windows/Dockerfile.out "$STAGE/deploy/windows/"

export CLOUDSDK_PYTHON=${CLOUDSDK_PYTHON:-/Users/hari/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12}
gcloud builds submit "$STAGE" --config "$STAGE/deploy/windows/cloudbuild-central.yaml" \
  --async
