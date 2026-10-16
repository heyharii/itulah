#!/usr/bin/env bash
# Build and install the current Hub/Vite baseline on the isolated demo3 VM.
# This is only for apples-to-apples PO + Receiving comparison with Next.js.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project="project-21f41328-b088-4894-b3f"
vm="itulah-demo3"
zone="asia-southeast1-b"
host="hub.34-21-216-42.sslip.io"
tmp="$(mktemp -d /private/tmp/itulah-demo3-hub-baseline.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT

status="$(gcloud --project "$project" compute instances describe "$vm" --zone "$zone" --format='value(status)')"
[[ "$status" == RUNNING ]] || { echo "$vm must be RUNNING; found $status" >&2; exit 1; }

echo "Building the existing Hub/Vite frontend to an isolated temporary directory."
(
  cd "$root/frontend-hub"
  VITE_HIDE_DOMAINS="hr,ga" ./node_modules/.bin/vite build --outDir "$tmp/dist"
)
test -f "$tmp/dist/index.html"

name="baseline-$(date -u +%Y%m%d%H%M%S)"
release="/var/lib/itulah/www/.releases/hub/$name"
webroot="/var/lib/itulah/www/hub"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$tmp/dist" -czf - . \
  | gcloud --project "$project" compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
      "set -euo pipefail; release='$release'; webroot='$webroot'; sudo mkdir -p \"\$release\"; sudo tar -xzf - -C \"\$release\"; sudo test -f \"\$release/index.html\"; if [ -d \"\$webroot\" ] && [ ! -L \"\$webroot\" ]; then if [ -n \"\$(sudo find \"\$webroot\" -mindepth 1 -maxdepth 1 -print -quit)\" ]; then echo 'demo3 baseline web root is not empty; refusing replacement' >&2; exit 1; fi; sudo rmdir \"\$webroot\"; fi; sudo ln -sfn '.releases/hub/$name' /var/lib/itulah/www/.hub.next; sudo mv -Tf /var/lib/itulah/www/.hub.next \"\$webroot\"; echo 'baseline_release=$name'"

echo "Installed Hub/Vite baseline at https://$host/procurement/orders on $vm."
