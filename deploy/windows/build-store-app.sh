#!/usr/bin/env bash
# Builds the Central Store desktop app's installer (NSIS) on Linux with
# cargo-xwin. Runs inside Cloud Build (cloudbuild-store-app.yaml) in the
# rust:1.98-bookworm image, from the staged tree (stage-store-app.sh).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq clang lld llvm nsis curl xz-utils ca-certificates >/dev/null
export PATH="/usr/lib/llvm-14/bin:$PATH"
curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | tar -xJ -C /opt
export PATH="/opt/node-v22.12.0-linux-x64/bin:$PATH"

rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
export XWIN_ACCEPT_LICENSE=1

cd store-desktop
npm exec --yes --package=@tauri-apps/cli@2.11.5 -- tauri build \
  --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis

mkdir -p /workspace/out
cp src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe /workspace/out/
ls -l /workspace/out
