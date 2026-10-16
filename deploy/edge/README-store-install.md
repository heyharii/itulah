# Installing a store server

In Central open **Stores > the store > Server**: it shows the **install code**
(`XXXXX-XXXXX`, one use) and the download link. Then use one of two machines.

## A. Windows back-office PC (an ordinary computer, not locked)

1. Download `central-store-server-<version>-x64.msi` from that page and open it.
2. Type the install code in **Connect this PC to Central** and press Connect.
   (Skip installs without a code; a setup page then opens in the browser.)
3. The tray dot turns green when the server is ready. Tills and tablets open
   the store app at `http://<store-id>.local:8082`.

Silent: `msiexec /i central-store-server-<version>-x64.msi /qn ENROLL_CODE=XXXXX-XXXXX`

## B. Dedicated Linux mini PC (prepared at head office, then locked)

On the unpacked release (`itulah-store-<version>-linux-x64`), as root:

```
sudo ./install-store.sh --code XXXXX-XXXXX --appliance --lock
```

It connects first, then locks: firewall (shop network only; DNS, NTP and HTTPS
out), no console login, SSH off (key-only, no root; head office turns it on over
Tailscale for support). A box that has not connected is not locked (`--force`
overrides, `--unlock` undoes). The screen shows the store name, Ready or
Offline, "data up to", the store app address and a QR code.

The script cannot do these; do them before the box ships:

- BIOS: firmware password, no USB or network boot, "Restore on AC power loss" =
  Power On.
- Disk: not encrypted. If the data must survive theft, enrol it to the TPM
  (LUKS + `systemd-cryptenroll`).

## If something is wrong
Windows: the tray dot, and `store.exe diagnose`. Linux: `journalctl -u store-edge`.
`deploy/scripts/provision-store.sh` and the tailnet/master-key runbook in
`deploy/README.md` are developer-only legacy.
