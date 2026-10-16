#!/usr/bin/env bash
# Build an isolated Next.js cache experiment candidate on demo3. The active
# prototype and the baseline Hub stay untouched until a separate promotion.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project="project-21f41328-b088-4894-b3f"
vm="itulah-demo3"
zone="asia-southeast1-b"
release="cache-exp-$(date -u +%Y%m%d%H%M%S)"
workspace="/var/lib/itulah-next/releases/$release"
cache="/var/lib/itulah-next/cache-experiment/$release"
container="next-prototype-$release"
frc_container="next-frc-probe-$release"

g() { gcloud --project "$project" "$@"; }

status="$(g compute instances describe "$vm" --zone "$zone" --format='value(status)')"
[[ "$status" == RUNNING ]] || { echo "$vm must be RUNNING; found $status" >&2; exit 1; }

# Refuse to replace another experiment or use an occupied private tunnel port.
existing="$(g compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
  "sudo docker ps --filter publish=13100 --format '{{.Names}}'; sudo docker ps --filter publish=13101 --format '{{.Names}}'; sudo docker ps -a --filter name='^/$container$' --format '{{.Names}}'; sudo docker ps -a --filter name='^/$frc_container$' --format '{{.Names}}'")"
[[ -z "$existing" ]] || { echo "demo3 candidate port/container already in use: $existing" >&2; exit 1; }

COPYFILE_DISABLE=1 tar --no-xattrs -C "$root" \
  --exclude='frontend-hub-next/node_modules' \
  --exclude='frontend-hub-next/.next' \
  --exclude='frontend-hub-next/tsconfig.tsbuildinfo' \
  -czf - \
  frontend-hub-next frontend-hub/src frontend-hub/public frontend-contract/src \
  | g compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
      "sudo mkdir -p '$workspace' '$cache' && sudo tar -xzf - -C '$workspace' && sudo cp /var/lib/itulah-next/workspace/frontend-hub-next/package-lock.json '$workspace/frontend-hub-next/package-lock.json' && sudo ln -sfn ../frontend-hub-next/node_modules '$workspace/frontend-hub/node_modules' && sudo ln -sfn ../frontend-hub-next/node_modules '$workspace/frontend-contract/node_modules'"

g compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
  "sudo docker run --rm --network itulah --cpus=1.75 --memory=4g -v '$workspace:/workspace' -w /workspace/frontend-hub-next -e NEXT_BASE_PATH=/next-prototype -e NEXT_DC_HOSTING=cloud -e NEXT_PUBLIC_EDGE_BASE=/edge -e RUST_API_ORIGIN=http://cloud:8080 -e NEXT_TELEMETRY_DISABLED=1 node:24-bookworm-slim bash -lc 'npm ci --no-audit --no-fund && npm run build && cd frc-probe && NEXT_FRC_BUILD_MARKER=$release npm run build'"

# The candidate listens only on VM loopback. Reach it from the benchmark host
# through an IAP SSH tunnel; it is not added to Caddy's public route.
g compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
  "sudo docker run -d --name '$container' --restart unless-stopped --network itulah --cpus=1.25 --memory=2g --memory-swap=3g -p 127.0.0.1:13100:3100 -w /workspace/frontend-hub-next -v '$workspace:/workspace' -v '$cache:/workspace-cache' -e NODE_ENV=production -e PORT=3100 -e HOSTNAME=0.0.0.0 -e NODE_OPTIONS=--max-old-space-size=1400 -e NEXT_BASE_PATH=/next-prototype -e NEXT_DC_HOSTING=cloud -e NEXT_PUBLIC_EDGE_BASE=/edge -e RUST_API_ORIGIN=http://cloud:8080 -e ITULAH_NEXT_CACHE_DIR=/workspace-cache/snapshots -e ITULAH_NEXT_METRICS_FILE=/workspace-cache/metrics.ndjson node:24-bookworm-slim npm run start"

g compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
  "sudo docker run -d --name '$frc_container' --restart unless-stopped --network itulah --cpus=0.5 --memory=768m --memory-swap=1g -p 127.0.0.1:13101:3101 -w /workspace/frontend-hub-next/frc-probe -v '$workspace:/workspace' -e NODE_ENV=production -e HOSTNAME=0.0.0.0 -e NODE_OPTIONS=--max-old-space-size=512 node:24-bookworm-slim npm run start"

g compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
  "for attempt in \$(seq 1 30); do if sudo docker exec '$container' node -e 'fetch(\"http://127.0.0.1:3100/next-prototype/procurement/orders\").then(r=>{console.log(\"candidate_http=\"+r.status);process.exit(r.status===200?0:1)}).catch(()=>process.exit(1))'; then exit 0; fi; sleep 2; done; sudo docker logs --tail=80 '$container'; exit 1"

g compute ssh "$vm" --zone "$zone" --tunnel-through-iap --command \
  "for attempt in \$(seq 1 30); do if sudo docker exec '$frc_container' node -e 'Promise.all([fetch(\"http://127.0.0.1:3101/static\"),fetch(\"http://127.0.0.1:3101/session\",{headers:{cookie:\"frc-probe=smoke\"}})]).then(async ([a,b])=>{const x=await a.text(),y=await b.text();console.log(\"frc_static_http=\"+a.status+\" session_http=\"+b.status);process.exit(a.status===200&&b.status===200&&x.includes(\"data-probe=\\\"full-route-cache\\\"\")&&y.includes(\"data-cookie-value=\\\"smoke\\\"\")?0:1)}).catch(()=>process.exit(1))'; then exit 0; fi; sleep 2; done; sudo docker logs --tail=80 '$frc_container'; exit 1"

echo "Built isolated demo3 cache candidate: $release"
echo "Container: $container"
echo "Workspace: $workspace"
echo "Private endpoint: 127.0.0.1:13100 (use an IAP SSH tunnel)"
echo "Synthetic Full Route Cache probe: 127.0.0.1:13101 (static route and per-request cookie route)"
echo "The active Next prototype and public Hub route were not changed."
