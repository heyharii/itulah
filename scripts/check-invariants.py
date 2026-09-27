#!/usr/bin/env python3
"""Run the consistency catalogue against a database, and say what is broken.

    python3 scripts/check-invariants.py --db postgresql:///inventory_e2e
    python3 scripts/check-invariants.py --db "$DATABASE_URL" --json out.json
    python3 scripts/check-invariants.py --db postgresql:///scratch --mutation-check

WHAT THE CATALOGUE IS. `backend/invariants/**/*.sql`, one rule per file. Each
file is a SELECT that returns the rows breaking the rule — so a healthy database
returns nothing, and whatever comes back IS the finding, already pointing at the
rows. The header says what the rule is and where it is enforced; see
`backend/invariants/README.md` and `CONSISTENCY-MATRIX.md`.

SAFE ON PRODUCTION. Every check runs in a session with
`default_transaction_read_only=on` and a statement timeout, so a check that was
written wrong fails instead of writing. Nothing here needs more than SELECT.

WHY A MUTATION CHECK. A check that cannot go red is worse than no check,
because it is trusted. `--mutation-check` takes each rule's `-- mutate:` line,
runs it inside a transaction with triggers disabled (the corruption a hand-edit,
a buggy migration or a second writer would make), runs the check, expects it to
find something, and ROLLS BACK. It never commits. It still writes, so it refuses
any database that is not on this machine.

A rule whose tables do not exist is SKIPPED, not failed: databases on this
machine sit at many migration levels, and a rule about giro is not a finding on
a database from before giro existed. `backend/tests/invariant_catalogue.rs`
is what guarantees every rule still parses against the CURRENT schema.

Needs only Python 3.9+ and `psql` on the PATH.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
CATALOGUE = REPO / "backend" / "invariants"
SEVERITIES = ("critical", "high", "medium", "low")
SAMPLE = 5


@dataclass
class Rule:
    id: str
    path: Path
    severity: str
    rule: str
    enforced: str
    requires: list[str]
    mutate: list[str]
    sql: str
    notes: list[str] = field(default_factory=list)


def parse(path: Path) -> Rule:
    text = path.read_text()
    meta: dict[str, list[str]] = {}
    body: list[str] = []
    in_header = True
    for line in text.splitlines():
        m = re.match(r"^--\s*([a-z_]+):\s?(.*)$", line) if in_header else None
        if m:
            meta.setdefault(m.group(1), []).append(m.group(2).strip())
            continue
        if in_header and (line.startswith("--") or not line.strip()):
            continue
        in_header = False
        body.append(line)
    sql = "\n".join(body).strip().rstrip(";").strip()
    rid = (meta.get("id") or [""])[0]
    severity = (meta.get("severity") or [""])[0]
    if not rid or not sql:
        raise SystemExit(f"{path}: needs an `-- id:` header and a query")
    if severity not in SEVERITIES:
        raise SystemExit(f"{path}: severity must be one of {SEVERITIES}, not {severity!r}")
    requires = [t.strip() for r in meta.get("requires", []) for t in r.split(",") if t.strip()]
    return Rule(
        id=rid,
        path=path,
        severity=severity,
        rule=" ".join(meta.get("rule", [])),
        enforced=" ".join(meta.get("enforced", [])),
        requires=requires,
        mutate=meta.get("mutate", []),
        sql=sql,
    )


def load(only: str | None) -> list[Rule]:
    rules = [parse(p) for p in sorted(CATALOGUE.rglob("*.sql"))]
    seen: dict[str, Path] = {}
    for r in rules:
        if r.id in seen:
            raise SystemExit(f"duplicate id {r.id}: {seen[r.id]} and {r.path}")
        seen[r.id] = r.path
    if only:
        rules = [r for r in rules if re.search(only, r.id)]
    return rules


class Psql:
    def __init__(self, db: str, read_only: bool, timeout_s: int):
        self.db = db
        opts = [f"-c statement_timeout={timeout_s * 1000}"]
        if read_only:
            opts.append("-c default_transaction_read_only=on")
        self.env = {**os.environ, "PGOPTIONS": " ".join(opts), "PGAPPNAME": "check-invariants"}

    def run(self, sql: str) -> str:
        res = subprocess.run(
            ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", self.db],
            input=sql, capture_output=True, text=True, env=self.env,
        )
        if res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or f"psql exited {res.returncode}")
        return res.stdout


def check_sql(rule: Rule) -> str:
    # Count and sample in ONE statement, so both see the same snapshot.
    return (
        "SELECT json_build_object('n', count(*), 'sample', "
        f"(array_agg(row_to_json(v)))[1:{SAMPLE}]) FROM (\n{rule.sql}\n) v;\n"
    )


def missing_tables(psql: Psql, tables: list[str]) -> list[str]:
    if not tables:
        return []
    probe = ", ".join(f"to_regclass('{t}') IS NULL" for t in tables)
    flags = psql.run(f"SELECT concat_ws(',', {probe});").strip().split(",")
    return [t for t, f in zip(tables, flags) if f == "t"]


def is_local(db: str) -> bool:
    if "://" not in db:
        return "host=" not in db or re.search(r"host=(localhost|127\.0\.0\.1|/)", db) is not None
    host = urlparse(db).hostname
    return host in (None, "", "localhost", "127.0.0.1", "::1")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=os.environ.get("DATABASE_URL"), help="database URL or name (default $DATABASE_URL)")
    ap.add_argument("--only", help="regex on rule ids")
    ap.add_argument("--json", type=Path, help="write the full result here")
    ap.add_argument("--fail-on", default="high", choices=SEVERITIES,
                    help="exit 1 if a rule at this severity or worse finds rows (default high)")
    ap.add_argument("--timeout", type=int, default=120, help="seconds per check")
    ap.add_argument("--mutation-check", action="store_true",
                    help="prove each check can go red (local databases only; always rolled back)")
    args = ap.parse_args()
    if not args.db:
        ap.error("--db or DATABASE_URL is required")

    rules = load(args.only)
    if args.mutation_check:
        if not is_local(args.db):
            ap.error("--mutation-check writes (and rolls back); it refuses a database that is not local")
        return mutation_check(args, rules)

    psql = Psql(args.db, read_only=True, timeout_s=args.timeout)
    results = []
    worst = SEVERITIES.index(args.fail_on)
    failed = False
    width = max(len(r.id) for r in rules) if rules else 10
    for rule in rules:
        started = time.monotonic()
        entry = {"id": rule.id, "severity": rule.severity, "rule": rule.rule, "enforced": rule.enforced,
                 "file": str(rule.path.relative_to(REPO))}
        try:
            gone = missing_tables(psql, rule.requires)
            if gone:
                entry.update(status="skip", reason="missing " + ", ".join(gone))
            else:
                out = json.loads(psql.run(check_sql(rule)).strip())
                entry.update(status="fail" if out["n"] else "pass", violations=out["n"],
                             sample=out["sample"] or [])
        except RuntimeError as error:
            entry.update(status="error", reason=str(error).splitlines()[0])
        entry["ms"] = round((time.monotonic() - started) * 1000)
        results.append(entry)
        if entry["status"] in ("fail", "error") and SEVERITIES.index(rule.severity) <= worst:
            failed = True
        print(line(entry, width))
        if entry["status"] == "fail":
            for row in entry["sample"]:
                print(f"      {json.dumps(row, default=str)[:220]}")

    summary = {s: sum(1 for r in results if r["status"] == s) for s in ("pass", "fail", "skip", "error")}
    print(f"\n{summary['pass']} pass · {summary['fail']} fail · {summary['error']} error · {summary['skip']} skipped"
          f" — {len(results)} rules, database {redact(args.db)}")
    if args.json:
        args.json.write_text(json.dumps({"database": redact(args.db), "summary": summary, "results": results},
                                        indent=2, default=str))
    return 1 if failed else 0


def mutation_check(args, rules: list[Rule]) -> int:
    psql = Psql(args.db, read_only=False, timeout_s=args.timeout)
    width = max(len(r.id) for r in rules) if rules else 10
    blind = 0
    for rule in rules:
        if not rule.mutate:
            print(f"  {'·':<5} {rule.id:<{width}}  no mutate line")
            continue
        gone = missing_tables(psql, rule.requires)
        if gone:
            print(f"  {'skip':<5} {rule.id:<{width}}  missing {', '.join(gone)}")
            continue
        # The findings are fingerprinted before and after, inside the same
        # transaction. A database that already has findings proves nothing by
        # having them — only by the findings CHANGING once it is corrupted, which
        # also covers corrupting a row that was already wrong.
        #
        # The `_touched` sentinel tells "the corruption touched nothing" (an
        # empty table) apart from "the corruption landed and the check did not
        # see it".
        script = (
            "BEGIN;\n"
            f"SELECT 'before ' || {fingerprint(rule)};\n"
            "SET LOCAL session_replication_role = replica;\n"
            "CREATE TEMP TABLE _touched(n int) ON COMMIT DROP;\n"
            + "".join(f"WITH m AS ({m} RETURNING 1) INSERT INTO _touched SELECT count(*) FROM m;\n"
                      for m in rule.mutate)
            + f"SELECT 'after ' || (SELECT coalesce(sum(n), 0) FROM _touched) || ' ' || {fingerprint(rule)};\n"
            "ROLLBACK;\n"
        )
        try:
            out = psql.run(script).split()
            before_n, before_digest = out[out.index("before") + 1: out.index("before") + 3]
            touched, after_n, after_digest = out[out.index("after") + 1: out.index("after") + 4]
        except (RuntimeError, ValueError) as error:
            print(f"  {'ERROR':<5} {rule.id:<{width}}  {str(error).splitlines()[0][:160]}")
            blind += 1
            continue
        if touched == "0":
            print(f"  {'skip':<5} {rule.id:<{width}}  nothing to corrupt (empty table)")
        elif after_digest == before_digest:
            print(f"  {'BLIND':<5} {rule.id:<{width}}  corrupted {touched} row(s) and the findings did not change"
                  f" ({before_n} before and after)")
            blind += 1
        else:
            print(f"  {'red':<5} {rule.id:<{width}}  corrupted {touched} → findings {before_n} became {after_n}")
    print(f"\n{blind} check(s) could not go red" if blind else "\nevery exercised check goes red when it should")
    return 1 if blind else 0


def fingerprint(rule: Rule) -> str:
    """`<count> <md5 of the sorted findings>` as one SQL expression."""
    return ("(SELECT count(*) || ' ' || md5(coalesce(string_agg(r, '|' ORDER BY r), '')) "
            f"FROM (SELECT row_to_json(v)::text AS r FROM (\n{rule.sql}\n) v) f)")


def line(entry: dict, width: int) -> str:
    status = entry["status"]
    mark = {"pass": "ok", "fail": "FAIL", "skip": "skip", "error": "ERROR"}[status]
    tail = {"pass": "", "fail": f"{entry.get('violations')} row(s)",
            "skip": entry.get("reason", ""), "error": entry.get("reason", "")[:160]}[status]
    return f"  {mark:<5} {entry['severity']:<8} {entry['id']:<{width}}  {tail}  ({entry['ms']} ms)"


def redact(db: str) -> str:
    return re.sub(r"//([^:/@]+):[^@]+@", r"//\1:***@", db)


if __name__ == "__main__":
    sys.exit(main())
