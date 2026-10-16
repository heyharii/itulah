/* The rest of the outbound film's screens.

   MD's side, as the hub has it today (Merchandise › Allotments, measured on
   :5480): the Unallotted list grouped by supplier, the floating "Make new
   allotment" bar, and the New allotment matrix (SKUs down, stores across,
   Stock and Left, the quick-fill menu, Submit all).

   The warehouse's dialogs and the MD / Inventory follow-ups are the outbound
   prototype's (outbound-board-prototype.html): Picked, Pack (koli),
   Dispatch, Cancel allotment, Still needed, Stock checks. */
import type { CSSProperties, ReactNode } from "react"
import { Check, Minus, Plus, Printer, Search, Wand2 } from "lucide-react"
import { num } from "../format"
import { PageTitle } from "./AppWindow"
import { Button, Card, cn } from "./kit"

const H = "px-4 py-2.5 text-[0.875rem] font-medium text-body"

function Stepper({ value, dim }: { value: number; dim?: boolean }) {
  return (
    <span className="flex justify-end gap-2">
      <span className={cn("grid size-10 place-items-center rounded-inner border border-hairline-2", (!value || dim) && "opacity-35")}>
        <Minus className="size-4 text-line-ico" />
      </span>
      <span className="grid h-10 w-14 place-items-center rounded-inner border border-hairline-2 text-[0.9375rem] text-ink tabular-nums">
        {value}
      </span>
      <span className={cn("grid size-10 place-items-center rounded-inner border border-hairline-2", dim && "opacity-35")}>
        <Plus className="size-4 text-line-ico" />
      </span>
    </span>
  )
}

/** A centred dialog in the prototype's anatomy: head, body, foot. */
function Dlg({
  width,
  title,
  sub,
  children,
  foot,
  style,
}: {
  width: number
  title: ReactNode
  sub?: ReactNode
  children: ReactNode
  foot: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      className="absolute top-1/2 left-1/2 overflow-hidden rounded-card border border-hairline-2 bg-canvas shadow-float"
      style={{ width, translate: "-50% -50%", ...style }}
    >
      <div className="border-b border-hairline px-6 py-4">
        <div className="text-[1.25rem] font-semibold tracking-[-0.01em] text-ink">{title}</div>
        {sub && <div className="font-mono text-[0.875rem] text-mute">{sub}</div>}
      </div>
      <div className="flex flex-col gap-4 px-6 py-5">{children}</div>
      <div className="flex items-center gap-3 border-t border-hairline px-6 py-3.5">{foot}</div>
    </div>
  )
}

/* ── MD · Unallotted ────────────────────────────────────────────────── */

export interface UnallottedArticle {
  name: string
  code: string
  qty: number
  colors: string
  sizes: string
  date: string
  shade: string
}

export function UnallottedPage({
  groups,
  ticked,
  bar,
}: {
  groups: { supplier: string; articles: UnallottedArticle[] }[]
  ticked?: string
  /** The floating bar once something is ticked, and its button's state. */
  bar?: { k: number; hot?: boolean; pressed?: number }
}) {
  const sel = groups.flatMap((g) => g.articles).find((a) => a.code === ticked)
  return (
    <div className="relative h-[852px] w-[1076px]">
      <PageTitle>Allotments</PageTitle>
      <div className="grid grid-cols-4 gap-3">
        {[
          ["Active", "6"],
          ["Completed", "4"],
          ["Not shipped yet", "1.214"],
          ["In transit", "610"],
        ].map(([l, v]) => (
          <Card key={l} className="px-4 py-3">
            <div className="text-[0.9375rem] text-body">{l}</div>
            <div className="mt-0.5 text-kpi font-semibold text-ink tabular-nums">{v}</div>
          </Card>
        ))}
      </div>
      <div className="mt-4 flex h-10 items-stretch gap-1 border-b border-hairline">
        {[
          ["Unallotted", 3, true],
          ["Allotted", 10, false],
          ["Still needed", 1, false],
        ].map(([l, n, on]) => (
          <div
            key={String(l)}
            className={cn("relative flex items-center gap-1.5 px-3 text-[0.875rem] font-medium", on ? "text-ink" : "text-body")}
          >
            {l} <span className="text-mute">{n}</span>
            {on && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
          </div>
        ))}
      </div>
      <div className="mt-4 mb-3 flex h-[34px] w-[440px] items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] text-faint">
        <Search className="size-4 text-line-ico" />
      </div>
      <Card className="overflow-hidden">
        {groups.map((g) => {
          const any = g.articles.some((a) => a.code === ticked)
          return (
            <div key={g.supplier}>
              <div className={cn("flex items-center gap-3 border-b border-hairline px-5 py-3", any && "bg-accent-bg/60")}>
                <span className={cn("grid size-[18px] place-items-center rounded-[5px] border", any ? "border-ink bg-ink text-white" : "border-hairline-strong bg-canvas")}>
                  {any && <Minus className="size-3" strokeWidth={3} />}
                </span>
                <span>
                  <span className="block text-[0.9375rem] font-medium text-ink">{g.supplier}</span>
                  <span className="text-[0.875rem] text-mute">
                    {g.articles.length} articles · {num(g.articles.reduce((s, a) => s + a.qty, 0))} pcs free
                    {any && <span className="text-accent"> · 1 selected</span>}
                  </span>
                </span>
              </div>
              <div className="flex h-9 items-center border-b border-hairline text-[0.875rem] font-medium text-body">
                <div className="w-14" />
                <div className="flex-1 px-3">Article</div>
                <div className="w-28 px-4 text-right">Quantity</div>
                <div className="w-52 px-4">Colors</div>
                <div className="w-28 px-4">Sizes</div>
                <div className="w-36 px-4">Setup date</div>
              </div>
              {g.articles.map((a) => {
                const on = a.code === ticked
                return (
                  <div key={a.code} className={cn("flex h-[58px] items-center border-b border-hairline", on && "bg-soft")}>
                    <div className="grid w-14 place-items-center">
                      <span className={cn("grid size-[18px] place-items-center rounded-[5px] border", on ? "border-ink bg-ink text-white" : "border-hairline-strong bg-canvas")}>
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                    </div>
                    <div className="flex flex-1 items-center gap-3 px-3">
                      <span className="size-9 rounded-inner" style={{ background: a.shade }} />
                      <span>
                        <span className="block text-[0.9375rem] font-medium text-ink">{a.name}</span>
                        <span className="font-mono text-[0.875rem] text-mute">{a.code}</span>
                      </span>
                    </div>
                    <div className="w-28 px-4 text-right text-[0.9375rem] text-ink tabular-nums">
                      <b className="font-medium">{num(a.qty)}</b> <span className="text-mute">pcs</span>
                    </div>
                    <div className="w-52 px-4 text-[0.9375rem] text-text">{a.colors}</div>
                    <div className="w-28 px-4 text-[0.9375rem] text-text">{a.sizes}</div>
                    <div className="w-36 px-4 text-[0.9375rem] text-text">{a.date}</div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </Card>
      {bar && bar.k > 0 && sel && (
        <div
          className="absolute bottom-6 left-1/2 flex w-[540px] items-center gap-4 rounded-card border border-hairline-strong bg-canvas px-5 py-3 shadow-pop"
          style={{ translate: `-50% ${(1 - bar.k) * 12}px`, opacity: bar.k }}
        >
          <span className="flex-1 text-[0.9375rem] text-body">
            <b className="font-medium text-ink">1 article</b> · 1 supplier · <b className="font-medium text-ink">{num(sel.qty)} pcs</b> selected
          </span>
          <Button variant="quiet">Clear</Button>
          <Button variant="primary" hover={bar.hot} pressed={bar.pressed}>
            Make new allotment
          </Button>
        </div>
      )}
    </div>
  )
}

/* ── MD · New allotment ─────────────────────────────────────────────── */

export interface MatrixSku {
  label: string
  code: string
  stock: number
}

export function NewAllotmentPage({
  supplier,
  article,
  stores,
  skus,
  cells,
  focus,
  menu,
  saved,
  submit,
}: {
  supplier: string
  article: { name: string; code: string; shade: string }
  stores: { name: string; code: string }[]
  skus: readonly MatrixSku[]
  /** cells[sku][store], 0 for empty. */
  cells: readonly (readonly number[])[]
  /** The cell being typed in. */
  focus?: { row: number; col: number }
  /** The quick-fill menu: 0..1 open, and which option the pointer is on. */
  menu?: { k: number; hot?: number }
  saved?: string
  submit?: { hot?: boolean; pressed?: number }
}) {
  const total = skus.reduce((s, k) => s + k.stock, 0)
  const given = cells.flat().reduce((s, n) => s + n, 0)
  const lines = cells.flat().filter((n) => n > 0).length
  const storesUsed = stores.filter((_, j) => cells.some((r) => r[j] > 0)).length
  const COL = 104
  return (
    <div className="relative h-[852px] w-[1076px]">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">
            New allotment <span className="font-normal text-body">· {supplier}</span>
          </div>
          <div className="text-[0.875rem] text-mute">1 article · {num(total)} pcs to allot</div>
        </div>
        <Button variant="ghost">Back</Button>
      </div>
      <Card className="overflow-hidden">
        <div className="p-3">
          <div className="flex h-[34px] w-[440px] items-center gap-2 rounded-inner border border-hairline-2 px-2.5 text-[0.875rem] text-faint">
            <Search className="size-4 text-line-ico" />
          </div>
        </div>
        <div className="flex border-b border-hairline text-[0.875rem] font-medium text-body">
          <div className="w-[260px] px-4 py-3">Article</div>
          <div className="w-16 px-2 py-3 text-right">Stock</div>
          {stores.map((st) => (
            <div key={st.code} className="py-2 text-center" style={{ width: COL }}>
              <div className="font-mono text-[0.875rem] text-ink">{st.code}</div>
              <div className="text-[0.875rem] text-mute">{st.name}</div>
            </div>
          ))}
          <div className="w-16 px-3 py-3 text-right">Left</div>
        </div>
        <div className="flex items-center border-b border-hairline bg-soft">
          <div className="relative flex w-[260px] items-center gap-3 px-4 py-2.5">
            <span className="size-9 rounded-inner" style={{ background: article.shade }} />
            <span className="flex-1">
              <span className="block text-[0.9375rem] font-medium text-ink">{article.name}</span>
              <span className="font-mono text-[0.875rem] text-mute">{article.code}</span>
            </span>
            <span className={cn("grid size-8 place-items-center rounded-inner", menu && menu.k > 0 ? "bg-accent-bg text-accent" : "text-line-ico")}>
              <Wand2 className="size-4" />
            </span>
            {menu && menu.k > 0 && (
              <div
                className="absolute top-12 left-[180px] z-20 w-[300px] rounded-card border border-hairline-2 bg-canvas p-1 shadow-pop"
                style={{ opacity: menu.k, scale: String(0.97 + 0.03 * menu.k), transformOrigin: "top left" }}
              >
                <div className="px-2.5 pt-1.5 pb-1 text-[0.875rem] font-medium text-body">Fill this article</div>
                {["Everything to one store…", "Split evenly across all stores", "Split across chosen stores…"].map((o, i) => (
                  <div
                    key={o}
                    className={cn("flex h-9 items-center rounded-inner px-2.5 text-[0.9375rem]", menu.hot === i ? "bg-soft-2 text-ink" : "text-text")}
                  >
                    {o}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="w-16 px-2 text-right text-[0.9375rem] font-medium text-ink tabular-nums">{num(total)}</div>
          <div style={{ width: COL * stores.length }} />
          <div className="w-16 px-3 text-right text-[0.9375rem] text-mute tabular-nums">{num(total - given)}</div>
        </div>
        {skus.map((k, i) => {
          const left = k.stock - cells[i].reduce((s, n) => s + n, 0)
          return (
            <div key={k.code} className="flex h-[52px] items-center border-b border-hairline last:border-b-0">
              <div className="w-[260px] py-1.5 pr-4 pl-16">
                <div className="text-[0.9375rem] text-ink">{k.label}</div>
                <div className="font-mono text-[0.875rem] text-mute">{k.code}</div>
              </div>
              <div className="w-16 px-2 text-right text-[0.9375rem] text-body tabular-nums">{k.stock}</div>
              {stores.map((st, j) => {
                const v = cells[i][j]
                const on = focus?.row === i && focus.col === j
                return (
                  <div key={st.code} className="px-1.5" style={{ width: COL }}>
                    <div
                      className={cn(
                        "flex h-9 items-center justify-center rounded-inner border text-[0.9375rem] tabular-nums",
                        on ? "border-accent shadow-[0_0_0_3px_rgb(37_99_235/12%)]" : "border-hairline-2",
                        v ? "text-ink" : "text-faint"
                      )}
                    >
                      {v || ""}
                    </div>
                  </div>
                )
              })}
              <div className={cn("w-16 px-3 text-right text-[0.9375rem] tabular-nums", left === 0 ? "text-ok-fg" : "text-mute")}>
                {left}
              </div>
            </div>
          )
        })}
      </Card>
      <div className="absolute inset-x-6 bottom-6 flex items-center gap-6 rounded-card border border-hairline-strong bg-canvas px-5 py-3 shadow-pop">
        {saved ? (
          <span className="flex-1 text-[0.9375rem] text-ok-fg">{saved}</span>
        ) : (
          <span className="flex flex-1 gap-6 text-[0.9375rem] text-body">
            {[
              ["Articles", 1],
              ["SKUs", skus.length],
              ["Pcs", given],
              ["Lines", lines],
              ["Stores", storesUsed],
            ].map(([l, v]) => (
              <span key={String(l)}>
                {l} <b className="font-semibold text-ink tabular-nums">{num(Number(v))}</b>
              </span>
            ))}
          </span>
        )}
        <Button variant="ghost" disabled={!given || !!saved} hover={submit?.hot} pressed={submit?.pressed}>
          Submit all
        </Button>
        <Button variant="primary">Done</Button>
      </div>
    </div>
  )
}

/* ── Warehouse · Picked ─────────────────────────────────────────────── */

export interface PickLine {
  name: string
  sku: string
  toPick: number
  picked: number
}

export const SHORT_REASONS = [
  "Stock at rack could not be confirmed",
  "Item not found at the rack",
  "Item damaged",
  "Label or equipment problem",
  "Other",
]

export function PickDialog({
  store,
  allotment,
  lines,
  reason,
  hot,
  pressed,
  style,
}: {
  store: string
  allotment: string
  lines: readonly PickLine[]
  /** Index into SHORT_REASONS once one is chosen; -1 asks. */
  reason?: number
  hot?: boolean
  pressed?: number
  style?: CSSProperties
}) {
  const pcs = lines.reduce((s, l) => s + l.toPick, 0)
  const got = lines.reduce((s, l) => s + l.picked, 0)
  const short = pcs - got
  return (
    <Dlg
      width={736}
      title={store}
      sub={`${allotment} · ${num(pcs)} pcs`}
      style={style}
      foot={
        <>
          <span className="flex-1 text-[0.9375rem]">
            {short ? <b className="font-semibold text-bad-fg">{num(short)} pcs unfulfilled</b> : <span className="text-body">Everything picked</span>}
          </span>
          <Button variant="primary" hover={hot} pressed={pressed} disabled={short > 0 && (reason === undefined || reason < 0)}>
            {short ? `Picked ${num(got)} · report ${num(short)}` : `Picked ${num(got)} pcs`}
          </Button>
        </>
      }
    >
      <Card className="overflow-hidden shadow-none">
        <div className="flex border-b border-hairline bg-soft">
          <div className={cn(H, "w-12")}>No.</div>
          <div className={cn(H, "flex-1")}>SKU</div>
          <div className={cn(H, "w-20 text-right")}>To pick</div>
          <div className={cn(H, "w-48 text-right")}>Picked</div>
        </div>
        {lines.map((l, i) => (
          <div key={l.sku} className={cn("flex items-center border-b border-hairline", l.picked < l.toPick && "bg-bad-bg/50")}>
            <div className="w-12 px-4 text-[0.9375rem] text-mute">{i + 1}</div>
            <div className="flex-1 px-4 py-2">
              <div className="text-[0.9375rem] font-medium text-ink">{l.name}</div>
              <div className="font-mono text-[0.875rem] text-mute">{l.sku}</div>
            </div>
            <div className="w-20 px-4 text-right text-[0.9375rem] text-body tabular-nums">{l.toPick}</div>
            <div className="w-48 px-4">
              <Stepper value={l.picked} />
            </div>
          </div>
        ))}
        <div className="flex bg-soft-2 text-[0.9375rem] font-medium">
          <div className="w-12" />
          <div className="flex-1 px-4 py-3 text-ink">Total</div>
          <div className="w-20 px-4 py-3 text-right text-ink tabular-nums">{num(pcs)}</div>
          <div className={cn("w-48 px-4 py-3 text-right tabular-nums", short ? "text-bad-fg" : "text-ink")}>{num(got)}</div>
        </div>
      </Card>
      {short > 0 && reason !== undefined && (
        <div className="rounded-card border border-bad/30 bg-bad-bg/40 px-4 py-3.5">
          <div className="mb-2.5 text-[0.9375rem] font-semibold text-bad-fg">{num(short)} pcs can’t be picked</div>
          <div className="flex flex-wrap gap-2">
            {SHORT_REASONS.map((r, i) => (
              <span
                key={r}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-[0.9375rem]",
                  reason === i ? "border-ink bg-ink text-white" : "border-hairline-2 bg-canvas text-text"
                )}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </Dlg>
  )
}

/* ── Warehouse · Pack ───────────────────────────────────────────────── */

export function PackDialog({
  store,
  allotment,
  lines,
  closed,
  hot,
  pressed,
  style,
}: {
  store: string
  allotment: string
  /** Left to pack and in the open koli, per SKU. */
  lines: readonly { name: string; sku: string; left: number; inKoli: number }[]
  /** Koli already closed, with their pieces. */
  closed: readonly number[]
  hot?: boolean
  pressed?: number
  style?: CSSProperties
}) {
  const pcs = lines.reduce((s, l) => s + l.left + l.inKoli, 0) + closed.reduce((a, b) => a + b, 0)
  const left = lines.reduce((s, l) => s + l.left, 0)
  const inKoli = lines.reduce((s, l) => s + l.inKoli, 0)
  const done = left + inKoli === 0
  const n = closed.length + 1
  return (
    <Dlg
      width={736}
      title={store}
      sub={`${allotment} · ${num(pcs)} pcs`}
      style={style}
      foot={
        done ? (
          <>
            <span className="flex-1" />
            <Button variant="primary" hover={hot} pressed={pressed}>
              Done · {closed.length} koli
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 text-[0.9375rem] text-body">{num(left)} pcs left</span>
            <Button variant="primary" hover={hot} pressed={pressed} disabled={!inKoli}>
              Close koli {n}
              {inKoli ? ` · ${num(inKoli)} pcs` : ""}
            </Button>
          </>
        )
      }
    >
      {closed.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {closed.map((k, i) => (
            <span key={i} className="inline-flex items-center gap-2 rounded-inner bg-ok-bg px-3 py-1.5 text-[0.9375rem] text-ok-fg">
              <b className="font-mono font-semibold">K{String(i + 1).padStart(2, "0")}</b> {num(k)} pcs
            </span>
          ))}
        </div>
      )}
      {done ? (
        <div className="flex items-center gap-2.5 rounded-card bg-ok-bg px-4 py-3.5 text-[0.9375rem] font-medium text-ok-fg">
          <Check className="size-[18px]" /> Everything is in a koli.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[1rem] font-semibold text-ink">Koli {n}</span>
            <span className="text-[0.9375rem] text-accent">Put everything left in</span>
          </div>
          <Card className="overflow-hidden shadow-none">
            <div className="flex border-b border-hairline bg-soft">
              <div className={cn(H, "w-12")}>No.</div>
              <div className={cn(H, "flex-1")}>SKU</div>
              <div className={cn(H, "w-20 text-right")}>Left</div>
              <div className={cn(H, "w-48 text-right")}>In koli {n}</div>
            </div>
            {lines.map((l, i) => (
              <div key={l.sku} className="flex items-center border-b border-hairline last:border-b-0">
                <div className="w-12 px-4 text-[0.9375rem] text-mute">{i + 1}</div>
                <div className="flex-1 px-4 py-2">
                  <div className="text-[0.9375rem] font-medium text-ink">{l.name}</div>
                  <div className="font-mono text-[0.875rem] text-mute">{l.sku}</div>
                </div>
                <div className="w-20 px-4 text-right text-[0.9375rem] text-body tabular-nums">{l.left}</div>
                <div className="w-48 px-4">
                  <Stepper value={l.inKoli} dim={!l.left && !l.inKoli} />
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </Dlg>
  )
}

/* ── Warehouse · Dispatch ───────────────────────────────────────────── */

export function DispatchDialog({
  rows,
  notes,
  caret,
  hot,
  pressed,
  style,
}: {
  rows: readonly { store: string; allotment: string; koli: number; pcs: number }[]
  notes: string
  caret?: boolean
  hot?: boolean
  pressed?: number
  style?: CSSProperties
}) {
  return (
    <Dlg
      width={640}
      title="Dispatch"
      style={style}
      foot={
        <>
          <span className="flex-1 text-[0.9375rem] text-body">
            {rows.length} surat jalan · {rows.reduce((s, r) => s + r.koli, 0)} koli
          </span>
          <Button variant="primary" hover={hot} pressed={pressed}>
            <Printer /> Dispatch and print
          </Button>
        </>
      }
    >
      <div>
        <div className="mb-2 text-[0.9375rem] font-medium text-ink">Trip notes</div>
        <div
          className={cn(
            "h-[76px] rounded-inner border px-3 py-2.5 text-[0.9375rem]",
            caret ? "border-accent shadow-[0_0_0_3px_rgb(37_99_235/12%)]" : "border-hairline-2"
          )}
        >
          {notes ? <span className="text-ink">{notes}</span> : <span className="text-faint">Driver, vehicle, anything the stores should know</span>}
          {caret && <span className="ml-px inline-block h-5 w-[1.5px] translate-y-1 bg-ink" />}
        </div>
      </div>
      <Card className="overflow-hidden shadow-none">
        <div className="flex border-b border-hairline bg-soft">
          <div className={cn(H, "flex-1")}>Store</div>
          <div className={cn(H, "w-32")}>Allotment</div>
          <div className={cn(H, "w-20 text-right")}>Koli</div>
          <div className={cn(H, "w-20 text-right")}>Pcs</div>
        </div>
        {rows.map((r) => (
          <div key={r.store} className="flex items-center border-b border-hairline last:border-b-0 text-[0.9375rem]">
            <div className="flex-1 px-4 py-3 font-medium text-ink">{r.store}</div>
            <div className="w-32 px-4 font-mono text-body">{r.allotment}</div>
            <div className="w-20 px-4 text-right text-body tabular-nums">{r.koli}</div>
            <div className="w-20 px-4 text-right text-ink tabular-nums">{num(r.pcs)}</div>
          </div>
        ))}
      </Card>
    </Dlg>
  )
}

/* ── MD · Cancel allotment ──────────────────────────────────────────── */

export const CANCEL_REASONS = ["Wrong quantity", "Wrong store", "Stock problem", "Supplier", "Other"]

export function CancelDialog({
  allotment,
  rows,
  work,
  ack,
  reason,
  hot,
  pressed,
  style,
}: {
  allotment: string
  rows: readonly { stage: string; detail: string; pcs: number; tone: "text" | "red" | "mute" }[]
  /** Pieces already picked or packed. */
  work: number
  ack: boolean
  reason?: number
  hot?: boolean
  pressed?: number
  style?: CSSProperties
}) {
  const ready = reason !== undefined && (work === 0 || ack)
  return (
    <Dlg
      width={600}
      title={`Cancel ${allotment}?`}
      style={style}
      foot={
        <>
          <span className="flex-1 text-[0.875rem] text-body">
            {work > 0 ? "The warehouse moves it back and confirms" : "The warehouse removes the picklists"}
          </span>
          <Button variant="ghost">Keep</Button>
          <Button
            variant="primary"
            hover={hot}
            pressed={pressed}
            disabled={!ready}
            style={{ background: hot && ready ? "#9f1239" : "var(--color-bad-fg)", color: "#fff" }}
          >
            Cancel allotment
          </Button>
        </>
      }
    >
      <div>
        {rows.map((r) => (
          <div key={r.stage} className="flex gap-3 border-t border-hairline py-2.5 text-[0.9375rem] first:border-t-0">
            <span className={cn("w-28", r.tone === "mute" ? "text-mute" : "text-body")}>{r.stage}</span>
            <span className={cn("flex-1", r.tone === "red" ? "text-bad-fg" : r.tone === "mute" ? "text-mute" : "text-text")}>{r.detail}</span>
            <span className={cn("tabular-nums", r.tone === "mute" ? "text-mute" : "text-ink")}>{num(r.pcs)} pcs</span>
          </div>
        ))}
      </div>
      {work > 0 && (
        <div className="flex items-start gap-2.5 rounded-card bg-bad-bg px-3.5 py-3 text-[0.9375rem] text-bad-fg">
          <span className={cn("mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[4px] border-2 border-bad-fg", ack && "bg-bad-fg text-white")}>
            {ack && <Check className="size-3" strokeWidth={3.5} />}
          </span>
          The warehouse has to move back {num(work)} pcs that are already picked or packed.
        </div>
      )}
      <div>
        <div className="mb-2 text-[0.875rem] font-medium text-body">Reason</div>
        <div className="flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r, i) => (
            <span
              key={r}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3.5 text-[0.9375rem]",
                reason === i ? "border-ink bg-ink text-white" : "border-hairline-2 bg-canvas text-text"
              )}
            >
              {r}
            </span>
          ))}
        </div>
      </div>
    </Dlg>
  )
}

/* ── MD · Still needed ──────────────────────────────────────────────── */

export interface NeedRow {
  allotment: string
  store: string
  name: string
  sku: string
  target: number
  sent: number
  toPick: number
  why: string
  /** Decided: shown as a pill instead of the button. */
  done?: string
}

export function StillNeededPage({ rows, hot, pressed }: { rows: readonly NeedRow[]; hot?: number; pressed?: number }) {
  const open = rows.filter((r) => !r.done)
  const done = rows.filter((r) => r.done)
  const table = (list: readonly NeedRow[], start: number) => (
    <Card className="overflow-hidden">
      <div className="flex border-b border-hairline bg-soft">
        <div className={cn(H, "w-12")}>No.</div>
        <div className={cn(H, "w-28")}>Allotment</div>
        <div className={cn(H, "w-40")}>Store</div>
        <div className={cn(H, "w-60")}>SKU</div>
        <div className={cn(H, "flex-1")}>Target · Sent · To pick</div>
        <div className={cn(H, "w-48")} />
      </div>
      {list.map((r, i) => (
        <div key={r.allotment + r.store} className="flex items-center border-b border-hairline last:border-b-0">
          <div className="w-12 px-4 text-[0.9375rem] text-mute">{start + i + 1}</div>
          <div className="w-28 px-4 font-mono text-[0.875rem] text-ink">{r.allotment}</div>
          <div className="w-40 px-4 text-[0.9375rem] font-medium text-ink">{r.store}</div>
          <div className="w-60 px-4 py-2.5">
            <div className="text-[0.9375rem] text-ink">{r.name}</div>
            <div className="font-mono text-[0.875rem] text-mute">{r.sku}</div>
          </div>
          <div className="flex-1 px-4 py-2.5">
            <div className="text-[0.9375rem] font-medium text-ink tabular-nums">
              Target {num(r.target)} · Sent {num(r.sent)} · To pick {num(r.done ? 0 : r.toPick)}
            </div>
            <div className="text-[0.875rem] text-mute">{r.done ? `Remaining ${r.toPick} closed` : r.why}</div>
          </div>
          <div className="flex w-48 justify-end px-4">
            {r.done ? (
              <span className="inline-flex h-7 items-center rounded-full bg-soft-2 px-3 text-[0.875rem] text-text">{r.done}</span>
            ) : (
              <Button variant="ghost" hover={hot === start + i} pressed={hot === start + i ? pressed : 1}>
                Close remaining
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  )
  return (
    <div className="w-[1076px]">
      <div className="mb-3 text-[1.75rem] leading-9 font-semibold tracking-[-0.02em] text-ink">Allotments</div>
      <div className="mb-5 flex h-10 items-stretch gap-1 border-b border-hairline">
        {[
          ["Unallotted", 2, false],
          ["Allotted", 10, false],
          ["Still needed", open.length, true],
        ].map(([l, n, on]) => (
          <div key={String(l)} className={cn("relative flex items-center gap-1.5 px-3 text-[0.875rem] font-medium", on ? "text-ink" : "text-body")}>
            {l} <span className="text-mute">{n}</span>
            {on && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
          </div>
        ))}
      </div>
      <div className="mb-2 text-[1rem] font-semibold text-ink">
        Still needed <span className="font-normal text-mute">{open.length}</span>
      </div>
      {open.length ? table(open, 0) : <div className="rounded-card bg-soft px-4 py-3 text-body">Nothing is left over.</div>}
      {done.length > 0 && (
        <>
          <div className="mt-6 mb-2 text-[1rem] font-semibold text-ink">Decided</div>
          {table(done, open.length)}
        </>
      )}
    </div>
  )
}

/* ── Inventory · Stock checks ───────────────────────────────────────── */

export interface CheckRow {
  name: string
  sku: string
  rack: string
  qty: number
  from: string
  by: string
  md: string
  done?: "Found" | "Lost"
}

export function StockChecksPage({
  rows,
  hot,
  pressed,
}: {
  rows: readonly CheckRow[]
  /** [row, "found" | "lost"] the pointer is on. */
  hot?: [number, "found" | "lost"]
  pressed?: number
}) {
  const open = rows.filter((r) => !r.done)
  const done = rows.filter((r) => r.done)
  const table = (list: readonly CheckRow[], start: number) => (
    <Card className="overflow-hidden">
      <div className="flex border-b border-hairline bg-soft">
        <div className={cn(H, "w-12")}>No.</div>
        <div className={cn(H, "w-60")}>SKU</div>
        <div className={cn(H, "w-20")}>Rack</div>
        <div className={cn(H, "w-20 text-right")}>Quantity</div>
        <div className={cn(H, "flex-1")}>Reported</div>
        <div className={cn(H, "w-44")}>MD</div>
        <div className={cn(H, "w-44")} />
      </div>
      {list.map((r, i) => (
        <div key={r.sku + r.from} className="flex items-center border-b border-hairline last:border-b-0">
          <div className="w-12 px-4 text-[0.9375rem] text-mute">{start + i + 1}</div>
          <div className="w-60 px-4 py-2.5">
            <div className="text-[0.9375rem] text-ink">{r.name}</div>
            <div className="font-mono text-[0.875rem] text-mute">{r.sku}</div>
          </div>
          <div className="w-20 px-4 font-mono text-[0.9375rem] text-body">{r.rack}</div>
          <div className="w-20 px-4 text-right text-[0.9375rem] text-ink tabular-nums">{r.qty} pcs</div>
          <div className="flex-1 px-4 py-2.5">
            <div className="text-[0.9375rem] text-ink">{r.from}</div>
            <div className="text-[0.875rem] text-mute">Reported by {r.by}</div>
          </div>
          <div className="w-44 px-4 text-[0.9375rem] text-text">{r.md}</div>
          <div className="flex w-44 justify-end gap-2 px-4">
            {r.done ? (
              <span className={cn("inline-flex h-7 items-center rounded-full px-3 text-[0.875rem]", r.done === "Found" ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg")}>
                {r.done}
              </span>
            ) : (
              <>
                <Button variant="ghost" hover={hot?.[0] === start + i && hot[1] === "found"} pressed={hot?.[0] === start + i && hot[1] === "found" ? pressed : 1}>
                  Found
                </Button>
                <Button variant="ghost" hover={hot?.[0] === start + i && hot[1] === "lost"}>
                  Lost
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </Card>
  )
  return (
    <div className="w-[1076px]">
      <div className="mb-5 text-[1.75rem] leading-9 font-semibold tracking-[-0.02em] text-ink">Stock checks</div>
      <div className="mb-2 text-[1rem] font-semibold text-ink">
        Open <span className="font-normal text-mute">{open.length}</span>
      </div>
      {open.length ? table(open, 0) : <div className="rounded-card bg-soft px-4 py-3 text-body">No stock checks open.</div>}
      {done.length > 0 && (
        <>
          <div className="mt-6 mb-2 text-[1rem] font-semibold text-ink">Settled</div>
          {table(done, open.length)}
        </>
      )}
    </div>
  )
}
