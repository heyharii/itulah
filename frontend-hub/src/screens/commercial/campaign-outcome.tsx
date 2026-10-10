import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChartNoAxesColumn, Target, type LucideIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Money, Select } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
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
import { Quiet } from "@/screens/commercial/parts"
import { percent, useActor } from "@/screens/commercial/shared"

/// Did this campaign do what it was run for?
///
/// The question the Promotions screen cannot ask. A promotion answers "this
/// offer fired N times and gave away X"; a campaign answers "the Eid
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
/// ninety days. This does not, and must not: "did Eid hit its target" is
/// asked over Eid's dates whatever today is, and scoring a finished
/// campaign against the last thirty days would report every past campaign as a
/// failure the month after it ended. The server resolves that window from the
/// book; this screen cannot override it and has no parameter to try.
/// The head of a part of the sheet: a small line icon, the heading, a
/// hairline. The same shape as the blocks of the Promotions sheet.
export function BlockHead({
  icon: Icon,
  title,
  aside,
  className,
}: {
  icon: LucideIcon
  title: string
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-9 items-center gap-3 border-b border-hairline pb-3",
        className
      )}
    >
      <Icon className="size-5 shrink-0 text-line-ico" strokeWidth={1.7} />
      <h4 className="flex-1 text-[0.9375rem] font-semibold text-ink">
        {title}
      </h4>
      {aside !== undefined && aside !== "" && (
        <span className="text-[0.875rem] text-mute">{aside}</span>
      )}
    </div>
  )
}

/// A part of the sheet: its head, then the content 20px below.
export function Block({
  icon,
  title,
  aside,
  children,
}: {
  icon: LucideIcon
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-5">
      <BlockHead icon={icon} title={title} aside={aside} />
      {children}
    </section>
  )
}

/// A plain label / value row.
export function Pair({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="shrink-0 text-[0.9375rem] text-body">{label}</span>
      <span className="min-w-0 text-right text-[0.9375rem] font-medium text-ink tabular-nums">
        {children}
      </span>
    </div>
  )
}

/// A labelled bar: what it measures, the figures, the share.
export function Gauge({
  label,
  figures,
  ratio,
  tone,
}: {
  label: string
  figures: React.ReactNode
  ratio: number
  tone?: "accent" | "ok" | "warn" | "bad"
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-4 text-[0.9375rem] text-body tabular-nums">
        <span className="flex-1">{label}</span>
        <span>{figures}</span>
        <span className="w-12 text-right text-ink">
          {percent(Math.round(ratio * 10_000))}
        </span>
      </div>
      <Meter
        value={ratio}
        label={label}
        tone={tone ?? (ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "accent")}
        className="h-2"
      />
    </div>
  )
}

/// The id the Goal block answers to, so a checklist can scroll to it.
export const GOAL_ANCHOR = "campaign-goal"

/// The goal: what the campaign is for, the line, and how far it has got.
///
/// **Results are the campaign's own window, never the screen's.** "Did Eid
/// hit its target" is asked over Eid's dates whatever today is; scoring a
/// finished campaign against the last thirty days would report every past one
/// as a failure. The server resolves that window from the book.
export function CampaignGoal({
  campaign,
  campaigns,
}: {
  campaign: BookCampaign
  /// Every campaign in the books, so a precedent can be named.
  campaigns: readonly BookCampaign[]
}) {
  const id = campaign.campaign_id
  const outcome = useQuery({
    queryKey: campaignKeys.outcome(id),
    queryFn: ({ signal }) => campaignOutcome(id, null, signal),
    retry: false,
  })
  const [editing, setEditing] = useState(false)

  return (
    <div id={GOAL_ANCHOR} className="scroll-mt-4">
      {queryState(outcome, {
        loading: "Loading…",
        render: (scored) => {
          const stated = scored.target
          if (editing || stated === null) {
            return (
              <Block icon={Target} title="Goal">
                <IntentEditor
                  campaign={campaign}
                  campaigns={campaigns}
                  stated={stated}
                  baselineId={scored.baseline?.campaign_id ?? null}
                  onDone={() => setEditing(false)}
                  onCancel={
                    stated === null ? undefined : () => setEditing(false)
                  }
                />
              </Block>
            )
          }
          return (
            <Block
              icon={Target}
              title="Goal"
              aside={
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  Change
                </Button>
              }
            >
              <GoalRows stated={stated} />
            </Block>
          )
        },
      })}
    </div>
  )
}

/// The objective and its line as rows, with a bar toward the line.
function GoalRows({ stated }: { stated: CampaignTargetScore }) {
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
    <div className="flex flex-col gap-5">
      <Pair label={objective?.label ?? stated.objective}>
        <Line score={stated} unit={unit} readingUnit={readingUnit} />{" "}
        <span className="font-normal text-mute">
          {metric?.label.toLowerCase() ?? stated.success_metric}
        </span>
      </Pair>
      {stated.notes !== null && <Pair label="Notes">{stated.notes}</Pair>}
      {share !== null && (
        <Gauge
          label="Progress"
          figures={
            <>
              {drawMetric(readingUnit, stated.current)}
              {stated.target_model === "REACH_PER_DAY" && " a day"}
              <span className="text-mute">
                {" / "}
                <Line score={stated} unit={unit} readingUnit={readingUnit} />
              </span>
            </>
          }
          ratio={share}
          tone={stated.met === true ? "ok" : share >= 0.7 ? "warn" : "accent"}
        />
      )}
      {stated.note !== null && (
        <p className="text-[0.9375rem] text-warn-fg">{stated.note}</p>
      )}
    </div>
  )
}

/// What the campaign did over its own window, as a short list of rows.
export function CampaignResults({ campaign }: { campaign: BookCampaign }) {
  const id = campaign.campaign_id
  const outcome = useQuery({
    queryKey: campaignKeys.outcome(id),
    queryFn: ({ signal }) => campaignOutcome(id, null, signal),
    retry: false,
  })
  return queryState(outcome, {
    loading: "Loading…",
    render: (scored) => (
      <Block
        icon={ChartNoAxesColumn}
        title="Results"
        aside={<Dates window={scored.window} />}
      >
        <Did scored={scored} />
      </Block>
    ),
  })
}

function Did({ scored }: { scored: CampaignOutcomeView }) {
  const reading = scored.reading
  if (reading.sale_count === 0) return <Quiet>No sales yet.</Quiet>
  return (
    <div className="flex flex-col gap-5">
      <Pair label="Sales">{money(reading.basket_revenue_minor)}</Pair>
      <Pair label="Given away">{money(reading.spend_minor)}</Pair>
      <Pair label="Transactions">{count(reading.sale_count)}</Pair>
      {/* Revenue less a cost of nought is revenue, and under the word "profit"
          that is the most flattering number on the panel. Only where costed. */}
      {reading.costed_units > 0 && (
        <Pair label="Gross profit">
          {money(reading.basket_revenue_minor - reading.cost_minor)}
        </Pair>
      )}
      {scored.baseline !== null && scored.baseline.reading.sale_count > 0 && (
        <Against mine={reading} before={scored.baseline} />
      )}
    </div>
  )
}

/// The dates a figure is true of, said out loud beside it.
function Dates({ window }: { window: CampaignWindowView | null }) {
  if (window === null) return null
  if (!window.dated) return <>Last 30 days</>
  return (
    <>
      {day(window.measured_from)} – {day(window.measured_to)}
    </>
  )
}

/// This campaign against the one it should be read against. The day counts
/// matter: a longer campaign beats a shorter one on totals alone.
function Against({
  mine,
  before,
}: {
  mine: CampaignReadingView
  before: CampaignBaselineView
}) {
  const name = before.name ?? before.campaign_id
  return (
    <div className="flex flex-col gap-5 border-t border-hairline pt-5">
      <Pair label="Against">{name}</Pair>
      <Compare
        term="Sales"
        now={mine.basket_revenue_minor}
        was={before.reading.basket_revenue_minor}
        draw={money}
      />
      <Compare
        term="Given away"
        now={mine.spend_minor}
        was={before.reading.spend_minor}
        draw={money}
        // Spending less to get the same is the good direction here.
        lowerIsBetter
      />
      <Compare
        term="Transactions"
        now={mine.sale_count}
        was={before.reading.sale_count}
        draw={count}
      />
    </div>
  )
}

function Compare({
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
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[0.9375rem] text-body">{term}</span>
      <span className="flex items-baseline gap-3 text-[0.9375rem] tabular-nums">
        <span className="text-mute">was {draw(was)}</span>
        <span className="font-medium text-ink">{draw(now)}</span>
        {change !== null && (
          <span
            className={cn(
              "w-14 text-right font-medium",
              good === true ? "text-ok-fg" : "text-bad-fg"
            )}
          >
            {change >= 0 ? "+" : ""}
            {change}%
          </span>
        )}
      </span>
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
      ? "Sign in to save."
      : value === null || Number.isNaN(value)
        ? "Set a target."
        : unit === "bps" && value > 10_000
          ? "A percentage can't pass 100%."
          : shape?.needsBaseline === true && baseline === ""
            ? "Pick a campaign to compare with."
            : shape?.needsUpper === true &&
                (ceiling === null || Number.isNaN(ceiling))
              ? "Set both ends."
              : shape?.needsUpper === true &&
                  ceiling !== null &&
                  ceiling <= value
                ? "The top has to be above the bottom."
                : undefined

  return (
    <div>
      <div>
        <div className="grid gap-5 sm:grid-cols-2">
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

          <Field label="Metric">
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
                ? "From"
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
              label="Target"
            />
          </Field>

          {shape?.needsUpper === true && (
            <Field label="To" required>
              <Money
                value={upper}
                onChange={setUpper}
                prefix={unit === "money" ? "Rp" : undefined}
                suffix={unit === "bps" ? "%" : undefined}
                label="Upper end"
              />
            </Field>
          )}

          {/* A campaign, not a period — Eid moves every year, so the
              month before it is ordinary trading. */}
          <Field
            label="Compared with"
            required={shape?.needsBaseline === true}
            className="sm:col-span-2"
          >
            <Select value={baseline} onChange={setBaseline}>
              <option value="">Nothing</option>
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
          <div className="mt-5">
            <ErrorState error={save.error} />
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-4">
          <span className="min-w-0 text-[0.875rem] text-bad">
            {problem ?? ""}
          </span>
          <span className="flex shrink-0 items-center gap-3">
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
              {save.isPending ? "Submitting…" : "Submit"}
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
