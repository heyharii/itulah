//! What a report says about itself, and what makes one legal.
//!
//! A spec is data: it names a dataset, a period, some filters, what to group
//! by, what to measure, and how to draw the answer. It never contains SQL, and
//! it is validated against the catalogue every time it is saved *and* every
//! time it runs — the second one matters more, because a dataset can change
//! under a spec that was saved a month ago, and a report that has gone stale
//! must say so rather than quietly answering a different question.

use super::catalogue::{dataset, Dataset, Kind};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// Minutes east of UTC for the business day when there is no site to ask —
/// the one fallback `reporting` keeps. A report runs on head office's clock,
/// read from `site.timezone` (0474) and handed to `compile`; this answers only
/// where no caller can.
pub const LOCAL_OFFSET_MINUTES: i32 = crate::reporting::DEFAULT_UTC_OFFSET_MINUTES;

/// The coarseness of the time axis. A closed set rather than a string handed to
/// `date_trunc`, which accepts `century` and `microseconds` and would produce a
/// technically valid report nobody asked for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grain {
    /// No time axis: one row per group, over the whole period.
    #[default]
    None,
    Day,
    Week,
    Month,
}

impl Grain {
    /// The `date_trunc` field. Safe to interpolate precisely because the set is
    /// closed and every member is written out here.
    fn truncation(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::Day => Some("day"),
            Self::Week => Some("week"),
            Self::Month => Some("month"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    Day,
    Week,
    Month,
}

/// When the report is about.
///
/// Relative is the shape that matters. A saved report holding
/// `2026-08-19..2026-09-01` is frozen the day it is written, and the next
/// person composes a new one instead of opening it — which is exactly the
/// treadmill this whole design exists to get off.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Period {
    Relative { last: i64, unit: Unit },
    Absolute { from: NaiveDate, to: NaiveDate },
    All,
}

impl Default for Period {
    fn default() -> Self {
        Self::Relative {
            last: 30,
            unit: Unit::Day,
        }
    }
}

impl Period {
    /// The local dates this period covers today, inclusive at both ends.
    ///
    /// `today` is passed in rather than read from the clock so a test can ask
    /// what a report meant on a particular morning.
    pub fn resolve(&self, today: NaiveDate) -> Option<(NaiveDate, NaiveDate)> {
        match self {
            Self::All => None,
            Self::Absolute { from, to } => Some((*from, *to)),
            Self::Relative { last, unit } => {
                let span = (*last).clamp(1, 1_000);
                // Inclusive of today, so "last 7 days" is a week ending now and
                // not a week ending yesterday plus today as a fragment.
                let from = match unit {
                    Unit::Day => today - chrono::Duration::days(span - 1),
                    Unit::Week => today - chrono::Duration::weeks(span) + chrono::Duration::days(1),
                    Unit::Month => {
                        let months = span.clamp(1, 120) as u32;
                        let mut date = today;
                        for _ in 0..months {
                            date = date
                                .checked_sub_months(chrono::Months::new(1))
                                .unwrap_or(date);
                        }
                        date + chrono::Duration::days(1)
                    }
                };
                Some((from, today))
            }
        }
    }
}

/// The questions a column can be asked. The same vocabulary the browser's
/// filter bar offers, spelled the same way, so a filter a person adds by hand
/// and a filter the model composed are the same object.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Operator {
    Is,
    IsNot,
    IsAnyOf,
    IsNoneOf,
    IsEmpty,
    IsNotEmpty,
    Contains,
    NotContains,
    StartsWith,
    Gt,
    Gte,
    Lt,
    Lte,
    Between,
    NotBetween,
}

impl Operator {
    /// How many values the operator takes. `None` means "one or more".
    fn arity(self) -> Option<usize> {
        match self {
            Self::IsEmpty | Self::IsNotEmpty => Some(0),
            Self::IsAnyOf | Self::IsNoneOf => None,
            Self::Between | Self::NotBetween => Some(2),
            _ => Some(1),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Filter {
    /// A dimension key. Measures are not filterable yet — that is `HAVING`,
    /// and it is a different feature with its own edges.
    pub column: String,
    pub op: Operator,
    #[serde(default)]
    pub values: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Sort {
    /// A measure or dimension key.
    pub key: String,
    #[serde(default)]
    pub desc: bool,
}

/// How the answer is drawn. Held in the spec rather than decided by the browser
/// because "which figure is the headline" is part of what the report *is* —
/// two people opening the same saved report should see the same thing.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Present {
    /// Measure keys, drawn as the strip of figures above everything else.
    #[serde(default)]
    pub kpis: Vec<String>,
    /// Measure keys to plot. Only meaningful when the grain gives a time axis.
    #[serde(default)]
    pub chart: Vec<String>,
    /// Column keys, in the order the table shows them. Empty means "every
    /// grouping column then every measure", which is almost always right.
    #[serde(default)]
    pub table: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReportSpec {
    pub dataset: String,
    #[serde(default)]
    pub period: Period,
    #[serde(default)]
    pub grain: Grain,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub group_by: Vec<String>,
    pub measures: Vec<String>,
    #[serde(default)]
    pub sort: Option<Sort>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub present: Present,
}

/// The most rows a report may return.
///
/// Not a page: a report is read whole, drawn as a chart, and exported. What
/// this is protecting against is a spec that groups by SKU across a year and
/// asks the browser to hold two hundred thousand rows.
pub const MAX_ROWS: i64 = 5_000;

/// A spec with a reader's extra clauses appended.
///
/// Appended, never merged by column: two clauses on the same column are `AND`,
/// which is already what the filter bar means when somebody adds a second one.
///
/// The overlay stays out of the stored spec. The report's own filters are part
/// of what it *is*; the overlay is what one person is looking at this minute,
/// and folding the two together would mean a shared link quietly redefining
/// the report for everybody else.
pub fn with_overlay(spec: &ReportSpec, overlay: &[Filter]) -> ReportSpec {
    if overlay.is_empty() {
        return spec.clone();
    }
    let mut narrowed = spec.clone();
    narrowed.filters.extend(overlay.iter().cloned());
    narrowed
}

/// A spec that is legal against the catalogue, with everything looked up once.
pub struct Checked<'a> {
    pub dataset: &'static Dataset,
    pub spec: &'a ReportSpec,
    pub limit: i64,
}

/// Whether a list of clauses is answerable against a dataset.
///
/// Lifted out of [`check`] because a saved segment is a clause list and
/// nothing else — no measures, no grouping, no period — and validating it
/// through a synthetic `ReportSpec` would mean inventing a measure to satisfy
/// a rule that has nothing to do with segments. Shared rather than copied so
/// that "is at least" needing one value, and a number column refusing a word,
/// are decided in one place for both.
///
/// Problems are appended rather than returned so a caller collects every one
/// at once: a person who fixes a clause, presses save and is told about the
/// next clause will not press save a third time.
pub fn check_filters(found: &Dataset, filters: &[Filter], problems: &mut Vec<String>) {
    for filter in filters {
        let Some(dimension) = found.dimension(&filter.column) else {
            problems.push(format!(
                "cannot filter on '{}': not a dimension of {}",
                filter.column, found.name
            ));
            continue;
        };
        match filter.op.arity() {
            Some(0) if !filter.values.is_empty() => {
                problems.push(format!("{:?} takes no values", filter.op));
            }
            Some(expected) if expected > 0 && filter.values.len() != expected => {
                problems.push(format!(
                    "{:?} on '{}' takes {expected} value(s), got {}",
                    filter.op,
                    filter.column,
                    filter.values.len()
                ));
            }
            None if filter.values.is_empty() => {
                problems.push(format!(
                    "{:?} on '{}' needs values",
                    filter.op, filter.column
                ));
            }
            _ => {}
        }
        if dimension.kind == Kind::Number {
            for value in &filter.values {
                if value.parse::<f64>().is_err() {
                    problems.push(format!("'{value}' is not a number for '{}'", filter.column));
                }
            }
        }
    }
}

/// Validate, and say everything that is wrong rather than the first thing.
///
/// The whole list matters: this is what a model gets back when its first
/// attempt is not quite legal, and one problem at a time would mean one
/// round-trip per mistake.
pub fn check(spec: &ReportSpec) -> Result<Checked<'_>, Vec<String>> {
    let mut problems = Vec::new();

    let Some(found) = dataset(&spec.dataset) else {
        return Err(vec![format!(
            "dataset '{}' does not exist; available: {}",
            spec.dataset,
            super::catalogue::datasets()
                .iter()
                .map(|set| set.name)
                .collect::<Vec<_>>()
                .join(", ")
        )]);
    };

    if spec.measures.is_empty() {
        problems.push("a report needs at least one measure".to_owned());
    }
    for key in &spec.measures {
        if found.measure(key).is_none() {
            problems.push(format!(
                "'{key}' is not a measure of {}; available: {}",
                found.name,
                found
                    .measures
                    .iter()
                    .map(|measure| measure.key)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }

    for key in &spec.group_by {
        if found.dimension(key).is_none() {
            problems.push(format!(
                "'{key}' is not a dimension of {}; available: {}",
                found.name,
                found
                    .dimensions
                    .iter()
                    .map(|dimension| dimension.key)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    // Two grouping columns is the limit, and it is a readability limit rather
    // than a technical one: a third turns every table into a pivot nobody can
    // scan and every chart into a legend.
    if spec.group_by.len() > 2 {
        problems.push("group by at most two dimensions".to_owned());
    }

    check_filters(found, &spec.filters, &mut problems);

    if let Some(sort) = &spec.sort {
        let known = found.measure(&sort.key).is_some()
            || found.dimension(&sort.key).is_some()
            || sort.key == "bucket";
        if !known {
            problems.push(format!("cannot sort by '{}': no such column", sort.key));
        }
    }

    for key in &spec.present.kpis {
        if found.measure(key).is_none() {
            problems.push(format!("KPI '{key}' is not a measure of {}", found.name));
        }
    }
    for key in &spec.present.chart {
        if found.measure(key).is_none() {
            problems.push(format!(
                "chart series '{key}' is not a measure of {}",
                found.name
            ));
        }
    }
    if !spec.present.chart.is_empty() && spec.grain == Grain::None {
        problems.push("a chart needs a time grain: set grain to day, week or month".to_owned());
    }
    for key in &spec.present.table {
        let known =
            found.measure(key).is_some() || found.dimension(key).is_some() || key == "bucket";
        if !known {
            problems.push(format!("table column '{key}' is not in {}", found.name));
        }
    }

    // A report with neither a grouping nor a time axis is one number. That is
    // legal and occasionally what somebody wants, so it is not an error.

    if problems.is_empty() {
        Ok(Checked {
            dataset: found,
            spec,
            limit: spec.limit.unwrap_or(MAX_ROWS).clamp(1, MAX_ROWS),
        })
    } else {
        Err(problems)
    }
}

impl Grain {
    pub fn field(self) -> Option<&'static str> {
        self.truncation()
    }
}
