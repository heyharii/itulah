"""Summarise Caddy's JSON access log (stdin) per visitor IP that is not on the allow-list."""
import collections
import json
import os
import sys
import time

allow = set(os.environ.get("ALLOW", "").split())
unit = {"m": 60, "h": 3600, "d": 86400}
since = os.environ.get("SINCE", "")
cut = time.time() - int(since[:-1]) * unit[since[-1]] if since else 0

seen = collections.defaultdict(
    lambda: {
        "n": 0,
        "first": 1e18,
        "last": 0,
        "pages": collections.Counter(),
        "status": collections.Counter(),
        "hosts": set(),
    }
)
total = ours = 0
for line in sys.stdin:
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if "request" not in e or e.get("ts", 0) < cut:
        continue
    total += 1
    r = e["request"]
    ip = r.get("client_ip") or r.get("remote_ip") or "?"
    if ip in allow:
        ours += 1
        continue
    v = seen[ip]
    v["n"] += 1
    v["first"] = min(v["first"], e["ts"])
    v["last"] = max(v["last"], e["ts"])
    host = r.get("host", "?")
    v["hosts"].add(host)
    path = r.get("uri", "?").split("?")[0]
    if not path.startswith("/assets/") and not path.endswith(
        (".js", ".css", ".png", ".svg", ".ico", ".woff2", ".webp", ".jpg", ".map")
    ):
        v["pages"][host.split(".")[0] + path] += 1
    v["status"][e.get("status", 0)] += 1


def stamp(t):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t))


print(
    f"{total} requests read; {ours} from our own IPs; "
    f"{total - ours} from {len(seen)} other IP(s)."
)
for ip, v in sorted(seen.items(), key=lambda kv: -kv[1]["last"]):
    print(f"\n{ip}  {v['n']} requests  {stamp(v['first'])} -> {stamp(v['last'])}")
    print("  hosts :", ", ".join(sorted(v["hosts"])))
    print("  status:", ", ".join(f"{k}x{c}" for k, c in sorted(v["status"].items())))
    for page, c in v["pages"].most_common(15):
        print(f"  {c:4d}  {page}")
