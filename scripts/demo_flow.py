"""Shared plumbing for the demo flow driver.

The cloud admin password is not kept here. It is read from the Render
service that holds it, with RENDER_API_TOKEN in the environment, so no
secret is ever written into the repository.
"""
import json, os, urllib.request, urllib.error, http.cookiejar, time, sys

TOKEN = os.environ.get("RENDER_API_TOKEN", "")
CLOUD = "https://itulah-cloud.onrender.com"
DC = "http://127.0.0.1:8092"
SVC = "srv-dab1r6942hec739k9n3g"


class Node:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def login(self, user, password):
        self.call("POST", "/api/v1/auth/login", {"username": user, "password": password})
        self.csrf = next((c.value for c in self.jar if c.name == "inventory_csrf"), None)
        return self

    def call(self, method, path, body=None, extra=None):
        headers = {"content-type": "application/json"}
        if self.csrf:
            headers["x-csrf-token"] = self.csrf
        if extra:
            headers.update(extra)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with self.op.open(req, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw[:400].decode("utf-8", "replace")


def render_env():
    req = urllib.request.Request(
        f"https://api.render.com/v1/services/{SVC}/env-vars?limit=50",
        headers={"Authorization": f"Bearer {TOKEN}"})
    rows = json.load(urllib.request.urlopen(req, timeout=40))
    return {r["envVar"]["key"]: r["envVar"].get("value", "") for r in rows}


def wait_for(label, probe, timeout=120, every=5):
    """Poll until probe() returns a truthy value; sync cycles are 5s."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = probe()
        if found:
            return found
        time.sleep(every)
    print(f"    TIMEOUT menunggu {label}")
    return None
