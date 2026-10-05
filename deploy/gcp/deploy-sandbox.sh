#!/usr/bin/env bash
#
# The SANDBOX on Google Cloud: one VM where anybody with the link and the
# invite code makes a business of their own (a database each, behind the
# gateway in backend/src/cloud/tenancy). Separate from itulah-demo: nothing
# here touches the demo VMs.
#
#     IMAGE=<image> deploy/gcp/deploy-sandbox.sh
#
# The hub bundle is copied separately (it is not in the image):
#     deploy/gcp/deploy-sandbox.sh --hub <dir with index.html>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
ZONE="${ZONE:-asia-southeast2-a}"
VM="${VM:-itulah-sandbox}"; SA_NAME="${SA_NAME:-itulah-demo}"
MACHINE="${MACHINE:-e2-small}"
g() { gcloud --project "$PROJECT" "$@"; }

if [[ "${1:-}" == "--hub" ]]; then
  dir="${2:?give the hub bundle directory}"
  [[ -f "$dir/index.html" ]] || { echo "$dir has no index.html" >&2; exit 1; }
  tarball="$(mktemp -t hub.XXXXXX).tgz"
  COPYFILE_DISABLE=1 tar -C "$dir" --exclude '._*' -czf "$tarball" .
  g compute scp "$tarball" "$VM:/tmp/hub.tgz" --zone "$ZONE" --tunnel-through-iap
  g compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command \
    'sudo sh -c "rm -rf /var/lib/itulah/www/hub.new && mkdir -p /var/lib/itulah/www/hub.new && tar -xzf /tmp/hub.tgz -C /var/lib/itulah/www/hub.new && rm -rf /var/lib/itulah/www/hub && mv /var/lib/itulah/www/hub.new /var/lib/itulah/www/hub && rm -f /tmp/hub.tgz"'
  rm -f "$tarball"
  echo "hub bundle installed"
  exit 0
fi

IMAGE="${IMAGE:?set IMAGE to the Artifact Registry image}"
[[ "$(g billing projects describe "$PROJECT" --format='value(billingEnabled)')" == "True" ]] || { echo "billing not enabled" >&2; exit 1; }

env_file="$here/cloud-sandbox.env"
if [[ ! -f "$env_file" ]]; then
  umask 077
  cat > "$env_file" <<E2
PG_PASSWORD=$(openssl rand -hex 16)
INVENTORY_SSO_SIGNING_KEY_HEX=$(openssl rand -hex 32)
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -hex 12)
TENANCY_INVITE_CODE=${TENANCY_INVITE_CODE:-coba-$(openssl rand -hex 3)}
TENANCY_MAX_BUSINESSES=30
E2
fi
if g secrets describe itulah-sandbox-env >/dev/null 2>&1; then
  g secrets versions add itulah-sandbox-env --data-file="$env_file" >/dev/null
else
  g secrets create itulah-sandbox-env --data-file="$env_file" --replication-policy=automatic >/dev/null
fi

sa="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
g compute firewall-rules describe "$VM-web" >/dev/null 2>&1 || g compute firewall-rules create "$VM-web" \
  --network default --allow tcp:80,tcp:443 --target-tags "$VM" --source-ranges 0.0.0.0/0
g compute firewall-rules describe "$VM-iap-ssh" >/dev/null 2>&1 || g compute firewall-rules create "$VM-iap-ssh" \
  --network default --allow tcp:22 --target-tags "$VM" --source-ranges 35.235.240.0/20

if g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  g compute instances add-metadata "$VM" --zone "$ZONE" --metadata "itulah-image=$IMAGE" \
    --metadata-from-file startup-script="$here/startup-sandbox.sh"
  g compute instances reset "$VM" --zone "$ZONE"
else
  g compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 20GB --boot-disk-type pd-standard \
    --network default --tags "$VM" --service-account "$sa" --scopes cloud-platform \
    --metadata "itulah-image=$IMAGE" --metadata-from-file startup-script="$here/startup-sandbox.sh"
fi
ip="$(g compute instances describe "$VM" --zone "$ZONE" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
echo "https://hub.${ip//./-}.sslip.io"
