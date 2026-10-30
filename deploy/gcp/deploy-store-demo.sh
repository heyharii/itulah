#!/usr/bin/env bash
#
# Build the store app (frontend-store-new) and swap it into the demo VM's web
# root (/var/lib/itulah/www/store, served by Caddy at store.<ip>.sslip.io with
# /api going to the demo's store-01 node). No backend or container is touched:
# like deploy-hub-demo.sh and deploy-pos-demo.sh, each build is a release and
# the live folder is a symlink renamed over in one step, so there is never a
# moment with no store app, and the previous release is one
# `ln -sfn` + `mv -T` away.
#
#   deploy/gcp/deploy-store-demo.sh
#
# gcloud needs a Python newer than the system 3.9: set CLOUDSDK_PYTHON (see
# memory/feedback_deploy_gate) before running.
set -euo pipefail
PROJECT=${PROJECT:-project-21f41328-b088-4894-b3f}
ZONE=${ZONE:-asia-southeast2-a}
VM=${VM:-itulah-demo}
HOST=${HOST:-store.34-101-248-167.sslip.io}
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root/frontend-store-new"
echo "building the store app"
# Type check first (`tsc -b`), then the bundle: a deploy must not publish types
# that do not compile.
npm run build >/dev/null
test -f dist/index.html
tgz=$(mktemp -t store-dist).tgz
COPYFILE_DISABLE=1 tar czf "$tgz" -C dist .
gcloud --project "$PROJECT" compute scp "$tgz" "$VM:/tmp/store-dist.tgz" \
  --zone "$ZONE" --tunnel-through-iap >/dev/null 2>&1
rm -f "$tgz"
gcloud --project "$PROJECT" compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command '
set -e
R=/var/lib/itulah/www/.releases/store; W=/var/lib/itulah/www/store
id=$(date -u +%Y%m%d%H%M%S); N=$R/$id
sudo mkdir -p $N
sudo tar xzf /tmp/store-dist.tgz -C $N 2>/dev/null
sudo test -f $N/index.html
# A tab that was open during the deploy still asks for its own build'"'"'s chunks.
if sudo test -d $W/assets; then sudo cp -an $W/assets/. $N/assets/; fi
sudo find $N/assets -type f -mtime +30 -delete
# Once, the first time: the live app was a plain folder; it becomes a release.
if sudo test -d $W && ! sudo test -L $W; then sudo mv $W $R/legacy-$id && sudo ln -sfn .releases/store/legacy-$id $W; fi
sudo ln -sfn .releases/store/$id /var/lib/itulah/www/.store.next
sudo mv -T /var/lib/itulah/www/.store.next $W
sudo ls -1d $R/*/ | sort | head -n -5 | xargs -r sudo rm -rf
sudo rm -f /tmp/store-dist.tgz
echo "INSTALLED $id"' 2>&1 | grep -v "WARNING\|NumPy\|please see\|^$"

# Every asset the new index names must answer 200 from the public host.
cd dist
bad=0; n=0
for f in $(find assets -type f); do
  n=$((n + 1))
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://$HOST/$f")
  [ "$code" = 200 ] || { bad=$((bad + 1)); echo "$code $f"; }
done
echo "checked $n assets, bad=$bad"
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' index.html | head -1
[ "$bad" = 0 ]
