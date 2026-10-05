#!/usr/bin/env bash
#
# Register the demo VM's two edge nodes (dc, store-01) with the demo cloud again.
#
#     deploy/gcp/register-demo-origins.sh
#
# Needed after the demo database is recreated: the registration lives in
# `sync_origin_credential`, and without it the nodes get 403 on every sync
# handshake and the hub shows "This warehouse node is not registered with
# Central yet" on Ops › Receiving. It is the same row `System › Servers` writes,
# with the fleet key read on the VM (it never leaves the VM and is not printed),
# then derives who may sign in at each server from their job role (0635), which
# is the other half of what a recreated database loses.
#
# The DC registers under the id of the HEAD OFFICE site, whatever that site is
# called (`ho-gudang` on the demo), not under the node's own name: purchase
# orders take their destination from this column, and a name that is not a
# site makes every order fail with "not found: site dc".
set -euo pipefail
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
ZONE="${ZONE:-asia-southeast2-a}"
VM="${VM:-itulah-demo}"

remote=$(cat <<'EOF'
set -euo pipefail
envf=$(sudo find /var/lib /opt /srv /home -name cloud.env 2>/dev/null | head -1)
key=$(sudo grep '^SYNC_INGEST_KEY=' "$envf" | cut -d= -f2- | tr -d '\r\n')
hash=$(printf '%s' "$key" | sha256sum | cut -d' ' -f1)
sudo docker exec pg psql -U itulah -d itulah_cloud -v ON_ERROR_STOP=1 -At </dev/null \
  -c "INSERT INTO sync_origin_credential (origin_id, ingest_key_sha256, label, site_id, node_role, active_generation, inventory_enabled)
      VALUES ('dc', '$hash', 'demo DC', (SELECT id FROM site WHERE kind = 'HO'), 'DC', 1, true),
             ('store-01', '$hash', 'demo store-01', 'store-01', 'STORE', 1, true)
      ON CONFLICT (origin_id) DO UPDATE SET
        ingest_key_sha256 = EXCLUDED.ingest_key_sha256, site_id = EXCLUDED.site_id,
        node_role = EXCLUDED.node_role, inventory_enabled = true" \
  -c "SELECT origin_id, site_id, node_role, inventory_enabled FROM sync_origin_credential ORDER BY 1" \
  -c "SELECT 'servers whose sign-in list changed: ' || count(*) FROM node_access_reconcile(NULL, 'register-demo-origins')" \
  -c "SELECT u.username, e.origin_id, e.edge_role FROM edge_identity_assignment e JOIN app_user u ON u.id = e.user_id ORDER BY 1, 2"
sleep 12
echo "-- dc:";       sudo docker logs dc --tail 2 2>&1 | cut -c1-200
echo "-- store-01:"; sudo docker logs store --tail 2 2>&1 | cut -c1-200
EOF
)

gcloud --project "$PROJECT" compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet \
  --command "cat > /tmp/register-origins.sh && bash /tmp/register-origins.sh" <<<"$remote"
