#!/usr/bin/env bash
#
# Deploy again and again while a prober watches, and count what a visitor
# would have seen (owner, 10 Oct 2026: "test berkali kali"). For the test VM,
# never the demo:
#
#     VM=itulah-demo2 HOST=34-50-109-0.sslip.io ROUNDS=10 deploy/gcp/rollout-soak.sh
#
# Each round alternates two tags of one image (rt-a, rt-b), so every round is
# a real swap of the cloud and the store. Results: deploy/gcp/soak-<time>.log
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
VM="${VM:?test VM}"; HOST="${HOST:?its sslip host}"
[ "$VM" = itulah-demo ] && { echo "not on the demo" >&2; exit 1; }
ROUNDS="${ROUNDS:-5}"
R="asia-southeast2-docker.pkg.dev/$PROJECT/itulah/itulah"
TAGS=(${TAGS:-rt-a rt-b})
log="${LOG:-/tmp/itulah-soak-$(date +%H%M%S).log}"
pass=0; fail=0
for i in $(seq 1 "$ROUNDS"); do
  tag="${TAGS[$(( (i - 1) % ${#TAGS[@]} ))]}"
  stopf=$(mktemp -u); out=$(mktemp)
  python3 "$here/probe.py" "$HOST" --seconds 1800 --workers "${WORKERS:-3}" --until-file "$stopf" >"$out" 2>&1 &
  pp=$!
  sleep 5
  t0=$SECONDS
  IMAGE="$R:$tag" VM="$VM" HOST="$HOST" "$here/rollout-demo.sh" >"$out.deploy" 2>&1
  dcode=$?
  took=$((SECONDS - t0))
  sleep "${AFTER:-30}"
  touch "$stopf"; wait $pp; pcode=$?
  summary=$(tail -1 "$out")
  fails=$(grep -c "FAIL" "$out")
  echo "round $i tag=$tag deploy_exit=$dcode took=${took}s probe_exit=$pcode failures=$fails :: $summary" | tee -a "$log"
  [ "$fails" -gt 0 ] && grep FAIL "$out" | head -20 | tee -a "$log"
  [ "$dcode" -ne 0 ] && tail -15 "$out.deploy" | tee -a "$log"
  if [ "$dcode" -eq "${EXPECT_DEPLOY_EXIT:-0}" ] && [ "$pcode" -eq 0 ]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi
  rm -f "$out" "$out.deploy"
done
echo "SOAK $VM: $pass passed, $fail failed of $ROUNDS  (log $log)" | tee -a "$log"
[ "$fail" -eq 0 ]
