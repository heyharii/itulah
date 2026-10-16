/* The hub's layered shell for the layers film, redrawn from
   po-shell-layers.html (14 Oct 2026): the outer rail on the stone, the
   department tray holding the inner sidebar and the page, then the record
   sheet (view ⇄ edit) and the nested Add item sheet over it.

   Look "c" is the tray (C · Nested tray) with concentric corners — tray 24,
   page and sheets 16, 8px between — and every sheet laid exactly on the
   page's edge, the nested one 8px further in. Look "a" is A · Floating
   sheets: rail, panel card and page card side by side, 12px of stone apart.

   Everything is drawn in window space, 1600 × 900; the film's camera frames
   it. Each surface is its own layer so the camera can pull them apart. */
import type { CSSProperties, ReactNode } from "react"
import {
  Bell,
  BookOpen,
  Boxes,
  Calendar,
  ChevronDown,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  Pencil,
  Search,
  Shirt,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Trash2,
  Truck,
  Users,
  X,
} from "lucide-react"

export const WIN = { w: 1600, h: 900 }
export type Look = "a" | "c"

export interface Box {
  x: number
  y: number
  w: number
  h: number
  r: number
}

const RAIL_W = 64
const PANEL_W = 232

/** Where each surface sits in the window, per look. */
export function frames(look: Look) {
  if (look === "c") {
    const tray: Box = { x: RAIL_W, y: 12, w: WIN.w - RAIL_W - 12, h: WIN.h - 24, r: 24 }
    const page: Box = {
      x: tray.x + 8 + PANEL_W,
      y: tray.y + 8,
      w: tray.w - 16 - PANEL_W,
      h: tray.h - 16,
      r: 16,
    }
    const right = page.x + page.w
    const record: Box = { x: right - 960, y: page.y, w: 960, h: page.h, r: 16 }
    const nested: Box = { x: right - 8 - 540, y: page.y + 8, w: 540, h: page.h - 16, r: 16 }
    const panel: Box = { x: tray.x + 8, y: tray.y + 8, w: PANEL_W, h: tray.h - 16, r: 16 }
    return { tray, panel, page, record, nested }
  }
  const panel: Box = { x: RAIL_W, y: 12, w: PANEL_W, h: WIN.h - 24, r: 16 }
  const page: Box = { x: RAIL_W + PANEL_W + 12, y: 12, w: WIN.w - RAIL_W - PANEL_W - 24, h: WIN.h - 24, r: 16 }
  const right = page.x + page.w
  const record: Box = { x: right - 960, y: 12, w: 960, h: WIN.h - 24, r: 16 }
  const nested: Box = { x: right - 12 - 540, y: 24, w: 540, h: WIN.h - 48, r: 16 }
  return { tray: null, panel, page, record, nested }
}

export const css = `
.ly{font-family:"Inter Variable",Inter,sans-serif;color:#1d1d1f;font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;letter-spacing:-.005em}
.ly *{box-sizing:border-box}
.ly .i{width:18px;height:18px;flex:none;stroke-width:1.7}
.ly .mute{color:#77736e}
/* rail */
.ly-rail{position:absolute;inset:0;padding:16px 12px;color:#645c52}
.ly-logo{position:absolute;left:16px;top:16px;width:32px;height:32px;border-radius:9px;background:#1d1d1f;color:#fff;display:grid;place-items:center;font-weight:700;font-size:15px}
.ly-rb{position:absolute;left:12px;height:40px;display:flex;align-items:center;gap:14px;padding:0 11px;border-radius:10px;font-size:14px;font-weight:500;white-space:nowrap}
.ly-rb.on{color:#1d1d1f}
.ly-pill{position:absolute;left:12px;height:40px;border-radius:10px;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / 7%),0 0 0 1px rgb(80 60 30 / 5%)}
.ly-ai{width:18px;height:18px;display:grid;place-items:center;font-size:14px;font-weight:650;color:#6b469e;flex:none}
.ly-aibg{position:absolute;left:12px;height:40px;border-radius:10px;background:#ece6f6;box-shadow:inset 0 0 0 1px rgb(107 70 158 / 12%)}
.ly-sep{position:absolute;left:20px;height:1px;background:rgb(80 60 30 / 10%)}
.ly-badge{position:absolute;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#d70015;color:#fff;font-size:14px;font-weight:600;display:grid;place-items:center;box-shadow:0 0 0 2px #eae5dc;line-height:1}
.ly-avatar{width:22px;height:22px;border-radius:50%;background:#d9d2c6;color:#4d463d;font-size:14px;font-weight:600;display:grid;place-items:center;flex:none;letter-spacing:0}
/* inner sidebar */
.ly-panel{position:absolute;inset:0;padding:10px 10px 16px;display:flex;flex-direction:column}
.ly-panel h2{margin:6px 10px 22px;font-size:14px;font-weight:650}
.ly-item{display:flex;justify-content:space-between;align-items:center;height:38px;padding:0 10px;border-radius:8px;font-size:14px;color:#645c52}
.ly-item.on{background:#fff;color:#1d1d1f;font-weight:550;box-shadow:0 0 0 1px rgb(80 60 30 / 8%),0 1px 3px rgb(80 60 30 / 10%)}
.ly-item b{font-size:14px;font-weight:500;color:#645c52;background:#ede8e0;border-radius:5px;padding:1px 6px}
.ly-time{margin-top:auto;padding:0 10px 8px;font-size:14px;color:#8a8174}
/* surfaces */
.ly-surface{position:absolute;inset:0;background:#fff;overflow:hidden;display:flex;flex-direction:column}
.ly-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:24px 28px 18px;border-bottom:1px solid #eae8e4;flex:none;height:115px}
.ly-path{display:flex;gap:8px;color:#77736e;font-size:14px;line-height:18px;margin-bottom:8px}
.ly-path span{color:#aba49a}
.ly h1{margin:0;font-size:17px;line-height:22px;font-weight:650;letter-spacing:-.2px}
.ly-sub{display:block;margin-top:4px;font-size:14px;line-height:20px;color:#77736e}
.ly-st{color:#248a3d}
.ly-st::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin:0 7px 2px 0}
.ly-close{color:#2862dc;height:32px;width:32px;display:grid;place-items:center;border-radius:8px}
.ly-body{padding:24px 28px;flex:1;overflow:hidden}
.ly-kpis{display:flex;margin:0 0 20px;height:45px}
.ly-kpi{padding:0 24px;border-left:1px solid #eae8e4}
.ly-kpi:first-child{padding-left:0;border:0}
.ly-kpi>span{display:block;font-size:14px;line-height:20px;color:#77736e;margin-bottom:3px}
.ly-kpi strong{display:block;font-size:16px;line-height:22px;font-weight:600;white-space:nowrap}
.ly-tabs{display:flex;gap:24px;box-shadow:inset 0 -1px 0 #eae8e4;margin-bottom:14px;height:39px}
.ly-tab{font-size:14px;padding:8px 0 11px;color:#77736e;font-weight:500;border-bottom:2px solid transparent}
.ly-tab.on{color:#1d1d1f;border-color:#1d1d1f}
.ly-tab i{font-style:normal;margin-left:6px;font-weight:400;color:#77736e}
.ly-bar{display:flex;align-items:center;gap:8px;margin-bottom:14px;height:36px}
.ly-field{height:36px;display:flex;align-items:center;gap:8px;padding:0 11px;border:1px solid #e2e2e7;border-radius:8px;color:#77736e;font-size:14px;min-width:140px}
.ly-btn{height:36px;padding:0 14px;border-radius:8px;display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;white-space:nowrap}
.ly-btn.primary{background:#2862dc;color:#fff}
.ly-btn.danger{background:#d70015;color:#fff}
.ly-btn.ghost{border:1px solid #dedcd7;background:#fff;font-weight:500;padding:0 12px}
.ly-sp{flex:1}
.ly-tbl{border:1px solid #e5e5ea;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgb(0 0 0 / 5%)}
.ly table{width:100%;border-collapse:collapse}
.ly th{font-size:14px;height:40px;background:#faf9f7;padding:0 16px;color:#77736e;font-weight:500;text-align:left;border-bottom:1px solid #eae8e4;white-space:nowrap}
.ly td{padding:0 16px;border-bottom:1px solid #efede9;white-space:nowrap;height:68px}
.ly tr:last-child td{border-bottom:0}
.ly .r{text-align:right}
.ly td .s{display:block;font-size:14px;color:#77736e;margin-top:3px}
.ly .late{color:#d70015}
.ly .ok{color:#248a3d}
.ly .rc{display:inline-flex;height:27px;align-items:center;padding:0 10px;border-radius:7px;background:#f3f2ef;font-size:14px;font-weight:500}
.ly-it{display:flex;align-items:center;gap:12px}
.ly-thumb{width:36px;height:36px;flex:none;display:grid;place-items:center;border-radius:7px;background:#f4f2ee;color:#a29b90}
.ly-thumb svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ly-sbar{display:flex;align-items:center;justify-content:space-between;height:36px;margin-bottom:10px}
.ly-stitle{font-size:14px;font-weight:600;line-height:20px}
.ly-stitle span{color:#77736e;font-weight:400;margin-left:6px}
.ly-sect{margin-top:22px}
.ly-sect span{display:block;font-size:14px;color:#77736e}
.ly-disclose{display:flex;align-items:center;gap:6px;margin-top:18px;padding-top:14px;border-top:1px solid #eae8e4;font-weight:500}
.ly-disclose i{font-style:normal;color:#77736e;font-weight:400}
.ly-foot{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:12px 28px 18px;border-top:1px solid #eae8e4;flex:none;height:67px}
.ly-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px 20px;margin:0 0 20px}
.ly-fields.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.ly-fields label{display:grid;gap:6px;font-size:14px;color:#77736e}
.ly-inp{height:42px;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #e2e2e7;border-radius:8px;color:#1d1d1f;font-size:15px;white-space:nowrap;overflow:hidden}
.ly-inp.area{height:76px;align-items:flex-start;padding-top:10px}
.ly-inp .u{color:#77736e}
.ly-group{padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid #eae8e4}
.ly-group:last-of-type{border-bottom:0}
.ly-group h2{margin:0 0 14px;font-size:14px;font-weight:600}
.ly-seg{display:inline-flex;padding:2px;border-radius:8px;background:#f2f2f5;margin-right:8px;vertical-align:middle}
.ly-seg b{height:28px;padding:0 10px;display:grid;place-items:center;border-radius:6px;font-size:14px;font-weight:500;color:#77736e}
.ly-seg b.on{background:#fff;color:#1d1d1f;box-shadow:0 1px 2px rgb(0 0 0 / 8%)}
.ly-kinp{display:inline-flex;height:32px;width:88px;justify-content:flex-end;align-items:center;padding:0 10px;border:1px solid #e2e2e7;border-radius:8px;font-size:15px;font-weight:400;vertical-align:middle}
.ly-photo{width:96px;display:grid;justify-items:center;gap:8px;font-size:14px;color:#77736e;flex:none}
.ly-photo span{width:96px;height:96px;border:1px dashed #cfcbc4;border-radius:10px;display:grid;place-items:center;color:#a29b90}
.ly-check{display:flex;align-items:center;gap:8px;font-size:14px;color:#77736e;margin-right:auto}
.ly-check span{width:16px;height:16px;border:1px solid #cfcbc4;border-radius:4px}
.ly-acts{display:flex;gap:4px;justify-content:flex-end;color:#77736e}
.ly-acts span{width:32px;height:32px;display:grid;place-items:center;border-radius:8px}
`

/* ── rail ──────────────────────────────────────────────────────────────── */

export const RAIL_TOOLS = [
  { label: "Search", icon: Search },
  { label: "Ask AI", ai: true },
] as const

export const RAIL_DEPTS = [
  { label: "Executive", icon: LayoutDashboard },
  { label: "Procurement", icon: ShoppingCart },
  { label: "Merchandise", icon: Shirt },
  { label: "Ops", icon: Truck },
  { label: "Inventory", icon: Boxes },
  { label: "Marketing", icon: Megaphone },
  { label: "Sales", icon: Store },
  { label: "Finance", icon: Landmark },
  { label: "HR", icon: Users },
  { label: "GA", icon: MessagesSquare },
  { label: "Master", icon: BookOpen },
] as const

const PITCH = 46
const TOOLS_TOP = 66
const DEPTS_TOP = TOOLS_TOP + RAIL_TOOLS.length * PITCH + 13

/** The top of rail row n, counting tools then departments. */
export const railY = (n: number) =>
  n < RAIL_TOOLS.length ? TOOLS_TOP + n * PITCH : DEPTS_TOP + (n - RAIL_TOOLS.length) * PITCH

export const RAIL_PROCUREMENT = RAIL_TOOLS.length + 1
const BOTTOM = [
  { label: "Notifications", icon: Bell, badge: 2 },
  { label: "Rina Pratama", avatar: "RP" },
  { label: "Log out", icon: LogOut },
] as const
export const railBottomY = (n: number) => WIN.h - 16 - (BOTTOM.length - n) * PITCH + 6

export function Rail({
  expand,
  pill,
  arrive = () => 1,
  badge = 1,
}: {
  /** 0 icons only (64px) … 1 icons and names (180px). */
  expand: number
  /** Which row the white selection sits on; fractional while it travels. */
  pill: number
  /** Per-row arrival 0..1, for the opening stagger. */
  arrive?: (n: number) => number
  /** 0..1, the notification badge popping in. */
  badge?: number
}) {
  const width = 40 + 116 * expand
  const lo = Math.floor(pill)
  const hi = Math.min(lo + 1, RAIL_TOOLS.length + RAIL_DEPTS.length - 1)
  const pillY = railY(lo) + (railY(hi) - railY(lo)) * (pill - lo)
  const row = (n: number, label: string, icon: ReactNode, y: number, extra?: ReactNode) => {
    const k = arrive(n)
    return (
      <div
        key={label}
        className={"ly-rb" + (Math.round(pill) === n ? " on" : "")}
        style={{ top: y, width, opacity: k, translate: `0px ${(1 - k) * 10}px` }}
      >
        {icon}
        <span style={{ opacity: expand }}>{label}</span>
        {extra}
      </div>
    )
  }
  return (
    <div className="ly-rail">
      <div className="ly-logo" style={{ opacity: arrive(-1) }}>C</div>
      <div className="ly-aibg" style={{ top: railY(1), width, opacity: arrive(1) }} />
      <div className="ly-pill" style={{ top: pillY, width, opacity: arrive(0) }} />
      {RAIL_TOOLS.map((t, n) =>
        row(
          n,
          t.label,
          "ai" in t ? <span className="ly-ai">AI</span> : <t.icon className="i" />,
          railY(n)
        )
      )}
      <div
        className="ly-sep"
        style={{ top: DEPTS_TOP - 7, width: width - 16, opacity: arrive(RAIL_TOOLS.length) }}
      />
      {RAIL_DEPTS.map((d, i) =>
        row(i + RAIL_TOOLS.length, d.label, <d.icon className="i" />, railY(i + RAIL_TOOLS.length))
      )}
      {BOTTOM.map((b, i) =>
        row(
          100 + i,
          b.label,
          "avatar" in b ? <span className="ly-avatar">{b.avatar}</span> : <b.icon className="i" />,
          railBottomY(i),
          "badge" in b && badge > 0 ? (
            <span
              className="ly-badge"
              style={{ left: 24, top: -6, scale: String(0.6 + 0.4 * badge), opacity: badge }}
            >
              {b.badge}
            </span>
          ) : null
        )
      )}
    </div>
  )
}

/* ── inner sidebar ─────────────────────────────────────────────────────── */

export function Panel({ k = 1 }: { k?: number }) {
  return (
    <div className="ly-panel" style={{ opacity: k, translate: `${(1 - k) * -8}px 0px` }}>
      <h2>Procurement</h2>
      <div className="ly-item on">
        Purchase Orders <b>4</b>
      </div>
      <div className="ly-item">Suppliers</div>
      <div className="ly-item">Return PO</div>
      <div className="ly-time">Wed 14 Oct 2026 · 09:10</div>
    </div>
  )
}

/* ── the page: Purchase Orders ─────────────────────────────────────────── */

const SHOE = (
  <svg viewBox="0 0 24 24">
    <path d="M3 16v-3l4-1 3-4 3 3 4 1a3 3 0 0 1 3 3v1Z" />
    <path d="M3 16h17" />
  </svg>
)
const BAG = (
  <svg viewBox="0 0 24 24">
    <rect x="5" y="9" width="14" height="11" rx="2" />
    <path d="M8 9a4 4 0 0 1 8 0" />
  </svg>
)

type Row = [supplier: string, po: string, date: string, ord: string, ordRp: string, rec: ReactNode, recRp: string, status: "rc" | "ok"]
export const PO_ROWS: Row[] = [
  ["Garmen Nusantara, PT", "PO-0001-OPE5 · 2 items", "12 Nov 2026", "30 pcs", "Rp 2.844.000", <span className="late">28 pcs</span>, "Rp 2.700.000", "rc"],
  ["Garmen Nusantara, PT", "PO-0001-OPE4 · 3 items", "06 Nov 2026", "36 pcs", "Rp 3.012.000", <>36 pcs <span className="late">(+3)</span></>, "Rp 3.012.000", "rc"],
  ["Garmen Nusantara, PT", "PO-0001-OPE3 · 2 items", "31 Oct 2026", "24 pcs", "Rp 1.698.000", <>24 pcs <span className="late">(+2)</span></>, "Rp 1.698.000", "rc"],
  ["Garmen Nusantara, PT", "PO-0001-OPE2 · 3 items", "25 Oct 2026", "36 pcs", "Rp 2.118.000", <span className="late">34 pcs</span>, "Rp 2.048.000", "rc"],
  ["Sepatu Sejahtera, CV", "PO-0002-REC1 · 2 items", "20 Oct 2026", "18 pcs", "Rp 2.310.000", <span className="mute">0 pcs</span>, "", "ok"],
  ["Sepatu Sejahtera, CV", "PO-0002-OPE6 · 3 items", "19 Nov 2026", "36 pcs", "Rp 4.470.000", <span className="mute">0 pcs</span>, "", "ok"],
  ["Sepatu Sejahtera, CV", "PO-0002-OPE5 · 2 items", "13 Nov 2026", "30 pcs", "Rp 4.710.000", <span className="mute">0 pcs</span>, "", "ok"],
  ["Sepatu Sejahtera, CV", "PO-0002-OPE4 · 3 items", "07 Nov 2026", "36 pcs", "Rp 4.980.000", <span className="mute">0 pcs</span>, "", "ok"],
]

/** Page-local top of the first table row (head 115 + body 24 + kpis 65 +
    tabs 53 + bar 50 + th 41). */
export const ROW0 = 115 + 24 + 65 + 53 + 50 + 41
export const ROW_H = 68

const slot = (k: number): CSSProperties => ({
  opacity: k,
  translate: `0px ${(1 - k) * 8}px`,
})

export function PoPage({
  slots = () => 1,
  hover = -1,
  pressNew = 1,
}: {
  /** Arrival of slot n: 0 head, 1 figures, 2 tabs, 3 bar, 4+ table rows. */
  slots?: (n: number) => number
  hover?: number
  pressNew?: number
}) {
  return (
    <div className="ly-surface">
      <div className="ly-head" style={slot(slots(0))}>
        <div>
          <div className="ly-path">Procurement</div>
          <h1>Purchase Orders</h1>
          <span className="ly-sub">Track orders, deliveries, and receiving.</span>
        </div>
        <span className="ly-btn primary" style={{ scale: String(pressNew) }}>+ New order</span>
      </div>
      <div className="ly-body">
        <div className="ly-kpis" style={slot(slots(1))}>
          <div className="ly-kpi"><span>Orders</span><strong>15</strong></div>
          <div className="ly-kpi"><span>Still open</span><strong>15</strong></div>
          <div className="ly-kpi"><span>Overdue</span><strong>0</strong></div>
          <div className="ly-kpi"><span>On order</span><strong>Rp 40,9 M</strong></div>
        </div>
        <div className="ly-tabs" style={slot(slots(2))}>
          <span className="ly-tab on">Active PO<i>15</i></span>
          <span className="ly-tab">Completed PO<i>5</i></span>
          <span className="ly-tab">Cancelled PO<i>13</i></span>
        </div>
        <div className="ly-bar" style={slot(slots(3))}>
          <span className="ly-field" style={{ minWidth: 220 }}><Search className="i" style={{ width: 16 }} />Search orders</span>
          <span className="ly-btn ghost"><SlidersHorizontal className="i" style={{ width: 16 }} />Filter</span>
          <span className="ly-field">Created at<Calendar className="i" style={{ width: 16, marginLeft: "auto" }} /></span>
          <span className="ly-field">Delivery date<Calendar className="i" style={{ width: 16, marginLeft: "auto" }} /></span>
          <span className="ly-sp" />
          <span className="ly-btn ghost">Columns</span>
        </div>
        <div className="ly-tbl" style={slot(slots(4))}>
          <table>
            <thead>
              <tr>
                <th>PO</th>
                <th>Delivery Date</th>
                <th className="r">Ordered</th>
                <th className="r">Received</th>
                <th style={{ width: 170 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {PO_ROWS.map(([sup, po, date, ord, ordRp, rec, recRp, st], i) => (
                <tr
                  key={po}
                  style={{
                    ...slot(slots(5 + i)),
                    background: hover === i ? "#faf9f7" : undefined,
                  }}
                >
                  <td>{sup}<span className="s">{po}</span></td>
                  <td>{date}</td>
                  <td className="r">{ord}<span className="s">{ordRp}</span></td>
                  <td className="r">{rec}{recRp && <span className="s">{recRp}</span>}</td>
                  <td>{st === "rc" ? <span className="rc">Review Count</span> : <span className="ok">Active</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── the record sheet: PO-0002-OPE6, view and edit in the same frame ──── */

const ITEMS = [
  { name: "Sneakers Kanvas Low", sub: "Sandal sepatu · Sepatu", q: "18 pcs", p: "Rp 145.000 / pc", a: "Rp 2.610.000", icon: SHOE },
  { name: "Flat Shoes Wanita", sub: "Sandal sepatu · Sepatu", q: "6 pcs", p: "Rp 120.000 / pc", a: "Rp 720.000", icon: SHOE },
  { name: "Tas Selempang Kanvas", sub: "Tas · Aksesori", q: "12 pcs", p: "Rp 95.000 / pc", a: "Rp 1.140.000", icon: BAG },
]

const Item = ({ it }: { it: (typeof ITEMS)[number] }) => (
  <div className="ly-it">
    <span className="ly-thumb">{it.icon}</span>
    <div>{it.name}<span className="s">{it.sub}</span></div>
  </div>
)

const Close = () => (
  <span className="ly-close"><X className="i" /></span>
)

/** Window-local hit points the pointer aims at, relative to the sheet box. */
export const RECORD_EDIT = { dx: -54, dy: -33 }
export const RECORD_ADD = { dx: -78, dy: 115 + 24 + 34 + 68 + 20 + 18 }

export function RecordSheet({
  view = 1,
  edit = 0,
  pressEdit = 1,
  pressAdd = 1,
}: {
  view?: number
  edit?: number
  pressEdit?: number
  pressAdd?: number
}) {
  return (
    <div className="ly-surface">
      {view > 0 && (
        <div className="ly-surface" style={{ opacity: view }}>
          <div className="ly-head">
            <div>
              <div className="ly-path">Purchase Orders<span>/</span>PO-0002-OPE6</div>
              <h1>Sepatu Sejahtera, CV</h1>
              <span className="ly-sub"><span className="ly-st">Active</span> · 3 items</span>
            </div>
            <Close />
          </div>
          <div className="ly-body">
            <div className="ly-kpis">
              <div className="ly-kpi"><span>Delivery Date</span><strong>19 Nov 2026</strong></div>
              <div className="ly-kpi"><span>Payment</span><strong>Giro</strong></div>
              <div className="ly-kpi"><span>Ordered</span><strong>36 pcs</strong></div>
              <div className="ly-kpi"><span>Grand Total</span><strong>Rp 4.470.000</strong></div>
            </div>
            <div className="ly-sbar"><span className="ly-stitle">Order items<span>3</span></span></div>
            <div className="ly-tbl">
              <table>
                <thead><tr><th>Item</th><th className="r">Ordered</th><th className="r">Unit Price</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {ITEMS.map((it) => (
                    <tr key={it.name}><td><Item it={it} /></td><td className="r">{it.q}</td><td className="r">{it.p}</td><td className="r">{it.a}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ly-sect"><span>Notes</span>Pesanan demo</div>
            <div className="ly-disclose"><ChevronRight className="i" style={{ width: 16 }} />Activity<i>1</i></div>
          </div>
          <div className="ly-foot">
            <span className="ly-btn ghost" style={{ marginRight: "auto" }}>Print</span>
            <span className="ly-btn danger">Cancel order</span>
            <span className="ly-btn ghost" style={{ scale: String(pressEdit) }}>Edit</span>
          </div>
        </div>
      )}
      {edit > 0 && (
        <div className="ly-surface" style={{ opacity: edit }}>
          <div className="ly-head">
            <div>
              <div className="ly-path">Purchase Orders<span>/</span>PO-0002-OPE6</div>
              <h1>Edit purchase order</h1>
              <span className="ly-sub">Sepatu Sejahtera, CV</span>
            </div>
            <Close />
          </div>
          <div className="ly-body">
            <div className="ly-stitle" style={{ marginBottom: 14 }}>Order details</div>
            <div className="ly-fields">
              <label>Supplier<span className="ly-inp">Sepatu Sejahtera, CV<ChevronDown className="i" style={{ width: 16, marginLeft: "auto" }} /></span></label>
              <label>Delivery date<span className="ly-inp">19 Nov 2026</span></label>
              <label>Payment terms<span className="ly-inp">30 days<ChevronDown className="i" style={{ width: 16, marginLeft: "auto" }} /></span></label>
              <label>Payment method<span className="ly-inp">Giro<ChevronDown className="i" style={{ width: 16, marginLeft: "auto" }} /></span></label>
            </div>
            <div className="ly-sbar">
              <span className="ly-stitle">Order items<span>3</span></span>
              <span className="ly-btn primary" style={{ scale: String(pressAdd) }}>+ Add item</span>
            </div>
            <div className="ly-tbl">
              <table>
                <thead><tr><th>Item</th><th className="r">Quantity</th><th className="r">Unit Price</th><th className="r">Amount</th><th style={{ width: 90 }} /></tr></thead>
                <tbody>
                  {ITEMS.map((it) => (
                    <tr key={it.name}>
                      <td><Item it={it} /></td><td className="r">{it.q}</td><td className="r">{it.p}</td><td className="r">{it.a}</td>
                      <td><div className="ly-acts"><span><Pencil className="i" style={{ width: 16 }} /></span><span><Trash2 className="i" style={{ width: 16 }} /></span></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ly-kpis" style={{ marginTop: 20, height: "auto" }}>
              <div className="ly-kpi"><span>Quantity</span><strong>36 pcs</strong></div>
              <div className="ly-kpi"><span>Total</span><strong>Rp 4.470.000</strong></div>
              <div className="ly-kpi"><span>Discount</span><strong><span className="ly-seg"><b className="on">%</b><b>Rp</b></span><span className="ly-kinp">0</span></strong></div>
              <div className="ly-kpi"><span>Grand Total</span><strong>Rp 4.470.000</strong></div>
            </div>
          </div>
          <div className="ly-foot">
            <span className="ly-btn danger">Cancel</span>
            <span className="ly-btn primary">Review order</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── the nested sheet: Add item ────────────────────────────────────────── */

export function NestedSheet() {
  return (
    <div className="ly-surface">
      <div className="ly-head">
        <div>
          <div className="ly-path">PO-0002-OPE6<span>/</span>New item</div>
          <h1>Add item</h1>
          <span className="ly-sub">Sepatu Sejahtera, CV</span>
        </div>
        <Close />
      </div>
      <div className="ly-body">
        <div className="ly-group">
          <h2>Item information</h2>
          <div style={{ display: "flex", gap: 16 }}>
            <div className="ly-photo"><span><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></svg></span>Photo</div>
            <div className="ly-fields" style={{ gridTemplateColumns: "1fr", flex: 1, margin: 0, gap: 12 }}>
              <label>Name<span className="ly-inp">Sandal Jepit Karet</span></label>
              <label>Description<span className="ly-inp" style={{ color: "#8e8e93" }}>Add a short description</span></label>
            </div>
          </div>
        </div>
        <div className="ly-group">
          <h2>Classification</h2>
          <div className="ly-fields two" style={{ margin: 0 }}>
            <label>Division<span className="ly-inp">Sandal sepatu<ChevronDown className="i" style={{ width: 16, marginLeft: "auto" }} /></span></label>
            <label>Tags<span className="ly-inp">Sepatu</span></label>
            <label>Colors<span className="ly-inp">Hitam, Navy</span></label>
            <label>Sizes<span className="ly-inp">39–43</span></label>
          </div>
        </div>
        <div className="ly-group">
          <h2>Purchase details</h2>
          <div className="ly-fields two" style={{ margin: 0 }}>
            <label>Purchase price<span className="ly-inp"><span className="u">Rp</span>35000<span className="u" style={{ marginLeft: "auto" }}>/ pc</span></span></label>
            <label>Quantity<span className="ly-inp">24<span className="u" style={{ marginLeft: "auto" }}>pcs</span></span></label>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <span className="mute">Item total</span><strong style={{ fontWeight: 600 }}>Rp 840.000</strong>
          </div>
        </div>
      </div>
      <div className="ly-foot">
        <span className="ly-check"><span />Add another</span>
        <span className="ly-btn danger">Cancel</span>
        <span className="ly-btn primary">Add item</span>
      </div>
    </div>
  )
}

/** The macOS pointer, tip at (0, 0). */
export function Pointer({ x, y, down = 0, scale = 1 }: { x: number; y: number; down?: number; scale?: number }) {
  return (
    <svg
      width={26}
      height={34}
      viewBox="0 0 26 34"
      style={{
        position: "absolute",
        left: x,
        top: y,
        scale: String(scale * (1 - 0.12 * Math.sin(Math.PI * down))),
        transformOrigin: "0 0",
        filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 25%))",
      }}
    >
      <path d="M2 2 L2 26 L8 20 L12 30 L16 28 L12 19 L20 19 Z" fill="#111" stroke="#fff" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

/* ── where a sheet sits: depth 1 lies on the page's edge, each deeper
      layer 8px further in (C) — 12px in A ─────────────────────────────── */

export function sheetAt(look: Look, w: number, depth = 1): Box {
  const { page } = frames(look)
  const step = look === "c" ? 8 : 12
  const inset = step * (depth - 1)
  const top = look === "c" ? page.y : 12
  const right = look === "c" ? page.x + page.w : WIN.w - 12
  const h = look === "c" ? page.h : WIN.h - 24
  return { x: right - inset - w, y: top + inset, w, h: h - 2 * inset, r: 16 }
}

/** The bell's row in the rail and the Ask AI row, as window points. */
export const BELL = { x: 32, y: railBottomY(0) + 20 }
export const AI_ROW = { x: 32, y: railY(1) + 20 }

function Head({ path, title, sub }: { path: ReactNode; title: string; sub: ReactNode }) {
  return (
    <div className="ly-head">
      <div>
        <div className="ly-path">{path}</div>
        <h1>{title}</h1>
        <span className="ly-sub">{sub}</span>
      </div>
      <Close />
    </div>
  )
}

const caretStyle: CSSProperties = {
  display: "inline-block",
  width: 1.5,
  height: 19,
  background: "#2862dc",
  marginLeft: 1,
  verticalAlign: "-3px",
}

/* ── Notifications: a list in the table slot ───────────────────────────── */

export const NOTES = [
  { title: "Review Count ready", line: "PO-0001-OPE5 · 28 of 30 pcs", time: "09:05", unread: true },
  { title: "Delivery date changed", line: "PO-0002-OPE6 · now 19 Nov 2026", time: "08:40", unread: true },
  { title: "Return PO handed over", line: "RS-00000001 · Garmen Nusantara, PT", time: "13 Oct 2026", unread: false },
]
/** Sheet-local centre of list row n (head 115, body 24, frame 1). */
export const noteY = (n: number) => 115 + 24 + 1 + n * ROW_H + ROW_H / 2

export function NotificationsSheet({ hover = -1, unread = 1 }: { hover?: number; unread?: number }) {
  return (
    <div className="ly-surface">
      <Head path="Central" title="Notifications" sub={unread > 0.5 ? "2 new" : "All read"} />
      <div className="ly-body">
        <div className="ly-tbl">
          <table>
            <tbody>
              {NOTES.map((n, i) => (
                <tr key={n.title} style={{ background: hover === i ? "#faf9f7" : undefined }}>
                  <td style={{ width: 28, paddingRight: 0 }}>
                    <span style={{ display: "block", width: 8, height: 8, borderRadius: 4, background: "#2862dc", opacity: n.unread ? unread : 0 }} />
                  </td>
                  <td style={{ paddingLeft: 6, whiteSpace: "normal" }}>
                    <span style={{ fontWeight: n.unread && unread > 0.5 ? 600 : 400 }}>{n.title}</span>
                    <span className="s">{n.line}</span>
                  </td>
                  <td className="r mute" style={{ fontSize: 14, verticalAlign: "top", paddingTop: 13 }}>{n.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="ly-foot">
        <span className="ly-btn primary">Mark all as read</span>
      </div>
    </div>
  )
}

/* ── Search: the field in the bar slot, results in the table slot ──────── */

export const SEARCH_QUERY = "sepatu"
const GROUPS = [
  { label: "Suppliers", rows: [["Sepatu Sejahtera, CV", "0002 · Active"]] },
  {
    label: "Purchase Orders",
    rows: [
      ["PO-0002-OPE6", "Sepatu Sejahtera, CV · 3 items · Active"],
      ["PO-0002-OPE5", "Sepatu Sejahtera, CV · 2 items · Active"],
      ["PO-0002-REC1", "Sepatu Sejahtera, CV · 2 items · Active"],
    ],
  },
  {
    label: "Articles",
    rows: [
      ["Sneakers Kanvas Low", "10000001 · Sandal sepatu"],
      ["Flat Shoes Wanita", "10000002 · Sandal sepatu"],
    ],
  },
] as const
const GROUP_H = 36
const RESULT_H = 58
/** Sheet-local centre of the PO-0002-OPE6 result. */
export const SEARCH_HIT = { dx: 28 + 120, y: 115 + 24 + 50 + 1 + GROUP_H + RESULT_H + GROUP_H + RESULT_H / 2 }
/** Sheet-local centre of the search field. */
export const SEARCH_FIELD = { dx: 28 + 160, y: 115 + 24 + 18 }

const mark = (text: string) => {
  const i = text.toLowerCase().indexOf(SEARCH_QUERY)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <b style={{ fontWeight: 650 }}>{text.slice(i, i + SEARCH_QUERY.length)}</b>
      {text.slice(i + SEARCH_QUERY.length)}
    </>
  )
}

export function SearchSheet({
  query,
  caret = true,
  results = () => 1,
  hover = "",
}: {
  query: string
  caret?: boolean
  /** Arrival of result row n, counting group labels. */
  results?: (n: number) => number
  hover?: string
}) {
  let n = 0
  return (
    <div className="ly-surface">
      <Head path="Central" title="Search" sub="⌘K" />
      <div className="ly-body">
        <div className="ly-bar">
          <span
            className="ly-field"
            style={{ flex: 1, color: "#1d1d1f", fontSize: 15, borderColor: "#2862dc", boxShadow: "0 0 0 3px rgb(40 98 220 / 15%)" }}
          >
            <Search className="i" style={{ width: 16, color: "#77736e" }} />
            <span>
              {query || <span className="mute">Search menus and records</span>}
              {caret && <span style={caretStyle} />}
            </span>
          </span>
        </div>
        <div className="ly-tbl" style={{ opacity: results(0) > 0 ? 1 : 0 }}>
          {GROUPS.map((g) => {
            const gk = results(n++)
            return (
              <div key={g.label}>
                <div style={{ height: GROUP_H, display: "flex", alignItems: "center", padding: "0 16px", background: "#faf9f7", fontSize: 14, color: "#77736e", fontWeight: 500, borderBottom: "1px solid #eae8e4", opacity: gk }}>
                  {g.label}
                </div>
                {g.rows.map(([name, sub]) => {
                  const k = results(n++)
                  return (
                    <div
                      key={name}
                      style={{
                        height: RESULT_H,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0 16px",
                        borderBottom: "1px solid #efede9",
                        background: hover === name ? "#faf9f7" : undefined,
                        opacity: k,
                        translate: `0px ${(1 - k) * 6}px`,
                      }}
                    >
                      <div>
                        {mark(name)}
                        <span style={{ display: "block", fontSize: 14, color: "#77736e", marginTop: 1 }}>{mark(sub)}</span>
                      </div>
                      <ChevronRight className="i" style={{ width: 16, color: "#aba49a" }} />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="ly-foot">
        <span className="ly-btn ghost"><span className="ly-ai" style={{ width: "auto" }}>AI</span>Ask AI</span>
      </div>
    </div>
  )
}

/* ── Ask AI: the conversation in the body, the composer in the foot ────── */

export const AI_PROMPT = "Which orders arrived short?"
export const AI_ANSWER = "2 orders arrived short this week."
/** Sheet-local centre of the composer field and of its send button. */
export const AI_COMPOSER = { dx: 28 + 180, dy: -33 }
export const AI_SEND = { dx: -28 - 18, dy: -33 }

export function AiSheet({
  draft,
  caret = true,
  sent = 0,
  answer = "",
  rows = () => 0,
  pressSend = 1,
}: {
  draft: string
  caret?: boolean
  sent?: number
  answer?: string
  rows?: (n: number) => number
  pressSend?: number
}) {
  return (
    <div className="ly-surface">
      <Head path="Central" title="Ask AI" sub="Purchase Orders" />
      <div className="ly-body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {sent <= 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            {[AI_PROMPT, "Orders due this week", "Biggest supplier this month"].map((s) => (
              <span key={s} className="ly-btn ghost">{s}</span>
            ))}
          </div>
        )}
        {sent > 0 && (
          <div style={{ alignSelf: "flex-end", maxWidth: 360, background: "#f3f2ef", borderRadius: 16, padding: "9px 14px", opacity: sent, translate: `0px ${(1 - sent) * 10}px` }}>
            {AI_PROMPT}
          </div>
        )}
        {answer && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <span className="ly-ai" style={{ width: "auto" }}>AI</span>
              <span>{answer}</span>
            </div>
            <div className="ly-tbl" style={{ opacity: rows(0) > 0 ? 1 : 0 }}>
              <table>
                <tbody>
                  {[
                    ["Garmen Nusantara, PT", "PO-0001-OPE5 · 2 items", "28", "30 pcs"],
                    ["Garmen Nusantara, PT", "PO-0001-OPE2 · 3 items", "34", "36 pcs"],
                  ].map(([sup, po, got, of], i) => (
                    <tr key={po} style={{ opacity: rows(i), translate: `0px ${(1 - rows(i)) * 6}px` }}>
                      <td>{sup}<span className="s">{po}</span></td>
                      <td className="r"><span className="late">{got}</span> of {of}<span className="s">Received</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div className="ly-foot" style={{ gap: 8 }}>
        <span className="ly-field" style={{ flex: 1, color: "#1d1d1f", fontSize: 15 }}>
          <span>
            {draft || <span className="mute">Ask about this page…</span>}
            {caret && <span style={caretStyle} />}
          </span>
        </span>
        <span className="ly-btn primary" style={{ width: 36, padding: 0, justifyContent: "center", scale: String(pressSend) }}>
          <ChevronRight className="i" style={{ width: 18, rotate: "-90deg" }} />
        </span>
      </div>
    </div>
  )
}

/* ── a key on a keyboard, for the ⌘K and Escape beats (screen space) ──── */

export function Keycap({ label, size, down = 0 }: { label: string; size: number; down?: number }) {
  const depth = size * 0.06
  return (
    <span
      style={{
        width: size * (label.length > 1 ? 1.5 : 1),
        height: size,
        borderRadius: size * 0.2,
        background: "#fff",
        display: "grid",
        placeItems: "center",
        fontFamily: '"Inter Variable", Inter, sans-serif',
        fontSize: size * (label.length > 1 ? 0.3 : 0.44),
        fontWeight: 500,
        color: "#1d1d1f",
        boxShadow: `0 0 0 1px rgb(0 0 0 / 7%), 0 ${depth * (1 - down)}px 0 #d9d5cf, 0 ${depth * 3 * (1 - down) + 2}px ${depth * 5}px rgb(0 0 0 / 10%)`,
        translate: `0px ${depth * down}px`,
      }}
    >
      {label}
    </span>
  )
}
