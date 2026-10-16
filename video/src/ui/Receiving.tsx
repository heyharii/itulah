/* Ops › Receiving and its count sheet (receiving.tsx), as measured on :5480.
   The list shows how many articles each order owes and never how many
   pieces; the sheet has no ordered figure anywhere — the count is blind. */
import { ChevronsUpDown, Plus } from "lucide-react"
import { pcs } from "../format"
import { PageTitle } from "./AppWindow"
import { Button, Card, Input, Select, Sheet, cn } from "./kit"

export interface IntakeRow {
  supplier: string
  po: string
  items: number
  counted?: { pieces: number; by: string; at: string }
  again?: boolean
}

export function ReceivingList({
  rows,
  hot,
}: {
  rows: readonly IntakeRow[]
  /** The row whose button the pointer is on. */
  hot?: { po: string; pressed?: number }
}) {
  return (
    <div className="w-[1064px]">
      <PageTitle>Receiving</PageTitle>
      <div className="flex h-10 items-stretch gap-1 border-b border-hairline">
        <div className="relative flex items-center gap-1.5 px-3 text-[0.875rem] font-medium text-ink">
          Purchase orders · {rows.filter((r) => !r.counted).length}
          <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />
        </div>
        <div className="flex items-center px-3 text-[0.875rem] font-medium text-body">
          Store returns
        </div>
      </div>
      <Card className="mt-4 overflow-hidden">
        <div className="flex h-10 items-center border-b border-hairline bg-soft text-[0.875rem] font-medium text-body">
          <div className="flex flex-1 items-center gap-1 px-5">
            PO <ChevronsUpDown className="size-3 text-faint" />
          </div>
          <div className="w-[160px] px-5 text-right">Items</div>
          <div className="w-[300px] px-5 text-right">Count</div>
        </div>
        {rows.map((row) => (
          <div
            key={row.po}
            className="flex h-[75px] items-center border-b border-hairline last:border-b-0"
          >
            <div className="flex-1 px-5">
              <div className="text-[0.9375rem] leading-5 font-medium text-ink">{row.supplier}</div>
              <div className="font-mono text-[0.875rem] leading-5 text-mute">{row.po}</div>
            </div>
            <div className="w-[160px] px-5 text-right text-[0.9375rem] text-text tabular-nums">
              {row.items}
            </div>
            <div className="flex w-[300px] justify-end px-5">
              {row.counted && !row.again ? (
                <div className="text-right">
                  <div className="text-[0.9375rem] font-medium text-ink tabular-nums">
                    {pcs(row.counted.pieces)}
                  </div>
                  <div className="text-[0.875rem] text-mute">
                    {row.counted.by} · {row.counted.at}
                  </div>
                </div>
              ) : (
                <Button
                  variant="tint"
                  size="sm"
                  pressed={hot?.po === row.po ? hot.pressed : 1}
                  className={cn(hot?.po === row.po && "bg-accent-bg/60")}
                >
                  {row.again ? "Count again" : "Count receive"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

export interface CountLine {
  article: string
  kind: string
  /** What is typed in the first box, and its unit. */
  typed: string
  unit: string
  caret?: boolean
  /** A second unit row ("+ Another unit"), e.g. loose pieces. */
  extra?: { typed: string; unit: string; caret?: boolean }
  pieces: number
}

export function CountSheet({
  po,
  supplier,
  lines,
  wrong,
  submit,
  x = 0,
  opacity = 1,
}: {
  po: string
  supplier: string
  lines: readonly CountLine[]
  wrong: { typed: string; caret?: boolean; pieces: number }
  submit?: { pressed?: number; hover?: boolean; enabled?: boolean }
  x?: number
  opacity?: number
}) {
  const total = lines.reduce((sum, l) => sum + l.pieces, 0)
  const HEAD = "px-4 py-2.5 text-[0.875rem] font-medium text-body"
  return (
    <Sheet
      width={1020}
      mono={po}
      title={supplier}
      x={x}
      opacity={opacity}
      footer={
        <div className="flex justify-end">
          <Button
            variant="primary"
            pressed={submit?.pressed}
            hover={submit?.hover}
            disabled={!submit?.enabled}
          >
            Submit count
          </Button>
        </div>
      }
    >
      <div className="px-7 pt-5">
        <div className="overflow-hidden rounded-card border border-hairline">
          <div className="flex border-b border-hairline bg-soft">
            <div className={cn(HEAD, "flex-1")}>Article</div>
            <div className={cn(HEAD, "w-[330px]")}>Counted</div>
            <div className={cn(HEAD, "w-[150px] text-right")}>In pieces</div>
          </div>
          {lines.map((line) => (
            <div key={line.article} className="flex items-start border-b border-hairline">
              <div className="flex-1 px-4 py-4">
                <div className="text-[0.9375rem] font-medium text-ink">{line.article}</div>
                <div className="text-[0.875rem] text-mute">{line.kind}</div>
              </div>
              <div className="w-[330px] px-4 py-3">
                <div className="flex gap-2">
                  <Input value={line.typed} caret={line.caret} focused={line.caret} align="center" className="w-[120px]" />
                  <Select value={line.unit} className="w-[150px]" />
                </div>
                {line.extra && (
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={line.extra.typed}
                      caret={line.extra.caret}
                      focused={line.extra.caret}
                      align="center"
                      className="w-[120px]"
                    />
                    <Select value={line.extra.unit} className="w-[150px]" />
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1 text-[0.875rem] text-body">
                  <Plus className="size-3.5" /> Another unit
                </div>
              </div>
              <div className="w-[150px] px-4 py-6 text-right text-[0.9375rem] text-ink tabular-nums">
                {line.pieces ? pcs(line.pieces) : "—"}
              </div>
            </div>
          ))}
          <div className="flex items-center border-b border-hairline bg-soft-2">
            <div className="flex-1 px-4 py-3.5 text-[0.9375rem] font-medium text-ink">
              Total Counted
            </div>
            <div className="w-[150px] px-4 py-3.5 text-right text-[0.9375rem] font-semibold text-ink tabular-nums">
              {pcs(total)}
            </div>
          </div>
          <div className="flex items-center bg-soft">
            <div className="flex-1 px-4 py-3">
              <div className="text-[0.9375rem] font-medium text-ink">Not as Ordered</div>
              <div className="text-[0.875rem] text-mute">Damaged or wrong items</div>
            </div>
            <div className="w-[330px] px-4 py-3">
              <div className="flex gap-2">
                <Input value={wrong.typed} caret={wrong.caret} focused={wrong.caret} align="center" className="w-[120px]" />
                <Select value="Piece" className="w-[150px]" />
              </div>
            </div>
            <div
              className={cn(
                "w-[150px] px-4 text-right text-[0.9375rem] tabular-nums",
                wrong.pieces ? "font-medium text-bad-fg" : "text-ink"
              )}
            >
              {wrong.pieces ? pcs(wrong.pieces) : "—"}
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
