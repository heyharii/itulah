#!/usr/bin/env bash
#
# remote — run an e2e command on the GCP VM `itulah-e2e` (rig, Vite servers and
# Chromium live there, not on the Mac). Edit tests locally; this syncs
# e2e/agentic up, runs, and brings the results back.
#
#   e2e/agentic/remote.sh --config hub.config.ts --output .e2e/out/po hub/po
#   e2e/agentic/remote.sh --sh 'cd ~/itulah && scripts/rig.sh ps'    # any shell command
#
# Results land in e2e/agentic/<--output dir> locally, same as a local run.
set -euo pipefail

host="${E2E_VM:-itulah-e2e.asia-southeast2-a.project-21f41328-b088-4894-b3f}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--sh" ]]; then
  shift
  exec ssh -o ServerAliveInterval=30 "$host" "bash -lc $(printf '%q' "export PATH=\$HOME/bin:\$HOME/.cargo/bin:\$PATH; $*")"
fi

out=".e2e/out/remote"
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[$i]}" == "--output" ]] && out="${args[$((i + 1))]}"
done

rsync -az -e ssh --exclude node_modules/ --exclude .e2e/out/ --exclude .e2e/logs/ \
  "$here/" "$host:itulah/e2e/agentic/"

set +e
ssh -o ServerAliveInterval=30 "$host" "bash -lc $(printf '%q' "export PATH=\$HOME/bin:\$PATH E2E_TELEMETRY_DISABLED=1; cd ~/itulah/e2e/agentic && npx e2e run $(printf '%q ' "${args[@]}")")"
code=$?
set -e

mkdir -p "$here/$out"
rsync -az -e ssh "$host:itulah/e2e/agentic/$out/" "$here/$out/" || true
# keep the replay cache the VM recorded
rsync -az -e ssh "$host:itulah/e2e/agentic/.e2e/cache/" "$here/.e2e/cache/" 2>/dev/null || true
exit $code
