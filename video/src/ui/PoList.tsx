/* Procurement › Purchase Orders, as measured on :5480: four KPI cards, the
   Active / Completed / Cancelled tabs, the toolbar, and the table — header
   band 40px on soft, rows 89px, PO · Delivery Date · Ordered · Received ·
   Status (purchase-orders.tsx:1293-1851). */
import type { CSSProperties, ReactNode } from "react"
import { Calendar, ChevronsUpDown, Columns3, Search } from "lucide-react"
import type { ListRow } from "../data"
import { num, pcs, rp } from "../format"
import { PageTitle } from "./AppWindow"
import { Button, Card, StatusWord, cn } from "./kit"

const COLS = [358, 160, 172, 172, 202] as const

export interface RowLook {
  /** 0..1: the blue wash of a row that was just made (row-fresh). */
  fresh?: number
  /** A stamp pressed into the Status cell. */
  stamp?: ReactNode
  /** A Review Count button in place of the status word. */
  review?: { pressed?: number; hover?: boolean }
  /** Drawn over the row: to focus a camera on it, or ring it. */
  ring?: number
  style?: CSSProperties
}

export function PoList({
  rows,
  looks = {},
  kpis = { orders: 12, open: 9, overdue: 1, onOrder: "Rp 1,2 B" },
  newOrder,
  tab = "active",
}: {
  rows: readonly ListRow[]
  looks?: Record<string, RowLook>
  kpis?: { orders: number; open: number; overdue: number; onOrder: string }
  newOrder?: { pressed?: number; hover?: boolean }
  tab?: "active" | "completed"
}) {
  return (
    <div className="w-[1064px]">
      <PageTitle>Purchase Orders</PageTitle>
      <div className="grid grid-cols-4 gap-3">
        {(
          [
            ["Orders", num(kpis.orders)],
            ["Still open", num(kpis.open)],
            ["Overdue", num(kpis.overdue)],
            ["On order", kpis.onOrder],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <div className="text-[0.9375rem] text-body">{label}</div>
            <div className="mt-0.5 text-kpi font-semibold text-ink tabular-nums">{value}</div>
          </Card>
        ))}
      </div>

      <div className="mt-4 flex h-10 items-stretch gap-1 border-b border-hairline">
        {(
          [
            ["active", "Active PO", 9],
            ["completed", "Completed PO", 23],
            ["cancelled", "Cancelled PO", 1],
          ] as const
        ).map(([id, label, n]) => (
          <div
            key={id}
            className={cn(
              "relative flex items-center gap-1.5 px-3 pb-0.5 text-[0.875rem] font-medium",
              tab === id ? "text-ink" : "text-body"
            )}
          >
            {label}
            <span className="text-mute tabular-nums">{n}</span>
            {tab === id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
          </div>
        ))}
      </div>

      <div className="mt-4 mb-3 flex items-center gap-2">
        <div className="flex h-[34px] w-[176px] items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] text-faint">
          <Search className="size-4 text-line-ico" /> Search orders
        </div>
        {["Issued", "Delivery date"].map((one) => (
          <div
            key={one}
            className="flex h-[34px] w-[176px] items-center justify-between rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] text-mute"
          >
            {one} <Calendar className="size-4 text-line-ico" />
          </div>
        ))}
        <span className="flex-1" />
        <Button variant="quiet">
          <Columns3 /> Columns
        </Button>
        <Button variant="primary" pressed={newOrder?.pressed} hover={newOrder?.hover}>
          New order
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="flex h-10 items-center border-b border-hairline bg-soft text-[0.875rem] font-medium text-body">
          {(["PO", "Delivery Date", "Ordered", "Received", "Status"] as const).map(
            (head, i) => (
              <div
                key={head}
                className={cn(
                  "flex items-center gap-1 px-5",
                  (i === 2 || i === 3) && "justify-end"
                )}
                style={{ width: COLS[i] }}
              >
                {head}
                {i < 4 && <ChevronsUpDown className="size-3 text-faint" />}
              </div>
            )
          )}
        </div>
        {rows.map((row) => (
          <Row key={row.po} row={row} look={looks[row.po] ?? {}} />
        ))}
      </Card>
    </div>
  )
}

function Row({ row, look }: { row: ListRow; look: RowLook }) {
  const fresh = look.fresh ?? 0
  const offline = row.status === "Offline"
  return (
    <div
      className="relative flex h-[89px] items-center border-b border-hairline last:border-b-0"
      style={{
        background: fresh > 0 ? `rgb(239 245 255 / ${fresh})` : undefined,
        ...look.style,
      }}
    >
      <div className="px-5" style={{ width: COLS[0] }}>
        <div className="text-[0.875rem] leading-5 font-medium text-ink">{row.supplier}</div>
        <div className="text-[0.875rem] leading-5 text-mute">
          {offline ? (
            <span>Made 2 min ago · 1 item</span>
          ) : (
            <>
              <span className="font-mono">{row.po}</span> · {row.items}{" "}
              {row.items === 1 ? "item" : "items"}
            </>
          )}
        </div>
      </div>
      <div
        className={cn("px-5 text-[0.9375rem]", row.overdue ? "text-bad-fg" : "text-text")}
        style={{ width: COLS[1] }}
      >
        {row.delivery}
      </div>
      <div className="px-5 text-right" style={{ width: COLS[2] }}>
        <div className="text-[0.9375rem] font-medium text-ink tabular-nums">{pcs(row.ordered)}</div>
        <div className="text-[0.875rem] text-mute tabular-nums">{rp(row.orderedValue)}</div>
      </div>
      <div className="px-5 text-right" style={{ width: COLS[3] }}>
        {row.received === 0 && !row.beyond ? (
          <div className="text-[0.9375rem] text-mute">0 pcs</div>
        ) : (
          <>
            <div className="text-[0.9375rem] font-medium tabular-nums">
              <span className={row.received < row.ordered ? "text-bad-fg" : "text-ink"}>
                {pcs(row.received)}
              </span>
              {row.beyond ? (
                <span className="font-normal text-bad-fg"> (+{num(row.beyond)})</span>
              ) : null}
            </div>
            <div className="text-[0.875rem] text-mute tabular-nums">{rp(row.receivedValue)}</div>
          </>
        )}
      </div>
      <div className="relative px-5" style={{ width: COLS[4] }}>
        {look.review ? (
          <Button
            variant="primary"
            size="sm"
            pressed={look.review.pressed}
            hover={look.review.hover}
          >
            Review Count
          </Button>
        ) : look.stamp ? (
          look.stamp
        ) : (
          <StatusWord
            tone={
              row.status === "Active"
                ? "ok"
                : row.status === "Partially received"
                  ? "info"
                  : row.status === "Offline"
                    ? "warn"
                    : "done"
            }
          >
            {row.status}
          </StatusWord>
        )}
      </div>
      {look.ring ? (
        <div
          className="pointer-events-none absolute inset-0 rounded-[2px] border-2 border-accent"
          style={{ opacity: look.ring }}
        />
      ) : null}
    </div>
  )
}

/** The y of row `i`'s top in window pixels (title 20+12, KPI 72, tabs 16+40,
    toolbar 16+34+12, header 40). Used to aim the camera. */
export const rowTop = (i: number) => 24 + 32 + 72 + 56 + 62 + 40 + i * 89
