import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { Toggle } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  backingLabel,
  blockLeave,
  defineLeaveType,
  leaveBlackouts,
  leaveExtraKeys,
  leaveKeys,
  liftLeaveBlock,
  listLeaveTypes,
  readDays,
  installLeavePolicy,
  readLeavePolicy,
  useReachableUnits,
  type NewLeaveType,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { ListCard, RowOpen, SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type { LeaveBlackoutView, LeavePolicyView } from "@itulah/contract"

/// Settings › Leave types — what kinds of leave exist, what each draws on, and
/// the dates head office has closed to leave.
///
/// A kind says what it draws on, and that is the first thing chosen: sick
/// leave is deducted from nothing (UU 13/2003 art. 93), a marriage is bounded
/// per occurrence, annual leave comes out of a balance. There is no edit and
/// no delete — redefining a kind would change what every request already filed
/// against it meant.
export function LeaveTypeSettings() {
  const canWrite = useCanWrite()
  const kinds = useQuery({
    queryKey: leaveKeys.types(),
    queryFn: ({ signal }) => listLeaveTypes(signal),
  })
  const policy = useQuery({
    queryKey: leaveKeys.policy(),
    queryFn: ({ signal }) => readLeavePolicy(signal),
  })
  const blocks = useQuery({
    queryKey: leaveExtraKeys.blackouts(),
    queryFn: ({ signal }) => leaveBlackouts(signal),
  })
  const units = useReachableUnits()
  const named = new Map((units.data ?? []).map((one) => [one.id, one.name]))

  const generations = policy.data ?? []
  const inForce = generations.at(-1) ?? null

  const newType = useOpener()
  const closing = useOpener()
  const newPolicy = useOpener()
  const block = useOpener<LeaveBlackoutView>()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Leave types"
        sub="What kinds of leave exist, what each draws on, and the dates closed to leave."
        actions={
          canWrite && (
            <>
              <Button onClick={() => newPolicy.show()}>Leave policy</Button>
              <Button onClick={() => closing.show()}>Close dates</Button>
              <Button variant="primary" onClick={() => newType.show()}>
                New type
              </Button>
            </>
          )
        }
      />

      {/* A balance cannot be computed until somebody answers the questions a
          policy asks. Saying so beats a default nobody decided. */}
      {policy.isSuccess && generations.length === 0 && (
        <Banner tone="bad" className="mb-4">
          No leave policy has been ratified. Until one is, a balance has no
          rules to fold under and balance-backed leave cannot be approved.
        </Banner>
      )}

      <ListCard title="Kinds of leave">
        {queryState(kinds, {
          loading: "Reading the vocabulary…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No kinds of leave are defined, so nobody can ask for any. Add
                the first with New type.
              </EmptyState>
            ) : (
              <MiniTable head={["Code", "Name", "Draws on", "Paid", ""]}>
                {rows.map((kind) => (
                  <MiniRow key={kind.code}>
                    <MiniCell>
                      <span className="font-mono text-id text-body">
                        {kind.code}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      <span className="text-ink">{kind.name}</span>
                    </MiniCell>
                    <MiniCell>
                      <Pill tone={kind.draws_on_balance ? "info" : "neutral"}>
                        {backingLabel(kind.backing)}
                        {kind.max_centidays !== null &&
                          ` · ${readDays(kind.max_centidays)}`}
                      </Pill>
                    </MiniCell>
                    <MiniCell>{paymentLabel(kind.payment)}</MiniCell>
                    <MiniCell>
                      {kind.requires_evidence && (
                        <Pill tone="warn">Needs evidence</Pill>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      {inForce !== null && (
        <Card className="mb-4 overflow-hidden">
          <CardHeader>
            <CardTitle>Balance policy in force</CardTitle>
            <span className="text-[0.875rem] text-mute">
              since {day(inForce.effective_from)}
            </span>
          </CardHeader>
          <div className="px-4 pb-3">
            <KeyValue term="A year is worth">
              {readDays(inForce.annual_centidays)}
            </KeyValue>
            <KeyValue term="Arrives">
              {inForce.accrual === "MONTHLY"
                ? "a twelfth each completed month"
                : "all at once, on day one"}
            </KeyValue>
            <KeyValue term="Carries forward">
              {inForce.carry_forward === "FORBIDDEN"
                ? "nothing"
                : `up to ${readDays(inForce.carry_forward_cap_centidays ?? 0)}, lapsing ${inForce.carry_forward_expires_on ?? ""}`}
            </KeyValue>
            <KeyValue term="Encashment">
              {inForce.encashment === "FORBIDDEN"
                ? "not allowed"
                : `up to ${readDays(inForce.encashment_max_centidays ?? 0)} a year`}
            </KeyValue>
            <KeyValue term="Earned after">
              {inForce.eligibility_months === 0
                ? "the first day of work"
                : `${inForce.eligibility_months} months of service`}
            </KeyValue>
            {inForce.accrual === "UP_FRONT" && (
              <KeyValue term="Somebody starting part-way through a year">
                {inForce.joiner === "PRORATE"
                  ? "gets the twelfths left in that year"
                  : "gets the whole year"}
              </KeyValue>
            )}
            <KeyValue term="During maternity or long sick leave">
              {inForce.protected_leave === "CONTINUES"
                ? "annual leave keeps accruing"
                : "accrual is suspended"}
            </KeyValue>
          </div>
        </Card>
      )}

      <ListCard title="Dates closed to leave">
        {queryState(blocks, {
          loading: "Reading the closed dates…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No date is closed. Close the Lebaran rush or stock-take week
                with Close dates so nobody can take leave on them.
              </EmptyState>
            ) : (
              <MiniTable head={["Dates", "Where", "Why", "State"]}>
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>
                      <RowOpen onClick={() => block.show(row)}>
                        {day(row.from_date)} – {day(row.to_date)}
                      </RowOpen>
                    </MiniCell>
                    <MiniCell>
                      {row.unit_id === null
                        ? "Every unit"
                        : (named.get(row.unit_id) ?? row.unit_id)}
                    </MiniCell>
                    <MiniCell>{row.reason}</MiniCell>
                    <MiniCell>
                      {row.lifted ? (
                        <Pill tone="neutral">Lifted</Pill>
                      ) : (
                        <Pill tone="warn">Closed</Pill>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      <NewTypeSheet
        key={`type-${newType.n}`}
        open={newType.isOpen}
        onClose={newType.hide}
      />
      <LeavePolicySheet
        key={`policy-${newPolicy.n}`}
        open={newPolicy.isOpen}
        onClose={newPolicy.hide}
        last={inForce}
      />
      <CloseDatesSheet
        key={`close-${closing.n}`}
        open={closing.isOpen}
        onClose={closing.hide}
      />
      <BlockSheet
        key={`block-${block.n}`}
        open={block.isOpen}
        onClose={block.hide}
        row={block.item}
        where={
          block.item?.unit_id
            ? (named.get(block.item.unit_id) ?? block.item.unit_id)
            : "Every unit"
        }
        canWrite={canWrite}
      />
    </PageContent>
  )
}

const BACKINGS = [
  {
    value: "BALANCE",
    label: "From a balance — accrues, carries forward, runs out",
  },
  {
    value: "PER_OCCURRENCE",
    label: "Per occurrence — a fixed allowance per event",
  },
  {
    value: "AS_CERTIFIED",
    label: "As certified — bounded by evidence, deducts from nothing",
  },
] as const

const PAYMENTS = [
  { value: "FULL", label: "Full pay" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "STATUTORY_SCALE", label: "Statutory scale (art. 93(2))" },
] as const

function paymentLabel(payment: string): string {
  return PAYMENTS.find((one) => one.value === payment)?.label ?? payment
}

function NewTypeSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<NewLeaveType>({
    code: "",
    name: "",
    backing: "BALANCE",
    maxDays: undefined,
    payment: "FULL",
    requiresEvidence: false,
  })
  const define = useMutation({
    mutationFn: () => defineLeaveType(draft),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: leaveKeys.types() })
      onClose()
    },
  })

  // "Bounded by the certificate" with no certificate required is unbounded
  // leave nobody decided to grant, so the form does not let it be typed.
  const certified = draft.backing === "AS_CERTIFIED"
  const perOccurrence = draft.backing === "PER_OCCURRENCE"
  const ready =
    draft.code.trim() !== "" &&
    draft.name.trim() !== "" &&
    (!perOccurrence || (draft.maxDays ?? 0) > 0)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New leave type"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => define.mutate()}
          saveLabel="Define"
          pendingLabel="Defining…"
          pending={define.isPending}
          disabled={!ready}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={define.error} />
        <Field label="Code" hint="Upper-cased, and never changes." required>
          <Input
            value={draft.code}
            onChange={(event) =>
              setDraft({ ...draft, code: event.target.value })
            }
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </Field>
        <Field
          label="Draws on"
          hint="Settles whether these days come out of anybody's balance."
        >
          <Select
            value={draft.backing}
            onChange={(next) =>
              setDraft({
                ...draft,
                backing: next as NewLeaveType["backing"],
                maxDays: undefined,
                // Certified leave must require its certificate; the server
                // refuses the pair.
                requiresEvidence:
                  next === "AS_CERTIFIED" ? true : draft.requiresEvidence,
              })
            }
          >
            {BACKINGS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {perOccurrence && (
          <Field
            label="Days per occurrence"
            required
            hint="Your figure, never a constant: three days for a marriage is UU 13/2003 art. 93(4), and it can be amended."
          >
            <Input
              type="number"
              min={1}
              value={draft.maxDays ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  maxDays: Number(event.target.value) || undefined,
                })
              }
            />
          </Field>
        )}
        <Field label="Paid">
          <Select
            value={draft.payment}
            onChange={(next) =>
              setDraft({ ...draft, payment: next as NewLeaveType["payment"] })
            }
          >
            {PAYMENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Toggle
          on={draft.requiresEvidence}
          onToggle={() =>
            !certified &&
            setDraft({ ...draft, requiresEvidence: !draft.requiresEvidence })
          }
          label="Needs supporting evidence"
          note={
            draft.requiresEvidence
              ? "A request under this type is not complete until a document is attached."
              : "A request under this type is filed on its own word."
          }
        />
      </div>
    </Sheet>
  )
}

function CloseDatesSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const units = useReachableUnits()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [unit, setUnit] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      blockLeave({
        from_date: from,
        to_date: to,
        unit_id: unit,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: leaveExtraKeys.blackouts() })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Close dates to leave"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="Close these dates"
          pending={save.isPending}
          disabled={from === "" || to === "" || reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error} />
        <p className="text-[0.875rem] text-body">
          A request that would charge a closed date is refused when it is filed.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="To" required>
            <Day value={to} onChange={setTo} notBefore={from || null} />
          </Field>
        </div>
        <Field label="Where">
          <PickOne
            label="Where"
            choices={(units.data ?? []).map((one) => ({
              value: one.id,
              label: one.name,
            }))}
            value={unit}
            onChange={setUnit}
          />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// A closed range: its facts, and lifting it — which asks why.
function BlockSheet({
  open,
  onClose,
  row,
  where,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  row: LeaveBlackoutView | null
  where: string
  canWrite: boolean
}) {
  const client = useQueryClient()
  const [why, setWhy] = useState("")
  const lift = useMutation({
    mutationFn: () => liftLeaveBlock(row?.id ?? "", why.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: leaveExtraKeys.blackouts() })
      onClose()
    },
  })
  const liftable = canWrite && row !== null && !row.lifted
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={
        row ? `${day(row.from_date)} – ${day(row.to_date)}` : "Closed dates"
      }
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={liftable ? () => lift.mutate() : undefined}
          saveLabel="Lift the closure"
          pendingLabel="Lifting…"
          pending={lift.isPending}
          disabled={why.trim() === ""}
        />
      }
    >
      {row && (
        <div className="flex flex-col gap-4">
          <Facts>
            <Fact term="Where">{where}</Fact>
            <Fact term="State">{row.lifted ? "Lifted" : "Closed"}</Fact>
            <Fact term="Closed by">{row.defined_by}</Fact>
            <Fact term="Why">{row.reason}</Fact>
          </Facts>
          {liftable && (
            <Field label="Why lift it" required>
              <Input
                value={why}
                onChange={(event) => setWhy(event.target.value)}
              />
            </Field>
          )}
          <Problem error={lift.error} />
        </div>
      )}
    </Sheet>
  )
}

/// A new generation of the leave policy, starting from the one in force.
/// Every question is answered on the form — no field quietly means "off".
function LeavePolicySheet({
  open,
  onClose,
  last,
}: {
  open: boolean
  onClose: () => void
  last: LeavePolicyView | null
}) {
  const client = useQueryClient()
  const [from, setFrom] = useState("")
  const [annual, setAnnual] = useState(
    last === null ? "12" : String(last.annual_centidays / 100)
  )
  const [accrual, setAccrual] = useState(last?.accrual ?? "MONTHLY")
  const [eligibility, setEligibility] = useState(
    String(last?.eligibility_months ?? 12)
  )
  const [joiner, setJoiner] = useState(last?.joiner ?? "PRORATE")
  const [carryDays, setCarryDays] = useState(
    last?.carry_forward_cap_centidays == null
      ? ""
      : String(last.carry_forward_cap_centidays / 100)
  )
  const [carryLapse, setCarryLapse] = useState(
    last?.carry_forward_expires_on ?? "03-31"
  )
  const [encash, setEncash] = useState(
    last?.encashment_max_centidays == null
      ? ""
      : String(last.encashment_max_centidays / 100)
  )
  const [protectedLeave, setProtectedLeave] = useState(
    last?.protected_leave ?? "CONTINUES"
  )
  const whole = (raw: string) => Number(raw.replace(/\D/g, ""))
  const ready =
    from !== "" &&
    whole(annual) > 0 &&
    eligibility !== "" &&
    (carryDays.trim() === "" || /^\d{2}-\d{2}$/.test(carryLapse))
  const save = useMutation({
    mutationFn: () =>
      installLeavePolicy({
        version: (last?.version ?? 0) + 1,
        effective_from: from,
        annual_days: whole(annual),
        accrual,
        ...(carryDays.trim() === ""
          ? {}
          : {
              carry_forward_days: whole(carryDays),
              carry_forward_expires_on: carryLapse,
            }),
        ...(encash.trim() === "" ? {} : { encashment_max_days: whole(encash) }),
        protected_leave: protectedLeave,
        eligibility_months: whole(eligibility),
        joiner,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: leaveKeys.policy() })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Leave policy"
      caption="A new version from a date; earlier months keep the rules they ran under."
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => save.mutate()}
          saveLabel="Ratify this version"
          pendingLabel="Ratifying…"
          pending={save.isPending}
          disabled={!ready}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="From" required>
          <Day value={from} onChange={setFrom} />
        </Field>
        <Field label="Annual leave a year" required aside="days">
          <Input
            inputMode="numeric"
            value={annual}
            onChange={(event) => setAnnual(event.target.value)}
          />
        </Field>
        <Field label="It arrives" required>
          <Select value={accrual} onChange={setAccrual}>
            <option value="MONTHLY">A twelfth each month</option>
            <option value="UP_FRONT">All at once</option>
          </Select>
        </Field>
        <Field
          label="Earned after"
          required
          aside="months of service"
          hint="UU 13/2003 art. 79: after 12 months of continuous work. 0 is from the first day."
        >
          <Input
            inputMode="numeric"
            value={eligibility}
            onChange={(event) =>
              setEligibility(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        {accrual === "UP_FRONT" && (
          <Field label="Somebody starting part-way through a year" required>
            <Select value={joiner} onChange={setJoiner}>
              <option value="PRORATE">
                Gets the twelfths left in that year
              </option>
              <option value="FULL">Gets the whole year</option>
            </Select>
          </Field>
        )}
        <Field label="Carried into next year" aside="days; empty for none">
          <Input
            inputMode="numeric"
            value={carryDays}
            onChange={(event) => setCarryDays(event.target.value)}
          />
        </Field>
        {carryDays.trim() !== "" && (
          <Field label="Carried days lapse on" required aside="MM-DD">
            <Input
              value={carryLapse}
              onChange={(event) => setCarryLapse(event.target.value)}
            />
          </Field>
        )}
        <Field label="May be paid out" aside="days a year; empty for never">
          <Input
            inputMode="numeric"
            value={encash}
            onChange={(event) => setEncash(event.target.value)}
          />
        </Field>
        <Field label="During maternity or long sick leave" required>
          <Select value={protectedLeave} onChange={setProtectedLeave}>
            <option value="CONTINUES">Annual leave keeps accruing</option>
            <option value="SUSPENDED">Accrual is suspended</option>
          </Select>
        </Field>
        {save.error !== null && <Problem error={save.error} />}
      </div>
    </Sheet>
  )
}
