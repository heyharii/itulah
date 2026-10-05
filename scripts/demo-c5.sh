#!/usr/bin/env bash
#
# demo-c5 — enrol the two handheld apps against the demo and fill their Setelan.
#
#   scripts/demo-c5.sh [cloud-api] [lan-ip]
#
# A reset wipes the Cloud database, and with it the two RFID devices the C5's
# apps sign with. This registers them again (C5-DC-01 → DC edge, C5-STORE-01 →
# store-01 edge), writes the one-time device keys to runs/demo/HANDHELD-C5.txt
# (mode 600, never printed), and — when a C5 is attached over adb — writes each
# app's settings straight into its SharedPreferences (debug builds allow
# `run-as`). Without a device attached it stops after the file.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api="${1:-http://127.0.0.1:8180}"
ip="${2:-$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)}"
sheet="$root/runs/demo/HANDHELD-C5.txt"
mkdir -p "$root/runs/demo"

python3 - "$api" "$ip" "$sheet" "${DEMO_PASSWORD:-}" <<'PY'
import json, os, subprocess, sys, urllib.request, urllib.error, uuid
from xml.sax.saxutils import escape

api, ip, sheet, password = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
token = None
DEVICES = [
    # app package, device, origin, edge port, site, default pool, all pools, operator
    ("id.itulah.pindai.dc", "C5-DC-01", "dc", 8181, "dc", "dc.warehouse",
     ["dc.warehouse", "dc.pending.untagged", "dc.pending.unidentified"], "nina"),
    ("id.itulah.pindai.store", "C5-STORE-01", "store-01", 8182, "store-01", "store-01.floor",
     ["store-01.floor", "store-01.warehouse", "store-01.reject"], "dian"),
]

def call(method, path, body=None, base=None, bearer=None):
    request = urllib.request.Request((base or api) + path, method=method,
                                     data=None if body is None else json.dumps(body).encode())
    request.add_header("content-type", "application/json")
    if bearer != "none" and (bearer or token):
        request.add_header("Authorization", f"Bearer {bearer or token}")
    request.add_header("Idempotency-Key", str(uuid.uuid4()))
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:200]

def key_of(payload):
    if isinstance(payload, dict):
        if "device_key" in payload:
            return payload["device_key"]
        for value in payload.values():
            found = key_of(value)
            if found:
                return found
    return None

if password:
    # A sign-in node: enrol as Rina, and give each app its operator's session
    # (packing, receiving and counting need a person as well as the device).
    status, payload = call("POST", "/api/v1/auth/login", {"username": "rina", "password": password})
    token = payload.get("token") if isinstance(payload, dict) else None

adb = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout.splitlines()[1:]
serial = next((line.split()[0] for line in adb if line.strip().endswith("device")), None)

lines = ["# Setelan handheld C5 — diisi otomatis oleh scripts/demo-c5.sh. Jangan dibagikan.", ""]
for package, device, origin, port, site, pool, pools, operator in DEVICES:
    status, payload = call("POST", "/api/v1/auth/rfid-devices", {
        "device_id": device, "origin_id": origin, "label": f"Handheld {device}", "pools": pools})
    if status not in (200, 201):
        # Already enrolled (a re-run): a fresh key needs a rotation.
        status, payload = call("POST", f"/api/v1/auth/rfid-devices/{device}/rotate", {})
    key = key_of(payload)
    if not key:
        print(f"  ! {device}: could not obtain a device key ({status})")
        continue
    url = f"http://{ip}:{port}"
    lines += [f"[{device}]", f"URL Edge  : {url}", f"Site ID   : {site}", f"Pool      : {pool}",
              f"Device ID : {device}", f"Device key: {key}", ""]
    note = "sheet only (no C5 attached)"
    if serial:
        prefs = {"base_url": url, "site_id": site, "pool": pool, "device_id": device, "device_key": key}
        if password:
            status, session = call("POST", "/api/v1/auth/login", {"username": operator, "password": password},
                                   base=f"http://127.0.0.1:{port}", bearer="none")
            if isinstance(session, dict) and session.get("token"):
                prefs["operator_token"] = session["token"]
        xml = ("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n"
               + "".join(f'    <string name="{k}">{escape(v)}</string>\n' for k, v in prefs.items())
               + "</map>\n")
        installed = subprocess.run(["adb", "-s", serial, "shell", "pm", "path", package],
                                   capture_output=True, text=True).stdout.strip()
        if installed:
            subprocess.run(["adb", "-s", serial, "shell", "am", "force-stop", package], check=False)
            done = subprocess.run(["adb", "-s", serial, "shell",
                                   f"run-as {package} sh -c 'mkdir -p shared_prefs && cat > shared_prefs/itulah-pindai.xml'"],
                                  input=xml.encode(), capture_output=True)
            note = "Setelan written on the C5" if done.returncode == 0 else f"run-as failed: {done.stderr.decode()[:80]}"
        else:
            note = f"{package} not installed on the C5"
    print(f"  {device} → {url} ({note})")

old = os.umask(0o077)
with open(sheet, "w") as handle:
    handle.write("\n".join(lines))
os.umask(old)
PY
