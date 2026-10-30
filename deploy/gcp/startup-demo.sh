#!/bin/bash
#
# Startup script of the single demo VM (Debian 12), run at every boot — and,
# copied to /var/lib/itulah/bin/itulah-ctl, the tool a deploy runs on the VM.
# Containers on one docker network: pg (postgres:16), cloud, dc, store (the
# one itulah image with APP_BIN=...), caddy (HTTPS, 80/443). Only caddy is
# published; Postgres and the nodes are reachable inside the host only.
#
#   (no argument)        boot: make what is missing, keep what already runs
#   rollout <image>      deploy without downtime (deploy/gcp/rollout-demo.sh):
#                        the new cloud starts BESIDE the old one, Caddy moves
#                        to it once it answers /api/v1/health, the old one is
#                        stopped after it drains. A new cloud that never gets
#                        healthy is removed and nothing else changes.
#   caddy                write the Caddyfile and reload Caddy, nothing else
#
# Never down for a deploy (owner, 10 Oct 2026, after osretail.site went down
# twice in one VM reset): nothing here restarts Caddy or Postgres, and Caddy
# holds a request (lb_try_duration) while a node is being swapped.
set -euo pipefail
mode="${1:-boot}"
want_image="${2:-}"
if [ "$mode" = boot ]; then
  exec > >(tee -a /var/log/itulah-startup.log) 2>&1
else
  exec > >(tee -a /var/log/itulah-rollout.log) 2>&1
  echo "== $(date -u +%FT%TZ) $mode $want_image"
  # Visitors first: the deploy's own work (gcloud, docker client) waits for the
  # CPU the live cloud is not using. An e2-micro has a quarter of a core.
  renice -n 15 $$ >/dev/null 2>&1 || true
fi

meta() { curl -fsS -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/$1"; }
image="$(meta instance/attributes/itulah-image)"
# A rollout names its image; metadata follows once it is live.
if [ "$mode" = rollout ]; then image="${want_image:?rollout needs an image}"; fi
# The sandbox keeps its own image: its business databases are migrated by the
# build it runs (sandbox-...), which may be ahead of or behind the demo's, and
# a build that lacks a migration a database already holds does not start.
# Set with
#   gcloud compute instances add-metadata itulah-demo --metadata itulah-sandbox-image=<image>
sandbox_image="$(meta instance/attributes/itulah-sandbox-image 2>/dev/null || echo "$image")"
# The hub is a TanStack Start server since 16 Oct 2026 (SSR), not a folder of
# files: its image runs as the `hub-ssr` container and Caddy proxies the hub's
# pages to it. Unset, the hub is the static bundle in www/hub as before. Set with
#   gcloud compute instances add-metadata itulah-demo --metadata itulah-hub-image=<image>
hub_image="$(meta instance/attributes/itulah-hub-image 2>/dev/null || true)"
# Head office's WhatsApp (25 Oct 2026): `services/wa-gateway`, WhatsApp Web in
# a headless browser, sending shoppers their one-time codes. Its session lives
# in $state/wa, so a restart keeps the paired number. Unset, the cloud has no
# WhatsApp and asks nobody for a code. Set with
#   gcloud compute instances add-metadata itulah-demo --metadata itulah-wa-image=<image>
# and WA_GATEWAY_KEY (24+ characters) in the shared secret.
wa_image="$(meta instance/attributes/itulah-wa-image 2>/dev/null || true)"
# Ephemeral IP: the name follows the address at every boot.
ip="$(meta instance/network-interfaces/0/access-configs/0/external-ip)"
domain="${ip//./-}.sslip.io"
# The same hosts under nip.io too (10 Oct 2026): a client network that blocks
# *.sslip.io by name may still let this one through.
alias_domain="${ip//./-}.nip.io"
# The hub is also served at a domain of its own, when metadata names one
# (11 Oct 2026, osretail.site: its apex, www and hub.). Its DNS A records point
# at this VM's static address; Caddy gets the certificate itself. Set with
#   gcloud compute instances add-metadata itulah-demo --metadata itulah-public-domain=osretail.site
public_domain="$(meta instance/attributes/itulah-public-domain 2>/dev/null || true)"
hub_extra=""
if [ -n "$public_domain" ]; then hub_extra=", $public_domain, www.$public_domain, hub.$public_domain"; fi
# The till's web app answers at pos.<public domain> as well (owner, 23 Oct
# 2026: pos.osretail.site). Its A record is the owner's to add at the domain's
# DNS; until it resolves Caddy simply keeps asking for the certificate.
# `itulah-ctl caddy` asks again at once.
pos_extra=""
if [ -n "$public_domain" ]; then pos_extra=", pos.$public_domain"; fi
# The shop's own back office answers at store.<domain> and its warehouse
# screens at warehouse.<domain> (owner, 28 Oct 2026: "untuk mindah2in barang").
# Same A record rule as pos: the owner adds it at the domain's DNS.
warehouse_extra=""
if [ -n "$public_domain" ]; then warehouse_extra=", warehouse.$public_domain"; fi
# A self-hosted Next.js UI can sit on an explicit path without replacing the
# existing Hub bundle or its API origin. Disabled unless a VM opts in.
next_route=""
if [ "$(meta instance/attributes/itulah-next-prototype 2>/dev/null || echo false)" = true ]; then
  next_route='  handle /next-prototype/* {
    reverse_proxy next:3100 {
      import hold
    }
  }'
fi
# Where the Gudang's work is done: `edge` = a DC server (the dc container, its
# own SQLite, syncing), `cloud` = by the cloud itself, in its own tables, no
# sync (DC-CLOUD-NATIVE.md, backend/src/cloud/dc). Set with
#   gcloud compute instances add-metadata itulah-demo --metadata itulah-dc-hosting=cloud
dc_hosting="$(meta instance/attributes/itulah-dc-hosting 2>/dev/null || echo edge)"
registry="${image%%/*}"
state=/var/lib/itulah
# Which container serves the cloud now: `cloud` (the first boot), then
# `cloud-a` / `cloud-b` in turn, one per rollout. Every one of them answers to
# `cloud` on the itulah network (the nodes' sync URL). Caddy reaches the cloud
# as `cloud-front`, a name on a network of its own (`front`) that a cloud joins
# only once it is healthy — so a swap never reloads Caddy: a reload closed a
# connection it had just accepted (soak test, 10 Oct 2026).
cloud_live="$(cat "$state/active-cloud" 2>/dev/null || echo cloud)"

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

# Four more shops of the demo, each with its own store node (owner, 16 Oct
# 2026). Their units and shops were already in the database; each node is the
# container of its own name, registered under its own origin.
extra_stores="store-02 store-03 store-04 store-05"

mkdir -p "$state"/{pg,dc,store,store-sandbox,caddy/data,caddy/config,home}
for s in $extra_stores; do mkdir -p "$state/$s"; done
chmod 700 "$state"
mkdir -p "$state/wa"
chown 10001:10001 "$state/dc" "$state/store" "$state/store-sandbox"
# The gateway runs as node (uid 1000).
chown 1000:1000 "$state/wa"
for s in $extra_stores; do chown 10001:10001 "$state/$s"; done

export HOME="$state/home"
env_secret="$(meta instance/attributes/itulah-env-secret 2>/dev/null || echo itulah-demo-env)"
gcloud secrets versions access latest --secret "$env_secret" > "$state/shared.env"
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
# A hub sign-in lasts a day (owner, 2026-10-18); the server's default is 12 h.
INVENTORY_AUTH_TOKEN_TTL_MINUTES=1440
INVENTORY_STORE_INBOUND_COMMANDS=1
SYNC_APPLY=true
SYNC_ENQUEUE=false
SYNC_INGEST_KEY=$SYNC_INGEST_KEY
# The demo's clock may be moved from the hub header (Admin only): Time travel.
INVENTORY_ENABLE_TEST_CONTROLS=true
# The hub's assistant: Gemma 4 on Vertex AI, signed in as the VM's service
# account (needs roles/aiplatform.user), priced from tokens (15 Oct 2026).
ASSISTANT_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=$(meta project/project-id)
# Jev, TypeSafe's model, reads product photos on a PO and on New articles
# (15 Oct 2026). The key comes from the shared secret; without it the photo
# forms answer "not configured" and simply offer no suggestions.
TYPESAFE_API_KEY=${TYPESAFE_API_KEY:-}
JEV_MODEL=${JEV_MODEL:-jev-1.14.0}
# Seals fingerprint templates at rest (HR's enrolments, a store head's
# recordings waiting for approval). From the shared secret; without it the
# cloud refuses to store a finger rather than keep one in the clear.
ATTENDANCE_TEMPLATE_KEY=${ATTENDANCE_TEMPLATE_KEY:-}
$(if [ -n "$wa_image" ] && [ -n "${WA_GATEWAY_KEY:-}" ]; then cat <<E3
# Head office's WhatsApp, on the docker network (see ensure_wa_gateway).
WA_GATEWAY_URL=http://wa-gateway:3100
WA_GATEWAY_KEY=$WA_GATEWAY_KEY
E3
fi)
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
# hub also needs dc_hosting from /api/v1/health, which the gateway answers
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
# The hub's assistant: Gemma 4 on Vertex AI, signed in as the VM's service
# account (needs roles/aiplatform.user), priced from tokens (15 Oct 2026).
ASSISTANT_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=$(meta project/project-id)
# Jev, TypeSafe's model, reads product photos on a PO and on New articles
# (15 Oct 2026). The key comes from the shared secret; without it the photo
# forms answer "not configured" and simply offer no suggestions.
TYPESAFE_API_KEY=${TYPESAFE_API_KEY:-}
JEV_MODEL=${JEV_MODEL:-jev-1.14.0}
$(if [ "$dc_hosting" = cloud ]; then cat <<E3
# Every business's Gudang is run by the cloud, in its own database.
INVENTORY_DC_HOSTING=cloud
PRINT_BRIDGE_KEY=${PRINT_BRIDGE_KEY:-}
E3
fi)
E2
for n in dc store $extra_stores; do
  # The demo database was rebuilt on 3 Oct: the warehouse site is ho-gudang
  # (no site `dc`), the DC keeps origin id `dc`, and its SQLite was replaced
  # once, so its stream is generation 2 (register-demo-origins.sh).
  case $n in
    dc) site=ho-gudang; node=dc; role=DC; generation=2;;
    store) site=store-01; node=store-01; role=STORE; generation=1;;
    store-*) site=$n; node=$n; role=STORE; generation=1;;
  esac
  # The seed above is for a fresh database; the file is the stream's history.
  # After a replacement or a reset the cloud agrees a higher generation (the
  # demo store-01 is at 5), and a smaller seed makes the node refuse to start
  # ("sync generation cannot regress from 5 to 1") while the container loops.
  # Read what the file holds and seed with that.
  db="$state/$n/edge.sqlite3"
  if [ -f "$db" ]; then
    held=$(python3 - "$db" <<'PY' 2>/dev/null || true
import sqlite3, sys
try:
    c = sqlite3.connect(sys.argv[1])
    row = c.execute("select generation from sync_origin where singleton=1").fetchone()
    print(row[0] if row else "")
except Exception:
    print("")
PY
)
    if [ -n "$held" ]; then generation="$held"; fi
  fi
  cat > "$state/$n.env" <<E2
$common
APP_BIN=${n%%-*}
INVENTORY_ORIGIN_GENERATION=$generation
INVENTORY_SITE_ID=$site
INVENTORY_NODE_ID=$node
INVENTORY_NODE_ROLE=$role
INVENTORY_DATABASE_PATH=/data/edge.sqlite3
SYNC_UPLOAD_URL=http://cloud:8080
SYNC_UPLOAD_KEY=$SYNC_INGEST_KEY
E2
done
# The shop apps (store.<domain>, pos.<domain>) work against THIS node, not the
# demo's: a store node of the sandbox business `demo-copy` (9 Oct 2026). It is
# its own origin, `store-sb`, for site store-01 — the business is a copy of the
# demo database, whose store-01 already sent a generation-1 stream, so reusing
# that origin would have its first sales skipped as duplicates, and a fresh
# SQLite cannot start at generation 2 (its bootstrap fact is unacknowledged).
# register-sandbox-store.sh registers it. No bootstrap admin: its sign-in list
# arrives from the cloud. Its sync goes through Caddy's internal :8089, which
# names the business: a sync client sends none (backend/src/cloud/tenancy).
sandbox_business="${SANDBOX_STORE_BUSINESS:-demo-copy}"
cat > "$state/store-sandbox.env" <<E2
$(printf '%s\n' "$common" | grep -v '^INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=')
APP_BIN=store
INVENTORY_ORIGIN_GENERATION=1
INVENTORY_SITE_ID=store-01
INVENTORY_NODE_ID=store-sb
INVENTORY_NODE_ROLE=STORE
INVENTORY_DATABASE_PATH=/data/edge.sqlite3
SYNC_UPLOAD_URL=http://caddy:8089
SYNC_UPLOAD_KEY=$SYNC_INGEST_KEY
E2
chmod 600 "$state"/*.env

# /edge reaches a DC server. A Gudang run by the cloud is reached at /api like
# the rest of the cloud, so there is nothing to route.
if [ "$dc_hosting" = cloud ]; then
  edge_route=""
else
  edge_route="  handle_path /edge/* {
    reverse_proxy dc:8080 {
      import hold
    }
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
$1.$domain, $1.$alias_domain$([ "$1" = hub ] && printf "%s" "$hub_extra")$([ "$1" = pos ] && printf "%s" "$pos_extra")$([ "$1" = warehouse ] && printf "%s" "$warehouse_extra") {
  encode gzip
  log {
    output file /data/access.log {
      roll_size 20mb
      roll_keep 3
    }
    format json
  }
  # The page is asked again every time; the hashed assets never change.
  @immutable path /assets/*
  header @immutable Cache-Control "public, max-age=31536000, immutable"
  @page not path /assets/* /api/* /edge/* /rembg/* /next-prototype/*
  header @page Cache-Control "no-cache"
$2
  handle {
$(if [ "$1" = hub ] && [ -n "$hub_image" ]; then cat <<E4
    reverse_proxy hub-ssr:3000 {
      import hold
    }
E4
else cat <<E4
    root * /srv/$1
    try_files {path} /index.html
    file_server
E4
fi)
  }
}
E3
}
# The Caddyfile, written in place: it is mounted into the caddy container as a
# file, and a file replaced by a rename would leave Caddy reading the old one.
render_caddy() {
{
# While a node is being swapped its address answers nothing for a moment: a
# request waits for it (up to 30 s, tried every 250 ms) instead of failing.
# Only a connection that could not be made is tried again, so a POST is never
# sent twice.
cat <<'E2'
(hold) {
  lb_try_duration 30s
  lb_try_interval 250ms
  transport http {
    dial_timeout 2s
    # A new connection per request: none is left parked on a cloud that is
    # shutting down, where a request could be lost.
    keepalive off
  }
}
E2
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
    reverse_proxy store:8080 {
      import hold
    }
  }
  handle {
    reverse_proxy cloud-front:8080 {
      import hold
    }
  }
}
E2
site hub "$edge_route
$rembg_route
$next_route
  handle /api/* {
    reverse_proxy cloud-front:8080 {
      import hold
    }
  }"
# The store app talks to the demo's own store node (store-01), not the sandbox's
# (owner, 16 Oct 2026).
site store "  handle /api/* {
    reverse_proxy store:8080 {
      import hold
    }
  }"
site customer "  handle /api/* {
    reverse_proxy cloud-front:8080 {
      import hold
    }
  }"
# The till, too, works against store-01 (owner, 21 Oct 2026: the sandbox
# store node is stopped).
site pos "  handle /api/* {
    reverse_proxy store:8080 {
      import hold
    }
  }"
# The shop's back office, also at warehouse.<domain>: the same bundle serves
# both, so the warehouse PC opens the stock moves beside the store's screens.
site warehouse "  handle /api/* {
    reverse_proxy store:8080 {
      import hold
    }
  }"
# The sandbox has its own web folder (www/sandbox, filled by
# `TARGET=sandbox deploy/gcp/deploy-hub-demo.sh`): what is being tried reaches
# it first and the demo's hub only when it is ready.
site sandbox "  handle /edge/* {
    reverse_proxy cloud-sandbox:8080 {
      import hold
    }
  }
  handle /api/* {
    reverse_proxy cloud-sandbox:8080 {
      import hold
    }
  }"
# Not published (no -p 8089): only containers on the itulah network reach it.
cat <<E2
http://:8089 {
  reverse_proxy cloud-sandbox:8080 {
    import hold
    header_up x-itulah-business $sandbox_business
  }
}
E2
} > "$state/Caddyfile.next"
cat "$state/Caddyfile.next" > "$state/Caddyfile"
rm -f "$state/Caddyfile.next"
}
render_caddy
mkdir -p "$state/www"/{hub,store,customer,pos,warehouse,sandbox}

gcloud auth configure-docker "$registry" -q
# The network is not always up at boot: a pull that times out once must not end
# the script half-way (10 Oct 2026: it did, and the containers were never made).
pull() { for _ in $(seq 1 8); do docker pull -q "$1" >/dev/null && return 0; sleep 15; done; return 1; }
# One network per name, made once. Docker allows two networks with one name,
# and then every command naming it fails as ambiguous (soak test, 10 Oct
# 2026): spare copies nobody uses are removed.
ensure_net() {
  local ids; ids=$(docker network ls -q --filter "name=^$1\$")
  if [ "$(printf '%s\n' $ids | grep -c .)" -gt 1 ]; then
    for id in $ids; do
      [ "$(docker network inspect -f '{{len .Containers}}' "$id")" = 0 ] && docker network rm "$id" >/dev/null
    done
    ids=$(docker network ls -q --filter "name=^$1\$")
  fi
  [ -n "$ids" ] || docker network create "$1" >/dev/null
}
ensure_net itulah
ensure_net front

exists() { docker ps -a --format '{{.Names}}' | grep -qx "$1"; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
# What a container was made from: its image and its environment file. Equal on
# both counts and it is left running — a reboot then restarts nothing twice
# (10 Oct 2026: the restart policy brought the old containers back, and this
# script then removed and remade every one of them a minute later).
stamp() { printf '%s %s' "$1" "$(sha256sum "$2" | cut -c1-16)"; }
same() { [ "$(docker inspect -f '{{index .Config.Labels "itulah.stamp"}}' "$1" 2>/dev/null)" = "$2" ]; }
# A cloud answers through the network, as Caddy reaches it — asked from inside
# the running caddy container (busybox wget). A throwaway curl container every
# two seconds was most of the load on an e2-micro during a deploy (load 16,
# soak test, 10 Oct 2026); the curl image is only the fallback before Caddy runs.
healthy() {
  if running caddy; then
    docker exec caddy wget -q -T 5 -O /dev/null "http://$1:8080/api/v1/health" >/dev/null 2>&1
  else
    docker run --rm --network itulah curlimages/curl -fsS -m 5 "http://$1:8080/api/v1/health" >/dev/null 2>&1
  fi
}
wait_healthy() {  # wait_healthy <name> <seconds>
  local end=$((SECONDS + $2))
  while [ $SECONDS -lt $end ]; do
    running "$1" || return 1
    healthy "$1" && return 0
    sleep 3
  done
  return 1
}
# Always asked, never skipped by a guess of ours: Caddy itself does nothing
# when the config it is given equals the one it runs, and a note kept beside
# the file can lie — after a reboot by an older script it did, Caddy kept
# routing to a cloud that was then stopped (soak test, 10 Oct 2026).
caddy_reload() {
  if running caddy; then
    docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  fi
}
# The front network: Caddy and the cloud that serves.
ensure_front() {
  ensure_net front
  if running caddy && ! docker inspect -f '{{json .NetworkSettings.Networks}}' caddy | grep -q '"front"'; then
    docker network connect front caddy
  fi
}
join_front() {  # join_front <cloud>: from now on Caddy's requests may reach it
  docker inspect -f '{{json .NetworkSettings.Networks}}' "$1" | grep -q '"front"' \
    || docker network connect --alias cloud-front front "$1"
}

# Take a node out before it stops, the way a load balancer drains one: inside
# its own network namespace new connections to :8080 are refused (a refused
# connection is one Caddy opens again elsewhere — nothing was sent, so even a
# POST is safe), and the ones already open are let finish. Only then is it
# stopped. Without this a request that had just reached the old cloud was cut
# by its shutdown: a sign-in answered 502 (soak test, 10 Oct 2026).
drain() {  # drain <container>
  local pid; pid=$(docker inspect -f '{{.State.Pid}}' "$1" 2>/dev/null || echo 0)
  if [ "$pid" -gt 0 ] && nsenter -t "$pid" -n iptables -I INPUT -p tcp --dport 8080 --syn -j REJECT --reject-with tcp-reset 2>/dev/null; then
    # Visitors' requests arrive from Caddy; the nodes' sync keeps connections
    # of its own open for good, and it tries again when they close.
    local caddy_ips filter="" ip
    caddy_ips=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' caddy 2>/dev/null)
    for ip in $caddy_ips; do filter="${filter:+$filter or }dst $ip"; done
    [ -n "$filter" ] || filter="dst 0.0.0.0/0"
    for _ in $(seq 1 60); do
      [ "$(nsenter -t "$pid" -n ss -Htn state established "( sport = :8080 ) and ( $filter )" 2>/dev/null | grep -c .)" = 0 ] && break
      sleep 0.5
    done
  else
    echo "drain: no iptables in $1's namespace; waiting instead" >&2
    sleep 5
  fi
}

run_cloud() {  # run_cloud <name> <image> [cpu-shares]
  docker run -d --name "$1" --restart unless-stopped --network itulah --network-alias cloud \
    --cpu-shares "${3:-1024}" \
    --label "itulah.stamp=$(stamp "$2" "$state/cloud.env")" \
    --env-file "$state/cloud.env" "$2" >/dev/null
}
run_edge() {  # run_edge <dc|store|store-NN> <image>
  # The extra shops are capped, so four of them cannot take the demo's memory.
  local cap=(); case $1 in store-*) cap=(--memory 150m);; esac
  docker run -d --name "$1" --restart unless-stopped --network itulah "${cap[@]}" \
    --label "itulah.stamp=$(stamp "$2" "$state/$1.env")" \
    --env-file "$state/$1.env" -v "$state/$1:/data" "$2" >/dev/null
}
# An edge node owns one SQLite file, so it is never run twice: it is stopped
# (gracefully: SIGTERM, 30 s to finish) and made again, and Caddy holds the
# requests that arrive in between.
swap_edge() {  # swap_edge <dc|store> <image>
  if exists "$1" && same "$1" "$(stamp "$2" "$state/$1.env")"; then docker start "$1" >/dev/null; return; fi
  running "$1" && drain "$1"
  docker stop -t 30 "$1" >/dev/null 2>&1 || true
  docker rm -f "$1" >/dev/null 2>&1 || true
  run_edge "$1" "$2"
}

ensure_pg() {
  # Postgres: small, host-only; data lives on the VM disk. 120 connections: the
  # demo's pool (20) plus a few sandbox businesses open at once (20 each).
  # Recreated when its flags change; the data directory carries over.
  local pg_args=(-c shared_buffers=64MB -c max_connections=120 -c work_mem=2MB
    -c maintenance_work_mem=32MB -c effective_cache_size=256MB)
  if exists pg && [[ "$(docker inspect pg --format '{{json .Args}}')" != *'max_connections=120'* ]]; then
    docker rm -f pg >/dev/null
  fi
  if ! exists pg; then
    docker run -d --name pg --restart unless-stopped --network itulah \
      -e POSTGRES_USER=itulah -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=itulah_cloud \
      -v "$state/pg:/var/lib/postgresql/data" \
      -p 127.0.0.1:5432:5432 \
      postgres:16 "${pg_args[@]}" >/dev/null
  else
    docker start pg >/dev/null
  fi
  for _ in $(seq 1 60); do docker exec pg pg_isready -U itulah -d itulah_cloud >/dev/null 2>&1 && break; sleep 1; done
  # The sandbox needs its control database; its businesses' databases it makes.
  docker exec pg psql -U itulah -d itulah_cloud -tAc "SELECT 1 FROM pg_database WHERE datname='itulah_control'" | grep -q 1 \
    || docker exec pg createdb -U itulah itulah_control
}

ensure_sandbox() {
  local img="$1"
  if ! { exists cloud-sandbox && same cloud-sandbox "$(stamp "$img" "$state/cloud-sandbox.env")"; }; then
    docker rm -f cloud-sandbox >/dev/null 2>&1 || true
    # Capped, so a busy sandbox cannot take the demo's memory with it.
    docker run -d --name cloud-sandbox --restart unless-stopped --network itulah --memory 350m \
      --label "itulah.stamp=$(stamp "$img" "$state/cloud-sandbox.env")" \
      --env-file "$state/cloud-sandbox.env" "$img" >/dev/null
  else docker start cloud-sandbox >/dev/null; fi
  if ! { exists store-sandbox && same store-sandbox "$(stamp "$img" "$state/store-sandbox.env")"; }; then
    docker rm -f store-sandbox >/dev/null 2>&1 || true
    docker run -d --name store-sandbox --restart unless-stopped --network itulah --memory 150m \
      --label "itulah.stamp=$(stamp "$img" "$state/store-sandbox.env")" \
      --env-file "$state/store-sandbox.env" -v "$state/store-sandbox:/data" "$img" >/dev/null
  else docker start store-sandbox >/dev/null; fi
}

# The hub's server. It asks the cloud for the page's data on the docker network
# (`cloud`, the alias every live cloud carries); `cloud-front` is only on
# Caddy's network.
ensure_hub_ssr() {
  [ -n "$hub_image" ] || return 0
  if exists hub-ssr && [ "$(docker inspect hub-ssr --format '{{.Config.Image}}')" = "$hub_image" ]; then
    docker start hub-ssr >/dev/null; return 0
  fi
  pull "$hub_image" || { echo "pull failed: $hub_image" >&2; return 1; }
  docker rm -f hub-ssr >/dev/null 2>&1 || true
  docker run -d --name hub-ssr --restart unless-stopped --network itulah --memory 400m \
    -e ITULAH_CLOUD_URL=http://cloud:8080 "$hub_image" >/dev/null
}

# Head office's WhatsApp gateway: Chromium wants shared memory and a few
# hundred MB; the session folder keeps the pairing across restarts.
ensure_wa_gateway() {
  [ -n "$wa_image" ] && [ -n "${WA_GATEWAY_KEY:-}" ] || return 0
  if exists wa-gateway && [ "$(docker inspect wa-gateway --format '{{.Config.Image}}')" = "$wa_image" ]; then
    docker start wa-gateway >/dev/null; return 0
  fi
  pull "$wa_image" || { echo "pull failed: $wa_image" >&2; return 1; }
  docker rm -f wa-gateway >/dev/null 2>&1 || true
  docker run -d --name wa-gateway --restart unless-stopped --network itulah --memory 700m \
    --shm-size 256m -v "$state/wa:/data" -e WA_GATEWAY_KEY="$WA_GATEWAY_KEY" "$wa_image" >/dev/null
}

ensure_caddy() {
  if exists caddy; then
    docker start caddy >/dev/null
    ensure_front
    # The Caddyfile was just written: a graceful reload when it changed, never
    # a restart.
    for _ in $(seq 1 20); do caddy_reload >/dev/null 2>&1 && return 0; sleep 1; done
    echo "caddy reload failed" >&2; return 1
  fi
  docker run -d --name caddy --restart unless-stopped --network itulah -p 80:80 -p 443:443 \
    -v "$state/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$state/www:/srv:ro" -v "$state/caddy/data:/data" -v "$state/caddy/config:/config" caddy:2 >/dev/null
  docker network connect front caddy
}

if [ "$mode" = boot ]; then
  pull "$image"; pull "$sandbox_image"; docker pull -q curlimages/curl >/dev/null 2>&1 || true
  ensure_pg
  # The live cloud: kept if it is the one wanted, else made again (a boot is
  # already a moment without the site; a deploy uses `rollout`).
  if ! { exists "$cloud_live" && same "$cloud_live" "$(stamp "$image" "$state/cloud.env")"; }; then
    docker rm -f "$cloud_live" >/dev/null 2>&1 || true
    run_cloud "$cloud_live" "$image"
  else docker start "$cloud_live" >/dev/null; fi
  wait_healthy "$cloud_live" 300 || echo "cloud not healthy yet" >&2
  join_front "$cloud_live"
  # Only one cloud is ever left behind.
  for other in cloud cloud-a cloud-b; do
    [ "$other" = "$cloud_live" ] || docker rm -f "$other" >/dev/null 2>&1 || true
  done
  if [ "$dc_hosting" != cloud ]; then swap_edge dc "$image"; else docker rm -f dc >/dev/null 2>&1 || true; fi
  swap_edge store "$image"
  for s in $extra_stores; do swap_edge "$s" "$image"; done
  ensure_sandbox "$sandbox_image"
  ensure_hub_ssr
  ensure_wa_gateway || echo "wa-gateway not started" >&2
  ensure_caddy
  docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
  echo "itulah demo up: $domain"
  exit 0
fi

if [ "$mode" = rollout ]; then
  pull "$image" || { echo "pull failed: $image" >&2; exit 1; }
  # The gateway first, so the new cloud finds it when it starts.
  ensure_wa_gateway || echo "wa-gateway not started" >&2
  docker pull -q curlimages/curl >/dev/null 2>&1 || true
  # Once, on a VM set up before the front network: Caddy joins it, the live
  # cloud joins it, and the Caddyfile that names cloud-front is loaded — the
  # one reload of this path, and only if the file changed.
  ensure_front
  join_front "$cloud_live"
  caddy_reload || { echo "caddy reload failed before the swap" >&2; exit 1; }
  cloud_live_before="$cloud_live"
  image_before="$(docker inspect -f '{{.Config.Image}}' "$cloud_live" 2>/dev/null || true)"
  next=cloud-a; [ "$cloud_live" = cloud-a ] && next=cloud-b
  docker rm -f "$next" >/dev/null 2>&1 || true
  echo "$(date -u +%T) starting $next beside $cloud_live"
  # A quarter of the CPU weight while it warms up (migrations, caches): the
  # live cloud keeps answering at full speed (soak test, 10 Oct 2026).
  run_cloud "$next" "$image" 256
  # It migrates the database before it answers: generous on an e2-micro.
  if ! wait_healthy "$next" 420; then
    echo "ROLLBACK: $next never answered /api/v1/health; $cloud_live keeps serving" >&2
    docker logs --tail 40 "$next" >&2 || true
    docker rm -f "$next" >/dev/null 2>&1 || true
    exit 1
  fi
  docker update --cpu-shares 1024 "$next" >/dev/null
  echo "$(date -u +%T) $next healthy; it joins the front"
  join_front "$next"
  echo "$next" > "$state/active-cloud"
  # Both answer for a moment; then the old one stops taking connections and
  # finishes what it holds (SIGTERM: the server's graceful shutdown, 30 s at
  # most). A connection Caddy cannot open meanwhile is opened again.
  sleep 5
  echo "$(date -u +%T) draining $cloud_live_before"
  drain "$cloud_live_before"
  echo "$(date -u +%T) stopping $cloud_live_before"
  docker stop -t 30 "$cloud_live_before" >/dev/null 2>&1 || true
  docker rm -f "$cloud_live_before" >/dev/null 2>&1 || true
  if [ "$dc_hosting" != cloud ]; then swap_edge dc "$image"; fi
  # ITULAH_SKIP_STORES=1: the cloud only, the store servers keep their build
  # (owner, 2026-10-18: "store nanti saja").
  if [ "${ITULAH_SKIP_STORES:-}" = 1 ]; then
    echo "$(date -u +%T) store servers left as they are"
  else
    echo "$(date -u +%T) swapping store"
    swap_edge store "$image"
    for s in $extra_stores; do swap_edge "$s" "$image"; done
  fi
  # No `docker image prune` here: on an e2-micro already in swap it starved
  # Caddy of disk for 20 s (soak test, 10 Oct 2026). Only the image just
  # replaced goes, if nothing else uses it; the boot prunes the rest.
  if [ -n "$image_before" ] && [ "$image_before" != "$image" ]; then
    docker rmi "$image_before" >/dev/null 2>&1 || true
  fi
  echo "$(date -u +%T) ROLLOUT OK: $image on $next"
  exit 0
fi

# The WhatsApp gateway alone, made again from the metadata's image.
if [ "$mode" = wa ]; then
  ensure_wa_gateway || exit 1
  echo "$(date -u +%T) WA OK: ${wa_image:-none}"
  exit 0
fi

# The Caddyfile alone, written above, loaded again — forced, so a site whose
# certificate failed (a DNS record added since) is asked for at once. Nothing
# is restarted.
if [ "$mode" = caddy ]; then
  docker exec caddy caddy reload --force --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "$(date -u +%T) CADDY OK"
  exit 0
fi

echo "unknown mode: $mode" >&2
exit 2
