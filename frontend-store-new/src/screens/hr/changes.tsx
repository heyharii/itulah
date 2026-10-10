import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpRight, Banknote, LogOut, Shuffle } from "lucide-react"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import {
  PeopleSheet,
  SheetFoot,
  SheetSection,
} from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill, Status } from "@/components/ui/pill"
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
import { centreState, describeCentre } from "@/screens/hr/centre"
import {
  dateLead,
  Facts,
  Person,
  personCard,
  PersonPicker,
  Submit,
} from "@/screens/hr/parts"
import {
  personByLogin,
  personName,
  requestState,
  useTeam,
} from "@/screens/hr/words"
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
///
/// # Two slices, one act each
///
/// The page's own act is "Propose a change" (the header button on a desk, the
/// dock's "+" on a phone). The pay component is the second slice's act: a
/// ghost button in its toolbar on a desk, a row of its gear sheet on a phone —
/// together with the month it is filed for.
export function HrChanges() {
  const [filing, setFiling] = useState<"change" | "component" | null>(null)
  return (
    <HrWorkspace
      primary={{
        label: "Propose a change",
        onClick: () => setFiling("change"),
      }}
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

/// What a change row names, said the way a person would.
function fieldWord(field: string): string {
  if (field === "base_minor") return "Base pay"
  if (field === "unit_id") return "Shop"
  if (field === "position") return "Position"
  if (field === "grade") return "Grade"
  return field
}

type Tab = "proposals" | "components"

function Changes({
  scope,
  filing,
  onFiling,
}: {
  scope: StoreScope
  filing: "change" | "component" | null
  onFiling: (next: "change" | "component" | null) => void
}) {
  const [tab, setTab] = useState<Tab>("proposals")
  /// The month a pay component is filed for and listed under — held here so
  /// the form opens on the month the list is showing.
  const [which, setWhich] = useState<MonthChoice>("this")
  const team = useTeam(scope)
  const changes = useQuery({
    queryKey: hrKeys.changes(scope.unit_id),
    queryFn: ({ signal }) => changeProposalsAt(scope.unit_id, signal),
  })
  const [open, setOpen] = useState<ChangeProposalView | null>(null)

  return (
    <>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: "proposals",
            label: "Proposals",
            count: changes.data?.filter((change) => change.state === "PENDING")
              .length,
          },
          { value: "components", label: "Pay components" },
        ]}
      />

      {tab === "proposals" &&
        centreState(changes, {
          loading: "Reading the change proposals…",
          what: "this shop's change proposals",
          render: (rows) => {
            // Waiting on head office first; the rest in the order sent.
            const sorted = [...rows].sort(
              (left, right) =>
                Number(right.state === "PENDING") -
                Number(left.state === "PENDING"),
            )
            return (
              <PeopleTable
                rows={sorted}
                rowKey={(change) => change.id}
                onRowClick={setOpen}
                empty="No change proposals."
                card={(change) => {
                  const state = requestState(change.state)
                  return {
                    ...personCard(team.data, change.employee_id, [
                      `${kindWord(change.kind)} · ${
                        change.props.length === 0
                          ? "last day of work"
                          : change.props
                              .map(
                                (prop) =>
                                  `${fieldWord(prop.field)} ${prop.from || "—"} → ${prop.to}`,
                              )
                              .join(", ")
                      }`,
                    ]),
                    lead: dateLead(change.effective_on, "effective"),
                    foot: {
                      info: <Status tone={state.tone}>{state.label}</Status>,
                      action: { label: "Open", onClick: () => setOpen(change) },
                    },
                  }
                }}
                columns={[
                  {
                    key: "who",
                    header: "Employee",
                    cell: (change) => (
                      <Person team={team.data} id={change.employee_id} />
                    ),
                  },
                  {
                    key: "kind",
                    header: "Change",
                    cell: (change) => (
                      <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-line-ico">
                        {KINDS[change.kind as ChangeKind]?.icon}
                        {kindWord(change.kind)}
                      </span>
                    ),
                  },
                  {
                    key: "props",
                    header: "Now → new",
                    className: "whitespace-normal",
                    cell: (change) =>
                      change.props.length === 0 ? (
                        <span className="text-mute">last day of work</span>
                      ) : (
                        <span className="flex flex-col">
                          {change.props.map((prop) => (
                            <span key={prop.field}>
                              {fieldWord(prop.field)}: {prop.from || "—"} →{" "}
                              <b className="font-semibold text-ink">
                                {prop.to}
                              </b>
                            </span>
                          ))}
                        </span>
                      ),
                  },
                  {
                    key: "from",
                    header: "Effective",
                    cell: (change) => readDate(change.effective_on),
                  },
                  {
                    key: "state",
                    header: "Status",
                    cell: (change) => {
                      const state = requestState(change.state)
                      return <Status tone={state.tone}>{state.label}</Status>
                    },
                  },
                ]}
              />
            )
          },
        })}

      {tab === "components" && (
        <Components
          scope={scope}
          team={team.data}
          which={which}
          onWhich={setWhich}
          onFile={() => onFiling("component")}
        />
      )}

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
          initial={which}
          onFiled={setWhich}
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
  const state = requestState(change.state)
  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={change.id}
      crumb={kindWord(change.kind)}
      title={personName(team, change.employee_id)}
      sub={`Effective ${readDate(change.effective_on)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
    >
      <Facts
        rows={[
          ["Filed by", personByLogin(team, change.filed_by)],
          ["Effective", readDate(change.effective_on)],
          ["Because", change.reason, true],
          // Who is being waited on is a fact here, not part of the state's name.
          change.state === "PENDING" && ["Waiting on", "Head office"],
          change.decided_by !== null && [
            "Decided by",
            personByLogin(team, change.decided_by),
          ],
          change.applied_at !== null && [
            "Written to the record",
            moment(change.applied_at),
          ],
          change.decision_note !== null && ["Note", change.decision_note, true],
        ]}
      />
      <SheetSection title="What would change" className="mt-6">
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
      title="Propose a change"
      foot={
        <Submit
          label="Submit proposal"
          pendingLabel="Submitting…"
          pending={file.isPending}
          disabled={!ready}
          error={file.error}
          onSubmit={() => file.mutate()}
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Kind of change" required>
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
          required
        />
        {person !== undefined && (
          <p className="-mt-1 text-meta text-mute">
            Now: {person.position ?? "no position on record"}
            {person.contract_kind === null ? "" : ` · ${person.contract_kind}`}
          </p>
        )}
        {kind === "PROMOTION" && (
          <Field label="New position" required>
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
            required={kind === "SALARY"}
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
            required
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
          required
        >
          <Input
            type="date"
            value={effectiveOn}
            onChange={(event) => setEffectiveOn(event.target.value)}
          />
        </Field>
        <Field label="Why" required>
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
        <Field label="Store head" required>
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

type MonthChoice = (typeof MONTHS)[number]["value"]

function monthOf(which: MonthChoice): string {
  const now = new Date()
  return which === "this"
    ? isoMonth(now)
    : isoMonth(new Date(now.getFullYear(), now.getMonth() + 1, 1))
}

/// The one-off figures this shop has proposed for a month.
///
/// The month and the "Pay component" act sit in the toolbar on a desk and
/// behind the dock's gear on a phone — never at the top of the page.
function Components({
  scope,
  team,
  which,
  onWhich,
  onFile,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  which: MonthChoice
  onWhich: (next: MonthChoice) => void
  onFile: () => void
}) {
  const period = monthOf(which)
  const adjustments = useQuery({
    queryKey: hrKeys.adjustments(scope.unit_id, period),
    queryFn: ({ signal }) => adjustmentsAt(scope.unit_id, period, signal),
  })
  const [open, setOpen] = useState<PayrollAdjustmentRow | null>(null)

  return (
    <>
      {/* The phone's: the month as a row of the gear sheet, and the second act
          beside it. Renders nothing on a desk. */}
      <DockTools
        views={[
          {
            title: "Month",
            value: which,
            options: MONTHS.map((month) => ({
              value: month.value,
              label: month.label,
            })),
            onChange: (next) => onWhich(next as MonthChoice),
          },
        ]}
        actions={[{ label: "Pay component", onClick: onFile }]}
      />
      <div className="mb-3.5 flex flex-wrap items-center gap-2 max-md:hidden">
        <Segmented options={MONTHS} value={which} onChange={onWhich} />
        <span className="flex-1" />
        <Button onClick={onFile}>
          <Banknote />
          Pay component
        </Button>
      </div>

      {centreState(adjustments, {
        loading: "Reading the pay components…",
        what: "this shop's pay components",
        render: (rows) => (
          <>
            {rows.length > 0 && (
              <p className="mb-3 text-meta text-body">
                <b className="font-medium text-ink">{rows.length}</b>{" "}
                {rows.length === 1 ? "pay component" : "pay components"} for{" "}
                {readMonth(period)}
              </p>
            )}
            <PeopleTable
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={setOpen}
              empty={`No pay components for ${readMonth(period)}.`}
              card={(row) => {
                const state = adjustmentState(row)
                return {
                  ...personCard(team, row.employee_id, [row.label]),
                  lead: {
                    figure: `${row.kind === "DEDUCTION" ? "−" : "+"}${money(row.amount_minor)}`,
                    caption: row.kind === "DEDUCTION" ? "deduction" : "earning",
                  },
                  foot: {
                    info: <Status tone={state.tone}>{state.label}</Status>,
                    action: { label: "Open", onClick: () => setOpen(row) },
                  },
                }
              }}
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
                  cell: (row) => {
                    const state = adjustmentState(row)
                    return <Status tone={state.tone}>{state.label}</Status>
                  },
                },
              ]}
            />
          </>
        ),
      })}
      {open !== null && (
        <ComponentSheet
          key={open.id}
          row={open}
          team={team}
          scope={scope}
          period={period}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// Where a figure stands: still with the month's batch (the shop may withdraw
/// it) or submitted with the batch and frozen.
function adjustmentState(row: PayrollAdjustmentRow): {
  label: string
  tone: "warn" | "info"
} {
  return row.withdrawable
    ? { label: "Pending", tone: "warn" }
    : { label: "Submitted", tone: "info" }
}

/// One proposed figure. While it is still with the month's batch the shop may
/// withdraw it; once the batch is submitted it is read-only.
function ComponentSheet({
  row,
  team,
  scope,
  period,
  onClose,
}: {
  row: PayrollAdjustmentRow
  team: EmployeeList | undefined
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
  const state = adjustmentState(row)
  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Pay component"
      title={row.full_name ?? personName(team, row.employee_id)}
      sub={`${row.label} · ${readMonth(period)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        row.withdrawable ? (
          <SheetFoot>
            <Button
              variant="danger"
              disabled={reason.trim() === ""}
              pending={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              {withdraw.isPending ? "Withdrawing…" : "Withdraw pay component"}
            </Button>
          </SheetFoot>
        ) : undefined
      }
    >
      <Facts
        rows={[
          [
            "Amount",
            `${row.kind === "DEDUCTION" ? "−" : "+"}${money(row.amount_minor)}`,
          ],
          ["Kind", row.kind === "DEDUCTION" ? "Deduction" : "Earning"],
          ["Filed by", personByLogin(team, row.filed_by)],
          ["Filed on", moment(row.filed_at)],
          ["Because", row.reason, true],
        ]}
      />
      {row.withdrawable && (
        <div className="mt-6 flex flex-col gap-3">
          <Field label="Reason" required>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {withdraw.error !== null && (
            <Banner tone="bad">{describeCentre(withdraw.error)}</Banner>
          )}
        </div>
      )}
    </PeopleSheet>
  )
}

/// A new pay component, + or −, for one person for one month.
function ProposeComponent({
  scope,
  team,
  initial,
  onFiled,
  onClose,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  /// The month the list behind the sheet is showing: where the form opens.
  initial: MonthChoice
  /// Told the month the figure was filed for, so the list shows where it
  /// landed.
  onFiled: (which: MonthChoice) => void
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
  const [which, setWhich] = useState<MonthChoice>(initial)
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
      onFiled(which)
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New pay component"
      foot={
        <Submit
          label="Create pay component"
          pendingLabel="Creating…"
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
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
          required
        />
        <Field
          label="Component"
          required
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
          <Field label="Amount (Rp)" required>
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value.replace(/[^\d]/g, ""))
              }
            />
          </Field>
          <Field label="Payroll month" required>
            <Select
              value={which}
              onChange={(value) => setWhich(value as MonthChoice)}
            >
              {MONTHS.map((month) => (
                <option key={month.value} value={month.value}>
                  {readMonth(monthOf(month.value))}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Why, and on what basis" required>
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
