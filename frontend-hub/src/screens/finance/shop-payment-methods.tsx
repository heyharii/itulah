import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Checkbox, Input } from "@/components/ui/field"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  paymentMethodsQuery,
  setSitePaymentMethods,
  sitePaymentMethods,
} from "@/lib/queries/finance"
import { siteLabel, unitsQuery } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"
import type { SitePaymentMethod } from "@itulah/contract"

/// The kinds of site that sell: `STORE` today, `SHOP` in the premises
/// vocabulary the register is moving to. A site's kind is data; its id says
/// nothing.
const SELLING_SITE_KINDS = new Set(["STORE", "SHOP"])

/// Which payment methods each shop takes (ERPNext POS Profile → Payments).
///
/// The company's methods are declared once on Payment Methods, with their MDR
/// and their account links; here each shop is given the ones its counter
/// actually has — a shop with a BCA EDC and no Mandiri one takes Debit BCA and
/// not Debit Mandiri. The shop's tills read the list from the store node, so a
/// method switched off here disappears from the payment screen and a sale that
/// names it is refused.
///
/// The list is the shops — the selling sites of the units register — and not
/// the units the books are kept for: a till stands at a site.
interface ShopRow {
  readonly site_id: string
  readonly label: string
  readonly unit_status: string
}

export function ShopPaymentMethods() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Setup" title="Shop Payment Methods">
          Reading the shops…
        </ScreenPending>
      }
    >
      <ShopPaymentMethodsScreen />
    </Suspense>
  )
}

function ShopPaymentMethodsScreen() {
  const phone = useLayout() === "phone"
  const units = useSuspenseQuery(unitsQuery())
  const methods = useSuspenseQuery(paymentMethodsQuery())
  /// The shop whose sheet is open.
  const [site, setSite] = useState<string | null>(null)
  const [needle, setNeedle] = useState("")
  const [inactive, setInactive] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  const allShops = useMemo<ShopRow[]>(
    () =>
      units.data.flatMap((unit) =>
        unit.sites
          .filter((one) => SELLING_SITE_KINDS.has(one.kind))
          .map((one) => ({
            site_id: one.id,
            label: siteLabel(unit, one),
            unit_status: unit.status,
          }))
      ),
    [units.data]
  )

  const shops = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return allShops.filter(
      (one) => text === "" || one.label.toLowerCase().includes(text)
    )
  }, [allShops, needle])

  /// How many active methods each shop takes, from the company list.
  const taken = useMemo(() => {
    const table = new Map<string, number>()
    for (const method of methods.data) {
      if (!method.is_active) continue
      for (const id of method.site_ids) table.set(id, (table.get(id) ?? 0) + 1)
    }
    return table
  }, [methods.data])

  /// One shop per row. On a phone the same columns are the card.
  const columns = useMemo<ColumnDef<TableSetup, ShopRow>[]>(
    () => [
      {
        id: "shop",
        accessorFn: (row) => row.label,
        header: "Shop",
        size: 400,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="block">
            <span className="block text-ink">{row.original.label}</span>
            {row.original.unit_status === "CLOSED" && (
              <span className="text-[0.9375rem] font-normal text-faint">
                Closed
              </span>
            )}
          </span>
        ),
      },
      {
        id: "taken",
        accessorFn: (row) => taken.get(row.site_id) ?? 0,
        header: "Methods taken",
        size: 190,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => count(taken.get(row.original.site_id) ?? 0),
      },
    ],
    [taken]
  )

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shops,
        columns,
        getRowId: (row: ShopRow) => row.site_id,
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [shops, columns, sorting, phone, fit]
    )
  )

  const chosen = allShops.find((one) => one.site_id === site)

  return (
    <PageContent>
      <PageHeader crumb="Finance · Setup" title="Shop Payment Methods" />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search shops"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <DockTools
        search={{ value: needle, onChange: setNeedle, label: "Search shops" }}
        sort={dockSortOf(table)}
      />

      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(units, {
            render: () =>
              allShops.length === 0 ? (
                <EmptyState>The company has no shop yet.</EmptyState>
              ) : (
                <DataTable<ShopRow>
                  table={table}
                  refresh={[units, methods]}
                  onRowClick={(row) => setSite(row.site_id)}
                  isSelected={(row) => row.site_id === site}
                  empty="No shop matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    shop: (
                      <span>
                        {count(shops.length)}{" "}
                        <span className="font-normal text-body">
                          {shops.length === 1 ? "shop" : "shops"}
                        </span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
        </Card>
      </div>

      {chosen !== undefined && (
        <ShopMethods
          key={chosen.site_id}
          site={chosen.site_id}
          name={chosen.label}
          inactive={inactive}
          onInactive={setInactive}
          onClose={() => setSite(null)}
        />
      )}
    </PageContent>
  )
}

/// One shop's methods, in the sheet its row opens.
function ShopMethods({
  site,
  name,
  inactive,
  onInactive,
  onClose,
}: {
  site: string
  name: string
  inactive: boolean
  onInactive: (next: boolean) => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const setup = useQuery({
    queryKey: financeKeys.sitePaymentMethods(site),
    queryFn: ({ signal }) => sitePaymentMethods(site, signal),
  })
  // The shop's ticks as edited; `null` until someone changes one, so a fresh
  // read is what the screen shows.
  const [draft, setDraft] = useState<Set<string> | null>(null)
  /// What the methods are searched for.
  const [needle, setNeedle] = useState("")

  const saved = useMemo(
    () =>
      new Set(
        (setup.data ?? []).filter((row) => row.enabled).map((row) => row.code)
      ),
    [setup.data]
  )
  const ticked = draft ?? saved
  const dirty =
    draft !== null &&
    (draft.size !== saved.size || [...draft].some((code) => !saved.has(code)))

  const save = useMutation({
    mutationFn: () => setSitePaymentMethods(site, { codes: [...ticked] }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.sitePaymentMethods(site), rows)
      void client.invalidateQueries({ queryKey: financeKeys.paymentMethods() })
      setDraft(null)
    },
  })

  function toggle(code: string, on: boolean) {
    const next = new Set(ticked)
    if (on) next.add(code)
    else next.delete(code)
    setDraft(next)
  }

  const groups = useMemo(() => {
    const byTender = new Map<string, SitePaymentMethod[]>()
    const text = needle.trim().toLowerCase()
    for (const row of setup.data ?? []) {
      if (!inactive && !row.is_active) continue
      if (
        text !== "" &&
        !row.name.toLowerCase().includes(text) &&
        !row.code.toLowerCase().includes(text)
      )
        continue
      const list = byTender.get(row.tender_type) ?? []
      list.push(row)
      byTender.set(row.tender_type, list)
    }
    return [...byTender.entries()]
  }, [setup.data, inactive, needle])

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={name}
      caption={`${count(ticked.size)} taken`}
      size="wide"
      dirty={dirty}
      footer={
        <SheetFooter
          onCancel={onClose}
          error={save.error}
          secondary={
            dirty ? (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Undo
              </Button>
            ) : undefined
          }
          primary={{
            label: "Submit",
            pending: save.isPending,
            disabled: !dirty,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label="Search methods"
            placeholder="Search methods"
            className="h-control w-56"
          />
          <Checkbox
            label="Show inactive"
            checked={inactive}
            onChange={onInactive}
          />
        </div>
        {queryState(setup, {
          loading: "Reading the shop's payment methods…",
          render: () =>
            groups.length === 0 ? (
              <EmptyState>
                {(setup.data ?? []).length === 0
                  ? "The company has no payment method yet. Add them on Payment Methods first."
                  : "No payment method matches."}
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-4">
                {groups.map(([tender, rows]) => (
                  <section key={tender}>
                    <h3 className="mb-2 text-[0.9375rem] font-medium text-mute">
                      {label(tender)}
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {rows.map((row) => (
                        <div
                          key={row.code}
                          className="flex items-center gap-2 rounded-inner border border-hairline px-3 py-2"
                        >
                          <Checkbox
                            className="min-w-0 flex-1"
                            label={
                              <span className="block min-w-0">
                                <span className="block truncate text-ink">
                                  {row.name}
                                </span>
                                <span className="font-mono text-[0.9375rem] text-faint">
                                  {row.code}
                                </span>
                              </span>
                            }
                            checked={ticked.has(row.code)}
                            onChange={(on) => toggle(row.code, on)}
                          />
                          {row.bank_code !== "" && <Tag>{row.bank_code}</Tag>}
                          {!row.is_active && (
                            <Pill tone="neutral">Inactive</Pill>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ),
        })}
      </div>
    </Sheet>
  )
}
