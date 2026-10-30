#!/usr/bin/env bash
# Builds the Windows POS installer (NSIS) on Linux with cargo-xwin. Runs inside
# Cloud Build (deploy/windows/cloudbuild-pos.yaml) in the rust:1.98-bookworm
# image, from the staged tree (deploy/windows/stage-pos.sh).
#
#   GUDANG=1 builds the Gudang variant instead of the POS.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq clang lld llvm nsis p7zip-full curl xz-utils ca-certificates >/dev/null
export PATH="/usr/lib/llvm-14/bin:$PATH"

# node 22 from the tarball (the apt one is too old for vite).
curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | tar -xJ -C /opt
export PATH="/opt/node-v22.12.0-linux-x64/bin:$PATH"

# The R3 vendor DLLs are not in the repo (README, "Windows POS build"). The last
# installer carries all five; take them from it and check the two vendor ones
# against the hashes the GitHub workflow pins.
NATIVE=pos-desktop/src-tauri/rfid-native
mkdir -p "$NATIVE" /tmp/prev
curl -fsSL -o /tmp/prev/prev-setup.exe \
  "https://storage.googleapis.com/itulah-central-desktop/pos/Central-POS-setup.exe" \
  || gsutil cp gs://itulah-central-desktop/pos/Central-POS-setup.exe /tmp/prev/prev-setup.exe
(cd /tmp/prev && 7z x -y prev-setup.exe >/dev/null)
for f in UHFAPI.dll libusb-1.0.dll vcruntime140.dll vcruntime140_1.dll msvcp140.dll; do
  found=$(find /tmp/prev -iname "$f" | head -1)
  [ -n "$found" ] || { echo "missing $f in the previous installer"; exit 1; }
  cp "$found" "$NATIVE/$f"
done
echo "25c044a8f0160d3365df4bb31608f645074f13cf153eaa1476bb91c42e1cdef8  $NATIVE/UHFAPI.dll" | sha256sum -c -
echo "5072054cb3002ae071f382ad5c2c2b0092d9451c537d0c13444c2b6f968f7251  $NATIVE/libusb-1.0.dll" | sha256sum -c -

rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
export XWIN_ACCEPT_LICENSE=1

cd pos-desktop/ui
npm ci --no-audit --no-fund
cd ../

ARGS=(--runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis)
if [ "${GUDANG:-0}" = "1" ]; then ARGS+=(--config src-tauri/tauri.gudang.conf.json); fi
# DEBUG=1: a debug build, whose shell can pretend a finger matched (a bench with
# no scanner); the bundle then lands under debug/ rather than release/.
PROFILE=release
if [ "${DEBUG:-0}" = "1" ]; then ARGS+=(--debug); PROFILE=debug; fi
# beforeBuildCommand runs `tsc -b && vite build`, so this is also the UI type check.
npm exec --yes --package=@tauri-apps/cli@2.11.5 -- tauri build "${ARGS[@]}"

mkdir -p /workspace/out
cp src-tauri/target/x86_64-pc-windows-msvc/$PROFILE/bundle/nsis/*-setup.exe /workspace/out/
ls -l /workspace/out
