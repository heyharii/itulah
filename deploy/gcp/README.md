# Cloud Build deploy

Production builds run in Cloud Build in `asia-southeast2`. GitHub Actions only
checks out the pushed `main` revision and submits its source archive to Cloud
Build using Workload Identity Federation; no service-account key is stored in
GitHub. Cloud Build creates one image, pushes it with the unique Cloud Build ID,
resolves its Artifact Registry digest, and asks the Cloud VM to deploy that exact
digest. The VM pins the digest in a systemd drop-in and restores the last healthy
digest automatically if the health check fails.

The workflow watches backend source, the Dockerfile, and the runtime entrypoint.
Pull requests do not deploy. A successful merge to `main` creates one Cloud
Build. The image tag is unique per build and the Artifact Registry repository is
configured for immutable tags; the running systemd unit uses `@sha256:...`, not
the tag.

## Release gate

The workflow intentionally requires the GitHub repository variable
`GCP_CLOUD_DEPLOY_ENABLED=true`. Leave it unset/false until the source on `main`
has been reconciled with the release currently serving the Cloud VM. Otherwise a
future push could replace newer locally deployed code with the older `main`
revision. Once `main` contains the intended release and has been reviewed, set
that variable to `true` in the repository's Actions variables. Later qualifying
pushes to `main` deploy automatically.

## One-time Google Cloud setup

The project resources used by this workflow are:

* Workload Identity pool `github-deploy`, provider `itulah` (restricted to
  `heyharii/itulah` pushes to `main`).
* GitHub caller service account `itulah-github-deploy`, allowed to submit builds
  and act as the build service account.
* Cloud Build service account `itulah-cloudbuild-deploy`, granted Artifact
  Registry write, Cloud Logging write, Compute viewer, OS Login admin, IAP
  tunnel, and `Service Account User` on the Cloud VM identity.
* A source staging bucket `itulah-pilot-build-src-207703853289` in Jakarta, with
  GitHub caller access scoped to that bucket.
* OS Login enabled on the Cloud VM for CI SSH over IAP. Keep the existing
  operator's OS Login permission so manual recovery remains available.

The build uses the existing VM and Artifact Registry repository. It does not
create another VM or database. Runbooks and the GCP IAM setup should stay in
sync with `.github/workflows/deploy-cloud.yml` and `cloudbuild.yaml`.
