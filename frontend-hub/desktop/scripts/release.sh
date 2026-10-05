#!/usr/bin/env bash
# Builds Central on this machine and publishes its update (scripts/publish.sh).
#
# Bump "version" in src-tauri/tauri.conf.json first. Release macOS and Windows
# with the same version; for a Windows build made on another PC, copy its
# -setup.exe here and run publish.sh with it.
#
# Needs the signing key (~/.tauri/central-updater.key, or
# TAURI_SIGNING_PRIVATE_KEY_PATH), gcloud signed in to the project, and node.
set -euo pipefail
cd "$(dirname "$0")/.."

key="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/central-updater.key}"
[[ -f "$key" ]] || { echo "no signing key at $key" >&2; exit 1; }
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

version="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
bundle=src-tauri/target/release/bundle
# Nothing left over from an earlier build may be published as this one.
rm -rf "$bundle"
# CI=true skips the Finder (AppleScript) styling of the .dmg window, which
# fails whenever Finder cannot be scripted (a full-screen Space, no
# automation permission) and leaves the image mounted.
CI=true npx tauri build

case "$(uname -s)" in
  Darwin)
    scripts/publish.sh "$version" "darwin-$(uname -m | sed 's/arm64/aarch64/')" \
      "$bundle/macos/Central.app.tar.gz" "$(ls "$bundle"/dmg/Central_"$version"_*.dmg)"
    # One Central on the machine: Spotlight would list the build copy too.
    rm -rf "$bundle/macos/Central.app"
    ;;
  MINGW* | MSYS* | CYGWIN*)
    setup="$(ls "$bundle"/nsis/Central_"$version"_*-setup.exe)"
    scripts/publish.sh "$version" windows-x86_64 "$setup" "$setup"
    ;;
  *) echo "release from macOS or Windows" >&2; exit 1 ;;
esac
