# Cloud API deployment

The pilot release source is `codex/pos-r3-windows`. Pushes to that branch that
change the backend, Dockerfile, runtime entrypoint, or deployment configuration
build on Cloud Build and deploy the resulting immutable Artifact Registry
digest to the existing Cloud VM. GitHub authenticates with Workload Identity
Federation; no long-lived Google service-account key is stored in GitHub.

The build uses the existing VM, Cloud SQL instance, Cloud SQL Auth Proxy, and
Artifact Registry. The VM pins the image by SHA-256 digest in the
`itulah-cloud.service` systemd drop-in. The deployment checks the API health
endpoint and restores the previous healthy digest if startup or health checks
fail. Cloud SQL data is not changed by the image rollout.

Pushes to `main` use the same workflow but remain gated by the repository
variable `GCP_CLOUD_DEPLOY_ENABLED=true` until `main` is reconciled with the
pilot release. Keep the active pilot branch current; moving the release source
to `main` requires reviewing the code state first.

The source archive is staged under
`gs://itulah-pilot-build-src-207703853289/source`. Cloud Build runs in
`asia-southeast2`; deployments reach `itulah-pilot-cloud` over IAP and OS
Login. The build service account has only the Artifact Registry, logging,
Compute/IAP, OS Login, and target VM service-account permissions it needs.
