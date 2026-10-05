#!/bin/bash
#
# The VM's startup script (Container-Optimized OS), run at every boot.
#
# Two containers on the host network:
#   * `cloud`  — the API image, on 127.0.0.1:8080, never reachable directly;
#   * `caddy`  — HTTPS on 80/443 for the VM's domain, certificates from
#                Let's Encrypt kept under /var/lib/itulah/caddy.
#
# Which image and which domain come from the instance metadata deploy.sh
# sets; the environment (secrets included) from Secret Manager, fetched with
# the VM's own service account. A new deploy changes the metadata and resets
# the VM, and this script pulls what it names.
set -euo pipefail

meta() {
  curl -fsS -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/$1"
}

image="$(meta instance/attributes/itulah-image)"
domain="$(meta instance/attributes/itulah-domain)"
project="$(meta project/project-id)"
registry="${image%%/*}"

state=/var/lib/itulah
mkdir -p "$state/caddy/data" "$state/caddy/config"
chmod 700 "$state"

# The environment, from Secret Manager. No jq on COS: the payload is one
# base64 string in a small JSON object.
token="$(meta instance/service-accounts/default/token | sed -E 's/.*"access_token":"([^"]+)".*/\1/')"
curl -fsS -H "Authorization: Bearer $token" \
  "https://secretmanager.googleapis.com/v1/projects/$project/secrets/itulah-cloud-env/versions/latest:access" \
  | sed -E 's/.*"data": *"([^"]+)".*/\1/' | base64 -d > "$state/cloud.env"
chmod 600 "$state/cloud.env"

cat > "$state/Caddyfile" <<EOF
$domain {
  encode gzip
  reverse_proxy 127.0.0.1:8080
}
EOF

# COS keeps /root read-only; docker's credential config needs a home.
export HOME="$state/home"
mkdir -p "$HOME"
docker-credential-gcr configure-docker --registries="$registry"

docker pull "$image"
docker rm -f cloud caddy >/dev/null 2>&1 || true

docker run -d --name cloud --restart unless-stopped --network host \
  --env-file "$state/cloud.env" \
  -e BIND_ADDR=127.0.0.1:8080 \
  "$image"

docker run -d --name caddy --restart unless-stopped --network host \
  -v "$state/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$state/caddy/data:/data" \
  -v "$state/caddy/config:/config" \
  caddy:2

# Old images are the one thing that fills a 10 GB disk.
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
