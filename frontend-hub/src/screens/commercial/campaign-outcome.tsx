import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Money, Select } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { SubHead } from "@/components/ui/rows"
import { ErrorState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  campaignKeys,
  campaignOutcome,
  intentKeys,
  saveCampaignIntent,
  saveCampaignTarget,
  type BookCampaign,
  type CampaignBaselineView,
  type CampaignOutcomeView,
  type CampaignReadingView,
  type CampaignTargetScore,
  type CampaignWindowView,
} from "@/lib/queries/commercial"
import { cn } from "@/lib/utils"
import {
  bpsOfPercent,
  drawMetric,
  METRICS,
  metricOf,
  modelsFor,
  OBJECTIVES,
  objectiveOf,
  percentOfBps,
  targetModelOf,
  type TargetUnit,
} from "@/screens/commercial/objective"
import { CampaignPlan } from "@/screens/commercial/campaign-plan"
import { Quiet } from "@/screens/commercial/parts"
import { useActor } from "@/screens/commercial/shared"

/// Did this campaign do what it was run for?
///
/// The question the Promotions screen cannot ask. A promotion answers "this
/// offer fired N times and gave away X"; a campaign answers "the Lebaran
/// programme was run to clear seasonal stock, the line was 80%, and we are at
/// 68%" — and without an objective, a metric and a line there is no way to
/// write that sentence at all. Which is why a campaign with none says so here
/// rather than showing a page of figures that answer nothing.
///
/// ## One read, and the arithmetic is not in this file
///
/// This panel used to ask three questions — the campaign's performance, the
/// baseline's performance, the stock projection — and do the scoring, the day
/// normalisation and the baseline comparison in the browser. All of that is now
/// `GET …/campaigns/{id}/outcome`, for a reason that is not tidiness: the same
/// arithmetic decides whether a GUARDRAIL has been crossed, and a guardrail
/// that pauses a campaign across thirteen shops cannot be allowed to disagree
/// with the panel a merchandiser was reading when it happened.
///
/// ## The window is the campaign's own, never the header's
///
/// The tiles at the top of the screen roll over the last seven, thirty or
/// ninety days. This does not, and must not: "did Lebaran hit its target" is
/// asked over Lebaran's dates whatever today is, and scoring a finished
/// campaign against the last thirty days would report every past campaign as a
/// failure the month after it ended. The server resolves that window from the
/// book; this screen cannot override it and has no parameter to try.
export function CampaignOutcome({
  campaign,
  campaigns,
}: {
  campaign: BookCampaign
  /// Every campaign in the books, so a precedent can be named. Only the ids and
  /// names are used — the comparison itself is the server's, over the
  /// precedent's own dates.
  campaigns: readonly BookCampaign[]
}) {
  const id = campaign.campaign_id

  const outcome = useQuery({
    queryKey: campaignKeys.outcome(id),
    queryFn: ({ signal }) => campaignOutcome(id, null, signal),
    retry: false,
  })

  return (
    <div className="flex flex-col gap-5">
      {queryState(outcome, {
        loading: "Reading the tills…",
        render: (scored) => (
          <>
            <Objective
              campaign={campaign}
              campaigns={campaigns}
              outcome={scored}
              pending={false}
            />
            <Did scored={scored} />
          </>
        ),
      })}

      <CampaignPlan campaignId={id} />
    </div>
  )
}

/// What the campaign did over its own window.
function Did({ scored }: { scored: CampaignOutcomeView }) {
  return (
    <div>
      <SubHead aside={<Dates window={scored.window} />}>
        What it did
      </SubHead>
      {scored.reading.sale_count === 0 ? (
        <Quiet>
          No sale in this window named this campaign. Either nothing has been
          sold against it yet, or no shop has received it.
        </Quiet>
      ) : (
        <>
          {/* Three across only where three fit. A sheet is a third of the
              glass, and "Rp 5.600.000" clipped to "Rp 5.600…" in a tile that
              was sized for a page — a truncated amount is worse than a
              stacked one, because it still looks like a number. */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Figure
              label="Promo sales"
              value={money(scored.reading.basket_revenue_minor)}
              note={perDay(scored.reading, scored.window)}
            />
            <Figure
              label="Given away"
              value={money(scored.reading.spend_minor)}
              note={
                scored.reading.clearance_minor > 0
                  ? `${money(scored.reading.benefit_minor)} discounted, ${money(scored.reading.clearance_minor)} cleared`
                  : undefined
              }
            />
            <Figure
              label="Gross profit"
              // Revenue less a cost of nought is revenue, and under the word
              // "profit" that is the most flattering number on the panel,
              // produced by the absence of data rather than by trading. The
              // server answers `null` for exactly that case.
              value={
                scored.reading.costed_units === 0
                  ? "—"
                  : money(
                      scored.reading.basket_revenue_minor -
                        scored.reading.cost_minor
                    )
              }
              note={
                scored.reading.costed_units === 0
                  ? "no cost on file"
                  : scored.reading.costed_units < scored.reading.units
                    ? `costed for ${count(scored.reading.costed_units)} of ${count(scored.reading.units)}`
                    : undefined
              }
            />
          </div>
          {scored.baseline !== null && (
            <Against
              mine={scored.reading}
              window={scored.window}
              before={scored.baseline}
            />
          )}
        </>
      )}
    </div>
  )
}

/// The dates a figure is true of, said out loud beside it.
///
/// A figure over an unstated period is the kind of number that ends up in a
/// slide, and an undated campaign is read over the server's own default.
function Dates({ window }: { window: CampaignWindowView | null }) {
  if (window === null) return null
  if (!window.dated) return <>last 30 days</>
  return (
    <>
      {day(window.measured_from)} – {day(window.measured_to)}
      {window.days_planned !== null && (
        <span className="text-mute">
          {" "}
          · day {count(window.days_elapsed)} of {count(window.days_planned)}
        </span>
      )}
    </>
  )
}

function perDay(
  reading: CampaignReadingView,
  window: CampaignWindowView
): string | undefined {
  if (reading.per_day === null) return undefined
  return `${money(reading.per_day.basket_revenue_minor)} a day over ${count(window.days_elapsed)}`
}

function Figure({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="min-w-0 rounded-inner bg-soft px-3 py-2.5">
      <div className="truncate text-eyebrow text-mute">{label}</div>
      <div className="mt-1 text-[0.9375rem] leading-tight font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </div>
      {note !== undefined && (
        <div className="mt-1 truncate text-[0.875rem] text-mute">{note}</div>
      )}
    </div>
  )
}

/// This campaign against the one somebody said it should be read against.
///
/// **The day counts are not decoration.** A campaign that ran twenty-three days
/// against one that ran twenty-one will beat it on totals by simply being
/// longer, and the per-day line underneath is the only reading that is not
/// flattered by length. Both are drawn: totals are what was actually spent and
/// taken, and per day is what is comparable — and both come from the server, so
/// the figure here and the figure a guardrail fired on are one figure.
function Against({
  mine,
  window,
  before,
}: {
  mine: CampaignReadingView
  window: CampaignWindowView
  before: CampaignBaselineView
}) {
  const name = before.name ?? before.campaign_id
  if (before.reading.sale_count === 0) {
    return (
      <p className="mt-3 text-[0.875rem] leading-relaxed text-mute">
        {before.note ??
          `Nothing was sold against ${name} in its own window, so there is nothing to read this against.`}
      </p>
    )
  }
  return (
    <div className="mt-3 rounded-inner border border-hairline px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-eyebrow font-medium text-body">
          Against {name}
        </span>
        {before.comparable && (
          <span className="text-[0.875rem] text-mute tabular-nums">
            {count(window.days_elapsed)} days vs{" "}
            {count(before.window.days_elapsed)}
          </span>
        )}
      </div>
      <dl className="mt-1.5 text-meta">
        <Row
          term="Promo sales"
          now={mine.basket_revenue_minor}
          was={before.reading.basket_revenue_minor}
          draw={money}
        />
        <Row
          term="Given away"
          now={mine.spend_minor}
          was={before.reading.spend_minor}
          draw={money}
          // Spending less to get the same is the good direction here, and the
          // arrow has to know that or it congratulates an overspend.
          lowerIsBetter
        />
        <Row
          term="Baskets"
          now={mine.sale_count}
          was={before.reading.sale_count}
          draw={count}
        />
      </dl>
      {before.comparable &&
        before.revenue_per_day_bps !== null &&
        mine.per_day !== null &&
        before.reading.per_day !== null && (
          <p className="mt-2 text-[0.875rem] leading-relaxed text-mute">
            Per day, that is{" "}
            <span className="text-text tabular-nums">
              {money(mine.per_day.basket_revenue_minor)}
            </span>{" "}
            against{" "}
            <span className="text-text tabular-nums">
              {money(before.reading.per_day.basket_revenue_minor)}
            </span>{" "}
            —{" "}
            <span
              className={cn(
                "font-semibold",
                before.revenue_per_day_bps >= 0 ? "text-ok-fg" : "text-bad-fg"
              )}
            >
              {swing(before.revenue_per_day_bps)}
            </span>
            . The totals above are not comparable on their own when one window
            is longer than the other.
          </p>
        )}
    </div>
  )
}

/// A change in basis points, as a person would say it.
function swing(bps: number): string {
  const whole = bps / 100
  return `${bps >= 0 ? "+" : ""}${whole.toFixed(Math.abs(bps) % 100 === 0 ? 0 : 1)}%`
}

function Row({
  term,
  now,
  was,
  draw,
  lowerIsBetter,
}: {
  term: string
  now: number
  was: number
  draw: (value: number) => string
  lowerIsBetter?: boolean
}) {
  const change = was === 0 ? null : Math.round(((now - was) / was) * 1000) / 10
  const good =
    change === null ? null : lowerIsBetter === true ? change <= 0 : change >= 0
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-mute">{term}</dt>
      <dd className="flex items-baseline gap-2 tabular-nums">
        <span className="text-ink">{draw(now)}</span>
        <span className="text-mute">was {draw(was)}</span>
        {change !== null && (
          <span
            className={cn(
              "font-semibold",
              good === true ? "text-ok-fg" : "text-bad-fg"
            )}
          >
            {change >= 0 ? "+" : ""}
            {change}%
          </span>
        )}
      </dd>
    </div>
  )
}

/// The objective, the line, and where the campaign stands against it.
function Objective({
  campaign,
  campaigns,
  outcome,
  pending,
}: {
  campaign: BookCampaign
  campaigns: readonly BookCampaign[]
  outcome: CampaignOutcomeView | null
  pending: boolean
}) {
  const [editing, setEditing] = useState(false)
  const stated = outcome?.target ?? null

  if (editing || (!pending && outcome !== null && stated === null)) {
    return (
      <IntentEditor
        campaign={campaign}
        campaigns={campaigns}
        stated={stated}
        baselineId={outcome?.baseline?.campaign_id ?? null}
        onDone={() => setEditing(false)}
        onCancel={stated === null ? undefined : () => setEditing(false)}
      />
    )
  }
  if (stated === null) return <Quiet>Reading what this was run for…</Quiet>

  const objective = objectiveOf(stated.objective)
  const metric = metricOf(stated.success_metric)
  const model = targetModelOf(stated.target_model)
  // The unit the LINE is stated in, which is not always the metric's: a target
  // relative to a precedent is a percentage whatever the metric is measured in.
  const unit = model?.unitOf(metric) ?? metric?.unit ?? "count"
  const readingUnit = metric?.unit ?? "count"
  const share =
    stated.progress_bps === null ? null : stated.progress_bps / 10_000

  return (
    <div>
      <SubHead
        aside={
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-accent hover:underline"
          >
            Change
          </button>
        }
      >
        What it is for
      </SubHead>
      <div className="rounded-card border border-hairline px-3.5 py-3">
        <div className="text-[0.9375rem] font-semibold text-ink">
          {objective?.label ?? stated.objective}
        </div>
        {stated.notes !== null && (
          <p className="mt-0.5 text-meta text-body">{stated.notes}</p>
        )}

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-eyebrow text-mute">
              {model?.label ?? stated.target_model} ·{" "}
              {metric?.label ?? stated.success_metric}
            </div>
            <div className="mt-0.5 text-[1.0625rem] leading-none font-semibold text-ink tabular-nums">
              <Line score={stated} unit={unit} readingUnit={readingUnit} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-eyebrow text-mute">Current</div>
            <div
              className={cn(
                "mt-0.5 text-[1.0625rem] leading-none font-semibold tabular-nums",
                stated.met === null
                  ? "text-mute"
                  : stated.met
                    ? "text-ok-fg"
                    : "text-bad-fg"
              )}
            >
              {drawMetric(readingUnit, stated.current)}
              {stated.target_model === "REACH_PER_DAY" && (
                <span className="text-meta font-normal text-mute"> a day</span>
              )}
            </div>
          </div>
        </div>

        {share !== null && (
          <Meter
            className="mt-2.5"
            value={share}
            tone={stated.met === true ? "ok" : share >= 0.7 ? "warn" : "accent"}
          />
        )}

        {stated.note !== null && (
          <p className="mt-2 text-[0.875rem] leading-relaxed text-warn-fg">
            {stated.note}
          </p>
        )}
      </div>
    </div>
  )
}

/// The line, in the words its model states it in.
///
/// Five models and five sentences. "≥ 80%" is the whole of a REACH target and
/// none of a BEAT_BASELINE one: +20% of nothing named is what migration 0161
/// refused to store, so the line here always says what it is measured against.
function Line({
  score,
  unit,
  readingUnit,
}: {
  score: CampaignTargetScore
  unit: TargetUnit
  readingUnit: TargetUnit
}) {
  const floor = drawMetric(unit, score.target_value)
  switch (score.target_model) {
    case "STAY_WITHIN":
      return (
        <>
          {floor} – {drawMetric(unit, score.target_value_upper)}
        </>
      )
    case "REACH_PER_DAY":
      return (
        <>
          ≥ {floor}
          <span className="text-meta font-normal text-mute"> a day</span>
        </>
      )
    case "BEAT_BASELINE":
      return (
        <>
          {score.target_direction === "AT_MOST" ? "−" : "+"}
          {floor}
          {score.line !== null && (
            <span className="text-meta font-normal text-mute">
              {" "}
              = {drawMetric(readingUnit, score.line)}
            </span>
          )}
        </>
      )
    default:
      return (
        <>
          {score.target_direction === "AT_MOST" ? "≤ " : "≥ "}
          {floor}
        </>
      )
  }
}

/// State it, or change it.
///
/// Two writes, on purpose. The objective, the metric, the line and the
/// precedent are `PUT …/intent`, which has owned that row since 0161; the
/// model and the far end of a band are `PUT …/target`, which owns the two
/// columns 0173 added. One writer per column — two routes upserting one row is
/// how a target silently reverts to whichever request landed second.
function IntentEditor({
  campaign,
  campaigns,
  stated,
  baselineId,
  onDone,
  onCancel,
}: {
  campaign: BookCampaign
  campaigns: readonly BookCampaign[]
  stated: CampaignTargetScore | null
  baselineId: string | null
  onDone: () => void
  onCancel?: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [objective, setObjective] = useState(
    stated?.objective ?? OBJECTIVES[0].value
  )
  const [metric, setMetric] = useState(
    stated?.success_metric ??
      objectiveOf(OBJECTIVES[0].value)?.suggests ??
      METRICS[0].value
  )
  const [model, setModel] = useState(stated?.target_model ?? "REACH")
  // A rate is typed in percent and stored in basis points, so a stored line
  // is shown back in the unit it will be typed in.
  const storedUnit =
    stated === null
      ? null
      : (targetModelOf(stated.target_model)?.unitOf(
          metricOf(stated.success_metric)
        ) ?? "count")
  const typed = (stored: number | null | undefined) =>
    stored === null || stored === undefined
      ? ""
      : storedUnit === "bps"
        ? percentOfBps(stored)
        : String(stored)
  const [target, setTarget] = useState(() => typed(stated?.target_value))
  const [upper, setUpper] = useState(() => typed(stated?.target_value_upper))
  const [baseline, setBaseline] = useState(baselineId ?? "")

  const chosen = metricOf(metric)
  const shape = targetModelOf(model)
  const offered = modelsFor(metric)
  const unit = shape?.unitOf(chosen) ?? "count"
  const asStored = (text: string) =>
    text.trim() === ""
      ? null
      : unit === "bps"
        ? bpsOfPercent(text)
        : Number(text)
  const value = asStored(target)
  const ceiling = asStored(upper)

  const save = useMutation({
    mutationFn: async () => {
      await saveCampaignIntent(campaign.campaign_id, {
        objective,
        success_metric: metric,
        // Taken from the metric rather than asked: every one of these is a
        // floor except discount given, which is a ceiling, and a person picking
        // the direction by hand is a person who can pick it wrong and be
        // congratulated for overspending.
        target_direction: chosen?.direction ?? "AT_LEAST",
        target_value: value ?? 0,
        baseline_campaign_id: baseline === "" ? null : baseline,
        notes: stated?.notes ?? null,
        updated_by: actor,
      })
      // Second, because it refuses when there is no objective to attach a model
      // to — which on a first save is true until the line above has run.
      await saveCampaignTarget(campaign.campaign_id, {
        target_model: model,
        target_value_upper: shape?.needsUpper === true ? ceiling : null,
      })
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: intentKeys.all })
      client.invalidateQueries({ queryKey: campaignKeys.all })
      onDone()
    },
  })

  const problem =
    actor === ""
      ? "Nobody is signed in, so no command can name who did this."
      : value === null || Number.isNaN(value)
        ? "Set a target."
        : unit === "bps" && value > 10_000
          ? "A percentage target cannot pass 100%."
          : shape?.needsBaseline === true && baseline === ""
            ? "Measured against another campaign — name one."
            : shape?.needsUpper === true &&
                (ceiling === null || Number.isNaN(ceiling))
              ? "A band needs both ends."
              : shape?.needsUpper === true &&
                  ceiling !== null &&
                  ceiling <= value
                ? "A band runs upwards: the ceiling has to be above the floor."
                : undefined

  return (
    <div>
      <SubHead>What it is for</SubHead>
      {/* A campaign without an objective is a folder of promotions. This
          says what it is chasing and how it will be judged — it changes no
          price and reaches no shop. */}
      <div className="rounded-card border border-hairline px-3.5 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Objective" className="sm:col-span-2">
            <Select
              value={objective}
              onChange={(next) => {
                setObjective(next)
                // The usual measure for the objective just picked, as a
                // starting point rather than a rule — a clearance measured by
                // promo sales is unusual and not wrong.
                const suggests = objectiveOf(next)?.suggests
                if (suggests !== undefined) {
                  setMetric(suggests)
                  if (!modelsFor(suggests).some((one) => one.value === model)) {
                    setModel("REACH")
                  }
                }
              }}
            >
              {OBJECTIVES.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Success metric">
            <Select
              value={metric}
              onChange={(next) => {
                setMetric(next)
                // A per-day target of a rate is not a smaller number, it is not
                // a number — so a model the new metric cannot carry falls back
                // rather than being sent and refused.
                if (!modelsFor(next).some((one) => one.value === model)) {
                  setModel("REACH")
                }
              }}
            >
              {METRICS.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Measured as">
            <Select value={model} onChange={setModel}>
              {offered.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={
              shape?.needsUpper === true
                ? "Band, from"
                : `Target (${
                    chosen?.direction === "AT_MOST" ? "at most" : "at least"
                  })`
            }
            required
          >
            <Money
              value={target}
              onChange={setTarget}
              prefix={unit === "money" ? "Rp" : undefined}
              suffix={unit === "bps" ? "%" : undefined}
              placeholder="Not set"
              label="Target"
            />
          </Field>

          {shape?.needsUpper === true && (
            <Field label="Band, to" required>
              <Money
                value={upper}
                onChange={setUpper}
                prefix={unit === "money" ? "Rp" : undefined}
                suffix={unit === "bps" ? "%" : undefined}
                label="Upper end"
              />
            </Field>
          )}

          {/* A campaign, not a period — Lebaran moves every year, so the
              month before it is ordinary trading. */}
          <Field
            label="Compared with"
            required={shape?.needsBaseline === true}
            className="sm:col-span-2"
          >
            <Select value={baseline} onChange={setBaseline}>
              <option value="">Nothing — judge it on its own</option>
              {campaigns
                .filter((one) => one.campaign_id !== campaign.campaign_id)
                .map((one) => (
                  <option key={one.campaign_id} value={one.campaign_id}>
                    {one.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        {save.isError && (
          <div className="mt-3">
            <ErrorState error={save.error} />
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="min-w-0 text-[0.875rem] text-bad">
            {problem ?? ""}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {onCancel !== undefined && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button
              variant="primary"
              pending={save.isPending}
              disabled={problem !== undefined}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save goal"}
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
