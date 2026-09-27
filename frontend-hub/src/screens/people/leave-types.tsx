import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Toggle } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  backingLabel,
  defineLeaveType,
  leaveKeys,
  listLeaveTypes,
  readDays,
  readLeavePolicy,
  type NewLeaveType,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// What kinds of leave exist, and the rules a balance folds under.
///
/// # One balance with a label beside it is the wrong model
///
/// It is the obvious one and it is wrong for most of Indonesian leave law —
/// wrong in the direction that takes days off people. **Cuti sakit** is not
/// deducted from anything: UU 13/2003 art. 93 obliges the employer to keep
/// paying an ill worker with a certificate, and a system that took sick days
/// out of the annual twelve would be taking something the law does not allow it
/// to take. **Cuti karena alasan penting** is bounded per *occurrence* — three
/// days to marry — not per year, and does not accumulate.
///
/// So a kind says what it draws on, and this screen makes that the first thing
/// you choose rather than a checkbox at the bottom.
///
/// # Nothing here is compiled in
///
/// Not the kinds — employers add their own, and a closed list would mean a
/// deploy for each one — and not the numbers. Three days for a marriage is a
/// figure from art. 93(4) that can be amended, and a constant in the code would
/// be quietly wrong from the day it was.
///
/// # There is no edit and no delete
///
/// Redefining a kind changes what every request already filed against it meant,
/// and deleting one leaves those requests pointing at nothing. A kind that
/// should no longer be used is one nobody picks.

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

export function LeaveTypes() {
  const kinds = useQuery({
    queryKey: leaveKeys.types(),
    queryFn: ({ signal }) => listLeaveTypes(signal),
  })
  const policy = useQuery({
    queryKey: leaveKeys.policy(),
    queryFn: ({ signal }) => readLeavePolicy(signal),
  })

  const generations = policy.data ?? []
  const inForce = generations.at(-1) ?? null

  return (
    <>
      {/* A balance cannot be computed at all until somebody answers the four
          questions a policy asks. Saying so is the point: the alternative is a
          default nobody decided, which becomes a rule by accident. */}
      {generations.length === 0 && (
        <Banner tone="bad" className="mb-4">
          No leave policy has been ratified. Until one is, a balance has no
          rules to fold under and balance-backed leave cannot be approved.
        </Banner>
      )}

      {inForce !== null && (
        <Card className="mb-4 overflow-hidden">
          <CardHeader>
            <CardTitle>In force</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            <KeyValue term="Since">{day(inForce.effective_from)}</KeyValue>
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
            <KeyValue term="During maternity or long sick leave">
              {inForce.protected_leave === "CONTINUES"
                ? "annual leave keeps accruing"
                : "accrual is suspended"}
            </KeyValue>
          </div>
        </Card>
      )}

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Kinds</CardTitle>
        </CardHeader>
        {queryState(kinds, {
          loading: "Reading the vocabulary…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No kinds of leave are defined, so nobody can ask for any.
              </EmptyState>
            ) : (
              <div className="px-4 pb-4">
                {rows.map((kind) => (
                  <div
                    key={kind.code}
                    className="flex items-baseline gap-3 border-b border-hairline py-2.5 last:border-0"
                  >
                    <span className="font-mono text-id text-body">
                      {kind.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {kind.name}
                    </span>
                    {/* The distinction that matters, said in the row rather
                        than hidden one click away: whether these days come out
                        of anybody's balance. */}
                    <Pill tone={kind.draws_on_balance ? "info" : "neutral"}>
                      {backingLabel(kind.backing)}
                      {kind.max_centidays !== null &&
                        ` · ${readDays(kind.max_centidays)}`}
                    </Pill>
                    {kind.requires_evidence && (
                      <Pill tone="warn">Needs evidence</Pill>
                    )}
                  </div>
                ))}
              </div>
            ),
        })}
      </Card>

      <DefineKind />
    </>
  )
}

function DefineKind() {
  const client = useQueryClient()
  const [draft, setDraft] = useState<NewLeaveType>({
    code: "",
    name: "",
    backing: "BALANCE",
    maxDays: undefined,
    payment: "FULL",
    requiresEvidence: false,
  })
  const [failed, setFailed] = useState<string | null>(null)

  const define = useMutation({
    mutationFn: () => defineLeaveType(draft),
    onSuccess: () => {
      setFailed(null)
      setDraft({
        code: "",
        name: "",
        backing: "BALANCE",
        maxDays: undefined,
        payment: "FULL",
        requiresEvidence: false,
      })
      void client.invalidateQueries({ queryKey: leaveKeys.types() })
    },
    onError: (error: Error) => {
      setFailed(error.message)
    },
  })

  // "Bounded by the certificate" with no certificate required is unbounded
  // leave nobody decided to grant, so the server refuses it — and the form
  // does not let it be typed.
  const certified = draft.backing === "AS_CERTIFIED"
  const perOccurrence = draft.backing === "PER_OCCURRENCE"
  const ready =
    draft.code.trim() !== "" &&
    draft.name.trim() !== "" &&
    (!perOccurrence || (draft.maxDays ?? 0) > 0)

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Define a kind</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}

        <Field label="Code" hint="Upper-cased, and never changes." required>
          <Input
            value={draft.code}
            onChange={(event) =>
              setDraft({ ...draft, code: event.target.value })
            }
            placeholder="CUTI_TAHUNAN"
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="Cuti Tahunan"
          />
        </Field>
        <Field
          label="Draws on"
          hint="The first thing to decide, not the last: it settles whether these days come out of anybody's balance."
        >
          <Select
            value={draft.backing}
            onChange={(next) =>
              setDraft({
                ...draft,
                backing: next as NewLeaveType["backing"],
                maxDays: undefined,
                // Certified leave must require its certificate; the server
                // refuses the pair, and offering it would be offering a
                // refusal.
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
            hint="The operator's figure, never a constant: three days for a marriage is UU 13/2003 art. 93(4), and it can be amended."
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
              setDraft({
                ...draft,
                payment: next as NewLeaveType["payment"],
              })
            }
          >
            {PAYMENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {/* A switch, not a two-row dropdown. Yes and No are not two things to
            choose between — they are one thing that is either on or off, and a
            control that makes you open a list to see which reads as a setting
            nobody has decided. */}
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

        <div>
          <Button
            variant="primary"
            pending={define.isPending}
            disabled={!ready}
            onClick={() => define.mutate()}
          >
            Define
          </Button>
        </div>
      </div>
    </Card>
  )
}
