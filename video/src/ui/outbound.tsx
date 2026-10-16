/* The outbound design (outbound-board-prototype.html, 9 Oct 2026), drawn
   with the hub's tokens. Not in the app yet: these are the prototype's
   board, cards, card sheet, Move back dialog and MD's allotment sheet, as
   pictures of a state.

   Board: To pick → Picked → Packed → In transit → Received. One card is
   one allotment for one store. A card MD reduced carries a red strip
   "Edited −50", the change inside it ("300 → 250 pcs −50") and its one way
   out, Move back; it cannot be dispatched until the excess is back. */
import type { CSSProperties, ReactNode } from "react"
import { Check, Lock, Minus, Plus } from "lucide-react"
import { num } from "../format"
import { Button, Card, Sheet, cn } from "./kit"

/* ── Board ──────────────────────────────────────────────────────────── */

export type LaneId = "pick" | "picked" | "packed" | "transit" | "recv"

export const LANES: { id: LaneId; label: string; dot: string }[] = [
  { id: "pick", label: "To pick", dot: "var(--faint)" },
  { id: "picked", label: "Picked", dot: "var(--warn)" },
  { id: "packed", label: "Packed", dot: "var(--info)" },
  { id: "transit", label: "In transit", dot: "var(--accent)" },
  { id: "recv", label: "Received", dot: "var(--ok)" },
]

export interface BoardCard {
  id: string
  lane: LaneId
  store: string
  /** ALT-… or, once sent, the surat jalan. */
  ref: string
  pcs: number
  /** "6 SKUs", "4 koli"… */
  meta: string
  got?: number
  missing?: number
  shortPick?: boolean
  added?: number
  edited?: { from: number; to: number }
  /** MD cancelled it: a switched-off card with the big stamp. */
  cancelled?: boolean
}

export interface CardLook {
  /** 0..1 a card arriving (a pulse of the accent ring). */
  pulse?: number
  selected?: boolean
  /** The pointer is on its button. */
  hot?: boolean
  pressed?: number
  /** Ring it to show the camera where to look. */
  ring?: number
  style?: CSSProperties
}

export function Board({
  cards,
  looks = {},
  dispatch,
}: {
  cards: readonly BoardCard[]
  looks?: Record<string, CardLook>
  dispatch?: { enabled?: boolean; hot?: boolean }
}) {
  return (
    <div className="w-[1308px]">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[1.75rem] leading-9 font-semibold tracking-[-0.02em] text-ink">Outbound</div>
        <div className="flex gap-2">
          <div className="flex h-9 w-[300px] items-center rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.9375rem] text-faint">
            Search store, allotment or surat jalan
          </div>
          <div className="flex h-9 w-[180px] items-center justify-between rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.9375rem] text-ink">
            All stores <span className="text-line-ico">⌄</span>
          </div>
        </div>
      </div>
      <div className="grid h-[750px] grid-cols-5 gap-3">
        {LANES.map((lane) => {
          const mine = cards.filter((c) => c.lane === lane.id)
          const pcs = mine.filter((c) => !c.cancelled).reduce((s, c) => s + (c.edited ? c.edited.to : c.pcs), 0)
          const toFix = mine.filter((c) => c.edited || c.cancelled).length
          return (
            <div key={lane.id} className="flex min-h-0 flex-col overflow-hidden rounded-card bg-soft-2">
              <div className="px-4 pt-4 pb-1">
                <div className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink">
                  <span className="size-2 rounded-full" style={{ background: lane.dot }} />
                  {lane.label}
                  <span className="ml-auto font-medium text-body tabular-nums">{num(pcs)} pcs</span>
                </div>
                <div className="mt-0.5 text-[0.875rem] text-body">
                  {mine.length} {mine.length === 1 ? "store" : "stores"}
                  {toFix > 0 && <span className="font-medium text-bad-fg"> · {toFix} to fix</span>}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5 [&>*]:shrink-0">
                {mine.map((c) => (
                  <BoardCardView key={c.id} c={c} look={looks[c.id] ?? {}} />
                ))}
              </div>
              {lane.id === "packed" && (
                <div className="mt-auto p-2.5">
                  <Button
                    variant="ghost"
                    hover={dispatch?.hot}
                    disabled={dispatch?.enabled === false}
                    className="h-10 w-full"
                  >
                    Dispatch
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BoardCardView({ c, look }: { c: BoardCard; look: CardLook }) {
  const edited = c.edited
  const cx = c.cancelled
  const action = cx
    ? c.lane === "pick"
      ? "Remove picklist"
      : "Move back"
    : edited
      ? "Move back"
      : c.lane === "pick"
        ? "Picked"
        : c.lane === "picked"
          ? "Pack"
          : null
  return (
    <div
      className={cn("relative overflow-hidden rounded-card border", cx ? "bg-soft" : "bg-canvas")}
      style={{
        borderColor: cx ? "var(--hairline)" : edited ? "rgb(190 18 60 / 35%)" : look.ring ? "var(--accent)" : "transparent",
        boxShadow: look.pulse ? `0 0 0 ${4 * look.pulse}px rgb(37 99 235 / ${0.18 * look.pulse})` : undefined,
        ...look.style,
      }}
    >
      {edited && (
        <div className="flex h-7 items-center bg-bad-fg px-4 text-[0.875rem] font-semibold text-white">
          Edited −{num(edited.from - edited.to)}
        </div>
      )}
      {c.shortPick && (
        <div className="flex h-7 items-center bg-[#b45309] px-4 text-[0.875rem] font-semibold text-white">
          Short pick
        </div>
      )}
      {cx && (
        /* Switched off: a hatched layer over everything but its button. */
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              "repeating-linear-gradient(135deg, rgb(32 36 44 / 4.5%) 0 7px, transparent 7px 14px)",
          }}
        />
      )}
      <div className="relative flex flex-col gap-1.5 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          {c.lane === "packed" && !cx && (
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-[5px] border-[1.5px]",
                edited
                  ? "border-hairline bg-soft-2 text-faint"
                  : look.selected
                    ? "border-accent bg-accent text-white"
                    : "border-hairline-strong bg-canvas"
              )}
            >
              {edited ? <Lock className="size-3" strokeWidth={2.4} /> : look.selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
          )}
          <span className={cn("min-w-0 flex-1 truncate text-[0.9375rem] font-medium", cx ? "text-mute" : "text-ink")}>{c.store}</span>
          <span className="shrink-0 text-[0.9375rem] font-medium text-ink tabular-nums">
            {c.got !== undefined ? (
              <>
                <span className={c.got < c.pcs ? "text-bad-fg" : undefined}>{num(c.got)}</span> / {num(c.pcs)} pcs
              </>
            ) : (
              `${num(edited ? edited.to : c.pcs)} pcs`
            )}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-[0.875rem] text-body">
          <span>
            <span className="font-mono">{c.ref}</span>
            {c.added ? <span className="ml-1.5 font-medium text-accent">Added +{num(c.added)}</span> : null}
          </span>
          <span>
            {c.meta}
            {c.missing ? <span className="text-bad-fg"> · {c.missing} missing</span> : null}
          </span>
        </div>
        {edited && (
          <div className="text-[0.9375rem] text-body tabular-nums">
            <span className="text-mute">{num(edited.from)}</span> → <b className="font-semibold text-ink">{num(edited.to)}</b> pcs
            <span className="ml-1.5 font-medium text-bad-fg">−{num(edited.from - edited.to)}</span>
          </div>
        )}
        {cx && (
          <div className="pointer-events-none z-[2] my-1 flex justify-center">
            <span
              className="rounded-[10px] border-[3px] border-bad-fg bg-white/70 px-3.5 text-[1.375rem] leading-[30px] font-bold tracking-[0.06em] text-bad-fg"
              style={{ rotate: "-7deg", opacity: 0.95 }}
            >
              CANCELLED
            </span>
          </div>
        )}
        {action && (
          <Button
            variant={edited || cx ? "tint" : "ghost"}
            hover={look.hot}
            pressed={look.pressed}
            className="mt-2 w-full"
          >
            {action}
          </Button>
        )}
      </div>
    </div>
  )
}

/* ── The SKUs of one card ───────────────────────────────────────────── */

export interface SkuLine {
  name: string
  sku: string
  koli: string
  was: number
  now: number
}

/** The card's sheet beside the board (no veil: the board is what you are
    working on). Was / Now / Move back per SKU while an edit is owed; plain
    quantities once it is settled. */
export function CardSheet({
  c,
  lines,
  editedAt,
  settled,
  foot,
  x = 0,
  opacity = 1,
}: {
  c: BoardCard
  lines: readonly SkuLine[]
  editedAt: string
  settled?: boolean
  foot?: { hot?: boolean; pressed?: number }
  x?: number
  opacity?: number
}) {
  const owed = lines.reduce((s, l) => s + (l.was - l.now), 0)
  const H = "px-4 py-2.5 text-[0.875rem] font-medium text-body"
  const D = "px-4 py-3 text-[0.9375rem] tabular-nums"
  return (
    <Sheet
      width={680}
      mono={c.ref}
      title={
        <span className="flex flex-col">
          <span className="mb-0.5 flex items-center gap-1.5 text-[0.875rem] font-normal tracking-normal">
            <span className="size-1.5 rounded-full bg-info" />
            <span className="text-body">Packed</span>
            {!settled && <span className="text-bad-fg">· Edited by MD</span>}
          </span>
          {c.store}
        </span>
      }
      x={x}
      opacity={opacity}
      footer={
        settled ? undefined : (
          <div className="flex justify-end">
            <Button variant="primary" hover={foot?.hot} pressed={foot?.pressed}>
              Move back · {num(owed)} pcs
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5 px-7 pt-5">
        {!settled && (
          <dl className="grid grid-cols-2 gap-5">
            <div>
              <dt className="text-[0.875rem] text-body">Edited by</dt>
              <dd className="mt-1 text-[0.9375rem] text-ink">Rina Kusuma · {editedAt}</dd>
            </div>
            <div>
              <dt className="text-[0.875rem] text-body">Quantity</dt>
              <dd className="mt-1 text-[0.9375rem] text-ink tabular-nums">
                {num(c.edited?.from ?? c.pcs)} → {num(c.edited?.to ?? c.pcs)} pcs
              </dd>
            </div>
          </dl>
        )}
        <Card className="overflow-hidden shadow-none">
          <div className="flex border-b border-hairline bg-soft">
            <div className={cn(H, "w-12")}>No.</div>
            <div className={cn(H, "flex-1")}>SKU</div>
            <div className={cn(H, "w-20")}>In koli</div>
            {settled ? (
              <div className={cn(H, "w-24 text-right")}>Quantity</div>
            ) : (
              <>
                <div className={cn(H, "w-16 text-right")}>Was</div>
                <div className={cn(H, "w-16 text-right")}>Now</div>
                <div className={cn(H, "w-28 text-right")}>Move back</div>
              </>
            )}
          </div>
          {lines.map((l, i) => {
            const back = l.was - l.now
            const quiet = back === 0 && !settled
            return (
              <div key={l.sku} className="flex items-center border-b border-hairline last:border-b-0">
                <div className={cn(D, "w-12 text-mute")}>{i + 1}</div>
                <div className={cn(D, "flex-1")}>
                  <div className={quiet ? "text-body" : "font-medium text-ink"}>{l.name}</div>
                  <div className="font-mono text-[0.875rem] text-mute">{l.sku}</div>
                </div>
                <div className={cn(D, "w-20 font-mono", quiet ? "text-faint" : "text-body")}>{l.koli}</div>
                {settled ? (
                  <div className={cn(D, "w-24 text-right text-ink")}>{l.now}</div>
                ) : (
                  <>
                    <div className={cn(D, "w-16 text-right text-body")}>{l.was}</div>
                    <div className={cn(D, "w-16 text-right text-body")}>{l.now}</div>
                    <div className={cn(D, "w-28 text-right", back ? "font-medium text-bad-fg" : "text-faint")}>
                      {back ? back : "—"}
                    </div>
                  </>
                )}
              </div>
            )
          })}
          <div className="flex bg-soft-2 font-medium">
            <div className="w-12" />
            <div className={cn(D, "flex-1 text-ink")}>Total</div>
            <div className="w-20" />
            {settled ? (
              <div className={cn(D, "w-24 text-right text-ink")}>{num(lines.reduce((s, l) => s + l.now, 0))}</div>
            ) : (
              <>
                <div className={cn(D, "w-16 text-right text-ink")}>{num(lines.reduce((s, l) => s + l.was, 0))}</div>
                <div className={cn(D, "w-16 text-right text-ink")}>{num(lines.reduce((s, l) => s + l.now, 0))}</div>
                <div className={cn(D, "w-28 text-right text-bad-fg")}>{num(owed)}</div>
              </>
            )}
          </div>
        </Card>
      </div>
    </Sheet>
  )
}

/* ── Move back ──────────────────────────────────────────────────────── */

export interface MoveLine {
  name: string
  sku: string
  koli: string
  now: number
  back: number
}

/** "Move back from Store Kemang": where to (Picked / To pick), how many of
    each line (prefilled with MD's edit), and what that means physically. */
export function MoveBackDialog({
  store,
  allotment,
  pcs,
  to,
  lines,
  outcome,
  edited = true,
  hot,
  pressed,
  style,
}: {
  store: string
  allotment: string
  pcs: number
  to: "picked" | "pick"
  lines: readonly MoveLine[]
  outcome: ReactNode
  /** An edit is owed, so the "MD’s edit" fill shows; a cancelled card has none. */
  edited?: boolean
  hot?: "keep" | "confirm"
  pressed?: number
  style?: CSSProperties
}) {
  const moved = lines.reduce((s, l) => s + l.back, 0)
  const all = moved === lines.reduce((s, l) => s + l.now, 0)
  const H = "px-4 py-2.5 text-[0.875rem] font-medium text-body"
  return (
    <div
      className="absolute top-1/2 left-1/2 w-[46rem] overflow-hidden rounded-card border border-hairline-2 bg-canvas shadow-float"
      style={{ translate: "-50% -50%", ...style }}
    >
      <div className="border-b border-hairline px-6 py-4">
        <div className="text-[1.25rem] font-semibold tracking-[-0.01em] text-ink">Move back from {store}</div>
        <div className="font-mono text-[0.875rem] text-mute">
          {allotment} · {num(pcs)} pcs · now packed
        </div>
      </div>
      <div className="flex flex-col gap-4 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(["picked", "pick"] as const).map((one) => (
              <span
                key={one}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-[0.9375rem] font-medium",
                  to === one ? "border-ink bg-ink text-white" : "border-hairline-2 bg-canvas text-text"
                )}
              >
                {one === "picked" ? "Picked" : "To pick"}
              </span>
            ))}
          </div>
          <span className="text-[0.9375rem] text-accent">{edited ? "MD’s edit · All · None" : "All · None"}</span>
        </div>
        <Card className="overflow-hidden shadow-none">
          <div className="flex border-b border-hairline bg-soft">
            <div className={cn(H, "w-12")}>No.</div>
            <div className={cn(H, "flex-1")}>SKU</div>
            <div className={cn(H, "w-20")}>In koli</div>
            <div className={cn(H, "w-16 text-right")}>Now</div>
            <div className={cn(H, "w-48 text-right")}>Move back</div>
          </div>
          {lines.map((l, i) => (
            <div key={l.sku} className="flex items-center border-b border-hairline">
              <div className="w-12 px-4 text-[0.9375rem] text-mute">{i + 1}</div>
              <div className="flex-1 px-4 py-2.5">
                <div className="text-[0.9375rem] font-medium text-ink">{l.name}</div>
                <div className="font-mono text-[0.875rem] text-mute">{l.sku}</div>
              </div>
              <div className="w-20 px-4 font-mono text-[0.9375rem] text-body">{l.koli}</div>
              <div className="w-16 px-4 text-right text-[0.9375rem] text-body tabular-nums">{l.now}</div>
              <div className="flex w-48 justify-end gap-2 px-4">
                <span className={cn("grid size-10 place-items-center rounded-inner border border-hairline-2", !l.back && "opacity-35")}>
                  <Minus className="size-4 text-line-ico" />
                </span>
                <span className="grid h-10 w-14 place-items-center rounded-inner border border-hairline-2 text-[0.9375rem] text-ink tabular-nums">
                  {l.back}
                </span>
                <span className="grid size-10 place-items-center rounded-inner border border-hairline-2">
                  <Plus className="size-4 text-line-ico" />
                </span>
              </div>
            </div>
          ))}
          <div className="flex bg-soft-2 text-[0.9375rem] font-medium">
            <div className="w-12" />
            <div className="flex-1 px-4 py-3 text-ink">Total</div>
            <div className="w-20" />
            <div className="w-16 px-4 py-3 text-right text-ink tabular-nums">{num(lines.reduce((s, l) => s + l.now, 0))}</div>
            <div className="w-48 px-4 py-3 text-right text-ink tabular-nums">{num(moved)}</div>
          </div>
        </Card>
        <p className="text-[0.9375rem] leading-relaxed text-body">{outcome}</p>
      </div>
      <div className="flex items-center gap-3 border-t border-hairline px-6 py-3.5">
        <span className="flex-1 text-[0.9375rem] text-body tabular-nums">
          {num(moved)} of {num(lines.reduce((s, l) => s + l.now, 0))} pcs
        </span>
        <Button variant="ghost" hover={hot === "keep"} pressed={hot === "keep" ? pressed : 1}>
          Keep
        </Button>
        <Button variant="primary" hover={hot === "confirm"} pressed={hot === "confirm" ? pressed : 1}>
          {all ? "Move back all" : `Move back ${num(moved)} pcs`}
        </Button>
      </div>
    </div>
  )
}

/* ── MD: Merchandise › Allotments ───────────────────────────────────── */

export interface AllotmentRow {
  id: string
  supplier: string
  stores: number
  pcs: number
  where: string
  /** A second line under Where, e.g. "Received 214/220 · 6 short". */
  note?: string
  status: "Active" | "Completed" | "Received short" | "Closed short" | "Cancelled"
}

export function AllotmentList({
  rows,
  hot,
}: {
  rows: readonly AllotmentRow[]
  hot?: string
}) {
  return (
    <div className="w-[1064px]">
      <div className="mb-3 text-[1.75rem] leading-9 font-semibold tracking-[-0.02em] text-ink">Allotments</div>
      <div className="flex h-10 items-stretch gap-1 border-b border-hairline">
        {[
          ["Unallotted", 2, false],
          ["Allotted", rows.length, true],
          ["Still needed", 1, false],
        ].map(([l, n, on]) => (
          <div key={String(l)} className={cn("relative flex items-center gap-1.5 px-3 text-[0.875rem] font-medium", on ? "text-ink" : "text-body")}>
            {l} <span className="text-mute">{n}</span>
            {on && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
          </div>
        ))}
      </div>
      <Card className="mt-4 overflow-hidden">
        <div className="flex h-10 items-center border-b border-hairline bg-soft text-[0.875rem] font-medium text-body">
          <div className="flex-1 px-5">Allotment</div>
          <div className="w-24 px-5 text-right">Stores</div>
          <div className="w-24 px-5 text-right">Pcs</div>
          <div className="w-[380px] px-5">Where</div>
          <div className="w-[180px] px-5">Status</div>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className={cn("flex h-[62px] items-center border-b border-hairline last:border-b-0", hot === r.id && "bg-soft")}
          >
            <div className="flex-1 px-5">
              <div className="font-mono text-[0.875rem] text-ink">{r.id}</div>
              <div className="text-[0.875rem] text-mute">{r.supplier}</div>
            </div>
            <div className="w-24 px-5 text-right text-[0.9375rem] text-text tabular-nums">{r.stores}</div>
            <div className="w-24 px-5 text-right text-[0.9375rem] text-text tabular-nums">{num(r.pcs)}</div>
            <div className="w-[380px] px-5 text-[0.9375rem] text-text">
              {r.where}
              {r.note && <div className="text-[0.875rem] text-mute">{r.note}</div>}
            </div>
            <div className="w-[180px] px-5 text-[0.9375rem]">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    r.status === "Active" ? "bg-accent" : r.status === "Completed" ? "bg-ok" : r.status === "Closed short" ? "bg-hairline-strong" : "bg-bad"
                  )}
                />
                <span
                  className={
                    r.status === "Active" ? "text-info-fg" : r.status === "Completed" ? "text-ok-fg" : r.status === "Closed short" ? "text-text" : "text-bad-fg"
                  }
                >
                  {r.status}
                </span>
              </span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

export interface StoreStage {
  store: string
  stage: "To pick" | "Picked" | "Packed" | "On the road" | "Received"
  pcs: number
  sj?: string
}

export interface EditLine {
  name: string
  sku: string
  now: number
  next: number
  /** The pointer is on its minus button. */
  hot?: boolean
}

/** MD's allotment sheet: the stage tiles, then either the stores (view) or
    every store's SKUs with a stepper (edit). A store already sent is a
    locked row in edit — it can never go below what was sent. */
export function AllotmentSheet({
  id,
  supplier,
  status = "Active",
  stages,
  edit,
  added,
  foot,
  created = "02 Oct 2026",
  x = 0,
  opacity = 1,
}: {
  id: string
  supplier: string
  created?: string
  status?: "Active" | "Cancelled"
  stages: readonly StoreStage[]
  /** Present in edit mode: the editable store and its lines. */
  edit?: { store: string; stage: string; lines: readonly EditLine[] }
  /** An item added in this edit. */
  added?: { store: string; name: string; sku: string; qty: number }
  foot?: { hot?: "edit" | "save" | "cancel"; pressed?: number }
  x?: number
  opacity?: number
}) {
  /* Once cancelled, only what was already sent still counts. */
  const gone = (s: StoreStage) => status === "Cancelled" && s.stage !== "On the road" && s.stage !== "Received"
  const sum = (k: StoreStage["stage"]) =>
    stages.filter((s) => s.stage === k && !gone(s)).reduce((t, s) => t + s.pcs, 0)
  const owed = edit ? edit.lines.reduce((s, l) => s + Math.max(0, l.now - l.next), 0) : 0
  const H = "px-4 py-2.5 text-[0.875rem] font-medium text-body"
  return (
    <Sheet
      width={760}
      title={
        <span className="flex flex-col">
          <span
            className={cn(
              "mb-0.5 flex items-center gap-1.5 text-[0.875rem] font-normal tracking-normal",
              status === "Cancelled" ? "text-bad-fg" : "text-info-fg"
            )}
          >
            <span className={cn("size-1.5 rounded-full", status === "Cancelled" ? "bg-bad" : "bg-accent")} /> {status}
          </span>
          <span className="font-mono">{id}</span>
          <span className="mt-0.5 text-[0.9375rem] font-normal tracking-normal text-body">
            {supplier} · Created {created} by Rina Kusuma
          </span>
        </span>
      }
      x={x}
      opacity={opacity}
      footer={
        edit ? (
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[0.875rem]">
              {owed > 0 && <span className="text-bad-fg">{num(owed)} pcs the warehouse moves back</span>}
              {owed > 0 && added ? <span className="text-body"> · </span> : null}
              {added && <span className="text-accent">+{num(added.qty)} to pick</span>}
              {!owed && !added && <span className="text-body">No changes yet</span>}
            </span>
            <Button variant="ghost">Back</Button>
            <Button variant="primary" hover={foot?.hot === "save"} pressed={foot?.hot === "save" ? foot.pressed : 1} disabled={!owed && !added}>
              Save changes
            </Button>
          </div>
        ) : status === "Cancelled" ? (
          <div className="flex justify-end">
            <Button variant="ghost">Close</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button variant="danger" hover={foot?.hot === "cancel"} pressed={foot?.hot === "cancel" ? foot.pressed : 1}>
              Cancel allotment
            </Button>
            <span className="flex-1" />
            <Button variant="primary" hover={foot?.hot === "edit"} pressed={foot?.hot === "edit" ? foot.pressed : 1}>
              Edit
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col px-7 pt-5">
        <div className="mb-5 grid grid-cols-5 gap-3">
          {(["To pick", "Picked", "Packed", "On the road", "Received"] as const).map((k) => (
            <div key={k} className="rounded-card bg-soft px-3 py-2.5">
              <div className="text-[0.875rem] text-body">{k}</div>
              <div className="text-[1.125rem] font-semibold text-ink tabular-nums">
                {num(k === "Packed" && edit ? sum(k) - owed : sum(k))}
              </div>
            </div>
          ))}
        </div>
        {!edit ? (
          <Card className="overflow-hidden shadow-none">
            <div className="flex border-b border-hairline bg-soft">
              <div className={cn(H, "flex-1")}>Store</div>
              <div className={cn(H, "w-40")}>Stage</div>
              <div className={cn(H, "w-24 text-right")}>Pcs</div>
            </div>
            {stages.map((s) => (
              <div key={s.store} className="flex items-center border-b border-hairline last:border-b-0">
                <div className="flex-1 px-4 py-3.5 text-[0.9375rem] font-medium text-ink">{s.store}</div>
                <div className={cn("w-40 px-4 text-[0.9375rem]", gone(s) ? "text-bad-fg" : "text-text")}>
                  {gone(s) ? "Cancelled" : s.stage}
                </div>
                <div className="w-24 px-4 text-right text-[0.9375rem] text-ink tabular-nums">{gone(s) ? "—" : num(s.pcs)}</div>
              </div>
            ))}
          </Card>
        ) : (
          <>
            {stages
              .filter((s) => s.stage === "On the road" || s.stage === "Received")
              .map((s) => (
                <div key={s.store} className="mb-2 flex items-center gap-2.5 rounded-card bg-soft px-3.5 py-3 text-[0.9375rem] text-body">
                  <Lock className="size-4 text-line-ico" />
                  <span className="flex-1">
                    <b className="font-semibold text-ink">{s.store}</b> · on the road · <span className="font-mono">{s.sj}</span>
                  </span>
                  <span className="text-ink tabular-nums">{num(s.pcs)} pcs</span>
                </div>
              ))}
            <div className="mt-3 mb-2 flex items-center gap-2 text-[0.9375rem] font-semibold text-ink">
              {edit.store} <span className="font-normal text-body">{edit.stage}</span>
            </div>
            <Card className="overflow-hidden shadow-none">
              <div className="flex border-b border-hairline bg-soft">
                <div className={cn(H, "flex-1")}>SKU</div>
                <div className={cn(H, "w-16 text-right")}>Now</div>
                <div className={cn(H, "w-44 text-right")}>New quantity</div>
                <div className={cn(H, "w-24")} />
              </div>
              {edit.lines.map((l) => {
                const d = l.next - l.now
                return (
                  <div key={l.sku} className="flex items-center border-b border-hairline last:border-b-0">
                    <div className="flex-1 px-4 py-2">
                      <div className="text-[0.9375rem] font-medium text-ink">{l.name}</div>
                      <div className="font-mono text-[0.875rem] text-mute">{l.sku}</div>
                    </div>
                    <div className="w-16 px-4 text-right text-[0.9375rem] text-body tabular-nums">{l.now}</div>
                    <div className="flex w-44 justify-end gap-2 px-4">
                      <span className={cn("grid size-9 place-items-center rounded-inner border", l.hot ? "border-hairline-strong bg-soft-2" : "border-hairline-2")}>
                        <Minus className="size-4 text-line-ico" />
                      </span>
                      <span className={cn("grid h-9 w-12 place-items-center rounded-inner border text-[0.9375rem] tabular-nums", d ? "border-accent text-ink" : "border-hairline-2 text-ink")}>
                        {l.next}
                      </span>
                      <span className="grid size-9 place-items-center rounded-inner border border-hairline-2">
                        <Plus className="size-4 text-line-ico" />
                      </span>
                    </div>
                    <div className="w-24 px-4 text-[0.875rem] font-medium text-bad-fg tabular-nums">
                      {d < 0 ? `Move back ${-d}` : ""}
                    </div>
                  </div>
                )
              })}
            </Card>
            <div className="mt-5 mb-2 text-[0.9375rem] font-semibold text-ink">Add an item</div>
            {added && (
              <Card className="mb-2 overflow-hidden shadow-none">
                <div className="flex items-center px-4 py-2.5">
                  <div className="flex-1">
                    <div className="text-[0.9375rem] font-medium text-ink">
                      {added.name} <span className="font-normal text-body">· {added.store}</span>
                    </div>
                    <div className="font-mono text-[0.875rem] text-mute">{added.sku}</div>
                  </div>
                  <div className="text-[0.9375rem] font-medium text-accent tabular-nums">+{added.qty}</div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
