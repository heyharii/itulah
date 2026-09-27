import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  accountChildren,
  accountLedger,
  accountLinks,
  financeAttention,
  financeKeys,
  listPeriods,
} from "@/lib/queries/finance"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { useWindow } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import type { FiscalPeriod, LedgerAccount } from "@itulah/contract"

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
/// What it does NOT do is invent the month-by-month release. The schedule
/// table below is drawn as the real shape, over the months the books actually
/// have, with an em dash in every money column and the reason written under
/// it. A plausible twelve-month release ladder over nothing would be the one
/// thing worse than an empty page.
export function PrepaidsAndAccruals() {
  const range = useWindow()
  // On the wire. A prepayment belongs to the unit that will consume it — a
  // shop's rent is that store's cost — so "what is C007 carrying" is a
  // different request, not a slice of a wider answer.
  const [unit, setUnit] = useState("")

  // One query per ACCOUNT, folded back into one row per family. Three of the
  // four families are still a single code; the prepaid one is six, because the
  // collapse left its accounts without a group to name them all.
  const asked = FAMILIES.flatMap((family, at) =>
    family.codes.map((code) => ({ code, at }))
  )

  const families = useQueries({
    queries: asked.map(({ code: askedCode }) => ({
      queryKey: financeKeys.ledger(
        askedCode,
        unit || null,
        range.from,
        range.to
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountLedger(
          askedCode,
          {
            unit: unit || undefined,
            from: range.from,
            to: range.to,
            // The movements are not drawn here — four families times a
            // quarter of postings is a table nobody reads — but the four
            // window figures are properties of the WINDOW and not of the
            // page, so asking for one row costs nothing and loses nothing.
            limit: 1,
          },
          signal
        ),
    })),
    // `combine` rather than a memo over the results: `useQueries` hands back a
    // new array every render, so a memo keyed on it never holds.
    combine: (answers) => ({
      isPending: answers.some((one) => one.isPending),
      isError: answers.some((one) => one.isError),
      error: answers.find((one) => one.isError)?.error,
      rows: FAMILIES.map((family, at) => {
        const mine = asked
          .map((one, index) => ({ one, index }))
          .filter(({ one }) => one.at === at)
          .map(({ index }) => answers[index]?.data)
        // A family of one behaves exactly as it did; a family of six is the
        // sum of six, and `null` the moment any one of them is still in flight
        // — a partial sum is a third thing that is neither "asked" nor "not".
        const whole = mine.every((one) => one !== undefined)
        const sum = (pick: (one: (typeof mine)[number]) => number | null | undefined) =>
          whole ? mine.reduce((total, one) => total + (pick(one) ?? 0), 0) : null
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
  const prepaid = families.rows.find((row) => row.family.code === PREPAID_FAMILY)
  const accrued = families.rows.find((row) => row.family.code === ACCRUED_FAMILY)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Accounting"
        title="Prepaids &amp; Accruals"
        sub="Costs paid before the months they belong to, and months that ran before their cost arrived."
      />

      <Toolbar>
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {range.chip}
          {unit === "" ? (
            " · every unit"
          ) : (
            <>
              {" · "}
              <UnitName id={unit} />
            </>
          )}
        </span>
      </Toolbar>

      {families.isPending ? (
        <LoadingState>
          Reading what each prepaid and accrued account is carrying…
        </LoadingState>
      ) : families.isError ? (
        <ErrorState error={families.error} />
      ) : (
        <div className="flex flex-col gap-4">
          <CardRow>
            {/* Three single server figures, one per question. Not one of them
                adds two accounts together: prepaid tax and prepaid rent are
                both "paid ahead" and are not the same kind of thing, and a
                card that summed them would have an opinion this page has no
                business having. */}
            <NumberCard
              label="Still to release"
              value={prepaid?.carriedOut ?? null}
              note="Prepaid cost not yet charged to a month"
            />
            <NumberCard
              label="Released in the window"
              value={prepaid?.credit ?? null}
              note="Prepaid taken to an expense head"
            />
            <NumberCard
              label="Accrual carried"
              // A liability, so the ledger holds it as a credit and it comes
              // back negative. Unflipped, deliberately — see the note under
              // the table.
              value={accrued?.carriedOut ?? null}
              note="Cost the books have taken and not yet paid"
            />
          </CardRow>

          <Grid>
            <thead>
              <tr>
                <Th>What it is</Th>
                <Th width="16rem">The client&rsquo;s account</Th>
                <Th width="7.5rem">Code</Th>
                <Th align="right" width="9rem">
                  Carried in
                </Th>
                <Th align="right" width="9rem">
                  Added
                </Th>
                <Th align="right" width="9rem">
                  Released
                </Th>
                <Th align="right" width="5rem">
                  <span title="How many postings are behind the two movement figures">
                    Moves
                  </span>
                </Th>
                <Th align="right" width="9.5rem">
                  Carried out
                </Th>
              </tr>
            </thead>

            {/* Two `<tbody>` elements and one `<thead>`, not two tables. The
                question this page is read with is comparative — is the cost we
                are holding back the same size as the cost we have taken and not
                paid — and that comparison is made by running the eye down one
                column. Two tables cannot be relied on to put "Carried out" at
                the same x position twice. */}
            <SideBody
              label="Paid before its months"
              sub="An asset until the month it belongs to arrives"
              rows={families.rows.filter((row) => row.family.side === "PREPAID")}
            />
            <SideBody
              label="Ran before its cost"
              sub="A liability from the month it belongs to until the invoice lands"
              rows={families.rows.filter((row) => row.family.side === "ACCRUED")}
            />
          </Grid>

          <Note>
            <b>
              Added and Released are the two sides of the ledger, named for the
              half of the table they are on.
            </b>{" "}
            On the prepaid rows a debit adds to what is being held and a credit
            releases it into an expense head, so the columns read as written.
            On the accrual row they are the other way round — a credit is the
            cost being taken and a debit is the invoice arriving and clearing
            it — so <b>Added</b> there is the debit column and{" "}
            <b>Released</b> the credit, which is why the row says so in its own
            words rather than relying on the heading. Balances are the
            ledger&rsquo;s own sign and are not flipped: an accrual is a credit
            and reads negative, because a report decides how to present a
            balance and a balance does not decide for itself.
          </Note>

          <Schedule to={range.to} unit={unit} />

          <ChartShape />
        </div>
      )}
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

/// One half of the table: a band that names it, then its families.
function SideBody({
  label,
  sub,
  rows,
}: {
  label: string
  sub: string
  rows: readonly FamilyReading[]
}) {
  return (
    <tbody>
      <tr>
        {/* Written out rather than assembled from `Td`, because it is the one
            cell here that must span every column and `Td` takes no `colSpan` —
            teaching it one is an edit to `parts.tsx`, which this screen does
            not own. */}
        <td
          colSpan={COLUMNS}
          className="border-b border-hairline-2 bg-soft px-2 py-1.5"
        >
          <span className="text-[0.875rem] font-semibold text-ink">
            {label}
          </span>
          <span className="ml-2 text-[0.875rem] text-mute">{sub}</span>
        </td>
      </tr>
      {rows.map((row) => (
        <FamilyRow key={row.family.code} row={row} />
      ))}
      {/* No total under either half. The three prepaid families are not
          addable — a travel advance and input VAT clear on different
          calendars and against different things — and a sum of them would be
          a figure with no name. The cards above total the one family that has
          a total worth having. */}
    </tbody>
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

/// What it is, the account, the code, and the four window figures.
const COLUMNS = 8

function FamilyRow({ row }: { row: FamilyReading }) {
  // On the accrual side the debit and credit columns swap meaning: a credit is
  // the cost being taken and a debit is the invoice clearing it. The figures
  // are the server's either way — this only decides which column each lands
  // in, so the heading "Added" means the same thing on both halves.
  const accrual = row.family.side === "ACCRUED"
  const added = accrual ? row.credit : row.debit
  const released = accrual ? row.debit : row.credit

  return (
    <tr>
      <Td>
        <span className="font-medium text-ink">{row.family.what}</span>
        <span className="mt-0.5 block text-[0.875rem] text-mute">
          {row.family.reading}
        </span>
      </Td>
      <Td>
        {row.name === null ? (
          <span className="text-faint">—</span>
        ) : (
          <>
            <span>{row.name}</span>
            <span className="mt-0.5 block text-[0.875rem] text-mute">
              {row.family.covers}
            </span>
          </>
        )}
      </Td>
      <Td>
        <Code>{row.family.code}</Code>
      </Td>
      <Td align="right">
        <Figure minor={row.carriedIn} />
      </Td>
      <Td align="right">
        <Figure minor={added} />
      </Td>
      <Td align="right">
        <Figure minor={released} />
      </Td>
      <Td align="right">
        {row.movements === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="text-mute">{count(row.movements)}</span>
        )}
      </Td>
      <Td align="right">
        <Figure minor={row.carriedOut} strong />
      </Td>
    </tr>
  )
}

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

/// The release schedule, drawn as the shape it would take.
///
/// # Why the money columns are em dashes
///
/// Because nothing anywhere records which months a cost belongs to. The
/// months in this table are real — they come from `GET /finance/periods`,
/// which is the list of months the books have been opened for — and whether
/// each is open is real, because that is what decides whether a release entry
/// could be posted into it at all. What cannot be filled is the amount, and
/// filling it with a twelve-month straight line would be a fabrication
/// wearing a real table's clothes.
///
/// # Why the months come from the period list and not from a date loop
///
/// Because a month the books have never opened is not a month a release run
/// could post into, and a schedule that lists it is a schedule promising
/// something the database will refuse. The period list is the honest domain
/// of this table.
function Schedule({ to, unit }: { to: string; unit: string }) {
  const periods = useQuery({
    // The same key `useWindow()` already reads the period list under, so the
    // toolbar above and this table are one request.
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
  })

  // Sliced off the ISO string rather than parsed into a `Date`. The node keeps
  // UTC and this browser is UTC+7, so `new Date("2026-09-01").getMonth()` is
  // August here — the same off-by-one-month that has bitten the roster.
  const year = Number(to.slice(0, 4))
  const month = Number(to.slice(5, 7))

  const attention = useQuery({
    queryKey: financeKeys.attention(year, month),
    queryFn: ({ signal }) => financeAttention(year, month, signal),
    enabled: Number.isFinite(year) && Number.isFinite(month),
  })

  return (
    <>
      <h2 className="mt-2 text-[0.875rem] font-semibold text-ink">
        Release schedule
      </h2>
      <p className="-mt-2 text-[0.875rem] text-mute">
        What a release run would post, month by month
        {unit === "" ? "" : ", in this unit"}
      </p>

      {periods.isPending ? (
        <LoadingState>
          Reading which months the books have been opened for…
        </LoadingState>
      ) : periods.isError ? (
        <ErrorState error={periods.error} />
      ) : periods.data.length === 0 ? (
        <EmptyState>
          No month has been opened yet. A release entry has to post into a
          month, so until somebody opens one there is nowhere for this schedule
          to land.
        </EmptyState>
      ) : (
        <>
          <Grid>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th width="9rem">Books</Th>
                <Th align="right" width="7rem">
                  <span title="Journal entries posted into this month, of every kind">
                    Entries
                  </span>
                </Th>
                <Th align="right" width="11rem">
                  <span title="Prepaid cost belonging to this month">
                    To release
                  </span>
                </Th>
                <Th align="right" width="11rem">
                  <span title="Cost taken into this month with no invoice against it">
                    Accrual to take
                  </span>
                </Th>
                <Th align="right" width="11rem">
                  <span title="Prepaid still held after this month has been released">
                    Still to release
                  </span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {periods.data.map((period) => (
                <PeriodRow key={`${period.year}-${period.month}`} period={period} />
              ))}
              <TotalRow>
                <Td>{count(periods.data.length)} months</Td>
                <Td />
                <Td align="right">
                  {count(
                    periods.data.reduce(
                      (sum, period) => sum + period.entry_count,
                      0
                    )
                  )}
                </Td>
                <Td align="right">
                  <NotKept />
                </Td>
                <Td align="right">
                  <NotKept />
                </Td>
                <Td align="right">
                  <NotKept />
                </Td>
              </TotalRow>
            </tbody>
          </Grid>

          {attention.data !== undefined && attention.data.month_not_open > 0 && (
            <Note>
              <b>
                The month this window ends in is not open, so nothing could be
                released into it today.
              </b>{" "}
              A release entry posts on a date, and the database refuses a
              posting into a month nobody has opened — which is the check that
              stops a mistyped date filing a cost in 2062. Opening it is done on{" "}
              <b>Period close</b>.
            </Note>
          )}

          <Note>
            <b>
              The three money columns are empty because nothing records which
              months a cost belongs to.
            </b>{" "}
            An expense bill line here is{" "}
            <code>
              {
                "{ line_id, line_number, account_code, account_name, site_id, amount_minor, memo }"
              }
            </code>{" "}
            — an account and an amount, and no dates. ERPNext fills exactly
            these columns from three fields on the invoice item:{" "}
            <code>service_start_date</code>, <code>service_end_date</code> and
            an optional <code>service_stop_date</code> for an early
            termination, plus a company-wide switch deciding whether a month
            gets an equal share or a day-count share. Add those three fields to
            a bill line and a deferred-expense account to point the line at, and
            this table fills itself.
          </Note>

          <Note>
            <b>
              And it should be derived, not stored — that is the part worth
              copying.
            </b>{" "}
            ERPNext keeps no schedule table at all. Every run works out what is
            due from the three dates and the ledger rows already booked, and
            posts only the eligible remainder, so running it twice cannot
            double-book and a missed month catches up by itself. A stored
            schedule would need reversing every time a bill was corrected, and
            would drift from the ledger the first time somebody posted a manual
            journal against the prepaid account. So what this screen needs is
            not a <code>GET /finance/deferrals</code> holding rows somebody
            maintains: it is <code>service_start_date</code> and{" "}
            <code>service_end_date</code> on the bill line, and one endpoint —{" "}
            <code>GET /finance/deferral-schedule?from=&amp;to=&amp;site=</code>{" "}
            — answering{" "}
            <code>
              {
                "{ months: [{ year, month, to_release_minor, accrual_minor, still_held_minor }], total }"
              }
            </code>
            , computed in SQL from those dates against what the ledger already
            carries. A second route posting one month&rsquo;s release would then
            be idempotent for free, because it would ask this same query what is
            left.
          </Note>
        </>
      )}
    </>
  )
}

function PeriodRow({ period }: { period: FiscalPeriod }) {
  const open = period.status.toUpperCase() === "OPEN"
  return (
    <tr>
      <Td>
        <span className="font-medium text-ink">
          {MONTHS[period.month - 1] ?? period.month} {period.year}
        </span>
      </Td>
      <Td>
        <Pill tone={open ? "info" : "ok"}>{open ? "Open" : "Closed"}</Pill>
      </Td>
      <Td align="right">
        {/* Real, and the one number on this row that is. A month with no
            entries is a month nobody has worked yet, which is different from a
            month that balanced. */}
        <span className="text-mute">{count(period.entry_count)}</span>
      </Td>
      <Td align="right">
        <NotKept />
      </Td>
      <Td align="right">
        <NotKept />
      </Td>
      <Td align="right">
        <NotKept />
      </Td>
    </tr>
  )
}

/// A figure nothing records.
///
/// Not `money(0)`, which would be a claim that this month has no prepaid cost
/// belonging to it. `text-faint`, so a column of these reads as absent at a
/// glance rather than as data somebody has to squint at.
function NotKept() {
  return (
    <span className="text-faint" title="Nothing records this — see the note">
      —
    </span>
  )
}

const MONTHS: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/// What the chart is already set up to carry, and how little of it is wired.
///
/// This section is here because "the prepaid balance is zero" and "there are
/// nine prepaid buckets and ten accrual buckets standing ready and one of each
/// is bound to a meaning" are the same finding and very different news. The
/// first reads as an empty screen; the second says what it would take.
///
/// The mapping check is structural and not arithmetic: a mapped account code
/// like `101130100100` begins with the bucket's own `1011301001`, which is the
/// same prefix rule the server itself sums by. The account map is already in
/// the cache — `<UnitSelect>` above reads it to know what a unit is — so this
/// costs no request.
function ChartShape() {
  const prepaid = useQuery({
    // `10113` and then narrowed, because the family's own group code no longer
    // exists: its six accounts hang straight off `10113`, alongside the two
    // sibling groups this screen counts separately.
    queryKey: financeKeys.accountChildren("10113", false),
    queryFn: ({ signal }) =>
      accountChildren({ parent: "10113" }, signal).then((page) =>
        page.rows.filter((row) => row.account_code.startsWith("1011301"))
      ),
    staleTime: 5 * 60 * 1000,
  })
  const accrued = useQuery({
    queryKey: financeKeys.accountChildren(ACCRUED_FAMILY, false),
    queryFn: ({ signal }) =>
      accountChildren({ parent: ACCRUED_FAMILY }, signal).then(
        (page) => page.rows
      ),
    staleTime: 5 * 60 * 1000,
  })
  const map = useQuery({
    queryKey: financeKeys.accountLinks(null, null),
    queryFn: ({ signal }) => accountLinks({}, signal),
    staleTime: 5 * 60 * 1000,
  })

  const mappedCodes = useMemo(
    () => (map.data?.rows ?? []).map((row) => row.account_code),
    [map.data]
  )

  if (prepaid.isPending || accrued.isPending) {
    return (
      <LoadingState>
        Reading which buckets the client&rsquo;s chart keeps…
      </LoadingState>
    )
  }
  if (prepaid.isError) return <ErrorState error={prepaid.error} />
  if (accrued.isError) return <ErrorState error={accrued.error} />

  // Counted from what actually came back rather than written into the sentence.
  // A number in prose is right on the day it is typed and wrong the first time
  // somebody edits the thing it counts — the client's chart is imported, so
  // these two lists change without anybody touching this file.
  const buckets = prepaid.data.length + accrued.data.length
  const wired = [...prepaid.data, ...accrued.data].filter((account) =>
    mappedCodes.some((code) => code.startsWith(account.account_code))
  ).length

  return (
    <>
      <h2 className="mt-2 text-[0.875rem] font-semibold text-ink">
        What the chart is set up to carry
      </h2>
      <p className="-mt-2 text-[0.875rem] text-mute">
        The buckets that already exist, and which of them a posting can reach
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <BucketList
          heading="Prepaid — paid before its months"
          accounts={prepaid.data}
          mappedCodes={mappedCodes}
          pendingMap={map.isPending}
        />
        <BucketList
          heading="Accrued — the month ran first"
          accounts={accrued.data}
          mappedCodes={mappedCodes}
          pendingMap={map.isPending}
        />
      </div>

      <Note>
        <b>A bucket with no meaning against it cannot be posted to by rule.</b>{" "}
        Everything this system books automatically goes through an account
        link — a role like <code>prepaid_expense</code> bound to one of the
        client&rsquo;s accounts, for every unit or for some —{" "}
        {map.isPending ? (
          <>and the ones that carry one are marked above.</>
        ) : (
          <>
            and only {count(wired)} of these {count(buckets)} buckets carries
            one.
          </>
        )}{" "}
        The bindings that exist are both qualified —{" "}
        <code>prepaid_expense</code> under <code>ASURANSI</code>,{" "}
        <code>accrued_expense</code> under <code>UMUM</code> — which is what
        makes the rest cheap to finish: a qualifier is part of the key, so{" "}
        <code>prepaid_expense</code> can take a second binding for{" "}
        <code>SEWA</code> and a third for <code>LISENSI</code> without any
        schema change at all. The unmapped buckets are not broken — a manual
        journal reaches any account in the chart — they are simply out of reach
        of anything automatic, which for rent paid a year ahead is the case
        that matters.
      </Note>
    </>
  )
}

/// One side's buckets, with the mapped ones marked.
function BucketList({
  heading,
  accounts,
  mappedCodes,
  pendingMap,
}: {
  heading: string
  accounts: readonly LedgerAccount[]
  mappedCodes: readonly string[]
  pendingMap: boolean
}) {
  return (
    <div>
      <div className="mb-1.5 text-[0.875rem] font-medium text-mute">
        {heading} · {count(accounts.length)}
      </div>
      <Grid>
        <tbody>
          {accounts.map((account) => {
            const mapped = mappedCodes.some((code) =>
              code.startsWith(account.account_code)
            )
            return (
              <tr key={account.account_code}>
                <Td>{account.name}</Td>
                <Td>
                  <Code>{account.account_code}</Code>
                </Td>
                <Td align="right">
                  {pendingMap ? (
                    <span className="text-faint">—</span>
                  ) : mapped ? (
                    <Pill tone="ok">mapped</Pill>
                  ) : (
                    <span className="text-[0.875rem] text-faint">
                      no meaning
                    </span>
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Grid>
    </div>
  )
}
