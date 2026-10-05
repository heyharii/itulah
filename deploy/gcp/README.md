# CLOUD node on Google Cloud, small

One `e2-micro` VM in Jakarta runs the API image. It sits on the same private
network (`itulah-pilot-vpc`) as the `itulah-pilot-db` Cloud SQL instance,
which is shrunk to `db-f1-micro`.

| Part | Roughly, per month |
|---|---|
| e2-micro VM + 10 GB disk | US$8 |
| Static external IP | US$4 |
| Cloud SQL db-f1-micro + 10 GB | US$10 |
| Cloud Build (8 cores, a few minutes per deploy) | cents |

## Why a VM and not Cloud Run

The node runs its periodic jobs (postings, HR, reminders, fleet sweep)
around the clock, so its CPU can never be idle. On Cloud Run that means an
always-allocated instance, which costs about US$45 a month on its own. A
micro VM does the same work for a fifth of that.

## Limits of small

- **Connections.** `db-f1-micro` allows 25 connections. The node's pool is
  20, which leaves 5 for migrations and a person with `psql`. The sandbox
  (`INVENTORY_TENANCY=sandbox`) needs 20 per open business, so it does not
  fit on this tier.
- **Memory.** The VM has 1 GB, which is plenty for the API and Caddy. It is
  not enough to build the image, so Cloud Build does that.

## Deploy

1. Link billing to the project. Nothing below works without it, and
   `deploy.sh` refuses to start before it is linked.
2. Copy `cloud.env.example` to `cloud.env` and fill it in. `SYNC_INGEST_KEY`
   is the fleet master the store nodes authenticate with — on a fresh fleet,
   pick a new 32+ character value and reuse it when provisioning stores.
3. Run `deploy/gcp/deploy.sh`.

`deploy.sh` does all of this:

- enables the APIs;
- shrinks and starts the database;
- makes the `itulah_cloud` database and its user, with the password kept in
  Secret Manager;
- builds the image;
- creates the VM with HTTPS at `<ip>.sslip.io`.

Running it again builds and rolls out a new image. The VM restarts, which
means about a minute of downtime.

Logs:
`gcloud compute ssh itulah-cloud --zone asia-southeast2-a --tunnel-through-iap --command 'docker logs cloud --tail 100'`

## Moving the client's data onto GCP

This step is not scripted yet, and it should be rehearsed before it is done
for real. The first boot on GCP runs every migration this build carries that
the source database has not applied yet, and it runs them on the client's real
data. That includes the unit/site refactor (0600+), which has so far only been
dry-run on a blank database.

Rehearsal:

1. Restore a dump of the source database into a scratch database on
   `itulah-pilot-db`.
2. Boot a node on it.
3. Compare row counts and the trial balance before and after.
