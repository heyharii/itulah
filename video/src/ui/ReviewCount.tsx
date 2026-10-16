/* The Review Count (count-review.tsx), measured on :5480: an 896-wide sheet,
   the supplier and who counted, then No. · Article · Ordered Quantity ·
   Counted Quantity · Difference, the Total band, the "Not as Ordered" band
   when the checker wrote any, the return line under the table, and the
   footer whose buttons depend on what the count found. After it is accepted,
   the receipt and the supplier's invoice. */
import type { CSSProperties } from "react"
import { Check, CircleAlert, CircleCheck, Undo2 } from "lucide-react"
import { pcs } from "../format"
import { correct, gap, summary, type Line } from "../scenarios"
import { Button, Diff, Input, Sheet, cn } from "./kit"

export type ReviewButton = "close" | "recount" | "partial" | "submit" | "send" | "done"

export interface ReviewState {
  /** 0..1: the Difference column revealing, row by row. */
  reveal?: number
  hot?: ReviewButton
  pressed?: number
  recount?: { ticked: readonly number[]; why: string; caret?: boolean }
  hideMatched?: boolean
  accepted?: {
    lines: number
    invoice?: { number: string; total: string; date: string; caret?: "number" }
    submit?: { pressed?: number; hover?: boolean }
    agrees?: number
  }
}

export function ReviewCount({
  po,
  supplier,
  lines,
  state = {},
  x = 0,
  opacity = 1,
}: {
  po: string
  supplier: string
  lines: readonly Line[]
  state?: ReviewState
  x?: number
  opacity?: number
}) {
  const sum = summary(lines)
  const off = !sum.exact
  const reveal = state.reveal ?? 1
  const recounting = state.recount !== undefined
  const btn = (id: ReviewButton) => ({
    pressed: state.hot === id ? state.pressed : 1,
    hover: state.hot === id,
  })

  const footer = state.accepted ? (
    <div className="flex justify-end">
      <Button variant="primary" {...btn("done")}>
        Done
      </Button>
    </div>
  ) : recounting ? (
    <div className="flex items-center gap-3">
      <Button variant="ghost">Back</Button>
      <span className="flex-1 text-body">
        {state.recount!.ticked.length} of {lines.length}{" "}
        {lines.length === 1 ? "line" : "lines"} ticked
      </span>
      <Button variant="primary" {...btn("send")} disabled={state.recount!.why === ""}>
        Send {state.recount!.ticked.length}{" "}
        {state.recount!.ticked.length === 1 ? "line" : "lines"} back to count
      </Button>
    </div>
  ) : (
    <div className="flex items-center justify-end gap-3">
      {sum.hasShort ? (
        <>
          <Button variant="soft" {...btn("close")}>
            Close Short
          </Button>
          <Button variant="soft" {...btn("recount")}>
            Recount
          </Button>
          <Button variant="primary" {...btn("partial")}>
            <Check /> Partial Receive
          </Button>
        </>
      ) : (
        <>
          <Button variant="soft" {...btn("recount")}>
            Recount
          </Button>
          <Button variant="primary" {...btn("submit")}>
            <Check /> Submit
          </Button>
        </>
      )}
    </div>
  )

  return (
    <Sheet
      width={896}
      mono={po}
      title="Review Count"
      side={
        off ? (
          <CircleAlert className="size-[18px] text-bad-fg" />
        ) : (
          <CircleCheck className="size-[18px] text-ok-fg" />
        )
      }
      x={x}
      opacity={opacity}
      footer={footer}
    >
      {state.accepted ? (
        <Accepted accepted={state.accepted} />
      ) : (
        <div className="flex flex-col gap-6 px-8 pt-5">
          <dl className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 text-[0.9375rem]">
            <dt className="text-mute">Supplier</dt>
            <dd className="mr-6 text-body">{supplier}</dd>
            <dt className="text-mute">Counted</dt>
            <dd className="text-body">Yusuf Ramadhan · 08 Oct 2026, 14:20</dd>
          </dl>

          <div className="flex flex-col gap-4">
            {state.hideMatched !== undefined && (
              <div className="flex items-center justify-end gap-2.5 text-[0.9375rem] text-body">
                Hide matched
                <span
                  className={cn(
                    "relative h-5 w-9 rounded-full",
                    state.hideMatched ? "bg-accent" : "bg-hairline-strong"
                  )}
                >
                  <span
                    className="absolute top-0.5 size-4 rounded-full bg-white shadow-soft"
                    style={{ left: state.hideMatched ? 18 : 2 }}
                  />
                </span>
              </div>
            )}
            <Table lines={lines} reveal={reveal} recount={state.recount} hideMatched={state.hideMatched} />
          </div>

          {recounting ? (
            <div className="flex flex-col gap-3">
              <div className="text-[1rem] font-semibold text-ink">
                Why should it be counted again?
              </div>
              <div
                className={cn(
                  "h-[96px] rounded-inner border bg-canvas px-3 py-2.5 text-[0.9375rem] text-ink",
                  state.recount!.caret
                    ? "border-accent shadow-[0_0_0_3px_rgb(37_99_235/12%)]"
                    : "border-hairline-2"
                )}
              >
                {state.recount!.why}
                {state.recount!.caret && (
                  <span className="ml-px inline-block h-5 w-[1.5px] translate-y-1 bg-ink" />
                )}
              </div>
            </div>
          ) : (
            sum.returnLine && (
              <p
                className="flex items-center gap-2.5 px-1 text-[0.9375rem] text-body"
                style={{ opacity: reveal >= 1 ? 1 : 0 }}
              >
                <Undo2 className="size-[18px] shrink-0 text-info-fg" />
                <span>
                  <b className="font-medium text-ink">{sum.returnLine.bold}</b>
                  {sum.returnLine.rest}
                  {sum.returnLine.mute && <span className="text-mute">{sum.returnLine.mute}</span>}
                </span>
              </p>
            )
          )}
        </div>
      )}
    </Sheet>
  )
}

function Table({
  lines,
  reveal,
  recount,
  hideMatched,
}: {
  lines: readonly Line[]
  reveal: number
  recount?: ReviewState["recount"]
  hideMatched?: boolean
}) {
  const HEAD = "px-4 py-2.5 text-[0.875rem] font-medium text-body"
  const CELL = "px-4 py-3.5 text-[0.9375rem] tabular-nums"
  const totalOwed = lines.reduce((s, l) => s + l.owed, 0)
  const totalCounted = lines.reduce((s, l) => s + correct(l), 0)
  const totalWrong = lines.reduce((s, l) => s + l.wrong, 0)
  const sum = summary(lines)
  const shown = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => !(hideMatched && gap(line) === 0 && line.wrong === 0))
  /* Short and extra apart: an extra on one line never makes up a short on
     another (count-review.tsx:913). */
  const totalWords = [
    sum.shortQty > 0 ? `${pcs(sum.shortQty)} short` : null,
    sum.overQty > 0 ? `${pcs(sum.overQty)} extra` : null,
  ].filter(Boolean)
  return (
    <div className="overflow-hidden rounded-card border border-hairline">
      <div className="flex border-b border-hairline bg-soft">
        {recount && <div className={cn(HEAD, "w-12")} />}
        <div className={cn(HEAD, "w-14")}>No.</div>
        <div className={cn(HEAD, "flex-1")}>Article</div>
        <div className={cn(HEAD, "w-[160px]")}>Ordered Quantity</div>
        <div className={cn(HEAD, "w-[160px]")}>Counted Quantity</div>
        <div className={cn(HEAD, "w-[152px]")}>Difference</div>
      </div>
      {shown.map(({ line, i }) => {
        const k = Math.max(0, Math.min(1, reveal * lines.length - i))
        const ticked = recount?.ticked.includes(i)
        return (
          <div key={line.article} className="flex items-center border-b border-hairline">
            {recount && (
              <div className="w-12 pl-4">
                <span
                  className={cn(
                    "grid size-[18px] place-items-center rounded-[5px] border",
                    ticked ? "border-accent bg-accent text-white" : "border-hairline-strong bg-canvas"
                  )}
                >
                  {ticked && <Check className="size-3" strokeWidth={3} />}
                </span>
              </div>
            )}
            <div className={cn(CELL, "w-14 text-mute")}>{i + 1}</div>
            <div className={cn(CELL, "flex-1")}>
              <div className="text-ink">{line.article}</div>
              <div className="text-[0.875rem] text-mute">{line.kind}</div>
            </div>
            <div className={cn(CELL, "w-[160px] text-body")}>{pcs(line.owed)}</div>
            <div className={cn(CELL, "w-[160px] text-body")}>{pcs(correct(line))}</div>
            <div className={cn(CELL, "w-[152px]")}>
              <Diff value={gap(line)} style={chip(k)} />
            </div>
          </div>
        )
      })}
      <div className="flex items-center bg-soft-2 font-medium">
        {recount && <div className="w-12" />}
        <div className="w-14" />
        <div className={cn(CELL, "flex-1 text-ink")}>Total</div>
        <div className={cn(CELL, "w-[160px] text-ink")}>{pcs(totalOwed)}</div>
        <div className={cn(CELL, "w-[160px] text-ink")}>{pcs(totalCounted)}</div>
        <div
          className={cn(CELL, "flex w-[152px] flex-col leading-tight text-bad-fg")}
          style={{ opacity: reveal >= 1 ? 1 : 0 }}
        >
          {totalWords.length === 0 ? (
            <span className="text-body">—</span>
          ) : (
            totalWords.map((w) => <span key={w}>{w}</span>)
          )}
        </div>
      </div>
      {totalWrong > 0 && (
        <div className="flex items-center border-t border-hairline bg-soft">
          {recount && <div className="w-12" />}
          <div className="w-14" />
          <div className={cn(CELL, "flex-1 font-medium text-body")}>Not as Ordered</div>
          <div className="w-[160px]" />
          <div className={cn(CELL, "w-[160px] text-bad-fg")}>{pcs(totalWrong)}</div>
          <div className="w-[152px]" />
        </div>
      )}
    </div>
  )
}

/** A chip landing: rises 6px, a hair small, ease-out — never from nothing. */
const chip = (k: number): CSSProperties => ({
  opacity: k,
  translate: `0px ${(1 - k) * 6}px`,
  scale: String(0.96 + 0.04 * k),
  display: "inline-flex",
})

function Accepted({ accepted }: { accepted: NonNullable<ReviewState["accepted"]> }) {
  const inv = accepted.invoice
  return (
    <div className="flex flex-col gap-5 px-8 pt-6">
      <div className="flex items-center gap-2.5 rounded-card bg-ok-bg px-4 py-3 text-[0.9375rem] font-medium text-ok-fg">
        <CircleCheck className="size-[18px]" />
        {accepted.lines} {accepted.lines === 1 ? "line" : "lines"} accepted.
      </div>
      <div>
        <div className="mb-3 text-card-title font-semibold text-ink">Supplier invoice</div>
        {accepted.agrees !== undefined && accepted.agrees > 0 ? (
          <div style={{ opacity: accepted.agrees }}>
            <dl className="grid grid-cols-3 gap-6">
              {[
                ["Invoice", inv?.number ?? ""],
                ["Billed", inv?.total ?? ""],
                ["Price for what was counted", inv?.total ?? ""],
              ].map(([term, value]) => (
                <div key={term}>
                  <dt className="text-[0.875rem] text-body">{term}</dt>
                  <dd className="mt-1 text-[0.875rem] text-ink tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <span className="mt-4 inline-flex h-7 items-center rounded-inner bg-ok-bg px-2.5 text-[0.9375rem] font-medium text-ok-fg">
              The invoice agrees
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-2 text-[0.9375rem] font-medium text-ink">
                Invoice Number<span className="ml-0.5 text-bad">*</span>
              </div>
              <Input value={inv?.number} caret={inv?.caret === "number"} focused={inv?.caret === "number"} mono />
            </div>
            <div>
              <div className="mb-2 text-[0.9375rem] font-medium text-ink">Invoice Total</div>
              <Input value={inv?.total.replace("Rp ", "")} prefix="Rp" />
            </div>
            <div>
              <div className="mb-2 text-[0.9375rem] font-medium text-ink">Invoice Date</div>
              <Input value={inv?.date} />
            </div>
            <div className="flex justify-end">
              <Button
                variant="primary"
                pressed={accepted.submit?.pressed}
                hover={accepted.submit?.hover}
              >
                Submit
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Close This Short?" (count-review.tsx:1056): the ConfirmButton's dialog. */
export function CloseShortDialog({
  shortQty,
  reason,
  caret,
  confirm,
  style,
}: {
  shortQty: number
  reason: string
  caret?: boolean
  confirm?: { pressed?: number; hover?: boolean }
  style?: CSSProperties
}) {
  return (
    <div
      className="absolute top-1/2 left-1/2 w-[26rem] rounded-card border border-hairline-2 bg-canvas p-5 shadow-float"
      style={{ translate: "-50% -50%", ...style }}
    >
      <div className="text-card-title font-semibold text-ink">Close This Short?</div>
      <div className="mt-2 text-[0.875rem] leading-relaxed text-body">
        {pcs(shortQty)} will be removed from the order, and the PO completes as
        received. This can&apos;t be undone.
      </div>
      <div className="mt-4">
        <div className="mb-2 text-[0.875rem] font-medium text-ink">
          Reason for Closing <span className="font-normal text-mute">(optional)</span>
        </div>
        <div
          className={cn(
            "min-h-[72px] rounded-inner border bg-canvas px-3 py-2 text-[0.9375rem] text-ink",
            caret ? "border-accent shadow-[0_0_0_3px_rgb(37_99_235/12%)]" : "border-hairline-2"
          )}
        >
          {reason}
          {caret && <span className="ml-px inline-block h-5 w-[1.5px] translate-y-1 bg-ink" />}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger" pressed={confirm?.pressed} hover={confirm?.hover}>
          Close Short
        </Button>
      </div>
    </div>
  )
}
