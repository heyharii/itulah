import { ApiError } from "@itulah/contract/client"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { ChevronRight } from "lucide-react"
import QRCode from "qrcode"

import { Async, Empty, List, Panel, Row } from "@/screens/me/ui/bits"
import { Button } from "@/screens/me/ui/button"
import { dateTime, money } from "@/screens/me/data/format"
import { lockState } from "@/screens/me/data/payslip-lock"
import {
  useAnnualTax,
  useBenefit,
  useBenefitCode,
  useLoans,
  usePaySlips,
  usePayslipTemplate,
} from "@/screens/me/data/queries"
import { ChangePayslipPassword, PayslipGate } from "@/screens/me/payslip-gate"
import { codeGroups, secondsLeft } from "@/screens/me/data/benefit"
import type { AnnualTaxSlip, BenefitCodeView, LoanView } from "@itulah/contract"

/// What you were paid, month by month.
///
/// # The big number is take-home pay
///
/// Since 0800 the server works out PPh 21 and BPJS, so each month shows what
/// lands in the account. A month it could not work out says so instead of a
/// figure: a screen that showed the agreement under the word "net" would be a
/// screen somebody plans a month around.
export function Pay() {
  const slips = usePaySlips()
  const template = usePayslipTemplate()
  const lock = lockState(slips.error)
  if (lock !== null) return <PayslipGate state={lock} />

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Your pay">
        <Async query={slips} empty="No payslip has been released to you yet.">
          {(list) => (
            <div className="flex flex-col gap-3">
              <p className="text-meta text-body">
                Take-home pay each month, after PPh 21 and BPJS.
              </p>
              <List className="-mx-2">
                {list.map((slip) => (
                  <div key={slip.run_id}>
                    <Link
                      to={"/me/pay/slip" as string}
                      search={{ run: slip.run_id } as never}
                      className="flex items-center gap-3 rounded-inner px-2 py-1 transition-colors hover:bg-soft-2"
                    >
                      <div className="min-w-0">
                        <p className="num text-card-title font-semibold text-ink">
                          {slip.net_minor === null
                            ? "Not worked out yet"
                            : money(slip.net_minor)}
                        </p>
                        <p className="font-mono text-id text-mute">
                          {/* The run id carries the month, which is the only place
                          a period appears on this row — the slip itself has no
                          date range of its own. */}
                          {slip.run_id}
                        </p>
                      </div>
                      <ChevronRight className="ml-auto size-4 shrink-0 text-line-ico" />
                    </Link>
                  </div>
                ))}
              </List>
            </div>
          )}
        </Async>
      </Panel>
      <Benefit />
      <Loans />
      <AnnualTax />
      {template.data?.password_required === true && <ChangePayslipPassword />}
    </div>
  )
}

/// The employee benefit: a balance to spend at the till. The cashier is shown
/// a short-lived code; it works once. Hidden when this person has no benefit.
function Benefit() {
  const account = useBenefit()
  const ask = useBenefitCode()
  const error = account.error
  if (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404)
  )
    return null
  const refused =
    ask.error instanceof ApiError && ask.error.status === 409
      ? "The benefit is not available right now."
      : null
  return (
    <Panel title="Benefit">
      <Async query={account}>
        {(view) => (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-meta text-body">Your balance</p>
              <p className="num text-hero font-semibold text-ink">
                {money(view.balance_minor)}
              </p>
            </div>
            {ask.data !== undefined && refused === null ? (
              <Code
                key={ask.data.expires_at}
                code={ask.data}
                renewing={ask.isPending}
                onRenew={() => ask.mutate()}
              />
            ) : (
              <div>
                <Button
                  variant="primary"
                  disabled={ask.isPending}
                  onClick={() => ask.mutate()}
                >
                  {ask.isPending ? "Getting a code…" : "Show my code"}
                </Button>
              </div>
            )}
            {refused !== null && (
              <p role="alert" className="text-meta text-bad">
                {refused}
              </p>
            )}
            {ask.error !== null && refused === null && (
              <p role="alert" className="text-meta text-bad">
                {ask.error instanceof ApiError
                  ? ask.error.message
                  : "Could not reach the server."}
              </p>
            )}
            {view.entries.length > 0 && (
              <List className="-mx-2 px-2">
                {view.entries.slice(0, 10).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-baseline justify-between gap-3 text-cell"
                  >
                    <span className="min-w-0 text-body">
                      {dateTime(entry.at)} · {KIND[entry.kind] ?? entry.kind}
                    </span>
                    <span className="num font-medium text-ink">
                      {entry.delta_minor > 0
                        ? "+"
                        : entry.delta_minor < 0
                          ? "−"
                          : ""}
                      {money(Math.abs(entry.delta_minor))}
                    </span>
                  </div>
                ))}
              </List>
            )}
          </div>
        )}
      </Async>
    </Panel>
  )
}

const KIND: Readonly<Record<string, string>> = {
  ADD: "Added",
  REMOVE: "Taken off",
  RESET: "Reset",
  SPEND: "Spent",
  RETURN: "Returned",
}

/// The code as a QR for the till's scanner, the six digits beneath it for a
/// cashier who keys it in, and the time left.
function Code({
  code,
  renewing,
  onRenew,
}: {
  code: BenefitCodeView
  renewing: boolean
  onRenew: () => void
}) {
  // A tick that only re-renders; the time left is worked out from the clock.
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const left = secondsLeft(code.expires_at)
  return (
    <div className="flex flex-col items-center gap-2 rounded-inner bg-soft-2 px-4 py-4">
      {left > 0 ? (
        <>
          <CodeQr value={code.code} />
          <p className="num text-[2.25rem] font-semibold tracking-[0.12em] text-ink">
            {codeGroups(code.code)}
          </p>
          <p className="text-meta text-body">
            Good for {Math.floor(left / 60)}:
            {String(left % 60).padStart(2, "0")}
          </p>
          <p className="text-meta text-body">
            Show this to the cashier. It works once.
          </p>
        </>
      ) : (
        <>
          <p className="text-meta text-body">This code has run out.</p>
          <Button variant="primary" disabled={renewing} onClick={onRenew}>
            Show a new code
          </Button>
        </>
      )}
    </div>
  )
}

/// Bukti potong 1721-A1: the year's tax, as the form your employer files
/// lays it out — what you need for your own SPT Tahunan.
function AnnualTax() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const slip = useAnnualTax(year)
  return (
    <Panel title={`Tax for ${year} · 1721-A1`}>
      <div className="flex items-center gap-2">
        <Button variant="quiet" onClick={() => setYear(year - 1)}>
          {year - 1}
        </Button>
        <Button
          variant="quiet"
          disabled={year >= new Date().getFullYear()}
          onClick={() => setYear(year + 1)}
        >
          {year + 1}
        </Button>
      </div>
      <Async query={slip}>
        {(form) =>
          form === null ? (
            <Empty>Nothing was paid to you with tax in {year}.</Empty>
          ) : (
            <AnnualTaxRows form={form} />
          )
        }
      </Async>
    </Panel>
  )
}

function AnnualTaxRows({ form }: { form: AnnualTaxSlip }) {
  return (
    <div className="flex flex-col gap-2">
      {!form.settled && (
        <p className="rounded-inner bg-warn-bg px-3.5 py-2.5 text-[0.875rem] leading-relaxed text-warn-fg">
          The year so far. It is settled in December, or the month you leave.
        </p>
      )}
      <Row label="Months">
        {form.from_month}–{form.to_month}
      </Row>
      <Row label="Gross income">{money(form.gross_minor)}</Row>
      <Row label="Position expense">{money(form.biaya_jabatan_minor)}</Row>
      <Row label="JHT and JP you paid">{money(form.pension_minor)}</Row>
      <Row label="Net income">{money(form.net_minor)}</Row>
      <Row label={`PTKP (${form.ptkp ?? "—"})`}>{money(form.ptkp_minor)}</Row>
      <Row label="Taxable income">{money(form.taxable_income_minor)}</Row>
      <hr className="border-hairline" />
      <Row label="PPh 21 for the year">{money(form.tax_due_minor)}</Row>
      <Row label="PPh 21 withheld">{money(form.tax_withheld_minor)}</Row>
    </div>
  )
}

/// Your loans, as Talenta's: what you borrowed, what has come off your pay,
/// and what is still owed. Shown only when you have one.
function Loans() {
  const loans = useLoans()
  const rows = loans.data ?? []
  if (rows.length === 0) return null
  return (
    <Panel title="Your loans">
      <div className="flex flex-col gap-4">
        {rows.map((loan) => (
          <LoanRows key={loan.advance_id} loan={loan} />
        ))}
      </div>
    </Panel>
  )
}

function LoanRows({ loan }: { loan: LoanView }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-card-title font-semibold text-ink">{loan.purpose}</p>
      <Row label="Borrowed">{money(loan.amount_minor)}</Row>
      <Row label="Each month">{money(loan.instalment_minor)}</Row>
      <Row label="Repaid">{money(loan.repaid_minor)}</Row>
      <Row label="Still owed">{money(loan.outstanding_minor)}</Row>
      {loan.status === "APPROVED" && (
        <p className="text-[0.875rem] text-mute">
          Approved; nothing comes off your pay until it has been paid out to
          you.
        </p>
      )}
    </div>
  )
}

/// The code drawn as a QR. The digits are all it carries: a till scanner reads
/// it as if the cashier had typed them.
function CodeQr({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void QRCode.toString(value, { type: "svg", margin: 1, width: 192 }).then(
      (drawn) => {
        if (alive) setSvg(drawn)
      }
    )
    return () => {
      alive = false
    }
  }, [value])
  if (svg === null) return null
  return (
    <div
      role="img"
      aria-label={`QR code ${value}`}
      className="size-48 rounded-inner bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
