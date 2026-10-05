#!/usr/bin/env bash
#
# Who has opened the cloud demo, apart from us? Reads Caddy's access log on the
# VM (enabled in startup-demo.sh) and prints, per visitor IP that is NOT on the
# allow-list: when they first and last came, how many requests, which hosts and
# pages (assets left out) and which status codes.
#
#     deploy/gcp/who-visited.sh                       # since the log began
#     deploy/gcp/who-visited.sh --since 30m           # last 30 minutes
#     ALLOW="1.2.3.4 5.6.7.8" deploy/gcp/who-visited.sh
#
# Our own IP is added automatically (what this machine shows to the internet).
set -euo pipefail
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"; ZONE="${ZONE:-asia-southeast2-a}"; VM="${VM:-itulah-demo}"
since=""; [[ "${1:-}" == "--since" ]] && since="${2:?e.g. 30m, 2h, 1d}"
mine="$(curl -s -m5 https://api.ipify.org || true)"
allow="${ALLOW:-} $mine"

gcloud --project "$PROJECT" compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap \
  --command "sudo sh -c 'cat /var/lib/itulah/caddy/data/access.log.* /var/lib/itulah/caddy/data/access.log 2>/dev/null'" 2>/dev/null \
| ALLOW="$allow" SINCE="$since" python3 "$(dirname "${BASH_SOURCE[0]}")/who-visited.py"
