import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, money } from "@/lib/format"
import {
  catalogueVocabulary,
  procurementKeys,
  searchSupplierItems,
  setSupplierItemStatus,
  supplierItemDetail,
  updateSupplierItem,
  type SourcingScope,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ItemDetail } from "@/screens/procurement/item-detail"
import { termLabel, useIdempotencyKey } from "@/screens/procurement/shared"
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
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{row.original.item.name}</span>
        <span className="font-mono text-[0.65625rem] text-mute">
          {row.original.item.supplier_item_code}
        </span>
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplierName,
    header: "Supplier",
    size: 190,
    meta: { filter: { kind: "option" } },
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
    meta: { filter: { kind: "option" } },
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
    header: "Unit price",
    size: 130,
    meta: {
      align: "right",
      filter: { kind: "number", scale: 100, unit: "Rp" },
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
      filter: {
        kind: "option",
        options: [
          { value: "ACTIVE", label: "Active" },
          { value: "INACTIVE", label: "Retired" },
        ],
      },
    },
    cell: ({ row }) => (
      <Pill tone={row.original.item.status === "ACTIVE" ? "ok" : "neutral"}>
        {row.original.item.status === "ACTIVE" ? "Active" : "Retired"}
      </Pill>
    ),
  },
]

export function Catalogue() {
  const item = useSheet("item")
  const [tab, setTab] = useState("items")
  const [needle, setNeedle] = useState("")
  const [status, setStatus] = useState<SupplierStatus | "ALL">("ALL")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "readiness", desc: false },
  ])

  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })

  const scope = useMemo<SourcingScope>(
    () => ({
      q: needle === "" ? undefined : needle,
      status: status === "ALL" ? undefined : status,
    }),
    [needle, status]
  )

  const page = useInfiniteQuery({
    queryKey: procurementKeys.sourcing(scope),
    queryFn: ({ pageParam, signal }) =>
      searchSupplierItems({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const rows = useMemo<CatalogueRow[]>(
    () =>
      (page.data?.pages ?? []).flatMap((each) =>
        each.items.map((sourced) => ({
          item: sourced.item,
          supplierName: sourced.supplier.name,
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

  const total = page.data?.pages[0]?.total ?? 0

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: CatalogueRow) => row.item.supplier_item_id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
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
        actions={
          tab === "items" && (
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="Item, code or supplier"
              className="h-8 w-56"
            />
          )
        }
      />


      <SubTabs
        tabs={[
          { value: "items", label: "Items" },
          { value: "vocabulary", label: "Vocabulary" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "items" ? (
        <>
          <Toolbar>
            <Segmented
              options={[
                { value: "ALL", label: "Everything" },
                { value: "ACTIVE", label: "On offer" },
                { value: "INACTIVE", label: "Retired" },
              ]}
              value={status}
              onChange={setStatus}
            />
            <FilterBar model={filters} table={table} />
            <Toolbar.Spacer />
            <span className="text-[0.75rem] text-mute tabular-nums">
              {count(unfinished)} of {count(matching)} shown still need
              finishing · {count(total)} in the catalogue
            </span>
          </Toolbar>

          <Card className="overflow-hidden">
            {queryState(page, {
              loading: "Reading the catalogue…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {needle === "" && status === "ALL"
                      ? "No supplier has offered anything yet."
                      : "No item matches that search."}
                  </EmptyState>
                ) : (
                  <DataTable<CatalogueRow>
                    table={table}
                    onRowClick={(row) => item.open(row.item.supplier_item_id)}
                    isSelected={(row) =>
                      row.item.supplier_item_id === item.value
                    }
                    className="max-h-[calc(100vh-20rem)]"
                  />
                ),
            })}
          </Card>

          {page.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button
                onClick={() => void page.fetchNextPage()}
                disabled={page.isFetchingNextPage}
              >
                {page.isFetchingNextPage
                  ? "Fetching…"
                  : `Show more (${count(total - rows.length)} left)`}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Vocabulary />
      )}

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
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })

  return queryState(vocabulary, {
    loading: "Reading the vocabulary…",
    render: (words) => (
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Divisions</CardTitle>
            <span className="text-[0.75rem] text-mute tabular-nums">
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
                    <td className="py-2 text-[0.8125rem] text-ink">
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
            <span className="text-[0.75rem] text-mute tabular-nums">
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
                    <td className="py-2 text-[0.8125rem] text-ink">
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
    ),
  })
}

// ---------------------------------------------------------------------------

/// The item as a record to be corrected.
function ItemSheet({
  id,
  vocabulary,
  onClose,
}: {
  id: string | null
  vocabulary?: CatalogueVocabulary
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
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.supplier_item_code}
      title={detail.data?.name ?? "Item"}
      actions={
        detail.data && (
          <Button size="sm" onClick={() => setEditing((was) => !was)}>
            {editing ? "Stop editing" : "Edit"}
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
                {item.status === "ACTIVE" ? "Active" : "Retired"}
              </Pill>
              <ItemStatusSwitch item={item} />
            </div>

            {editing ? (
              <EditItem
                item={item}
                vocabulary={vocabulary}
                onSaved={() => setEditing(false)}
              />
            ) : (
              <ItemDetail item={item} vocabulary={vocabulary} />
            )}
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
        disabled={change.isPending}
        onClick={() =>
          change.mutate(item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")
        }
      >
        {item.status === "ACTIVE" ? "Stop offering" : "Offer again"}
      </Button>
      {change.isError && (
        <span className="text-[0.71875rem] text-bad">
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
interface ItemDraft {
  name: string
  description: string
  price: string
  division: string
  article: string
  tags: string[]
}

function EditItem({
  item,
  vocabulary,
  onSaved,
}: {
  item: SupplierItem
  vocabulary?: CatalogueVocabulary
  onSaved: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const save = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: ItemDraft) =>
      updateSupplierItem(
        item.supplier_item_id,
        {
          name: draft.name.trim(),
          description:
            draft.description.trim() === "" ? null : draft.description.trim(),
          unit_price_minor: Number.parseInt(draft.price, 10),
          division_code: draft.division === "" ? null : draft.division,
          internal_article_code:
            draft.article.trim() === "" ? null : draft.article.trim(),
          // Present replaces; an empty list therefore means "remove every tag",
          // which is a thing a buyer may legitimately say about an item.
          tags: draft.tags,
        },
        item.version,
        idempotency.key
      ),
    onSuccess: () => {
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
      onSaved()
    },
  })

  const form = useForm({
    defaultValues: {
      name: item.name,
      description: item.description ?? "",
      price: String(item.unit_price_minor),
      division: item.division_code ?? "",
      article: item.internal_article_code ?? "",
      tags: [...item.tags],
    } as ItemDraft,
    onSubmit: ({ value }) => save.mutate(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-3.5"
    >
      {save.isError && (
        <Banner tone="bad">{(save.error as Error).message}</Banner>
      )}

      <form.Field name="name">
        {(field) => (
          <Field label="Name">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <Field label="Description">
            <Textarea
              rows={3}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="price">
        {(field) => (
          <Field label="Unit price" hint="Rupiah.">
            <Input
              type="number"
              min={0}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="division">
        {(field) => (
          <Field
            label="Division"
            hint="Our own vocabulary, so a supplier's shirt and our shirt are the same word."
          >
            <Select
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">Unclassified</option>
              {(vocabulary?.divisions ?? []).map((term) => (
                <option key={term.code} value={term.code}>
                  {term.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form.Field>

      <form.Field name="article">
        {(field) => (
          <Field
            label="Our article code"
            hint="Eight digits, minted from our own sequence. Until this is set the item cannot be tagged, priced or sold."
          >
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="00000042"
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="tags">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.78125rem] font-medium text-text">
              Tags
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(vocabulary?.tags ?? []).map((term) => {
                const on = field.state.value.includes(term.code)
                return (
                  <button
                    key={term.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      field.handleChange(
                        on
                          ? field.state.value.filter(
                              (each) => each !== term.code
                            )
                          : [...field.state.value, term.code]
                      )
                    }
                    className={
                      on
                        ? "inline-flex h-[1.625rem] items-center rounded-full bg-accent-bg px-2.5 text-[0.71875rem] font-medium text-info-fg"
                        : "inline-flex h-[1.625rem] items-center rounded-full bg-soft-2 px-2.5 text-[0.71875rem] font-medium text-body transition-colors hover:bg-hairline hover:text-ink"
                    }
                  >
                    {term.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) =>
          state.values.name.trim() !== "" &&
          Number.isFinite(Number.parseInt(state.values.price, 10))
        }
      >
        {(ready) => (
          <Button
            type="submit"
            variant="dark"
            disabled={save.isPending || !ready}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
