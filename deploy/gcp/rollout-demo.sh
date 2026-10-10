#!/usr/bin/env bash
#
# Deploy a backend image to the demo VM WITHOUT taking it down (owner,
# 10 Oct 2026: "ga boleh osretail.site mati"). No VM reset, no Caddy or
# Postgres restart: the VM's own itulah-ctl (startup-demo.sh, copied over
# first) starts the new cloud beside the old one, moves Caddy to it once it is
# healthy, and stops the old one after it drains. A new cloud that never gets
# healthy is removed and the old one keeps serving — this script then fails
# and changes nothing else.
#
#     IMAGE=<image> deploy/gcp/rollout-demo.sh
#     IMAGE=<image> VM=itulah-deploytest HOST=<ip>.sslip.io deploy/gcp/rollout-demo.sh
#
# Only after the rollout succeeded is the VM's metadata (itulah-image and the
# startup script) updated, so a later reboot comes up on the same build.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
ZONE="${ZONE:-asia-southeast2-a}"
VM="${VM:-itulah-demo}"
IMAGE="${IMAGE:?set IMAGE to the Artifact Registry image}"
g() { gcloud --project "$PROJECT" "$@"; }
ssh_vm() { g compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command "$1" 2>&1 \
  | grep -v "NumPy\|increase the performance\|iap/docs\|^WARNING: *$\|^$" || true; }

# A script that does not parse never reaches the VM.
bash -n "$here/startup-demo.sh" || { echo "startup-demo.sh does not parse" >&2; exit 1; }
grep -qxF 'if [ "$mode" = rollout ]; then' "$here/startup-demo.sh" || { echo "startup-demo.sh has no rollout" >&2; exit 1; }
g compute scp "$here/startup-demo.sh" "$VM:/tmp/itulah-ctl" --zone "$ZONE" --tunnel-through-iap >/dev/null 2>&1
out="$(ssh_vm "sudo install -m 0755 -D /tmp/itulah-ctl /var/lib/itulah/bin/itulah-ctl && sudo /var/lib/itulah/bin/itulah-ctl rollout '$IMAGE'; echo EXIT=\$?")"
echo "$out" | tail -25
echo "$out" | grep -q "ROLLOUT OK:" || { echo "rollout did not complete: metadata left as it was" >&2; exit 1; }

g compute instances add-metadata "$VM" --zone "$ZONE" --metadata "itulah-image=$IMAGE" \
  --metadata-from-file startup-script="$here/startup-demo.sh" >/dev/null
echo "metadata updated (no reset): itulah-image=$IMAGE"

if [ -n "${HOST:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "https://$HOST/api/v1/health")
  echo "https://$HOST/api/v1/health -> $code"
  [ "$code" = 200 ]
fi
