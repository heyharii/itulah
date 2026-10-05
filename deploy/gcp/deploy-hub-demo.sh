#!/usr/bin/env bash
#
# Build the hub and swap it into the demo VM's web root (/var/lib/itulah/www/hub,
# served by Caddy). No backend or container is touched; the swap is a directory
# rename, so a bad build is undone by deploying the previous commit again. The
# previous build's assets stay beside the new ones for 30 days, so a tab that
# was open while this ran does not lose the chunks it still has to load.
#
# The hub is built for the DEPLOYMENT, not for everybody: departments named in
# HIDE_DOMAINS are left out of the sidebar (their screens and routes stay, and
# ⌘K still finds them). The public demo hides HR and GA:
#
#   deploy/gcp/deploy-hub-demo.sh                    # hides hr,ga (the default)
#   HIDE_DOMAINS= deploy/gcp/deploy-hub-demo.sh      # hides nothing
#   HIDE_DOMAINS=hr,ga,finance deploy/gcp/deploy-hub-demo.sh
#
# Department ids are those in frontend-hub/src/lib/navigation.ts.
set -euo pipefail

PROJECT=${PROJECT:-project-21f41328-b088-4894-b3f}
ZONE=${ZONE:-asia-southeast2-a}
VM=${VM:-itulah-demo}
HOST=${HOST:-hub.34-128-98-21.sslip.io}
HIDE_DOMAINS=${HIDE_DOMAINS-hr,ga}

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root/frontend-hub"

echo "building (hiding: ${HIDE_DOMAINS:-nothing})"
rm -rf dist
VITE_HIDE_DOMAINS="$HIDE_DOMAINS" npx vite build >/dev/null

tgz=$(mktemp -t hub-dist).tgz
COPYFILE_DISABLE=1 tar czf "$tgz" -C dist .
gcloud --project "$PROJECT" compute scp "$tgz" "$VM:/tmp/hub-dist.tgz" \
  --zone "$ZONE" --tunnel-through-iap >/dev/null 2>&1
rm -f "$tgz"

gcloud --project "$PROJECT" compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command '
set -e
W=/var/lib/itulah/www/hub; N=/var/lib/itulah/www/hub.new
sudo rm -rf $N; sudo mkdir -p $N
sudo tar xzf /tmp/hub-dist.tgz -C $N 2>/dev/null
sudo test -f $N/index.html
# Keep the previous build'"'"'s chunks (never overwriting a new one): a tab that was open
# during the deploy still asks for its own build'"'"'s lazy chunks, and a 404 there is
# the "Something went wrong" screen. Chunks nobody has loaded for 30 days go.
if [ -d $W/assets ]; then sudo cp -an $W/assets/. $N/assets/; fi
sudo find $N/assets -type f -mtime +30 -delete
sudo rm -rf /var/lib/itulah/www/hub.old
sudo mv $W /var/lib/itulah/www/hub.old
sudo mv $N $W
sudo rm -rf /var/lib/itulah/www/hub.old /tmp/hub-dist.tgz
echo INSTALLED' 2>&1 | grep -v "WARNING\|NumPy\|please see\|^$"

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
