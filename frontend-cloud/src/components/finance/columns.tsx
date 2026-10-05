/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Button } from "@/components/ui/button"
import { ROOT_CLASSES } from "@/lib/finance"
import { money } from "@/lib/money"
import type { DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type {
  GeneralLedgerRow,
  JournalEntryRow,
  SupplierBill,
  TrialBalanceRow,
} from "@itulah/contract"
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Undo2 } from "lucide-react"

/// The finance tables' columns, kept away from the screens that draw them.
///
/// # Why these tables sort at all, when a ledger has a natural order
///
/// Because the order a ledger is kept in and the order somebody reads it in are
/// different things. A journal is written newest first and read "which of these
/// is the big one"; a trial balance is filed by the client's code and read
/// "which account is out". Neither question is answerable by scrolling 7,528
/// rows, and neither changes what is stored — the sort is a way of looking, and
/// the natural order is always one click away because it is the default.
///
/// The money columns sort by the minor unit, never by the formatted string.
/// `money()` renders `Rp 1.234.567`, and sorting those as text puts a million
/// between ten and eleven.
const numeric = "text-right font-mono tabular-nums"

/// A code that leads to the account's own ledger.
///
/// Every finance screen that names an account makes it a link to the same
/// place. Somebody reading a balance and asking "made of what" is asking for
/// the movements, and there is one screen that answers that.
function AccountLink({ code, name }: { code: string; name: string }) {
  return (
    <Link
      to="/finance/ledger"
      search={{ account: code }}
      className="flex items-baseline gap-2 hover:underline"
    >
      <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
        {code}
      </span>
      <span className="truncate">{name}</span>
    </Link>
  )
}

/// A figure that is blank when it is nothing.
///
/// A debit column full of `Rp 0` beside a credit column full of real numbers is
/// how a reader loses the shape of an entry. Zero is not a value here — it is
/// the absence of one, and it is drawn as absence.
function Figure({ minor, currency }: { minor: number; currency?: string }) {
  if (minor === 0) return null
  return <span>{money(minor, currency)}</span>
}

// ── Trial balance ──────────────────────────────────────────────────────────

/// The root class as a column rather than as a band across the table.
///
/// It used to be a heading row every time the class changed, which reads well
/// exactly once — while the rows are in the client's own order. The moment
/// anybody sorts by debit those bands are meaningless, and a table that cannot
/// be sorted is a table an accountant has to export to sort. As a column the
/// class survives every ordering, and it can be filtered on, which the bands
/// never could.
export const trialBalanceColumns: ColumnDef<DataTableFeatures, TrialBalanceRow>[] = [
  {
    accessorKey: "account_code",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
    cell: ({ row }) => <AccountLink code={row.original.account_code} name={row.original.name} />,
    filterFn: (row, _id, value) => {
      const needle = String(value ?? "")
        .trim()
        .toLowerCase()
      if (needle === "") return true
      return `${row.original.account_code} ${row.original.name}`.toLowerCase().includes(needle)
    },
  },
  {
    accessorKey: "root_class",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Class" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground truncate text-[11px]">
        {row.original.root_class} · {ROOT_CLASSES[row.original.root_class] ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "unit_id",
    header: "Unit",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-[11px]">
        {row.original.unit_id ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "debit_minor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Debit" align="end" />
    ),
    cell: ({ row }) => <Figure minor={row.original.debit_minor} />,
    meta: { headerClassName: "text-right", cellClassName: numeric },
  },
  {
    accessorKey: "credit_minor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Credit" align="end" />
    ),
    cell: ({ row }) => <Figure minor={row.original.credit_minor} />,
    meta: { headerClassName: "text-right", cellClassName: numeric },
  },
]

// ── General ledger ─────────────────────────────────────────────────────────

/// One account's movements.
///
/// The running balance is deliberately not sortable. It is a cumulative figure
/// computed by a window function over the posting order, so a row taken out of
/// that order carries a balance that was never true — the column would be
/// arithmetic about a sequence the reader is no longer looking at.
export const ledgerColumns: ColumnDef<DataTableFeatures, GeneralLedgerRow>[] = [
  {
    accessorKey: "posting_date",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.posting_date}</span>,
  },
  {
    accessorKey: "entry_number",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Entry" />,
    cell: ({ row }) => (
      <span className="font-mono text-[11.5px]">{row.original.entry_number}</span>
    ),
  },
  {
    id: "memo",
    header: "Memo",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground block truncate">
        {row.original.memo ?? row.original.source_kind.toLowerCase().replace(/_/g, " ")}
      </span>
    ),
    meta: { cellClassName: "max-w-0" },
  },
  {
    accessorKey: "debit_minor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Debit" align="end" />
    ),
    cell: ({ row }) => <Figure minor={row.original.debit_minor} />,
    meta: { headerClassName: "text-right", cellClassName: numeric },
  },
  {
    accessorKey: "credit_minor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Credit" align="end" />
    ),
    cell: ({ row }) => <Figure minor={row.original.credit_minor} />,
    meta: { headerClassName: "text-right", cellClassName: numeric },
  },
  {
    accessorKey: "running_minor",
    header: "Balance",
    enableSorting: false,
    cell: ({ row }) => (
      <span className={cn(row.original.running_minor < 0 && "text-amber-700")}>
        {money(row.original.running_minor)}
      </span>
    ),
    meta: { headerClassName: "text-right", cellClassName: numeric },
  },
]

// ── Journal ────────────────────────────────────────────────────────────────

export const journalColumns: ColumnDef<DataTableFeatures, JournalEntryRow>[] = [
  {
    accessorKey: "entry_number",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Entry" />,
    cell: ({ row }) => (
      <span className="font-mono text-[11.5px]">{row.original.entry_number}</span>
    ),
    filterFn: (row, _id, value) => {
      const needle = String(value ?? "")
        .trim()
        .toLowerCase()
      if (needle === "") return true
      const haystack = `${row.original.entry_number} ${row.original.memo ?? ""} ${row.original.posted_by}`
      return haystack.toLowerCase().includes(needle)
    },
  },
  {
    accessorKey: "posting_date",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.posting_date}</span>,
  },
  {
    accessorKey: "source_kind",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
    cell: ({ row }) => (
      <span className="bg-muted rounded px-1.5 py-0.5 text-[10.5px]">
        {row.original.source_kind.toLowerCase().replace(/_/g, " ")}
      </span>
    ),
  },
  {
    id: "memo",
    header: "Memo",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground block truncate">
        {/* A reversal is a link between two real entries and never a status on
            one of them. Both stay in the ledger; the arrow says which way. */}
        {row.original.reversal_of !== null && (
          <Undo2 className="mr-1 inline size-3 align-[-1px]" />
        )}
        {row.original.memo ?? ""}
      </span>
    ),
    meta: { cellClassName: "max-w-0" },
  },
  {
    accessorKey: "total_minor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Amount" align="end" />
    ),
    cell: ({ row }) => <span>{money(row.original.total_minor, row.original.currency)}</span>,
    meta: { headerClassName: "text-right", cellClassName: numeric },
  },
  {
    accessorKey: "posted_by",
    header: ({ column }) => <DataTableColumnHeader column={column} title="By" />,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.posted_by}</span>,
  },
]

// ── Supplier bills ─────────────────────────────────────────────────────────

/// The bills, with the overdue column carrying the reason the screen is open.
///
/// Sorting by `days_overdue` is what this table is for: a payables clerk is
/// asking "what is late", and the answer is a sort, not a scroll. The figure is
/// derived on every read — a stored age would be wrong by morning — so the
/// sorted order is right at the moment it is drawn and not before.
export function billColumns(
  post: (invoiceId: string) => void,
  busy: boolean,
): ColumnDef<DataTableFeatures, SupplierBill>[] {
  return [
    {
      accessorKey: "invoice_number",
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => (
        <span className="font-mono text-[11.5px]">{row.original.invoice_number}</span>
      ),
    },
    {
      accessorKey: "supplier_name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => <span>{row.original.supplier_name ?? row.original.supplier_id}</span>,
    },
    {
      accessorKey: "site_id",
      header: "Site",
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-[11px]">
          {row.original.site_id}
        </span>
      ),
    },
    {
      accessorKey: "invoice_date",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.invoice_date}</span>,
    },
    {
      accessorKey: "days_overdue",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
      cell: ({ row }) => {
        const late = row.original.status !== "POSTED" && row.original.days_overdue > 0
        return (
          <span className={cn("tabular-nums", late && "text-amber-700")}>
            {row.original.due_date ?? "—"}
            {late && ` · ${row.original.days_overdue}d`}
          </span>
        )
      },
    },
    {
      accessorKey: "total_minor",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Total" align="end" />
      ),
      cell: ({ row }) => (
        <span>{money(row.original.total_minor, row.original.currency)}</span>
      ),
      meta: { headerClassName: "text-right", cellClassName: numeric },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => {
        const posted = row.original.status === "POSTED"
        return (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10.5px]",
              posted ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
            )}
          >
            {row.original.status.toLowerCase()}
          </span>
        )
      },
    },
    {
      id: "act",
      header: "",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status === "POSTED" ? (
          row.original.entry_number === null ? null : (
            <Link
              to="/finance/journal"
              className="text-muted-foreground font-mono text-[11px] hover:underline"
            >
              {row.original.entry_number}
            </Link>
          )
        ) : (
          // Recording a bill and posting it are two acts, and this is the
          // second one. It stays in the row because the decision is about this
          // bill and nothing else.
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={busy}
            onClick={() => post(row.original.invoice_id)}
          >
            Post
          </Button>
        ),
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
  ]
}
