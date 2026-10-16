/* The New PO composer (composer.tsx), a 1248-wide form sheet: Supplier,
   Delivery Date, Payment Terms, Payment Method; Items; Discount; Notes. Two
   steps — "New PO", then "Review this order" — and Submit. Its Add item sheet
   stacks over it at 1000 wide. Measured on :5480. */
import type { ReactNode } from "react"
import { Check, ImagePlus, Plus, WifiOff } from "lucide-react"
import { num, pcs, rp } from "../format"
import { Button, Input, Label, Select, Sheet, cn } from "./kit"

export interface ComposerLine {
  name: string
  kind: string
  pieces: number
  /** "50 lusin", shown under the pieces when the unit is not the piece. */
  inUnit?: string
  price: string
  amount: number
}

export interface ComposerState {
  supplier?: string
  supplierFocus?: boolean
  /** Typed into the supplier box while it searches, with its list open. */
  supplierQuery?: string
  supplierMenu?: number
  supplierHover?: number
  delivery?: string
  deliveryFocus?: boolean
  /** 0..1 the calendar under Delivery Date, and the day the pointer is on. */
  calendar?: number
  dayHover?: number
  methodFocus?: boolean
  methodMenu?: number
  methodHover?: string
  terms?: string
  method?: string
  lines: readonly ComposerLine[]
  /** 0..1 the newest line rising in. */
  lineIn?: number
  step: "edit" | "review"
  offline?: boolean
  review?: { pressed?: number; hover?: boolean }
  submit?: { pressed?: number; hover?: boolean; pending?: boolean }
}

export function Composer({
  state,
  x = 0,
  opacity = 1,
}: {
  state: ComposerState
  x?: number
  opacity?: number
}) {
  const s = state
  const reviewing = s.step === "review"
  return (
    <Sheet
      width={1248}
      title={reviewing ? "Review this order" : "New PO"}
      x={x}
      opacity={opacity}
      footer={
        <div className="flex items-center justify-end gap-3">
          {reviewing ? (
            <>
              <Button variant="ghost">Back to editing</Button>
              <Button
                variant="primary"
                pressed={s.submit?.pressed}
                hover={s.submit?.hover}
              >
                {s.submit?.pending ? "Submitting…" : "Submit"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost">Cancel</Button>
              <Button
                variant="primary"
                pressed={s.review?.pressed}
                hover={s.review?.hover}
              >
                Review order
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-6 px-7 pt-5">
        {s.offline && (
          <div className="flex items-center gap-3 rounded-card bg-warn-bg px-4 py-3 text-[0.9375rem] text-warn-fg">
            <WifiOff className="size-[18px]" />
            You are offline. Submit keeps this order on this device and sends
            it when the connection is back.
          </div>
        )}
        {reviewing ? (
          <ReviewFacts s={s} />
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <div className="relative">
              <Label required>Supplier</Label>
              {s.supplierQuery !== undefined ? (
                <Input value={s.supplierQuery} caret focused />
              ) : (
                <Select value={s.supplier} focused={s.supplierFocus} />
              )}
              {s.supplierMenu ? <SupplierMenu open={s.supplierMenu} hover={s.supplierHover} /> : null}
            </div>
            <div className="relative">
              <Label required>Delivery Date</Label>
              <Select value={s.delivery} focused={s.deliveryFocus} />
              {s.calendar ? <Calendar open={s.calendar} hover={s.dayHover} /> : null}
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Select value={s.terms ?? "None"} />
            </div>
            <div className="relative">
              <Label required>Payment Method</Label>
              <Select value={s.method} placeholder="Choose a method" focused={s.methodFocus} />
              {s.methodMenu ? <MethodMenu open={s.methodMenu} hover={s.methodHover} /> : null}
            </div>
          </div>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-card-title font-semibold text-ink">Items</div>
            {!reviewing && (
              <Button variant="ghost">
                <Plus /> New item
              </Button>
            )}
          </div>
          <ItemsTable lines={s.lines} lineIn={s.lineIn} empty={s.supplier ? "Nothing on this order yet. Add what is being ordered." : "Choose a supplier, then add what is being ordered."} />
        </div>
      </div>
    </Sheet>
  )
}

function ReviewFacts({ s }: { s: ComposerState }) {
  const facts: [string, string][] = [
    ["Supplier", s.supplier ?? ""],
    ["Delivery Date", s.delivery ?? ""],
    ["Payment Terms", s.terms ?? "None"],
    ["Payment Method", s.method ?? ""],
  ]
  return (
    <dl className="grid grid-cols-4 gap-6">
      {facts.map(([term, value]) => (
        <div key={term}>
          <dt className="text-[0.875rem] text-body">{term}</dt>
          <dd className="mt-1 text-[0.9375rem] text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** ItemsTable (items-table.tsx): Item · Quantity · Unit Price · Amount, with
    the Total band under it. */
export function ItemsTable({
  lines,
  lineIn = 1,
  empty = "Nothing on this order yet. Add what is being ordered.",
}: {
  lines: readonly ComposerLine[]
  lineIn?: number
  empty?: string
}) {
  if (lines.length === 0)
    return (
      <div className="flex h-[180px] flex-col items-center justify-center gap-4 text-[0.9375rem] text-body">
        <svg width="56" height="40" viewBox="0 0 56 40" fill="none">
          <rect x="18" y="1" width="16" height="12" rx="2" stroke="var(--hairline-strong)" strokeDasharray="3 3" />
          <path d="M6 22h44l-5 16H11z" fill="var(--soft-2)" stroke="var(--line-ico)" />
          <path d="M3 10h4M5 8v4M48 6l1 2" stroke="var(--bad)" strokeLinecap="round" />
        </svg>
        {empty}
      </div>
    )
  const total = lines.reduce((sum, l) => sum + l.pieces, 0)
  const gross = lines.reduce((sum, l) => sum + l.amount, 0)
  const HEAD = "px-4 py-2.5 text-[0.875rem] font-medium text-body"
  return (
    <div className="overflow-hidden rounded-card border border-hairline">
      <div className="flex border-b border-hairline bg-soft">
        <div className={cn(HEAD, "flex-1")}>Item</div>
        <div className={cn(HEAD, "w-[180px] text-right")}>Quantity</div>
        <div className={cn(HEAD, "w-[240px] text-right")}>Unit Price</div>
        <div className={cn(HEAD, "w-[200px] text-right")}>Amount</div>
      </div>
      {lines.map((line, i) => {
        const k = i === lines.length - 1 ? lineIn : 1
        return (
          <div
            key={line.name}
            className="flex items-center border-b border-hairline"
            style={{ opacity: k, translate: `0px ${(1 - k) * 8}px` }}
          >
            <div className="flex flex-1 items-center gap-3 px-4 py-3">
              <span className="grid size-11 place-items-center rounded-inner bg-soft-2 text-line-ico">
                <ImagePlus className="size-4" />
              </span>
              <span>
                <span className="block text-[0.9375rem] font-medium text-ink">{line.name}</span>
                <span className="block text-[0.875rem] text-mute">{line.kind}</span>
              </span>
            </div>
            <div className="w-[180px] px-4 text-right tabular-nums">
              <div className="text-[0.9375rem] text-ink">{pcs(line.pieces)}</div>
              {line.inUnit && <div className="text-[0.875rem] text-mute">{line.inUnit}</div>}
            </div>
            <div className="w-[240px] px-4 text-right text-[0.9375rem] text-ink tabular-nums">
              {line.price}
            </div>
            <div className="w-[200px] px-4 text-right text-[0.9375rem] font-medium text-ink tabular-nums">
              {rp(line.amount)}
            </div>
          </div>
        )
      })}
      <div className="flex bg-soft text-[0.875rem] font-medium tabular-nums">
        <div className="flex-1 px-4 py-3 text-body">Total</div>
        <div className="w-[180px] px-4 py-3 text-right text-ink">{pcs(total)}</div>
        <div className="w-[240px]" />
        <div className="w-[200px] px-4 py-3 text-right text-ink">{rp(gross)}</div>
      </div>
    </div>
  )
}

/** The Add item sheet over the composer (Photo, Name, Division, Tags,
    Quantity with its unit, Price per that unit). */
export function AddItem({
  name,
  nameCaret,
  division,
  tags,
  qty,
  qtyCaret,
  unit,
  unitOpen,
  price,
  priceCaret,
  submit,
  x = 0,
  opacity = 1,
}: {
  name?: string
  nameCaret?: boolean
  division?: string
  tags?: string
  qty?: string
  qtyCaret?: boolean
  unit: string
  unitOpen?: number
  price?: string
  priceCaret?: boolean
  submit?: { pressed?: number; hover?: boolean }
  x?: number
  opacity?: number
}) {
  return (
    <Sheet
      width={1000}
      title="Add item"
      x={x}
      opacity={opacity}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost">Cancel</Button>
          <Button variant="ghost">Add next item</Button>
          <Button variant="primary" pressed={submit?.pressed} hover={submit?.hover}>
            Submit
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-[208px_1fr] gap-x-6 gap-y-5 px-7 pt-5">
        <div className="row-span-2">
          <Label>Photo</Label>
          <div className="grid h-[204px] place-items-center rounded-card bg-soft-2 text-[0.875rem] text-body">
            <span className="flex flex-col items-center gap-2">
              <ImagePlus className="size-5 text-line-ico" /> Choose a Picture
            </span>
          </div>
        </div>
        <div>
          <Label required>Name</Label>
          <Input value={name} caret={nameCaret} focused={nameCaret} />
        </div>
        <div>
          <Label>Description</Label>
          <div className="h-[96px] rounded-inner border border-hairline-2 bg-canvas" />
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-6">
          <div>
            <Label required>Division</Label>
            <Select value={division} />
          </div>
          <div>
            <Label required>Tags</Label>
            <Select value={tags} />
          </div>
          <div>
            <Label required>Quantity</Label>
            <div className="relative flex">
              <Input
                value={qty}
                caret={qtyCaret}
                focused={qtyCaret}
                className="flex-1 rounded-r-none"
              />
              <div className="-ml-px w-[140px]">
                <Select value={unit} focused={!!unitOpen} className="rounded-l-none" />
              </div>
              {unitOpen ? <UnitMenu open={unitOpen} pick={unit} /> : null}
            </div>
          </div>
          <div>
            <Label required>Price</Label>
            <Input
              value={price}
              caret={priceCaret}
              focused={priceCaret}
              prefix="Rp"
              suffix={`/ ${unit.toLowerCase()}`}
            />
          </div>
        </div>
      </div>
    </Sheet>
  )
}

function UnitMenu({ open, pick }: { open: number; pick: string }) {
  return (
    <div
      className="absolute top-12 right-0 z-10 w-[180px] rounded-card border border-hairline-2 bg-canvas p-1 shadow-pop"
      style={{
        opacity: open,
        scale: String(0.97 + open * 0.03),
        transformOrigin: "top right",
      }}
    >
      {["Piece", "Lusin · 12", "Kodi · 20"].map((one) => (
        <div
          key={one}
          className={cn(
            "flex h-9 items-center rounded-inner px-2.5 text-[0.9375rem]",
            one.startsWith(pick) ? "bg-accent-bg text-accent" : "text-text"
          )}
        >
          {one}
        </div>
      ))}
    </div>
  )
}

/** "PO-… created": the saved dialog (dialog.tsx:249), a green check, the
    number, a line under it. */
export function Created({
  po,
  style,
  children,
}: {
  po: string
  style?: React.CSSProperties
  children?: ReactNode
}) {
  return (
    <div
      className="absolute top-1/2 left-1/2 flex w-[26rem] flex-col items-center gap-4 rounded-card border border-hairline-2 bg-canvas p-7 text-center shadow-float"
      style={{ translate: "-50% -50%", ...style }}
    >
      <span className="grid size-14 place-items-center rounded-full bg-ok-bg text-ok-fg">
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.25}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <div>
        <div className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
          <span className="font-mono">{po}</span> created
        </div>
        {children && <div className="mt-1.5 text-[1rem] text-body">{children}</div>}
      </div>
    </div>
  )
}

export const KEMEJA_LINE: ComposerLine = {
  name: "Kemeja Oxford Lengan Panjang",
  kind: "Pria · Kemeja",
  pieces: 600,
  inUnit: `${num(50)} lusin`,
  price: "Rp 1.020.000 / lusin",
  amount: 51_000_000,
}

const POP = "absolute z-20 rounded-card border border-hairline-2 bg-canvas p-1 shadow-pop"
const popStyle = (open: number) => ({
  opacity: open,
  scale: String(0.97 + open * 0.03),
  transformOrigin: "top left",
})

/** The supplier search's list (composer.tsx): matches, then "Create". */
function SupplierMenu({ open, hover = 0 }: { open: number; hover?: number }) {
  const rows = ["Garmen Nusantara, PT", "Sinar Garmen Utama, CV"]
  return (
    <div className={POP} style={{ ...popStyle(open), top: 76, left: 0, right: 0 }}>
      {rows.map((row, i) => (
        <div
          key={row}
          className={cn(
            "flex h-9 items-center rounded-inner px-2.5 text-[0.9375rem]",
            i === hover ? "bg-soft-2 text-ink" : "text-text"
          )}
        >
          {row}
        </div>
      ))}
      <div className="my-1 h-px bg-hairline" />
      <div className="flex h-9 items-center gap-1.5 px-2.5 text-[0.9375rem] text-body">
        <Plus className="size-4 text-line-ico" /> Create a new supplier
      </div>
    </div>
  )
}

/** The Delivery Date calendar: October 2026, today (the 8th) in blue. */
function Calendar({ open, hover }: { open: number; hover?: number }) {
  const days = ["M", "T", "W", "T", "F", "S", "S"]
  /* 1 Oct 2026 is a Thursday: three days of September lead. */
  const cells = [28, 29, 30, ...Array.from({ length: 31 }, (_, i) => i + 1), 1]
  return (
    <div className={cn(POP, "w-[320px] p-3")} style={{ ...popStyle(open), top: 76, left: 0 }}>
      <div className="mb-2 flex items-center justify-between px-1 text-[0.9375rem] font-medium text-ink">
        <span className="text-line-ico">‹</span> October 2026 <span className="text-line-ico">›</span>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[0.875rem]">
        {days.map((d, i) => (
          <span key={i} className="py-1 text-mute">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          const out = i < 3 || i > 33
          const past = !out && d < 8
          return (
            <span
              key={i}
              className={cn(
                "mx-auto grid size-8 place-items-center rounded-inner tabular-nums",
                out || past ? "text-faint" : "text-text",
                !out && d === 8 && "font-semibold text-accent",
                !out && d === hover && "bg-accent text-white"
              )}
            >
              {d}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** Payment Method's menu: it opens over the field, the chosen one ticked. */
function MethodMenu({ open, hover }: { open: number; hover?: string }) {
  const rows = ["Choose a method", "Giro", "Transfer", "Cash"]
  return (
    <div className={POP} style={{ ...popStyle(open), top: 28, left: 0, right: 0 }}>
      {rows.map((row) => (
        <div
          key={row}
          className={cn(
            "flex h-9 items-center justify-between rounded-inner px-2.5 text-[0.9375rem]",
            row === hover ? "bg-soft-2 text-ink" : "text-text"
          )}
        >
          {row}
          {row === "Choose a method" && <Check className="size-4 text-line-ico" />}
        </div>
      ))}
    </div>
  )
}
