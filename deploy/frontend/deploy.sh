#!/usr/bin/env bash
#
# Deploy the browser surfaces to Firebase Hosting.
#
# Firebase Hosting's Spark plan is free and needs no billing on the Google
# Cloud project. Five static sites, each rewriting /api/* to the node it
# belongs to so the browser still sees one origin and the SameSite=Strict
# session cookie is actually sent:
#
#   hub        frontend-hub          → CLOUD_URL (+ DC_URL under /edge)
#   store      frontend-store-new    → STORE_URL
#   pos        pos-desktop/ui (web)  → STORE_URL
#   customer   frontend-customer     → CLOUD_URL
#   employee   frontend-employee     → CLOUD_URL
#
# One-time: `firebase login`, then run this with PROJECT set — it creates the
# project's Hosting sites and the target map. Every deploy after:
#
#     CLOUD_URL=https://cloud.example STORE_URL=https://store.example \
#       PROJECT=<firebase-project-id> deploy/frontend/deploy.sh
#
# Env:
#   PROJECT    — the Firebase project id (required)
#   CLOUD_URL  — the cloud node base URL
#   STORE_URL  — the store edge base URL
#   DC_URL     — the DC edge base URL (optional; enables the hub's /edge)
#
# Builds are not run here — `make front` and `pos-desktop/ui`'s build:web own
# that, so a deploy cannot publish a stale half-build.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

PROJECT="${PROJECT:-}"
[[ -n "$PROJECT" ]] || { echo "deploy: set PROJECT=<firebase-project-id>" >&2; exit 1; }
command -v firebase >/dev/null 2>&1 \
  || { echo "deploy: firebase CLI missing — npm install -g firebase-tools" >&2; exit 1; }

# Refuse to publish a site whose dist is missing: that reads as "deleted the
# app" on the CDN, not as "forgot to build".
declare -a surfaces=(
  "hub:frontend-hub/dist"
  "store:frontend-store-new/dist"
  "pos:pos-desktop/ui/dist-web"
  "customer:frontend-customer/dist"
  "employee:frontend-employee/dist"
)
for pair in "${surfaces[@]}"; do
  name="${pair%%:*}"
  dist="${pair#*:}"
  [[ -d "$root/$dist" ]] || { echo "deploy: missing $root/$dist — build $name first" >&2; exit 1; }
done

# One Hosting site per surface. Site ids are global, so each is named after
# the project; sites:create on an existing id is an error we are happy to
# ignore.
for pair in "${surfaces[@]}"; do
  name="${pair%%:*}"
  firebase hosting:sites:create "$PROJECT-$name" --project "$PROJECT" >/dev/null 2>&1 || true
done

# Targets bind the entries in firebase.json to those site ids.
{
  echo '{'
  echo "  \"projects\": { \"default\": \"$PROJECT\" },"
  echo '  "targets": {'
  for i in "${!surfaces[@]}"; do
    name="${surfaces[$i]%%:*}"
    comma=","; [[ $i == $((${#surfaces[@]} - 1)) ]] && comma=""
    echo "    \"$name\": [ \"$PROJECT-$name\" ]$comma"
  done
  echo '  }'
  echo '}'
} > "$here/.firebaserc"

# The built bundles, copied under public/ so every path firebase.json names
# lives inside the project directory.
rm -rf "$here/public"
for pair in "${surfaces[@]}"; do
  name="${pair%%:*}"
  dist="${pair#*:}"
  mkdir -p "$here/public/$name"
  cp -R "$root/$dist/." "$here/public/$name/"
done

node "$here/gen.mjs" > "$here/firebase.json"
(cd "$here" && firebase deploy --only hosting --project "$PROJECT")
