#!/bin/bash
#
# Startup script of the SANDBOX VM (Debian 12), run at every boot: one testing
# server, many businesses (INVENTORY_TENANCY=sandbox, backend/src/cloud/tenancy).
# Containers on one docker network: pg (postgres:16), cloud (the sandbox
# gateway), caddy (HTTPS, 80/443). No DC, store or till: the sandbox is the hub.
#
#   <ip>.sslip.io      → cloud (API)
#   hub.<ip>.sslip.io  → the hub bundle in $state/www/hub, /api → cloud
set -euo pipefail
exec > >(tee -a /var/log/itulah-startup.log) 2>&1

meta() { curl -fsS -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/$1"; }
image="$(meta instance/attributes/itulah-image)"
ip="$(meta instance/network-interfaces/0/access-configs/0/external-ip)"
domain="${ip//./-}.sslip.io"
registry="${image%%/*}"
state=/var/lib/itulah

if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile
fi
swapon /swapfile 2>/dev/null || true
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=30 >/dev/null

if ! command -v docker >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io curl ca-certificates
  systemctl enable --now docker
fi

mkdir -p "$state"/{pg,caddy/data,caddy/config,home,www/hub}
chmod 711 "$state"

export HOME="$state/home"
gcloud secrets versions access latest --secret itulah-sandbox-env > "$state/shared.env"
chmod 600 "$state/shared.env"
set -a; . "$state/shared.env"; set +a

# DATABASE_URL names the CONTROL database (one table, `business`); every
# business gets its own database on the same server, cloned from the template.
cat > "$state/cloud.env" <<E2
APP_BIN=cloud
INVENTORY_TENANCY=sandbox
TENANCY_INVITE_CODE=$TENANCY_INVITE_CODE
TENANCY_MAX_BUSINESSES=${TENANCY_MAX_BUSINESSES:-30}
TENANCY_TEMPLATE_DATABASE=itulah_blank
DATABASE_URL=postgresql://itulah:$PG_PASSWORD@pg:5432/itulah_control
INVENTORY_NODE_ID=cloud-sandbox
INVENTORY_NODE_ROLE=CLOUD
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
E2
chmod 600 "$state/cloud.env"

cat > "$state/Caddyfile" <<E2
$domain {
  encode gzip
  reverse_proxy cloud:8080
}
hub.$domain {
  encode gzip
  log {
    output file /data/access.log {
      roll_size 20mb
      roll_keep 3
    }
    format json
  }
  handle /api/* {
    reverse_proxy cloud:8080
  }
  handle {
    root * /srv/hub
    try_files {path} /index.html
    file_server
  }
}
E2

gcloud auth configure-docker "$registry" -q
docker pull "$image"
docker network inspect itulah >/dev/null 2>&1 || docker network create itulah
docker rm -f caddy cloud >/dev/null 2>&1 || true

# Postgres: the superuser `itulah` may CREATE DATABASE, which the sandbox
# needs. Each open business holds up to 20 connections, released a minute
# after it goes quiet, so the server allows a few businesses busy at once.
if ! docker ps -a --format '{{.Names}}' | grep -qx pg; then
  docker run -d --name pg --restart unless-stopped --network itulah \
    -e POSTGRES_USER=itulah -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=itulah_control \
    -v "$state/pg:/var/lib/postgresql/data" \
    -p 127.0.0.1:5432:5432 \
    postgres:16 -c shared_buffers=128MB -c max_connections=200 -c work_mem=2MB \
      -c maintenance_work_mem=64MB -c effective_cache_size=512MB
else
  docker start pg >/dev/null
fi
for _ in $(seq 1 60); do docker exec pg pg_isready -U itulah -d itulah_control >/dev/null 2>&1 && break; sleep 1; done

docker run -d --name cloud --restart unless-stopped --network itulah --env-file "$state/cloud.env" "$image"
docker run -d --name caddy --restart unless-stopped --network itulah -p 80:80 -p 443:443 \
  -v "$state/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$state/www:/srv:ro" -v "$state/caddy/data:/data" -v "$state/caddy/config:/config" caddy:2
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
echo "itulah sandbox up: https://hub.$domain"
