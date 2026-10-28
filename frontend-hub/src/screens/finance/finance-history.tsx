import {
  keepPreviousData,
  useInfiniteQuery,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useEffectEvent, useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { Select } from "@/components/ui/field"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, NoAccessState } from "@/components/ui/states"
import { count, dateText, label } from "@/lib/format"
import {
  auditFeedQuery,
  readAction,
  type AuditEntry,
  type AuditScope,
} from "@/lib/queries/audit"
import { queryState } from "@/lib/query-state"
import type { SheetKey } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Finance › Master › History (7Soft 9.12, manual p.223): the audit trail of
/// who added, edited or deleted what, and when.
///
/// 7Soft's columns, in 7Soft's order: Tanggal (to the second), Menu, Tipe,
/// No Dokumen, User. The rows are the hub's audit log (`GET /api/v1/audit`) —
/// the same one System › Activity reads — narrowed to Finance: the server's
/// search is asked for `/finance/`, the one place a Finance route is written
/// in a row, and to the actions that went through (`OK`). A refused attempt is
/// System › Activity's to show; 7Soft's History never listed one.
///
/// **What the hub adds.** A user filter and a from–to range. 7Soft's screen
/// has neither (its only filter is the toolbar's Filter), and the range is
/// worth having on a log that only grows.
///
/// **What it cannot show, and why.**
///
/// - `LAPORAN EXPORT XLS`: the log records writes and never reads — a report
///   export is a read, and on this audit surface "who looked" is deliberately
///   not kept (`cloud/http/audit.rs`).
/// - No Dokumen is the document number when the row's payload carries one, and
///   otherwise the id of the record the action was filed against, a uuid
///   shortened to its first eight characters.
///
/// **The range is read in the browser.** The endpoint takes no dates, and the
/// log is walked newest first on the server's cursor, so a range that begins
/// in the past makes this screen keep asking for pages until the log reaches
/// the day it begins — up to `PAGE_CAP` pages — and says so if it stopped
/// before it got there.

/// Pages the screen will walk by itself to reach the start of a range. The
/// server's page is a hundred rows.
const PAGE_CAP = 40

/// The Finance question put to the log. A search over the path, which is where
/// every Finance route says which menu it belongs to.
const FINANCE: AuditScope = { q: "/finance/", outcome: "OK" }

/// 7Soft's menu, from the Finance route the action went through. A route this
/// map does not know is named by its own first word.
const MENU: Readonly<Record<string, string>> = {
  "cash-documents": "BKM · BKK",
  "cash-document-repeats": "BKM · BKK",
  giros: "Pencairan BG",
  "giro-print-templates": "Pencairan BG",
  deposits: "Info Kas Bank",
  "cash-counts": "Info Kas Bank",
  "bank-accounts": "Info Kas Bank",
  "bank-statements": "Info Kas Bank",
  "bank-lines": "Info Kas Bank",
  journal: "Transaksi Jurnal",
  "journal-templates": "Transaksi Jurnal",
  "journal-repeats": "Transaksi Jurnal",
  corrections: "Transaksi Jurnal",
  periods: "Closing Periode",
  "period-closing-vouchers": "Closing Periode",
  bills: "Faktur Pembelian",
  "bill-templates": "Faktur Pembelian",
  "credit-notes": "Invoice Retur Beli",
  accounts: "Account",
  "chart-changes": "Account",
  opening: "Saldo Awal COA",
  "account-links": "Setting COA",
  "account-link-history": "Setting COA",
  "posting-readiness": "Setting COA",
  policies: "Setting COA",
  assets: "Asset",
  depreciation: "Asset",
  "asset-classes": "Asset",
  permissions: "User & Group",
}

function menuOf(entry: AuditEntry): string {
  const rest = entry.path.replace(/^\/api\/v1\/finance\//, "")
  const first = rest.split("/")[0] ?? ""
  return MENU[first] ?? label(first)
}

/// 7Soft's Tipe: TAMBAH and EDIT, and HAPUS for a delete. Anything the hub
/// does that 7Soft has no word for — approve, post, reverse — keeps its own
/// verb, in capitals as 7Soft writes its types.
function tipeOf(entry: AuditEntry): string {
  const action = readAction(entry)
  if (action === "Created") return "TAMBAH"
  if (action === "Changed") return "EDIT"
  if (action === "Removed") return "HAPUS"
  return action.toUpperCase()
}

/// Where a Finance record is shown by id. A kind not here has no screen that
/// takes its id, and its No Dokumen is plain text.
const OPENS: Readonly<Record<string, { to: string; key: SheetKey }>> = {
  journal: { to: "/finance/accounting/journal-entries", key: "entry" },
  account: { to: "/finance/accounting/chart-of-accounts", key: "account" },
  bill: { to: "/finance/payables/bills", key: "bill" },
  asset: { to: "/finance/assets/capitalization", key: "asset" },
  bank_statement: {
    to: "/finance/cash-bank/bank-reconciliation",
    key: "statement",
  },
}

/// The document number an entry's payload carries, when it carries one: the
/// journal's, the bill's, the asset's. A payload without one leaves the id.
const NUMBER_KEYS = [
  "document_number",
  "entry_number",
  "journal_number",
  "bill_number",
  "invoice_number",
  "asset_number",
  "number",
  "reference",
] as const

function numberOf(entry: AuditEntry): string | null {
  const payload = (entry.payload ?? {}) as Record<string, unknown>
  for (const key of NUMBER_KEYS) {
    const value = payload[key]
    if (typeof value === "string" && value.trim() !== "") return value
  }
  return null
}

/// What the No Dokumen column reads: the number, or the id shortened.
const documentOf = (entry: AuditEntry) =>
  numberOf(entry) ??
  (entry.subject_id === null ? "" : shortId(entry.subject_id))

/// A uuid is not something a person reads; its first eight characters are what
/// they compare.
const shortId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id

const stamp = (at: string) => {
  const when = new Date(at)
  return Number.isNaN(when.getTime())
    ? at
    : dateText(when, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
}

/// The first and last millisecond of an ISO day, in the local calendar.
const startOf = (iso: string) => new Date(`${iso}T00:00:00`).getTime()
const endOf = (iso: string) => new Date(`${iso}T23:59:59.999`).getTime()

const columns: ColumnDef<TableSetup, AuditEntry>[] = [
  {
    id: "at",
    accessorFn: (row) => row.at,
    header: "Tanggal",
    size: 230,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">{stamp(row.original.at)}</span>
    ),
  },
  {
    id: "menu",
    accessorFn: (row) => menuOf(row),
    header: "Menu",
    size: 220,
    enableSorting: false,
    meta: { card: "title", grow: 180 },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{menuOf(row.original)}</span>
    ),
  },
  {
    id: "tipe",
    accessorFn: (row) => tipeOf(row),
    header: "Tipe",
    size: 140,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => tipeOf(row.original),
  },
  {
    id: "document",
    accessorFn: (row) => documentOf(row),
    header: "No Dokumen",
    size: 200,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => {
      const { subject_kind, subject_id } = row.original
      if (subject_id === null) return <span className="text-faint">—</span>
      const opens = subject_kind === null ? undefined : OPENS[subject_kind]
      return opens === undefined ? (
        <span title={subject_id} className="text-body">
          {documentOf(row.original)}
        </span>
      ) : (
        <AppLink
          to={opens.to}
          sheet={{ key: opens.key, value: subject_id }}
          title={subject_id}
          className="record-link"
        >
          {documentOf(row.original)}
        </AppLink>
      )
    },
  },
  {
    id: "user",
    accessorFn: (row) => row.display_name,
    header: "User",
    size: 200,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="text-body">{row.original.display_name}</span>
    ),
  },
]

export function FinanceHistory() {
  const client = useQueryClient()
  const [actor, setActor] = useState("")
  const [range, setRange] = useState<DayWindow>({ from: "", to: "" })
  const [needle, setNeedle] = useState("")
  const [tipe, setTipe] = useState("")

  const scope = useMemo<AuditScope>(
    () => (actor === "" ? FINANCE : { ...FINANCE, actor }),
    [actor]
  )
  // The previous answer stays while a new user's is read, so the people in the
  // filter do not vanish for the beat it takes.
  const feed = useInfiniteQuery({
    ...auditFeedQuery(scope),
    placeholderData: keepPreviousData,
  })
  const reading = useIsFetching({ queryKey: ["audit"] }) > 0

  const head = feed.data?.pages[0]
  const loaded = useMemo(
    () => feed.data?.pages.flatMap((page) => page.rows) ?? [],
    [feed.data]
  )
  const pages = feed.data?.pages.length ?? 0

  const fromAt = range.from === "" ? null : startOf(range.from)
  const toAt = range.to === "" ? null : endOf(range.to)
  const inRange = useMemo(
    () =>
      loaded.filter((row) => {
        const at = Date.parse(row.at)
        return (
          (fromAt === null || at >= fromAt) && (toAt === null || at <= toAt)
        )
      }),
    [loaded, fromAt, toAt]
  )
  // 7Soft's Tipe, with how many of the entries in hand each one holds.
  const tipes = useMemo(() => {
    const held = new Map<string, number>()
    for (const row of inRange) {
      const one = tipeOf(row)
      held.set(one, (held.get(one) ?? 0) + 1)
    }
    return [...held.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [inRange])
  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return inRange.filter(
      (row) =>
        (tipe === "" || tipeOf(row) === tipe) &&
        (text === "" ||
          `${menuOf(row)} ${tipeOf(row)} ${documentOf(row)} ${row.display_name} ${row.username}`
            .toLowerCase()
            .includes(text))
    )
  }, [inRange, needle, tipe])

  // The log is newest first, so the oldest row in hand says how far back it
  // has been read. A range that starts before that — or, with only an end, has
  // not been reached yet — needs another page.
  const oldest = loaded.at(-1)
  const oldestAt = oldest === undefined ? null : Date.parse(oldest.at)
  const behind =
    oldestAt !== null &&
    (fromAt !== null ? oldestAt >= fromAt : toAt !== null && oldestAt > toAt)
  const more =
    behind &&
    feed.hasNextPage &&
    !feed.isFetchingNextPage &&
    !feed.isFetchNextPageError &&
    pages < PAGE_CAP
  const ask = useEffectEvent(() => void feed.fetchNextPage())
  useEffect(() => {
    if (more) ask()
  }, [more, loaded.length])
  const stopped = behind && feed.hasNextPage && pages >= PAGE_CAP

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AuditEntry) => String(row.audit_id),
      }),
      [rows]
    )
  )

  const dated = fromAt !== null || toAt !== null || needle !== "" || tipe !== ""
  const total = dated ? rows.length : head?.total

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Master"
        title="History"
        actions={
          <>
            <Button variant="primary" onClick={() => window.print()}>
              Print
            </Button>
            <Button
              variant="primary"
              pending={reading}
              onClick={() =>
                void client.refetchQueries({
                  queryKey: ["audit"],
                  type: "active",
                })
              }
            >
              Refresh
            </Button>
          </>
        }
      />

      <Toolbar className="group/bar">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search history"
        />
        <Segmented
          options={[
            { value: "", label: `Semua ${count(inRange.length)}` },
            ...tipes.map(([value, held]) => ({
              value,
              label: `${value} ${count(held)}`,
            })),
          ]}
          value={tipe}
          onChange={setTipe}
        />
        <span className="inline-flex w-56 max-w-full shrink-0">
          <Select
            value={actor}
            onChange={setActor}
            aria-label="User"
            className="h-control w-56 max-w-full"
          >
            <option value="">All users</option>
            {actor !== "" &&
              !head?.facets?.actors.some((one) => one.value === actor) && (
                <option value={actor}>{actor}</option>
              )}
            {head?.facets?.actors.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label ?? one.value}
              </option>
            ))}
          </Select>
        </span>
        <DayRange
          label="Tanggal"
          placeholder="Tanggal"
          value={range}
          onChange={setRange}
          className="h-control min-h-0 w-52 shrink-0 py-0"
        />
        {total !== undefined && total !== null && (
          <span className="ml-auto text-meta text-mute tabular-nums">
            {count(total)} {total === 1 ? "entry" : "entries"}
          </span>
        )}
      </Toolbar>

      {stopped && (
        <Banner tone="warn" className="mb-3">
          The newest {count(loaded.length)} entries were read and the range
          starts earlier. Narrow the range to a user or a later start to see the
          rest.
        </Banner>
      )}

      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(feed, {
          refused: <NoAccessState what="the audit trail" />,
          render: () =>
            rows.length === 0 && !(behind && feed.hasNextPage && !stopped) ? (
              <EmptyState>
                {dated || actor !== ""
                  ? "No Finance action matches what you asked for."
                  : "No Finance action has been recorded yet."}
              </EmptyState>
            ) : (
              <DataTable<AuditEntry>
                refresh={[feed]}
                table={table}
                more={feed}
                pageScroll
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
