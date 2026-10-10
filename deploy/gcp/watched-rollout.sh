#!/usr/bin/env bash
#
# One deploy, watched: the prober runs from before it starts until 30 s after
# it ends, and a single failed request fails the step (owner, 10 Oct 2026:
# "tidak pernah down karna deploy").
#
#     IMAGE=<image> VM=<vm> HOST=<host> [HUB_HOST=<host>] deploy/gcp/watched-rollout.sh
#     PART=hub VM=<vm> HOST=<host> [HUB_HOST=<host>] deploy/gcp/watched-rollout.sh
#
# HOST answers /api/v1/health (the VM's sslip name, or osretail.site);
# HUB_HOST serves the hub page (default hub.HOST).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM="${VM:?}"; HOST="${HOST:?}"; HUB_HOST="${HUB_HOST:-hub.$HOST}"
PART="${PART:-backend}"
stopf="$(mktemp -u)"; plog="$(mktemp)"
python3 "$here/probe.py" "$HOST" --hub-host "$HUB_HOST" --seconds 3600 \
  --workers "${WORKERS:-3}" --until-file "$stopf" >"$plog" 2>&1 &
probe=$!
sleep 5
if [ "$PART" = hub ]; then
  VM="$VM" HOST="$HUB_HOST" "$here/deploy-hub-demo.sh"
else
  IMAGE="${IMAGE:?}" VM="$VM" HOST="$HOST" "$here/rollout-demo.sh"
fi
deploy=$?
sleep "${AFTER:-30}"
touch "$stopf"; wait $probe; watched=$?
grep FAIL "$plog" | head -30
tail -1 "$plog"
rm -f "$plog"
if [ $deploy -ne 0 ]; then echo "DEPLOY FAILED ($PART on $VM): nothing changed for visitors if the prober is clean" >&2; exit 1; fi
if [ $watched -ne 0 ]; then echo "VISITORS SAW FAILURES during the $PART deploy on $VM" >&2; exit 1; fi
echo "WATCHED OK: $PART on $VM, no failed request"
