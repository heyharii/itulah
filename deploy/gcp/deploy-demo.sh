#!/usr/bin/env bash
#
# Cheapest possible DEMO of the whole backend on Google Cloud: ONE e2-micro VM
# in Jakarta running postgres + cloud + dc + store + caddy in docker, HTTPS at
# <ip>.sslip.io (/ → cloud, /edge → dc, /store → store). No Cloud SQL, no
# static IP. About US$11/month while running; `gcloud compute instances stop
# itulah-demo` leaves only the disk (~US$1).
#
#     IMAGE=<image> deploy/gcp/deploy-demo.sh      # IMAGE from a Cloud Build run
#
# The image is built with: gcloud builds submit --config deploy/gcp/cloudbuild.yaml \
#     --substitutions _IMAGE=<image> .
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
REGION="${REGION:-asia-southeast2}"; ZONE="${ZONE:-asia-southeast2-a}"
VM="${VM:-itulah-demo}"; SA_NAME="${SA_NAME:-itulah-demo}"
IMAGE="${IMAGE:?set IMAGE to the Artifact Registry image}"
g() { gcloud --project "$PROJECT" "$@"; }
[[ "$(g billing projects describe "$PROJECT" --format='value(billingEnabled)')" == "True" ]] || { echo "billing not enabled" >&2; exit 1; }

env_file="$here/cloud-demo.env"
if [[ ! -f "$env_file" ]]; then
  umask 077
  cat > "$env_file" <<E2
SYNC_INGEST_KEY=$(openssl rand -hex 24)
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=Password01
PG_PASSWORD=$(openssl rand -hex 16)
INVENTORY_SSO_SIGNING_KEY_HEX=$(openssl rand -hex 32)
E2
fi

g services enable compute.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com >/dev/null
sa="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
g iam service-accounts describe "$sa" >/dev/null 2>&1 || g iam service-accounts create "$SA_NAME" --display-name "itulah demo VM"
for role in roles/artifactregistry.reader roles/secretmanager.secretAccessor roles/logging.logWriter; do
  g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$sa" --role "$role" --condition=None --quiet >/dev/null
done
if g secrets describe itulah-demo-env >/dev/null 2>&1; then
  g secrets versions add itulah-demo-env --data-file="$env_file" >/dev/null
else
  g secrets create itulah-demo-env --data-file="$env_file" --replication-policy=automatic >/dev/null
fi

g compute firewall-rules describe "$VM-web" >/dev/null 2>&1 || g compute firewall-rules create "$VM-web" \
  --network default --allow tcp:80,tcp:443 --target-tags "$VM" --source-ranges 0.0.0.0/0
g compute firewall-rules describe "$VM-iap-ssh" >/dev/null 2>&1 || g compute firewall-rules create "$VM-iap-ssh" \
  --network default --allow tcp:22 --target-tags "$VM" --source-ranges 35.235.240.0/20

if g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  g compute instances add-metadata "$VM" --zone "$ZONE" --metadata "itulah-image=$IMAGE" \
    --metadata-from-file startup-script="$here/startup-demo.sh"
  g compute instances reset "$VM" --zone "$ZONE"
else
  g compute instances create "$VM" --zone "$ZONE" --machine-type e2-micro \
    --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 20GB --boot-disk-type pd-standard \
    --network default --tags "$VM" --service-account "$sa" --scopes cloud-platform \
    --metadata "itulah-image=$IMAGE" --metadata-from-file startup-script="$here/startup-demo.sh"
fi
ip="$(g compute instances describe "$VM" --zone "$ZONE" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
echo "https://${ip//./-}.sslip.io"
