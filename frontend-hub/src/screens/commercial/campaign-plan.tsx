import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { ErrorState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  acknowledgeCampaignBreach,
  campaignKeys,
  campaignPlan,
  checkCampaignGuardrails,
  deleteCampaignActivity,
  saveCampaignActivity,
  saveCampaignPlan,
  type CampaignActivityRow,
  type CampaignGuardrailRow,
  type CampaignPlanView,
  type CampaignScopeEntry,
} from "@/lib/queries/commercial"
import { percent } from "@/screens/commercial/shared"
import { Quiet } from "@/screens/commercial/parts"

/// What a campaign RUNS, where it was DECLARED to run, and the lines it must
/// not cross.
///
/// The three facts a campaign could not state until migrations 0173 and 0174,
/// and each of them was previously inferred or missing:
///
///   * what it runs was readable only by opening every published book and
///     grouping rules by a JSON field — and half of what a campaign does (a
///     poster, an email) is in no book at all;
///   * where it runs was inferred from the scope of those rules, which is
///     backwards: a campaign whose rules happen to name six shops is not the
///     same statement as a campaign declared to run in six;
///   * the lines did not exist.
///
/// Nothing on this panel reaches a till. The one act here that can change what
/// a shop does is "Check now", and it does it the only way the estate allows —
/// by measuring at the centre and pulling `switch_campaign`.
export function CampaignPlan({ campaignId }: { campaignId: string }) {
  const plan = useQuery({
    queryKey: campaignKeys.plan(campaignId),
    queryFn: ({ signal }) => campaignPlan(campaignId, signal),
    retry: false,
  })

  if (plan.isError) return <ErrorState error={plan.error} />
  if (plan.data === undefined) {
    return <Quiet>Reading what this campaign runs…</Quiet>
  }

  return (
    <>
      <Activities campaignId={campaignId} plan={plan.data} />
      <Reach campaignId={campaignId} plan={plan.data} />
      <Rails campaignId={campaignId} plan={plan.data} />
    </>
  )
}

const KINDS: readonly { value: string; label: string; needsRef: boolean }[] = [
  { value: "PROMOTION", label: "Promotion", needsRef: true },
  { value: "MARKDOWN", label: "Clearance drop", needsRef: true },
  { value: "COUPON_SET", label: "Coupon set", needsRef: true },
  { value: "PLACEMENT", label: "Poster or banner", needsRef: false },
  { value: "MESSAGE", label: "Email or push", needsRef: false },
]

function kindLabel(value: string): string {
  return KINDS.find((one) => one.value === value)?.label ?? value
}

/// The things the campaign does.
function Activities({
  campaignId,
  plan,
}: {
  campaignId: string
  plan: CampaignPlanView
}) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)

  const forget = useMutation({
    mutationFn: (activityId: string) =>
      deleteCampaignActivity(campaignId, activityId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: campaignKeys.all })
    },
  })

  const file = useMutation({
    mutationFn: (ruleId: string) =>
      saveCampaignActivity(campaignId, crypto.randomUUID(), {
        kind: "PROMOTION",
        name: ruleId,
        ref_id: ruleId,
        status: "LIVE",
        starts_on: null,
        ends_on: null,
        cost_minor: null,
        detail: null,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: campaignKeys.all })
    },
  })

  return (
    <div>
      <SubHead
        aside={
          <button
            type="button"
            onClick={() => setAdding((open) => !open)}
            className="text-accent hover:underline"
          >
            {adding ? "Close" : "Add"}
          </button>
        }
      >
        What it runs
      </SubHead>

      {adding && (
        <ActivityForm
          campaignId={campaignId}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}

      {plan.activities.length === 0 ? (
        <Quiet>Nothing added yet.</Quiet>
      ) : (
        <div className="flex flex-col gap-1.5">
          {plan.activities.map((one) => (
            <Activity
              key={one.activity_id}
              activity={one}
              busy={forget.isPending}
              onForget={() => forget.mutate(one.activity_id)}
            />
          ))}
        </div>
      )}

      {forget.isError && (
        <div className="mt-2">
          <ErrorState error={forget.error} />
        </div>
      )}

      {plan.undeclared_rule_ids.length > 0 && (
        <div className="mt-2.5 rounded-inner border border-hairline px-3 py-2.5">
          <div className="text-eyebrow font-medium text-body">
            In the books and not in the plan
          </div>
          {/* Published offers that name this campaign and that no activity
              here claims. They run either way; a press files one. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {plan.undeclared_rule_ids.map((ruleId) => (
              <button
                key={ruleId}
                type="button"
                disabled={file.isPending}
                onClick={() => file.mutate(ruleId)}
                className="rounded-full border border-hairline px-2.5 py-1 font-mono text-[0.875rem] text-body hover:bg-soft"
              >
                {ruleId} +
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Activity({
  activity,
  busy,
  onForget,
}: {
  activity: CampaignActivityRow
  busy: boolean
  onForget: () => void
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-inner bg-soft px-3 py-2">
      <Pill tone={activity.status === "DROPPED" ? "warn" : "neutral"}>
        {kindLabel(activity.kind)}
      </Pill>
      <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
        {activity.name}
      </span>
      {activity.ref_id !== null && (
        <span className="font-mono text-[0.875rem] text-mute">
          {activity.ref_id}
        </span>
      )}
      {activity.declared_in_book === false && (
        // The activity claims a rule the published books file elsewhere. That
        // rule's takings are attributed to another campaign in every report, so
        // this one is reading somebody else's numbers.
        <span className="text-[0.875rem] text-bad-fg">not in any book</span>
      )}
      {activity.starts_on !== null && (
        <span className="text-[0.875rem] text-mute tabular-nums">
          {day(activity.starts_on)}
          {activity.ends_on !== null && ` – ${day(activity.ends_on)}`}
        </span>
      )}
      {activity.cost_minor !== null && (
        <span className="text-[0.875rem] text-body tabular-nums">
          {money(activity.cost_minor)}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onForget}
        className="text-[0.875rem] text-mute hover:text-bad-fg"
      >
        Remove
      </button>
    </div>
  )
}

function ActivityForm({
  campaignId,
  onDone,
  onCancel,
}: {
  campaignId: string
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [kind, setKind] = useState(KINDS[0].value)
  const [name, setName] = useState("")
  const [reference, setReference] = useState("")
  const [starts, setStarts] = useState("")
  const [ends, setEnds] = useState("")
  const [cost, setCost] = useState("")

  const needsRef = KINDS.find((one) => one.value === kind)?.needsRef ?? false

  const add = useMutation({
    mutationFn: () =>
      // The id is minted here rather than by the server, so a retried request
      // writes one poster and not two.
      saveCampaignActivity(campaignId, crypto.randomUUID(), {
        kind,
        name: name.trim(),
        ref_id: reference.trim() === "" ? null : reference.trim(),
        status: "PLANNED",
        starts_on: starts === "" ? null : starts,
        ends_on: ends === "" ? null : ends,
        cost_minor: cost.trim() === "" ? null : Number(cost),
        detail: null,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: campaignKeys.all })
      onDone()
    },
  })

  const problem =
    name.trim() === ""
      ? "Give it a name."
      : needsRef && reference.trim() === ""
        ? "Add the rule id, markdown id or code."
        : ends !== "" && starts !== "" && ends < starts
          ? "It cannot end before it starts."
          : undefined

  return (
    <div className="mb-2.5 rounded-card border border-hairline px-3.5 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select value={kind} onChange={setKind}>
            {KINDS.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Window poster, 13 shops"
          />
        </Field>
        <Field label={needsRef ? "Reference" : "Reference (optional)"}>
          <Input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="rule-leb-1"
            className="font-mono"
          />
        </Field>
        {/* Printing, a mailing list, an agency — never the discount it gives
            away, which is measured from the tills. */}
        <Field label="Cost">
          <Money
            value={cost}
            onChange={setCost}
            prefix="Rp"
            placeholder="0"
            label="Cost"
          />
        </Field>
        <Field label="Starts">
          <Day value={starts} onChange={setStarts} placeholder="Not set" />
        </Field>
        <Field label="Ends">
          <Day
            value={ends}
            onChange={setEnds}
            placeholder="Not set"
            notBefore={starts === "" ? null : starts}
          />
        </Field>
      </div>

      {add.isError && (
        <div className="mt-3">
          <ErrorState error={add.error} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 text-[0.875rem] text-bad">
          {problem ?? ""}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={problem !== undefined || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "Adding…" : "Add"}
          </Button>
        </span>
      </div>
    </div>
  )
}

/// Each with an example of how its values are spelled, shown as the
/// placeholder of the box they are typed into.
const DIMENSIONS: readonly {
  value: string
  label: string
  example: string
}[] = [
  { value: "SITE", label: "Shops", example: "store-01" },
  { value: "CHANNEL", label: "Channels", example: "STORE" },
  { value: "SEGMENT", label: "Member segments", example: "GOLD" },
  { value: "DIVISION", label: "Divisions", example: "MEN" },
  { value: "ARTICLE", label: "Styles", example: "ART-0001" },
  { value: "TAG", label: "Tags", example: "summer" },
]

/// Where the campaign was DECLARED to run, beside what its book actually binds.
///
/// The declaration enforces nothing and must not: `commercial_campaign.site_ids`
/// rides in the published book, a till parses it, and an offer inside the
/// campaign runs where both lists allow. A second spelling of that fact would
/// be a second parser on the edge. What this adds is the statement the book
/// cannot make — and the disagreement between the two, which is the only thing
/// on this panel nobody could see before.
function Reach({
  campaignId,
  plan,
}: {
  campaignId: string
  plan: CampaignPlanView
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<readonly CampaignScopeEntry[] | null>(null)
  const [dimension, setDimension] = useState(DIMENSIONS[0].value)
  const [value, setValue] = useState("")

  const declared = draft ?? plan.scope.declared
  const editing = draft !== null

  const save = useMutation({
    mutationFn: (next: readonly CampaignScopeEntry[]) =>
      saveCampaignPlan(campaignId, {
        scope: [...next],
        // Restated whole, and the rails are part of the same document — sending
        // an empty list here would silently retire every limit on the campaign.
        guardrails: plan.guardrails.map((one) => ({
          measure: one.measure,
          threshold: one.threshold,
          breach_action: one.breach_action,
          active: one.active,
          note: one.note,
        })),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: campaignKeys.all })
      setDraft(null)
    },
  })

  const add = () => {
    const trimmed = value.trim()
    if (trimmed === "") return
    if (
      declared.some(
        (one) => one.dimension === dimension && one.value === trimmed
      )
    ) {
      setValue("")
      return
    }
    setDraft([...declared, { dimension, value: trimmed }])
    setValue("")
  }

  return (
    <div>
      <SubHead
        aside={
          editing ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-mute hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate(declared)}
                className="text-accent hover:underline"
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setDraft(plan.scope.declared)}
              className="text-accent hover:underline"
            >
              Declare
            </button>
          )
        }
      >
        Where it runs
      </SubHead>

      <div className="rounded-card border border-hairline px-3.5 py-3">
        {declared.length === 0 ? (
          <p className="text-meta text-body">Everywhere, for everybody.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {DIMENSIONS.filter((one) =>
              declared.some((entry) => entry.dimension === one.value)
            ).map((one) => (
              <div
                key={one.value}
                className="flex flex-wrap items-baseline gap-1.5"
              >
                <span className="text-eyebrow text-mute">{one.label}</span>
                {declared
                  .filter((entry) => entry.dimension === one.value)
                  .map((entry) => (
                    <span
                      key={entry.value}
                      className="inline-flex items-center gap-1 rounded-full bg-soft px-2.5 py-0.5 text-[0.875rem] text-body"
                    >
                      {entry.value}
                      {editing && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft(
                              declared.filter(
                                (other) =>
                                  !(
                                    other.dimension === entry.dimension &&
                                    other.value === entry.value
                                  )
                              )
                            )
                          }
                          className="text-mute hover:text-bad-fg"
                          aria-label={`Remove ${entry.value}`}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Add" className="w-40">
              <Select value={dimension} onChange={setDimension}>
                {DIMENSIONS.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Value" className="min-w-44 flex-1">
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    add()
                  }
                }}
                placeholder={
                  DIMENSIONS.find((one) => one.value === dimension)?.example
                }
              />
            </Field>
            <Button variant="ghost" onClick={add}>
              Add
            </Button>
            {plan.scope.binding_site_ids !== null &&
              plan.scope.binding_site_ids.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setDraft([
                      ...declared.filter((one) => one.dimension !== "SITE"),
                      ...(plan.scope.binding_site_ids ?? []).map((site) => ({
                        dimension: "SITE",
                        value: site,
                      })),
                    ])
                  }
                >
                  Take the book's shops
                </Button>
              )}
          </div>
        )}

        {save.isError && (
          <div className="mt-3">
            <ErrorState error={save.error} />
          </div>
        )}

        <Drift plan={plan} />
      </div>
    </div>
  )
}

/// Where the declaration and the book disagree.
function Drift({ plan }: { plan: CampaignPlanView }) {
  const { binding_site_ids, declared_not_bound, bound_not_declared } =
    plan.scope
  const declaredSites = plan.scope.declared.filter(
    (one) => one.dimension === "SITE"
  )
  const wideOpen =
    declaredSites.length > 0 &&
    (binding_site_ids === null || binding_site_ids.length === 0)

  if (
    !wideOpen &&
    declared_not_bound.length === 0 &&
    bound_not_declared.length === 0
  ) {
    return null
  }
  return (
    <p className="mt-3 text-[0.875rem] leading-relaxed text-warn-fg">
      {wideOpen && (
        <>
          Declared for {count(declaredSites.length)} shop
          {declaredSites.length === 1 ? "" : "s"}, and the published book
          narrows nothing — so the offers inside it reach every shop that holds
          the book. Narrowing that is a new book, not a change here.
        </>
      )}
      {declared_not_bound.length > 0 && (
        <>
          {" "}
          Declared but not carried by the book: {declared_not_bound.join(", ")}.
          Nothing runs there.
        </>
      )}
      {bound_not_declared.length > 0 && (
        <>
          {" "}
          Carried by the book and never declared:{" "}
          {bound_not_declared.join(", ")}.
        </>
      )}
    </p>
  )
}

const MEASURES: readonly {
  value: string
  label: string
  unit: "money" | "bps"
}[] = [
  {
    value: "SPEND_MINOR",
    label: "Given away, in total",
    unit: "money",
  },
  {
    value: "SPEND_PER_DAY_MINOR",
    label: "Given away, a day",
    unit: "money",
  },
  {
    value: "DISCOUNT_RATE_BPS",
    label: "Discount rate, at most",
    unit: "bps",
  },
  {
    value: "MARGIN_BPS",
    label: "Margin, at least",
    unit: "bps",
  },
  {
    value: "AVERAGE_BASKET_MINOR",
    label: "Average basket, at least",
    unit: "money",
  },
]

function measureOf(value: string) {
  return MEASURES.find((one) => one.value === value)
}

function drawLimit(measure: string, value: number): string {
  return measureOf(measure)?.unit === "bps" ? percent(value) : money(value)
}

/// The lines the campaign must not cross.
///
/// **A brake at the centre, not a gate at the till.** No till is sent any of
/// this and none could enforce it: a shop's figures are only as fresh as its
/// last sync, so a rail is always crossed by more than the line before anybody
/// here can see it. What a rail buys is that somebody sees it at all — and, for
/// the ones set to stop the campaign, that the pause is dispatched to every
/// shop the moment the centre knows.
function Rails({
  campaignId,
  plan,
}: {
  campaignId: string
  plan: CampaignPlanView
}) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [measure, setMeasure] = useState(MEASURES[0].value)
  const [threshold, setThreshold] = useState("")
  const [action, setAction] = useState("WARN")

  const asInput = (rails: readonly CampaignGuardrailRow[]) =>
    rails.map((one) => ({
      measure: one.measure,
      threshold: one.threshold,
      breach_action: one.breach_action,
      active: one.active,
      note: one.note,
    }))

  const scope = plan.scope.declared.map((one) => ({
    dimension: one.dimension,
    value: one.value,
  }))

  const write = useMutation({
    mutationFn: (rails: readonly CampaignGuardrailRow[]) =>
      saveCampaignPlan(campaignId, { scope, guardrails: asInput(rails) }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: campaignKeys.all })
      setAdding(false)
      setThreshold("")
    },
  })

  const check = useMutation({
    mutationFn: () => checkCampaignGuardrails(campaignId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: campaignKeys.all })
    },
  })

  const acknowledge = useMutation({
    mutationFn: (breachId: string) =>
      acknowledgeCampaignBreach(campaignId, breachId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: campaignKeys.all })
    },
  })

  const limit = threshold.trim() === "" ? null : Number(threshold)
  const chosen = measureOf(measure)
  const problem =
    limit === null || Number.isNaN(limit)
      ? "A limit is a number."
      : chosen?.unit === "bps" && limit > 10_000
        ? "A rate cannot pass 100%."
        : plan.guardrails.some((one) => one.measure === measure)
          ? "There is already a limit on that."
          : undefined

  return (
    <div>
      <SubHead
        aside={
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={check.isPending || plan.guardrails.length === 0}
              onClick={() => check.mutate()}
              className="text-accent hover:underline disabled:text-mute"
            >
              {check.isPending ? "Measuring…" : "Check now"}
            </button>
            <button
              type="button"
              onClick={() => setAdding((open) => !open)}
              className="text-accent hover:underline"
            >
              {adding ? "Close" : "Add"}
            </button>
          </span>
        }
      >
        What it must not cross
      </SubHead>

      {adding && (
        <div className="mb-2.5 rounded-card border border-hairline px-3.5 py-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Measure" className="sm:col-span-2">
              <Select value={measure} onChange={setMeasure}>
                {MEASURES.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Limit">
              <Money
                value={threshold}
                onChange={setThreshold}
                prefix={chosen?.unit === "money" ? "Rp" : undefined}
                suffix={chosen?.unit === "bps" ? "bps" : undefined}
                label="Limit"
              />
            </Field>
            {/* Stopping dispatches a pause to every shop. Shops are always a
                little behind, so the line is crossed before anyone here sees
                it. */}
            <Field label="When it is crossed" className="sm:col-span-3">
              <Select value={action} onChange={setAction}>
                <option value="WARN">Say so here</option>
                <option value="PAUSE_CAMPAIGN">Stop the campaign</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="min-w-0 text-[0.875rem] text-bad">
              {problem ?? ""}
            </span>
            <Button
              variant="primary"
              disabled={problem !== undefined || write.isPending}
              onClick={() =>
                write.mutate([
                  ...plan.guardrails,
                  {
                    // The server mints the id and decides the direction from
                    // the measure; these two are placeholders that never leave
                    // the browser.
                    guardrail_id: "",
                    campaign_id: campaignId,
                    measure,
                    direction: "AT_MOST",
                    threshold: limit ?? 0,
                    breach_action: action,
                    active: true,
                    note: null,
                    created_at: "",
                    created_by: "",
                  },
                ])
              }
            >
              {write.isPending ? "Saving…" : "Set the limit"}
            </Button>
          </div>
        </div>
      )}

      {plan.guardrails.length === 0 ? (
        <Quiet>No limit set.</Quiet>
      ) : (
        <div className="flex flex-col gap-1.5">
          {plan.guardrails.map((rail) => {
            const reading = check.data?.readings.find(
              (one) => one.guardrail_id === rail.guardrail_id
            )
            return (
              <div
                key={rail.guardrail_id}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-inner bg-soft px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
                  {measureOf(rail.measure)?.label ?? rail.measure}
                </span>
                <span className="text-[0.875rem] text-body tabular-nums">
                  {rail.direction === "AT_MOST" ? "≤ " : "≥ "}
                  {drawLimit(rail.measure, rail.threshold)}
                </span>
                {reading !== undefined && (
                  <span
                    className={cnTone(reading.breached)}
                    title={reading.note ?? undefined}
                  >
                    {reading.observed === null
                      ? "—"
                      : drawLimit(rail.measure, reading.observed)}
                  </span>
                )}
                {rail.breach_action === "PAUSE_CAMPAIGN" && (
                  <Pill tone="warn">Stops it</Pill>
                )}
                <button
                  type="button"
                  disabled={write.isPending}
                  onClick={() =>
                    write.mutate(
                      plan.guardrails.filter(
                        (one) => one.guardrail_id !== rail.guardrail_id
                      )
                    )
                  }
                  className="text-[0.875rem] text-mute hover:text-bad-fg"
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}

      {(write.isError || check.isError) && (
        <div className="mt-2">
          <ErrorState error={write.error ?? check.error} />
        </div>
      )}

      {check.data?.paused === true && (
        <p className="mt-2 text-[0.875rem] leading-relaxed text-bad-fg">
          A limit set to stop the campaign was crossed, so the campaign has been
          paused and the pause dispatched to every shop.
        </p>
      )}

      {plan.open_breaches.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {plan.open_breaches.map((breach) => (
            <div
              key={breach.breach_id}
              className="rounded-inner border border-hairline px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[0.875rem] font-medium text-bad-fg">
                  {measureOf(breach.measure)?.label ?? breach.measure} crossed
                </span>
                <span className="text-[0.875rem] text-mute tabular-nums">
                  {day(breach.first_seen_at)}
                  {breach.seen_count > 1 &&
                    ` · seen ${count(breach.seen_count)} times`}
                </span>
              </div>
              <p className="mt-1 text-[0.875rem] leading-relaxed text-body tabular-nums">
                {drawLimit(breach.measure, breach.observed)} against a line of{" "}
                {drawLimit(breach.measure, breach.threshold)}
                {breach.action_taken === "PAUSED" &&
                  " — the campaign was stopped"}
                {breach.action_taken === "PAUSE_FAILED" &&
                  " — the campaign could NOT be stopped"}
                . Read over {day(breach.window_from)} – {day(breach.window_to)},
                which is what the centre could see: a shop had already gone
                further.
              </p>
              <button
                type="button"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate(breach.breach_id)}
                className="mt-1.5 text-[0.875rem] text-accent hover:underline"
              >
                I have seen this
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/// The reading beside a rail, coloured by whether it is on the wrong side.
function cnTone(breached: boolean): string {
  return breached
    ? "text-[0.875rem] font-semibold text-bad-fg tabular-nums"
    : "text-[0.875rem] text-ok-fg tabular-nums"
}
