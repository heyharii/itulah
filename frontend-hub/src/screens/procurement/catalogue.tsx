import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockChoice, DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { BarSpacer } from "@/components/ui/list-chrome"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, money, realItemCode } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  catalogueVocabularyQuery,
  procurementKeys,
  setSupplierItemStatus,
  supplierItemDetail,
  supplierItemPagesQuery,
  type SourcingScope,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ItemDetail } from "@/screens/procurement/item-detail"
import { ItemFormSheet } from "@/screens/procurement/item-form"
import { termLabel, useIdempotencyKey } from "@/screens/procurement/shared"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import type {
  CatalogueVocabulary,
  SupplierItem,
  SupplierStatus,
} from "@itulah/contract"

/// The catalogue as master data, rather than as shopping.
///
/// Sourcing reads the same endpoint to answer "who sells this and for how
/// much". This screen asks the other question about the same rows: is each one
/// *finished*. An item with no division cannot be filed, and an item with no
/// internal article code can never be tagged, priced or sold — an article code
/// is ours, minted from our own sequence, and a SKU is that code plus a colour
/// and a size. So the list leads with what is unfinished and sorts by it.
///
/// The vocabulary is a dataset here, not just labels for a filter: `division`
/// and `tag` are the closed sets everything else is described with, and there is
/// nowhere else in the app to read them.

interface CatalogueRow {
  readonly item: SupplierItem
  readonly supplierName: string
  readonly divisionLabel: string
  /// 0 unclassified · 1 not linked to one of our articles · 2 finished.
  readonly readiness: number
}

function readinessOf(item: SupplierItem): number {
  if (item.division_code === null) return 0
  if (item.internal_article_code === null) return 1
  return 2
}

const columns: ColumnDef<TableSetup, CatalogueRow>[] = [
  {
    id: "item",
    accessorFn: (row) => `${row.item.name} ${row.item.supplier_item_code}`,
    header: "Item",
    size: 280,
    meta: { card: "hide", filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{row.original.item.name}</span>
        {realItemCode(row.original.item.supplier_item_code) && (
          <span className="font-mono text-[0.9375rem] text-mute">
            {row.original.item.supplier_item_code}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplierName,
    header: "Supplier",
    size: 190,
    meta: { card: "hide", filter: { kind: "option", searchable: true } },
    cell: ({ row }) => row.original.supplierName,
  },
  {
    id: "division",
    accessorFn: (row) => row.divisionLabel,
    header: "Division",
    size: 150,
    // Filing an item under a division is the first half of finishing it, so
    // "Division is empty" is the working list for whoever does that — which is
    // why `divisionLabel` is empty rather than an em dash for an unfiled item.
    // The dash is drawn by the cell.
    meta: { card: "hide", filter: { kind: "option" } },
    cell: ({ row }) =>
      row.original.item.division_code === null ? (
        <span className="text-mute">—</span>
      ) : (
        <Tag>{row.original.divisionLabel}</Tag>
      ),
  },
  {
    id: "price",
    accessorFn: (row) => row.item.unit_price_minor,
    header: "Unit Price",
    size: 130,
    meta: {
      align: "right",
      card: "hide",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) => money(row.original.item.unit_price_minor),
  },
  {
    id: "readiness",
    accessorFn: (row) => row.readiness,
    header: "Setup",
    size: 150,
    // A declared set, not the values present: "no unclassified items left" is
    // the answer somebody is looking for, and a facet built from the data
    // cannot say it because the option disappears with the last row.
    meta: {
      card: "hide",
      filter: {
        kind: "option",
        options: [
          { value: "0", label: "Unclassified" },
          { value: "1", label: "Not linked" },
          { value: "2", label: "Ready" },
        ],
      },
    },
    // The decision metric, sorted ascending: the rows that cannot yet become a
    // sellable article are the ones somebody has to finish, and they lead.
    cell: ({ row }) =>
      row.original.readiness === 0 ? (
        <Pill tone="warn">Unclassified</Pill>
      ) : row.original.readiness === 1 ? (
        <Pill tone="neutral">Not linked</Pill>
      ) : (
        <Pill tone="ok">Ready</Pill>
      ),
  },
  {
    id: "status",
    accessorFn: (row) => row.item.status,
    header: "Offered",
    size: 110,
    meta: {
      card: "hide",
      filter: {
        kind: "option",
        options: [
          { value: "ACTIVE", label: "Active" },
          { value: "INACTIVE", label: "Cancelled" },
        ],
      },
    },
    cell: ({ row }) => (
      <Pill tone={row.original.item.status === "ACTIVE" ? "ok" : "neutral"}>
        {row.original.item.status === "ACTIVE" ? "Active" : "Cancelled"}
      </Pill>
    ),
  },
  // Four columns that exist only on a card (a phone): the item over its
  // supplier's code, its price as the figure the card leads with, who sells it
  // and under which division, and how far it is from being one of ours.
  {
    id: "head",
    accessorFn: (row) => row.item.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
          {row.original.item.name}
        </span>
        {realItemCode(row.original.item.supplier_item_code) && (
          <span className="font-mono text-[0.9375rem] font-normal text-mute">
            {row.original.item.supplier_item_code}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.item.unit_price_minor,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
          {money(row.original.item.unit_price_minor)}
        </span>
        <span className="text-[0.9375rem] text-mute">per unit</span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.supplierName,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="truncate text-ink">{row.original.supplierName}</span>
        <span className="truncate">
          {row.original.item.division_code === null
            ? "No division"
            : row.original.divisionLabel}
          {row.original.item.status === "ACTIVE" ? "" : " · Cancelled"}
        </span>
      </span>
    ),
  },
  {
    id: "state",
    accessorFn: (row) => row.readiness,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) =>
      row.original.readiness === 0 ? (
        <Pill tone="warn">Unclassified</Pill>
      ) : row.original.readiness === 1 ? (
        <Pill tone="neutral">Not linked</Pill>
      ) : (
        <Pill tone="ok">Ready</Pill>
      ),
  },
]

/// What the phone's one dock button chooses between: the three offer statuses
/// of the item list, and the vocabulary, which is the other tab.
const PHONE_VIEWS = [
  { value: "ALL", label: "Everything", short: "Everything" },
  { value: "ACTIVE", label: "On offer", short: "On offer" },
  { value: "INACTIVE", label: "Cancelled", short: "Cancelled" },
  { value: "VOCABULARY", label: "Vocabulary", short: "Vocabulary" },
] as const

export function Catalogue() {
  // The title stands at once; the items wait for the first page and the words
  // and stream in with them (the server starts the reads too). The head's
  // button follows the tab, so it comes with them.
  return (
    <Suspense
      fallback={
        <PageContent>
          <PageHeader crumb="Procurement" title="Catalogue" />
          <LoadingState>Reading the catalogue…</LoadingState>
        </PageContent>
      }
    >
      <CatalogueBook />
    </Suspense>
  )
}

function CatalogueBook() {
  const item = useSheet("item")
  const adding = useSheet("new-item")
  const [tab, setTab] = useState("items")
  const [needle, setNeedle] = useState("")
  const [status, setStatus] = useState<SupplierStatus | "ALL">("ALL")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "readiness", desc: false },
  ])

  const vocabulary = useSuspenseQuery(catalogueVocabularyQuery())

  const scope = useMemo<SourcingScope>(
    () => ({
      q: needle === "" ? undefined : needle,
      status: status === "ALL" ? undefined : status,
    }),
    [needle, status]
  )

  // Another tab or search: the rows in hand stay, dimmed (`list-swap`), until
  // the next are read — the deferred scope keeps them on screen.
  const asked = useDeferredValue(scope)
  const page = useSuspenseInfiniteQuery(supplierItemPagesQuery(asked))

  const rows = useMemo<CatalogueRow[]>(
    () =>
      page.data.pages.flatMap((each) =>
        each.items.map((sourced) => ({
          item: sourced.item,
          supplierName: supplierDisplayName(sourced.supplier),
          divisionLabel:
            sourced.item.division_code === null
              ? ""
              : termLabel(
                  vocabulary.data?.divisions,
                  sourced.item.division_code
                ),
          readiness: readinessOf(sourced.item),
        }))
      ),
    [page.data, vocabulary.data]
  )

  const total = page.data.pages[0]?.total ?? 0

  /// The phone's one button over the list: a status, or the other tab.
  const pickView = (next: string) => {
    if (next === "VOCABULARY") {
      setTab("vocabulary")
      return
    }
    setTab("items")
    setStatus(next as SupplierStatus | "ALL")
  }

  const filters = useFilters(columns)
  const phone = useLayout() === "phone"

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: CatalogueRow) => row.item.supplier_item_id,
        state: {
          columnFilters: filters.columnFilters,
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            state: phone,
          },
        },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting, phone]
    )
  )

  /// Counted off the filtered model, not the loaded rows: a bar narrowed to
  /// one supplier should say how much of *that* supplier is unfinished.
  const shown = table.getFilteredRowModel().rows
  const matching = shown.length
  const unfinished = shown.filter((row) => row.original.readiness < 2).length

  return (
    <PageContent>
      <PageHeader
        crumb="Procurement"
        title="Catalogue"
        sub="Every supplier item we know of, and whether it is finished enough to become one of ours."
        // The screen's one action stands in its head; on a phone the field is
        // the dock's and the button its round "+".
        actions={
          tab === "items" &&
          !phone && (
            // This screen is the only one that CREATES a supplier item —
            // Sourcing browses what it makes. Until now it could only edit
            // them, so the one way to put something in the catalogue was a
            // three-field form buried in a supplier's record.
            <Button variant="primary" onClick={() => adding.open(true)}>
              New item
            </Button>
          )
        }
      />

      {/* The offer status and the vocabulary are one row of tabs, as they
          are the one button in the dock on a phone. */}
      <SubTabs
        className="max-md:hidden"
        tabs={PHONE_VIEWS.map((one) => ({
          value: one.value,
          label: one.label,
        }))}
        value={tab === "vocabulary" ? "VOCABULARY" : status}
        onChange={pickView}
      />
      {tab === "items" ? (
        <DockTools
          search={{
            value: needle,
            onChange: setNeedle,
            label: "Search Catalogue",
          }}
          filter={{
            count: filters.filters.length,
            panel: { model: filters, table },
          }}
          sort={dockSortOf(table)}
          status={{
            value: status,
            options: [...PHONE_VIEWS],
            onChange: pickView,
          }}
        />
      ) : (
        <DockChoice
          value="VOCABULARY"
          options={PHONE_VIEWS}
          onChange={pickView}
        />
      )}
      {tab === "items" && (
        <Fab label="New Item" onClick={() => adding.open(true)} />
      )}

      {tab === "items" ? (
        <>
          <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
            <FilterPanel
              model={filters}
              table={table}
              search={{
                value: needle,
                onChange: setNeedle,
                label: "Search catalogue",
              }}
            />
            <BarSpacer />
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {count(unfinished)} of {count(matching)} shown still need
              finishing · {count(total)} in the catalogue
            </span>
          </div>
          {/* The figures, as one sentence, where a phone has no toolbar. */}
          <p className="mb-3 text-[0.9375rem] text-mute tabular-nums md:hidden">
            <b className="font-medium text-ink">{count(unfinished)}</b> of{" "}
            {count(matching)} shown still need finishing · {count(total)} in the
            catalogue
          </p>

          <Card
            aria-busy={asked !== scope || undefined}
            className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
          >
            {rows.length === 0 ? (
              <EmptyState>
                {needle === "" && status === "ALL"
                  ? "No supplier has offered anything yet."
                  : "No item matches that search."}
              </EmptyState>
            ) : (
              <DataTable<CatalogueRow>
                refresh={[page]}
                table={table}
                onRowClick={(row) => item.open(row.item.supplier_item_id)}
                isSelected={(row) => row.item.supplier_item_id === item.value}
                more={page}
                className="max-h-[calc(100dvh-20rem)]"
                cardSort={false}
                cardsApart
                cardLead
              />
            )}
          </Card>
        </>
      ) : (
        <Vocabulary />
      )}

      <ItemFormSheet open={adding.value === true} onClose={adding.close} />

      <ItemSheet
        id={item.value ?? null}
        vocabulary={vocabulary.data}
        onClose={item.close}
      />
    </PageContent>
  )
}

/// The words the catalogue is allowed to use.
///
/// `code` is what the database stores and what every filter addresses; `label`
/// is what a person sees. Both are shown, because a filter cannot address a
/// label and a buyer should not have to read `KAUS_KAKI`.
function Vocabulary() {
  // Already in hand: the items read the same words for their labels.
  const words = useSuspenseQuery(catalogueVocabularyQuery()).data

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Divisions</CardTitle>
          <span className="text-[0.9375rem] text-mute tabular-nums">
            {count(words.divisions.length)}
          </span>
        </CardHeader>
        <div className="px-4 pb-3.5">
          {words.divisions.length === 0 ? (
            <p className="text-meta text-mute">
              The vocabulary has no divisions in it.
            </p>
          ) : (
            <MiniTable head={["Reads as", { label: "Code", align: "right" }]}>
              {words.divisions.map((term) => (
                <tr key={term.code} className="border-t border-hairline">
                  <td className="py-2 text-[0.9375rem] text-ink">
                    {term.label}
                  </td>
                  <td className="py-2 text-right">
                    <Tag>{term.code}</Tag>
                  </td>
                </tr>
              ))}
            </MiniTable>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <span className="text-[0.9375rem] text-mute tabular-nums">
            {count(words.tags.length)}
          </span>
        </CardHeader>
        <div className="px-4 pb-3.5">
          {words.tags.length === 0 ? (
            <p className="text-meta text-mute">
              The vocabulary has no tags in it.
            </p>
          ) : (
            <MiniTable head={["Reads as", { label: "Code", align: "right" }]}>
              {words.tags.map((term) => (
                <tr key={term.code} className="border-t border-hairline">
                  <td className="py-2 text-[0.9375rem] text-ink">
                    {term.label}
                  </td>
                  <td className="py-2 text-right">
                    <Tag>{term.code}</Tag>
                  </td>
                </tr>
              ))}
            </MiniTable>
          )}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------

/// The item as a record to be corrected.
/// A supplier item's record. Exported so wherever an item is shown — an
/// order's line, a count — it opens the same record (owner, 14 Oct: "semua
/// bisa di klik").
export function ItemSheet({
  id,
  vocabulary,
  context,
  onClose,
}: {
  id: string | null
  vocabulary?: CatalogueVocabulary
  /// Where it was opened from, in grey over its name ("PO-0002-OPE6").
  context?: string
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)

  const detail = useQuery({
    queryKey: procurementKeys.supplierItem(id ?? ""),
    queryFn: ({ signal }) => supplierItemDetail(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "supplier_item", id }}
      context={context}
      onOpenChange={(open) => !open && onClose()}
      id={realItemCode(detail.data?.supplier_item_code)}
      title={detail.data?.name ?? "Item"}
      actions={
        detail.data && (
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the item…",
        render: (item) => (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Pill tone={item.status === "ACTIVE" ? "ok" : "neutral"}>
                {item.status === "ACTIVE" ? "Active" : "Cancelled"}
              </Pill>
              <ItemStatusSwitch item={item} />
            </div>

            <ItemDetail item={item} vocabulary={vocabulary} />

            {/* Editing opens the same wide form that adds one, over this
                sheet, rather than swapping the record's body for a column of
                fields. That column was where the colours and sizes an item is
                offered in had nowhere to go: two pickers do not fit in a rail,
                and a form that cannot say what an item comes in is a form that
                decides Sourcing can never show it. */}
            <ItemFormSheet
              open={editing}
              item={item}
              onClose={() => setEditing(false)}
              onSaved={() => {
                // Saved: the form and the record behind it both close.
                setEditing(false)
                onClose()
              }}
            />
          </div>
        ),
      })}
    </Sheet>
  )
}

function ItemStatusSwitch({ item }: { item: SupplierItem }) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const change = useMutation({
    mutationFn: (status: SupplierStatus) =>
      setSupplierItemStatus(
        item.supplier_item_id,
        status,
        item.version,
        idempotency.key
      ),
    onSuccess: () => {
      // The record, the cross-supplier catalogue every search reads, and this
      // supplier's own page — retiring an item removes it from all three.
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierItem(item.supplier_item_id),
      })
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierItems(),
      })
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierCatalogue(item.supplier_id),
      })
      idempotency.rotate()
    },
  })

  return (
    <>
      <Button
        size="sm"
        variant={item.status === "ACTIVE" ? "ghost" : "soft"}
        pending={change.isPending}
        onClick={() =>
          change.mutate(item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")
        }
      >
        {item.status === "ACTIVE" ? "Stop offering" : "Offer again"}
      </Button>
      {change.isError && (
        <span className="text-[0.9375rem] text-bad">
          {(change.error as Error).message}
        </span>
      )}
    </>
  )
}

/// Correcting an item.
///
/// The patch shape distinguishes three things a field can say: absent leaves it
/// alone, `null` clears it, a value sets it. Everything on this form is sent, so
/// emptying a box genuinely clears the field — and clearing the division is a
/// state somebody may legitimately want to return an item to.
