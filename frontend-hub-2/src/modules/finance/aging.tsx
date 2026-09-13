import { useMemo } from "react"
import { CalendarDays } from "lucide-react"
import type { PayablesAging, PayablesAgingRow } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading } from "@/kit/state"
import { amount, count, rp, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"

/// Aged payables — what is owed, arranged by how long it has been owed.
///
/// ## Why this is a screen and not a filter on the bills list
///
/// Because ageing is a **function of a date**, not a property of a bill. Move
/// the as-at date and every column moves with it; the same bill sits in three
/// different buckets on three different days. A list of bills cannot express
/// that — it would have to re-sort itself every time somebody changed a date it
/// does not have — so the report owns the date and says so at the top.
///
/// The second reason is population. This report counts only **posted** bills
/// with something still outstanding. The bills list shows every status. Click
/// through from a bucket to that list and the rows will not agree, and they are
/// not meant to: one is what the books owe, the other is every document on
/// file. This screen does not pretend the two are one query.
///
/// ## The buckets are hardcoded, deliberately
///
/// `AgingBuckets` is five named fields rather than an array, so the ORDER and
/// the LABELS belong to the client. That is the right side to own them: "1–30"
/// is a business convention, not a database fact, and a server that shipped the
/// labels would have to ship them again the day the convention changes.
///
/// `total_minor` is their sum — it is never a sixth segment, or every bar
/// doubles.

const BUCKETS = [
  { id: "not_due", label: "Not due", key: "not_due_minor", tone: "var(--ok)" },
  {
    id: "d30",
    label: "1–30 days",
    key: "days_1_30_minor",
    tone: "var(--c-amber)",
  },
  {
    id: "d60",
    label: "31–60 days",
    key: "days_31_60_minor",
    tone: "var(--warn)",
  },
  {
    id: "d90",
    label: "61–90 days",
    key: "days_61_90_minor",
    tone: "var(--c-pink)",
  },
  {
    id: "over",
    label: "Over 90 days",
    key: "days_over_90_minor",
    tone: "var(--bad)",
  },
] as const

type BucketKey = (typeof BUCKETS)[number]["key"]

export function AgingScreen() {
  const url = useQueryState()
  const asOf = url.one("as_at") || today()
  const site = url.one("site")

  const report = useReport<PayablesAging>({
    key: ["finance", "payables-aging"],
    path: "/api/v1/finance/payables-aging",
    params: { as_of: asOf, site: site || null },
  })

  const data = report.data
  const suppliers = useMemo(() => data?.suppliers ?? [], [data])

  const columns: ColumnDef<TableSetup, PayablesAgingRow>[] = [
    {
      id: "supplier",
      header: "Supplier",
      size: 24,
      meta: { min: 200 },
      cell: ({ row }) => {
        const supplier = row.original
        return (
          <>
            <span className="text-ink block truncate font-medium">
              {supplier.supplier_name ?? supplier.supplier_id}
            </span>
            <span className="text-label text-ink-4 block">
              {count(supplier.bill_count)} open{" "}
              {supplier.bill_count === 1 ? "bill" : "bills"}
              {/* Negative means nothing is due yet — the oldest thing on the
                  account is still ahead of its date. Drawn as words because
                  "-12 days old" is a sentence nobody reads correctly. */}
              {supplier.oldest_days > 0 && (
                <> · oldest {count(supplier.oldest_days)}d</>
              )}
            </span>
          </>
        )
      },
    },
    ...BUCKETS.map<ColumnDef<TableSetup, PayablesAgingRow>>(
      (bucket, index) => ({
        id: bucket.id,
        header: bucket.label,
        size: 13,
        meta: {
          align: "right",
          // The newest bucket goes first when the width runs out: a payables
          // screen is read from the right, where the money that is late lives.
          priority: index === 0 ? 1 : index === 1 ? 2 : undefined,
          min: 108,
        },
        cell: ({ row }) => {
          const value = row.original.buckets[bucket.key as BucketKey]
          return (
            <span
              className={
                value === 0
                  ? "text-ink-4 tabular-nums"
                  : index >= 3
                    ? "text-bad-ink font-medium tabular-nums"
                    : "text-ink-2 tabular-nums"
              }
            >
              {value === 0 ? "—" : amount(value)}
            </span>
          )
        },
      }),
    ),
    {
      id: "total",
      header: "Total",
      size: 14,
      meta: { align: "right", min: 120 },
      cell: ({ row }) => (
        <span className="text-ink font-medium tabular-nums">
          {amount(row.original.buckets.total_minor)}
        </span>
      ),
    },
  ]

  const grand = data?.total
  const late = grand
    ? grand.days_1_30_minor +
      grand.days_31_60_minor +
      grand.days_61_90_minor +
      grand.days_over_90_minor
    : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Payables &amp; Expenses"
        title="Aged payables"
        description="What is owed, by how long it has been owed, on the day you choose."
      />

      {/* The one scope this screen has, and the one that changes every figure
          on it. `as at` rather than `during`: these are balances, not
          movements — see kit/scope.tsx for why the three never share a
          sentence. */}
      <ScopeLine
        scope={{ kind: "asAt", date: asOf }}
        unit={site || undefined}
        note="posted bills with something still outstanding"
      />

      <Tiles>
        <Tile
          label="Owed"
          value={grand?.total_minor ?? 0}
          note={`${count(suppliers.length)} suppliers`}
        />
        <Tile label="Not yet due" value={grand?.not_due_minor ?? 0} tone="ok" />
        <Tile
          label="Past due"
          value={late}
          tone={late > 0 ? "bad" : undefined}
          note="every bucket after the first"
        />
        <Tile
          label="Over 90 days"
          value={grand?.days_over_90_minor ?? 0}
          tone={(grand?.days_over_90_minor ?? 0) > 0 ? "bad" : undefined}
        />
      </Tiles>

      {/* The bar is the report read at a glance: five segments, one row, and
          the segments in the order they age. Drawn from the same numbers as
          the table under it — there is no second computation to disagree. */}
      {grand && grand.total_minor > 0 && (
        <div className="border-line shrink-0 border-b px-4 py-3">
          <div className="rounded-tag flex h-3 overflow-hidden">
            {BUCKETS.map((bucket) => {
              const value = grand[bucket.key as BucketKey]
              if (value === 0) return null
              return (
                <span
                  key={bucket.id}
                  title={`${bucket.label} — ${rp(value)}`}
                  style={{
                    width: `${(value / grand.total_minor) * 100}%`,
                    background: bucket.tone,
                  }}
                />
              )
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {BUCKETS.map((bucket) => {
              const value = grand[bucket.key as BucketKey]
              return (
                <span
                  key={bucket.id}
                  className="text-meta text-ink-3 flex items-center gap-1.5"
                >
                  <span
                    className="rounded-tag size-2 shrink-0"
                    style={{ background: bucket.tone }}
                  />
                  {bucket.label}
                  <span className="text-ink-4 tabular-nums">
                    {amount(value)}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      <Toolbar trailing={report.isFetching ? "Loading…" : undefined}>
        <label className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 items-center gap-2 border px-2.5">
          <CalendarDays className="text-ink-4 size-4 shrink-0" />
          <span className="text-ctl text-ink-4">As at</span>
          <input
            type="date"
            value={asOf}
            max={today()}
            onChange={(event) =>
              url.set({
                as_at:
                  event.target.value === today() ? null : event.target.value,
              })
            }
            className="text-ctl text-ink bg-transparent outline-none"
          />
        </label>
      </Toolbar>

      {report.isError ? (
        <Failed
          what="the ageing report"
          error={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : report.isPending ? (
        <Loading cols={7} />
      ) : suppliers.length === 0 ? (
        <Empty
          what="outstanding payables"
          detail={`Nothing was owed to any supplier as at ${asOf}. Only posted bills with a balance are counted here.`}
        />
      ) : (
        <Table
          columns={columns}
          rows={suppliers as PayablesAgingRow[]}
          rowId={(row) => row.supplier_id}
          caption={`Payables ageing as at ${asOf}`}
          foot={{
            supplier: (
              <>
                <b className="text-ink">{count(suppliers.length)}</b> suppliers
              </>
            ),
            not_due: amount(grand?.not_due_minor ?? 0),
            d30: amount(grand?.days_1_30_minor ?? 0),
            d60: amount(grand?.days_31_60_minor ?? 0),
            d90: amount(grand?.days_61_90_minor ?? 0),
            over: amount(grand?.days_over_90_minor ?? 0),
            total: <b className="text-ink">{rp(grand?.total_minor ?? 0)}</b>,
          }}
        />
      )}
    </div>
  )
}
