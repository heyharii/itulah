import {
  useMutation,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query"
import { Check, CircleAlert, X } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  closeReadinessQuery,
  financeControlsQuery,
  softCloseMonth,
} from "@/lib/queries/finance-domains"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { BookCheck } from "@/screens/finance/book-check"
import { isoDay, monthLabel } from "@/screens/finance/chart"
import { PhoneCard, PhoneList } from "@/components/ui/phone-cards"
import { ScreenPending } from "@/screens/finance/pending"

/// Period Close — what stands between a month and being shut, then every
/// subledger beside the ledger it controls.
///
/// Redrawn 2026-10-01 (owner: "closing kita berantakan"). The checklist comes
/// first because it is the question this page is opened to answer — "can I
/// close September?" — and the control table second, as the evidence behind
/// the control rows of that list. Three loud banners became one line of status.
///
/// The server's labels and details are Indonesian and partly technical (raw
/// numbers, trigger names), so the page speaks from the check and domain
/// CODES, in English, and draws the figures itself. An unknown code still
/// shows, in the server's own words.
///
/// ERPNext has no screen like this: its month end is Accounting Period (a
/// lock) and Period Closing Voucher (the year-end entry). This is the step
/// before both.
export function FinanceControls() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Closing" title="Period Close">
          Checking the month and the controls…
        </ScreenPending>
      }
    >
      <FinanceControlsScreen />
    </Suspense>
  )
}

function FinanceControlsScreen() {
  const phone = useLayout() === "phone"
  const client = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  })

  // The month answers at once; the checklist trails it, and the one in hand
  // stays on screen (dimmed) until the next is read.
  const askedMonth = useDeferredValue(month)
  const stale = askedMonth !== month
  const [controls, readiness] = useSuspenseQueries({
    queries: [
      financeControlsQuery(),
      closeReadinessQuery(askedMonth.year, askedMonth.month),
    ],
  })

  const soft = useMutation({
    // The month the checklist beside the button is about.
    mutationFn: () =>
      softCloseMonth({ year: askedMonth.year, month: askedMonth.month }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  const rows = controls.data
  const byDomain = useMemo(
    () => new Map(rows.map((row) => [row.domain, row])),
    [rows]
  )
  // Blockers first, then what cannot be known yet, then what is fine.
  const checks = useMemo(
    () =>
      [...readiness.data.checks].sort(
        (a, b) => RANK[a.status] - RANK[b.status]
      ),
    [readiness.data]
  )
  const blockers = readiness.data.blockers
  const status = readiness.data.period_status
  const off = rows.filter((row) => row.covered && row.difference_minor !== 0)
  const name = monthLabel(askedMonth.year, askedMonth.month)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Closing"
        title="Period Close"
        // The one action stands in the head; the month it acts on is the scope
        // bar's, under it. On a phone the month is the dock's status button and
        // closing for the shops its +.
        actions={
          phone ? undefined : (
            <Button
              variant="primary"
              pending={soft.isPending}
              disabled={status !== "OPEN"}
              title={
                status === "OPEN"
                  ? undefined
                  : `${name} is already ${statusWord(status).toLowerCase()}`
              }
              onClick={() => soft.mutate()}
            >
              Close for the shops
            </Button>
          )
        }
      />

      {!phone && (
        <Toolbar>
          <Input
            type="month"
            aria-label="Month"
            className="h-control w-44"
            value={`${month.year}-${String(month.month).padStart(2, "0")}`}
            onChange={(event) => {
              const [year, part] = event.target.value.split("-")
              if (year && part)
                setMonth({ year: Number(year), month: Number(part) })
            }}
          />
        </Toolbar>
      )}

      {phone && (
        <>
          <SubTabs
            tabs={recentMonths(now).map((one) => ({
              value: `${one.year}-${String(one.month).padStart(2, "0")}`,
              label: monthLabel(one.year, one.month),
            }))}
            value={`${month.year}-${String(month.month).padStart(2, "0")}`}
            onChange={(next) => {
              const [year, part] = next.split("-")
              if (year && part)
                setMonth({ year: Number(year), month: Number(part) })
            }}
          />
          {status === "OPEN" && (
            <Fab
              label="Close for the shops"
              onClick={() => {
                if (!soft.isPending) soft.mutate()
              }}
            />
          )}
        </>
      )}

      {/* One line instead of three banners: where the month stands. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.9375rem]">
        <span className="font-medium text-ink">{name}</span>
        <Status tone={status === "OPEN" ? "info" : "ok"}>
          {statusWord(status)}
        </Status>
        <span className={blockers > 0 ? "text-bad-fg" : "text-ok-fg"}>
          {blockers === 0
            ? "Nothing blocks closing"
            : `${count(blockers)} ${blockers === 1 ? "thing blocks" : "things block"} closing`}
        </span>
        <span className="text-mute">
          {off.length === 0
            ? "Every control agrees with the ledger"
            : `${count(off.length)} ${off.length === 1 ? "control is" : "controls are"} off`}
        </span>
      </div>

      <h2 className="mb-3 text-[1rem] font-medium text-ink">
        Before closing {name}
      </h2>
      <Card
        className="list-swap mb-8 divide-y divide-hairline"
        aria-busy={stale || undefined}
      >
        {checks.map((check) => (
          <div key={check.code} className="flex items-start gap-4 px-5 py-4">
            <CheckMark status={check.status} />
            <div className="min-w-0 flex-1">
              <div className="text-[0.9375rem] text-ink">{labelOf(check)}</div>
              <div className="mt-0.5 text-[0.9375rem] text-mute">
                {detailOf(check, byDomain)}
              </div>
            </div>
          </div>
        ))}
      </Card>

      <h2 className="mb-3 text-[1rem] font-medium text-ink">Cek pembukuan</h2>
      <div className="mb-8">
        <BookCheck asOf={checkDay(askedMonth, now)} />
      </div>

      <h2 className="mb-1 text-[1rem] font-medium text-ink">
        Ledger against subledgers
      </h2>
      {rows.length === 0 ? (
        <EmptyState>Nothing can be checked yet.</EmptyState>
      ) : phone ? (
        <PhoneList>
          {rows.map((row) => (
            <PhoneCard
              key={row.domain}
              title={DOMAIN_LABEL[row.domain] ?? row.label}
              line={row.covered ? undefined : "Not reconciled yet"}
              lead={
                !row.covered
                  ? "—"
                  : row.difference_minor === 0
                    ? "Agrees"
                    : money(row.difference_minor)
              }
              caption={
                row.covered && row.difference_minor !== 0
                  ? "difference"
                  : undefined
              }
              tone={row.covered && row.difference_minor !== 0 ? "bad" : "quiet"}
              foot={
                <>
                  <div className="tabular-nums">
                    Ledger {money(row.gl_minor)}
                    {row.covered &&
                      ` · Subledger ${money(row.subledger_minor)}`}
                  </div>
                  {row.unmatched > 0 && (
                    <div>
                      {count(row.unmatched)} open{" "}
                      {row.unmatched === 1 ? "item" : "items"}
                    </div>
                  )}
                </>
              }
            />
          ))}
        </PhoneList>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Area</Th>
              <Th align="right" width="11rem">
                Ledger
              </Th>
              <Th align="right" width="11rem">
                Subledger
              </Th>
              <Th align="right" width="11rem">
                Difference
              </Th>
              <Th align="right" width="7rem">
                Open items
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.domain}>
                <Td>
                  <span className="text-ink">
                    {DOMAIN_LABEL[row.domain] ?? row.label}
                  </span>
                  {!row.covered && (
                    <span className="block text-[0.9375rem] text-mute">
                      Not reconciled yet
                    </span>
                  )}
                </Td>
                <Td align="right">{money(row.gl_minor)}</Td>
                <Td align="right">
                  {row.covered ? money(row.subledger_minor) : "—"}
                </Td>
                <Td
                  align="right"
                  className={
                    row.covered && row.difference_minor !== 0
                      ? "font-medium text-bad-fg"
                      : "text-faint"
                  }
                >
                  {!row.covered
                    ? "—"
                    : row.difference_minor === 0
                      ? "·"
                      : money(row.difference_minor)}
                </Td>
                <Td align="right">
                  {row.unmatched === 0 ? (
                    <span className="text-faint">·</span>
                  ) : (
                    count(row.unmatched)
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
    </PageContent>
  )
}

/// The day the books are asked about: the last day of the month, or today when
/// the month is not over yet.
function checkDay(month: { year: number; month: number }, now: Date): string {
  const last = new Date(month.year, month.month, 0)
  return isoDay(last > now ? now : last)
}

/// The twelve months up to and including this one, newest first: the ones a
/// close is asked about.
function recentMonths(now: Date): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = []
  let year = now.getFullYear()
  let month = now.getMonth() + 1
  for (let i = 0; i < 12; i += 1) {
    out.push({ year, month })
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return out
}

type CheckStatus = "OK" | "BLOCKER" | "UNKNOWN"

const RANK: Record<string, number> = { BLOCKER: 0, UNKNOWN: 1, OK: 2 }

function CheckMark({ status }: { status: string }) {
  const tone =
    status === "OK"
      ? "bg-ok-bg text-ok-fg"
      : status === "BLOCKER"
        ? "bg-bad-bg text-bad-fg"
        : "bg-warn-bg text-warn-fg"
  const Icon = status === "OK" ? Check : status === "BLOCKER" ? X : CircleAlert
  return (
    <span
      className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${tone}`}
      aria-label={
        status === "OK"
          ? "Done"
          : status === "BLOCKER"
            ? "Blocks closing"
            : "Cannot be checked"
      }
    >
      <Icon className="size-3.5 stroke-[2.25]" />
    </span>
  )
}

function statusWord(status: string | undefined): string {
  switch (status) {
    case "OPEN":
      return "Open"
    case "SOFT_CLOSED":
      return "Closed for the shops"
    case "CLOSED":
      return "Closed"
    default:
      return status ?? "—"
  }
}

const DOMAIN_LABEL: Readonly<Record<string, string>> = {
  PREPAID: "Prepaid expenses",
  TAX_PAYABLE: "Tax payable",
  TAX_CREDIT: "Tax credit",
  ADVANCE: "Advances",
  FINANCING: "Loans",
  AP: "Total payables",
  INTERUNIT: "Between units",
  BANK: "Bank",
  FIXED_ASSET: "Fixed assets",
  PAYROLL: "Payroll payable",
  INVENTORY: "Inventory",
}

const CHECK_LABEL: Readonly<Record<string, string>> = {
  SALE_DAYS: "Every trading day is in the books",
  SALE_DAYS_STALE: "Posted days still match their sales",
  PREPAID: "Prepaid expenses spread for the month",
  ADVANCES: "Advances accounted for",
  FINANCING: "Loan instalments due this month paid",
  TAX: "Tax period filed",
  BALANCED: "Every journal balances",
  FINANCE_AUTOMATION: "Month-end runs are switched on",
  INTERUNIT_NETS: "Balances between units cancel out",
}

/// A check's name. Each control check is "this register agrees with the
/// ledger", said in the register's English name.
function labelOf(check: { code: string; label: string }): string {
  if (check.code.startsWith("CONTROL_")) {
    const domain = DOMAIN_LABEL[check.code.slice("CONTROL_".length)]
    if (domain !== undefined) return `Ledger check · ${domain}`
  }
  return CHECK_LABEL[check.code] ?? check.label
}

/// The line under a check, from its code and count — or, for a control check,
/// from the control row itself, so the figures are drawn as money.
function detailOf(
  check: {
    code: string
    status: CheckStatus | string
    detail: string
    count: number
  },
  byDomain: ReadonlyMap<
    string,
    {
      gl_minor: number
      subledger_minor: number
      difference_minor: number
      covered: boolean
    }
  >
): string {
  const n = check.count
  if (check.code.startsWith("CONTROL_")) {
    const row = byDomain.get(check.code.slice("CONTROL_".length))
    if (row === undefined) return check.detail
    if (!row.covered)
      return "Stock has no cost method yet, so its value cannot come from the warehouse."
    return row.difference_minor === 0
      ? "Ledger and subledger agree."
      : `Ledger ${money(row.gl_minor)} against subledger ${money(row.subledger_minor)} — off by ${money(row.difference_minor)}.`
  }
  switch (check.code) {
    case "SALE_DAYS":
      return n === 0
        ? "Nothing left to post."
        : `${count(n)} trading days not posted yet.`
    case "SALE_DAYS_STALE":
      return n === 0
        ? "No sale has reached a day after it was posted."
        : `${count(n)} ${n === 1 ? "day has" : "days have"} sales added after posting — reverse and post again from Sales Postings.`
    case "PREPAID":
      return n === 0
        ? "Nothing due this month."
        : `${count(n)} ${n === 1 ? "schedule waits" : "schedules wait"} for this month.`
    case "ADVANCES":
      return n === 0
        ? "Nothing outstanding."
        : `${count(n)} advances still with staff.`
    case "FINANCING":
      return n === 0
        ? "Nothing due."
        : `${count(n)} ${n === 1 ? "instalment is" : "instalments are"} due and unpaid.`
    case "TAX":
      return n === 0
        ? "Nothing left to file."
        : `${count(n)} tax periods not filed.`
    case "BALANCED":
      return n === 0
        ? "No journal is out of balance."
        : `${count(n)} journals do not balance.`
    case "FINANCE_AUTOMATION":
      return "Depreciation, prepaid spreading and amortisation post on their own."
    case "INTERUNIT_NETS":
      return "What one unit is owed, another owes — together they come to nil."
    default:
      return check.detail
  }
}
