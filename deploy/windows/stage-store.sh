#!/usr/bin/env bash
# Stages the store server's sources from the working tree (latest, uncommitted
# included) and submits deploy/windows/cloudbuild-store.yaml.
#   VERSION=0.2.0 CLOUD_URL=https://osretail.site deploy/windows/stage-store.sh
# Then deploy/windows/fetch-store.sh <build id> gives store.exe and web/, and
# on a Windows PC with the .NET SDK the MSI is one `wix build` away:
#   dotnet tool install --global wix --version 5.0.2
#   wix extension add -g WixToolset.Util.wixext/5.0.2 WixToolset.UI.wixext/5.0.2
#   wix build store.wxs -arch x64 -ext WixToolset.Util.wixext -ext WixToolset.UI.wixext
#     -d Version=<VERSION> -d BinDir=<dir with store.exe and web\> -d TrayScript=store-tray.ps1
#     -d CloudUrl=<CLOUD_URL> -o central-store-server-<VERSION>-x64.msi
set -euo pipefail
cd "$(dirname "$0")/../.."

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
X=(--exclude target --exclude node_modules --exclude dist --exclude dist-demo --exclude .DS_Store)

mkdir -p "$STAGE/deploy/windows"
rsync -a "${X[@]}"  backend/ "$STAGE/backend/"
rsync -a "${X[@]}" frontend-store-new/ "$STAGE/frontend-store-new/"
rsync -a "${X[@]}" frontend-contract/ "$STAGE/frontend-contract/"
cp deploy/windows/build-store.sh deploy/windows/cloudbuild-store.yaml deploy/windows/Dockerfile.store-out "$STAGE/deploy/windows/"

export CLOUDSDK_PYTHON=${CLOUDSDK_PYTHON:-/Users/hari/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12}
gcloud builds submit "$STAGE" --config "$STAGE/deploy/windows/cloudbuild-store.yaml" \
  --substitutions "_VERSION=${VERSION:-0.2.0},_CLOUD_URL=${CLOUD_URL:-https://osretail.site},_SKIP_WEB=${SKIP_WEB:-0}" --async
