#!/usr/bin/env python3
"""Menghasilkan lima dasbor: sidebar + KPI + tabel.

Anatominya identik di kelimanya — yang berbeda paletnya DAN satu perlakuan
khas per opsi, supaya bedanya kelihatan sekali lihat, bukan cuma terasa.
"""
import pathlib

HERE = pathlib.Path(__file__).parent

OPSI = [
    dict(
        slug="1-biru", nama="Biru", font="Inter",
        judul="Biru tinta",
        khas="Kartu KPI standar. Warna dipakai untuk nav aktif, tautan, dan satu bar rincian.",
        c=dict(
            canvas="#f7f8fa", card="#ffffff", line="#e6e8ec", soft="#f0f2f5",
            ink="#14161a", mid="#5c6270", faint="#9096a1",
            pri="#2563eb", pri_deep="#1d4ed8", tint="#eff4ff",
            sec="#93b4f8", sec2="#c7d8fc",
            ok="#067a52", warn="#a16207", alert="#d0342c",
            side_bg="#ffffff", side_ink="#14161a", side_mid="#5c6270",
            side_act_bg="#eff4ff", side_act_ink="#1d4ed8", side_line="#e6e8ec",
        ),
        bars=False, sorot=False,
    ),
    dict(
        slug="2-hijau", nama="Hijau", font="Geist",
        judul="Hijau hutan",
        khas="Tiap KPI membawa bar mungil — besaran jadi terbaca sebelum angkanya dibaca.",
        c=dict(
            canvas="#f7f9f8", card="#ffffff", line="#e3e9e7", soft="#eff3f2",
            ink="#121816", mid="#57635e", faint="#8c9a94",
            pri="#047857", pri_deep="#036249", tint="#ecfdf5",
            sec="#5fb794", sec2="#a8dcc6",
            ok="#047857", warn="#a16207", alert="#c0392b",
            side_bg="#ffffff", side_ink="#121816", side_mid="#57635e",
            side_act_bg="#ecfdf5", side_act_ink="#036249", side_line="#e3e9e7",
        ),
        bars=True, sorot=False,
    ),
    dict(
        slug="3-indigo", nama="Indigo", font="Plus+Jakarta+Sans",
        judul="Indigo, satu kartu disorot",
        khas="Hanya kartu terpenting yang berwarna. Tiga sisanya putih — jadi mata tahu harus mulai dari mana.",
        c=dict(
            canvas="#f8f8fc", card="#ffffff", line="#e8e8f0", soft="#f2f2f8",
            ink="#15151f", mid="#5d5d70", faint="#9494a6",
            pri="#4f46e5", pri_deep="#4338ca", tint="#eef2ff",
            sec="#a5a0f0", sec2="#d0cdf8",
            ok="#067a52", warn="#a16207", alert="#d0342c",
            side_bg="#ffffff", side_ink="#15151f", side_mid="#5d5d70",
            side_act_bg="#eef2ff", side_act_ink="#4338ca", side_line="#e8e8f0",
        ),
        bars=False, sorot=True,
    ),
    dict(
        slug="4-terakota", nama="Terakota", font="Instrument+Sans",
        judul="Terakota hangat",
        khas="Kanvasnya gading, bukan abu. Terasa hangat tanpa berhenti bersih.",
        c=dict(
            canvas="#fdfaf6", card="#ffffff", line="#ece5dc", soft="#f7f1e9",
            ink="#1c1815", mid="#6b6058", faint="#a1958a",
            pri="#c2410c", pri_deep="#9a330a", tint="#fff2e9",
            sec="#e8a97e", sec2="#f5d5bd",
            ok="#0a7350", warn="#a16207", alert="#b3261e",
            side_bg="#ffffff", side_ink="#1c1815", side_mid="#6b6058",
            side_act_bg="#fff2e9", side_act_ink="#9a330a", side_line="#ece5dc",
        ),
        bars=False, sorot=False,
    ),
    dict(
        slug="5-teal", nama="Teal", font="Inter+Tight",
        judul="Sidebar gelap, kerja tetap putih",
        khas="Chrome digelapkan supaya area kerja terbaca sebagai lembar terang di sebelahnya.",
        c=dict(
            canvas="#f6f8f8", card="#ffffff", line="#e2e9e8", soft="#eef3f2",
            ink="#101817", mid="#566360", faint="#8b9997",
            pri="#0f766e", pri_deep="#0d5d57", tint="#effcfa",
            sec="#5cb3aa", sec2="#a9dcd7",
            ok="#0f766e", warn="#a16207", alert="#c0392b",
            side_bg="#11302e", side_ink="#eaf3f1", side_mid="#8fb0ac",
            side_act_bg="rgba(255,255,255,.10)", side_act_ink="#ffffff", side_line="#1d403d",
        ),
        bars=False, sorot=False,
    ),
]

NAV = [
    ("Ringkasan", "ringkasan", True, None),
    ("Pool", "pool", False, None),
    ("Movement", "move", False, None),
    ("Allotment", "allot", False, None),
    ("Official Count", "count", False, "3"),
    ("Missing", "missing", False, "12"),
    ("Penjualan", "sale", False, None),
    ("Kontrol ledger", "control", False, None),
]

ICON = {
    "ringkasan": '<path d="M2.5 12.5 6.5 8l3 2.5L15.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 15.5h13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    "pool": '<rect x="2.5" y="2.5" width="13" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2.5" y="7.5" width="13" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2.5" y="12.5" width="13" height="3" rx="1" stroke="currentColor" stroke-width="1.5"/>',
    "move": '<path d="M2.5 6.5h11m0 0-3-3m3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 11.5h-11m0 0 3-3m-3 3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    "allot": '<path d="M9 2.5v5m0 0-4 3v5m4-8 4 3v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    "count": '<rect x="3.5" y="2.5" width="11" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M6.25 6.5h5.5M6.25 9.5h5.5M6.25 12.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    "missing": '<circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.8 2.4"/><path d="M9 5.75v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="12" r=".85" fill="currentColor"/>',
    "sale": '<path d="M2.5 3.5h2l2 8h7.5l1.5-6H5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.5" cy="14.25" r="1.2" stroke="currentColor" stroke-width="1.4"/><circle cx="13" cy="14.25" r="1.2" stroke="currentColor" stroke-width="1.4"/>',
    "control": '<path d="M4.5 3v12M9 3v12M13.5 3v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="4.5" cy="6.5" r="1.7" fill="var(--side-bg)" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="11" r="1.7" fill="var(--side-bg)" stroke="currentColor" stroke-width="1.5"/><circle cx="13.5" cy="7.5" r="1.7" fill="var(--side-bg)" stroke="currentColor" stroke-width="1.5"/>',
}

POOLS = [
    ("grp", "Distribution Centre"),
    ("row", "dc.warehouse", "cloud", "21.480", "3.104", "18.376", "92", "18.301", "0,41%", "74 ÷ 18.052", 27, None),
    ("row", "dc.staging", "cloud", "1.240", None, "1.240", "8", "1.236", "0,00%", "0 ÷ 1.244", 0, None),
    ("row", "dc.reject.dc", "cloud", "612", None, "612", None, "604", None, "tanpa paparan", 0, None),
    ("sum", "Jumlah Distribution Centre", "", "23.332", "3.104", "20.228", "100", "20.141", "0,38%", "74 ÷ 19.296", 25, None),
    ("grp", "Toko · 13 site"),
    ("row", "store-01", "edge", "2.104", None, "2.104", "14", "2.088", "0,52%", "11 ÷ 2.115", 35, None),
    ("row", "store-03", "edge", "1.876", None, "1.876", "31", "1.840", "1,44%", "27 ÷ 1.874", 96, "warn"),
    ("row", "store-04", "edge", "1.512", "1.524", "−12", "9", "1.503", "0,60%", "9 ÷ 1.501", 40, "neg"),
    ("row", "store-07", "edge · putus 14:02", "1.944", None, "1.944", "18", None, None, "belum sinkron", 0, None),
    ("sum", "Jumlah Toko · 12 dari 13 melapor", "", "24.980", "1.524", "24.674", "206", "24.401", "0,71%", "176 ÷ 24.788", 47, None),
]

ATT = [
    ("12", "Missing lewat 72 jam tanpa penyelesaian", "9 di toko, 3 di DC · tertua 6 hari", "Selesaikan", "late"),
    ("3", "Official Count menunggu persetujuan", "dc.warehouse · store-02.floor · store-11.warehouse", "Tinjau", ""),
    ("1", "Allotment melebihi On Hand sumbernya", "store-04.warehouse · On Hand −12", "Lihat", "late"),
    ("2", "Bacaan RFID tidak cocok dengan ledger", "store-03.floor · 4 jam lalu", "Periksa", ""),
    ("—", "Selisih proyeksi buku besar", "Angkanya tidak dibuka untuk peran kamu", "Butuh supervisor", "locked"),
]


def nav_html():
    out = []
    for label, key, active, badge in NAV:
        b = f'<span class="badge">{badge}</span>' if badge else ""
        a = ' aria-current="page"' if active else ""
        out.append(
            f'      <a href="#"{a}><svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">{ICON[key]}</svg>{label}{b}</a>'
        )
    return "\n".join(out)


def table_html():
    out = []
    for item in POOLS:
        if item[0] == "grp":
            out.append(f'          <tr class="grp"><td colspan="7">{item[1]}</td></tr>')
            continue
        _, name, src, stock, allot, onhand, missing, obs, lost, den, _pct, flag = item
        cls = ' class="sum"' if item[0] == "sum" else ""
        srcs = f' <span class="src">{src}</span>' if src else ""
        def cell(v, extra=""):
            return f'<td class="n{extra}">{v}</td>' if v is not None else '<td class="n nil">—</td>'
        oh = cell(onhand, " neg" if flag == "neg" else "")
        lostcell = (
            f'<td class="n">{lost}<span class="den">{den}</span></td>' if lost
            else f'<td class="n nil">—<span class="den">{den}</span></td>'
        )
        out.append(
            f'          <tr{cls}><td>{name}{srcs}</td>'
            f'{cell(stock)}{cell(allot)}{oh}{cell(missing)}{cell(obs)}{lostcell}</tr>'
        )
    return "\n".join(out)


def att_html():
    out = []
    for qty, title, sub, action, flag in ATT:
        attr = f' data-{flag}' if flag else ""
        out.append(
            f'        <a href="#"{attr}>\n'
            f'          <span class="qty">{qty}</span>\n'
            f'          <span class="what"><b>{title}</b><span>{sub}</span></span>\n'
            f'          <span class="go">{action}</span>\n'
            f'        </a>'
        )
    return "\n".join(out)


def kpi_html(o):
    bars = o["bars"]
    sorot = ' data-sorot' if o["sorot"] else ""

    def bar(pct, tone="sec"):
        if not bars:
            return ""
        return (
            f'<span class="kbar"><span style="width:{pct}%;background:var(--{tone})"></span></span>'
        )

    return f"""      <article class="card kpi"{sorot}>
        <span class="klab">Stock estate</span>
        <b class="kfig">48.312</b>
        <span class="split" role="img" aria-label="Allotted 3.104, On Hand 44.902, Missing 306">
          <span style="width:6.4%;background:var(--pri)"></span>
          <span style="width:92.9%;background:var(--sec)"></span>
          <span style="width:.7%;background:var(--warn)"></span>
        </span>
        <span class="kfoot legend">
          <span><i style="background:var(--pri)"></i>Allotted 3.104</span>
          <span><i style="background:var(--sec)"></i>On Hand 44.902</span>
          <span><i style="background:var(--warn)"></i>Missing 306</span>
        </span>
      </article>

      <article class="card kpi">
        <span class="klab">On Hand</span>
        <b class="kfig">44.902</b>
        {bar(92, "sec")}
        <span class="kfoot"><span class="up">▲ 1,2%</span> dari kemarin · 92,9% dari Stock</span>
      </article>

      <article class="card kpi">
        <span class="klab">Missing</span>
        <b class="kfig">306</b>
        {bar(18, "sec2")}
        <span class="kfoot"><span class="alert">12 lewat 72 jam</span> · tertua 6 hari</span>
      </article>

      <article class="card kpi">
        <span class="klab">Penjualan hari ini</span>
        <b class="kfig">Rp 184,29<small> jt</small></b>
        {bar(74, "sec")}
        <span class="kfoot">Rp 184.290.500 · 1.208 transaksi</span>
      </article>"""


TPL = """<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>{judul} · Ringkasan Retail Edge</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family={font}:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* {judul}
   {khas}
   Anatomi sama di kelima opsi: sidebar · deret KPI · tabel · daftar perhatian.
   Warna dipakai untuk tiga hal saja — nav aktif, besaran, dan satu peringatan.
   Di luar itu halaman tetap putih. */
:root{{
  --canvas:{canvas}; --card:{card}; --line:{line}; --soft:{soft};
  --ink:{ink}; --mid:{mid}; --faint:{faint};
  --pri:{pri}; --pri-deep:{pri_deep}; --tint:{tint};
  --sec:{sec}; --sec2:{sec2};
  --ok:{ok}; --warn:{warn}; --alert:{alert};
  --side-bg:{side_bg}; --side-ink:{side_ink}; --side-mid:{side_mid};
  --side-act-bg:{side_act_bg}; --side-act-ink:{side_act_ink}; --side-line:{side_line};
  --r:10px;
}}
*,*::before,*::after{{box-sizing:border-box}}
html,body{{margin:0;padding:0}}
body{{
  background:var(--canvas);color:var(--ink);
  font-family:"{fontname}",-apple-system,"Segoe UI",Helvetica,sans-serif;
  font-size:13.5px;line-height:1.55;font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased;
}}
.nil{{color:var(--faint)}}
:focus-visible{{outline:2px solid var(--pri);outline-offset:2px;border-radius:4px}}

.app{{display:flex;align-items:flex-start;min-height:100dvh}}

/* ---------- sidebar ---------- */
.side{{
  position:sticky;top:0;width:236px;flex-shrink:0;height:100dvh;overflow-y:auto;
  background:var(--side-bg);color:var(--side-ink);
  border-inline-end:1px solid var(--side-line);
  padding:18px 12px;display:flex;flex-direction:column;
}}
.brand{{display:flex;align-items:center;gap:10px;padding:4px 8px 22px}}
.brand span{{
  width:26px;height:26px;border-radius:7px;flex-shrink:0;
  background:var(--pri);color:#fff;display:grid;place-items:center;
}}
.brand b{{font-weight:600;font-size:14px;letter-spacing:-.01em}}
.navgrp{{
  padding:14px 8px 6px;font-size:10.5px;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;color:var(--side-mid);opacity:.85;
}}
.side a{{
  display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:7px;
  color:var(--side-mid);text-decoration:none;font-weight:500;
  transition:background-color 120ms ease,color 120ms ease;
}}
.side a:hover{{color:var(--side-ink)}}
.side a[aria-current="page"]{{background:var(--side-act-bg);color:var(--side-act-ink);font-weight:600}}
.side a svg{{flex-shrink:0}}
.badge{{
  margin-inline-start:auto;font-size:10.5px;font-weight:600;
  background:var(--alert);color:#fff;border-radius:99px;padding:0 6px;line-height:16px;
}}
.side-foot{{
  margin-top:auto;padding:14px 8px 0;border-top:1px solid var(--side-line);
  font-size:11.5px;color:var(--side-mid);line-height:1.5;
}}

/* ---------- kanvas ---------- */
.main{{flex:1;min-width:0;padding:22px 24px 60px;max-width:1560px}}
.hd{{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px}}
.hd h1{{margin:0 0 2px;font-size:21px;font-weight:600;letter-spacing:-.02em}}
.hd p{{margin:0;color:var(--mid)}}
.stamp{{
  margin-inline-start:auto;display:inline-flex;align-items:center;gap:7px;
  background:var(--card);border:1px solid var(--line);border-radius:99px;
  padding:5px 12px;font-size:11.5px;color:var(--mid);white-space:nowrap;
}}
.stamp i{{width:6px;height:6px;border-radius:50%;background:var(--ok);flex-shrink:0}}

.card{{background:var(--card);border:1px solid var(--line);border-radius:var(--r)}}

/* ---------- KPI ---------- */
.kpis{{display:grid;gap:12px;grid-template-columns:1fr;margin-bottom:12px}}
@media(min-width:720px){{.kpis{{grid-template-columns:repeat(2,1fr)}}}}
@media(min-width:1280px){{.kpis{{grid-template-columns:repeat(4,1fr)}}}}
.kpi{{padding:15px 16px;display:flex;flex-direction:column;gap:9px}}
.kpi[data-sorot]{{background:var(--tint);border-color:color-mix(in oklab,var(--pri) 22%,transparent)}}
.kpi[data-sorot] .kfig{{color:var(--pri-deep)}}
.kpi[data-sorot] .klab{{color:var(--pri-deep);opacity:.75}}
.klab{{font-size:11.5px;font-weight:600;letter-spacing:.04em;color:var(--mid)}}
.kfig{{font-size:27px;font-weight:600;letter-spacing:-.03em;line-height:1}}
.kfig small{{font-size:14px;font-weight:500;color:var(--mid);letter-spacing:0}}
.kfoot{{
  margin-top:auto;padding-top:9px;border-top:1px solid var(--line);
  font-size:11.5px;color:var(--mid);
}}
.kfoot.legend{{display:flex;gap:12px;flex-wrap:wrap;align-items:center}}
.kpi[data-sorot] .kfoot{{border-top-color:color-mix(in oklab,var(--pri) 18%,transparent)}}
.kfoot i{{display:inline-block;width:7px;height:7px;border-radius:2px;margin-inline-end:5px}}
.up{{color:var(--ok);font-weight:600}}
.alert{{color:var(--alert);font-weight:600}}
.split{{display:flex;height:6px;border-radius:99px;overflow:hidden;background:var(--soft)}}
.split span{{display:block}}
.kbar{{display:block;height:5px;border-radius:99px;background:var(--soft);overflow:hidden}}
.kbar span{{display:block;height:100%;border-radius:99px}}

/* ---------- panel ---------- */
.ph{{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:13px 16px;border-bottom:1px solid var(--line)}}
.ph h2{{margin:0;font-size:14.5px;font-weight:600;letter-spacing:-.01em}}
.ph .meta{{margin-inline-start:auto;color:var(--faint);font-size:12px}}
.ph .search{{
  display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;min-width:180px;
  border:1px solid var(--line);border-radius:7px;color:var(--faint);
}}
.ph .search:focus-within{{border-color:var(--pri)}}
.ph .search input{{flex:1;min-width:0;border:0;outline:0;background:none;font-family:inherit;font-size:12.5px;color:var(--ink)}}

/* ---------- tabel ---------- */
.tw{{overflow-x:auto;border-radius:0 0 var(--r) var(--r)}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th{{
  text-align:start;padding:9px 16px;white-space:nowrap;
  font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);
  border-bottom:1px solid var(--line);
}}
td{{padding:11px 16px;white-space:nowrap;border-bottom:1px solid var(--line)}}
tbody tr:last-child td{{border-bottom:0}}
th.n,td.n{{text-align:end}}
tbody tr:hover{{background:var(--soft)}}
.grp td{{
  padding:11px 16px 7px;background:var(--soft);
  font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--mid);
}}
.grp td,.sum td{{white-space:nowrap}}
.sum td{{color:var(--mid);font-weight:600}}
.sum:hover td{{background:transparent}}
.neg{{color:var(--alert)}}
.den{{display:block;font-size:11px;color:var(--faint);margin-top:1px;font-weight:400}}
.src{{font-size:11.5px;color:var(--faint)}}
.cap{{padding:11px 16px 13px;color:var(--mid);font-size:11.5px;line-height:1.5;max-width:88ch;margin:0}}

/* ---------- perlu perhatian ---------- */
.att a{{
  display:grid;grid-template-columns:40px 1fr auto;align-items:center;gap:16px;
  padding:12px 16px;border-bottom:1px solid var(--line);
  color:inherit;text-decoration:none;transition:background-color 120ms ease;
}}
.att a:last-child{{border-bottom:0}}
.att a:hover{{background:var(--soft)}}
.att .qty{{font-size:20px;font-weight:600;text-align:end;letter-spacing:-.02em;line-height:1}}
.att .what b{{display:block;font-weight:500}}
.att .what span{{font-size:11.5px;color:var(--faint)}}
.att .go{{font-size:12px;font-weight:500;color:var(--pri);white-space:nowrap}}
.att a[data-late] .qty{{color:var(--alert)}}
.att a[data-locked] .qty{{color:var(--faint);font-weight:400}}
.att a[data-locked] .go{{color:var(--faint)}}
.att a[data-locked]:hover{{background:transparent}}

.cols{{display:grid;gap:12px;grid-template-columns:1fr;margin-top:12px}}

@media(max-width:900px){{
  .app{{display:block}}
  .side{{position:static;width:auto;height:auto;flex-direction:row;overflow-x:auto;
        border-inline-end:0;border-bottom:1px solid var(--side-line);padding:10px}}
  .brand,.navgrp,.side-foot{{display:none}}
  .side a{{white-space:nowrap}}
  .main{{padding:16px 14px 40px}}
}}
@media(prefers-reduced-motion:reduce){{*{{transition-duration:.01ms!important}}}}
</style>
</head>
<body>

<div class="app">

  <nav class="side" aria-label="Navigasi utama">
    <div class="brand">
      <span aria-hidden="true"><svg width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 11.5h7M10 6v5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>
      <b>Retail Edge</b>
    </div>

    <div class="navgrp">Operasi</div>
{nav}

    <div class="side-foot">
      cloud · inventory_edge_dev<br>
      12 dari 13 node · 15:42
    </div>
  </nav>

  <main class="main">

    <div class="hd">
      <div>
        <h1>Ringkasan</h1>
        <p>Apa kata buku besar sekarang, dan apa yang menunggu orang.</p>
      </div>
      <span class="stamp"><i></i>Segar 15:42 · store-07 belum sinkron</span>
    </div>

    <section class="kpis" aria-label="Angka pokok">
{kpi}
    </section>

    <section class="card" aria-labelledby="pool-h">
      <div class="ph">
        <h2 id="pool-h">Pool</h2>
        <label class="search">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="6.25" cy="6.25" r="4.25" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 9.5 12 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <input id="q" type="search" placeholder="Cari pool atau toko" aria-label="Cari pool atau toko">
        </label>
        <span class="meta">Observed 24 jam · Lost 30 hari</span>
      </div>
      <div class="tw">
        <table aria-describedby="lostdef">
          <thead>
            <tr>
              <th>Pool</th>
              <th class="n">Stock</th>
              <th class="n">Allotted</th>
              <th class="n">On Hand</th>
              <th class="n">Missing</th>
              <th class="n">Observed</th>
              <th class="n">Lost&nbsp;%</th>
            </tr>
          </thead>
          <tbody id="rows">
{table}
          </tbody>
        </table>
      </div>
      <p class="cap" id="lostdef">
        Lost&nbsp;% = Lost yang berasal dari pool ini selama 30 hari, dibagi On Hand di awal jendela
        ditambah On Hand yang masuk selama jendela. Penyebutnya ditulis di tiap baris supaya rasionya
        bisa diperiksa. Tanda — berarti tidak diketahui, dan tidak sama dengan nol.
      </p>
    </section>

    <div class="cols">
      <section class="card" aria-labelledby="att-h">
        <div class="ph">
          <h2 id="att-h">Perlu perhatian</h2>
          <span class="meta">18 terbuka · tertua 6 hari</span>
        </div>
        <div class="att">
{att}
        </div>
      </section>
    </div>
  </main>
</div>

<script>
var q = document.getElementById("q");
q.addEventListener("input", function () {{
  var term = q.value.trim().toLowerCase();
  document.querySelectorAll("#rows tr").forEach(function (row) {{
    if (row.classList.contains("grp")) {{ row.hidden = Boolean(term); return; }}
    row.hidden = Boolean(term) && row.textContent.toLowerCase().indexOf(term) === -1;
  }});
}});
</script>
</body>
</html>
"""

for o in OPSI:
    html = TPL.format(
        judul=o["judul"], khas=o["khas"],
        font=o["font"], fontname=o["font"].replace("+", " "),
        nav=nav_html(), kpi=kpi_html(o), table=table_html(), att=att_html(),
        **o["c"],
    )
    (HERE / f"{o['slug']}.html").write_text(html, encoding="utf-8")
    print("tulis", o["slug"] + ".html", len(html.splitlines()), "baris")
