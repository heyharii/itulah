#!/usr/bin/env bash
# Signs one platform's update and publishes it to the feed every installed
# Central reads (gs://itulah-central-desktop/latest.json).
#
#   scripts/publish.sh <version> <platform> <update> [installer]
#
#   platform   darwin-aarch64 | darwin-x86_64 | windows-x86_64
#   update     what the updater downloads: Central.app.tar.gz on macOS, the
#              NSIS -setup.exe on Windows
#   installer  what people download the first time (.dmg / -setup.exe),
#              published at an address that stays put
#
# Used by release.sh after a local build, and on its own for a build made on
# another machine (a Windows PC), so the signing key never leaves this one.
# A new version starts the feed afresh: an old installer must never be offered
# as a newer one.
set -euo pipefail

[[ $# -ge 3 ]] || { sed -n 2,17p "$0"; exit 1; }
version="$1" platform="$2" update="$3" installer="${4:-}"

bucket="${BUCKET:-gs://itulah-central-desktop}"
public="https://storage.googleapis.com/${bucket#gs://}"
key="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/central-updater.key}"
[[ -f "$key" ]] || { echo "no signing key at $key" >&2; exit 1; }
cd "$(dirname "$0")/.."

# The key file only: release.sh exports the key itself for the build, and the
# signer refuses both at once.
env -u TAURI_SIGNING_PRIVATE_KEY npx tauri signer sign -f "$key" \
  -p "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$update" >/dev/null

# The update itself, under its version so a feed never points at a moved file.
update_name="$version/$(basename "$update" | tr ' ' '_')"
gcloud storage cp "$update" "$bucket/$update_name"

if [[ -n "$installer" ]]; then
  case "$platform" in
    darwin-*) stable="Central.dmg" ;;
    windows-*) stable="Central-setup.exe" ;;
  esac
  gcloud storage cp --cache-control="no-cache" "$installer" "$bucket/$stable"
fi

feed="$(mktemp)"
curl -fsS "$public/latest.json" -o "$feed" 2>/dev/null || echo '{}' > "$feed"
VERSION="$version" PLATFORM="$platform" URL="$public/$update_name" \
  SIGNATURE="$(cat "$update.sig")" FEED="$feed" node -e '
    const fs = require("fs")
    const env = process.env
    const old = JSON.parse(fs.readFileSync(env.FEED, "utf8") || "{}")
    const platforms = old.version === env.VERSION ? old.platforms || {} : {}
    platforms[env.PLATFORM] = { signature: env.SIGNATURE, url: env.URL }
    const feed = { version: env.VERSION, pub_date: new Date().toISOString(), platforms }
    fs.writeFileSync(env.FEED, JSON.stringify(feed, null, 2) + "\n")
  '
gcloud storage cp --cache-control="no-cache" --content-type=application/json \
  "$feed" "$bucket/latest.json"
rm -f "$feed"

echo "published Central $version for $platform"
echo "feed: $public/latest.json"
[[ -z "$installer" ]] || echo "installer: $public/$stable"
