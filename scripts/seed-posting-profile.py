#!/usr/bin/env python3
"""Seed `ledger_account`'s posting policy from the COA 162 workbook.

    python3 scripts/seed-posting-profile.py --xlsx ~/Downloads/Retail_OS_COA_v1_162_Merged_Master.xlsx --dry-run
    python3 scripts/seed-posting-profile.py --xlsx ... | psql -d inventory_edge_dev

Same shape as `import-coa.py`: the report goes to stderr, the SQL to stdout, so a
dry run is the run with stdout discarded. Read the report first — it names every
judgement the script had to make, and every part of the workbook it refused to
act on.

# The bridge, and why it runs this way round

The workbook proposes a 162-account chart with codes of its own (`1101001 CASH ON
HAND`). The backend keeps the CLIENT's codes (`1011001001`), and the owner's
instruction is not to renumber to the workbook's. So the policy travels:

    162 code  ->  legacy rows that map to it  ->  the account, unit suffix off

Stripping the suffix is the collapse 0243/0244 performed: the unit left the code
and moved to `journal_line.site_id`, so `1011001001` is the account and `…01` was
the unit. It comes off only where there IS one — a 12-digit code carries a unit,
a shorter one does not.

Which legacy rows count is decided by `Perlakuan` and not by the rung. Reading
only 12-digit leaves loses four accounts the client posts to directly higher up:
three Time Deposits at ten characters, and `205001 Uang Muka - Penjualan` at six
— the six-digit posting account 0254 restored, whose `205`, `2050` and `20500` do
not exist in the client's export at all. This chart sits off its own ladder in
places, and "Gabung / petakan ke akun baru" is the sheet saying a row carries a
balance somewhere.

Measured on the 2026-09-16 workbook: **156 of 162** codes reach an account and
**403** ten-digit codes are addressed — which is NOT a count of accounts. The
client's legacy chart had 496 ten-digit accounts; ours keeps 302 rows, of which
181 are postable. So a large share of the 403 match no row and their UPDATE is a
no-op: 168 of the 181 postable accounts are reached, 13 are not, and the 121
headings are untouched because nothing posts to a heading anyway.

NO account receives contradictory policy from two 162 codes. If that stops being
true the script refuses rather than picking, and the report says which accounts.

# What this script will not do

**`account_source_rule` is left almost empty.** The workbook's `Source Document`
column is prose naming ERPNext documents — "Purchase Invoice / Expense Entry /
Payment Entry" — and the backend's `source_kind` is a closed 35-value vocabulary
guarded by a CHECK. Translating one to the other is a policy decision per
phrase, not a string operation, and an allow-list seeded from a guess would
refuse real postings for reasons nobody chose. The report prints the phrases so
somebody can decide; until then every account's allow-list is empty, which the
table defines as "any source may post".

**`Department` and `Legal Entity` are ignored.** 41 accounts ask for a
Department dimension and 2 for a Legal Entity. The owner's ruling is that
neither becomes a journal dimension. They are counted in the report and
otherwise dropped.

**`requires_counterparty` is reported, never written.** 0243 set it on exactly
three accounts. The workbook asks for seven. That is a disagreement about which
accounts are two-sided, and it is the chart's business rather than this
script's.

# The five Posting Mode values, mapped onto three

The workbook uses `SEMI_AUTO`, `AUTO_ONLY`, `MANUAL_APPROVED`, `RESTRICTED` and
`SYSTEM_ONLY`; the column allows `AUTO_ONLY`, `SEMI_AUTO`, `MANUAL`. The mapping
is below and it adds no meaning the workbook did not already carry:

    SEMI_AUTO       -> SEMI_AUTO
    AUTO_ONLY       -> AUTO_ONLY
    SYSTEM_ONLY     -> AUTO_ONLY    only the system, which is what AUTO_ONLY says
    RESTRICTED      -> BLOCKED      NOT AUTO_ONLY: the policy is undecided, and
                                    AUTO_ONLY would say "a rule may" (0263)
    MANUAL_APPROVED -> MANUAL       and its `Manual JE` already says OVERRIDE,
                                    which is where "approved" is expressed

Note the workbook never says plain `MANUAL`. `MANUAL` is the column's DEFAULT —
what an unseeded account has — so an account this script does not reach keeps
refusing nothing.
"""

import argparse
import sys
from collections import defaultdict

MODE = {
    "SEMI_AUTO": "SEMI_AUTO",
    "AUTO_ONLY": "AUTO_ONLY",
    # Only the system, which is what AUTO_ONLY already says. `3101002 Laba
    # (Rugi) Ditahan` is the one account that carries it: the close writes
    # retained earnings and a person must not.
    "SYSTEM_ONLY": "AUTO_ONLY",
    # NOT AUTO_ONLY. RESTRICTED means the policy is undecided, and AUTO_ONLY
    # would say "a rule may" — the opposite. 0263 added BLOCKED for exactly
    # this, and `1202691 Reserve Replacement Operating Equipment` is why.
    "RESTRICTED": "BLOCKED",
    "MANUAL_APPROVED": "MANUAL",
}
# A status that overrides whatever Posting Mode says, for the same reason: an
# account whose policy is pending may not be posted to by anything.
BLOCKING_STATUS = ("PENDING POLICY",)
POLICY = {"NO", "OVERRIDE", "YES"}

# Accounts the workbook's `Mapping Legacy` sheet never targets, and that
# therefore look new — and are not. Checked against the client's own export
# (`Laporan_Master_Account1.csv`) account by account. "No bridge target" is a gap
# in the workbook's mapping sheet, not evidence that an account is new.
#
#   COA-162   client legacy                                        ours
SEMANTIC_BRIDGE = {
    # `1011302001 Prepaid - PPh Pasal 21` — one of six prepaid-tax leaves the
    # client keeps; all six are rows here.
    "1105101": "1011302001",
    # `1021607*` — 36 leaves in the client's export, one per equipment class.
    # 0244's curation kept `…001` (Rak 1).
    "1202691": "1021607001",
    # `1031803001 Contract In Progress (CIP)` — one leaf, and it is a row here.
    "1202901": "1031803001",
    # `2012303*` — 14 unit leaves in the export; ours keeps HEAD OFFICE.
    "2105003": "2012303001",
    # `7010215*` — 36 leaves, the expense side of the reserve. Ours keeps Rack 1.
    "7103001": "7010215001",
    # Added by 0265, because the client's tax-payable family has no PPh 29 leaf
    # and their asset side does. `2012101006` is the next free code on their own
    # ladder, so the workbook's policy can travel to it like any other.
    "2103006": "2012101006",
}
# And the one that really is new. The client's `2012101*` family carries PPh 21,
# PPh 23, VAT out, PBB and PPh 25 — and NO PPh 29 payable, although they do keep
# `1011302003 Prepaid - PPh Pasal 29` on the asset side. So the obligation has a
# prepayment and nowhere to be owed. Reported, never invented.
# Nothing left here: `2103006` was the last one, and 0265 added the account it
# needed. Kept as a named, empty table so the next genuinely-new account has an
# obvious place to be declared instead of being quietly bridged to a near miss.
NEEDS_A_NEW_ACCOUNT: dict[str, str] = {}

# Accounts the owner decided directly, in migration 0267. The workbook does NOT
# override these — its `Posting Mode` / `Manual JE` for three of them is
# `MANUAL` / `YES`, which is the permissive default, and letting a spreadsheet
# widen a decision somebody made on purpose is the wrong precedence.
#
# Each is here because the workbook files it as `Hierarki — cek posting aktual`
# with no target, i.e. it never had an opinion worth deferring to.
OWNER_DECIDED = {
    "1011302003": "migration only (0267)",
    "3013001001": "manual-approved: paid-in capital (0267)",
    "3013001003": "system only: generated result (0267)",
    "3013001004": "manual-approved: owner drawings (0267)",
    "6010310018": "its family's policy; merge question open on evidence (0267)",
    "7010216002": "system only, from the pre-opening schedule (0267)",
    "8010110007": "manual-approved; never the suspense plug (0267)",
}

# Where "pending policy" is ONE PATH and not the whole account.
#
# The replacement reserve may be drawn down — the owner called that known — and
# what CREATES the balance is undecided (0139). Blocking the account would stop
# the draw too, so the block is the formation's source kind and nothing else.
PENDING_PATHS = {
    "1202691": [
        ("ASSET_RESERVE", "formation undecided (0139); the draw-down is approved"),
    ],
}
# Dimensions the owner ruled out. Named so the report can count them rather than
# letting them pass unremarked.
IGNORED_DIMENSIONS = ("Department", "Legal Entity")


def sql_str(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def sheet(wb, name):
    ws = wb[name]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    head = None
    for i, r in enumerate(rows):
        if sum(1 for c in r if c not in (None, "")) >= 3:
            head = i
            break
    hdr = [str(c).strip() if c else "" for c in rows[head]]
    out = []
    for r in rows[head + 1 :]:
        if not any(c not in (None, "") for c in r):
            continue
        out.append({hdr[i]: (r[i] if i < len(r) else None) for i in range(len(hdr))})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl is required: python3 -m pip install openpyxl")

    wb = openpyxl.load_workbook(args.xlsx, data_only=True, read_only=True)
    cfg = {
        str(r["Kode Usulan"]).strip(): r
        for r in sheet(wb, "COA 162 Config")
        if r.get("Kode Usulan")
    }
    legacy = sheet(wb, "Mapping Legacy")

    # 162 code -> the accounts it governs.
    #
    # Keyed on `Perlakuan` and NOT on the rung. A first cut read only 12-digit
    # leaves and lost four accounts the client posts to directly at another rung:
    # three Time Deposits at ten characters and `205001 Uang Muka - Penjualan` at
    # six — the six-digit posting account 0254 restored, whose `205`, `2050` and
    # `20500` do not exist in the client's export at all. The ladder is not a
    # reliable test of postability in this chart, and "Gabung / petakan ke akun
    # baru" is: it is the sheet saying this row carries a balance somewhere.
    #
    # The unit suffix comes off only where there is one. A 12-digit code is a
    # ten-digit account plus two digits of unit; shorter codes carry no unit.
    governs = defaultdict(set)
    off_ladder = []
    for target, account in SEMANTIC_BRIDGE.items():
        governs[target].add(account)
    for r in legacy:
        code = str(r.get("Kode legacy") or "").strip()
        target = str(r.get("Kode target") or "").strip()
        treatment = str(r.get("Perlakuan") or "").strip()
        if not target or target.lower() == "none":
            continue
        if not treatment.startswith("Gabung") and not treatment.startswith("Map ke"):
            continue
        account = code[:10] if len(code) == 12 else code
        governs[target].add(account)
        if len(code) != 12:
            off_ladder.append((code, target))

    out = sys.stderr
    print(f"162 codes configured      {len(cfg)}", file=out)

    # One account, one policy. Two 162 codes disagreeing about an account is a
    # thing to report and refuse, never to resolve by picking.
    policy_of = {}
    conflicts = defaultdict(set)
    unmapped_modes = defaultdict(list)
    blocked_by_status = []
    path_not_account = []
    owner_kept = []
    bridged = 0
    for code, row in cfg.items():
        accounts = governs.get(code)
        if not accounts:
            continue
        bridged += 1
        raw_mode = str(row.get("Posting Mode") or "").strip().upper()
        raw_policy = str(row.get("Manual JE") or "").strip().upper()
        mode = MODE.get(raw_mode)
        if mode is None:
            unmapped_modes[raw_mode].append(code)
            continue
        raw_status = str(row.get("Status") or "").strip().upper()
        pending_path = code in PENDING_PATHS
        if any(b in raw_status for b in BLOCKING_STATUS) and not pending_path:
            mode = "BLOCKED"
            blocked_by_status.append(code)
        # An account whose pending-ness is ONE PATH must not end up BLOCKED, from
        # the status above OR from `MODE['RESTRICTED']`. BLOCKED is checked before
        # the source rules in the validator, so it would win and take the
        # approved path down with it — which is the thing the owner ruled against.
        # A rule may still post; a person may not; the undecided kind is refused
        # by its DENY row.
        if pending_path and mode == "BLOCKED":
            mode = "AUTO_ONLY"
            path_not_account.append(code)
        if raw_policy not in POLICY:
            unmapped_modes[f"Manual JE={raw_policy}"].append(code)
            continue
        for account in accounts:
            if account in OWNER_DECIDED:
                owner_kept.append(account)
                continue
            decided = (mode, raw_policy)
            if account in policy_of and policy_of[account] != decided:
                conflicts[account] |= {policy_of[account], decided}
            policy_of[account] = decided

    print(f"  reach an account        {bridged}", file=out)
    print(f"  reach nothing           {len(cfg) - bridged}", file=out)
    # Deliberately NOT called "accounts": these are the ten-digit codes the
    # bridge produces, and the client's legacy chart had 496 of them where ours
    # now keeps 302 rows. 0243/0244/0253/0254 collapsed, renamed and curated the
    # rest away, so a large share of these match no row and their UPDATE is a
    # no-op. How many is only knowable against a database — see the query this
    # script prints at the end of its SQL.
    print(f"ten-digit codes addressed {len(policy_of)}", file=out)
    if off_ladder:
        print(
            f"  of which off the 12-digit ladder: {len(off_ladder)}"
            f" ({', '.join(c for c, _ in sorted(off_ladder)[:6])})",
            file=out,
        )

    for account in sorted(set(owner_kept)):
        print(
            f"  {account}: left alone — {OWNER_DECIDED[account]}",
            file=out,
        )
    for code in sorted(path_not_account):
        print(
            f"  {code}: RESTRICTED/PENDING is ONE PATH, not the account — mode kept"
            " usable (AUTO_ONLY) and the undecided kind refused by a DENY rule",
            file=out,
        )
    if blocked_by_status:
        print(
            f"  BLOCKED by status on {len(blocked_by_status)} code(s):"
            f" {', '.join(sorted(blocked_by_status))} — policy undecided, nothing may post",
            file=out,
        )
    for raw, codes in sorted(unmapped_modes.items()):
        print(
            f"UNMAPPED VALUE {raw!r} on {len(codes)} code(s): {', '.join(sorted(codes)[:6])}"
            " — no SQL written for these",
            file=out,
        )

    if conflicts:
        print(f"\nREFUSING: {len(conflicts)} account(s) get two policies:", file=out)
        for account, seen in sorted(conflicts.items()):
            print(f"  {account}: {sorted(seen)}", file=out)
        sys.exit(
            "two 162 codes disagree about an account; decide which governs it "
            "before seeding"
        )

    # Everything the script deliberately did not act on.
    phrases = defaultdict(int)
    dims = defaultdict(int)
    counterparty = []
    for code, row in cfg.items():
        if not governs.get(code):
            continue
        phrases[str(row.get("Source Document") or "").strip()] += 1
        dim = str(row.get("Required Dimension") or "").strip()
        for ignored in IGNORED_DIMENSIONS:
            if ignored in dim:
                dims[ignored] += 1
        if "Counterparty Unit" in dim or "To Unit" in dim:
            counterparty.append(code)

    print(f"\nNOT ACTED ON", file=out)
    print(
        f"  account_source_rule left empty: {len(phrases)} distinct Source Document"
        " phrases need a source_kind decision each",
        file=out,
    )
    for phrase, n in sorted(phrases.items(), key=lambda kv: -kv[1])[:8]:
        print(f"      {n:3}  {phrase[:66]}", file=out)
    for ignored, n in sorted(dims.items()):
        print(f"  {ignored} dimension ignored on {n} code(s) — owner's ruling", file=out)
    print(
        f"  requires_counterparty: workbook asks for {len(counterparty)},"
        " 0243 set 3 — reported, not written",
        file=out,
    )

    for code, why in sorted(NEEDS_A_NEW_ACCOUNT.items()):
        print(f"  NEW ACCOUNT REQUIRED  {code}: {why}", file=out)
    for code, paths in sorted(PENDING_PATHS.items()):
        account = SEMANTIC_BRIDGE.get(code, "?")
        for kind, why in paths:
            print(
                f"  DENY {kind} on {account} (from {code}): {why}"
                " — the account stays usable",
                file=out,
            )

    if args.dry_run:
        print("\n(dry run: no SQL on stdout)", file=out)
        return

    # Grouped by decided policy so the output is a handful of statements rather
    # than four hundred, and so a reader can see the shape of the decision.
    by_policy = defaultdict(list)
    for account, decided in policy_of.items():
        by_policy[decided].append(account)
    print("BEGIN;")
    for (mode, policy), accounts in sorted(by_policy.items()):
        codes = ",".join(sql_str(a) for a in sorted(accounts))
        print(
            f"UPDATE ledger_account SET posting_mode={sql_str(mode)},"
            f" manual_je_policy={sql_str(policy)}"
            f" WHERE account_code IN ({codes});"
        )
    # The one path the owner has ruled on: refused by kind, not by account.
    for code, paths in sorted(PENDING_PATHS.items()):
        account = SEMANTIC_BRIDGE.get(code)
        if not account:
            continue
        for kind, why in paths:
            print(
                "INSERT INTO account_source_rule"
                " (account_code, source_kind, effect, set_by, note) VALUES ("
                f"{sql_str(account)},{sql_str(kind)},'DENY','coa162-seed',"
                f"{sql_str(why)}) ON CONFLICT (account_code, source_kind) DO NOTHING;"
            )
    print("COMMIT;")
    # What actually landed. Printed as SQL rather than asserted in Python
    # because this script never opens a connection: the operator pipes it, and
    # this is how they see whether the codes above were rows.
    print(
        "-- verification: how many rows the policy above actually reached\n"
        "SELECT posting_mode, manual_je_policy, count(*)\n"
        "  FROM ledger_account WHERE NOT is_group GROUP BY 1, 2 ORDER BY 3 DESC;\n"
        "\n"
        "-- Every postable account still on the permissive default. These are NOT\n"
        "-- decided: the workbook files each of them as `Hierarki — cek posting\n"
        "-- aktual` with no target, which is the sheet saying somebody has to look.\n"
        "-- Permissive is acceptable while migrating and is not a final policy\n"
        "-- state, so this query is printed every run rather than left to be\n"
        "-- remembered.\n"
        "SELECT account_code, name\n"
        "  FROM ledger_account\n"
        " WHERE NOT is_group AND posting_mode = 'MANUAL' AND manual_je_policy = 'YES'\n"
        " ORDER BY account_code;"
    )


if __name__ == "__main__":
    main()
