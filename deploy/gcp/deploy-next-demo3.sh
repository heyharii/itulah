#!/usr/bin/env bash
#
# Create an isolated backend demo VM for the Next.js PO + Receiving prototype.
# This intentionally does not call deploy-demo.sh: demo3 has its own service
# account, Secret Manager secret, Postgres disk, and public host.
#
#   deploy/gcp/deploy-next-demo3.sh
#
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
REGION="${REGION:-asia-southeast1}"
ZONE="${ZONE:-asia-southeast1-b}"
VM="${VM:-itulah-demo3}"
SA_NAME="${SA_NAME:-itulah-demo3}"
MACHINE="${MACHINE:-e2-standard-2}"
IMAGE="${IMAGE:-asia-southeast2-docker.pkg.dev/$PROJECT/itulah/itulah:demo-202610100453}"
SECRET="${SECRET:-itulah-demo3-env}"
g() { gcloud --project "$PROJECT" "$@"; }

if g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  echo "$VM already exists; refusing to reset or modify an existing demo3." >&2
  exit 1
fi
[[ "$(g billing projects describe "$PROJECT" --format='value(billingEnabled)')" == True ]] \
  || { echo "billing is not enabled for $PROJECT" >&2; exit 1; }

env_file="$here/cloud-demo3.env"
if [[ ! -f "$env_file" ]]; then
  umask 077
  cat > "$env_file" <<E2
SYNC_INGEST_KEY=$(openssl rand -hex 24)
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -hex 18)
PG_PASSWORD=$(openssl rand -hex 24)
INVENTORY_SSO_SIGNING_KEY_HEX=$(openssl rand -hex 32)
E2
fi

g services enable compute.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com >/dev/null
sa="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
g iam service-accounts describe "$sa" >/dev/null 2>&1 \
  || g iam service-accounts create "$SA_NAME" --display-name "Isolated Itulah Next prototype demo3"
for role in roles/artifactregistry.reader roles/secretmanager.secretAccessor roles/logging.logWriter; do
  bound=0
  for attempt in $(seq 1 12); do
    if g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$sa" \
      --role "$role" --condition=None --quiet >/dev/null 2>&1; then
      bound=1
      break
    fi
    sleep 5
  done
  [[ "$bound" == 1 ]] || { echo "could not grant $role to $sa after waiting for service-account propagation" >&2; exit 1; }
done
if g secrets describe "$SECRET" >/dev/null 2>&1; then
  echo "Keeping existing isolated secret $SECRET."
else
  g secrets create "$SECRET" --data-file="$env_file" --replication-policy=automatic >/dev/null
fi

g compute firewall-rules describe "$VM-web" >/dev/null 2>&1 \
  || g compute firewall-rules create "$VM-web" --network default \
       --allow tcp:80,tcp:443 --target-tags "$VM" --source-ranges 0.0.0.0/0 >/dev/null
g compute firewall-rules describe "$VM-iap-ssh" >/dev/null 2>&1 \
  || g compute firewall-rules create "$VM-iap-ssh" --network default \
       --allow tcp:22 --target-tags "$VM" --source-ranges 35.235.240.0/20 >/dev/null

g compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 40GB --boot-disk-type pd-balanced \
  --network default --tags "$VM" --service-account "$sa" --scopes cloud-platform \
  --metadata "itulah-image=$IMAGE,itulah-dc-hosting=cloud,itulah-env-secret=$SECRET,itulah-next-prototype=true" \
  --metadata-from-file startup-script="$here/startup-demo.sh"
ip="$(g compute instances describe "$VM" --zone "$ZONE" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
echo "VM: $VM ($MACHINE), isolated Postgres disk and $SECRET"
echo "URL: https://hub.${ip//./-}.sslip.io/next-prototype/procurement/orders"
echo "Credentials are stored locally in $env_file (ignored by git)."
