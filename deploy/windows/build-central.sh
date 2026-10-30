#!/usr/bin/env bash
# Builds the Windows Central (the hub on the desktop) installer, NSIS, on Linux
# with cargo-xwin. Runs inside Cloud Build
# (deploy/windows/cloudbuild-central.yaml) in the rust:1.98-bookworm image, from
# the staged tree (deploy/windows/stage-central.sh).
#
# The update artifact is deliberately NOT made here: signing it needs the
# private key, which stays on the Mac. On the Mac, `scripts/publish.sh` signs
# this setup.exe and adds windows-x86_64 to latest.json — the same two-step the
# README describes for a build made on a Windows PC.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# The shell carries a tray, and the Tauri CLI looks for the appindicator
# pkg-config file on a Linux host even when it is bundling for Windows.
apt-get install -y -qq clang lld llvm nsis curl xz-utils ca-certificates \
  libayatana-appindicator3-dev >/dev/null
export PATH="/usr/lib/llvm-14/bin:$PATH"

# node 22 from the tarball: the CLI the build runs through.
curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | tar -xJ -C /opt
export PATH="/opt/node-v22.12.0-linux-x64/bin:$PATH"

rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
export XWIN_ACCEPT_LICENSE=1

# The hub shell has no frontend bundle of its own (it loads the hosted hub), so
# there is nothing to install or build before `tauri build`.
cd frontend-hub/desktop
npm exec --yes --package=@tauri-apps/cli@2.11.5 -- tauri build \
  --runner cargo-xwin \
  --target x86_64-pc-windows-msvc \
  --bundles nsis \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'

mkdir -p /workspace/out
cp src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe /workspace/out/
ls -l /workspace/out
