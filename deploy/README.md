# Deploying the fleet: one cloud, one DC, thirty shops

The shops never appear on the public internet, and neither does the cloud.
Everything travels inside a private WireGuard network the fleet owns, with a
self-hosted control server (headscale) as the address book.

```
shop-01 …… shop-30  ─┐
                     ├── WireGuard ──►  cloud:8080   (the ingest API)
distribution centre ─┘

               control server: https://hs.itulah.co.id
               (the only public address in the fleet)
```

## Why this shape

**Only one machine is publicly reachable, and it is the least sensitive one.**
The control server knows which boxes exist and who may talk to whom. It never
sees a sale, a price, or a stock level. If it is taken down, the thirty shops
keep trading *and keep syncing* — established tunnels do not depend on it.
Without this, the machine that would have to face the internet is the cloud
database itself.

**Shops need no inbound reachability at all.** Our sync is one-way by design:
commands from head office ride the reply to a shop's own upload, so the cloud
never has to dial a shop. No port forwarding, no static IP, no problem behind
CGNAT — which is most Indonesian shop connections.

**No certificates on thirty shop boxes.** WireGuard already encrypts and
authenticates every packet, so shops speak plain HTTP inside the tunnel. Only
the control server has a certificate, and it gets its own automatically.

## Cost model

This authentication/sync design has no mandatory per-user or per-reader SaaS
subscription. Its infrastructure dependencies are self-hostable:
[PostgreSQL](https://www.postgresql.org/about/licence/) is free/open source,
[SQLite](https://www.sqlite.org/copyright.html) is public domain,
[headscale](https://github.com/juanfont/headscale/blob/main/LICENSE) uses the
BSD 3-Clause license, and [WireGuard](https://www.wireguard.com/) components
use free/open-source licenses. “No subscription” does not mean zero operating
cost: budget for the Cloud/control-server hosts, domain/TLS, monitoring,
encrypted backups, network links, Edge hardware, RFID readers/tags, spares,
and operator time. Optional commercial SSO, SMS OTP, or managed monitoring can
add subscription or usage fees later; none is required by the current design.

## Two credentials per shop, and why both

This is the part worth reading twice.

| Credential | Proves | Issued by |
|---|---|---|
| tailnet pre-auth key | **which machine** is calling | headscale, single-use, 1h, carries `tag:store` |
| sync ingest key | **which shop** that machine may speak for | the cloud, stored only as a SHA-256 digest |
| opaque human session | **which operator and role** is acting | Cloud or local Edge auth store |
| RFID signing key | **which enrolled reader and Pool scope** captured evidence | Cloud; raw key shown once |

The tailnet alone is not enough. Headscale authenticates a *machine*; it knows
nothing about the `origin_id` a payload claims. Without the second key, a
compromised shop box could upload facts as another shop and still be perfectly
"inside the VPN". The tailnet is transport; the ingest key is authorisation.

Both were demonstrated together: from a shop node, an upload claiming a
different origin is refused with 403 even over a valid tunnel.

## What a shop can and cannot do

Cannot, and this is enforced elsewhere than on the shop box, so root on the
till does not help:

* reach another shop, or any cloud service other than ingest — the *receiving*
  node drops it, per the policy in `headscale/acl.json`
* change that policy, or re-tag itself as the cloud — tags come from the
  control server; there is no client-side command to change them
* enrol a new box unnoticed — pre-auth keys are single-use and admin-issued
* upload as another shop — the per-origin key, above

Can, and pretending otherwise would be dishonest:

* read its own keys, if someone has root on the box in the shop
* stop its own connection — which is only its own outage, and shows up
  immediately as `sync_ingest_last_received_age_seconds` on the dashboard

So the answer to a stolen or compromised box is **revocation**, not
prevention: delete the node in headscale and re-register the origin with a new
key. Consider full-disk encryption if a box may be physically taken.

`edge/nftables-store.conf` goes further and stops the shop box reaching the
internet at all beyond the five things it genuinely needs. The tailnet does
*not* do this on its own — its policy governs traffic between fleet nodes, not
the box's ordinary internet access.

## Install

### 1. Control server

```bash
install -m755 headscale /usr/local/bin/headscale
useradd --system --home /var/lib/headscale headscale
install -d -o headscale /var/lib/headscale /etc/headscale
install -m644 deploy/headscale/config.yaml /etc/headscale/config.yaml   # edit the hostname
install -m644 deploy/headscale/acl.json    /etc/headscale/acl.json
install -m644 deploy/headscale/headscale.service /etc/systemd/system/
systemctl enable --now headscale
headscale users create fleet-admin
```

Open **TCP 443** and **UDP 3478** to the internet. Nothing else — the admin
API stays on localhost, and once the tailnet is up you administer this box
over the tailnet like any other node.

### 2. Cloud node on Render

Render is suitable for the central Cloud API and its PostgreSQL database. The
checked-in [`render.yaml`](../render.yaml) creates one `itulah-cloud` Docker
web service and one Render Postgres database in Singapore. It uses the same
image as the edge runtimes, with `APP_BIN=cloud`, and the app listens on the
Render-provided `PORT`.

1. Push this repository to a Git provider that is connected to the target
   Render workspace.
2. Create a Blueprint from the repository and select `render.yaml`.
3. When Render prompts for the `sync: false` variable, set a unique
   `INVENTORY_BOOTSTRAP_ADMIN_PASSWORD` (at least 8 characters).
4. After the first deploy, verify:

   ```bash
   curl -fsS https://YOUR-CLOUD.onrender.com/api/v1/health
   ```

The Blueprint generates `SYNC_INGEST_KEY` and wires `DATABASE_URL` to Render
Postgres. The generated key is the Cloud master used only for provisioning;
each DC/Store origin gets its own key from the provisioning endpoint.

Free Render Postgres is appropriate only for a short-lived trial because it
expires after 30 days and has no backups. The Blueprint uses the smallest paid
Postgres plan and a 5 GB disk; adjust those values before applying if the
expected fleet size requires more capacity.

### 3. Cloud node on a private host (alternative)

Join it to the tailnet with a `tag:cloud` key, then run the `cloud` binary
with `SYNC_INGEST_KEY` set to the fleet master key. That master key registers
shops and issues commands; it is never given to a shop. The `cloud` startup
runs PostgreSQL migrations automatically, so older deployment jobs that called
the removed `migrate` binary must switch to this startup path. Existing units
that called `inventory-edge` must likewise be changed to `cloud`, `dc`, or
`store` in the same coordinated rollout; the checked-in Store unit already
runs `/usr/local/bin/store`.

### 4. DC and Store Edge nodes

The edge binaries run on the DC and shop machines so they keep operating when
the WAN or Cloud is unavailable. They are not public Render web services: a
Render web service would expose the local SQLite/RFID boundary and would not
provide access to the physical reader or till. Build the shared image with
`APP_BIN=dc` or `APP_BIN=store` on a private host, or install the release
binaries and the systemd units below.

For a DC, copy `deploy/edge/dc.env.example` to `/etc/itulah/dc.env` and enable
`deploy/edge/dc-edge.service`. For a Store, use the existing
`deploy/edge/store.env.example` and `deploy/edge/store-edge.service`. In both
cases set the Cloud base URL, a unique 32+ character per-origin
`SYNC_UPLOAD_KEY`, and a node-unique bootstrap password. The corresponding
origin must be provisioned in Cloud before the sender can be useful.

```bash
install -m755 target/release/cloud /usr/local/bin/cloud
install -m755 target/release/dc /usr/local/bin/dc
install -m755 target/release/store /usr/local/bin/store
install -m644 deploy/edge/dc-edge.service /etc/systemd/system/dc-edge.service
install -m644 deploy/edge/store-edge.service /etc/systemd/system/store-edge.service
systemctl daemon-reload
systemctl enable --now dc-edge.service   # DC host only
systemctl enable --now store-edge.service # Store host only
```

Each host must have its own SQLite path and `INVENTORY_NODE_ID`; never share
one database file between DC and Store nodes.

### 5. Each shop

```bash
# Authenticated Cloud (obtain an opaque ADMIN bearer from /api/v1/auth/login):
SYNC_MASTER_KEY=... CLOUD_ADMIN_TOKEN=... \
  deploy/scripts/provision-store.sh store-07 "Toko Cabang 07"
```

`INVENTORY_AUTH_MODE=required` is the default. `CLOUD_ADMIN_TOKEN` must carry
role `ADMIN`; `SYNC_MASTER_KEY` is independently required. The session proves
the operator while the master key proves possession of the fleet provisioning
secret. Development-only `INVENTORY_AUTH_MODE=disabled` must never be used on
a connected deployment.

The script binds `origin_id`, `site_id`, role `STORE`, active generation 1,
and `inventory_enabled=true` atomically with the per-origin key. It refuses to
run twice for the same shop, prints the shop's `.env` and the one-time tailnet
key, and tells you what to run on the box. `SYNC_UPLOAD_URL` in that file is the
Cloud **base URL**; the Store transport appends `/api/v1/sync/ingest` itself.
After the first successful local login, rotate the `LOCAL` break-glass password
through `POST /api/v1/auth/change-password`, store the replacement in the
fleet password manager, remove `INVENTORY_BOOTSTRAP_ADMIN_PASSWORD` from the
Edge environment file, and restart once. The account remains in SQLite; the
plaintext bootstrap copy does not need to remain on disk.

## Operating it

```bash
curl -s $CLOUD/api/v1/sync/fleet          # who is up to date, behind, or stuck
curl -s $CLOUD/metrics                    # per-shop lag, silence, blocked streams
headscale nodes list                      # who is on the tailnet, with tags
```

Inventory movement facts are the owner-scoped current-state authority. Inspect the
fact-derived projection with `GET /api/v1/inventory/fleet-pools`: Cloud-native
`CLOUD_LEDGER` rows and read-only `EDGE_FACT_POSITION` rows remain separate.
Pool snapshots are independent reconciliation checkpoints only; checkpoint age
can prevent fleet-total certification but never supplies current quantities or
returns ownership to Cloud. Exact DC In-Transit and Store receipt claims are
matched by source DC, destination Store, shipment reference, and EPC to remove
the capped physical overlap and attribute receipt progress to immutable package
units. `sync_status` describes fact-application freshness;
`checkpoint_status` and capture-clock age describe the latest checkpoint.

For a sequence-generation rollover, update the origin's
`active_generation` in Cloud **before** restarting the Edge on that generation,
and only after the previous Edge generation has no unacknowledged facts. A
future-generation upload receives retryable HTTP 409 without watermark
progress, so it remains queued; old generations cannot overwrite the active
snapshot.

Alerts worth having, in order of how much they hurt:

* `sync_apply_blocked{origin=...} == 1` — a shop's facts stopped reaching the
  ledger. It retries by itself, so this is a page only if it persists.
* `sync_ingest_last_received_age_seconds > 900` — a shop has gone quiet.
  Usually the shop's internet, not the shop's software.
* `sync_backlog_oldest_seconds` climbing on the cloud — the cloud is behind,
  not the shops.

**Back up `/var/lib/headscale/db.sqlite`.** It is the fleet's identity; losing
it means re-enrolling thirty shops by hand. It is small — a nightly copy is
enough.

**Decide node key expiry deliberately.** An unattended till must not expire
mid-trading-day. Set tagged nodes not to expire and rely on revocation, rather
than discovering the default during Lebaran.

## What is deliberately not here

* **No reverse proxy.** Headscale requests its own certificate; adding Caddy
  or nginx would be a moving part that earns nothing.
* **No public DERP.** The relay runs on the control server, so shop traffic
  never touches infrastructure the fleet does not own. (Tailscale's public
  relays would also be safe — they only carry sealed packets — but this keeps
  the dependency list at zero.)
* **No inbound rule to shops.** Nothing in the fleet ever dials a shop.
* **No dependency on Cloud for each login.** Edge opaque sessions, Argon2id
  verifiers, RBAC, CSRF, login throttling, and RFID HMAC verification are
  local. Cloud sends signed, versioned identity/device leases through the
  existing outbound sync response. Revocation takes effect on the next
  successful cycle; finite offline leases bound disconnected exposure.
