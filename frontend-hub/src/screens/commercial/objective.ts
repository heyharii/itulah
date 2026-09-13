import { count, money } from "@/lib/format"
import { percent } from "@/screens/commercial/shared"

/// What a campaign is FOR, and how a target on it is read.
///
/// One vocabulary, used by the form that states an objective and by the
/// dashboard that scores it. Two copies would drift, and the one that drifted
/// would be the dashboard's — which is the one somebody quotes in a meeting.
///
/// The three sets below are CLOSED, and are the same three the server's check
/// constraints hold (migrations 0161 and 0173). That is not tidiness: an
/// objective typed freely becomes "Drive Sales" and "drive sales" within a
/// month, and a metric nothing computes is a target nobody can ever be held to.
///
/// **The words are here and the arithmetic is not.** Scoring a target used to
/// happen twice — once on this file's `read` functions for the panel, and once
/// on the server for the guardrail that can pause a campaign — and two answers
/// to "has it hit its target" is one answer too many. `GET
/// …/campaigns/{id}/outcome` is now the only place a metric name becomes a
/// number; what survives here is how to SAY it.

export interface ObjectiveKind {
  readonly value: string
  readonly label: string
  /// What it means in one line, for the picker. A merchandiser choosing
  /// between "Drive Sales" and "Increase Basket" is choosing between two
  /// sentences, not two enum names.
  readonly hint: string
  /// The metric this objective is usually measured by, offered as a default
  /// rather than enforced. "Clear inventory" measured by promo sales is
  /// unusual and not wrong — a clearance that made its money back is a fact
  /// somebody may want to track.
  readonly suggests: string
}

export const OBJECTIVES: readonly ObjectiveKind[] = [
  {
    value: "DRIVE_SALES",
    label: "Drive sales",
    hint: "Sell more, over a period, with offers paying for the lift.",
    suggests: "PROMO_SALES",
  },
  {
    value: "INCREASE_BASKET",
    label: "Increase basket size",
    hint: "The same shoppers, buying more per visit.",
    suggests: "AVERAGE_BASKET",
  },
  {
    value: "CLEAR_INVENTORY",
    label: "Clear inventory",
    hint: "Shift specific stock, whatever the margin costs.",
    suggests: "SELL_THROUGH",
  },
  {
    value: "ACQUIRE_CUSTOMERS",
    label: "Acquire customers",
    hint: "People who have never bought from us anywhere.",
    suggests: "NEW_CUSTOMERS",
  },
  {
    value: "RETAIN_MEMBERS",
    label: "Retain members",
    hint: "Give identified members a reason to come back.",
    suggests: "PROMO_SALES",
  },
  {
    value: "LAUNCH_PRODUCT",
    label: "Launch a product",
    hint: "Get units of something new into hands.",
    suggests: "UNITS_SOLD",
  },
]

/// How a target is typed, and therefore how it is stored.
///
/// `money` is minor units, `count` is whole, `bps` is basis points. Nothing
/// here is a float: a goal that rounds is a goal that argues.
export type TargetUnit = "money" | "count" | "bps"

export interface MetricKind {
  readonly value: string
  readonly label: string
  readonly hint: string
  readonly unit: TargetUnit
  /// The honest direction for this metric. Every one of these is a floor
  /// except discount given, which is a ceiling — and a single target with no
  /// direction would have the dashboard congratulating a campaign for
  /// overspending.
  readonly direction: "AT_LEAST" | "AT_MOST"
  /// Whether the metric ADDS UP over days, and can therefore be divided by
  /// them. Average basket and sell-through are already rates: "average basket
  /// per day" is not a smaller number, it is not a number — so the two models
  /// that normalise by day are offered for the other five only.
  readonly addsUp: boolean
}

export const METRICS: readonly MetricKind[] = [
  {
    value: "PROMO_SALES",
    label: "Promo sales",
    hint: "The whole of every basket an offer touched — influenced, not caused.",
    unit: "money",
    direction: "AT_LEAST",
    addsUp: true,
  },
  {
    value: "DISCOUNT_GIVEN",
    label: "Discount given",
    hint: "Money taken off tills. The one target that is a ceiling.",
    unit: "money",
    direction: "AT_MOST",
    addsUp: true,
  },
  {
    value: "GROSS_PROFIT",
    label: "Gross profit",
    hint: "Promo sales less the last price agreed for those styles. An estimate — a purchase order names a style, never a size.",
    unit: "money",
    direction: "AT_LEAST",
    addsUp: true,
  },
  {
    value: "UNITS_SOLD",
    label: "Units sold",
    hint: "Items in the baskets those offers touched.",
    unit: "count",
    direction: "AT_LEAST",
    addsUp: true,
  },
  {
    value: "AVERAGE_BASKET",
    label: "Average basket value",
    hint: "Promo sales divided by the baskets they were taken from.",
    unit: "money",
    direction: "AT_LEAST",
    // A rate already. Nothing here divides it by days.
    addsUp: false,
  },
  {
    value: "NEW_CUSTOMERS",
    label: "New customers",
    hint: "First purchase anywhere, ever, inside the window.",
    unit: "count",
    direction: "AT_LEAST",
    addsUp: true,
  },
  {
    value: "SELL_THROUGH",
    label: "Sell-through",
    hint: "Units sold of the styles this campaign's offers name, over everything that was ever there to sell. Counts full-price sales too — a clearance succeeded if the stock cleared.",
    unit: "bps",
    direction: "AT_LEAST",
    addsUp: false,
  },
]

export function objectiveOf(value: string | null | undefined) {
  return OBJECTIVES.find((one) => one.value === value)
}

export function metricOf(value: string | null | undefined) {
  return METRICS.find((one) => one.value === value)
}

/// A target or a reading, in the words its metric is measured in.
export function drawMetric(
  unit: TargetUnit,
  value: number | null | undefined
): string {
  if (value === null || value === undefined) return "—"
  if (unit === "money") return money(value)
  if (unit === "bps") return percent(value)
  return count(value)
}

/// What the line is measured AGAINST — the five shapes a target can take.
///
/// Two of these were all there was: a floor and a ceiling on a total. The other
/// three exist because a total is the wrong line for most of what this shop
/// actually runs.
///
/// `REACH_PER_DAY` is the one that makes a ten-day campaign and a thirty-day
/// campaign answerable to the same number, and the only model that can be
/// scored halfway through — a floor on the total is "missed" every day until
/// the last one.
///
/// `BEAT_BASELINE` is the half migration 0161 could not write down: it rejected
/// "+20%" because nobody could say +20% OF WHAT, and stored the answer
/// (`baseline_campaign_id`) without ever reading it into a target. Lebaran moves
/// about eleven days a year, so the comparison is campaign-to-campaign and the
/// day counts are normalised by the server.
///
/// `STAY_WITHIN` is for the metrics that are wrong at both ends. A discount rate
/// under the band buys nothing — nobody crossed the road for five per cent off —
/// and over it gives the shop away.
export interface TargetModelKind {
  readonly value: string
  readonly label: string
  readonly hint: string
  /// Needs a precedent campaign named, or it cannot be scored at all.
  readonly needsBaseline: boolean
  /// Needs the second end of the band.
  readonly needsUpper: boolean
  /// Offered only for metrics that add up over days.
  readonly needsAdditive: boolean
  /// What the number in the target box means under this model.
  readonly unitOf: (metric: MetricKind | undefined) => TargetUnit
}

export const TARGET_MODELS: readonly TargetModelKind[] = [
  {
    value: "REACH",
    label: "Reach",
    hint: "A floor on the total, over the campaign's own window.",
    needsBaseline: false,
    needsUpper: false,
    needsAdditive: false,
    unitOf: (metric) => metric?.unit ?? "count",
  },
  {
    value: "KEEP_BELOW",
    label: "Keep below",
    hint: "A ceiling on the total. What a discount budget is.",
    needsBaseline: false,
    needsUpper: false,
    needsAdditive: false,
    unitOf: (metric) => metric?.unit ?? "count",
  },
  {
    value: "REACH_PER_DAY",
    label: "Reach per day",
    hint: "A floor on the daily rate, so a short campaign and a long one can be given the same number — and so a running one can be scored today.",
    needsBaseline: false,
    needsUpper: false,
    needsAdditive: true,
    unitOf: (metric) => metric?.unit ?? "count",
  },
  {
    value: "BEAT_BASELINE",
    label: "Beat the precedent",
    hint: "Better than the campaign this one is read against, by this many basis points a day. 2000 is twenty per cent better than last Lebaran.",
    needsBaseline: true,
    needsUpper: false,
    needsAdditive: false,
    // Always a relative figure, whatever the metric is measured in: twenty per
    // cent better is twenty per cent whether the metric is rupiah or units.
    unitOf: () => "bps",
  },
  {
    value: "STAY_WITHIN",
    label: "Stay within a band",
    hint: "A floor and a ceiling on the same figure, for the metrics that are wrong at both ends.",
    needsBaseline: false,
    needsUpper: true,
    needsAdditive: false,
    unitOf: (metric) => metric?.unit ?? "count",
  },
]

export function targetModelOf(value: string | null | undefined) {
  return TARGET_MODELS.find((one) => one.value === value)
}

/// The models that can be stated about this metric.
///
/// Filtered rather than refused on save: a picker that offers a choice the
/// server will reject is a form that fails after somebody has filled it in.
export function modelsFor(metric: string): readonly TargetModelKind[] {
  const adds = metricOf(metric)?.addsUp ?? false
  return TARGET_MODELS.filter((one) => !one.needsAdditive || adds)
}
