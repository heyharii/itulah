import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, label, moment, toneFor } from "@/lib/format"
import {
  closePeriod,
  financeAttention,
  financeKeys,
  listPeriods,
  openPeriod,
  periodChecklist,
} from "@/lib/queries/finance"
import type { PeriodChecklist } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { Grid, Note, Td, Th } from "@/screens/finance-final/parts"
import { usePostingReadiness } from "@/screens/finance/badges"
import { monthLabel } from "@/screens/finance/chart"

/// What each month is still waiting for, and the door that shuts it.
///
/// # Which of ERPNext's two doors this is
///
/// ERPNext has two things people call "closing a month" and they are not
/// variants of each other, so this screen has to say which one it is before it
/// says anything else.
///
/// A **Period Closing Voucher** is an *entry*. It sweeps every income and
/// expense account into a closing equity head — once per accounting-dimension
/// tuple, so retained earnings there accumulate per cost centre — and, in
/// ERPNext's code rather than its docs, it is also the hard gate:
/// `gl_entry.validate_against_pcv` refuses any posting dated on or before the
/// last voucher's `period_end_date`, and refuses opening entries once one
/// exists at all. An **Accounting Period** is a *record*: a date range with a
/// list of document types on it and a role that is exempt from it. It posts
/// nothing, it can be set per doctype, and it can be argued with.
///
/// Ours is a door and only a door, and it is stricter and narrower than either.
/// `POST /finance/periods/close` flips one month's `fiscal_period.status` to
/// `CLOSED` and nothing else; the gate is a `BEFORE INSERT` trigger on
/// `journal_entry` which refuses every entry whose posting date falls in a
/// month that is closed — or in a month nobody has opened. There is no
/// per-doctype list and no exempted role, so it is harder than an Accounting
/// Period. It posts nothing, so it is not a Period Closing Voucher. And it
/// gates the entry's OWN month rather than everything up to a date, so sealing
/// September does not seal August: an entry dated in August still posts while
/// August is open. That last difference is the one most likely to surprise
/// somebody who has used ERPNext, which is why it is on the screen and not only
/// in this comment.
///
/// # Why there is no per-unit close
///
/// Because a month belongs to the book and the unit is a dimension on the rows
/// inside it. ERPNext can close per unit only because its sweep is written once
/// per dimension tuple, which needs cost centres — a thing this project has
/// deliberately refused. `journal_line.unit_id` is not null on every posting, so
/// every report here can be read per unit without the book ever having been
/// split into fourteen books.
///
/// # Summary rows and the close verdict
///
/// `GET /finance/attention` supplies two standing summary rows and the
/// sidebar badge. It is not the close verdict. The blocking result comes from
/// `GET /finance/periods/{id}/checklist`, the same check the close endpoint
/// runs, so the screen cannot enable a close the cloud would refuse.
export function PeriodClose() {
  const client = useQueryClient()
  // The month is in the URL — "seal 2026-08" is a thing people send each other
  // — and it is the only month state on the screen. Two selectors, one in the
  // address bar and one in a toolbar, is how a screen comes to close a
  // different month from the one somebody was reading.
  const focus = useSheet("period")
  const [confirming, setConfirming] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    // `.rows`, because that is the shape every other reader of this key holds
    // — `useWindow` in the finance module filters it as an array. The envelope
    // is unwrapped once, here, rather than each consumer guessing.
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
  })

  const rows = useMemo(() => periods.data ?? [], [periods.data])

  // The month the books are actually being worked in: the most recent one
  // somebody opened and has not sealed. On the third of September an accountant
  // is usually still in August, and the calendar is the wrong guess.
  const fallback = useMemo(() => {
    const open = rows
      .filter((row) => row.status.toUpperCase() === "OPEN")
      .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0]
    const now = new Date()
    return open === undefined
      ? { year: now.getFullYear(), month: now.getMonth() + 1 }
      : { year: open.year, month: open.month }
  }, [rows])

  const chosen = parseId(focus.value) ?? fallback
  const { year, month } = chosen
  const period = rows.find((row) => row.year === year && row.month === month)
  const isOpen = period?.status.toUpperCase() === "OPEN"

  const attention = useQuery({
    queryKey: financeKeys.attention(year, month),
    queryFn: ({ signal }) => financeAttention(year, month, signal),
  })
  // The gaps the Posting readiness screen shows, and not the attention
  // endpoint's older pair count — the line below links there, and the two
  // must agree.
  const postingGaps = usePostingReadiness()
  const closeChecks = useQuery({
    queryKey: financeKeys.closeChecklist(period ? periodId(year, month) : null),
    queryFn: ({ signal }) => periodChecklist(periodId(year, month), signal),
    enabled: period !== undefined,
  })

  const open = useMutation({
    mutationFn: () => openPeriod(year, month),
    onSuccess: (page) => {
      // The server answers a write with the whole list precisely so the screen
      // never has to guess what changed — but it answers with the ENVELOPE, and
      // this key holds the rows. Writing the envelope in would replace an array
      // with an object under everybody else's feet.
      client.setQueryData(financeKeys.periods(), page.rows)
      client.invalidateQueries({ queryKey: financeKeys.attention(year, month) })
      client.invalidateQueries({
        queryKey: financeKeys.closeChecklist(periodId(year, month)),
      })
      setReceipt(`${monthLabel(year, month)} is open for posting.`)
    },
  })

  const seal = useMutation({
    mutationFn: () => closePeriod(year, month),
    onSuccess: (done) => {
      setConfirming(false)
      setReceipt(
        `${monthLabel(year, month)} is sealed. ${count(done.entries_sealed)} ${
          done.entries_sealed === 1 ? "entry is" : "entries are"
        } now beyond change; corrections go into an open month.`
      )
      // Sealing moves no figure — it only stops new ones being written — so the
      // calendar and the badge are the only stale reads.
      client.invalidateQueries({ queryKey: financeKeys.periods() })
      client.invalidateQueries({ queryKey: financeKeys.attention(year, month) })
      client.invalidateQueries({
        queryKey: financeKeys.closeChecklist(periodId(year, month)),
      })
    },
  })

  // Use the same verdict the close endpoint enforces. Attention is a sidebar
  // summary and does not include every condition a period close checks.
  const clear = closeChecks.data?.may_close === true
  const mayClose = isOpen && clear && !seal.isPending

  const now = new Date()

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Accounting"
        title="Period Close"
        sub="Sealing a month refuses every posting dated inside it, for good. It moves no figure, it sweeps nothing into equity, and there is no reopen."
      />

      <Toolbar>
        {/* Wrapped, both of them: `<Select>` draws a `w-full` span around the
            native control, and in a wrapping toolbar that claims the whole row
            — which is how two selects end up on two lines with their chevrons
            out at the edge of the page. */}
        <span className="inline-flex w-40 shrink-0">
          <Select
            value={String(month)}
            onChange={(next) => focus.open(periodId(year, Number(next)))}
            aria-label="Month"
            className="h-8 w-40"
          >
            {MONTHS.map((value) => (
              <option key={value} value={value}>
                {monthLabel(year, value)}
              </option>
            ))}
          </Select>
        </span>
        <span className="inline-flex w-28 shrink-0">
          <Select
            value={String(year)}
            onChange={(next) => focus.open(periodId(Number(next), month))}
            aria-label="Year"
            className="h-8 w-28"
          >
            {Array.from(
              { length: 5 },
              (_, index) => now.getFullYear() - 2 + index
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </span>
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(
            rows.filter((row) => row.status.toUpperCase() === "OPEN").length
          )}{" "}
          months open · {count(rows.length)} on the calendar
        </span>
      </Toolbar>

      {receipt && (
        <Banner tone="ok" className="mb-3" onDismiss={() => setReceipt(null)}>
          {receipt}
        </Banner>
      )}
      {open.isError && (
        <Banner tone="bad" className="mb-3">
          {open.error instanceof Error
            ? open.error.message
            : "The month could not be opened."}
        </Banner>
      )}
      {seal.isError && (
        <Banner tone="bad" className="mb-3">
          {seal.error instanceof Error
            ? seal.error.message
            : "The month could not be sealed."}
        </Banner>
      )}

      <div className="flex flex-col gap-5">
        {/* ------------------------------------------------------------------
            The month in hand: what it is waiting for, and the door.
            ------------------------------------------------------------------ */}
        <section className="rounded-card border border-hairline">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-hairline px-3.5 py-3">
            <h2 className="text-card-title font-semibold text-ink">
              {monthLabel(year, month)}
            </h2>
            {period === undefined ? (
              <Pill tone="warn">never opened</Pill>
            ) : (
              <Pill tone={toneFor(period.status)}>{label(period.status)}</Pill>
            )}
            {period !== undefined && (
              <span className="text-[0.875rem] text-mute">
                {count(period.entry_count)}{" "}
                {period.entry_count === 1 ? "entry" : "entries"} posted
              </span>
            )}
            {period?.closed_at != null && (
              <span className="text-[0.875rem] text-mute">
                sealed by {period.closed_by ?? "—"} · {moment(period.closed_at)}
              </span>
            )}
          </div>

          {period === undefined ? (
            <div className="px-3.5 py-4">
              <p className="mb-3 text-[0.875rem] text-body">
                No accounting period exists for {monthLabel(year, month)}, so
                nothing can be posted into it at all — the database refuses the
                entry and names the month. That refusal is the same trigger the
                close uses, which is why an unopened month and a sealed month
                fail identically from a caller&rsquo;s side.
              </p>
              <Button
                variant="primary"
                pending={open.isPending}
                onClick={() => open.mutate()}
              >
                {open.isPending
                  ? "Opening…"
                  : `Open ${monthLabel(year, month)} for posting`}
              </Button>
            </div>
          ) : (
            <>
              <Checklist
                answer={attention.data}
                pending={attention.isPending}
                gaps={postingGaps.data?.gaps ?? null}
                readiness={closeChecks.data}
                year={year}
                month={month}
                isOpen={isOpen}
              />

              {closeChecks.data !== undefined &&
                !closeChecks.data.may_close && (
                  <Banner tone="warn" className="mx-3.5 mt-2">
                    Sealing is blocked by:{" "}
                    {closeChecks.data.blocked_by.join(", ")}.
                  </Banner>
                )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-3.5 py-3">
                {!isOpen ? (
                  <p className="text-[0.875rem] text-body">
                    This month is sealed. There is no reopen and there is no
                    endpoint for one — a correction is posted into an open
                    month, the way a wrong entry is answered by its mirror
                    rather than edited away.
                  </p>
                ) : confirming ? (
                  <>
                    <p className="min-w-0 flex-1 text-[0.875rem] text-body">
                      Seal {count(period.entry_count)}{" "}
                      {period.entry_count === 1 ? "entry" : "entries"} in{" "}
                      {monthLabel(year, month)}? Nothing can be posted into this
                      month again, by anyone, from any screen. A close and a
                      posting cannot interleave — the trigger reads the period
                      row <code>FOR SHARE</code> — so the number above is the
                      number that will be sealed.
                    </p>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="quiet"
                        onClick={() => setConfirming(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        pending={seal.isPending}
                        onClick={() => seal.mutate()}
                      >
                        {seal.isPending ? "Sealing…" : "Seal this month"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 text-[0.875rem] text-body">
                      {clear
                        ? "The server has nothing outstanding. Sealing is irreversible."
                        : "The cloud's close checklist still has an unresolved or unassessed item. Resolve it before sealing the month."}
                    </p>
                    <Button
                      variant="danger"
                      disabled={!mayClose}
                      onClick={() => setConfirming(true)}
                    >
                      Close {monthLabel(year, month)}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        {/* ------------------------------------------------------------------
            The calendar. Every month the books have, so the one in hand can be
            read against its neighbours — a September that is clear beside an
            August that was never opened is a September nobody should seal yet.
            ------------------------------------------------------------------ */}
        {queryState(periods, {
          loading: "Reading which months the books are kept in…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No month has been opened yet, so nothing can be posted anywhere.
                Open the current one to start the books.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="14rem">Month</Th>
                    <Th width="9rem">Status</Th>
                    <Th align="right" width="8rem">
                      Entries
                    </Th>
                    <Th width="11rem">Sealed by</Th>
                    <Th>Sealed at</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort(
                      (a, b) => b.year * 12 + b.month - (a.year * 12 + a.month)
                    )
                    .map((row) => (
                      <tr
                        key={periodId(row.year, row.month)}
                        className={
                          row.year === year && row.month === month
                            ? "bg-soft"
                            : undefined
                        }
                      >
                        <Td>
                          <button
                            type="button"
                            onClick={() =>
                              focus.open(periodId(row.year, row.month))
                            }
                            className="font-medium text-accent hover:underline"
                          >
                            {monthLabel(row.year, row.month)}
                          </button>
                        </Td>
                        <Td>
                          <Pill tone={toneFor(row.status)}>
                            {label(row.status)}
                          </Pill>
                        </Td>
                        {/* A zero is drawn as a zero: a month standing open
                            with nothing in it is a month nobody has worked, and
                            that is different news from a month that balanced. */}
                        <Td
                          align="right"
                          className={
                            row.entry_count === 0 ? "text-mute" : "text-ink"
                          }
                        >
                          {count(row.entry_count)}
                        </Td>
                        <Td className="text-body">{row.closed_by ?? "—"}</Td>
                        <Td className="text-body">{moment(row.closed_at)}</Td>
                      </tr>
                    ))}
                </tbody>
              </Grid>
            ),
        })}

        <Note>
          <b>Which door this is.</b> ERPNext splits month-end in two, and only
          one half exists here. A <b>Period Closing Voucher</b> there is an
          entry: it sweeps income and expense into a closing equity head — once
          per accounting-dimension tuple — and it is also the hard gate, because
          <code> validate_against_pcv</code> refuses any posting dated on or
          before the last voucher&rsquo;s period end. An{" "}
          <b>Accounting Period</b> there is a record with a list of document
          types and an exempted role, and it posts nothing.
          <br />
          <br />
          Ours is the gate alone, and it is both harder and narrower than either
          of them. Closing writes no entry, so income and expense are never
          zeroed and Profit &amp; Loss here must always be read over a window
          rather than off a closing balance. There is no per-doctype list and no
          exempted role, so nothing gets through. And the trigger gates the
          entry&rsquo;s <b>own month</b>, not every date up to a line: sealing{" "}
          {monthLabel(year, month)} does not seal the months before it, so an
          entry dated in an earlier month that is still open will still post.
          Seal them in order, or the calendar above has holes in it.
        </Note>
      </div>
    </PageContent>
  )
}

/// What the month is waiting for, in the node's own words.
///
/// # Why three rows and not ERPNext's six
///
/// ERPNext's own prerequisite list is: reconcile bank, payments, stock, tax,
/// depreciation and accruals, then review the statements. Three of those have
/// an answer on this node and three do not, and the difference is drawn rather
/// than smoothed over — a checklist with a row nothing populates is a tick
/// somebody eventually learns to give themselves.
///
/// # Why two of the three are marked "standing"
///
/// Because `GET /finance/attention` takes a year and a month and uses them for
/// exactly one of its three counts. `month_not_open` is about the month asked
/// for; `overdue_bills` and the posting gaps are counted over the whole ledger
/// as it stands today. That is right for the sidebar badge it was built for and
/// it is a trap here, where every other figure on the screen is about one
/// month. So the two say so on their face. They still gate the close, because
/// an unmapped posting rule or an unpaid overdue bill is a reason not to seal
/// anything at all — but nobody should read them as "in September".
function Checklist({
  answer,
  pending,
  gaps,
  readiness,
  year,
  month,
  isOpen,
}: {
  answer:
    | {
        readonly overdue_bills: number
        readonly unmapped_pairs: number
        readonly month_not_open: number
        readonly attention: number
      }
    | undefined
  pending: boolean
  /// (role, source, site) combinations that resolve to no account.
  gaps: number | null
  readiness: PeriodChecklist | undefined
  year: number
  month: number
  isOpen: boolean
}) {
  const depreciation = readiness?.checks.find(
    (check) => check.key === "assets.depreciation"
  )
  const depreciationState =
    depreciation === undefined
      ? "pending"
      : depreciation.outcome.state === "PASS"
        ? "ok"
        : depreciation.outcome.state === "PENDING" ||
            depreciation.outcome.state === "BLOCKED"
          ? "pending"
          : "todo"
  const depreciationNote =
    depreciation === undefined
      ? "Reading the cloud's asset close check…"
      : depreciation.outcome.state === "PASS"
        ? "Every asset due this month has a posted depreciation entry."
        : depreciation.outcome.state === "FAIL"
          ? `${count(depreciation.outcome.count)} assets still need a charge: ${depreciation.outcome.where
              .slice(0, 3)
              .map((pointer) => pointer.label)
              .join(", ")}${depreciation.outcome.where.length > 3 ? "…" : ""}.`
          : depreciation.outcome.reason

  return (
    <div>
      <div className="border-b border-hairline px-3.5 py-2 text-[0.875rem] font-medium text-mute">
        Before sealing {monthLabel(year, month)}
      </div>

      <Line
        title="The month is open for posting"
        state={
          pending || answer === undefined
            ? "pending"
            : answer.month_not_open === 0
              ? "ok"
              : "todo"
        }
        note={
          pending || answer === undefined
            ? "Asking the node what this month is waiting for…"
            : answer.month_not_open === 0
              ? isOpen
                ? "Postings dated in this month are being accepted. Sealing is what stops them."
                : "This month is sealed. Nothing dated inside it can be posted."
              : "No period exists for this month, so every posting dated inside it is already refused — by the same trigger the close uses."
        }
        scope="this month"
        action={null}
      />

      <Line
        title="Every posting rule has an account"
        state={gaps === null ? "pending" : gaps === 0 ? "ok" : "todo"}
        note={
          gaps === null
            ? "Reading the account links…"
            : gaps === 0
              ? "Every role the posting rules ask for resolves to an account, at every unit."
              : `${count(gaps)} role-and-unit combinations have no account behind them. Every posting that needs one is refused outright, so a month closed over this is a month with entries missing rather than entries wrong.`
        }
        scope="standing, not this month"
        action={
          <AppLink
            to="/finance/setup/posting-readiness"
            variant="quiet"
            size="sm"
          >
            Posting readiness
          </AppLink>
        }
      />

      <Line
        title="No bill is overdue and still unposted"
        state={
          pending || answer === undefined
            ? "pending"
            : answer.overdue_bills === 0
              ? "ok"
              : "todo"
        }
        note={
          pending || answer === undefined
            ? "Counting the bills…"
            : answer.overdue_bills === 0
              ? "Nothing invoiced is past its next instalment date without being in the books."
              : `${count(answer.overdue_bills)} bills are past a due instalment and not posted. The count is on the instalment that falls next, not on the single date printed on the paper — a bill whose first instalment is settled and whose balance falls next month is not late.`
        }
        scope="standing, not this month"
        action={
          <AppLink to="/finance-final/payable" variant="quiet" size="sm">
            Accounts payable
          </AppLink>
        }
      />

      <Line
        title="Asset depreciation charged"
        state={depreciationState}
        note={depreciationNote}
        scope="this month"
        action={
          <AppLink to="/finance/assets" variant="quiet" size="sm">
            Assets
          </AppLink>
        }
      />

      <div className="border-t border-hairline bg-soft px-3.5 py-2.5 text-[0.875rem] leading-relaxed text-body">
        The close button uses the cloud&rsquo;s full checklist, including asset
        depreciation. A check the node cannot evaluate remains pending and
        prevents the month from being sealed.
      </div>
    </div>
  )
}

/// One line of the checklist.
///
/// `pending` never renders as `ok`. "We have not asked yet" and "there is
/// nothing to do" are the two answers a month-end panel must never confuse, and
/// they are one optimistic default apart.
function Line({
  title,
  state,
  note,
  scope,
  action,
}: {
  title: React.ReactNode
  state: "ok" | "todo" | "pending"
  note: React.ReactNode
  /// Whether the figure is about the month on screen. Drawn because two of the
  /// three are not, and a reader who assumes they are will seal a month over a
  /// problem that belongs to a different one — or refuse to seal a clean month
  /// because of a bill raised last week.
  scope: string
  action: React.ReactNode
}) {
  const pill = {
    ok: { tone: "ok" as const, text: "Clear" },
    todo: { tone: "warn" as const, text: "Outstanding" },
    pending: { tone: "neutral" as const, text: "Asking…" },
  }[state]

  return (
    <div className="flex items-start gap-2.5 border-b border-hairline px-3.5 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[0.875rem] font-medium text-ink">{title}</span>
          <Pill tone={pill.tone}>{pill.text}</Pill>
          <span className="text-[0.875rem] text-mute">{scope}</span>
        </span>
        <span className="mt-0.5 block text-[0.875rem] leading-relaxed text-body">
          {note}
        </span>
      </span>
      {action !== null && <span className="shrink-0 pt-0.5">{action}</span>}
    </div>
  )
}

const MONTHS: readonly number[] = Array.from(
  { length: 12 },
  (_, index) => index + 1
)

/// `2026-09` — what the URL carries, and what a month is addressed by.
function periodId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/// The other direction, and defensively: the sheet registry only checks that
/// the parameter is a non-empty string, so a hand-edited address can put
/// anything here. A month that does not parse falls back to the one the books
/// are being worked in rather than opening the screen onto `NaN`.
function parseId(
  raw: string | undefined
): { year: number; month: number } | null {
  if (raw === undefined) return null
  const match = /^(\d{4})-(\d{2})$/.exec(raw)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}
