#!/usr/bin/env python3
"""Collapse the client's 381 natural accounts onto the final chart.

Reads `COA_381_Owner_Domain.xlsx` (381 representative client codes, each with
the target it was collapsed to) and the live database (the 43-account chart,
the category library, the asset-class registry), decides every row's
destination under the four-layer model, and writes:

  /tmp/coa_final.tsv   the full 381-row decision table, for review
  /tmp/coa_final.sql   the migration that completes the legacy bridge

Destination kinds:
  ACCOUNT    the natural account IS one of the 43 (category only if it takes one)
  CATEGORY   account + line_category (the question the row carried)
  CLASS      the asset-class registry carries it (the thing the row carried)
  BANK       the bank-account register carries it (which bank, which kind)
  QUALIFIER  the inter-unit reason on 1501 carries it

Read-only against the database until the generated migration runs.
"""
import collections
import json
import re
import subprocess
import zipfile
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
XLSX = "/Users/hari/Downloads/COA_381_Owner_Domain.xlsx"
PG = "postgres://inventory:inventory@localhost:5432/inventory"


def psql_json(sql):
    out = subprocess.run(["psql", PG, "-t", "-A", "-c", sql],
                         capture_output=True, text=True, check=True).stdout.strip()
    return json.loads(out) if out else []


def norm(s):
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s.upper()).split())


def token_match(name, table):
    want = set(norm(name).split())
    best, best_n = None, 0
    for cand, code in table.items():
        n = len(want & set(norm(cand).split()))
        if n > best_n:
            best, best_n = code, n
    return best if best_n >= 2 else None


def read_xlsx():
    z = zipfile.ZipFile(XLSX)
    ss = ET.fromstring(z.read("xl/sharedStrings.xml"))
    strings = ["".join(t.text or "" for t in si.findall(".//m:t", NS))
               for si in ss.findall("m:si", NS)]
    sh = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for r in sh.findall(".//m:row", NS):
        cells = []
        for c in r.findall("m:c", NS):
            v = c.find("m:v", NS)
            val = v.text if v is not None else ""
            if c.get("t") == "s" and val:
                val = strings[int(val)]
            cells.append(val)
        rows.append(cells)
    return [r for r in rows[1:] if len(r) >= 6]


# The client's own seven-digit classes, for the categories our chart shares
# between several accounts (the expense family lives on 6101/6201/6301/6401).
PREFIX_ACCOUNT = {
    "6010110": "6101", "6010111": "6201", "6010210": "6201",
    "6010310": "6301", "6010410": "6301", "7010110": "6401",
    "7010210": "7101", "7010310": "6301", "8010110": "4301",
    "8020110": "8301", "8030110": "8201", "4010110": "4101",
    "4010210": "4201", "5010110": "5101", "2012201": "2301",
    "2012001": "2101", "1011301": "1401", "1011302": "1402",
    "1011303": "1403", "4010213": "4201", "4010214": "4202",
    "7020310": "8301",
}

EXPLICIT = {
    "CASH ON HAND": ("ACCOUNT", "1101", "PETTY" if "PETTY" in "" else None),
    "PETTY CASH": ("ACCOUNT", "1101", "PETTY"),
    "MODAL DISETOR": ("ACCOUNT", "3101", None),
    "PRIVE PENARIKAN PEMILIK": ("ACCOUNT", "3102", None),
    "SALDO LABA": ("ACCOUNT", "3201", None),
    "OUTSTANDING GIRO": ("ACCOUNT", "2103", None),
    "HUTANG SUPPLIERS BARANG DAGANGAN": ("ACCOUNT", "2101", None),
    "HUTANG SUPPLIER BARANG DAGANG SUSPEND": ("ACCOUNT", "2102", None),
    "HUTANG SUPPLIER NON BARANG DAGANG": ("ACCOUNT", "2101", None),
    "HUTANG LAIN LAIN": ("ACCOUNT", "2301", "ACCRUAL_OTHER"),
    "HUTANG PRINCIPAL PIHAK BERELASI": ("ACCOUNT", "2502", None),
    "PINJAMAN BANK": ("ACCOUNT", "2501", None),
    "PINJAMAN PRINCIPAL": ("ACCOUNT", "2502", None),
    "BEBAN BUNGA LEASING": ("ACCOUNT", "8101", None),
    "BEBAN BUNGA PINJAMAN BANK": ("ACCOUNT", "8101", None),
    "HARGA POKOK PEMBELIAN HPP": ("ACCOUNT", "5101", "COGS"),
    "PERSEDIAAN BARANG DAGANGAN": ("ACCOUNT", "1301", "MERCHANDISE"),
    "BARANG DAGANGAN DALAM PERJALANAN": ("ACCOUNT", "1302", "MERCHANDISE"),
    "PERSEDIAAN KANTONG BELANJA": ("ACCOUNT", "1301", "SHOPPING_BAG"),
    "KANTONG BELANJA DALAM PERJALANAN": ("ACCOUNT", "1302", "SHOPPING_BAG"),
    "CADANGAN KERUSAKAN KEHILANGAN PERSEDIAAN": ("ACCOUNT", "1309", None),
    "DISPOSED INVENTORY": ("ACCOUNT", "5102", "DISPOSED"),
    "PENDAPATAN LAIN LAIN": ("ACCOUNT", "4301", "INCOME_OTHER"),
    "PENDAPATAN SEWA": ("ACCOUNT", "4301", None),
    "PAJAK PENGHASILAN BEBAN PAJAK KINI": ("ACCOUNT", "8201", "TAX_OTHER"),
    "PIUTANG ACQUIRER KARTU": ("ACCOUNT", "1201", None),
    "CADANGAN PIUTANG ACQUIRER KARTU": ("ACCOUNT", "1209", None),
    "PIUTANG PEGAWAI DAN MANAJEMEN": ("ACCOUNT", "1202", None),
    "CADANGAN PIUTANG PEGAWAI": ("ACCOUNT", "1209", None),
    "SALDO AFFILIASI PEMBIAYAAN": ("QUALIFIER", "1501", "FINANCING"),
    "SALDO AFFILIASI ATAS BARANG": ("QUALIFIER", "1501", "GOODS"),
    "SALDO AFFILIASI LAIN LAIN": ("QUALIFIER", "1501", "INTERUNIT_OTHER"),
    "BANK GIRO": ("BANK", "1102", "GIRO"),
    "BANK TABUNGAN": ("BANK", "1102", "SAVINGS"),
    "DEPOSITO BERJANGKA": ("BANK", "1102", "TIME_DEPOSIT"),
    "BEBAN FUNERAL CONTRIBUTION": ("ACCOUNT", "6201", "FUNERAL_CONTRIBUTION"),
    "BEBAN KOMISI BONUS INSENTIF": ("ACCOUNT", "6201", "KOMISI_BONUS_INSENTIF"),
    "BEBAN TRANSPORT": ("ACCOUNT", "6201", "UANG_TRANSPORT"),
    "BIAYA AMORTISASI PRE OPENING": ("CLASS", "PRE_OPENING", "7101"),
    "HUTANG PAJAK": ("ACCOUNT", "2201", None),
    "BIAYA KERUSAKAN KEHILANGAN PERSEDIAAN": ("ACCOUNT", "5102", "SHRINKAGE"),
}


def main():
    coa = read_xlsx()
    cats = psql_json("SELECT json_agg(row_to_json(r)) FROM "
                     "(SELECT category_code, family, name, legacy_code "
                     " FROM line_category) r")
    classes = psql_json("SELECT json_agg(row_to_json(r)) FROM "
                        "(SELECT class_code, name, kind, legacy_code "
                        " FROM asset_class) r")
    families_of = {r["account_code"]: r["category_family"] for r in psql_json(
        "SELECT json_agg(row_to_json(r)) FROM (SELECT account_code, "
        "category_family FROM ledger_account WHERE is_group = false) r")}
    cat_legacy = {c["legacy_code"]: c for c in cats if c["legacy_code"]}
    cat_name = {norm(c["name"]): c for c in cats}
    cat_code = {c["category_code"]: c for c in cats}
    cls_legacy = {c["legacy_code"]: c for c in classes}
    cls_name = {norm(c["name"]): c for c in classes}
    cls_by_code = {c["class_code"]: c for c in classes}

    def decide(row):
        code12, name, target = row[1], row[2], row[5]
        n10 = code12[:10]
        t = norm(target)

        if n10 in cls_legacy:
            return ("CLASS", cls_legacy[n10]["class_code"], None)
        if n10 in cat_legacy:
            return ("CATEGORY", cat_legacy[n10]["category_code"], None)

        # Replacement-reserve and accumulated balances: the class of the cost
        # twin (10215xxxxx), the account by which side of the pair this is.
        if n10.startswith("10216"):
            twin = cls_legacy.get("10215" + n10[5:])
            if twin:
                if n10.startswith("1021607"):
                    return ("CLASS", twin["class_code"], "1610")
                amort = ("AMORT" in t or "SOFTWARE" in t or "LAND RIGHT" in t
                         or "PRE OPENING" in t)
                return ("CLASS", twin["class_code"], "1619" if amort else "1609")
        if t == "BIAYA REPLACEMENT OE":
            twin = cls_legacy.get("10215" + n10[5:])
            cls = twin["class_code"] if twin else None
            return ("CLASS", cls, "7101" if n10.startswith("7010") else "1610")

        hit = EXPLICIT.get(t)
        if hit:
            kind, detail, extra = hit
            if t == "CASH ON HAND" and "PETTY" in norm(name):
                extra = "PETTY"
            if t == "PENDAPATAN SEWA":
                extra = ("RENT_EQUIPMENT" if "PERALATAN" in norm(name)
                         else "RENT_BUILDING")
            if t == "PIUTANG ACQUIRER KARTU":
                extra = "CARD_CREDIT" if "KREDIT" in norm(name) else "CARD_DEBIT"
            if t == "CADANGAN PIUTANG ACQUIRER KARTU":
                extra = "CARD_CREDIT" if "KREDIT" in norm(name) else "CARD_DEBIT"
            if t == "CADANGAN PIUTANG PEGAWAI":
                extra = "EMPLOYEE"
            if t == "PIUTANG PEGAWAI DAN MANAJEMEN":
                extra = "MANAGEMENT" if "MANAJEMEN" in norm(name) else "EMPLOYEE"
            if t == "HUTANG PAJAK":
                n = norm(name)
                extra = next((c for tok, c in [("PPN", "PPN_OUT"), ("PS 21", "PPH21"),
                                               ("PS 23", "PPH23"), ("PS 25", "PPH25"),
                                               ("FINAL", "PPH_FINAL"), ("PBB", "PBB")]
                              if tok in n), "TAX_OTHER")
            if t == "BIAYA KERUSAKAN KEHILANGAN PERSEDIAAN":
                extra = "DAMAGE" if "RUSAK" in norm(name) else "SHRINKAGE"
            return (kind, detail, extra)

        if t.startswith("PENJUALAN BARANG DAGANGAN"):
            n = norm(name)
            if "TUNAI" in n:
                return ("ACCOUNT", "4101", "CASH")
            if "QRIS" in n:
                return ("ACCOUNT", "4101", "QRIS")
            if "ONLINE" in n or "MARKETPLACE" in n:
                return ("ACCOUNT", "4101", "ONLINE")
            if "KREDIT" in n:
                code = token_match(name, {"Visa": "CREDIT_VISA",
                                          "Master": "CREDIT_MASTER"})
                return ("ACCOUNT", "4101", code or "CREDIT_CARD")
            code = token_match(name, {"BCA": "DEBIT_BCA", "Mandiri": "DEBIT_MANDIRI",
                                      "BRI": "DEBIT_BRI", "BNI": "DEBIT_BNI"})
            return ("ACCOUNT", "4101", code or "DEBIT_CARD")

        if t.startswith("AKUMULASI") or t.startswith("BEBAN PENYUSUTAN"):
            stem = (t[len("AKUMULASI "):] if t.startswith("AKUMULASI")
                    else t[len("BEBAN PENYUSUTAN AMORTISASI "):])
            cls = token_match(stem, {c["name"]: c["class_code"] for c in classes})
            amort = "AMORT" in t or "SOFTWARE" in t or "LAND RIGHT" in t or "PRE OPENING" in t
            if t.startswith("AKUMULASI"):
                return ("CLASS", cls, "1619" if amort else "1609")
            return ("CLASS", cls, "7101")

        if t.startswith("KREDIT PAJAK") or t == "PBB DIBAYAR DIMUKA" \
                or t == "PAJAK LAIN DIBAYAR DIMUKA":
            n = norm(name)
            for tok, cat in [("PS 21", "PPH21"), ("PS 23", "PPH23"),
                             ("PS 25", "PPH25"), ("FINAL", "PPH_FINAL"),
                             ("PBB", "PBB"), ("PPN", "PPN_IN")]:
                if tok in n:
                    return ("ACCOUNT", "1402", cat)
            return ("ACCOUNT", "1402", "TAX_OTHER")

        if norm(target) in cat_name:
            return ("CATEGORY", cat_name[norm(target)]["category_code"], None)
        if norm(target) in cls_name:
            return ("CLASS", cls_name[norm(target)]["class_code"], None)
        got = token_match(target, {c["name"]: c["category_code"] for c in cats})
        if got:
            return ("CATEGORY", got, None)
        return ("UNRESOLVED", None, None)

    out, unresolved, nulled = [], [], 0
    for d in coa:
        code12, name, owner, target = d[1], d[2], d[4], d[5]
        kind, detail, extra = decide(d)
        if kind == "UNRESOLVED":
            unresolved.append(d)
            continue
        account, category, qualifier = None, None, None
        if kind in ("ACCOUNT",):
            account = detail
            category = extra
        elif kind == "CATEGORY":
            category = detail
            account = PREFIX_ACCOUNT.get(code12[:7])
            if not account:
                fam = cat_code[detail]["family"]
                owners = [a for a, f in families_of.items() if f == fam]
                account = owners[0] if len(owners) == 1 else None
        elif kind == "CLASS":
            account = extra or ("1602" if cls_by_code.get(detail, {}).get("kind")
                                == "INTANGIBLE" else "1601")
        elif kind == "QUALIFIER":
            account, qualifier = detail, extra
        elif kind == "BANK":
            account, qualifier = detail, extra
        # A category the account does not take is dropped, not forced.
        if category and account:
            fam = families_of.get(account)
            ccat = cat_code.get(category)
            if fam and ccat and ccat["family"] != fam:
                category = None
                nulled += 1
            if fam is None:
                category = None
                nulled += 1
        out.append(dict(code12=code12, name=name, owner=owner, target=target,
                        kind=kind, account=account, category=category,
                        detail=detail, qualifier=qualifier))

    print("resolved:", len(out), " unresolved:", len(unresolved),
          " category-dropped (family):", nulled)
    for d in unresolved:
        print("  UNRESOLVED:", d[1], d[2], "->", d[5])
    print("by destination:", dict(collections.Counter(r["kind"] for r in out)))
    noacct = [r for r in out if not r["account"]]
    print("rows without account:", len(noacct))
    for r in noacct[:10]:
        print("   ?", r["code12"], r["name"], r["kind"], r["detail"])
    print("categories used:", len({r["category"] for r in out if r["category"]}))

    with open("/tmp/coa_final.tsv", "w") as f:
        f.write("code12\tname\towner\ttarget\tkind\taccount\tcategory\t"
                "class_or_qualifier\n")
        for r in out:
            f.write("\t".join([r["code12"], r["name"], r["owner"], r["target"],
                               r["kind"], r["account"] or "", r["category"] or "",
                               (r["detail"] or "") if r["kind"] == "CLASS"
                               else (r["qualifier"] or "")]) + "\n")
    json.dump(out, open("/tmp/coa_final.json", "w"), ensure_ascii=False, indent=1)
    print("wrote /tmp/coa_final.tsv and /tmp/coa_final.json")


if __name__ == "__main__":
    main()
