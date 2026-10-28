import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { SwitchPill } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SLOTS, type Slot } from "@/screens/finance/coa-slots"
import type {
  AccountLink,
  AccountLinkPage,
  PostingReadiness,
} from "@itulah/contract"

/// 7Soft's Setting COA, as the hub answers it.
///
/// 7Soft keeps 23 default accounts, one per slot — Default Kas Kecil, Hutang,
/// PPN Penjualan — and every document and master reads its account from the
/// slot. The hub keeps decisions as links of a posting ROLE to an account, for
/// a unit, a kind of unit or all of them. A slot is therefore a name for a
/// role: the table below is 7Soft's own list, each row reading the account its
/// role resolves to, and opening the role to change it.
///
/// Seven slots have no role in the hub, and the table says so rather than
/// inventing one: the hub books purchases when the bill is posted (no goods
/// received, not invoiced), has no debtor book (no Piutang, Potongan Piutang,
/// Uang Muka Penjualan), computes the year's profit from the ledger (no Laba),
/// and takes service purchases and sales from the expense category and the
/// bill line rather than from a default account.
///
/// Words are 7Soft's: the slot names, and "used for" is the manual's sentence
/// for each (section 2.18).

interface SlotRow {
  readonly name: string
  readonly use: string
  readonly role: string | null
  readonly roleLabel: string | null
  readonly links: readonly AccountLink[]
  readonly gaps: number
  readonly slot: Slot
}

/// The link that answers for the whole company when there is one, otherwise
/// the first the role has.
function leadLink(links: readonly AccountLink[]): AccountLink | undefined {
  return (
    links.find((link) => link.scope_type === "ALL" && link.source_id === "") ??
    links[0]
  )
}

function slotRows(
  page: AccountLinkPage,
  readiness: PostingReadiness | undefined
): SlotRow[] {
  return SLOTS.map((slot) => {
    const links = slot.role
      ? page.rows.filter((link) => link.role === slot.role)
      : []
    const doc = slot.role
      ? page.roles.find((one) => one.key === slot.role)
      : undefined
    return {
      name: slot.name,
      use: slot.use,
      role: slot.role,
      roleLabel: slot.role === null ? null : (doc?.label ?? label(slot.role)),
      links,
      gaps:
        slot.role === null
          ? 0
          : (readiness?.rows ?? [])
              .filter((row) => row.role === slot.role)
              .reduce((sum, row) => sum + row.gaps, 0),
      slot,
    }
  })
}

type State = "linked" | "missing" | "none"

function stateOf(row: SlotRow): State {
  if (row.role === null) return "none"
  return row.links.length === 0 ? "missing" : "linked"
}

/// What the Account column says: the account, or why there is not one.
function AccountCell({ row }: { row: SlotRow }) {
  const state = stateOf(row)
  if (state === "none") {
    return <span className="text-mute">Not in the hub</span>
  }
  if (state === "missing") {
    return <Pill tone="warn">Missing in the chart</Pill>
  }
  const lead = leadLink(row.links)
  if (lead === undefined) return null
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="font-mono text-[0.9375rem] text-mute">
        {lead.account_code}
      </span>
      <span className="min-w-0 truncate text-ink">{lead.account_name}</span>
      {row.links.length > 1 && (
        <span className="shrink-0 text-[0.9375rem] text-mute">
          +{row.links.length - 1}
        </span>
      )}
    </span>
  )
}

const columns: ColumnDef<TableSetup, SlotRow>[] = [
  {
    accessorKey: "name",
    header: "Keterangan",
    size: 220,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    id: "account",
    accessorFn: (row) => {
      const lead = leadLink(row.links)
      return lead === undefined
        ? ""
        : `${lead.account_code} ${lead.account_name}`
    },
    header: "Account",
    size: 380,
    meta: { card: "hide", grow: 240 },
    cell: ({ row }) => <AccountCell row={row.original} />,
  },
  {
    accessorKey: "use",
    header: "Used for",
    size: 300,
    meta: { card: "hide", priority: 2 },
    cell: ({ row }) => <span className="text-body">{row.original.use}</span>,
  },
  {
    id: "role",
    accessorFn: (row) => row.role ?? "",
    header: "Posting role",
    size: 200,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) =>
      row.original.role === null ? (
        <span className="text-faint">—</span>
      ) : (
        <Tag>{row.original.role}</Tag>
      ),
  },
  // The phone's card: the slot over what it is used for, the account as the
  // figure, the role under it.
  {
    id: "head",
    accessorFn: (row) => `${row.name} ${row.use}`,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[1rem] font-semibold break-words text-ink">
          {row.original.name}
        </span>
        <span className="text-[0.9375rem] font-normal text-mute">
          {row.original.use}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => <AccountCell row={row.original} />,
  },
  {
    id: "foot",
    accessorFn: (row) => row.role ?? "",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) =>
      row.original.role === null ? null : (
        <span className="font-mono">{row.original.role}</span>
      ),
  },
]

export function SettingCoa({
  page,
  readiness,
  onOpenRole,
}: {
  page: AccountLinkPage
  readiness: PostingReadiness | undefined
  /// A slot with a role opens that role on the posting-roles sheet.
  onOpenRole: (role: string) => void
}) {
  const phone = useLayout() === "phone"
  const [needle, setNeedle] = useState("")
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [shown, setShown] = useState<string | null>(null)

  const all = useMemo(() => slotRows(page, readiness), [page, readiness])
  const rows = useMemo(
    () => all.filter((row) => !onlyMissing || stateOf(row) !== "linked"),
    [all, onlyMissing]
  )
  const linked = all.filter((row) => stateOf(row) === "linked").length
  const missing = all.filter((row) => stateOf(row) === "missing").length
  const none = all.filter((row) => stateOf(row) === "none").length

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: SlotRow) => row.name,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: { head: phone, lead: phone, foot: phone },
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
      }),
      [rows, needle, sorting, phone]
    )
  )

  const open = all.find((row) => row.name === shown)

  return (
    <>
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Slots" value={count(all.length)} />
        <Kpi label="Linked" value={count(linked)} />
        <Kpi label="Missing in the chart" value={count(missing)} />
        <Kpi label="Not in the hub" value={count(none)} />
      </KpiStrip>

      {phone ? (
        <DockTools
          search={{
            value: needle,
            onChange: setNeedle,
            label: "Search slots",
          }}
          status={{
            value: onlyMissing ? "open" : "all",
            options: [
              { value: "all", label: "All slots" },
              { value: "open", label: "Without an account" },
            ],
            onChange: (next) => setOnlyMissing(next === "open"),
          }}
        />
      ) : (
        <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
          <ExpandingSearch
            value={needle}
            onChange={setNeedle}
            label="Search slots"
          />
          <SwitchPill
            on={onlyMissing}
            label="Only slots without an account"
            onToggle={() => setOnlyMissing(!onlyMissing)}
          />
          <BarSpacer />
        </div>
      )}

      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {rows.length === 0 ? (
          <EmptyState>Every slot has an account.</EmptyState>
        ) : (
          <DataTable<SlotRow>
            table={table}
            onRowClick={(row) =>
              row.role !== null ? onOpenRole(row.role) : setShown(row.name)
            }
            isSelected={(row) => row.name === shown}
            empty="No slot matches the search."
            pageScroll
            cardsApart
            cardLead
            cardSort={false}
          />
        )}
      </Card>

      <Sheet
        open={open !== undefined}
        onOpenChange={(next) => {
          if (!next) setShown(null)
        }}
        title={open?.name ?? "Slot"}
      >
        {open !== undefined && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Keterangan">{open.name}</Fact>
              <Fact term="Used for">{open.use}</Fact>
              <Fact term="Posting role">
                {open.role === null ? "None in the hub" : open.role}
              </Fact>
            </Facts>
            {open.slot.instead && (
              <p className="text-[0.9375rem] text-body">
                {open.slot.instead.text}
                {open.slot.instead.to && (
                  <>
                    {" "}
                    <AppLink
                      to={open.slot.instead.to}
                      className="underline underline-offset-2"
                    >
                      {open.slot.instead.toLabel}
                    </AppLink>
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  )
}

/// 7Soft's Item · Account tab: the seven accounts an item of the goods kind
/// carries. Each is one of the slots above under the item's own name, so the
/// account shown is the one the slot's role resolves to.
const ITEM_ACCOUNTS: readonly { label: string; slot: string }[] = [
  { label: "Acc. Penjualan", slot: "Penjualan" },
  { label: "Acc. Persediaan", slot: "Persediaan Barang" },
  { label: "Acc. Disc. Penjualan", slot: "Disc Penjualan" },
  { label: "Acc. HPP", slot: "HPP" },
  { label: "Acc. Ret. Penjualan", slot: "Retur Penjualan" },
  { label: "Acc. Ret. Pembelian", slot: "Retur Pembelian" },
  { label: "Acc. Hutang Suspend", slot: "Hutang Suspend" },
]

export function ItemAccounts({
  page,
  readiness,
  onOpenRole,
}: {
  page: AccountLinkPage
  readiness: PostingReadiness | undefined
  onOpenRole: (role: string) => void
}) {
  const slots = useMemo(() => slotRows(page, readiness), [page, readiness])
  return (
    <Card className="overflow-clip">
      <MiniTable
        head={[
          { label: "Account Item", align: "left" },
          { label: "Account", align: "left" },
          { label: "Kode", align: "left" },
        ]}
      >
        {ITEM_ACCOUNTS.map((one) => {
          const row = slots.find((slot) => slot.name === one.slot)
          const lead = row === undefined ? undefined : leadLink(row.links)
          const role = row?.role ?? null
          return (
            <MiniRow key={one.label}>
              <MiniCell className="font-medium text-ink">{one.label}</MiniCell>
              <MiniCell>
                {role === null ? (
                  <span className="text-mute">Not in the hub</span>
                ) : lead === undefined ? (
                  <Pill tone="warn">Missing in the chart</Pill>
                ) : (
                  <button
                    type="button"
                    className="record-link"
                    onClick={() => onOpenRole(role)}
                  >
                    {lead.account_name}
                  </button>
                )}
              </MiniCell>
              <MiniCell className="font-mono">
                {lead === undefined ? (
                  <span className="text-faint">—</span>
                ) : (
                  lead.account_code
                )}
              </MiniCell>
            </MiniRow>
          )
        })}
      </MiniTable>
    </Card>
  )
}
