#!/usr/bin/env bash
#
# Register the sandbox's store node (container `store-sandbox`, startup-demo.sh)
# with the sandbox business that owns it.
#
#     deploy/gcp/register-sandbox-store.sh              # business demo-copy
#     BUSINESS=other-slug deploy/gcp/register-sandbox-store.sh
#
# The node is its own origin, `store-sb`, for site store-01 of that business.
# The business is a copy of the demo database, whose store-01 already sent a
# generation-1 stream: reusing that origin would have the new node's first
# facts skipped as duplicates, and a fresh SQLite cannot start at generation 2.
# So store-01 is switched off here (the demo's store never syncs into the
# sandbox) and store-sb takes its place, with the same key. The row lives in the
# business's own database (biz_<slug>), not in the sandbox's control database.
set -euo pipefail
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
ZONE="${ZONE:-asia-southeast2-a}"
VM="${VM:-itulah-demo}"
BUSINESS="${BUSINESS:-demo-copy}"
db="biz_${BUSINESS//-/_}"

gcloud --project "$PROJECT" compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet --command "
sudo docker exec pg psql -U itulah -d $db -v ON_ERROR_STOP=1 -At </dev/null \
  -c \"UPDATE sync_origin_credential SET active_generation = 1, inventory_enabled = false WHERE origin_id = 'store-01'\" \
  -c \"INSERT INTO sync_origin_credential (origin_id, ingest_key_sha256, label, site_id, node_role, active_generation, inventory_enabled) SELECT 'store-sb', ingest_key_sha256, 'sandbox store node (store-01)', 'store-01', 'STORE', 1, true FROM sync_origin_credential WHERE origin_id = 'store-01' ON CONFLICT (origin_id) DO UPDATE SET site_id = 'store-01', node_role = 'STORE', active_generation = 1, inventory_enabled = true\" \
  -c \"SELECT origin_id, site_id, node_role, active_generation, inventory_enabled FROM sync_origin_credential ORDER BY 1\" \
  -c \"SELECT 'servers whose sign-in list changed: ' || count(*) FROM node_access_reconcile(NULL, 'register-sandbox-store')\"
"
