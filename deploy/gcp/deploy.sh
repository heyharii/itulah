#!/usr/bin/env bash
#
# Deploy the CLOUD node to Google Cloud, small: one e2-micro VM in Jakarta on
# the same private network as the `itulah-pilot-db` Cloud SQL instance, which
# is shrunk to db-f1-micro. Roughly US$20-25 a month all in (VM, its static
# IP, the database) — see deploy/gcp/README.md for the sums and the why.
#
#     deploy/gcp/deploy.sh            # first time, and every deploy after
#
# Idempotent: every step checks before it makes. A redeploy builds a new
# image, points the VM at it and restarts the VM (about a minute down).
#
# Needs: gcloud signed in with owner rights on the project, billing linked,
# and deploy/gcp/cloud.env filled in from cloud.env.example.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
REGION="${REGION:-asia-southeast2}"
ZONE="${ZONE:-asia-southeast2-a}"
NETWORK="${NETWORK:-itulah-pilot-vpc}"
SQL_INSTANCE="${SQL_INSTANCE:-itulah-pilot-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"
DB_NAME="${DB_NAME:-itulah_cloud}"
DB_USER="${DB_USER:-itulah}"
VM="${VM:-itulah-cloud}"
MACHINE="${MACHINE:-e2-micro}"
REPO="${REPO:-itulah}"
SA_NAME="${SA_NAME:-itulah-cloud}"
# Empty: <ip-with-dashes>.sslip.io, which resolves to the VM with no DNS to
# set up and gets a real certificate. Set it to your own domain once its A
# record points at the VM's address.
DOMAIN="${DOMAIN:-}"

g() { gcloud --project "$PROJECT" "$@"; }
say() { printf '\n== %s\n' "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

# ── Before anything costs anything ───────────────────────────────────────────
[[ "$(g billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null)" == "True" ]] \
  || die "billing is not enabled on $PROJECT; link a billing account first (nothing was changed)"
env_file="$here/cloud.env"
[[ -f "$env_file" ]] || die "missing $env_file — copy cloud.env.example and fill it in"
grep -Eq '^SYNC_INGEST_KEY=.{32,}' "$env_file" \
  || die "SYNC_INGEST_KEY in cloud.env must be 32+ characters — the fleet master the store nodes authenticate with"
grep -q '^DATABASE_URL=' "$env_file" && die "leave DATABASE_URL out of cloud.env; this script writes it"

say "APIs"
g services enable compute.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  logging.googleapis.com

# ── The database ─────────────────────────────────────────────────────────────
say "Cloud SQL $SQL_INSTANCE → $SQL_TIER, running"
tier="$(g sql instances describe "$SQL_INSTANCE" --format='value(settings.tier)')"
policy="$(g sql instances describe "$SQL_INSTANCE" --format='value(settings.activationPolicy)')"
if [[ "$tier" != "$SQL_TIER" || "$policy" != "ALWAYS" ]]; then
  g sql instances patch "$SQL_INSTANCE" --tier="$SQL_TIER" --activation-policy=ALWAYS --quiet
fi
g sql databases describe "$DB_NAME" --instance "$SQL_INSTANCE" >/dev/null 2>&1 \
  || g sql databases create "$DB_NAME" --instance "$SQL_INSTANCE"

if ! g secrets describe itulah-db-password >/dev/null 2>&1; then
  password="$(openssl rand -hex 24)"
  printf '%s' "$password" | g secrets create itulah-db-password --data-file=- --replication-policy=automatic
  g sql users create "$DB_USER" --instance "$SQL_INSTANCE" --password "$password"
fi
password="$(g secrets versions access latest --secret itulah-db-password)"
db_ip="$(g sql instances describe "$SQL_INSTANCE" \
  --format='value(ipAddresses.filter("type:PRIVATE").extract(ipAddress).flatten())' | head -1)"
[[ -n "$db_ip" ]] || db_ip="$(g sql instances describe "$SQL_INSTANCE" --format='value(ipAddresses[0].ipAddress)')"
[[ -n "$db_ip" ]] || die "no private address on $SQL_INSTANCE"

# ── The image ────────────────────────────────────────────────────────────────
say "Image"
g artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 \
  || g artifacts repositories create "$REPO" --location "$REGION" --repository-format docker
tag="$(git -C "$root" rev-parse --short HEAD)"
if [[ -n "$(git -C "$root" status --porcelain -- backend Dockerfile deploy/entrypoint.sh)" ]]; then
  tag="$tag-dirty-$(date +%Y%m%d%H%M)"
  echo "note: backend/ has uncommitted changes; they are in this image ($tag)"
fi
image="$REGION-docker.pkg.dev/$PROJECT/$REPO/cloud:$tag"
(cd "$root" && g builds submit --config deploy/gcp/cloudbuild.yaml \
  --substitutions "_IMAGE=$image" .)

# ── Who the VM is, and what it may read ─────────────────────────────────────
say "Service account and secrets"
sa="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
g iam service-accounts describe "$sa" >/dev/null 2>&1 \
  || g iam service-accounts create "$SA_NAME" --display-name "itulah cloud VM"
for role in roles/artifactregistry.reader roles/secretmanager.secretAccessor \
            roles/logging.logWriter roles/monitoring.metricWriter; do
  g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$sa" \
    --role "$role" --condition=None --quiet >/dev/null
done

composed="$(mktemp)"; trap 'rm -f "$composed"' EXIT
grep -v '^DATABASE_URL=' "$env_file" > "$composed"
printf '\nDATABASE_URL=postgresql://%s:%s@%s:5432/%s\n' "$DB_USER" "$password" "$db_ip" "$DB_NAME" >> "$composed"
if g secrets describe itulah-cloud-env >/dev/null 2>&1; then
  g secrets versions add itulah-cloud-env --data-file="$composed" >/dev/null
else
  g secrets create itulah-cloud-env --data-file="$composed" --replication-policy=automatic
fi

# ── The machine ──────────────────────────────────────────────────────────────
say "Network"
g compute addresses describe "$VM-ip" --region "$REGION" >/dev/null 2>&1 \
  || g compute addresses create "$VM-ip" --region "$REGION"
ip="$(g compute addresses describe "$VM-ip" --region "$REGION" --format='value(address)')"
domain="${DOMAIN:-${ip//./-}.sslip.io}"
g compute firewall-rules describe "$VM-web" >/dev/null 2>&1 \
  || g compute firewall-rules create "$VM-web" --network "$NETWORK" \
       --allow tcp:80,tcp:443 --target-tags "$VM" --source-ranges 0.0.0.0/0
# SSH only through Identity-Aware Proxy (the database migration run uses it).
g compute firewall-rules describe "$VM-iap-ssh" >/dev/null 2>&1 \
  || g compute firewall-rules create "$VM-iap-ssh" --network "$NETWORK" \
       --allow tcp:22 --target-tags "$VM" --source-ranges 35.235.240.0/20
subnet="$(g compute networks subnets list --network "$NETWORK" --regions "$REGION" --format='value(name)' | head -1)"
[[ -n "$subnet" ]] || die "no subnet of $NETWORK in $REGION"

say "VM $VM ($MACHINE) → $image"
metadata="itulah-image=$image,itulah-domain=$domain,google-logging-enabled=true"
if g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  g compute instances add-metadata "$VM" --zone "$ZONE" --metadata "$metadata" \
    --metadata-from-file startup-script="$here/startup.sh"
  g compute instances reset "$VM" --zone "$ZONE"
else
  g compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family cos-stable --image-project cos-cloud --boot-disk-size 10GB \
    --network "$NETWORK" --subnet "$subnet" --address "$ip" --tags "$VM" \
    --service-account "$sa" --scopes cloud-platform \
    --metadata "$metadata" --metadata-from-file startup-script="$here/startup.sh"
fi

say "Waiting for https://$domain/api/v1/health"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$domain/api/v1/health" >/dev/null 2>&1; then
    echo "up: https://$domain"
    echo "next: point the hub's /api/* rewrite at https://$domain/api/*"
    exit 0
  fi
  sleep 10
done
die "no answer from https://$domain after 10 minutes; look at: gcloud compute ssh $VM --zone $ZONE --tunnel-through-iap --command 'docker logs cloud --tail 100'"
