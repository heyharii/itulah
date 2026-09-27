#!/usr/bin/env python3
"""Data inventory: every table, every endpoint, every hub page — in one sheet.

Answers two questions at once:

  1. What data does the database actually hold?  (Tables sheet)
  2. Does every hub page reach the backend, and does it get rows back?
     (Pages + Endpoints sheets)

Two steps, because the machine that has the source is not always the machine
that can reach the database:

  manifest  Reads the repo (hub navigation, which API each page calls, the
            backend's routes, the migrations) and writes a JSON manifest.
            Run it wherever the repo is checked out; commit the result.

  report    Reads the manifest, counts rows in every table, GETs every
            endpoint and writes an .xlsx (plus a JSON of the same). Needs only
            Python 3.9+, the database URL and the API base URL — no repo, no
            browser, no pip install. Uses psycopg/psycopg2 if installed,
            otherwise the `psql` binary.

Safe on production: the report only issues SELECTs and HTTP GETs. POST, PUT,
PATCH and DELETE endpoints are listed but never called, and streaming
endpoints are closed as soon as they answer.

Examples:

  python3 scripts/data_inventory.py manifest
  python3 scripts/data_inventory.py report \
      --database-url postgresql:///inventory_marketing_dogfood \
      --api-base http://127.0.0.1:8080

  # Cloud with auth on (token, or username/password to log in first):
  DATABASE_URL=... ITULAH_USER=admin ITULAH_PASSWORD=... \
      python3 scripts/data_inventory.py report --api-base https://itulah-cloud.onrender.com
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from xml.sax.saxutils import escape

REPO = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = Path(__file__).resolve().parent / "data_inventory_manifest.json"

# ─────────────────────────────────────────────────────────────── manifest ──

API_LITERAL = re.compile(r"""(["'`])(/(?:edge/)?api/v1/[^"'`\s]*)\1""")
METHOD_BEFORE = re.compile(
    r"\.(get|post|put|patch|delete|stream)\s*(?:<[^()]*?>)?\s*\(\s*$", re.S
)
TOP_DECL = re.compile(
    r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?"
    r"(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)",
    re.M,
)
IMPORT = re.compile(r"""import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']""", re.S)
EDGE_CLIENTS = {"edge", "dc", "edgeSync", "edgeAuth"}
# Files every screen reaches through a link or the sidebar — the nav registry
# carries each module's badge hooks, so following it credits every page with
# every module's counts.
CHROME = re.compile(r"^lib/navigation\.ts$|/nav\.ts$|^screens/registry\.ts$|^routes\.tsx$"
                    r"|^components/shell/|^lib/search\.ts$|^lib/sheets\.ts$")
# Query-key factories name every fetcher of their module as a property, which
# reads as a call to each; a key is not a request.
KEY_FACTORY = re.compile(r"(Keys?|cacheKey)$")


def normalise_api_path(raw: str) -> str:
    """`/api/v1/x/${id}/y${search(q)}` → `/api/v1/x/{param}/y`."""
    path = raw.split("?")[0]
    # A placeholder that is a whole segment is a parameter; anything else
    # glued on the end is a query-string builder.
    path = re.sub(r"/\$\{[^}]*\}", "/{param}", path)
    path = re.sub(r"\$\{[^}]*\}", "", path)
    return path.rstrip("/") or path


def literals_with_method(text: str) -> list[tuple[str, str]]:
    found = []
    for m in API_LITERAL.finditer(text):
        before = text[max(0, m.start() - 120) : m.start()]
        mm = METHOD_BEFORE.search(before)
        method = (mm.group(1) if mm else "get").upper()
        if method == "STREAM":
            method = "GET"
        found.append((method, normalise_api_path(m.group(2))))
    return found


class TsModule:
    """One .ts/.tsx file split into its top-level declarations."""

    def __init__(self, path: Path):
        self.path = path
        self.text = path.read_text(errors="ignore")
        self.imports: dict[str, tuple[str, str]] = {}  # local name → (spec, remote name)
        self.file_imports: list[str] = []
        for m in IMPORT.finditer(self.text):
            clause, spec = m.group(2), m.group(3)
            self.file_imports.append(spec)
            named = re.search(r"\{([^}]*)\}", clause)
            if named:
                for part in named.group(1).split(","):
                    part = part.strip().removeprefix("type ").strip()
                    if not part:
                        continue
                    if " as " in part:
                        remote, local = [p.strip() for p in part.split(" as ")]
                    else:
                        remote = local = part
                    self.imports[local] = (spec, remote)
            default = re.match(r"\s*([A-Za-z_$][\w$]*)\s*(,|$)", clause)
            if default:
                self.imports[default.group(1)] = (spec, "default")
        self.decls: dict[str, str] = {}
        marks = [(m.start(), m.group(1)) for m in TOP_DECL.finditer(self.text)]
        for i, (start, name) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(self.text)
            self.decls[name] = self.text[start:end]


class FrontendScanner:
    def __init__(self, src: Path):
        self.src = src
        self.cache: dict[Path, TsModule] = {}
        self.units: dict[tuple, tuple] = {}

    def resolve(self, spec: str, origin: Path) -> Path | None:
        if spec.startswith("@/"):
            base = self.src / spec[2:]
        elif spec.startswith("."):
            base = (origin.parent / spec).resolve()
        else:
            return None
        for cand in (base, *(base.with_name(base.name + ext) for ext in (".ts", ".tsx")),
                     base / "index.ts", base / "index.tsx"):
            if cand.is_file():
                return cand
        return None

    def module(self, path: Path) -> TsModule:
        if path not in self.cache:
            self.cache[path] = TsModule(path)
        return self.cache[path]

    def is_named_level(self, path: Path) -> bool:
        """Query/client files are read declaration by declaration, so a page that
        imports one hook from `finance.ts` is not credited with all 200 of them."""
        rel = path.relative_to(self.src).as_posix()
        return rel.startswith("lib/")

    def unit(self, path: Path, name: str | None) -> tuple[set, set, list]:
        """One node of the reach graph: a whole file (`name` None) or one
        top-level declaration of a lib file. Returns its own api calls, its
        edge-client uses and the units it points at. Memoised — the graph is
        built once and walked once per page."""
        key = (path, name)
        if key in self.units:
            return self.units[key]
        mod = self.module(path)
        body = mod.text if name is None else mod.decls.get(name, "")
        idents = set(re.findall(r"[A-Za-z_$][\w$]*", body))
        calls = set(literals_with_method(body))
        edge_uses = set()
        for client in EDGE_CLIENTS & idents:
            if client in mod.imports or path.name == "api.ts":
                for m in re.finditer(rf"\b{client}\.([A-Za-z]+)\s*\(", body):
                    edge_uses.add(f"{client}.{m.group(1)}")
        deps = []
        if name is not None and KEY_FACTORY.search(name):
            idents = set()
        if name is not None:
            deps += [(path, other) for other in mod.decls if other != name and other in idents]
        for local in idents & mod.imports.keys():
            spec, remote = mod.imports[local]
            target = self.resolve(spec, path)
            if target is None:
                continue
            rel = target.relative_to(self.src).as_posix()
            if not rel.startswith(("lib/", "screens/", "components/")) or CHROME.search(rel):
                continue
            deps.append((target, remote) if self.is_named_level(target) else (target, None))
        self.units[key] = (calls, edge_uses, deps)
        return self.units[key]

    def endpoints_for(self, path: Path) -> tuple[set, set]:
        """(api calls, edge client uses) reachable from a screen file."""
        calls, edge_uses = set(), set()
        seen, todo = set(), [(path, None)]
        while todo:
            key = todo.pop()
            if key in seen:
                continue
            seen.add(key)
            c, e, deps = self.unit(*key)
            calls |= c
            edge_uses |= e
            todo += deps
        return calls, edge_uses


def parse_nav(src: Path) -> list[dict]:
    nav_ts = (src / "lib/navigation.ts").read_text()
    order = re.search(r"export const modules[^=]*=\s*\[(.*?)\]", nav_ts, re.S).group(1)
    asides = re.search(r"export const asides[^=]*=\s*\[(.*?)\]", nav_ts, re.S).group(1)
    unlisted = re.search(r"const unlisted[^=]*=\s*\[(.*?)\]", nav_ts, re.S).group(1)
    wanted = [n.strip() for n in (order + "," + asides + "," + unlisted).split(",") if n.strip()]

    navs: dict[str, dict] = {}
    for f in sorted(src.glob("screens/*/nav.ts")):
        text = f.read_text()
        for m in re.finditer(r"export const (\w+)\s*:\s*AppModule\s*=\s*\{", text):
            start = m.end()
            depth, i = 1, start
            while depth and i < len(text):
                depth += {"{": 1, "}": -1}.get(text[i], 0)
                i += 1
            body = text[start:i]
            mid = re.search(r'\bid:\s*"([^"]+)"', body).group(1)
            mlabel = re.search(r'\blabel:\s*"([^"]+)"', body).group(1)
            mhidden = bool(re.search(r"^\s{2}hidden:\s*true", body, re.M))
            items = []
            for im in re.finditer(r"\{[^{}]*\bpath:\s*\"([^\"]+)\"[^{}]*\}", body):
                chunk = im.group(0)
                label = re.search(r'\blabel:\s*"([^"]+)"', chunk)
                items.append({
                    "path": im.group(1),
                    "label": label.group(1) if label else im.group(1),
                    "hidden": mhidden or bool(re.search(r"\bhidden:\s*true", chunk)),
                })
            navs[m.group(1)] = {"id": mid, "label": mlabel, "items": items}
    pages = []
    for name in wanted:
        nav = navs.get(name)
        if not nav:
            continue
        for item in nav["items"]:
            pages.append({"module_id": nav["id"], "module": nav["label"], **item})
    return pages


def parse_screen_maps(src: Path, scanner: FrontendScanner) -> dict[str, tuple[Path, str]]:
    out = {}
    for index in sorted([*src.glob("screens/**/index.ts"), *src.glob("screens/**/index.tsx")]):
        mod = scanner.module(index)
        body = re.search(r"screens\s*:\s*ScreenMap\s*=\s*(?:\w+\()?\{(.*?)\n\}", mod.text, re.S)
        if not body:
            continue
        for m in re.finditer(r'"(/[^"]*)"\s*:\s*([A-Za-z_$][\w$]*)', body.group(1)):
            path, comp = m.group(1), m.group(2)
            spec, remote = mod.imports.get(comp, (None, None))
            target = scanner.resolve(spec, index) if spec else None
            if target:
                out[path] = (target, remote)
    return out


def scan_backend(backend: Path) -> tuple[list[dict], dict[str, dict]]:
    routes = []
    for p in sorted((backend / "src").rglob("*.rs")):
        s = p.read_text(errors="ignore")
        for m in re.finditer(r'\.route\(\s*"(/api/[^"]+)"\s*,', s):
            tail = s[m.end() : m.end() + 600]
            depth, i = 1, 0
            while i < len(tail) and depth:
                depth += {"(": 1, ")": -1}.get(tail[i], 0)
                i += 1
            body = tail[: i - 1]
            for mm in re.finditer(r"\b(get|post|put|patch|delete)\(\s*([\w:]+)", body):
                routes.append({
                    "method": mm.group(1).upper(),
                    "path": m.group(1),
                    "node": "edge" if "/edge/" in p.as_posix() else "cloud",
                    "file": p.relative_to(backend).as_posix(),
                    "handler": mm.group(2),
                })

    tables: dict[str, dict] = {}
    migs = sorted((backend / "migrations/postgres").glob("*.sql"))
    create = re.compile(r'create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(', re.I)
    for mig in migs:
        for m in create.finditer(mig.read_text(errors="ignore")):
            tables.setdefault(m.group(1), {"migration": mig.name, "files": []})
    rust = [(p.relative_to(backend / "src").as_posix(),
             set(re.findall(r"\w+", p.read_text(errors="ignore"))))
            for p in (backend / "src").rglob("*.rs") if "test" not in p.name]
    for name, info in tables.items():
        info["files"] = sorted(rel for rel, words in rust if name in words)[:12]
    return routes, tables


def cmd_manifest(args) -> None:
    src = REPO / "frontend-hub/src"
    scanner = FrontendScanner(src)
    pages = parse_nav(src)
    screen_map = parse_screen_maps(src, scanner)
    for page in pages:
        target = screen_map.get(page["path"])
        if not target:
            page.update(screen=None, calls=[], edge=[])
            continue
        path, _ = target
        calls, edge = scanner.endpoints_for(path)
        page["screen"] = path.relative_to(src).as_posix()
        page["calls"] = sorted({f"{m} {p}" for m, p in calls})
        page["edge"] = sorted(edge)

    # An endpoint every screen reaches (the shell's clock, notifications…) says
    # nothing about any one page.
    counts: dict[str, int] = {}
    for page in pages:
        for c in page["calls"]:
            counts[c] = counts.get(c, 0) + 1
    common = {c for c, n in counts.items() if n > len(pages) * 0.6}
    for page in pages:
        page["calls"] = [c for c in page["calls"] if c not in common]

    routes, tables = scan_backend(REPO / "backend")
    manifest = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "git_commit": subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"],
                                     capture_output=True, text=True).stdout.strip(),
        "shell_endpoints": sorted(common),
        "pages": pages,
        "routes": routes,
        "tables": tables,
    }
    out = Path(args.out)
    out.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    wired = sum(1 for p in pages if p["calls"] or p["edge"])
    print(f"manifest → {out}")
    print(f"  {len(pages)} pages ({wired} call the backend), {len(routes)} routes, {len(tables)} tables")


# ───────────────────────────────────────────────────────────────── report ──

class Db:
    """Just enough of a database client: psycopg if present, else `psql`."""

    def __init__(self, url: str):
        self.url = url
        self.conn = None
        for mod in ("psycopg", "psycopg2"):
            try:
                lib = __import__(mod)
                self.conn = lib.connect(url)
                self.conn.autocommit = True
                break
            except ImportError:
                continue
        if self.conn is None and not shutil.which("psql"):
            sys.exit("need psycopg, psycopg2 or the psql binary to read the database")

    def rows(self, sql: str) -> list[list]:
        if self.conn is not None:
            with self.conn.cursor() as cur:
                cur.execute(sql)
                return [list(r) for r in cur.fetchall()]
        res = subprocess.run(
            ["psql", self.url, "-X", "-A", "-t", "-F", "\x1f", "-R", "\x1e",
             "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True, text=True,
        )
        if res.returncode:
            raise RuntimeError(res.stderr.strip())
        return [line.split("\x1f") for line in res.stdout.rstrip("\n").split("\x1e") if line]


TS_COLUMNS = ["updated_at", "created_at", "recorded_at", "occurred_at", "inserted_at",
              "posted_at", "observed_at", "at"]


def inventory_tables(db: Db, estimate: bool, manifest_tables: dict) -> list[dict]:
    base = db.rows("""
        select c.relname,
               c.reltuples::bigint,
               pg_total_relation_size(c.oid),
               (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
               coalesce(obj_description(c.oid), '')
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
         order by 1""")
    ts_cols = {}
    for tbl, col in db.rows(f"""
        select table_name, column_name from information_schema.columns
         where table_schema = 'public'
           and data_type in ('timestamp with time zone', 'timestamp without time zone', 'date')
           and column_name in ({",".join(f"'{c}'" for c in TS_COLUMNS)})"""):
        best = ts_cols.get(tbl)
        if best is None or TS_COLUMNS.index(col) < TS_COLUMNS.index(best):
            ts_cols[tbl] = col

    out = []
    for name, est, size, ncols, comment in base:
        row = {"table": name, "columns": int(ncols), "size_bytes": int(size),
               "comment": comment.strip().splitlines()[0][:200] if comment else ""}
        if estimate:
            row["rows"] = max(int(est), 0)
            row["rows_exact"] = False
        else:
            row["rows"] = int(db.rows(f'select count(*) from public."{name}"')[0][0])
            row["rows_exact"] = True
        col = ts_cols.get(name)
        row["latest_column"] = col or ""
        row["latest"] = ""
        if col and row["rows"]:
            sql = f'select coalesce(max("{col}")::text, \'-\') from public."{name}"'
            v = db.rows(sql)[0][0]
            row["latest"] = "" if v in (None, "-") else v[:19]
        meta = manifest_tables.get(name, {})
        row["migration"] = meta.get("migration", "")
        row["backend_files"] = meta.get("files", [])
        out.append(row)
    return out


def domain_of(table: str, files: list[str]) -> str:
    """The backend module a table belongs to: the store file whose name shares
    the most words with the table, or blank when none does."""
    words = set(table.split("_"))
    stores = [f for f in files if f.startswith("cloud/postgres/")]
    if not stores:
        stores = [f for f in files if f.startswith(("cloud/domain/", "cloud/"))] or files
    if not stores:
        return ""

    def stem(f: str) -> str:
        if Path(f).stem != "mod":
            return Path(f).stem
        return "core" if Path(f).parent.name == "postgres" else Path(f).parent.name

    def score(f: str) -> tuple:
        s_words = set(stem(f).split("_"))
        singular = {w.rstrip("s") for w in s_words}
        return (len(words & s_words) + len({w.rstrip("s") for w in words} & singular), -len(f))
    best = max(stores, key=score)
    # No shared word means a guess; the file list beside it says more than a
    # guessed name would.
    if score(best)[0] == 0:
        return ""
    return stem(best)


class Api:
    def __init__(self, base: str, token: str | None, cookie: str | None, timeout: float):
        self.base = base.rstrip("/")
        self.headers = {"Accept": "application/json", "User-Agent": "itulah-data-inventory"}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        if cookie:
            self.headers["Cookie"] = cookie
        self.timeout = timeout

    def login(self, username: str, password: str) -> None:
        req = urllib.request.Request(
            self.base + "/api/v1/auth/login",
            data=json.dumps({"username": username, "password": password}).encode(),
            headers={"Content-Type": "application/json", **self.headers}, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            token = json.load(res)["token"]
        self.headers["Authorization"] = f"Bearer {token}"

    def probe(self, path: str) -> dict:
        started = time.monotonic()
        req = urllib.request.Request(self.base + path, headers=self.headers, method="GET")
        result = {"status": None, "items": None, "shape": "", "ms": None, "error": ""}
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                result["status"] = res.status
                ctype = res.headers.get("Content-Type", "")
                if "event-stream" in ctype:
                    result["shape"] = "stream"
                elif "json" in ctype:
                    body = res.read(20_000_000)
                    result.update(measure(json.loads(body or b"null")))
                else:
                    result["shape"] = ctype.split(";")[0] or "body"
                    result["items"] = 1 if res.read(1) else 0
        except urllib.error.HTTPError as e:
            result["status"] = e.code
            try:
                result["error"] = e.read(400).decode(errors="ignore").strip()
            except Exception:
                pass
        except Exception as e:  # timeout, refused, DNS…
            result["error"] = f"{type(e).__name__}: {e}"[:300]
        result["ms"] = int((time.monotonic() - started) * 1000)
        return result


def measure(doc) -> dict:
    """How many things came back. Lists count their length; an object counts
    its largest list (one level down too); an object without lists is 1."""
    if isinstance(doc, list):
        return {"items": len(doc), "shape": "list"}
    if isinstance(doc, dict):
        best = None
        for k, v in doc.items():
            if isinstance(v, list) and (best is None or len(v) > best[1]):
                best = (k, len(v))
            elif isinstance(v, dict):
                for k2, v2 in v.items():
                    if isinstance(v2, list) and (best is None or len(v2) > best[1]):
                        best = (f"{k}.{k2}", len(v2))
        total = doc.get("total")
        if best:
            shape = f"{{{best[0]}}}" + (f" total={total}" if isinstance(total, int) else "")
            return {"items": total if isinstance(total, int) and total > best[1] else best[1],
                    "shape": shape}
        return {"items": 1 if doc else 0, "shape": "object"}
    return {"items": 0 if doc in (None, "", 0) else 1, "shape": type(doc).__name__}


def route_matcher(routes: list[dict]):
    compiled = []
    # Cloud first: a path both nodes serve (login, health) is the cloud's here.
    for r in sorted(routes, key=lambda r: r["node"] != "cloud"):
        rx = "^" + re.sub(r"\\\{[^}]+\\\}", "[^/]+", re.escape(r["path"])) + "$"
        compiled.append((r["method"], re.compile(rx), r))

    def match(method: str, path: str):
        path = re.sub(r"\{param\}", "x", path)
        for m, rx, r in compiled:
            if m == method and rx.match(path):
                return r
        return None
    return match


def cmd_report(args) -> None:
    manifest = json.loads(Path(args.manifest).read_text())
    started = dt.datetime.now(dt.timezone.utc)

    tables: list[dict] = []
    if args.database_url:
        print("counting rows …", file=sys.stderr)
        db = Db(args.database_url)
        tables = inventory_tables(db, args.estimate, manifest.get("tables", {}))
        for t in tables:
            t["domain"] = domain_of(t["table"], t["backend_files"])
        migrated = db.rows("select coalesce(max(version)::text, '-') from _sqlx_migrations")[0][0]
    else:
        migrated = ""

    api = None
    if args.api_base:
        token = args.token or os.environ.get("ITULAH_TOKEN")
        cookie = args.cookie or os.environ.get("ITULAH_COOKIE")
        api = Api(args.api_base, token, cookie, args.timeout)
        user = args.user or os.environ.get("ITULAH_USER")
        password = os.environ.get("ITULAH_PASSWORD")
        if user and password and not token:
            api.login(user, password)

    match = route_matcher(manifest["routes"])
    cloud_gets = sorted({r["path"] for r in manifest["routes"]
                         if r["method"] == "GET" and r["node"] == "cloud"})
    page_gets = set()
    for p in manifest["pages"]:
        for c in p["calls"]:
            method, path = c.split(" ", 1)
            route = match(method, path)
            if method == "GET" and route and route["node"] == "cloud":
                page_gets.add(path)
    to_probe = sorted(p for p in (set(cloud_gets) | page_gets)
                      if "{" not in p and not re.search(args.skip, p))

    probes: dict[str, dict] = {}
    if api:
        print(f"probing {len(to_probe)} GET endpoints …", file=sys.stderr)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for path, res in zip(to_probe, pool.map(api.probe, to_probe)):
                probes[path] = res

    # Endpoints sheet: every route, probed or not.
    endpoints = []
    used_by: dict[str, list[str]] = {}
    for p in manifest["pages"]:
        for c in p["calls"]:
            used_by.setdefault(c, []).append(p["path"])
    seen = set()
    for r in manifest["routes"]:
        key = f'{r["method"]} {r["path"]}'
        if key in seen:
            continue
        seen.add(key)
        pages_using = sorted({pg for c, pgs in used_by.items() if (m := c.split(" ", 1)) and
                              match(m[0], m[1]) is r for pg in pgs})
        probe = probes.get(r["path"]) if r["method"] == "GET" else None
        endpoints.append({
            "method": r["method"], "path": r["path"], "node": r["node"],
            "handler": r["handler"], "file": r["file"], "pages": pages_using,
            **endpoint_verdict(r, probe, api is not None),
        })

    # Pages sheet.
    pages = []
    for p in manifest["pages"]:
        rows = []
        for c in p["calls"]:
            method, path = c.split(" ", 1)
            route = match(method, path)
            probe = probes.get(path) if method == "GET" else None
            rows.append({"call": c, "route": route, "probe": probe})
        pages.append({**p, **page_verdict(p, rows, api is not None)})

    summary = build_summary(tables, endpoints, pages, manifest, migrated, args, started)
    out = Path(args.out or f"data-inventory-{started:%Y%m%d-%H%M}.xlsx")
    write_xlsx(out, summary, tables, pages, endpoints)
    out.with_suffix(".json").write_text(json.dumps(
        {"summary": summary, "tables": tables, "pages": pages, "endpoints": endpoints},
        indent=1, ensure_ascii=False, default=str))
    print(f"report → {out} (+ {out.with_suffix('.json').name})")
    for k, v in summary:
        print(f"  {k}: {v}")


def probe_class(probe: dict) -> str:
    """What a probe's answer means, in the words the sheet uses.

    Only a 5xx, a refused connection or an unexpected 4xx is an Error. A 400
    that names a missing query field is the probe's fault, not the page's —
    the screen always sends it — and a 401 from the member API is a customer
    session, which an operator's token cannot be."""
    s, note = probe["status"], probe["error"]
    if s is None:
        return "Gagal konek"
    if s in (401, 403):
        return "Butuh sesi member" if "member" in note else "Butuh login"
    if s == 400 and re.search(r"missing field|needs|query string", note):
        return "Perlu query param"
    if s == 404:
        return "404 (build lama?)"
    if s == 405:
        return "Bukan GET"
    if s >= 400:
        return f"Error {s}"
    if probe["shape"] == "stream":
        return "Stream"
    return "Ada data" if probe["items"] else "Kosong"


def endpoint_verdict(route: dict, probe: dict | None, probed: bool) -> dict:
    base = {"status": "", "items": "", "shape": "", "ms": "", "verdict": "", "note": ""}
    if route["method"] != "GET":
        return {**base, "verdict": "Tulis (tidak dipanggil)"}
    if route["node"] == "edge":
        return {**base, "verdict": "Edge/DC node"}
    if "{" in route["path"]:
        return {**base, "verdict": "Perlu parameter"}
    if not probed:
        return {**base, "verdict": "Tidak dicek"}
    if probe is None:
        return {**base, "verdict": "Dilewati (--skip)"}
    base.update(status=probe["status"] or "", items=probe["items"] if probe["items"] is not None else "",
                shape=probe["shape"], ms=probe["ms"], note=probe["error"][:200],
                verdict=probe_class(probe))
    return base


READ_OK = {"Ada data", "Kosong", "Stream"}
NOT_A_FAULT = {"Perlu query param", "Bukan GET", "Butuh sesi member"}


def page_verdict(page: dict, rows: list[dict], probed: bool) -> dict:
    gets = [r for r in rows if r["call"].startswith("GET ")]
    concrete = [r for r in gets if r["probe"] is not None]
    for r in concrete:
        r["class"] = probe_class(r["probe"])
    answered = [r for r in concrete if r["class"] in READ_OK]
    unknown = [r["call"] for r in rows if r["route"] is None and not page["edge"]]
    total_items = sum((r["probe"]["items"] or 0) for r in answered)

    def path(r):
        return r["call"].split(" ", 1)[1]
    failing = [f'{path(r)} → {r["probe"]["status"] or "gagal"}' for r in concrete
               if r["class"] not in READ_OK | NOT_A_FAULT]
    skipped = [f'{path(r)} ({r["class"]})' for r in concrete if r["class"] in NOT_A_FAULT]
    detail = [f'{path(r)} = {r["probe"]["items"]}' for r in answered]

    if not page.get("screen"):
        verdict = "Placeholder (belum dibuat)"
    elif not rows and not page["edge"]:
        verdict = "Belum konek backend (statis/mock)"
    elif not gets and page["edge"]:
        verdict = "Butuh edge/DC node"
    elif not probed:
        verdict = "Tidak dicek"
    elif failing:
        verdict = "Error"
    elif answered and total_items > 0 and any(not r["probe"]["items"] for r in answered):
        verdict = "Sebagian kosong"
    elif answered and total_items > 0:
        verdict = "Ada data"
    elif answered:
        verdict = "Kosong"
    elif page["edge"]:
        verdict = "Butuh edge/DC node"
    elif skipped:
        verdict = "Perlu query param"
    else:
        verdict = "Hanya endpoint berparameter"
    return {
        "verdict": verdict,
        "items_total": total_items if answered else "",
        "reads": len(gets),
        "writes": len(rows) - len(gets),
        "failing": failing,
        "skipped": skipped,
        "detail": detail,
        "unrouted": unknown,
    }


def build_summary(tables, endpoints, pages, manifest, migrated, args, started):
    def count(items, key, value):
        return sum(1 for i in items if i.get(key) == value)
    filled = [t for t in tables if t["rows"]]
    rows = [
        ("Dibuat", started.strftime("%Y-%m-%d %H:%M UTC")),
        ("Database", redact(args.database_url or "(tidak dicek)")),
        ("API", args.api_base or "(tidak dicek)"),
        ("Manifest", f'{manifest["generated_at"]} @ {manifest.get("git_commit", "")}'),
        ("Migrasi terakhir di DB", migrated or "-"),
        ("Tabel", len(tables)),
        ("Tabel berisi data", len(filled)),
        ("Tabel kosong", len(tables) - len(filled)),
        ("Total baris", sum(t["rows"] for t in tables)),
        ("Halaman hub", len(pages)),
    ]
    for v in ["Ada data", "Sebagian kosong", "Kosong", "Error", "Belum konek backend (statis/mock)",
              "Butuh edge/DC node", "Perlu query param", "Hanya endpoint berparameter",
              "Placeholder (belum dibuat)", "Tidak dicek"]:
        n = count(pages, "verdict", v)
        if n:
            rows.append((f"Halaman: {v}", n))
    rows.append(("Endpoint (semua method)", len(endpoints)))
    for v in ["Ada data", "Kosong", "Perlu query param", "Bukan GET", "404 (build lama?)",
              "Butuh login", "Butuh sesi member", "Gagal konek"]:
        n = count(endpoints, "verdict", v)
        if n:
            rows.append((f"Endpoint GET: {v}", n))
    errs = sum(1 for e in endpoints if str(e["verdict"]).startswith("Error"))
    if errs:
        rows.append(("Endpoint GET: Error 4xx/5xx", errs))
    return rows


def redact(url: str) -> str:
    return re.sub(r"//([^:/@]+):[^@]+@", r"//\1:***@", url)


# ────────────────────────────────────────────────────────────────── xlsx ──
# A few sheets of plain cells is all this needs, so it is written by hand
# rather than asking the server for openpyxl.

STYLE_OF_VERDICT = {
    "Ada data": 2, "Sebagian kosong": 3, "Kosong": 3, "Perlu query param": 5, "Bukan GET": 5,
    "Butuh sesi member": 5, "Hanya endpoint berparameter": 5, "Error": 4, "Gagal konek": 4, "404 (build lama?)": 4,
    "Butuh login": 3, "Belum konek backend (statis/mock)": 5, "Placeholder (belum dibuat)": 5,
    "Butuh edge/DC node": 5, "Edge/DC node": 5,
}


def col_name(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def cell_xml(ref: str, value, style: int = 0) -> str:
    s = f' s="{style}"' if style else ""
    if value is None or value == "":
        return f'<c r="{ref}"{s}/>' if style else ""
    if isinstance(value, bool):
        value = "ya" if value else ""
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"{s}><v>{value}</v></c>'
    if isinstance(value, (list, tuple)):
        value = "\n".join(map(str, value))
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(value))[:32000]
    return f'<c r="{ref}"{s} t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def sheet_xml(header: list[str], rows: list[list], widths: list[int], verdict_col: int | None) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
           '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" '
           'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>']
    for i, w in enumerate(widths):
        out.append(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>')
    out.append("</cols><sheetData>")
    out.append('<row r="1">' + "".join(cell_xml(f"{col_name(i)}1", h, 1) for i, h in enumerate(header)) + "</row>")
    for r, row in enumerate(rows, start=2):
        style = 0
        if verdict_col is not None:
            v = str(row[verdict_col])
            style = 4 if v.startswith("Error") else STYLE_OF_VERDICT.get(v, 0)
        out.append(f'<row r="{r}">' + "".join(
            cell_xml(f"{col_name(i)}{r}", v, style if i == verdict_col else 6)
            for i, v in enumerate(row)) + "</row>")
    out.append("</sheetData>")
    if rows:
        out.append(f'<autoFilter ref="A1:{col_name(len(header)-1)}{len(rows)+1}"/>')
    out.append("</worksheet>")
    return "".join(out)


STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD7F2DE"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1C7"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF9D6D5"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE9E9E9"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="7"><xf/>
<xf fontId="1" fillId="2" applyFont="1" applyFill="1"/>
<xf fillId="3" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf fillId="4" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf fillId="5" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf fillId="6" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"""


def write_xlsx(out: Path, summary, tables, pages, endpoints) -> None:
    sheets = [
        ("Ringkasan", ["Hal", "Nilai"], [list(r) for r in summary], [34, 70], None),
        ("Halaman", ["Modul", "Path", "Label", "Tersembunyi", "Status", "Jumlah item",
                     "Endpoint baca (jumlah item)", "Gagal", "Tidak bisa dicek otomatis", "Edge/DC", "Tulis",
                     "Screen file"],
         [[p["module"], p["path"], p["label"], p["hidden"], p["verdict"], p["items_total"],
           p["detail"], p["failing"], p["skipped"], p["edge"], p["writes"], p.get("screen") or ""]
          for p in pages],
         [16, 38, 26, 11, 30, 12, 60, 45, 45, 30, 7, 40], 4),
        ("Tabel", ["Tabel", "Domain", "Baris", "Kolom", "Ukuran (KB)", "Data terakhir", "Kolom waktu",
                   "Migrasi", "Dipakai di backend", "Keterangan"],
         [[t["table"], t["domain"], t["rows"], t["columns"], round(t["size_bytes"] / 1024),
           t["latest"], t["latest_column"], t["migration"], t["backend_files"], t["comment"]]
          for t in sorted(tables, key=lambda t: (t["domain"], t["table"]))],
         [44, 18, 11, 8, 12, 20, 13, 52, 50, 60], None),
        ("Endpoint", ["Method", "Path", "Node", "Status", "HTTP", "Item", "Bentuk", "ms",
                      "Dipakai halaman", "Handler", "File", "Catatan"],
         [[e["method"], e["path"], e["node"], e["verdict"], e["status"], e["items"], e["shape"],
           e["ms"], e["pages"], e["handler"], e["file"], e["note"]] for e in endpoints],
         [8, 52, 7, 22, 6, 8, 22, 7, 40, 34, 30, 50], 3),
    ]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(len(sheets))) + "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   "</Relationships>")
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{name}" sheetId="{i+1}" r:id="rId{i+1}"/>'
                             for i, (name, *_rest) in enumerate(sheets))
                   + "</sheets>"
                   + "<definedNames>" + "".join(
                       f'<definedName name="_xlnm._FilterDatabase" localSheetId="{i}" hidden="1">'
                       f"'{name}'!$A$1:${col_name(len(h)-1)}${len(r)+1}</definedName>"
                       for i, (name, h, r, *_x) in enumerate(sheets) if r)
                   + "</definedNames></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i+1}.xml"/>'
                             for i in range(len(sheets)))
                   + f'<Relationship Id="rId{len(sheets)+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   "</Relationships>")
        z.writestr("xl/styles.xml", STYLES)
        for i, (name, header, rows, widths, vcol) in enumerate(sheets):
            z.writestr(f"xl/worksheets/sheet{i+1}.xml", sheet_xml(header, rows, widths, vcol))


# ─────────────────────────────────────────────────────────────────── main ──

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("manifest", help="scan the repo into a manifest (needs the source)")
    m.add_argument("--out", default=str(DEFAULT_MANIFEST))
    m.set_defaults(func=cmd_manifest)

    r = sub.add_parser("report", help="count rows, probe endpoints, write the sheet")
    r.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    r.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    r.add_argument("--api-base", default=os.environ.get("ITULAH_API_BASE"),
                   help="e.g. http://127.0.0.1:8080 or https://itulah-cloud.onrender.com")
    r.add_argument("--token", help="Bearer token (or ITULAH_TOKEN)")
    r.add_argument("--cookie", help="raw Cookie header (or ITULAH_COOKIE)")
    r.add_argument("--user", help="log in first as this user; password from ITULAH_PASSWORD")
    r.add_argument("--estimate", action="store_true",
                   help="use planner row estimates instead of count(*) — for very large tables")
    r.add_argument("--timeout", type=float, default=20)
    r.add_argument("--workers", type=int, default=6)
    r.add_argument("--skip", default=r"/(events|stream|export|download)(/|$)|\.csv$|\.pdf$",
                   help="regex of GET paths never to call")
    r.add_argument("--out", help="xlsx path (default data-inventory-<time>.xlsx)")
    r.set_defaults(func=cmd_report)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
