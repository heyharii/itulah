import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Tag } from "@/components/ui/tag"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  accountChildrenQuery,
  assetClassesQuery,
  lineCategoriesQuery,
} from "@/lib/queries/finance"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  ROOT_CLASSES_SHORT,
  categoryFamilyLabel,
  categoryFamilyOrder,
} from "@/screens/finance/chart"
import { Code } from "@/screens/finance-final/parts"
import type { AssetClass, LedgerAccount, LineCategory } from "@itulah/contract"

/// The English gloss, where the chart carries one, sits quiet and second. It is
/// a reading aid for somebody who does not have the client's chart in their
/// head, and never the label a picker offers.
function Gloss({ text }: { text: string | null | undefined }) {
  return text === null || text === undefined || text === "" ? null : (
    <span className="text-mute"> · {text}</span>
  )
}

/// A reference list: a read-only table of a few rows, and the same rows as
/// cards on a phone.
function RefTable<TRow>({
  rows,
  columns,
  getRowId,
}: {
  rows: readonly TRow[]
  columns: ColumnDef<TableSetup, TRow>[]
  getRowId: (row: TRow) => string
}) {
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as TRow[],
        columns,
        getRowId,
      }),
      [rows, columns, getRowId]
    )
  )
  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <DataTable<TRow> table={table} cardsApart cardSort={false} />
    </Card>
  )
}

const categoryColumns: ColumnDef<TableSetup, LineCategory>[] = [
  {
    accessorKey: "category_code",
    header: "Code",
    size: 240,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.category_code}</Code>,
  },
  {
    accessorKey: "name",
    header: "Name (client’s name)",
    size: 480,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => (
      <>
        <span className="text-ink">{row.original.name}</span>
        <Gloss text={row.original.name_en} />
      </>
    ),
  },
  {
    accessorKey: "is_active",
    header: "Status",
    size: 150,
    meta: { card: "status" },
    cell: ({ row }) =>
      row.original.is_active ? (
        <span className="text-mute">active</span>
      ) : (
        <Pill tone="neutral">no longer used</Pill>
      ),
  },
]

const accountColumns: ColumnDef<TableSetup, LedgerAccount>[] = [
  {
    accessorKey: "account_code",
    header: "Code",
    size: 120,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.account_code}</Code>,
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 480,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => row.original.name,
  },
  {
    id: "class",
    accessorFn: (row) => ROOT_CLASSES_SHORT[row.root_class] ?? row.root_class,
    header: "Class",
    size: 200,
    meta: { card: "status" },
    cell: ({ row }) => (
      <span className="text-mute">
        {ROOT_CLASSES_SHORT[row.original.root_class] ?? row.original.root_class}
      </span>
    ),
  },
]

const classColumns: ColumnDef<TableSetup, AssetClass>[] = [
  {
    accessorKey: "class_code",
    header: "Code",
    size: 240,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.class_code}</Code>,
  },
  {
    accessorKey: "name",
    header: "Name (client’s name)",
    size: 480,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => (
      <>
        <span className="text-ink">{row.original.name}</span>
        <Gloss text={row.original.name_en} />
      </>
    ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    size: 170,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={row.original.is_active ? "neutral" : "warn"}>
        {row.original.kind}
      </Pill>
    ),
  },
]

const categoryRowId = (row: LineCategory) => row.category_code
const accountRowId = (row: LedgerAccount) => row.account_code
const classRowId = (row: AssetClass) => row.class_code

/// The vocabulary the forty-account chart is read in.
///
/// # Why this screen exists at all
///
/// Because the chart stopped answering the question it used to answer. The
/// client's own books carried 6,908 posting accounts for about forty lines of
/// the statements, and every one of the extra codes was an *identity* baked
/// into a number: which bank, which of thirty-six racks, PPh 21 or PPh 23,
/// electricity or water. Pulling the unit dimension out took that to 190;
/// pulling the identity out takes it to 40, and the identity has to land
/// somewhere. It lands here — `journal_line.category_code`, one closed list
/// per family, chosen beside the account every time anybody posts.
///
/// So "what can I put on 6301?" is a question with an answer again, and this
/// is where the answer is written down. An accountant coming from the old
/// chart is looking for the line they used to have a code for, and they will
/// find it under its own Indonesian name — never a translation, because
/// "Biaya Pemakaian Listrik" is the thing they are looking for and *Electricity
/// expense* is a different line as far as their working memory is concerned.
///
/// # Why it is read-only
///
/// Because a category is not a setting, it is a fact about the client's chart,
/// seeded with the migration that derived it from their own account names. A
/// screen that let somebody add one would be a screen that lets somebody add a
/// line to the profit and loss between two closes.
///
/// # Why the accounts are on it
///
/// A family on its own is a word — `expense_category` explains nothing until
/// you know that 6101, 6301 and 6401 are what take it, and that 1102 Bank
/// takes none at all because a bank line's identity is the account it already
/// names. The right-hand column is read off the chart rather than written
/// down, so the day an account changes its declaration this screen changes
/// with it.
export function LineCategories() {
  return (
    <Suspense
      fallback={
        <PageContent>
          <PageHeader
            crumb="Finance"
            title="Line Categories"
            sub="What used to tell two account codes apart is now chosen on the journal line."
          />
          <LoadingState>Reading the category list…</LoadingState>
        </PageContent>
      }
    >
      <LineCategoriesScreen />
    </Suspense>
  )
}

function LineCategoriesScreen() {
  const categories = useCategoriesByFamily()
  const classes = useSuspenseQuery(assetClassesQuery()).data
    .classes as readonly AssetClass[]
  const chart = useChartFamilies()

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Line Categories"
        sub="What used to tell two account codes apart is now chosen on the journal line."
      />

      {categories.families.length === 0 ? (
        <EmptyState>No categories yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <SubHead
            aside={`${count(categories.families.length)} families · ${count(
              categories.families.reduce(
                (total, group) => total + group.rows.length,
                0
              )
            )} categories`}
          >
            Families
          </SubHead>

          {categories.families.map((group) => (
            <div key={group.family} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                {/* The gloss first and the identifier second: `pay_component`
                    is our word, "Komponen gaji" is the thing. The identifier
                    stays because it is what the wire carries and what a
                    support conversation will be about. */}
                <span className="text-[0.9375rem] font-semibold text-ink">
                  {group.label}
                </span>
                <Code>{group.family}</Code>
                <span className="text-[0.9375rem] text-mute">
                  {count(group.rows.length)} categories
                </span>
                {/* The accounts that declare this family, read off the chart.
                    An empty list is worth drawing rather than hiding: a family
                    no account asks for is a seed that landed without the
                    declaration beside it, and that is exactly the kind of gap
                    a reference screen should surface. */}
                <span className="flex flex-wrap items-center gap-1">
                  {chart.byFamily.get(group.family)?.map((account) => (
                    <Tag key={account.account_code} title={account.name}>
                      {account.account_code}
                    </Tag>
                  )) ?? null}
                  {(chart.byFamily.get(group.family) ?? []).length === 0 && (
                    <span className="text-[0.9375rem] text-warn-fg">
                      no account asks for it
                    </span>
                  )}
                </span>
              </div>

              <RefTable
                rows={group.rows}
                columns={categoryColumns}
                getRowId={categoryRowId}
              />
            </div>
          ))}
        </div>
      )}

      <SubHead
        aside={
          chart.noFamily.length === 0
            ? undefined
            : `${count(chart.noFamily.length)} accounts`
        }
      >
        Accounts without a category
      </SubHead>
      {chart.noFamily.length === 0 ? (
        <EmptyState>Every postable account asks for a category.</EmptyState>
      ) : (
        <RefTable
          rows={chart.noFamily}
          columns={accountColumns}
          getRowId={accountRowId}
        />
      )}

      <SubHead
        aside={
          classes.length === 0 ? undefined : `${count(classes.length)} classes`
        }
      >
        Asset classes
      </SubHead>
      {classes.length === 0 ? (
        <EmptyState>No asset classes on this node yet.</EmptyState>
      ) : (
        <RefTable rows={classes} columns={classColumns} getRowId={classRowId} />
      )}
    </PageContent>
  )
}

/// The categories, grouped by family in the accounts' own order — what
/// `useCategoriesByFamily` answers, read inside the screen's `<Suspense>` so
/// the server's HTML holds the lists (`prefetch.ts` warms the same options).
function useCategoriesByFamily() {
  const query = useSuspenseQuery(lineCategoriesQuery())
  const families = useMemo(() => {
    const table = new Map<string, LineCategory[]>()
    for (const row of query.data.categories) {
      const held = table.get(row.family)
      if (held === undefined) table.set(row.family, [row])
      else held.push(row)
    }
    for (const rows of table.values()) {
      rows.sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name, "id-ID")
      )
    }
    return [...table.entries()]
      .map(([family, rows]) => ({
        family,
        label: categoryFamilyLabel(family),
        rows: rows as readonly LineCategory[],
      }))
      .sort(
        (a, b) =>
          categoryFamilyOrder(a.family) - categoryFamilyOrder(b.family) ||
          a.family.localeCompare(b.family)
      )
  }, [query.data])
  return { families }
}

/// The chart's own answer to "which accounts ask for which family".
///
/// Eight requests, one per root class, and not one request for the whole
/// chart: `GET /finance/accounts` walks a level at a time on purpose, because
/// the client's chart is still 7,528 rows with the retired ones in it and
/// nobody wants a megabyte of JSON to read a reference page. The forty live
/// accounts hang directly off the eight roots, so one level is the whole
/// chart — and every one of these keys is the key the Chart of accounts screen
/// already owns, so opening both costs eight requests rather than sixteen.
///
/// Retired accounts are excluded. The 190 that this chart replaced are all
/// still there, still carrying their old declarations, and listing them beside
/// the forty would make the page an argument about which chart is in force.
function useChartFamilies() {
  const roots = ["1", "2", "3", "4", "5", "6", "7", "8"]
  // The same reads, under the same options, as the Chart of Accounts: a
  // chart is imported once and then sits for months, and one key holds one
  // shape of answer, so opening both costs eight requests rather than sixteen.
  const answers = useSuspenseQueries({
    queries: roots.map((root) => accountChildrenQuery(root, false)),
  })

  // Computed on every render rather than memoised: it is forty rows and one
  // sort, and `useQueries` hands back a fresh array each time anyway, so a
  // `useMemo` here would need a dependency that is a lie about what changed.
  const rows: LedgerAccount[] = []
  for (const answer of answers) {
    for (const row of answer.data) {
      if (row.is_group || !row.is_active) continue
      rows.push(row)
    }
  }
  rows.sort((a, b) => a.account_code.localeCompare(b.account_code))

  const byFamily = new Map<string, LedgerAccount[]>()
  for (const row of rows) {
    if (row.category_family === null) continue
    const held = byFamily.get(row.category_family)
    if (held === undefined) byFamily.set(row.category_family, [row])
    else held.push(row)
  }

  return {
    byFamily,
    noFamily: rows.filter((row) => row.category_family === null),
  }
}
