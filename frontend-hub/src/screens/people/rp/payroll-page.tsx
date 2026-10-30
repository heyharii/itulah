import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Check, ChevronLeft, ChevronRight, Plus, SlidersHorizontal, X } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useUnits } from "@/lib/queries/organisation"
import {
  fileAdjustment,
  handOverRun,
  listAdjustments,
  listRuns,
  openRun,
  payComponentsQuery,
  payKeys,
  rebuildRun,
  runReconciliation,
  runSlips,
  stepRun,
  withdrawAdjustment,
} from "@/lib/queries/people"
import { useUnit } from "@/screens/people/parts"
import {
  RpFrame,
  RpSheet,
  SheetHead,
  StoresStrip,
  fmtH,
  initials,
  monthLabel,
  storeTiles,
  useRp,
} from "@/screens/people/rp/kit"
import type {
  PayrollAdjustmentRow,
  PayrollRunView,
  PayrollSlipRow,
  SlipLineRow,
} from "@itulah/contract"

/// Payroll, ported from `roster-prototype.html` model J (Multi-row): each person
/// is a block, their earnings stack in one column and their deductions in the
/// next, and the one figure that is paid sits on the right. One button takes the
/// month as far as the signer may: send it, approve it, hand it to Finance.

const num2 = (n: number) => Math.round(n).toLocaleString("id-ID")
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${num2(Math.abs(n))}`
const REASON = "Approved in payroll"

const shiftMonth = (ym: string, by: number) => {
  const date = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1))
  return date.toISOString().slice(0, 7)
}
const thisMonth = () => new Date().toISOString().slice(0, 7)

/// One line of a slip as the page shows it. `std` is a routine part (base pay,
/// BPJS, PPh 21); anything else is an extra, and an extra that differs from last
/// month is `chg`.
interface Part {
  readonly key: string
  readonly label: string
  readonly amt: number
  readonly std: boolean
  chg: boolean
  readonly adj: PayrollAdjustmentRow | null
}

const isOvertime = (line: SlipLineRow) => (line.unit ?? "").startsWith("OVERTIME")
const isBpjs = (line: SlipLineRow) => line.component_code.startsWith("BPJS_")

/// A slip folded into the few parts the prototype shows: the several overtime
/// bands are one Overtime, the BPJS shares are one BPJS, and a line somebody
/// filed by hand carries its adjustment so it can be taken back.
function partsOf(slip: PayrollSlipRow, adjs: readonly PayrollAdjustmentRow[]) {
  const mine = adjs.filter((a) => a.employee_id === slip.employee_id)
  const used = new Set<string>()
  const adjOf = (line: SlipLineRow) => {
    const found = mine.find(
      (a) => !used.has(a.id) && a.component_code === line.component_code && a.amount_minor === line.amount_minor
    )
    if (found) used.add(found.id)
    return found ?? null
  }
  const earn: Part[] = [
    { key: "base", label: "Base pay", amt: slip.statutory_base_minor, std: true, chg: false, adj: null },
  ]
  const overtime = slip.earnings.filter(isOvertime)
  const overtimePay = overtime.reduce((n, l) => n + l.amount_minor, 0)
  if (overtimePay > 0)
    earn.push({
      key: "overtime",
      label: "Overtime",
      amt: overtimePay,
      std: false,
      chg: false,
      adj: null,
    })
  for (const line of slip.earnings.filter((l) => !isOvertime(l) && l.amount_minor !== 0))
    earn.push({
      key: `E:${line.component_code}`,
      label: line.label,
      amt: line.amount_minor,
      std: false,
      chg: false,
      adj: adjOf(line),
    })
  const ded: Part[] = []
  const bpjs = slip.deductions.filter(isBpjs)
  const tax = slip.deductions.filter((l) => l.component_code === "PPH21")
  const rest = slip.deductions.filter((l) => !isBpjs(l) && l.component_code !== "PPH21")
  const extra = (line: SlipLineRow): Part => ({
    key: `D:${line.component_code}`,
    label: line.label,
    amt: line.amount_minor,
    std: false,
    chg: false,
    adj: adjOf(line),
  })
  const mapped = rest.map(extra)
  ded.push(...mapped.filter((p) => p.adj === null))
  if (bpjs.length > 0)
    ded.push({ key: "bpjs", label: "BPJS", amt: bpjs.reduce((n, l) => n + l.amount_minor, 0), std: true, chg: false, adj: null })
  const taxTotal = tax.reduce((n, l) => n + l.amount_minor, 0)
  if (taxTotal !== 0) ded.push({ key: "tax", label: "PPh 21", amt: taxTotal, std: true, chg: false, adj: null })
  ded.push(...mapped.filter((p) => p.adj !== null))
  return { earn, ded }
}

interface Row {
  readonly slip: PayrollSlipRow
  readonly name: string
  readonly earn: Part[]
  readonly ded: Part[]
  readonly earnTotal: number
  readonly dedTotal: number
  readonly net: number | null
  readonly prev: number | null
  readonly change: number | null
  readonly why: string
  readonly flagged: boolean
}

function rowOf(
  slip: PayrollSlipRow,
  adjs: readonly PayrollAdjustmentRow[],
  before: PayrollSlipRow | undefined
): Row {
  const { earn, ded } = partsOf(slip, adjs)
  const last = before === undefined ? null : partsOf(before, [])
  if (last !== null) {
    const amounts = new Map([...last.earn, ...last.ded].map((p) => [p.key, p.amt]))
    for (const part of [...earn, ...ded]) {
      if (part.std) continue
      // A line that was not there last month, or was a different figure.
      part.chg = amounts.get(part.key) !== part.amt
    }
  }
  const changed = [...earn, ...ded].filter((p) => p.chg)
  const prev = before?.net_minor ?? null
  const net = slip.net_minor
  return {
    slip,
    name: slip.full_name ?? slip.employee_code,
    earn,
    ded,
    earnTotal: slip.gross_minor,
    dedTotal: slip.deduction_total_minor ?? ded.reduce((n, p) => n + p.amt, 0),
    net,
    prev,
    change: net !== null && prev !== null && prev !== 0 ? (net - prev) / prev : null,
    why:
      changed.length === 0
        ? ""
        : `${changed[0].label}${changed.length > 1 ? ` +${changed.length - 1}` : ""}`,
    flagged: changed.length > 0,
  }
}

const pct = (change: number) => `${change >= 0 ? "+" : "−"}${(Math.abs(change) * 100).toFixed(1)}%`

export function PayrollPage() {
  return (
    <RpFrame>
      <Body />
    </RpFrame>
  )
}

function Body() {
  const { toast } = useRp()
  const client = useQueryClient()
  const navigate = useNavigate()
  const unit = useUnit()
  const unitId = unit.unitId
  const register = useUnits()
  const tiles = storeTiles(unit.units, register.data)
  const here = tiles.find((t) => t.id === unitId)

  const [month, setMonth] = useState(thisMonth)
  const [filter, setFilter] = useState<"all" | "changed">("all")
  const [slipOf, setSlipOf] = useState<string | null>(null)
  const [form, setForm] = useState<{ kind: "EARNING" | "DEDUCTION"; code: string; amt: string; note: string } | null>(null)

  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
  })
  const run = useMemo(
    () => (runs.data ?? []).find((r) => r.unit_id === unitId && r.period === month) ?? null,
    [runs.data, unitId, month]
  )
  const lastRun = useMemo(
    () => (runs.data ?? []).find((r) => r.unit_id === unitId && r.period === shiftMonth(month, -1)) ?? null,
    [runs.data, unitId, month]
  )
  const slips = useQuery({
    queryKey: payKeys.slips(run?.id ?? ""),
    queryFn: ({ signal }) => runSlips(run?.id ?? "", signal),
    enabled: run !== null,
  })
  const lastSlips = useQuery({
    queryKey: payKeys.slips(lastRun?.id ?? ""),
    queryFn: ({ signal }) => runSlips(lastRun?.id ?? "", signal),
    enabled: lastRun !== null,
  })
  const recon = useQuery({
    queryKey: payKeys.reconciliation(run?.id ?? ""),
    queryFn: ({ signal }) => runReconciliation(run?.id ?? "", signal),
    enabled: run !== null,
  })
  const adjustments = useQuery({
    queryKey: payKeys.adjustments(unitId ?? "", month),
    queryFn: ({ signal }) => listAdjustments({ unit: unitId ?? undefined, period: month }, signal),
    enabled: unitId !== null,
  })
  const components = useQuery(payComponentsQuery())

  const rows = useMemo(() => {
    const before = new Map((lastSlips.data ?? []).map((s) => [s.employee_id, s]))
    return (slips.data ?? []).map((s) => rowOf(s, adjustments.data ?? [], before.get(s.employee_id)))
  }, [slips.data, lastSlips.data, adjustments.data])
  const shown = rows.filter((x) => filter === "all" || x.flagged)
  const changed = rows.filter((x) => x.flagged).length
  const totalNet = rows.reduce((n, x) => n + (x.net ?? 0), 0)

  const refresh = () => {
    void client.invalidateQueries({ queryKey: payKeys.runs() })
    if (run) {
      void client.invalidateQueries({ queryKey: payKeys.slips(run.id) })
      void client.invalidateQueries({ queryKey: payKeys.reconciliation(run.id) })
    }
    void client.invalidateQueries({ queryKey: payKeys.adjustments(unitId ?? "", month) })
  }

  const blockers: string[] = []
  if (run !== null && run.state !== "APPROVED") {
    if (run.incomplete_because) blockers.push(run.incomplete_because)
    const r = recon.data
    if (r && r.unpayable > 0) blockers.push(`${r.unpayable} ${r.unpayable === 1 ? "person has" : "people have"} no bank account`)
    if (r && r.slips_with_unworkable_components > 0)
      blockers.push(`${r.slips_with_unworkable_components} ${r.slips_with_unworkable_components === 1 ? "slip" : "slips"} cannot be worked out`)
  }

  const calculate = useMutation({
    mutationFn: () => openRun(unitId ?? "", month, "Opened from payroll"),
    onSuccess: () => {
      refresh()
      toast(`${monthLabel(month)} calculated`)
    },
    onError: (e: Error) => toast(e.message),
  })

  /// As far as the signer may go: send, approve, hand over. The server refuses
  /// the same person twice (the two-person rule); that stops the chain and says so.
  const approve = useMutation({
    mutationFn: async (r: PayrollRunView) => {
      let at = r.state
      let sent = false
      try {
        if (at === "DRAFT") {
          await stepRun(r.id, "submission", REASON)
          sent = true
          at = "SUBMITTED"
        }
        if (at === "SUBMITTED") {
          await stepRun(r.id, "approve", REASON)
          at = "APPROVED"
        }
        if (r.handover === null) await handOverRun(r.id, REASON)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(sent ? `Sent to head office — ${message}` : message)
      }
    },
    onSuccess: () => {
      refresh()
      toast(`${here?.name ?? "Store"} · ${monthLabel(month)} approved and sent to Finance`)
    },
    onError: (e: Error) => {
      refresh()
      toast(e.message)
    },
  })

  const addAdj = useMutation({
    mutationFn: async () => {
      if (form === null || unitId === null || slipOf === null) return
      await fileAdjustment({
        unitId,
        period: month,
        employeeId: slipOf,
        componentCode: form.code,
        amountMinor: Number(form.amt.replace(/\D/g, "")),
        reason: form.note.trim() || "Added in payroll",
      })
      if (run) await rebuildRun(run.id)
    },
    onSuccess: () => {
      setForm(null)
      refresh()
      toast("Adjustment added")
    },
    onError: (e: Error) => toast(e.message),
  })
  const dropAdj = useMutation({
    mutationFn: async (a: PayrollAdjustmentRow) => {
      await withdrawAdjustment(a.id, "Taken back in payroll")
      if (run) await rebuildRun(run.id)
    },
    onSuccess: () => {
      refresh()
      toast("Adjustment removed")
    },
    onError: (e: Error) => toast(e.message),
  })

  const sheetRow = rows.find((x) => x.slip.employee_id === slipOf) ?? null
  const closeSheet = () => {
    setSlipOf(null)
    setForm(null)
  }
  const done = run?.handover != null
  const editable = run?.state === "DRAFT"
  const picks = (components.data ?? []).filter(
    (c) => !c.retired && c.basis === "PER_OCCASION" && c.kind === form?.kind
  )

  const who = (x: Row) => (
    <div className="person">
      <div className="av">{initials(x.name)}</div>
      <div className="who2">
        <span className="n">{x.name}</span>
        <span className="r">{x.slip.employee_code}</span>
      </div>
    </div>
  )
  const lines = (list: Part[], sign: string) => (
    <div className="stk">
      {list.map((c) => (
        <div key={c.key} className={`ln${c.chg ? " chg" : ""}${c.std ? "" : " ex"}`}>
          <span>{c.label}</span>
          <span className="num">
            {sign}
            {num2(c.amt)}
          </span>
        </div>
      ))}
    </div>
  )
  const net = (x: Row) => (x.net === null ? "—" : num2(x.net))

  return (
    <PageContent>
      <div style={{ position: "relative" }}>
        <StoresStrip tiles={tiles} value={unitId} onChange={(id) => unit.setUnitId(id)} />

        <div className="head">
          <h1>{here?.name ?? unit.name ?? "Payroll"}</h1>
          {done && (
            <span className="pubmark">
              <Check className="lucide" />
              Approved · Finance has it
            </span>
          )}
          <span className="grow desk-only" />
          <div className="step">
            <button type="button" className="icbtn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft className="lucide" />
            </button>
            <span className="lbl">{monthLabel(month)}</span>
            <button type="button" className="icbtn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight className="lucide" />
            </button>
          </div>
          <button
            type="button"
            className="btn ghost desk-only"
            onClick={() => void navigate({ to: "/people/settings/overtime" })}
          >
            <SlidersHorizontal className="lucide" />
            Rates
          </button>
          {run !== null && (
            <span className="hdtot desk-only">
              <span className="l">Total net pay</span>
              <b className="num">{rp(totalNet)}</b>
            </span>
          )}
          {run === null ? (
            <button
              type="button"
              className="btn publish"
              disabled={unitId === null || calculate.isPending}
              onClick={() => calculate.mutate()}
            >
              Calculate {monthLabel(month).split(" ")[0]}
            </button>
          ) : (
            <button
              type="button"
              className="btn publish"
              disabled={done || blockers.length > 0 || approve.isPending}
              title={blockers.join(", ")}
              onClick={() => approve.mutate(run)}
            >
              {done ? "Sent to Finance" : "Approve & send to Finance"}
            </button>
          )}
        </div>

        {run !== null && (rows.length > 0 || blockers.length > 0) && (
          <div className="afilters">
            <div className="seg">
              <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All <span className="cn num">{rows.length}</span>
              </button>
              <button type="button" aria-pressed={filter === "changed"} onClick={() => setFilter("changed")}>
                Changed <span className="cn num">{changed}</span>
              </button>
            </div>
            {blockers.length > 0 && (
              <span className="open bad">
                {blockers[0]}
                {blockers.length > 1 ? ` and ${blockers.length - 1} more` : ""}
                {" · "}
                <button type="button" className="linkbtn" onClick={() => void navigate({ to: "/people/attendance-days" })}>
                  Open attendance
                </button>
              </span>
            )}
          </div>
        )}

        {run === null ? (
          <div className="card desk" style={{ padding: 40, textAlign: "center", color: "var(--mute)" }}>
            {runs.isPending ? "Reading the runs…" : `No payroll for ${monthLabel(month)} yet.`}
          </div>
        ) : (
          <>
            <div className="card desk">
              <table className="rgrid pay stack">
                <colgroup>
                  <col className="who" />
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Earnings</th>
                    <th>Deductions</th>
                    <th className="pn2 sep">Net pay</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((x) => (
                    <tr key={x.slip.employee_id} className="click stackrow" onClick={() => setSlipOf(x.slip.employee_id)}>
                      <td className="who">{who(x)}</td>
                      <td className="stc">
                        {lines(x.earn, "")}
                        {x.earn.length > 1 && (
                          <div className="ln tt">
                            <span>Total</span>
                            <span className="num">{num2(x.earnTotal)}</span>
                          </div>
                        )}
                      </td>
                      <td className="stc">
                        {lines(x.ded, "−")}
                        {x.ded.length > 1 && (
                          <div className="ln tt">
                            <span>Total</span>
                            <span className="num">−{num2(x.dedTotal)}</span>
                          </div>
                        )}
                      </td>
                      <td className="pn2 num net sep">
                        <b>{net(x)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>
                      Total · {shown.length} {shown.length === 1 ? "person" : "people"}
                    </td>
                    <td className="stc num">{num2(shown.reduce((n, x) => n + x.earnTotal, 0))}</td>
                    <td className="stc num">−{num2(shown.reduce((n, x) => n + x.dedTotal, 0))}</td>
                    <td className="pn2 num net sep">
                      <b>{num2(shown.reduce((n, x) => n + (x.net ?? 0), 0))}</b>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="plist">
              {shown.map((x) => (
                <button key={x.slip.employee_id} type="button" className="prow person" onClick={() => setSlipOf(x.slip.employee_id)}>
                  <div className="av">{initials(x.name)}</div>
                  <div className="who2">
                    <span className="n">{x.name}</span>
                    <span className={`r${x.flagged ? " lt2" : ""}`}>{x.flagged ? x.why : x.slip.employee_code}</span>
                  </div>
                  <span className="rt num">
                    <b>{net(x)}</b>
                    {x.flagged && x.change !== null && <span className="lt2">{pct(x.change)}</span>}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <RpSheet open={sheetRow !== null} onClose={closeSheet}>
        {sheetRow !== null && form !== null && (
          <>
            <SheetHead
              title="Add adjustment"
              sub={`${sheetRow.name} · ${monthLabel(month)}`}
              back={() => setForm(null)}
              onClose={closeSheet}
            />
            <div className="sbody form roomy">
              <div className="sform">
                <div className="fld">
                  <label>Type</label>
                  <div className="seg" style={{ alignSelf: "flex-start" }}>
                    <button type="button" aria-pressed={form.kind === "EARNING"} onClick={() => setForm({ ...form, kind: "EARNING", code: "" })}>
                      Earning
                    </button>
                    <button type="button" aria-pressed={form.kind === "DEDUCTION"} onClick={() => setForm({ ...form, kind: "DEDUCTION", code: "" })}>
                      Deduction
                    </button>
                  </div>
                </div>
                <div className="fld">
                  <label htmlFor="adjCode">What for</label>
                  <select
                    id="adjCode"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    style={{ height: 44, padding: "0 12px", borderRadius: 8, border: "1px solid var(--edge)", background: "#fff" }}
                  >
                    <option value="">Pick one</option>
                    {picks.map((c) => (
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
                    onChange={(e) => setForm({ ...form, amt: e.target.value.replace(/\D/g, "") })}
                  />
                </div>
                <div className="fld">
                  <label htmlFor="adjNote">Why</label>
                  <input
                    id="adjNote"
                    autoComplete="off"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="sfoot sform">
              <button
                type="button"
                className="btn"
                disabled={form.code === "" || Number(form.amt) <= 0 || form.note.trim() === "" || addAdj.isPending}
                onClick={() => addAdj.mutate()}
              >
                Add adjustment
              </button>
            </div>
          </>
        )}
        {sheetRow !== null && form === null && (
          <>
            <SheetHead title={sheetRow.name} sub={monthLabel(month)} onClose={closeSheet} />
            <div className="sbody form roomy">
              <div className="sform">
                <div className="slipnet">
                  <span className="l">Take-home</span>
                  <span className="v num">{sheetRow.net === null ? "—" : rp(sheetRow.net)}</span>
                  {sheetRow.slip.components_incomplete_because !== null ? (
                    <span className="lt2 num">{sheetRow.slip.components_incomplete_because}</span>
                  ) : sheetRow.change !== null ? (
                    sheetRow.flagged ? (
                      <span className="lt2 num">
                        {pct(sheetRow.change)} on last month · {sheetRow.why}
                      </span>
                    ) : (
                      <span className="mute num">{pct(sheetRow.change)} on last month</span>
                    )
                  ) : null}
                </div>
                <div className="sub">Earnings</div>
                {sheetRow.earn.map((c) => (
                  <SlipLine
                    key={c.key + (c.adj?.id ?? "")}
                    part={c}
                    sign={1}
                    sub={c.key === "overtime" ? fmtH(sheetRow.slip.overtime_minutes / 60) : c.adj ? "adjustment" : undefined}
                    onDel={editable && c.adj ? () => dropAdj.mutate(c.adj as PayrollAdjustmentRow) : undefined}
                  />
                ))}
                <div className="sub">Deductions</div>
                {sheetRow.ded.map((c) => (
                  <SlipLine
                    key={c.key + (c.adj?.id ?? "")}
                    part={c}
                    sign={-1}
                    sub={c.adj ? "adjustment" : undefined}
                    bad={!c.std}
                    onDel={editable && c.adj ? () => dropAdj.mutate(c.adj as PayrollAdjustmentRow) : undefined}
                  />
                ))}
              </div>
            </div>
            <div className="sfoot">
              <span className="sum num">Paid into {sheetRow.slip.bank_account_masked ?? "no account yet"}</span>
              {editable ? (
                <button type="button" className="btn" onClick={() => setForm({ kind: "EARNING", code: "", amt: "", note: "" })}>
                  <Plus className="lucide" />
                  Add adjustment
                </button>
              ) : (
                <span className="mute">Approved — a change goes into next month</span>
              )}
            </div>
          </>
        )}
      </RpSheet>
    </PageContent>
  )
}

function SlipLine({
  part,
  sign,
  sub,
  bad,
  onDel,
}: {
  part: Part
  sign: 1 | -1
  sub?: string
  bad?: boolean
  onDel?: () => void
}) {
  return (
    <div className="sl">
      <span>
        {part.label}
        {sub && <span className="mute"> · {sub}</span>}
      </span>
      <span className={`num${bad && part.chg ? " lt2" : ""}`}>
        {rp(sign * part.amt)}
        {onDel && (
          <button
            type="button"
            className="xdel"
            aria-label="Remove"
            onClick={(event) => {
              event.stopPropagation()
              onDel()
            }}
          >
            <X className="lucide" />
          </button>
        )}
      </span>
    </div>
  )
}
