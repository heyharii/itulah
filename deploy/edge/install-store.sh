#!/usr/bin/env bash
#
# Install (or upgrade) the itulah store server on a Linux machine.
#
#   sudo ./install-store.sh                              install, enrol later
#   sudo ./install-store.sh --code 7K4P9-QX2MA --cloud https://cloud.example
#                                                        install and enrol by itself
#   sudo ./install-store.sh --appliance ...              also harden a dedicated box
#   sudo ./install-store.sh --ups ...                    also watch a USB UPS (NUT)
#   sudo ./install-store.sh --uninstall                  remove the service; keep the data
#
# Run from the unpacked release directory: it expects `store`, `web/` and
# `store-edge.service` beside it.
#
# With --code the node claims the code on its first start and waits for head
# office to approve. The six-digit verification number to read out is printed
# here and is always in `journalctl -u store-edge`.
#
# --appliance is for a machine that is nothing but the shop's server:
#   - the hardware watchdog reboots the box if the OS itself freezes;
#   - security updates install themselves and reboot at 03:00 if they must;
#   - the journal is capped so logs can never fill the disk;
#   - the clock is kept by NTP (tills are refused when it drifts).
# It does NOT touch the BIOS: set "Restore on AC power loss" to "Power On"
# there, or the box stays off after a power cut until somebody presses the
# button.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/itulah/store
DATA=/var/lib/itulah/store
UNIT=store-edge
CODE=""
CLOUD=""
APPLIANCE=0
UPS=0
UNINSTALL=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --code) CODE="${2:?--code needs a value}"; shift 2 ;;
        --cloud) CLOUD="${2:?--cloud needs a value}"; shift 2 ;;
        --appliance) APPLIANCE=1; shift ;;
        --ups) UPS=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 64 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    echo "run as root (sudo)" >&2
    exit 77
fi

if [[ $UNINSTALL -eq 1 ]]; then
    systemctl disable --now "$UNIT" 2>/dev/null || true
    rm -f "/etc/systemd/system/$UNIT.service"
    rm -rf "/etc/systemd/system/$UNIT.service.d"
    rm -f /usr/local/bin/store
    rm -rf "$PREFIX"
    systemctl daemon-reload
    echo "Removed. The shop's data is still in $DATA — it may hold sales not yet sent."
    exit 0
fi

for needed in store store-edge.service; do
    [[ -e "$HERE/$needed" ]] || { echo "missing $needed beside this script" >&2; exit 66; }
done

echo "==> account and directories"
id itulah >/dev/null 2>&1 || useradd --system --home-dir /var/lib/itulah --shell /usr/sbin/nologin itulah
install -d -o itulah -g itulah -m 0700 /var/lib/itulah "$DATA"
install -d -m 0755 "$PREFIX"

echo "==> program"
# Stop first on an upgrade, so the binary is never replaced under a running
# process that still has the old one mapped and the new one on disk.
if systemctl is-active --quiet "$UNIT"; then
    systemctl stop "$UNIT"
fi
install -m 0755 "$HERE/store" "$PREFIX/store"
if [[ -d "$HERE/web" ]]; then
    rm -rf "$PREFIX/web"
    cp -R "$HERE/web" "$PREFIX/web"
fi
ln -sf "$PREFIX/store" /usr/local/bin/store

echo "==> service"
install -m 0644 "$HERE/store-edge.service" "/etc/systemd/system/$UNIT.service"
if [[ -n "$CLOUD" ]]; then
    install -d -m 0755 "/etc/systemd/system/$UNIT.service.d"
    printf '[Service]\nEnvironment=ITULAH_CLOUD_URL=%s\n' "$CLOUD" \
        > "/etc/systemd/system/$UNIT.service.d/cloud.conf"
fi

if [[ -n "$CODE" ]]; then
    echo "==> enrolment code staged; the node claims it when it starts"
    runuser -u itulah -- env ITULAH_DATA_DIR="$DATA" "$PREFIX/store" stage-code "$CODE" ${CLOUD:+"$CLOUD"}
fi

if [[ $APPLIANCE -eq 1 ]]; then
    echo "==> appliance: hardware watchdog, capped journal, NTP, security updates"
    install -d -m 0755 /etc/systemd/system.conf.d /etc/systemd/journald.conf.d
    cat > /etc/systemd/system.conf.d/itulah-watchdog.conf <<'EOF'
# If the OS stops scheduling for 30 s the board reboots the machine; a reboot
# that itself hangs is cut off after 10 minutes.
[Manager]
RuntimeWatchdogSec=30s
RebootWatchdogSec=10min
EOF
    cat > /etc/systemd/journald.conf.d/itulah.conf <<'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
EOF
    systemctl restart systemd-journald
    timedatectl set-ntp true || true
    if command -v apt-get >/dev/null; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades >/dev/null
        cat > /etc/apt/apt.conf.d/52itulah-unattended <<'EOF'
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-security"; };
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
    else
        echo "    (not a Debian/Ubuntu system: configure automatic security updates by hand)"
    fi
    systemctl daemon-reexec
    echo "    Remember the BIOS: Restore on AC power loss = Power On."
fi

if [[ $UPS -eq 1 ]]; then
    echo "==> UPS: NUT watching a USB UPS, clean shutdown on low battery"
    # The node only READS the UPS (edge/power.rs, via `upsc`). Shutting the
    # machine down when the battery runs low is NUT's job: upsmon stops every
    # service first — the store server among them, which is a clean stop for it
    # — and powers off. The BIOS brings it back when the mains returns.
    if ! command -v apt-get >/dev/null; then
        echo "    (not a Debian/Ubuntu system: install and configure NUT by hand)"
    else
        DEBIAN_FRONTEND=noninteractive apt-get install -y nut >/dev/null
        found="$(nut-scanner -U -q 2>/dev/null | sed 's/^\[nutdev[0-9]*\]/[shop]/')"
        if [[ -z "$found" ]]; then
            echo "    No USB UPS found. Plug it in and run this again with --ups."
        else
            printf '%s\n' "$found" > /etc/nut/ups.conf
            echo "MODE=standalone" > /etc/nut/nut.conf
            monitor_password="$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]')"
            cat > /etc/nut/upsd.users <<EOF2
[upsmon]
    password = ${monitor_password}
    upsmon primary
EOF2
            cat > /etc/nut/upsmon.conf <<EOF2
MONITOR shop@localhost 1 upsmon ${monitor_password} primary
MINSUPPLIES 1
SHUTDOWNCMD "/sbin/shutdown -h +0"
POWERDOWNFLAG /etc/killpower
FINALDELAY 5
EOF2
            chmod 640 /etc/nut/upsd.users /etc/nut/upsmon.conf
            chgrp nut /etc/nut/upsd.users /etc/nut/upsmon.conf 2>/dev/null || true
            systemctl enable --now nut-driver-enumerator.path nut-server nut-monitor >/dev/null 2>&1 || true
            systemctl restart nut-server nut-monitor >/dev/null 2>&1 || true
            sleep 2
            upsc shop@localhost ups.status 2>/dev/null \
                && echo "    UPS found and watched. Status above: OL = on mains, OB = on battery." \
                || echo "    NUT installed, but the UPS did not answer yet; check 'upsc shop@localhost'."
        fi
    fi
fi

systemctl daemon-reload
systemctl enable --now "$UNIT"

echo
if [[ -n "$CODE" ]]; then
    echo "Waiting for the claim (up to 30 s)…"
    for _ in $(seq 1 30); do
        line="$(journalctl -u "$UNIT" --since "-2min" -o cat 2>/dev/null | grep -m1 'claimed the code' || true)"
        if [[ -n "$line" ]]; then
            echo "$line"
            echo "Read the verification number above to head office and ask them to approve."
            break
        fi
        sleep 1
    done
elif [[ -f "$DATA/node.env" ]]; then
    # An upgrade or a reinstall: the node keeps its identity and its data.
    site="$(grep -m1 '^INVENTORY_SITE_ID=' "$DATA/node.env" | cut -d= -f2)"
    echo "Upgraded. This machine is still enrolled as ${site:-its site}; its data was kept."
else
    echo "Installed. To enrol this machine run:"
    echo "  sudo -u itulah ITULAH_DATA_DIR=$DATA store enroll --code XXXXX-XXXXX --cloud https://…"
    echo "or open http://localhost:8082/setup in a browser on this machine."
fi
echo "Check it any time with:  sudo -u itulah ITULAH_DATA_DIR=$DATA store diagnose"
