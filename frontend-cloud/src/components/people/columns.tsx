/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { statusLabel } from "@/lib/employment"
import type { DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { EmployeeSummary } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

/// The workforce list's columns, kept away from the screen that draws them.
///
/// # Why this list sorts at all
///
/// Because the order the server keeps people in and the order somebody reads
/// them in are different questions. Payroll reads it by number, a supervisor
/// reads it by place, and whoever is chasing paperwork reads it by the date a
/// contract runs out. None of those change what is stored — the sort is a way
/// of looking, and the server's own order is one click away because it is what
/// the screen starts in.
///
/// # Why the sort keys are not the cells
///
/// Half these fields are nullable, and a record can legitimately exist before
/// anybody has typed a name into it. Every accessor below folds null to the
/// empty string so the missing ones gather at one end instead of scattering
/// through the list, while the cell keeps rendering the absence in words —
/// "not enrolled", "unposted", "none" — which is the thing a reader needs and
/// a sort key must not contain.

/// The status, as a colour and a sentence.
///
/// The dot is not decoration: it is the only part of the row somebody scanning
/// a hundred people actually reads, and the four states are four different
/// kinds of not-working.
function Status({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          status === "ACTIVE"
            ? "bg-emerald-500"
            : status === "CANDIDATE"
              ? "bg-sky-500"
              : status === "SUSPENDED"
                ? "bg-amber-500"
                : "bg-muted-foreground/40",
        )}
      />
      {statusLabel(status)}
    </span>
  )
}

export const peopleColumns: ColumnDef<DataTableFeatures, EmployeeSummary>[] = [
  {
    accessorKey: "employee_code",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Number" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs font-medium">{row.original.employee_code}</span>
    ),
  },
  {
    id: "full_name",
    accessorFn: (person: EmployeeSummary) => person.full_name ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <span className="block max-w-56 truncate text-xs">
        {/* A record can exist before anybody has typed a name into it — a
            candidate accepted on Friday, enrolled on Monday. Saying so is
            better than an empty cell that reads as a bug. */}
        {row.original.full_name ?? (
          <span className="text-muted-foreground italic">not enrolled</span>
        )}
      </span>
    ),
  },
  {
    id: "status",
    /// Sorted by the words on the screen rather than by the code behind them.
    /// A reader who clicks this header is grouping like with like, and being
    /// grouped in an order they cannot see is worse than alphabetical.
    accessorFn: (person: EmployeeSummary) => statusLabel(person.status),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <Status status={row.original.status} />,
  },
  {
    id: "position",
    accessorFn: (person: EmployeeSummary) => person.position ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Job" />,
    cell: ({ row }) => (
      <span className="text-xs">
        {row.original.position ?? <span className="text-muted-foreground">—</span>}
      </span>
    ),
  },
  {
    id: "place_name",
    accessorFn: (person: EmployeeSummary) => person.place_name ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Place" />,
    cell: ({ row }) => (
      <span className="text-xs">
        {row.original.place_name ?? (
          <span className="text-muted-foreground">unposted</span>
        )}
      </span>
    ),
  },
  {
    id: "contract",
    /// Sorted by the end date, not by the kind. "PKWT" over and over sorts
    /// into one indistinguishable block, whereas the question this column is
    /// clicked for is which term runs out first.
    accessorFn: (person: EmployeeSummary) => person.contract_ends_on ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Contract" />,
    cell: ({ row }) => (
      <span className="text-xs whitespace-nowrap">
        {row.original.contract_kind ? (
          <>
            {row.original.contract_kind}
            {row.original.contract_ends_on && (
              <span className="text-muted-foreground">
                {" "}
                · {row.original.contract_ends_on}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
      </span>
    ),
  },
  {
    id: "username",
    accessorFn: (person: EmployeeSummary) => person.username ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Login" />,
    cell: ({ row }) => (
      <span className="font-mono text-[11px]">
        {row.original.username ?? <span className="text-muted-foreground">—</span>}
      </span>
    ),
  },
]
