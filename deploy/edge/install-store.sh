#!/usr/bin/env bash
#
# Install (or upgrade) the itulah store server on a Linux machine.
#
#   sudo ./install-store.sh                              install, enrol later
#   sudo ./install-store.sh --code 7K4P9-QX2MA           install and enrol by itself
#                                                        (the install code from Central >
#                                                        Stores > your store > Server)
#   sudo ./install-store.sh --code 7K4P9-QX2MA --appliance --lock
#                                                        the dedicated mini PC, as prepared
#                                                        at head office: connect, then lock
#   sudo ./install-store.sh --cloud https://...          a cloud other than the one baked
#                                                        into this build (developers)
#   sudo ./install-store.sh --appliance ...              also harden a dedicated box
#   sudo ./install-store.sh --lock ...                   also lock it down (implies --appliance)
#   sudo ./install-store.sh --lock --force ...           lock even though it has not connected
#   sudo ./install-store.sh --unlock                     undo --lock (console, ssh, firewall)
#   sudo ./install-store.sh --ups ...                    also watch a USB UPS (NUT)
#   sudo ./install-store.sh --uninstall                  remove the service; keep the data
#
# Run from the unpacked release directory: it expects `store`, `web/` and
# `store-edge.service` beside it (with --lock also `central-status.sh` and
# `nftables-store-lan.conf`).
#
# With --code the node claims the code on its first start. The cloud's address
# is baked into the build; --cloud is only for a build that has none.
#
# --appliance is for a machine that is nothing but the shop's server:
#   - the hardware watchdog reboots the box if the OS itself freezes;
#   - security updates install themselves and reboot at 03:00 if they must;
#   - the journal is capped so logs can never fill the disk;
#   - the clock is kept by NTP (tills are refused when it drifts).
# It does NOT touch the BIOS: set "Restore on AC power loss" to "Power On"
# there, or the box stays off after a power cut until somebody presses the
# button.
#
# --lock is for the dedicated mini PC that leaves head office ready to plug in.
# On top of --appliance it:
#   - installs a firewall (nftables-store-lan.conf): in only from the shop's
#     network on TCP 8082 / UDP 5353 (and SSH only via the tailscale interface),
#     out only DNS, NTP and HTTPS (plus plain HTTP for apt, for security updates);
#   - removes the console login (getty masked, root password locked) and puts a
#     status screen on tty1 instead (central-status.service): shop name,
#     Ready/Offline, data up to, the store app's address and a QR code;
#   - makes sshd key-only with no root login, and turns SSH OFF; head office
#     turns it on over Tailscale when support is needed;
#   - REFUSES to do any of this until the node has enrolled (node.env exists
#     and names a site), so a box that never connected is not locked away
#     from everybody. --force overrides, knowing that.
# It does NOT encrypt the disk and does NOT touch the BIOS: set a firmware
# password, disable USB/network boot and set "Restore on AC power loss" to
# "Power On"; if the data must survive theft, enrol the disk to the TPM
# (LUKS + systemd-cryptenroll) before the box ships.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/itulah/store
DATA=/var/lib/itulah/store
UNIT=store-edge
CODE=""
CLOUD=""
APPLIANCE=0
LOCK=0
UNLOCK=0
FORCE=0
UPS=0
UNINSTALL=0
# How long --lock waits for a box that has just been given its code to finish
# connecting, in seconds.
LOCK_WAIT="${CENTRAL_LOCK_WAIT:-180}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --code) CODE="${2:?--code needs a value}"; shift 2 ;;
        --code=*) CODE="${1#--code=}"; shift ;;
        --cloud) CLOUD="${2:?--cloud needs a value}"; shift 2 ;;
        --cloud=*) CLOUD="${1#--cloud=}"; shift ;;
        --appliance) APPLIANCE=1; shift ;;
        --lock) LOCK=1; APPLIANCE=1; shift ;;
        --unlock) UNLOCK=1; shift ;;
        --force) FORCE=1; shift ;;
        --ups) UPS=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 64 ;;
    esac
done

# The install code as head office hands it out: XXXXX-XXXXX (the dash is
# optional, case does not matter; the node does the exact check).
if [[ -n "$CODE" && ! "$CODE" =~ ^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$ ]]; then
    echo "--code expects the install code written XXXXX-XXXXX, e.g. 7K4P9-QX2MA" >&2
    exit 64
fi

if [[ $EUID -ne 0 ]]; then
    echo "run as root (sudo)" >&2
    exit 77
fi

# ── --lock ────────────────────────────────────────────────────────────────

ENROLLED_MARKER=/etc/itulah/enrolled
LOCKED_MARKER=/etc/itulah/locked

# The node has enrolled when enrolment wrote its identity: a node.env that
# names a site (edge/enrolment.rs).
node_enrolled() {
    [[ -s "$DATA/node.env" ]] && grep -qE '^INVENTORY_SITE_ID=.+' "$DATA/node.env"
}

# Root's evidence that this box connected. The data directory belongs to the
# `itulah` account, so a node.env alone is not trusted by itself: this marker is
# written here, as root, only after looking at a real one, and a later run
# accepts it as long as node.env is still there.
lock_proven() {
    if node_enrolled; then
        install -d -m 0755 /etc/itulah
        printf 'site=%s\nat=%s\n' \
            "$(grep -m1 '^INVENTORY_SITE_ID=' "$DATA/node.env" | cut -d= -f2)" \
            "$(date -u +%FT%TZ)" > "$ENROLLED_MARKER"
        chmod 0644 "$ENROLLED_MARKER"
        return 0
    fi
    [[ -O "$ENROLLED_MARKER" && -s "$DATA/node.env" ]]
}

lock_packages() {
    if ! command -v apt-get >/dev/null; then
        echo "    (not Debian/Ubuntu: install nftables and, for the QR code, qrencode by hand)"
        return 0
    fi
    DEBIAN_FRONTEND=noninteractive apt-get install -y nftables >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y qrencode >/dev/null 2>&1 \
        || echo "    (qrencode not installed: the status screen shows the address without a QR code)"
}

# Everything that can be wrong with the new rules is found before anything on
# the machine is changed.
lock_stage_rules() {
    STAGED_RULES="$(mktemp)"
    cp "$HERE/nftables-store-lan.conf" "$STAGED_RULES"
    # Only apt may use plain HTTP, and only on a system that has its account.
    id _apt >/dev/null 2>&1 || sed -i '/# apt-http$/d' "$STAGED_RULES"
    nft -c -f "$STAGED_RULES"
}

lock_status_screen() {
    install -m 0755 "$HERE/central-status.sh" /usr/local/sbin/central-status
    cat > /etc/systemd/system/central-status.service <<'EOF'
[Unit]
Description=Central status screen on the server's console
After=store-edge.service
Conflicts=getty@tty1.service
After=getty@tty1.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/central-status
StandardInput=tty-force
StandardOutput=tty
StandardError=journal
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
}

lock_firewall() {
    if [[ -f /etc/nftables.conf && ! -f /etc/nftables.conf.pre-central ]]; then
        cp -p /etc/nftables.conf /etc/nftables.conf.pre-central
    fi
    install -m 0644 "$STAGED_RULES" /etc/nftables.conf
    rm -f "$STAGED_RULES"
    systemctl enable nftables >/dev/null 2>&1
    systemctl restart nftables
    # Established connections are kept by the rules, so an SSH session this
    # script runs in survives; new ones from the LAN no longer can.
    if command -v curl >/dev/null && ! curl -fsS -m 5 http://127.0.0.1:8082/api/v1/health >/dev/null 2>&1; then
        echo "    (the store server did not answer on loopback just now; check 'journalctl -u $UNIT')"
    fi
}

lock_console() {
    # No login on the box's own screen or keyboard: the status screen replaces
    # it. autovt@ is the alias logind starts for Alt+F2..F6.
    for unit in getty@.service autovt@.service serial-getty@.service \
                console-getty.service container-getty@.service ctrl-alt-del.target; do
        systemctl mask "$unit" >/dev/null 2>&1 || true
    done
    systemctl stop 'getty@*.service' 'serial-getty@*.service' >/dev/null 2>&1 || true
    passwd -l root >/dev/null 2>&1 || true
    install -d -m 0755 /etc/sysctl.d
    printf '# Written by install-store.sh --lock\nkernel.sysrq = 0\n' > /etc/sysctl.d/90-central-lock.conf
    sysctl -q -p /etc/sysctl.d/90-central-lock.conf >/dev/null 2>&1 || true
    systemctl daemon-reload
    systemctl enable central-status.service >/dev/null
    systemctl restart central-status.service
}

lock_ssh() {
    local sshd
    sshd="$(command -v sshd || ls /usr/sbin/sshd 2>/dev/null || true)"
    if [[ -n "$sshd" && -d /etc/ssh ]]; then
        install -d -m 0755 /etc/ssh/sshd_config.d
        # Named 00- so it is read before any other drop-in: sshd keeps the
        # first value it sees for a setting.
        cat > /etc/ssh/sshd_config.d/00-central-lock.conf <<'EOF'
# Written by install-store.sh --lock
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PermitEmptyPasswords no
EOF
        if ! "$sshd" -t 2>/dev/null; then
            rm -f /etc/ssh/sshd_config.d/00-central-lock.conf
            echo "    (sshd rejected the key-only settings; left as they were)"
        fi
    fi
    # Off by default. Head office turns it on over Tailscale when support is
    # needed. ssh.socket as well, or socket activation brings it straight back.
    systemctl disable --now ssh.socket >/dev/null 2>&1 || true
    systemctl disable --now ssh >/dev/null 2>&1 || systemctl disable --now sshd >/dev/null 2>&1 || true
    if [[ -n "${SSH_CONNECTION:-}" ]]; then
        echo "    You are connected over SSH: this session stays up, but nobody can SSH in afterwards."
    fi
}

apply_lock() {
    echo "==> lock: firewall, console, ssh, status screen"
    lock_packages
    lock_stage_rules || { echo "the firewall rules do not load on this system; not locking" >&2; return 1; }
    lock_status_screen
    lock_firewall
    lock_ssh
    lock_console
    install -d -m 0755 /etc/itulah
    date -u +%FT%TZ > "$LOCKED_MARKER"
    cat <<'EOF'
    Locked. Still to do by hand, because this script cannot:
      BIOS/UEFI  set a firmware password; disable booting from USB and network;
                 "Restore on AC power loss" = Power On; Secure Boot on.
      Disk       the data disk is NOT encrypted. If it must survive theft,
                 enrol it to the TPM (LUKS + systemd-cryptenroll --tpm2-device=auto).
    To undo the lock (needs SSH over Tailscale or the recovery console):
      sudo ./install-store.sh --unlock
EOF
}

unlock() {
    echo "==> unlock: console, ssh, firewall"
    rm -f "$LOCKED_MARKER" /etc/sysctl.d/90-central-lock.conf /etc/ssh/sshd_config.d/00-central-lock.conf
    systemctl disable --now central-status.service >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/central-status.service /usr/local/sbin/central-status
    for unit in getty@.service autovt@.service serial-getty@.service \
                console-getty.service container-getty@.service ctrl-alt-del.target; do
        systemctl unmask "$unit" >/dev/null 2>&1 || true
    done
    if [[ -f /etc/nftables.conf.pre-central ]]; then
        mv -f /etc/nftables.conf.pre-central /etc/nftables.conf
        systemctl restart nftables >/dev/null 2>&1 || true
    else
        rm -f /etc/nftables.conf
        systemctl disable --now nftables >/dev/null 2>&1 || true
        nft flush ruleset >/dev/null 2>&1 || true
    fi
    systemctl daemon-reload
    systemctl enable --now ssh >/dev/null 2>&1 || systemctl enable --now sshd >/dev/null 2>&1 || true
    systemctl enable --now ssh.socket >/dev/null 2>&1 || true
    systemctl start getty@tty1.service >/dev/null 2>&1 || true
    echo "    Unlocked. (The root password stays locked: use sudo from your own account.)"
}

if [[ $UNLOCK -eq 1 ]]; then
    unlock
    exit 0
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

needed_files=(store store-edge.service)
[[ $LOCK -eq 1 ]] && needed_files+=(central-status.sh nftables-store-lan.conf)
for needed in "${needed_files[@]}"; do
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
    claimed=0
    for _ in $(seq 1 30); do
        if journalctl -u "$UNIT" --since "-2min" -o cat 2>/dev/null | grep -q 'claimed the code'; then
            claimed=1
            break
        fi
        sleep 1
    done
    if [[ $claimed -eq 1 ]]; then
        echo "Code accepted. Central connects this server and sends its data; it shows under"
        echo "Central > Stores > your store > Server."
    else
        echo "No answer from Central yet. See: journalctl -u $UNIT"
    fi
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

if [[ $LOCK -eq 1 ]]; then
    echo
    # A box given its code a moment ago may still be connecting: give it time,
    # but never lock one that has not enrolled.
    if [[ $FORCE -ne 1 ]] && ! lock_proven && [[ -n "$CODE" ]]; then
        echo "Waiting up to ${LOCK_WAIT} s for this server to finish connecting before it is locked…"
        for _ in $(seq 1 "$LOCK_WAIT"); do
            node_enrolled && break
            sleep 1
        done
    fi
    if [[ $FORCE -eq 1 ]] || lock_proven; then
        apply_lock || exit 1
    else
        echo "NOT LOCKED: this server has not enrolled yet (no node.env naming a site in $DATA)." >&2
        echo "Locking now could leave a box nobody can reach. Once it shows as connected in" >&2
        echo "Central, run this again with --lock; or add --force if you really mean it." >&2
        exit 75
    fi
fi
