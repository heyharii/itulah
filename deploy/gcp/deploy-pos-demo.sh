#!/usr/bin/env bash
#
# Build the web till (pos-desktop/ui in web mode) and swap it into the demo
# VM's web root (/var/lib/itulah/www/pos, served by Caddy at pos.<ip>.sslip.io
# with /api going to the demo's store-01 node). No backend or container is
# touched: like deploy-hub-demo.sh, each build is a release and the live folder
# is a symlink renamed over in one step, so there is never a moment with no
# till, and the previous release is one `ln -sfn` + `mv -T` away.
#
#   deploy/gcp/deploy-pos-demo.sh
#
# gcloud needs a Python newer than the system 3.9: set CLOUDSDK_PYTHON (see
# memory/feedback_deploy_gate) before running.
set -euo pipefail
PROJECT=${PROJECT:-project-21f41328-b088-4894-b3f}
ZONE=${ZONE:-asia-southeast2-a}
VM=${VM:-itulah-demo}
HOST=${HOST:-pos.34-101-248-167.sslip.io}
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root/pos-desktop/ui"
echo "building the web till"
rm -rf dist-web
# The demo has no fingerprint scanner in a browser: a press on the sensor
# stands for a finger (owner, 23 Oct 2026), signing in as the demo's test
# people from scripts/seed-pos-door.sh. SIM_FINGERS= (empty) builds without.
# A Tunda locks the till after HOLD_MAX_MINUTES (30 in the Windows build); the
# demo is built at 6 so the lock can be tried without waiting half an hour.
VITE_SIM_FINGERS="${SIM_FINGERS-andi,rizky,dimas,bima}" VITE_SIM_HEAD="${SIM_HEAD:-bima}" \
VITE_SIM_PASSWORD="${SIM_PASSWORD:-Password01}" \
VITE_HOLD_MAX_MINUTES="${HOLD_MAX_MINUTES:-6}" \
npx vite build --mode web --outDir dist-web >/dev/null
test -f dist-web/index.html
tgz=$(mktemp -t pos-dist).tgz
COPYFILE_DISABLE=1 tar czf "$tgz" -C dist-web .
gcloud --project "$PROJECT" compute scp "$tgz" "$VM:/tmp/pos-dist.tgz" \
  --zone "$ZONE" --tunnel-through-iap >/dev/null 2>&1
rm -f "$tgz"
gcloud --project "$PROJECT" compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command '
set -e
R=/var/lib/itulah/www/.releases/pos; W=/var/lib/itulah/www/pos
id=$(date -u +%Y%m%d%H%M%S); N=$R/$id
sudo mkdir -p $N
sudo tar xzf /tmp/pos-dist.tgz -C $N 2>/dev/null
sudo test -f $N/index.html
# A till that was open during the deploy still asks for its own build'"'"'s chunks.
if sudo test -d $W/assets; then sudo cp -an $W/assets/. $N/assets/; fi
sudo find $N/assets -type f -mtime +30 -delete
# Once, the first time: the live till was a plain folder; it becomes a release.
if sudo test -d $W && ! sudo test -L $W; then sudo mv $W $R/legacy-$id && sudo ln -sfn .releases/pos/legacy-$id $W; fi
sudo ln -sfn .releases/pos/$id /var/lib/itulah/www/.pos.next
sudo mv -T /var/lib/itulah/www/.pos.next $W
sudo ls -1d $R/*/ | sort | head -n -5 | xargs -r sudo rm -rf
sudo rm -f /tmp/pos-dist.tgz
echo "INSTALLED $id"' 2>&1 | grep -v "WARNING\|NumPy\|please see\|^$"

# Every asset the new index names must answer 200 from the public host.
cd dist-web
bad=0; n=0
for f in $(find assets -type f); do
  n=$((n + 1))
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://$HOST/$f")
  [ "$code" = 200 ] || { bad=$((bad + 1)); echo "$code $f"; }
done
echo "checked $n assets, bad=$bad"
[ "$bad" = 0 ]
