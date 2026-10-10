#!/usr/bin/env python3
"""Watch a site while it is being deployed, and say whether anybody would have
noticed (owner, 10 Oct 2026: "tidak pernah down karna deploy").

    python3 deploy/gcp/probe.py <host> [--seconds 300] [--workers 6] [--until-file F]

Several workers ask, back to back and without a pause, for what a browser on
the hub asks for: the page, one of its hashed assets, the health check, an
authenticated read without a session (401), and a sign-in with a wrong
password (a POST that reaches the database; 401). Anything else - another
status, a refused or reset connection, a timeout - is a failure, printed with
its time. At the end: requests, failures, the slowest answer, the longest
stretch of seconds with any failure. Exit 1 if anything failed.

No password is used: every probe is one an anonymous visitor can make.
"""
import argparse
import json
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request

ctx = ssl.create_default_context()


def ask(method, url, body=None, timeout=20):
    req = urllib.request.Request(url, method=method, data=body)
    if body is not None:
        req.add_header("content-type", "application/json")
    req.add_header("cache-control", "no-cache")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            r.read()
            return r.status, time.monotonic() - t0, None
    except urllib.error.HTTPError as e:
        e.read()
        return e.code, time.monotonic() - t0, None
    except Exception as e:  # refused, reset, timeout, TLS
        return None, time.monotonic() - t0, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("host")
    ap.add_argument("--seconds", type=float, default=300)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--until-file", default=None, help="stop once this file exists")
    ap.add_argument("--hub-host", default=None, help="where the hub page is served (default: hub.<host>)")
    a = ap.parse_args()
    base = f"https://{a.host}"
    hub = f"https://{a.hub_host or 'hub.' + a.host}"

    status, _, err = ask("GET", hub + "/")
    page = urllib.request.urlopen(hub + "/", context=ctx).read().decode() if status == 200 else ""
    asset = (re.findall(r'/assets/[A-Za-z0-9._-]+\.js', page) or [None])[0]

    probes = [
        ("page", "GET", hub + "/", None, {200}),
        ("health", "GET", base + "/api/v1/health", None, {200}),
        ("me", "GET", hub + "/api/v1/auth/me", None, {401}),
        ("login", "POST", hub + "/api/v1/auth/login",
         json.dumps({"username": "probe-nobody", "password": "x"}).encode(), {401}),
    ]
    if asset:
        probes.append(("asset", "GET", hub + asset, None, {200}))

    lock = threading.Lock()
    stats = {"n": 0, "fail": 0, "slowest": (0.0, ""), "bad_seconds": set(), "by": {}}
    failures = []
    t_start = time.monotonic()
    stop = threading.Event()

    def worker(k):
        i = k
        while not stop.is_set():
            name, method, url, body, ok = probes[i % len(probes)]
            i += 1
            code, dt, err = ask(method, url, body)
            now = time.monotonic() - t_start
            good = code in ok
            with lock:
                stats["n"] += 1
                b = stats["by"].setdefault(name, [0, 0])
                b[0] += 1
                if dt > stats["slowest"][0]:
                    stats["slowest"] = (dt, f"{name} at {now:.1f}s")
                if not good:
                    stats["fail"] += 1
                    b[1] += 1
                    stats["bad_seconds"].add(int(now))
                    failures.append((now, name, code, err))
                    print(f"  FAIL {now:7.1f}s {name:6} -> {code} {err or ''}", flush=True)

    threads = [threading.Thread(target=worker, args=(k,), daemon=True) for k in range(a.workers)]
    for t in threads:
        t.start()
    import os
    while time.monotonic() - t_start < a.seconds:
        if a.until_file and os.path.exists(a.until_file):
            break
        time.sleep(0.5)
    stop.set()
    for t in threads:
        t.join(timeout=25)

    secs = sorted(stats["bad_seconds"])
    longest, run = 0, 0
    for i, s in enumerate(secs):
        run = run + 1 if i and s == secs[i - 1] + 1 else 1
        longest = max(longest, run)
    dur = time.monotonic() - t_start
    print(json.dumps({
        "host": a.host, "seconds": round(dur, 1), "requests": stats["n"],
        "failures": stats["fail"], "per_probe": stats["by"],
        "slowest_s": round(stats["slowest"][0], 2), "slowest_at": stats["slowest"][1],
        "longest_failing_stretch_s": longest, "asset": asset,
    }))
    sys.exit(1 if stats["fail"] else 0)


if __name__ == "__main__":
    main()
