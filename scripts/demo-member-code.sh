#!/usr/bin/env bash
#
# demo-member-code — a fresh customer-app sign-in code for a demo member.
#
#   scripts/demo-member-code.sh                 # Sari Wulandari, 081311110001
#   scripts/demo-member-code.sh 081311110002    # Budi Santoso
#
# The customer app signs a member in with their card number (the phone number)
# and a six-digit code the counter issues, valid for ten minutes — the same
# code the hub's Members screen gives out. This asks for one as Dian (the
# store admin at the counter) and prints what to type into the app.
set -euo pipefail

card="${1:-081311110001}"
api="${DEMO_CLOUD:-http://127.0.0.1:8180}"
password="${DEMO_PASSWORD:-Password01}"
ip="$(ipconfig getifaddr en0 2>/dev/null || echo localhost)"

python3 - "$api" "$card" "$password" "$ip" <<'PY'
import json, sys, urllib.request, urllib.error, uuid

api, card, password, ip = sys.argv[1:5]

def call(method, path, body=None, token=None):
    request = urllib.request.Request(api + path, method=method,
                                     data=None if body is None else json.dumps(body).encode())
    request.add_header("content-type", "application/json")
    request.add_header("Idempotency-Key", str(uuid.uuid4()))
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} → {error.code}: {error.read().decode()[:200]}")

token = None
try:
    token = call("POST", "/api/v1/auth/login", {"username": "dian", "password": password})["token"]
except SystemExit:
    pass  # a rig with sign-in off: every call is `development`

members = call("GET", "/api/v1/members?limit=100", token=token)
rows = (members.get("members") or members.get("items") or members.get("rows") or []) if isinstance(members, dict) else members
member = next((m for m in rows if card in json.dumps(m)), None)
if not member:
    raise SystemExit(f"no member with card {card}")
member_id = member.get("member_id") or member.get("id")
issued = call("POST", f"/api/v1/members/{member_id}/pairing-code", {}, token=token)
code = issued.get("code") or issued.get("pairing_code")
name = member.get("name") or member.get("display_name") or ""
print(f"Customer app : http://{ip}:5352")
print(f"Member       : {name}")
print(f"Card number  : {card}")
print(f"Code         : {code}   (valid 10 minutes)")
PY
