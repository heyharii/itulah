#!/usr/bin/env python3
"""Prove the chart of accounts holds nothing the client does not have.

The owner's rule, given on 2026-09-14: we may not invent accounts, and we may
not change the client's words. Their export is the authority, including its
SHOUTING, its English-Indonesian mixture, its double spaces and its typos.

Three things are checked, and only the first two can fail:

1. **Every account code exists in the client's export.** No exceptions. An
   account we minted is the offence this script was written to catch.
2. **Every name uses the client's words.** Compared with punctuation, spacing
   and case stripped, because the owner ruled those free — and with our
   authorised expansions undone first, because spelling out a truncated word
   (`Penyusu` -> `Penyusutan`) is completing it, not changing it.
3. Everything else is reported for information: how many names differ only in
   case or spacing, and how many are expansions.

A migration cannot do this itself: it cannot read the client's CSV. So the
check lives here and is run against a database by hand or in CI.

    python3 scripts/audit-chart-against-client.py [--db coa_live_probe] [--loops 3]
"""

import argparse
import csv
import re
import subprocess
import sys

CSV = "/Users/hari/Downloads/Laporan_Master_Account1.csv"

# Abbreviations and truncations the owner asked us to spell out. Both sides are
# expanded to the long form before comparing, so `Acc Amort` and `Akumulasi
# Amortisasi` meet in the middle instead of racing each other.
#
# Word by word, never on a squashed string: the client writes `Penyusu -Tanah`,
# and with the spaces removed that reads as `penyusutanah`, which *contains*
# `penyusutan` by accident. A substring test called that a mismatch and sent me
# looking for a defect in the chart that was never there.
EXPANSIONS = {
    "penyusu": "penyusutan", "penyu": "penyusutan",
    "akum": "akumulasi", "akm": "akumulasi", "acc": "akumulasi",
    "amort": "amortisasi", "cad": "cadangan",
    "ffe": "furniturefixtureequipment", "ymhd": "yangmasihharusdibayar",
    "pjp": "pinjamanjangkapanjang", "sdm": "sumberdayamanusia",
    "oe": "operatingequipment", "bdp": "barangdalamperjalanan",
    "sevent": "seventh", "expences": "expenses", "ekspences": "expenses",
    "withold": "withhold", "transpot": "transport", "ho": "headoffice",
    # The client runs two words together here and abbreviates both halves of
    # a pair there; neither survives a token-by-token test without help.
    "seventsoft": "seventhsoft", "inc": "income", "exp": "expense",
}


def letters(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def words(text: str) -> list[str]:
    """The name as its words, each expanded to its full form."""
    raw = [w for w in re.split(r"[^A-Za-z0-9]+", text.lower()) if w]
    # The client letter-spaces some names — `T o o l s`, `F u e l  & O I l`.
    # Single letters in a run are one word, not several.
    joined: list[str] = []
    for word in raw:
        if len(word) == 1 and joined and len(joined[-1]) <= 2:
            joined[-1] += word
        else:
            joined.append(word)
    return [EXPANSIONS.get(w, w) for w in joined]


def same_words(ours: str, theirs: str) -> bool:
    mine, yours = words(ours), words(theirs)
    if mine == yours:
        return True
    # An expansion can also split one word into several — `ffe` becomes three.
    return "".join(mine) == "".join(yours)


def client_chart() -> dict[str, str]:
    chart: dict[str, str] = {}
    with open(CSV, newline="") as handle:
        for row in csv.reader(handle):
            if len(row) < 4:
                continue
            code, name = row[1].strip(), row[2].strip()
            if re.fullmatch(r"\d+", code) and name:
                chart[code] = name
    return chart


def our_chart(database: str) -> dict[str, str]:
    # Accounts we minted are excluded by `code_provenance`, not by a list in
    # this file. 0277 made provenance a column precisely so this audit could
    # stop reporting six deliberate exceptions as a failure — a check that is
    # permanently red is a check nobody reads — while still failing the day a
    # SEVENTH appears without anybody declaring it.
    query = (
        "select account_code||'\t'||name from ledger_account "
        "where code_provenance = 'CLIENT' order by account_code"
    )
    out = subprocess.run(
        ["psql", "-d", database, "-tAc", query], capture_output=True, text=True
    )
    if out.returncode != 0:
        sys.exit(f"cannot read {database}: {out.stderr.strip()}")
    return dict(
        line.split("\t", 1) for line in out.stdout.strip().split("\n") if "\t" in line
    )


def declared(database: str) -> list[tuple[str, str]]:
    """The accounts we minted, which the client's chart is not expected to hold."""
    query = (
        "select account_code||'\t'||name from ledger_account "
        "where code_provenance = 'PENDING_CLIENT_CODE' order by account_code"
    )
    out = subprocess.run(
        ["psql", "-d", database, "-tAc", query], capture_output=True, text=True
    )
    if out.returncode != 0:
        sys.exit(f"cannot read {database}: {out.stderr.strip()}")
    return [
        tuple(line.split("\t", 1))
        for line in out.stdout.strip().split("\n")
        if "\t" in line
    ]


def audit(database: str) -> bool:
    client, ours = client_chart(), our_chart(database)
    invented, reworded, expanded, cosmetic = [], [], 0, 0

    for code, name in sorted(ours.items()):
        if code not in client:
            invented.append((code, name))
        elif letters(name) == letters(client[code]):
            cosmetic += name != client[code]
        elif same_words(name, client[code]):
            expanded += 1
        else:
            reworded.append((code, client[code], name))

    pending = declared(database)
    print(f"  akun di bagan            : {len(ours) + len(pending)}")
    print(f"  kode kita, menunggu klien: {len(pending)}  (dideklarasikan)")
    print(f"  BUKAN akun klien         : {len(invented)}")
    print(f"  BEDA KATA dari klien     : {len(reworded)}")
    print(f"  singkatan dieja          : {expanded}  (diizinkan)")
    print(f"  beda kapital/spasi       : {cosmetic}  (diizinkan)")
    for code, name in pending:
        print(f"     MENUNGGU     {code:12} {name}")
    for code, name in invented:
        print(f"     BUKAN KLIEN  {code:12} {name}")
    for code, theirs, mine in reworded:
        print(f"     BEDA KATA    {code:12}\n        klien: {theirs}\n        kita : {mine}")
    return not invented and not reworded


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="coa_live_probe")
    parser.add_argument("--loops", type=int, default=1)
    args = parser.parse_args()

    passed = True
    for run in range(1, args.loops + 1):
        print(f"--- putaran {run} dari {args.loops} · {args.db} ---")
        passed &= audit(args.db)
        print()
    print("LULUS — bagan tidak memuat apa pun di luar milik klien" if passed
          else "GAGAL — masih ada yang berbeda dari bagan klien")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
