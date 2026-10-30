#!/usr/bin/env bash
# Downloads the Windows Central installer a cloudbuild-central.yaml run pushed
# as a scratch image.
#   deploy/windows/fetch-central.sh <build id> [out dir]
# The image is one layer holding the setup .exe: manifest, then blob, by REST.
# The installer is not signed: sign and publish it on the Mac with
# frontend-hub/desktop/scripts/publish.sh, which holds the updater key.
set -euo pipefail
BUILD=${1:?build id}
OUT=${2:-$HOME/Downloads}
export CLOUDSDK_PYTHON=${CLOUDSDK_PYTHON:-/Users/hari/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12}
PROJECT=$(gcloud config get-value project 2>/dev/null)
REG=asia-southeast2-docker.pkg.dev
REPO=v2/$PROJECT/itulah/win-central
TOKEN=$(gcloud auth print-access-token)
auth=(-H "Authorization: Bearer $TOKEN")

MANIFEST=$(curl -fsS "${auth[@]}" -H 'Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' "https://$REG/$REPO/manifests/$BUILD")
DIGEST=$(printf '%s' "$MANIFEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["layers"][0]["digest"])')

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "${auth[@]}" -o "$TMP/layer.tar.gz" "https://$REG/$REPO/blobs/$DIGEST"
mkdir -p "$OUT"
tar -xzf "$TMP/layer.tar.gz" -C "$OUT"
ls -l "$OUT"/*-setup.exe
