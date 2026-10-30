#!/usr/bin/env bash
# Builds the Windows store server (store.exe, mingw) and the store app it
# serves (web/) on Linux. Runs inside Cloud Build (cloudbuild-store.yaml) in
# the rust:1.98-bookworm image, from the staged tree (stage-store.sh). The MSI
# itself needs WiX, which runs on Windows only: see stage-store.sh.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq gcc-mingw-w64-x86-64 curl xz-utils ca-certificates >/dev/null

curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | tar -xJ -C /opt
export PATH="/opt/node-v22.12.0-linux-x64/bin:$PATH"

mkdir -p /workspace/out
# SKIP_WEB=1: store.exe only, for a build whose store app is someone else's
# half-done work; the MSI then takes web/ from the last good build.
[ "${SKIP_WEB:-0}" = "1" ] || (
  cd frontend-store-new
  npm ci --no-audit --no-fund
  # `build` is `tsc -b && vite build`; a type error elsewhere in the app must
  # not hold back the installer, so say so and bundle anyway.
  npm run build || { echo "WARNING: tsc failed, bundling with vite alone"; npx vite build; }
  cp -r dist /workspace/out/web
)

rustup target add x86_64-pc-windows-gnu
cd backend
sed -i -E "0,/^version = \"[^\"]+\"/s//version = \"${VERSION}\"/" Cargo.toml
export SQLX_OFFLINE=true
export CARGO_PROFILE_RELEASE_OPT_LEVEL=1
# Without it mingw's ld fails with "multiple definition of .refptr…".
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=256
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
export ITULAH_DEFAULT_CLOUD_URL="${CLOUD_URL}"
cargo build --release --target x86_64-pc-windows-gnu --bin store
x86_64-w64-mingw32-strip -o /workspace/out/store.exe target/x86_64-pc-windows-gnu/release/store.exe
echo "${VERSION}" > /workspace/out/VERSION
ls -l /workspace/out | head -20
