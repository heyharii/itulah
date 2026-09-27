#!/usr/bin/env bash
#
# demo-services — keep the presentation stack running on this Mac.
#
#   scripts/demo-services.sh install    # install + start (also after edits)
#   scripts/demo-services.sh status
#   scripts/demo-services.sh uninstall
#
# launchd agents, so every piece comes back after a crash, a logout, sleep or a
# reboot:
#   rig       scripts/rig.sh up demo — Cloud :8180, DC edge :8182, Store edge :8181
#             (on its existing data; waits for Postgres first)
#   hub       frontend-hub       :5350  → Cloud 8180, DC edge 8182
#             (its Operations screens are the DC floor; the separate floor
#             app on :5351 was retired 2026-09-26)
#   customer  frontend-customer  :5352  → Cloud 8180
#   store     frontend-store-new :5353  → Store edge 8181 (the shop's back office)
#
# Fixed ports rather than portless: a handheld, a phone or the till on the LAN
# cannot resolve `*.localhost`, but it can reach http://<this-mac-ip>:<port>.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agents="$HOME/Library/LaunchAgents"
logs="$root/runs/demo/services"
node_bin="${NODE_BIN:-$HOME/Library/Application Support/fnm/node-versions/v24.21.0/installation/bin}"
path="$node_bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
services=(rig hub customer store)
# Retired services: never started again, but an older install may have left
# their agents behind, so install and uninstall both unload them.
retired=(floor)   # frontend-floor, retired 2026-09-26 — the hub's Operations screens replace it

label() { echo "id.itulah.demo.$1"; }

command_for() {
    case "$1" in
        rig)      echo "until pg_isready -q; do sleep 2; done; exec '$root/scripts/rig.sh' up demo" ;;
        hub)      echo "cd '$root/frontend-hub' && VITE_API_TARGET=http://127.0.0.1:8180 VITE_EDGE_TARGET=http://127.0.0.1:8182 exec npm run dev -- --port 5350 --strictPort --host" ;;
        customer) echo "cd '$root/frontend-customer' && VITE_API_TARGET=http://127.0.0.1:8180 exec npm run dev -- --port 5352 --strictPort --host" ;;
        store)    echo "cd '$root/frontend-store-new' && VITE_API_TARGET=http://127.0.0.1:8181 exec npm run dev -- --port 5353 --strictPort --host" ;;
    esac
}

status() {
    ip=$(ipconfig getifaddr en0 2>/dev/null || echo "?")
    for s in "${services[@]}"; do
        state=$(launchctl print "gui/$(id -u)/$(label "$s")" 2>/dev/null | awk '/^\tstate =/{print $3}' || true)
        printf '  %-9s %s\n' "$s" "${state:-not loaded}"
    done
    printf '\n  Hub       http://localhost:5350\n  Customer  http://%s:5352\n  Store app http://%s:5353\n' "$ip" "$ip"
    printf '  DC edge   http://%s:8182   (handheld C5 at the DC)\n  Store     http://%s:8181   (till + R3, handheld C5 at the shop)\n' "$ip" "$ip"
}

case "${1:-install}" in
    status) status; exit 0 ;;
    uninstall)
        for s in "${services[@]}" "${retired[@]}"; do
            launchctl bootout "gui/$(id -u)/$(label "$s")" 2>/dev/null || true
            rm -f "$agents/$(label "$s").plist"
        done
        echo "removed"; exit 0 ;;
    install) ;;
    *) echo "usage: $0 install|status|uninstall" >&2; exit 1 ;;
esac

mkdir -p "$agents" "$logs"
for s in "${retired[@]}"; do
    launchctl bootout "gui/$(id -u)/$(label "$s")" 2>/dev/null || true
    rm -f "$agents/$(label "$s").plist"
done
for s in "${services[@]}"; do
    lbl=$(label "$s")
    # The rig forks its nodes and exits, so it runs once per login; the dev
    # servers are the process itself and are kept alive.
    keep="<true/>"; [[ $s == rig ]] && keep="<false/>"
    cmd=$(command_for "$s" | sed 's/&/\&amp;/g; s/</\&lt;/g')
    cat >"$agents/$lbl.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$lbl</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>$cmd</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$path</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>$keep
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$logs/$s.log</string>
  <key>StandardErrorPath</key><string>$logs/$s.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$lbl" 2>/dev/null || true
    # bootout returns before the job is gone; bootstrapping over it fails with EIO.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        launchctl print "gui/$(id -u)/$lbl" >/dev/null 2>&1 || break
        sleep 0.5
    done
    # The rig is already running when installing from a live session; loading
    # its agent would restart the nodes, so it is only registered for login.
    if [[ $s == rig ]] && curl -sf -m2 http://127.0.0.1:8180/api/v1/health >/dev/null; then
        plutil -replace RunAtLoad -bool true "$agents/$lbl.plist"
        launchctl enable "gui/$(id -u)/$lbl" 2>/dev/null || true
        continue
    fi
    launchctl bootstrap "gui/$(id -u)" "$agents/$lbl.plist"
done

sleep 6
status
