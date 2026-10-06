#!/bin/bash
#
# Startup script of the single demo VM (Debian 12), run at every boot.
# Containers on one docker network: pg (postgres:16), cloud, dc, store (the
# one itulah image with APP_BIN=...), caddy (HTTPS, 80/443). Only caddy is
# published; Postgres and the nodes are reachable inside the host only.
set -euo pipefail
exec > >(tee -a /var/log/itulah-startup.log) 2>&1

meta() { curl -fsS -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/$1"; }
image="$(meta instance/attributes/itulah-image)"
# Ephemeral IP: the name follows the address at every boot.
ip="$(meta instance/network-interfaces/0/access-configs/0/external-ip)"
domain="${ip//./-}.sslip.io"
# Where the Gudang's work is done: `edge` = a DC server (the dc container, its
# own SQLite, syncing), `cloud` = by the cloud itself, in its own tables, no
# sync (DC-CLOUD-NATIVE.md, backend/src/cloud/dc). Set with
#   gcloud compute instances add-metadata itulah-demo --metadata itulah-dc-hosting=cloud
dc_hosting="$(meta instance/attributes/itulah-dc-hosting 2>/dev/null || echo edge)"
registry="${image%%/*}"
state=/var/lib/itulah

# 2 GB swap: the box has 1 GB.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile
fi
swapon /swapfile 2>/dev/null || true
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=60 >/dev/null

if ! command -v docker >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io curl ca-certificates
  systemctl enable --now docker
fi

mkdir -p "$state"/{pg,dc,store,caddy/data,caddy/config,home}
chmod 700 "$state"
chown 10001:10001 "$state/dc" "$state/store"

export HOME="$state/home"
gcloud secrets versions access latest --secret itulah-demo-env > "$state/shared.env"
chmod 600 "$state/shared.env"
set -a; . "$state/shared.env"; set +a

# Per-node environment files.
common="INVENTORY_AUTH_MODE=required
INVENTORY_AUTH_COOKIE_SECURE=true
INVENTORY_ENABLE_TEST_CONTROLS=false
INVENTORY_SSO_SIGNING_KEY_HEX=$INVENTORY_SSO_SIGNING_KEY_HEX
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=$INVENTORY_BOOTSTRAP_ADMIN_PASSWORD
FRONTEND_DIR=/app/api-only
BIND_ADDR=0.0.0.0:8080
RUST_LOG=inventory_backend=info,tower_http=info"
cat > "$state/cloud.env" <<E2
$common
INVENTORY_ORIGIN_GENERATION=1
APP_BIN=cloud
DATABASE_URL=postgresql://itulah:$PG_PASSWORD@pg:5432/itulah_cloud
# cloud-rig: the demo data is a copy of the local pos-e2e rig, whose cloud
# sync_origin row carries this id (2 Oct 2026).
INVENTORY_NODE_ID=cloud-rig
INVENTORY_NODE_ROLE=CLOUD
INVENTORY_STORE_INBOUND_COMMANDS=1
SYNC_APPLY=true
SYNC_ENQUEUE=false
SYNC_INGEST_KEY=$SYNC_INGEST_KEY
# The demo's clock may be moved from the hub header (Admin only): Time travel.
INVENTORY_ENABLE_TEST_CONTROLS=true
$(if [ -n "${GCS_HMAC_ACCESS_ID:-}" ]; then cat <<E3
STORAGE_ENDPOINT=https://storage.googleapis.com
R2_BUCKET=itulah-media-21f41328
# Where a browser reads a photograph from: the bucket is public (allUsers
# objectViewer). Without it every link handed out is presigned and expiring,
# which the hub refuses to store against an item (6 Oct 2026: product photos
# uploaded but never saved).
R2_PUBLIC_BASE_URL=https://storage.googleapis.com/itulah-media-21f41328
R2_ATTACHMENT_BUCKET=itulah-attachments-21f41328
R2_ACCESS_KEY_ID=$GCS_HMAC_ACCESS_ID
R2_SECRET_ACCESS_KEY=$GCS_HMAC_SECRET
E3
fi)
$(if [ "$dc_hosting" = cloud ]; then cat <<E3
# The Gudang is run by the cloud: no DC server, no sync.
INVENTORY_DC_HOSTING=cloud
PRINT_BRIDGE_KEY=${PRINT_BRIDGE_KEY:-}
E3
fi)
E2
# The sandbox beside the demo: many businesses, one database each, on the same
# Postgres (backend/src/cloud/tenancy). DATABASE_URL is its control database.
cat > "$state/cloud-sandbox.env" <<E2
APP_BIN=cloud
INVENTORY_TENANCY=sandbox
TENANCY_INVITE_CODE=${TENANCY_INVITE_CODE:-}
TENANCY_MAX_BUSINESSES=10
TENANCY_TEMPLATE_DATABASE=itulah_blank
DATABASE_URL=postgresql://itulah:$PG_PASSWORD@pg:5432/itulah_control
INVENTORY_NODE_ID=cloud-sandbox
INVENTORY_NODE_ROLE=CLOUD
# The Gudang is run by the cloud here too, as on the demo: no DC server. Without
# it the hub asked for a "warehouse node" that does not exist (7 Oct 2026). The
# hub also needs `dc_hosting` from /api/v1/health, which the gateway answers
# with its own mode only — the sandbox's Caddy site answers it like the hub's
# (see the live Caddyfile) until the gateway's health carries it.
INVENTORY_DC_HOSTING=cloud
# Required of an authenticated cloud; nothing syncs into the sandbox.
SYNC_INGEST_KEY=$SYNC_INGEST_KEY
INVENTORY_AUTH_MODE=required
INVENTORY_AUTH_COOKIE_SECURE=true
INVENTORY_ORIGIN_GENERATION=1
INVENTORY_ENABLE_TEST_CONTROLS=true
INVENTORY_SSO_SIGNING_KEY_HEX=$INVENTORY_SSO_SIGNING_KEY_HEX
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=$INVENTORY_BOOTSTRAP_ADMIN_PASSWORD
SYNC_ENQUEUE=false
FRONTEND_DIR=/app/api-only
BIND_ADDR=0.0.0.0:8080
RUST_LOG=inventory_backend=info,tower_http=warn
$(if [ "$dc_hosting" = cloud ]; then cat <<E3
# Every business's Gudang is run by the cloud, in its own database.
INVENTORY_DC_HOSTING=cloud
PRINT_BRIDGE_KEY=${PRINT_BRIDGE_KEY:-}
E3
fi)
E2
for n in dc store; do
  # The demo database was rebuilt on 3 Oct: the warehouse site is ho-gudang
  # (no site `dc`), the DC keeps origin id `dc`, and its SQLite was replaced
  # once, so its stream is generation 2 (register-demo-origins.sh).
  case $n in
    dc) site=ho-gudang; node=dc; role=DC; generation=2;;
    store) site=store-01; node=store-01; role=STORE; generation=1;;
  esac
  cat > "$state/$n.env" <<E2
$common
APP_BIN=$n
INVENTORY_ORIGIN_GENERATION=$generation
INVENTORY_SITE_ID=$site
INVENTORY_NODE_ID=$node
INVENTORY_NODE_ROLE=$role
INVENTORY_DATABASE_PATH=/data/edge.sqlite3
SYNC_UPLOAD_URL=http://cloud:8080
SYNC_UPLOAD_KEY=$SYNC_INGEST_KEY
E2
done
chmod 600 "$state"/*.env

# /edge reaches a DC server. A Gudang run by the cloud is reached at /api like
# the rest of the cloud, so there is nothing to route.
if [ "$dc_hosting" = cloud ]; then
  edge_route=""
else
  edge_route="  handle_path /edge/* {
    reverse_proxy dc:8080
  }"
fi

# /rembg takes the background off a garment photo: a Cloud Run service
# (deploy/gcp/rembg) the hub's web server calls with a key the browser never
# holds. Both values come from the shared env secret; without them there is no
# route and the hub's photo simply stays as it was taken.
rembg_route=""
if [ -n "${REMBG_URL:-}" ] && [ -n "${REMBG_KEY:-}" ]; then
  rembg_route="  handle_path /rembg/* {
    reverse_proxy $REMBG_URL {
      header_up Host {upstream_hostport}
      header_up X-Api-Key $REMBG_KEY
    }
  }"
fi

site() {  # site <name> <api-block>   static bundle from $state/www/<name>
  cat <<E3
$1.$domain {
  encode gzip
  log {
    output file /data/access.log {
      roll_size 20mb
      roll_keep 3
    }
    format json
  }
$2
  handle {
    root * /srv/$1
    try_files {path} /index.html
    file_server
  }
}
E3
}
{
cat <<E2
$domain {
  encode gzip
  log {
    output file /data/access.log {
      roll_size 20mb
      roll_keep 3
    }
    format json
  }
$edge_route
  handle_path /store/* {
    reverse_proxy store:8080
  }
  handle {
    reverse_proxy cloud:8080
  }
}
E2
site hub "$edge_route
$rembg_route
  handle /api/* {
    reverse_proxy cloud:8080
  }"
site store "  handle /api/* {
    reverse_proxy store:8080
  }"
site customer "  handle /api/* {
    reverse_proxy cloud:8080
  }"
site pos "  handle /api/* {
    reverse_proxy store:8080
  }"
# The sandbox has its own web folder (www/sandbox, filled by
# `TARGET=sandbox deploy/gcp/deploy-hub-demo.sh`): what is being tried reaches
# it first and the demo's hub only when it is ready.
site sandbox "  handle /edge/* {
    reverse_proxy cloud-sandbox:8080
  }
  handle /api/* {
    reverse_proxy cloud-sandbox:8080
  }"
} > "$state/Caddyfile"
mkdir -p "$state/www"/{hub,store,customer,pos,sandbox}

gcloud auth configure-docker "$registry" -q
docker pull "$image"
docker network inspect itulah >/dev/null 2>&1 || docker network create itulah
docker rm -f caddy store dc cloud cloud-sandbox >/dev/null 2>&1 || true

# Postgres: small, host-only; data lives on the VM disk. 120 connections: the
# demo's pool (20) plus a few sandbox businesses open at once (20 each).
# Recreated when its flags change; the data directory carries over.
pg_args=(-c shared_buffers=64MB -c max_connections=120 -c work_mem=2MB
  -c maintenance_work_mem=32MB -c effective_cache_size=256MB)
if docker ps -a --format '{{.Names}}' | grep -qx pg \
   && [[ "$(docker inspect pg --format '{{json .Args}}')" != *'max_connections=120'* ]]; then
  docker rm -f pg >/dev/null
fi
if ! docker ps -a --format '{{.Names}}' | grep -qx pg; then
  docker run -d --name pg --restart unless-stopped --network itulah \
    -e POSTGRES_USER=itulah -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=itulah_cloud \
    -v "$state/pg:/var/lib/postgresql/data" \
    -p 127.0.0.1:5432:5432 \
    postgres:16 "${pg_args[@]}"
else
  docker start pg >/dev/null
fi
for _ in $(seq 1 60); do docker exec pg pg_isready -U itulah -d itulah_cloud >/dev/null 2>&1 && break; sleep 1; done

docker run -d --name cloud --restart unless-stopped --network itulah --env-file "$state/cloud.env" "$image"
for _ in $(seq 1 90); do
  docker exec cloud true 2>/dev/null && docker run --rm --network itulah curlimages/curl -fsS http://cloud:8080/api/v1/health >/dev/null 2>&1 && break
  sleep 2
done
if [ "$dc_hosting" != cloud ]; then
  docker run -d --name dc --restart unless-stopped --network itulah --env-file "$state/dc.env" -v "$state/dc:/data" "$image"
fi
docker run -d --name store --restart unless-stopped --network itulah --env-file "$state/store.env" -v "$state/store:/data" "$image"
# The sandbox needs its control database; its businesses' databases it makes.
docker exec pg psql -U itulah -d itulah_cloud -tAc "SELECT 1 FROM pg_database WHERE datname='itulah_control'" | grep -q 1 \
  || docker exec pg createdb -U itulah itulah_control
# Capped, so a busy sandbox cannot take the demo's memory with it.
docker run -d --name cloud-sandbox --restart unless-stopped --network itulah --memory 350m \
  --env-file "$state/cloud-sandbox.env" "$image"
docker run -d --name caddy --restart unless-stopped --network itulah -p 80:80 -p 443:443 \
  -v "$state/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$state/www:/srv:ro" -v "$state/caddy/data:/data" -v "$state/caddy/config:/config" caddy:2
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
echo "itulah demo up: $domain"
