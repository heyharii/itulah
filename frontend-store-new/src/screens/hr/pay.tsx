import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react"
import { useMemo, useState } from "react"

import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import {
  adjustmentsQuery,
  fileAdjustment,
  payComponentsQuery,
  withdrawAdjustment,
  type StoreScope,
} from "@/lib/queries/hr"
import { batchSent, payMonths, usableComponents } from "@/lib/queries/payroll"
import { describeCentre } from "@/screens/hr/centre"
import { useRp } from "@/screens/hr/rp/context"
import { initials, monthLabel } from "@/screens/hr/rp/dates"
import { RpFrame, RpSheet, SheetHead } from "@/screens/hr/rp/kit"
import { teamRows, useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { PayrollAdjustmentRow } from "@itulah/contract"

/// Payroll — the hub's Payroll page (`frontend-hub/src/screens/people/rp/
/// payroll-page.tsx`, route `/people/payroll`) for one shop: the title row with
/// the month stepper, a person a row with what is added to their month in one
/// column and what is taken off in the next, and the one figure on the right;
/// a row opens a sheet of those lines with a × on each line the shop may still
/// take back, and "Add adjustment" files a new one.
///
/// # What a shop can feed here
///
/// The hub's rows are payslips — base pay, overtime, BPJS, PPh 21, take-home —
/// and the runs behind them. Those are head office's and the relay carries
/// none of them (`domain/relay.rs`: no payroll but the place's own one-off
/// figures), so the lines here are only what **this shop filed** into the
/// month's batch: an incentive, a commission, a shortage. The figure on the
/// right is those lines' net, not anybody's pay, and there is no Calculate,
/// no Approve & send to Finance, no Rates, no total net pay.
///
/// # Filed by the place, decided by head office
///
/// A figure is frozen the moment the place files it and can be taken back only
/// while the batch is still the place's: `withdrawable` says which side of
/// that line a row is on. Once any figure of the month is past it the month
/// has gone to head office, and a change goes into next month.
export function HrPay() {
  return (
    <HrWorkspace header={false}>
      {(scope) => (
        <RpFrame>
          <Body scope={scope} />
        </RpFrame>
      )}
    </HrWorkspace>
  )
}

/// Everything this module caches about the filed list, whichever month it was
/// read for.
const ADJUSTMENTS = [CENTRAL_KEY_PREFIX, "hr", "adjustments"] as const

/// The two components the centre files ITSELF (a loan's instalment, paid-out
/// leave): they are not the shop's adjustments and not the shop's to take back.
const FILED_BY_THE_CENTRE = new Set(["CICILAN_PINJAMAN", "UANG_CUTI"])

const num2 = (n: number) => Math.round(n).toLocaleString("id-ID")
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${num2(Math.abs(n))}`
const signed = (n: number) => `${n < 0 ? "−" : "+"}Rp ${num2(Math.abs(n))}`

const isDeduction = (row: PayrollAdjustmentRow) => row.kind === "DEDUCTION"
const sumOf = (list: readonly PayrollAdjustmentRow[]) =>
  list.reduce((n, row) => n + row.amount_minor, 0)

/// One person's month: what the shop added, and what it took off.
interface Person {
  readonly id: string
  readonly name: string
  readonly code: string
  readonly earn: readonly PayrollAdjustmentRow[]
  readonly ded: readonly PayrollAdjustmentRow[]
  readonly net: number
}

interface Form {
  readonly kind: "EARNING" | "DEDUCTION"
  readonly emp: string
  readonly code: string
  readonly amt: string
  readonly note: string
}

interface Sheet {
  /// Whose month is open; `null` for the form that asks who.
  readonly emp: string | null
  readonly form: Form | null
}

/// One person's month from the filed rows.
function build(
  id: string,
  name: string,
  code: string,
  rows: readonly PayrollAdjustmentRow[],
): Person {
  const mine = rows.filter((row) => row.employee_id === id)
  const earn = mine.filter((row) => !isDeduction(row))
  const ded = mine.filter(isDeduction)
  return { id, name, code, earn, ded, net: sumOf(earn) - sumOf(ded) }
}

function Body({ scope }: { scope: StoreScope }) {
  const { toast } = useRp()
  const client = useQueryClient()
  const unitId = scope.unit_id

  const [today] = useState(() => new Date())
  const months = payMonths(today)
  const [month, setMonth] = useState(months[months.length - 1] ?? "")
  const at = months.indexOf(month)
  const [filter, setFilter] = useState<"all" | "filed">("all")
  const [sheet, setSheet] = useState<Sheet | null>(null)

  const team = useTeam(scope)
  const adjustments = useQuery(adjustmentsQuery(unitId, month))
  const components = useQuery(payComponentsQuery())

  const filed = useMemo(
    () =>
      (adjustments.data ?? []).filter(
        (row) =>
          row.filed_by !== "system" &&
          !FILED_BY_THE_CENTRE.has(row.component_code),
      ),
    [adjustments.data],
  )
  // The month has gone to head office once a figure in it can no longer be
  // taken back.
  const sent = adjustments.isSuccess && batchSent(adjustments.data)

  // Everybody on this shop's books, and anybody the month's rows name who is
  // not — somebody who has left still has the month they worked.
  const people = useMemo<Person[]>(() => {
    const byId = new Map<string, Person>()
    const add = (id: string, name: string, code: string) => {
      if (!byId.has(id)) byId.set(id, build(id, name, code, filed))
    }
    for (const p of teamRows(team.data))
      if (p.status === "ACTIVE")
        add(p.employee_id, p.full_name ?? p.employee_code, p.employee_code)
    for (const row of filed)
      add(
        row.employee_id,
        row.full_name ?? row.employee_code,
        row.employee_code,
      )
    return [...byId.values()]
  }, [team.data, filed])
  const hasLines = (p: Person) => p.earn.length + p.ded.length > 0
  const shown = people.filter((p) => filter === "all" || hasLines(p))
  const total = people.reduce((n, p) => n + p.net, 0)

  const open = people.find((p) => p.id === sheet?.emp) ?? null
  const form = sheet?.form ?? null
  const closeSheet = () => setSheet(null)
  const edit = (patch: Partial<Form>) => {
    if (sheet !== null && form !== null)
      setSheet({ emp: sheet.emp, form: { ...form, ...patch } })
  }

  const add = useMutation({
    mutationFn: (input: Form) =>
      fileAdjustment({
        place: unitId,
        period: month,
        employeeId: input.emp,
        componentCode: input.code,
        amountMinor: Number(input.amt.replace(/\D/g, "")),
        reason: input.note.trim() || "Added in payroll",
      }),
    onSuccess: (_rows, input) => {
      void client.invalidateQueries({ queryKey: ADJUSTMENTS })
      toast("Adjustment added")
      // Back to the person it was filed for.
      setSheet({ emp: input.emp, form: null })
    },
    onError: (e: Error) => toast(describeCentre(e)),
  })
  const drop = useMutation({
    mutationFn: (row: PayrollAdjustmentRow) =>
      withdrawAdjustment({ id: row.id, reason: "Taken back in payroll" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADJUSTMENTS })
      toast("Adjustment removed")
    },
    onError: (e: Error) => toast(describeCentre(e)),
  })

  const picks = (kind: Form["kind"]) =>
    usableComponents(components.data ?? [], kind === "DEDUCTION" ? -1 : 1)
  const blank = (emp: string): Form => ({
    kind: "EARNING",
    emp,
    code: "",
    amt: "",
    note: "",
  })

  const lines = (list: readonly PayrollAdjustmentRow[], sign: string) => (
    <div className="stk">
      {list.map((row) => (
        <div key={row.id} className="ln">
          <span>{row.label}</span>
          <span className="num">
            {sign}
            {num2(row.amount_minor)}
          </span>
        </div>
      ))}
    </div>
  )
  const netCell = (p: Person) =>
    hasLines(p) ? <b>{signed(p.net)}</b> : <span className="mute">·</span>

  return (
    <div style={{ position: "relative" }}>
      <div className="head">
        <h1>Payroll</h1>
        <span className="desk-only grow" />
        <div className="step">
          <button
            type="button"
            className="icbtn"
            aria-label="Previous month"
            disabled={at <= 0}
            onClick={() => setMonth(months[at - 1] ?? month)}
          >
            <ChevronLeft className="lucide" />
          </button>
          <span className="lbl">{monthLabel(month)}</span>
          <button
            type="button"
            className="icbtn"
            aria-label="Next month"
            disabled={at < 0 || at >= months.length - 1}
            onClick={() => setMonth(months[at + 1] ?? month)}
          >
            <ChevronRight className="lucide" />
          </button>
        </div>
        {filed.length > 0 && (
          <span className="hdtot desk-only">
            <span className="l">Net adjustments</span>
            <b className="num">{signed(total)}</b>
          </span>
        )}
        <button
          type="button"
          className="btn publish"
          disabled={sent || adjustments.isPending}
          title={
            sent
              ? "This month has gone to head office — a change goes into next month"
              : undefined
          }
          onClick={() => setSheet({ emp: null, form: blank("") })}
        >
          <Plus className="lucide" />
          Add adjustment
        </button>
      </div>

      {sent && (
        <p className="anote">
          Sent to head office. A change to {monthLabel(month)} goes into next
          month.
        </p>
      )}

      {adjustments.isError ? (
        <p className="empty-note bad">
          {describeCentre(adjustments.error, "this shop's adjustments")}
        </p>
      ) : adjustments.isPending || team.isPending ? (
        <p className="empty-note">Reading the adjustments…</p>
      ) : people.length === 0 ? (
        <p className="empty-note">Nobody is posted here.</p>
      ) : (
        <>
          <div className="afilters">
            <div className="seg">
              <button
                type="button"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All <span className="cn num">{people.length}</span>
              </button>
              <button
                type="button"
                aria-pressed={filter === "filed"}
                onClick={() => setFilter("filed")}
              >
                With adjustments{" "}
                <span className="cn num">{people.filter(hasLines).length}</span>
              </button>
            </div>
          </div>

          <div className="card desk">
            <table className="rgrid pay stack">
              <colgroup>
                <col className="who" />
                <col style={{ width: "28%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "16%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Earnings</th>
                  <th>Deductions</th>
                  <th className="pn2 sep">Adjustments</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr
                    key={p.id}
                    className="click stackrow"
                    onClick={() => setSheet({ emp: p.id, form: null })}
                  >
                    <td className="who">
                      <div className="person">
                        <div className="av">{initials(p.name)}</div>
                        <div className="who2">
                          <span className="n">{p.name}</span>
                          <span className="r">{p.code}</span>
                        </div>
                      </div>
                    </td>
                    <td className="stc">
                      {lines(p.earn, "")}
                      {p.earn.length > 1 && (
                        <div className="ln tt">
                          <span>Total</span>
                          <span className="num">{num2(sumOf(p.earn))}</span>
                        </div>
                      )}
                    </td>
                    <td className="stc">
                      {lines(p.ded, "−")}
                      {p.ded.length > 1 && (
                        <div className="ln tt">
                          <span>Total</span>
                          <span className="num">−{num2(sumOf(p.ded))}</span>
                        </div>
                      )}
                    </td>
                    <td className="pn2 num net sep">{netCell(p)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    Total · {shown.length}{" "}
                    {shown.length === 1 ? "person" : "people"}
                  </td>
                  <td className="stc num">
                    {num2(shown.reduce((n, p) => n + sumOf(p.earn), 0))}
                  </td>
                  <td className="stc num">
                    −{num2(shown.reduce((n, p) => n + sumOf(p.ded), 0))}
                  </td>
                  <td className="pn2 num net sep">
                    <b>{signed(shown.reduce((n, p) => n + p.net, 0))}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="plist">
            {shown.map((p) => {
              const count = p.earn.length + p.ded.length
              return (
                <button
                  key={p.id}
                  type="button"
                  className="prow person"
                  onClick={() => setSheet({ emp: p.id, form: null })}
                >
                  <div className="av">{initials(p.name)}</div>
                  <div className="who2">
                    <span className="n">{p.name}</span>
                    <span className="r">
                      {count === 0
                        ? p.code
                        : `${count} ${count === 1 ? "line" : "lines"}`}
                    </span>
                  </div>
                  <span className="rt num">{netCell(p)}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      <RpSheet open={sheet !== null} onClose={closeSheet}>
        {sheet !== null && form !== null && (
          <>
            <SheetHead
              title="Add adjustment"
              sub={`${open?.name ?? "New"} · ${monthLabel(month)}`}
              back={
                sheet.emp === null
                  ? undefined
                  : () => setSheet({ emp: sheet.emp, form: null })
              }
              onClose={closeSheet}
            />
            <div className="sbody form roomy">
              <div className="sform">
                {sheet.emp === null && (
                  <div className="fld">
                    <label htmlFor="adjWho">Who</label>
                    <select
                      id="adjWho"
                      className="pick"
                      value={form.emp}
                      onChange={(e) => edit({ emp: e.target.value })}
                    >
                      <option value="">Pick a person</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="fld">
                  <label>Type</label>
                  <div className="seg" style={{ alignSelf: "flex-start" }}>
                    <button
                      type="button"
                      aria-pressed={form.kind === "EARNING"}
                      onClick={() => edit({ kind: "EARNING", code: "" })}
                    >
                      Earning
                    </button>
                    <button
                      type="button"
                      aria-pressed={form.kind === "DEDUCTION"}
                      onClick={() => edit({ kind: "DEDUCTION", code: "" })}
                    >
                      Deduction
                    </button>
                  </div>
                </div>
                <div className="fld">
                  <label htmlFor="adjCode">What for</label>
                  <select
                    id="adjCode"
                    className="pick"
                    value={form.code}
                    onChange={(e) => edit({ code: e.target.value })}
                  >
                    <option value="">Pick one</option>
                    {picks(form.kind).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="fld">
                  <label htmlFor="adjAmt">Amount</label>
                  <input
                    id="adjAmt"
                    inputMode="numeric"
                    placeholder="Rp"
                    value={form.amt}
                    onChange={(e) =>
                      edit({ amt: e.target.value.replace(/\D/g, "") })
                    }
                  />
                </div>
                <div className="fld">
                  <label htmlFor="adjNote">Why</label>
                  <input
                    id="adjNote"
                    autoComplete="off"
                    value={form.note}
                    onChange={(e) => edit({ note: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="sfoot sform">
              <button
                type="button"
                className="btn"
                disabled={
                  form.emp === "" ||
                  form.code === "" ||
                  Number(form.amt) <= 0 ||
                  form.note.trim() === "" ||
                  add.isPending
                }
                onClick={() => add.mutate(form)}
              >
                Add adjustment
              </button>
            </div>
          </>
        )}
        {sheet !== null && form === null && open !== null && (
          <>
            <SheetHead
              title={open.name}
              sub={monthLabel(month)}
              onClose={closeSheet}
            />
            <div className="sbody form roomy">
              <div className="sform">
                <div className="slipnet">
                  <span className="l">Adjustments this month</span>
                  <span className="v num">
                    {hasLines(open) ? rp(open.net) : "—"}
                  </span>
                </div>
                <div className="sub">Earnings</div>
                {open.earn.length === 0 && <p className="mute">None filed</p>}
                {open.earn.map((row) => (
                  <Line key={row.id} row={row} onDel={() => drop.mutate(row)} />
                ))}
                <div className="sub">Deductions</div>
                {open.ded.length === 0 && <p className="mute">None filed</p>}
                {open.ded.map((row) => (
                  <Line key={row.id} row={row} onDel={() => drop.mutate(row)} />
                ))}
              </div>
            </div>
            <div className="sfoot">
              {sent ? (
                <span className="mute">
                  Sent — a change goes into next month
                </span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setSheet({ emp: open.id, form: blank(open.id) })
                  }
                >
                  <Plus className="lucide" />
                  Add adjustment
                </button>
              )}
            </div>
          </>
        )}
      </RpSheet>
    </div>
  )
}

/// A line of the person's month: what it is, why it was filed, its figure, and
/// a × while the shop can still take it back.
function Line({
  row,
  onDel,
}: {
  row: PayrollAdjustmentRow
  onDel: () => void
}) {
  const sign = isDeduction(row) ? -1 : 1
  return (
    <div className="sl">
      <span>
        {row.label}
        <span className="mute"> · {row.reason}</span>
      </span>
      <span className="num">
        {rp(sign * row.amount_minor)}
        {row.withdrawable && (
          <button
            type="button"
            className="xdel"
            aria-label={`Remove ${row.label}`}
            onClick={onDel}
          >
            <X className="lucide" />
          </button>
        )}
      </span>
    </div>
  )
}
