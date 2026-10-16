import { useSuspenseQueries } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { count, money } from "@/lib/format"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ledgerWindowQuery } from "@/lib/queries/finance"
import { Code, useAskedWindow } from "@/screens/finance-final/parts"
import { useSettledWindow } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import { FactsSheet } from "@/screens/finance/phone-parts"
import { ScreenPending } from "@/screens/finance/pending"

/// Prepaids & Accruals — costs paid before the months they belong to, and
/// months that ran before their cost arrived.
///
/// # The model, and where ours stops
///
/// ERPNext calls these Deferred Expense and Deferred Revenue. A purchase
/// invoice line marked deferred debits an ASSET rather than an expense head
/// and carries three dates — `service_start_date`, `service_end_date` and an
/// optional `service_stop_date`. A scheduled job then releases a share of it
/// into the expense head each month, on a Days or a Months basis. The
/// revealing detail is that ERPNext keeps **no schedule table at all**: every
/// run re-derives the whole thing from those three dates and the ledger rows
/// already booked, and that is precisely what makes a re-run safe — it can
/// only ever post the eligible remainder, so running it twice cannot
/// double-book.
///
/// We have the asset accounts and we have the expense heads. What we do not
/// have is the pair of dates: `SupplierBillLine` is `{ line_id, line_number,
/// account_code, account_name, site_id, amount_minor, memo }`, and nothing
/// anywhere records which months a cost belongs to. Without that there is no
/// schedule to draw and nothing for a release run to re-derive.
///
/// # So what this page does instead
///
/// It reads the balances honestly. Every figure below is one
/// `GET /finance/accounts/{code}/ledger` over a window, summed by the server
/// across the account's whole subtree, narrowed by unit on the wire: what was
/// carried into the window, what was added inside it, what was released, and
/// what is carried out. That is the three questions a deferral screen is asked
/// — still to release, released this period, accrual being carried — answered
/// as far as the data honestly reaches.
///
/// What it does NOT do is invent the month-by-month release: nothing records
/// which months a cost belongs to, so there is no schedule to draw.
export function PrepaidsAndAccruals() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Accounting"
          title="Prepaids &amp; Accruals"
        >
          Reading what each prepaid and accrued account is carrying…
        </ScreenPending>
      }
    >
      <PrepaidsAndAccrualsScreen />
    </Suspense>
  )
}

function PrepaidsAndAccrualsScreen() {
  const [shown, setShown] = useState<FamilyReading | null>(null)
  const range = useSettledWindow()
  // On the wire. A prepayment belongs to the unit that will consume it — a
  // shop's rent is that store's cost — so "what is C007 carrying" is a
  // different request, not a slice of a wider answer.
  const [unit, setUnit] = useState("")

  // One query per ACCOUNT, folded back into one row per family. Three of the
  // four families are still a single code; the prepaid one is six, because the
  // collapse left its accounts without a group to name them all.
  const accounts = FAMILIES.flatMap((family, at) =>
    family.codes.map((code) => ({ code, at }))
  )

  // The boxes answer at once; the balances trail them, and the figures in
  // hand stay on screen (dimmed) until the next are read.
  const asked = useAskedWindow(range)
  const askedUnit = useDeferredValue(unit)
  const stale = asked.stale || askedUnit !== unit

  // The movements are not drawn here — four families times a quarter of
  // postings is a table nobody reads — but the window figures are properties
  // of the WINDOW and not of the page, so one row each costs nothing and loses
  // nothing (`ledgerWindowQuery`).
  const families = useSuspenseQueries({
    queries: accounts.map(({ code: askedCode }) =>
      ledgerWindowQuery(askedCode, askedUnit || null, asked.from, asked.to)
    ),
    // `combine` rather than a memo over the results: `useQueries` hands back a
    // new array every render, so a memo keyed on it never holds.
    combine: (answers) => ({
      rows: FAMILIES.map((family, at) => {
        const mine = accounts
          .map((one, index) => ({ one, index }))
          .filter(({ one }) => one.at === at)
          .map(({ index }) => answers[index]?.data)
        // A family of one behaves exactly as it did; a family of six is the
        // sum of six, and `null` the moment any one of them is still in flight
        // — a partial sum is a third thing that is neither "asked" nor "not".
        const whole = mine.every((one) => one !== undefined)
        const sum = (
          pick: (one: (typeof mine)[number]) => number | null | undefined
        ) =>
          whole
            ? mine.reduce((total, one) => total + (pick(one) ?? 0), 0)
            : null
        const data = {
          account_name:
            mine
              .map((one) => one?.account_name)
              .filter((one): one is string => one !== undefined && one !== null)
              .join(" · ") || null,
          opening_minor: sum((one) => one?.opening_minor),
          window_debit_minor: sum((one) => one?.window_debit_minor),
          window_credit_minor: sum((one) => one?.window_credit_minor),
          closing_minor: sum((one) => one?.closing_minor),
          window_rows: sum((one) => one?.window_rows),
        }
        return {
          family,
          /// The client's own name, off the server. Never translated: the
          /// accountant is looking for "Biaya Dibayar Dimuka", and an English
          /// rendering is a different account as far as they are concerned.
          name: data?.account_name ?? null,
          /// What the account held the day before the window opened. Without
          /// it the first figure on the row would be a movement pretending to
          /// be a balance.
          carriedIn: data?.opening_minor ?? null,
          debit: data?.window_debit_minor ?? null,
          credit: data?.window_credit_minor ?? null,
          carriedOut: data?.closing_minor ?? null,
          /// How many postings are behind the two movement figures. A tally,
          /// not a second opinion about an amount — and the difference
          /// between "nothing happened" and "one big entry happened".
          movements: data?.window_rows ?? null,
        }
      }),
    }),
  })

  // A `find` over four entries rather than a memoised index. `FAMILIES` is a
  // module-level constant of fixed length, so the lookup is two comparisons and
  // a map keyed on it would be ceremony around an array anybody can read.
  const prepaid = families.rows.find(
    (row) => row.family.code === PREPAID_FAMILY
  )
  const accrued = families.rows.find(
    (row) => row.family.code === ACCRUED_FAMILY
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: families.rows,
        columns,
        getRowId: (row: FamilyReading) => row.family.code,
      }),
      [families.rows]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Accounting"
        title="Prepaids &amp; Accruals"
      />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        {/* Three single server figures, one per question. Not one of them
            adds two accounts together: prepaid tax and prepaid rent are
            both "paid ahead" and are not the same kind of thing, and a
            card that summed them would have an opinion this page has no
            business having. */}
        <div title="Prepaid cost not yet charged to a month">
          <Kpi
            label="Still to release"
            value={money(prepaid?.carriedOut ?? null)}
          />
        </div>
        <div title="Prepaid taken to an expense head">
          <Kpi
            label="Released in the window"
            value={money(prepaid?.credit ?? null)}
          />
        </div>
        {/* A liability, so the ledger holds it as a credit and it comes back
            negative. Unflipped, deliberately — see the note under the table. */}
        <div title="Cost the books have taken and not yet paid">
          <Kpi
            label="Accrual carried"
            value={money(accrued?.carriedOut ?? null)}
          />
        </div>
      </KpiStrip>

      <Toolbar>
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        <span className="text-[0.9375rem] text-mute">
          {range.chip}
          {unit === "" ? (
            " · all units"
          ) : (
            <>
              {" · "}
              <UnitName id={unit} />
            </>
          )}
        </span>
      </Toolbar>

      <div
        className="list-swap flex flex-col gap-4"
        aria-busy={stale || undefined}
      >
        {/* One table, one head: the two halves are bands inside it, not two
              tables, because the question this page is read with is
              comparative — is the cost we are holding back the same size as
              the cost we have taken and not paid — and that comparison is made
              by running the eye down one column. */}
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<FamilyReading>
            table={table}
            roomy
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
            onRowClick={setShown}
            isSelected={(row) => row.family.code === shown?.family.code}
            renderBefore={(row, index, all) =>
              index > 0 &&
              all[index - 1].family.side === row.family.side ? null : (
                <SideBand side={row.family.side} />
              )
            }
            // No total under either half. The three prepaid families are not
            // addable — a travel advance and input VAT clear on different
            // calendars and against different things — and a sum of them
            // would be a figure with no name. The figures above total the
            // one family that has a total worth having.
          />
        </Card>

        <FactsSheet
          open={shown !== null}
          onClose={() => setShown(null)}
          title={shown?.family.what ?? ""}
          id={shown?.family.code}
          caption={shown?.name ?? undefined}
          facts={
            shown === null
              ? []
              : [
                  {
                    label: "Carried in",
                    value: money(shown.carriedIn),
                  },
                  {
                    label: "Added",
                    value: money(
                      shown.family.side === "ACCRUED"
                        ? shown.credit
                        : shown.debit
                    ),
                  },
                  {
                    label: "Released",
                    value: money(
                      shown.family.side === "ACCRUED"
                        ? shown.debit
                        : shown.credit
                    ),
                  },
                  {
                    label: "Moves",
                    value:
                      shown.movements === null ? "—" : count(shown.movements),
                  },
                  {
                    label: "Carried out",
                    value: money(shown.carriedOut),
                  },
                ]
          }
        >
          {shown !== null && (
            <p className="mt-4 text-[0.9375rem] text-mute">
              {shown.family.covers}
            </p>
          )}
        </FactsSheet>
      </div>
    </PageContent>
  )
}

/// The prepaid family the deferral question is actually about: the rent,
/// insurance, maintenance-contract, promotion and licence buckets.
///
/// Named as its SIX ACCOUNTS rather than as the group `1011301` that used to
/// hold them. The chart collapse of 2026-09-14 dropped that seven-digit rung
/// and re-parented the six straight onto `10113 Biaya Dibayar Dimuka`, so the
/// old code answers `not found: account 1011301`. `10113` is not a substitute:
/// it also holds `1011302 Pajak Dibayar Dimuka` and `1011303 Uang Muka`, which
/// this screen counts as families of their own, so reading it here would count
/// them twice.
///
/// Worth knowing, because it is the chart's inconsistency and not this
/// screen's: of the three siblings under `10113`, two kept their group rung and
/// this one did not. 133 posting accounts across the chart are in the same
/// position — a posting whose parent is a five-digit group.
const PREPAID_FAMILY = "prepaid-expense"
const PREPAID_CODES = [
  "1011301001",
  "1011301002",
  "1011301005",
  "1011301007",
  "1011301008",
  "1011301009",
] as const

/// The whole accrual side of the client's chart, payroll through utilities.
///
/// `20122 Biaya Yang Masih Harus Dibayar` after the collapse, and an exact
/// substitute for the old `2012201`: every one of its children is a
/// `2012201*` posting, so the subtree is the same set of accounts.
const ACCRUED_FAMILY = "20122"

/// The four families, at the altitude where each one means something.
///
/// Group codes and not leaves, because the chart splits every one of these
/// into fourteen location copies — `Asuransi Bayar Dimuka C001`, `… C002` —
/// and the server matches by code prefix. One code reaches all fourteen, and
/// the unit filter above does the narrowing on the wire. That is the module's
/// argument about the unit being a dimension, made in one field.
///
/// Prepaid TAX is kept as its own row rather than folded into the prepaid
/// total, and the distinction matters: input VAT and instalment income tax are
/// paid ahead, but they are not a cost spread over months. They are recovered
/// against a tax return, on the tax office's calendar and not on ours. A
/// screen that added them to prepaid rent would report a deferral balance that
/// no release run could ever touch — and at this client that is the only one
/// of the four carrying anything, so folding it in would hide the finding that
/// the deferral accounts are empty.
const FAMILIES: readonly {
  /// The family's identity. A real account code where one still names the
  /// whole family, and a plain word where the collapse left no such code.
  readonly code: string
  /// The accounts it is the sum of. One, usually.
  readonly codes: readonly string[]
  readonly side: "PREPAID" | "ACCRUED"
  readonly what: string
  readonly covers: string
  readonly reading: string
}[] = [
  {
    code: PREPAID_FAMILY,
    codes: PREPAID_CODES,
    side: "PREPAID",
    what: "Prepaid cost",
    covers:
      "Asuransi · Sewa Tanah · Sewa Toko · Sewa Rumah · Kontrak Maintenance · Sewa Kendaraan · Promosi · Ijin Usaha · Lain-Lain",
    reading: "Debit adds, credit releases into the month it belongs to.",
  },
  {
    code: "1011302",
    codes: ["1011302"],
    side: "PREPAID",
    what: "Prepaid tax",
    covers: "PPh 21 · PPh 25 · PPh 29 · PPN Masukan · PBB · Other",
    reading:
      "Paid ahead but not spread over months — it is recovered against a return.",
  },
  {
    code: "1011303",
    codes: ["1011303"],
    side: "PREPAID",
    what: "Advances out",
    covers: "Travelling · Purchase · To Contractors · Others",
    reading:
      "Money gone before its cost arrived. It clears against a claim, not on a calendar.",
  },
  {
    code: ACCRUED_FAMILY,
    codes: [ACCRUED_FAMILY],
    side: "ACCRUED",
    what: "Accrued expense",
    covers:
      "Gaji dan Upah · THR/Bonus · Bunga · Pengobatan · Asuransi & BPJS · Telepon · Listrik · Air · Sewa Kantor · Sewa Mess",
    reading:
      "Reversed here: the CREDIT column is the cost being taken, the DEBIT is the invoice clearing it.",
  },
]

/// Every account the families above read, for the prefetcher to warm.
export const FAMILY_ACCOUNT_CODES: readonly string[] = FAMILIES.flatMap(
  (family) => family.codes
)

/// The band that opens each half of the table: what the half is.
function SideBand({ side }: { side: "PREPAID" | "ACCRUED" }) {
  return (
    <div className="bg-soft px-3 py-2">
      <span className="text-[0.9375rem] font-semibold text-ink">
        {side === "PREPAID" ? "Paid before its months" : "Ran before its cost"}
      </span>
      <span className="ml-2 text-[0.9375rem] text-mute">
        {side === "PREPAID"
          ? "An asset until the month it belongs to arrives"
          : "A liability from the month it belongs to until the invoice lands"}
      </span>
    </div>
  )
}

/// What one family read back, once its query answered.
type FamilyReading = {
  family: (typeof FAMILIES)[number]
  name: string | null
  carriedIn: number | null
  debit: number | null
  credit: number | null
  carriedOut: number | null
  movements: number | null
}

/// On the accrual side the debit and credit columns swap meaning: a credit is
/// the cost being taken and a debit is the invoice clearing it. The figures
/// are the server's either way — this only decides which column each lands
/// in, so the heading "Added" means the same thing on both halves.
const addedOf = (row: FamilyReading) =>
  row.family.side === "ACCRUED" ? row.credit : row.debit
const releasedOf = (row: FamilyReading) =>
  row.family.side === "ACCRUED" ? row.debit : row.credit

/// What it is, the account, the code, and the four window figures. On a card
/// the name leads with what is carried out beside it; the rest is in the sheet
/// a tap opens. The `priority` is what a narrow window gives up first.
const columns: ColumnDef<TableSetup, FamilyReading>[] = [
  {
    id: "what",
    accessorFn: (row) => row.family.what,
    header: "What it is",
    size: 260,
    enableSorting: false,
    meta: { card: "title", grow: 220 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col whitespace-normal">
        <span className="font-medium text-ink">{row.original.family.what}</span>
        <span className="mt-0.5 text-[0.9375rem] font-normal text-mute">
          {row.original.family.reading}
        </span>
      </span>
    ),
  },
  {
    id: "account",
    accessorFn: (row) => row.name ?? "",
    header: "The client\u2019s account",
    size: 260,
    enableSorting: false,
    meta: { card: "hide", priority: 2 },
    cell: ({ row }) =>
      row.original.name === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="flex min-w-0 flex-col whitespace-normal">
          <span>{row.original.name}</span>
          <span className="mt-0.5 text-[0.9375rem] text-mute">
            {row.original.family.covers}
          </span>
        </span>
      ),
  },
  {
    id: "code",
    accessorFn: (row) => row.family.code,
    header: "Code",
    size: 130,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => <Code>{row.original.family.code}</Code>,
  },
  {
    id: "carried_in",
    accessorFn: (row) => row.carriedIn,
    header: "Carried in",
    size: 140,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => <Figure minor={row.original.carriedIn} />,
  },
  {
    id: "added",
    accessorFn: addedOf,
    header: "Added",
    size: 140,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => <Figure minor={addedOf(row.original)} />,
  },
  {
    id: "released",
    accessorFn: releasedOf,
    header: "Released",
    size: 140,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => <Figure minor={releasedOf(row.original)} />,
  },
  {
    id: "moves",
    accessorFn: (row) => row.movements,
    // How many postings are behind the two movement figures.
    header: "Moves",
    size: 90,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 3 },
    cell: ({ row }) =>
      row.original.movements === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="text-mute">{count(row.original.movements)}</span>
      ),
  },
  {
    id: "carried_out",
    accessorFn: (row) => row.carriedOut,
    header: "Carried out",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => <Figure minor={row.original.carriedOut} strong />,
  },
]

/// A ledger figure, with a zero that is a finding rather than a gap.
///
/// `Rp 0` means the server looked and found nothing posted; `—` means nobody
/// has asked yet. Those are different claims, and a finance screen that draws
/// them the same has lied about an account nothing has ever touched.
function Figure({ minor, strong }: { minor: number | null; strong?: boolean }) {
  if (minor === null) {
    return (
      <span className="text-faint" title="Not read yet">
        —
      </span>
    )
  }
  return (
    <span
      className={
        strong
          ? minor < 0
            ? "font-medium text-warn-fg"
            : "font-medium text-ink"
          : "text-text"
      }
    >
      {money(minor)}
    </span>
  )
}
