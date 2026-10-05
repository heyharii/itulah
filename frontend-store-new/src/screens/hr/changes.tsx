import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpRight, Banknote, LogOut, Plus, Shuffle } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  adjustmentsAt,
  changeProposalsAt,
  fileAdjustment,
  fileChangeProposal,
  hrKeys,
  isoDay,
  isoMonth,
  payComponents,
  positions,
  readDate,
  readMonth,
  withdrawAdjustment,
  type ChangeKind,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import {
  Facts,
  Heading,
  Person,
  PersonPicker,
  Submit,
} from "@/screens/hr/parts"
import { personName, useTeam, type Tone } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import { money, parseMoneyToMinor } from "@itulah/contract/money"
import type {
  ChangeProposalView,
  EmployeeList,
  PayrollAdjustmentRow,
} from "@itulah/contract"

/// Employment changes, for a shop — the prototype's store "Employment
/// changes", and `menu-final.md`'s *Pengajuan gaji oleh store manager*.
///
/// Two kinds of asking, kept apart on purpose:
///
///  - **A change to the employment** — a promotion, a transfer, a new base
///    salary, an end of employment. "Toko mengajukan setelah kepala toko
///    setuju; HO memutuskan": the shop files it once the store head has
///    agreed, head office decides, and nothing about the person changes until
///    it does. A shop cannot change pay, job or status by itself.
///  - **A pay component, + or −, for one month** — an incentive, a *kasbon*
///    instalment. `menu-final.md` keeps this separate from a salary change "so
///    a change to the agreed base pay is not mixed up with a bonus or a
///    deduction for one period". The shop proposes the figure; head office
///    decides it with that month's payroll batch, and there is no second
///    approval.
///
/// Adding people is not here: it is a request under Recruitment.
export function HrChanges() {
  const [filing, setFiling] = useState<"change" | "component" | null>(null)
  return (
    <HrWorkspace
      actions={
        <>
          <Button onClick={() => setFiling("component")}>
            <Banknote />
            Pay component ±
          </Button>
          <Button variant="primary" onClick={() => setFiling("change")}>
            <Plus />
            Propose to head office
          </Button>
        </>
      }
    >
      {(scope) => (
        <Changes scope={scope} filing={filing} onFiling={setFiling} />
      )}
    </HrWorkspace>
  )
}

const KINDS: Record<ChangeKind, { label: string; icon: React.ReactNode }> = {
  PROMOTION: { label: "Promotion", icon: <ArrowUpRight /> },
  TRANSFER: { label: "Transfer", icon: <Shuffle /> },
  SALARY: { label: "Salary change", icon: <Banknote /> },
  SEPARATION: { label: "Separation", icon: <LogOut /> },
}

function kindWord(kind: string): string {
  return KINDS[kind as ChangeKind]?.label ?? kind
}

function changeState(state: string): { label: string; tone: Tone } {
  switch (state) {
    case "PENDING":
      return { label: "Waiting on head office", tone: "warn" }
    case "APPROVED":
      return { label: "Approved by head office", tone: "ok" }
    case "REJECTED":
      return { label: "Refused by head office", tone: "bad" }
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral" }
    default:
      return { label: state, tone: "neutral" }
  }
}

/// What a change row names, said the way a person would.
function fieldWord(field: string): string {
  if (field === "base_minor") return "Base pay"
  if (field === "unit_id") return "Shop"
  if (field === "position") return "Position"
  if (field === "grade") return "Grade"
  return field
}

function Changes({
  scope,
  filing,
  onFiling,
}: {
  scope: StoreScope
  filing: "change" | "component" | null
  onFiling: (next: "change" | "component" | null) => void
}) {
  const team = useTeam(scope)
  const changes = useQuery({
    queryKey: hrKeys.changes(scope.unit_id),
    queryFn: ({ signal }) => changeProposalsAt(scope.unit_id, signal),
  })
  const [open, setOpen] = useState<ChangeProposalView | null>(null)

  const columns = [
    {
      key: "who",
      header: "Employee",
      cell: (change: ChangeProposalView) => (
        <Person team={team.data} id={change.employee_id} />
      ),
    },
    {
      key: "kind",
      header: "Change",
      card: "meta" as const,
      cell: (change: ChangeProposalView) => (
        <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-line-ico">
          {KINDS[change.kind as ChangeKind]?.icon}
          {kindWord(change.kind)}
        </span>
      ),
    },
    {
      key: "props",
      header: "Now → new",
      card: "meta" as const,
      className: "whitespace-normal",
      cell: (change: ChangeProposalView) =>
        change.props.length === 0 ? (
          <span className="text-mute">last day of work</span>
        ) : (
          <span className="flex flex-col">
            {change.props.map((prop) => (
              <span key={prop.field}>
                {fieldWord(prop.field)}: {prop.from || "—"} →{" "}
                <b className="font-semibold text-ink">{prop.to}</b>
              </span>
            ))}
          </span>
        ),
    },
    {
      key: "from",
      header: "Effective",
      card: "meta" as const,
      cell: (change: ChangeProposalView) => readDate(change.effective_on),
    },
    {
      key: "state",
      header: "Status",
      card: "status" as const,
      cell: (change: ChangeProposalView) => {
        const state = changeState(change.state)
        return <Pill tone={state.tone}>{state.label}</Pill>
      },
    },
  ]

  return (
    <>
      {centreState(changes, {
        loading: "Loading…",
        what: "this shop's change proposals",
        render: (rows) => {
          const waiting = rows.filter((change) => change.state === "PENDING")
          const decided = rows.filter((change) => change.state !== "PENDING")
          return (
            <>
              <Heading count={waiting.length}>Waiting on head office</Heading>
              <PeopleTable
                rows={waiting}
                rowKey={(change) => change.id}
                onRowClick={setOpen}
                columns={columns}
                empty="Nothing waiting."
              />
              <Heading>Decided</Heading>
              <PeopleTable
                rows={decided}
                rowKey={(change) => change.id}
                onRowClick={setOpen}
                columns={columns}
                empty="Nothing has been decided yet."
              />
            </>
          )
        },
      })}

      <Components scope={scope} team={team.data} />

      {open !== null && (
        <ChangeSheet
          key={open.id}
          change={open}
          team={team.data}
          onClose={() => setOpen(null)}
        />
      )}
      {filing === "change" && (
        <ProposeChange
          scope={scope}
          team={team.data}
          onClose={() => onFiling(null)}
        />
      )}
      {filing === "component" && (
        <ProposeComponent
          scope={scope}
          team={team.data}
          onClose={() => onFiling(null)}
        />
      )}
    </>
  )
}

function ChangeSheet({
  change,
  team,
  onClose,
}: {
  change: ChangeProposalView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const state = changeState(change.state)
  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={
        <>
          {kindWord(change.kind)} ·{" "}
          <span className="font-mono">{change.id}</span>
        </>
      }
      title={personName(team, change.employee_id)}
      sub={`Effective ${readDate(change.effective_on)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
    >
      <SheetSection title="The proposal">
        <Facts
          rows={[
            ["Because", change.reason],
            ["Filed by", change.filed_by],
            ["Effective", readDate(change.effective_on)],
          ]}
        />
      </SheetSection>
      <SheetSection title="What would change">
        {change.props.length === 0 ? (
          <p className="text-meta text-body">
            Employment ends {readDate(change.effective_on)}.
          </p>
        ) : (
          <Facts
            rows={change.props.map((prop) => [
              fieldWord(prop.field),
              <span>
                {prop.from || "—"} → <b className="font-semibold">{prop.to}</b>
              </span>,
            ])}
          />
        )}
      </SheetSection>
      {change.decided_by !== null && (
        <SheetSection title="Head office's decision">
          <Facts
            rows={[
              ["By", change.decided_by],
              change.decision_note !== null && ["Note", change.decision_note],
              change.applied_at !== null && [
                "Written to the record",
                moment(change.applied_at),
              ],
            ]}
          />
        </SheetSection>
      )}
      {change.state === "PENDING" && (
        <Banner tone="info">Waiting on head office.</Banner>
      )}
    </PeopleSheet>
  )
}

/// *Ajukan ke HO* — a change to somebody's employment.
function ProposeChange({
  scope,
  team,
  onClose,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const roles = useQuery({
    queryKey: hrKeys.positions(),
    queryFn: ({ signal }) => positions(signal),
    staleTime: 5 * 60_000,
  })
  const [kind, setKind] = useState<ChangeKind>("SALARY")
  const [employeeId, setEmployeeId] = useState("")
  const [position, setPosition] = useState("")
  const [base, setBase] = useState("")
  const [toPlace, setToPlace] = useState("")
  const [effectiveOn, setEffectiveOn] = useState(isoDay(new Date()))
  const [reason, setReason] = useState("")
  const [endorsed, setEndorsed] = useState<"no" | "yes">("no")
  const baseMinor = parseMoneyToMinor(base)
  const person = team?.rows.find((row) => row.employee_id === employeeId)

  const props = (): { field: string; toText?: string; toMinor?: number }[] => {
    if (kind === "SALARY")
      return [{ field: "base_minor", toMinor: baseMinor ?? 0 }]
    if (kind === "TRANSFER")
      return [{ field: "unit_id", toText: toPlace.trim() }]
    if (kind === "PROMOTION") {
      const out: { field: string; toText?: string; toMinor?: number }[] = [
        { field: "position", toText: position },
      ]
      if (baseMinor !== null && baseMinor > 0)
        out.push({ field: "base_minor", toMinor: baseMinor })
      return out
    }
    return []
  }
  const ready =
    employeeId !== "" &&
    effectiveOn !== "" &&
    reason.trim() !== "" &&
    endorsed === "yes" &&
    (kind !== "SALARY" || (baseMinor !== null && baseMinor > 0)) &&
    (kind !== "TRANSFER" ||
      (toPlace.trim() !== "" && toPlace.trim() !== scope.unit_id)) &&
    (kind !== "PROMOTION" || position !== "")

  const file = useMutation({
    mutationFn: () =>
      fileChangeProposal({
        employeeId,
        kind,
        props: props(),
        effectiveOn,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.changes(scope.unit_id) })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Employment changes"
      title="Propose to head office"
      foot={
        <Submit
          label="Send to head office"
          pending={file.isPending}
          disabled={!ready}
          error={file.error}
          onSubmit={() => file.mutate()}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Kind of change">
          <Select
            value={kind}
            onChange={(value) => setKind(value as ChangeKind)}
          >
            {(Object.keys(KINDS) as ChangeKind[]).map((key) => (
              <option key={key} value={key}>
                {KINDS[key].label}
              </option>
            ))}
          </Select>
        </Field>
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
        />
        {person !== undefined && (
          <p className="-mt-1 text-meta text-mute">
            Now: {person.position ?? "no position on record"}
            {person.contract_kind === null ? "" : ` · ${person.contract_kind}`}
          </p>
        )}
        {kind === "PROMOTION" && (
          <Field label="New position">
            <Select value={position} onChange={setPosition}>
              <option value="">Choose…</option>
              {(roles.data ?? []).map((role) => (
                <option key={role.name} value={role.name}>
                  {role.name} · {role.grade_floor}–{role.grade_ceiling}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(kind === "SALARY" || kind === "PROMOTION") && (
          <Field
            label={
              kind === "SALARY"
                ? "New base pay (Rp)"
                : "New base pay (Rp), if it changes"
            }
            hint={
              baseMinor === null || baseMinor <= 0
                ? undefined
                : money(baseMinor)
            }
          >
            <Input
              inputMode="numeric"
              value={base}
              placeholder="5500000"
              onChange={(event) =>
                setBase(event.target.value.replace(/[^\d]/g, ""))
              }
            />
          </Field>
        )}
        {kind === "TRANSFER" && (
          <Field
            label="To shop"
            hint="Shop code"
            problem={
              toPlace.trim() === scope.unit_id
                ? "That is this shop."
                : undefined
            }
          >
            <Input
              value={toPlace}
              placeholder="C003"
              autoCapitalize="characters"
              onChange={(event) => setToPlace(event.target.value.toUpperCase())}
            />
          </Field>
        )}
        <Field
          label={kind === "SEPARATION" ? "Last day of work" : "Effective from"}
        >
          <Input
            type="date"
            value={effectiveOn}
            onChange={(event) => setEffectiveOn(event.target.value)}
          />
        </Field>
        <Field label="Why">
          <Input
            value={reason}
            placeholder={
              kind === "SEPARATION"
                ? "Resigned, letter dated 1 Oct"
                : "Runs two sections since August"
            }
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Field
          label="Store head"
        >
          <Segmented
            options={[
              { value: "no", label: "Not yet agreed" },
              { value: "yes", label: "Agreed" },
            ]}
            value={endorsed}
            onChange={setEndorsed}
          />
        </Field>
      </div>
    </PeopleSheet>
  )
}

// ── pay components ──────────────────────────────────────────────────────────

const MONTHS = [
  { value: "this", label: "This month" },
  { value: "next", label: "Next month" },
] as const

function monthOf(which: (typeof MONTHS)[number]["value"]): string {
  const now = new Date()
  return which === "this"
    ? isoMonth(now)
    : isoMonth(new Date(now.getFullYear(), now.getMonth() + 1, 1))
}

/// The one-off figures this shop has proposed for a month.
function Components({
  scope,
  team,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
}) {
  const [which, setWhich] = useState<(typeof MONTHS)[number]["value"]>("this")
  const period = monthOf(which)
  const adjustments = useQuery({
    queryKey: hrKeys.adjustments(scope.unit_id, period),
    queryFn: ({ signal }) => adjustmentsAt(scope.unit_id, period, signal),
  })
  const [withdrawing, setWithdrawing] = useState<PayrollAdjustmentRow | null>(
    null,
  )

  return (
    <>
      <Heading
        count={adjustments.data?.length}
        tone="neutral"
        action={
          <div className="w-[15rem]">
            <Segmented options={MONTHS} value={which} onChange={setWhich} />
          </div>
        }
      >
        Pay components · {readMonth(period)}
      </Heading>
      {centreState(adjustments, {
        loading: "Loading…",
        what: "this shop's pay components",
        render: (rows) => (
          <PeopleTable
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) =>
              row.withdrawable ? setWithdrawing(row) : undefined
            }
            empty="None this month."
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (row) => (
                  <Person
                    team={team}
                    id={row.employee_id}
                    sub={row.employee_code}
                  />
                ),
              },
              {
                key: "component",
                header: "Component",
                card: "meta",
                cell: (row) => (
                  <span className="flex flex-col">
                    <span className="text-ink">{row.label}</span>
                    <span className="text-meta text-mute">
                      {row.kind === "DEDUCTION" ? "deduction" : "earning"}
                    </span>
                  </span>
                ),
              },
              {
                key: "why",
                header: "Reason",
                card: "meta",
                className: "whitespace-normal",
                cell: (row) => row.reason,
              },
              {
                key: "amount",
                header: "Amount",
                align: "right",
                cell: (row) => (
                  <span
                    className={
                      row.kind === "DEDUCTION" ? "text-bad-fg" : "text-ok-fg"
                    }
                  >
                    {row.kind === "DEDUCTION" ? "−" : "+"}
                    {money(row.amount_minor)}
                  </span>
                ),
              },
              {
                key: "state",
                header: "Status",
                card: "status",
                cell: (row) =>
                  row.withdrawable ? (
                    <Pill tone="warn">With the month's batch</Pill>
                  ) : (
                    <Pill tone="neutral">Submitted · frozen</Pill>
                  ),
              },
            ]}
          />
        ),
      })}
      {withdrawing !== null && (
        <WithdrawComponent
          key={withdrawing.id}
          row={withdrawing}
          scope={scope}
          period={period}
          onClose={() => setWithdrawing(null)}
        />
      )}
    </>
  )
}

function WithdrawComponent({
  row,
  scope,
  period,
  onClose,
}: {
  row: PayrollAdjustmentRow
  scope: StoreScope
  period: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const withdraw = useMutation({
    mutationFn: () => withdrawAdjustment({ id: row.id, reason }),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: hrKeys.adjustments(scope.unit_id, period),
      })
      onClose()
    },
  })
  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Pay component"
      title={row.full_name ?? row.employee_code}
      sub={`${row.label} · ${readMonth(period)}`}
      foot={
        <div className="flex flex-col gap-3">
          <Field
            label="Reason"
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Submit
            label="Withdraw the figure"
            pending={withdraw.isPending}
            disabled={reason.trim() === ""}
            error={withdraw.error}
            onSubmit={() => withdraw.mutate()}
          />
        </div>
      }
    >
      <Facts
        rows={[
          [
            "Amount",
            `${row.kind === "DEDUCTION" ? "−" : "+"}${money(row.amount_minor)}`,
          ],
          ["Because", row.reason],
          ["Filed", `${row.filed_by} · ${moment(row.filed_at)}`],
        ]}
      />
    </PeopleSheet>
  )
}

/// Propose one component, + or −, for one person for one month.
function ProposeComponent({
  scope,
  team,
  onClose,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const catalogue = useQuery({
    queryKey: hrKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
    staleTime: 5 * 60_000,
  })
  // Only a component with no standing figure of its own may carry a one-off.
  const usable = (catalogue.data ?? []).filter(
    (component) => component.basis === "PER_OCCASION" && !component.retired,
  )
  const [which, setWhich] = useState<(typeof MONTHS)[number]["value"]>("this")
  const [employeeId, setEmployeeId] = useState("")
  const [code, setCode] = useState("")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const minor = parseMoneyToMinor(amount)
  const chosen = usable.find((component) => component.code === code)
  const period = monthOf(which)

  const file = useMutation({
    mutationFn: () =>
      fileAdjustment({
        place: scope.unit_id,
        period,
        employeeId,
        componentCode: code,
        amountMinor: minor ?? 0,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: hrKeys.adjustments(scope.unit_id, period),
      })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Employment changes"
      title="Propose a pay component"
      foot={
        <Submit
          label="Propose it"
          pending={file.isPending}
          disabled={
            employeeId === "" ||
            code === "" ||
            minor === null ||
            minor <= 0 ||
            reason.trim() === ""
          }
          error={file.error}
          onSubmit={() => file.mutate()}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
        />
        <Field
          label="Component"
          hint={
            catalogue.isSuccess && usable.length === 0
              ? "None set up yet."
              : undefined
          }
        >
          <Select value={code} onChange={setCode}>
            <option value="">Choose…</option>
            {usable.map((component) => (
              <option key={component.code} value={component.code}>
                {component.kind === "DEDUCTION" ? "− " : "+ "}
                {component.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Amount (Rp)"
          >
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value.replace(/[^\d]/g, ""))
              }
            />
          </Field>
          <Field label="Payroll month">
            <Select
              value={which}
              onChange={(value) => setWhich(value as typeof which)}
            >
              {MONTHS.map((month) => (
                <option key={month.value} value={month.value}>
                  {readMonth(monthOf(month.value))}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Why, and on what basis">
          <Input
            value={reason}
            placeholder="Sales incentive, September target met"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {chosen !== undefined &&
          minor !== null &&
          minor > 0 &&
          employeeId !== "" && (
            <Banner tone={chosen.kind === "DEDUCTION" ? "warn" : "ok"}>
              {personName(team, employeeId)}:{" "}
              {chosen.kind === "DEDUCTION" ? "−" : "+"}
              {money(minor)} · {chosen.label} · {readMonth(period)}
            </Banner>
          )}
      </div>
    </PeopleSheet>
  )
}
