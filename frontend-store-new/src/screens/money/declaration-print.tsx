import { Dialog } from "@base-ui/react/dialog"
import { Download, Printer, X } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { dateText } from "@/lib/format"
import { DENOMINATIONS } from "@/lib/queries/money-declaration"
import { cn } from "@/lib/utils"
import { printNode } from "@/screens/money/petty-printing"
import { units } from "@itulah/contract/money"

/// Print on a cashier's page, as the hub's purchasing does it
/// (`frontend-hub/src/screens/procurement/print-menu.tsx`): a white button with
/// the printer and the word in blue opens a small modal — the page drawn to
/// scale, the paper and the way up beside it, Download PDF (red outline) and
/// Print (blue). The paper is the 7Soft-style CASHIER CLOSING.

/// Everything the paper prints, worked out by the page that opens it.
export interface ClosingFigures {
  readonly shop: string
  readonly cashier: string
  readonly admin: string
  readonly opened: Date
  readonly openingFloat: number
  readonly sales: number
  readonly returns: number
  readonly cash: number
  readonly edc: readonly { readonly name: string; readonly amount: number }[]
  readonly deposits: number
  readonly closing: number
  readonly counted: number
  /// Pieces the cashier counted, by denomination, deposits and closing together.
  readonly pieces: Readonly<Record<number, number>>
  readonly closed: boolean
}

type Size = "A5" | "A4"
type Way = "portrait" | "landscape"

/// Plain CSS under `cc-`: the paper is copied into a frame to print, where the
/// page's utilities do not exist, and it must look the same in the preview.
const css = (size: Size, way: Way) => `
@page{size:${size} ${way};margin:12mm}
.cc{box-sizing:border-box;width:340px;margin:0 auto;padding:30px 26px 34px;background:#fff;color:#111;font:13px/1.5 Inter,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums}
.cc *{box-sizing:border-box}
.cc-title{font-size:17px;font-weight:700;letter-spacing:.2px}
.cc-sec{margin-top:16px}.cc-gap{margin-top:22px}
.cc-l{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:8px}
.cc-l span:first-child,.cc-l span:nth-child(2){white-space:nowrap}
.cc-l span:last-child{text-align:right;min-width:70px}
.cc-sub{margin:20px 0 4px;font-weight:700}
.cc-t{width:100%;border-collapse:collapse;table-layout:fixed}
.cc-t td{border:1px solid #333;padding:1px 4px;text-align:right;white-space:nowrap}
.cc-t td:first-child{text-align:left;border-right:0}.cc-t td:nth-child(2){border-left:0}
.cc-total{display:flex;justify-content:flex-end}
.cc-total span{min-width:76px;padding:2px 4px 1px;text-align:right;font-weight:700;border-bottom:3px double #111}
.cc-sign{display:flex;justify-content:space-between;margin-top:30px}
.cc-sign div{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:120px}
.cc-sign i{display:block;width:120px;height:52px;border-bottom:1px solid #111}
@media print{.cc{width:100%;max-width:none;padding:0}}
`

const dots = (n: number) => units(n)
const stamp = (when: Date) =>
  `${dateText(when, { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")} ${dateText(when, { hour: "2-digit", minute: "2-digit", hour12: false })}`

export function ClosingPaper({
  ref,
  figures,
  size,
  way,
}: {
  ref?: React.Ref<HTMLDivElement>
  figures: ClosingFigures
  size: Size
  way: Way
}) {
  const f = figures
  const rows = [
    ...new Set<number>([
      ...DENOMINATIONS,
      ...Object.keys(f.pieces).map(Number),
    ]),
  ].sort((a, b) => b - a)
  const onHand = f.deposits + f.closing
  const difference = f.counted - f.cash
  /// Label, middle, figure: three columns, the figures flush right.
  const L = (a: string, c: React.ReactNode, b: React.ReactNode = "") => (
    <div className="cc-l" key={a}>
      <span>{a}</span>
      <span>{c}</span>
      <span>{b}</span>
    </div>
  )
  return (
    <div ref={ref} className="cc">
      <style>{css(size, way)}</style>
      <div className="cc-title">{f.shop}</div>
      <div>
        {dateText(f.opened, { day: "numeric", month: "long", year: "numeric" })}
      </div>
      <div>CASHIER CLOSING</div>
      <div className="cc-sec">
        {L("Cashier", f.cashier)}
        {L("Date", stamp(f.opened))}
        {L("Opening Float", "Rp.", dots(f.openingFloat))}
      </div>
      <div className="cc-sec cc-gap">
        {L("Sales Total", "", dots(f.sales))}
        {L("Return Total", "", dots(f.returns))}
        {L("Net Total", "", dots(f.sales - f.returns))}
      </div>
      <div className="cc-sec">
        {L("Cash on Hand", "", dots(f.cash))}
        {f.edc.map((one) =>
          one.amount === 0 ? null : L(`Bank ${one.name}`, "", dots(one.amount)),
        )}
      </div>
      <div className="cc-sec">
        {L("Temporary Deposits", "", dots(f.deposits))}
        {L("Closing", "", dots(f.closing))}
        {L("Cash Counted", "", dots(f.counted))}
        {L(
          "Difference",
          "",
          `${difference < 0 ? "−" : ""}${dots(Math.abs(difference))}`,
        )}
      </div>
      <div className="cc-sec">
        {L("Printed", stamp(new Date()))}
        {L("Status", "", f.closed ? "CLOSED" : "OPEN")}
      </div>
      <div className="cc-sub">Denominations</div>
      <table className="cc-t">
        <colgroup>
          <col style={{ width: 26 }} />
          <col style={{ width: 62 }} />
          <col />
          <col style={{ width: 34 }} />
          <col style={{ width: 76 }} />
        </colgroup>
        <tbody>
          {rows.map((value) => {
            const n = f.pieces[value] ?? 0
            return (
              <tr key={value}>
                <td>Rp</td>
                <td>{dots(value)}</td>
                <td />
                <td>{n || "-"}</td>
                <td>{n ? dots(value * n) : "-"}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="cc-total">
        <span>{dots(onHand)}</span>
      </div>
      <div className="cc-sign">
        <div>
          <span>Cashier</span>
          <i />
          {f.cashier}
        </div>
        <div>
          <span>Admin</span>
          <i />
          {f.admin}
        </div>
      </div>
    </div>
  )
}

const remembered: { size: Size; way: Way } = { size: "A5", way: "portrait" }

/// Two choices side by side: the one on has a blue border, the other is faded.
function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { readonly value: T; readonly label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-2 justify-self-end">
      {options.map((one) => {
        const on = one.value === value
        return (
          <button
            key={one.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(one.value)}
            className={cn(
              "h-9 rounded-inner border px-4 text-[0.9375rem] transition-colors duration-150 ease-(--ease-out)",
              on
                ? "border-accent font-semibold text-accent"
                : "border-transparent text-mute hover:text-ink",
            )}
          >
            {one.label}
          </button>
        )
      })}
    </div>
  )
}

export function PrintClosing({ figures }: { figures: ClosingFigures }) {
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState<Size>(remembered.size)
  const [way, setWay] = useState<Way>(remembered.way)
  const paper = useRef<HTMLDivElement>(null)
  const pick = (nextSize: Size, nextWay: Way) => {
    remembered.size = nextSize
    remembered.way = nextWay
    setSize(nextSize)
    setWay(nextWay)
  }
  // The page drawn to scale: A4 landscape 220×156, A5 is A4 × 0.707.
  const long = (size === "A4" ? 220 : 156) * 1.45
  const short = (size === "A4" ? 156 : 110) * 1.45
  const [width, height] = way === "portrait" ? [short, long] : [long, short]
  const send = (file: boolean) => {
    if (paper.current !== null) {
      // The browser's print dialog writes a PDF as readily as it prints; the
      // file is named by the title.
      printNode(
        paper.current,
        `Cashier Closing · ${figures.cashier}${file ? " (PDF)" : ""}`,
      )
    }
    setOpen(false)
  }
  return (
    <>
      <Button
        variant="ghost"
        title="Print"
        onClick={() => setOpen(true)}
        className="rounded-full font-semibold text-accent [&_svg]:text-accent"
      >
        <Printer />
        Print
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[30rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
            <div className="flex items-start gap-3">
              <div>
                <Dialog.Title className="text-card-title font-semibold text-ink">
                  Print
                </Dialog.Title>
                <div className="text-meta text-mute">
                  Cashier Closing · {figures.cashier}
                </div>
              </div>
              <Dialog.Close
                aria-label="Close"
                className={cn(
                  button({ variant: "quiet", size: "icon" }),
                  "ml-auto rounded-full",
                )}
              >
                <X />
              </Dialog.Close>
            </div>
            <div className="mt-4 grid h-[15.5rem] place-items-center rounded-inner bg-soft-3">
              <div
                aria-hidden
                className="overflow-hidden bg-canvas p-2 shadow-soft transition-[width,height] duration-(--t-panel) ease-(--ease-out) motion-reduce:transition-none"
                style={{ width, height }}
              >
                <div
                  className="origin-top-left"
                  style={{ width: 340, scale: (width - 16) / 340 }}
                >
                  <ClosingPaper
                    ref={paper}
                    figures={figures}
                    size={size}
                    way={way}
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-[0.9375rem] text-ink">
              <span>Paper</span>
              <Choice
                options={[
                  { value: "A5", label: "A5" },
                  { value: "A4", label: "A4" },
                ]}
                value={size}
                onChange={(next) => pick(next, way)}
              />
              <span>Layout</span>
              <Choice
                options={[
                  { value: "landscape", label: "Landscape" },
                  { value: "portrait", label: "Portrait" },
                ]}
                value={way}
                onChange={(next) => pick(size, next)}
              />
            </div>
            <div className="mt-5 flex items-center gap-2">
              {/* Blue goes to the printer, red is a file. */}
              <Button
                variant="quiet"
                className="border border-bad-fg/40! bg-canvas! font-semibold text-bad-fg [&_svg]:text-bad-fg"
                onClick={() => send(true)}
              >
                <Download />
                Download PDF
              </Button>
              <Button
                variant="primary"
                className="ml-auto px-5"
                onClick={() => send(false)}
              >
                <Printer />
                Print
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
