#!/usr/bin/env python3
"""Open every page of the demo apps headlessly and flag the empty or broken ones.

    python3 scripts/demo-pagecheck.py                       # hub on :5350
    python3 scripts/demo-pagecheck.py --hub http://localhost:5370 --only /finance

Routes come from the apps' own navigation (frontend-hub/src/screens/*/nav.ts),
so a page added to a menu is checked without editing this file. Each page is
opened with `agent-browser`, given a moment to load, and its text is scanned
for the phrases the screens use when they have nothing to show ("… yet",
"Nothing …", "Belum ada …") or when a call failed ("not found:", "error").
A flag is a lead, not a verdict: "Nothing pending" on a page full of rows is a
flag too, so the matched line is printed for a human to judge.
"""

from __future__ import annotations

import argparse
import json
import concurrent.futures as futures
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EMPTY = re.compile(
    r"(\bno\b[^\n]{0,70}\b(yet|has been|have been|found|registered|recorded|to show)\b|"
    r"\bnothing\b[^\n]{0,60}\b(yet|here|to show|to measure|found|filed|rostered)\b|"
    r"^there (is|are) no\b|belum ada|tidak ada|is empty|none yet|^no [a-z ]{0,40}\.$)",
    re.I)
BROKEN = re.compile(r"(not found:|internal server error|failed to fetch|\berror:|refused|forbidden|"
                    r"unauthorized|something went wrong|cannot read)", re.I)
SKIP = re.compile(r":|\$|/new$|/edit|/correction$|/swap$|/slip$")


def hub_routes() -> list[str]:
    found = set()
    for nav in (ROOT / "frontend-hub/src/screens").glob("*/nav.ts"):
        for match in re.finditer(r'path: "(/[^"]*)"', nav.read_text()):
            if not SKIP.search(match.group(1)):
                found.add(match.group(1))
    return sorted(found)


def browse(session: str, url: str, wait_ms: int) -> str:
    def run(*args):
        return subprocess.run(["agent-browser", "--session", session, *args],
                              capture_output=True, text=True, timeout=90).stdout
    run("open", url)
    run("wait", str(wait_ms))
    return run("get", "text", "body")


def sign_in(session: str, base: str, user: str, password: str) -> None:
    """Sign a browser session in, once. Posted from inside the page, to the
    same origin the hub itself uses, so the session cookie lands where the
    hub reads it (typing into the form does not reach its React state in a
    headless engine)."""
    def run(*args):
        return subprocess.run(["agent-browser", "--session", session, *args],
                              capture_output=True, text=True, timeout=90).stdout
    run("open", base + "/")
    run("wait", "1500")
    body = json.dumps({"username": user, "password": password})
    run("eval", "fetch('/api/v1/auth/login',{method:'POST',credentials:'include',"
                f"headers:{{'content-type':'application/json'}},body:{json.dumps(body)}}}).then(r=>r.status)")


def check(job):
    index, base, route, sessions, wait_ms = job
    session = f"pagecheck-{index % sessions}"
    try:
        text = browse(session, base + route, wait_ms)
    except subprocess.TimeoutExpired:
        return route, "TIMEOUT", ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if any(line.startswith("Sign in to the") for line in lines[:6]):
        return route, "SIGNED-OUT", "the session is not signed in"
    broken = [line for line in lines if BROKEN.search(line)]
    empty = [line for line in lines if EMPTY.search(line)]
    if broken:
        return route, "BROKEN", " | ".join(broken[:2])[:160]
    if empty:
        return route, "EMPTY?", " | ".join(empty[:3])[:160]
    return route, "ok", ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hub", default="http://localhost:5350")
    parser.add_argument("--only", help="route prefix filter, e.g. /finance")
    parser.add_argument("--sessions", type=int, default=4)
    parser.add_argument("--wait", type=int, default=4000, help="ms to let a page load")
    parser.add_argument("--user", help="sign in as this user first (hub login form)")
    parser.add_argument("--password", default="Password01")
    args = parser.parse_args()
    routes = [r for r in hub_routes() if not args.only or r.startswith(args.only)]
    jobs = [(i, args.hub.rstrip("/"), r, args.sessions, args.wait) for i, r in enumerate(routes)]
    if args.user:
        with futures.ThreadPoolExecutor(max_workers=args.sessions) as pool:
            list(pool.map(lambda n: sign_in(f"pagecheck-{n}", args.hub.rstrip("/"), args.user, args.password),
                          range(args.sessions)))
    results = {}
    with futures.ThreadPoolExecutor(max_workers=args.sessions) as pool:
        for route, status, note in pool.map(check, jobs):
            results[route] = (status, note)
    counts = {}
    for route in routes:
        status, note = results[route]
        counts[status] = counts.get(status, 0) + 1
        if status != "ok":
            print(f"{status:8s} {route:45s} {note}")
    print("\n" + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) + f"  (of {len(routes)} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
