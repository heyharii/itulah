#!/usr/bin/env bash
# Throwaway load-test VM: docker + a client for psql. Everything else is driven
# over ssh by deploy/gcp/loadtest-vm.sh. The VM deletes itself after its
# max-run-duration, so a forgotten one costs a day, not a month.
set -euo pipefail
if ! command -v docker >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io postgresql-client python3 curl ca-certificates
  systemctl enable --now docker
fi
touch /var/lib/loadtest-ready
