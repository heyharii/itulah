/* Return PO: a card per supplier (supplier-return-groups.tsx), measured on
   :5480. The band carries the supplier, what goes back to them in all and —
   in Ops — the next step: Generate Delivery Note, then Print, Download and
   Confirm, which is the hand-over (operations/board/suppliers.tsx:55). The
   Status column reads the note: Not Generated → Generated → Completed. A
   return off a count is worth Rp 0: the order was only ever valued at what
   matched it. */
import { ChevronsUpDown, Download, Printer, Search } from "lucide-react"
import { num, pcs } from "../format"
import { PageTitle } from "./AppWindow"
import { Button, Card, Sheet, Tag, cn } from "./kit"

export type NoteStatus = "Not Generated" | "Generated" | "Completed"

export interface ReturnRow {
  po: string
  rs: string
  pieces: number
  reason: string
  status: NoteStatus
  date: string
}

export interface ReturnGroup {
  supplier: string
  rows: readonly ReturnRow[]
}

export function ReturnBoard({
  groups,
  ops,
  hot,
  pressed = 1,
}: {
  groups: readonly ReturnGroup[]
  /** Ops' board: the band carries the hand-over steps. */
  ops?: boolean
  hot?: "generate" | "confirm"
  pressed?: number
}) {
  return (
    <div className="w-[1064px]">
      <PageTitle>Return PO</PageTitle>
      <div className="flex h-10 items-stretch gap-1 border-b border-hairline">
        <div className="relative flex items-center gap-1.5 px-3 text-[0.875rem] font-medium text-ink">
          Open <span className="text-mute">{groups.reduce((s, g) => s + g.rows.length, 0)}</span>
          <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />
        </div>
        <div className="flex items-center gap-1.5 px-3 text-[0.875rem] font-medium text-body">
          Completed <span className="text-mute">4</span>
        </div>
        {!ops && (
          <div className="ml-auto self-center text-[0.9375rem] text-body">
            Suppliers still owe <b className="font-semibold text-ink">Rp 0</b>
          </div>
        )}
      </div>
      <div className="mt-4 mb-3 flex h-[34px] w-[226px] items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] text-faint">
        <Search className="size-4 text-line-ico" />
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const total = group.rows.reduce((s, r) => s + r.pieces, 0)
          const made = group.rows.every((r) => r.status !== "Not Generated")
          return (
            <Card key={group.supplier} className="overflow-hidden">
              <div className="flex items-center gap-4 bg-soft-2 px-5 py-3.5">
                <div className="flex-1">
                  <div className="text-[1rem] font-semibold text-ink">{group.supplier}</div>
                  <div className="text-[0.875rem] text-body">
                    {group.rows.length} PO
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[1rem] font-semibold text-ink tabular-nums">{pcs(total)}</div>
                  <div className="text-[0.875rem] text-body">
                    {group.rows.length} item · Rp 0
                  </div>
                </div>
                {ops && (
                  <div className="flex items-center gap-2">
                    {made ? (
                      <>
                        <Button variant="ghost" className="w-9 px-0">
                          <Printer />
                        </Button>
                        <Button variant="ghost" className="w-9 px-0">
                          <Download />
                        </Button>
                        <Button
                          variant="tint"
                          className="h-8 px-3.5"
                          pressed={hot === "confirm" ? pressed : 1}
                        >
                          Confirm
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="tint"
                        className="h-8 px-3.5"
                        pressed={hot === "generate" ? pressed : 1}
                      >
                        Generate Delivery Note
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex h-10 items-center border-y border-hairline bg-soft text-[0.875rem] font-medium text-body">
                <div className="flex flex-1 items-center gap-1 px-5">
                  PO <ChevronsUpDown className="size-3 text-faint" />
                </div>
                <div className="w-[150px] px-5 text-right">Quantity</div>
                <div className="w-[110px] px-5 text-right">Value</div>
                <div className="w-[170px] px-5 text-right">Received Date</div>
                <div className="w-[170px] px-5 text-right">Status</div>
              </div>
              {group.rows.map((row) => (
                <div key={row.rs} className="flex h-[66px] items-center">
                  <div className="flex-1 px-5">
                    <div className="font-mono text-[0.875rem] font-medium text-ink">{row.po}</div>
                    <div className="font-mono text-[0.875rem] text-mute">{row.rs}</div>
                  </div>
                  <div className="w-[150px] px-5 text-right">
                    <div className="text-[0.9375rem] font-medium text-ink tabular-nums">{pcs(row.pieces)}</div>
                    <div className="text-[0.875rem] text-mute">1 item</div>
                  </div>
                  <div className="w-[110px] px-5 text-right text-mute">—</div>
                  <div className="w-[170px] px-5 text-right text-[0.9375rem] text-text">{row.date}</div>
                  <div
                    className={cn(
                      "w-[170px] px-5 text-right text-[0.9375rem]",
                      row.status === "Not Generated"
                        ? "text-warn-fg"
                        : row.status === "Completed"
                          ? "text-ok-fg"
                          : "text-info-fg"
                    )}
                  >
                    {row.status}
                  </div>
                </div>
              ))}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/** A return's own sheet (supplier-returns.tsx:600): its number, the
    supplier with the reason as a tag, who is in charge, the PO it came off,
    and what goes back. */
export function ReturnSheet({
  row,
  supplier,
  article,
  x = 0,
  opacity = 1,
}: {
  row: ReturnRow
  supplier: string
  article: string
  x?: number
  opacity?: number
}) {
  return (
    <Sheet
      width={1000}
      mono={row.rs}
      title={supplier}
      side={<Tag>{row.reason}</Tag>}
      x={x}
      opacity={opacity}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost">
            <Printer /> Print
          </Button>
          <Button variant="ghost">
            <Download /> Download
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 px-7 pt-5">
        <dl className="grid grid-cols-2 gap-6">
          <div>
            <dt className="text-[0.875rem] text-body">Person in Charge</dt>
            <dd className="mt-1 text-[0.9375rem] text-ink">—</dd>
          </div>
          <div>
            <dt className="text-[0.875rem] text-body">PO</dt>
            <dd className="mt-1 font-mono text-[0.9375rem] text-accent">{row.po}</dd>
          </div>
        </dl>
        <div>
          <div className="mb-3 text-card-title font-semibold text-ink">Items</div>
          <div className="overflow-hidden rounded-card border border-hairline">
            <div className="flex border-b border-hairline bg-soft px-4 py-2.5 text-[0.875rem] font-medium text-body">
              <span className="flex-1">Item</span>
              <span>Quantity</span>
            </div>
            <div className="flex border-b border-hairline px-4 py-3.5 text-[0.9375rem]">
              <span className="flex-1 font-medium text-ink">{article}</span>
              <span className="text-ink tabular-nums">{num(row.pieces)}</span>
            </div>
            <div className="flex px-4 py-3.5 text-[0.9375rem] font-semibold">
              <span className="flex-1 text-ink">Total</span>
              <span className="text-ink tabular-nums">{num(row.pieces)}</span>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
