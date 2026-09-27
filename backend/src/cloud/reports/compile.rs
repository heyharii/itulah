//! A spec, turned into one parameterised query.
//!
//! Nothing a caller wrote ever reaches the SQL string. Column expressions come
//! from the catalogue, the grain is a closed enum written out in this crate,
//! and every value a person or a model supplied is bound as a parameter. That
//! is the entire security model, and it is worth saying plainly because the
//! obvious alternative — letting the model write SQL — has no equivalent
//! sentence.

use super::catalogue::{Dimension, Format, Kind};
use super::spec::{Checked, Filter, Grain, Operator, LOCAL_OFFSET_MINUTES};
use chrono::{DateTime, NaiveDate, Utc};

/// A value bound to the query. Kept as an enum rather than strings so the
/// runner binds the right Postgres type and the compiler cannot accidentally
/// interpolate one.
#[derive(Clone, Debug, PartialEq)]
pub enum Param {
    Text(String),
    Texts(Vec<String>),
    Int(i64),
    Date(NaiveDate),
}

/// What one selected column is, so the browser can draw it without guessing.
#[derive(Clone, Debug, serde::Serialize)]
pub struct Column {
    pub key: String,
    pub label: String,
    /// `dimension`, `measure`, or `bucket` — the time axis.
    pub role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<Format>,
}

pub struct Query {
    pub sql: String,
    pub params: Vec<Param>,
    pub columns: Vec<Column>,
}

struct Builder {
    params: Vec<Param>,
    /// How many placeholders the caller has already bound.
    ///
    /// Zero for a whole query, which this file builds from nothing. Not zero
    /// for [`narrow`], which hands a fragment to a caller that wrote its own
    /// `SELECT` and bound its own values first — and being *told* the number
    /// rather than guessing it is the difference between a predicate that
    /// reads the caller's third parameter and one that reads its own.
    base: usize,
    /// The business-day offset, bound once and reused everywhere a local clock
    /// is needed. Reused rather than re-bound because a report whose bucket and
    /// whose hour column disagreed about the timezone would be very hard to see.
    offset: Option<String>,
    /// The business instant as a SQL literal, substituted into every `$NOW`
    /// token (the same shape as `$OFFSET`: a static catalogue dimension cannot
    /// carry a bind parameter). One literal per query, so every column of one
    /// report measures against the same instant.
    now_literal: String,
}

impl Builder {
    fn bind(&mut self, value: Param) -> String {
        self.params.push(value);
        format!("${}", self.base + self.params.len())
    }

    fn offset(&mut self) -> String {
        if let Some(placeholder) = &self.offset {
            return placeholder.clone();
        }
        // Cast at the placeholder, once. A bound integer arrives as `bigint`,
        // and `make_interval(mins => ...)` takes `int` and will not widen to
        // meet it — the failure is a runtime "function does not exist", not a
        // compile error, so it belongs where it cannot be forgotten at a use
        // site rather than repeated at four of them.
        let placeholder = format!(
            "{}::int",
            self.bind(Param::Int(LOCAL_OFFSET_MINUTES.into()))
        );
        self.offset = Some(placeholder.clone());
        placeholder
    }

    /// A dimension's expression, with the local-clock and business-instant
    /// placeholders filled in.
    fn expression(&mut self, dimension: &Dimension) -> String {
        let mut sql = dimension.sql.to_owned();
        if sql.contains("$OFFSET") {
            let offset = self.offset();
            sql = sql.replace("$OFFSET", &offset);
        }
        if sql.contains("$NOW") {
            sql = sql.replace("$NOW", &self.now_literal);
        }
        sql
    }
}

/// The business day a report is run on, from the business instant the clock
/// reported.
pub fn business_day(now: DateTime<Utc>) -> NaiveDate {
    (now + chrono::Duration::minutes(i64::from(LOCAL_OFFSET_MINUTES))).date_naive()
}

/// Build the query for a checked spec, as of the business instant `now`.
pub fn compile(checked: &Checked<'_>, now: DateTime<Utc>) -> Query {
    let dataset = checked.dataset;
    let spec = checked.spec;
    let mut builder = Builder {
        params: Vec::new(),
        base: 0,
        offset: None,
        now_literal: crate::clock::sql_now_literal(now),
    };

    let mut select: Vec<String> = Vec::new();
    let mut columns: Vec<Column> = Vec::new();

    // The time axis first, when there is one, so the ordinal group-by below
    // lines up with the reading order of the table.
    if let Some(field) = spec.grain.field() {
        let offset = builder.offset();
        select.push(format!(
            "to_char(date_trunc('{field}', ({time}) + make_interval(mins => {offset})), 'YYYY-MM-DD') AS \"bucket\"",
            time = dataset.time,
        ));
        columns.push(Column {
            key: "bucket".to_owned(),
            label: match spec.grain {
                Grain::Month => "Bulan",
                Grain::Week => "Minggu",
                _ => "Tanggal",
            }
            .to_owned(),
            role: "bucket",
            format: None,
        });
    }

    for key in &spec.group_by {
        let Some(dimension) = dataset.dimension(key) else {
            continue;
        };
        let expression = builder.expression(dimension);
        select.push(format!("({expression})::text AS \"{key}\""));
        columns.push(Column {
            key: key.clone(),
            label: dimension.label.to_owned(),
            role: "dimension",
            format: None,
        });
    }

    for key in &spec.measures {
        let Some(measure) = dataset.measure(key) else {
            continue;
        };
        select.push(format!("({sql})::numeric AS \"{key}\"", sql = measure.sql));
        columns.push(Column {
            key: key.clone(),
            label: measure.label.to_owned(),
            role: "measure",
            format: Some(measure.format),
        });
    }

    let mut wheres: Vec<String> = Vec::new();
    if let Some(base) = dataset.base_where {
        wheres.push(base.to_owned());
    }

    // The period, resolved on the local clock and compared as an instant. The
    // end is the midnight *after* the last local day, because a reader asking
    // for "to the first" means the whole of the first.
    let today = business_day(now);
    if let Some((from, to)) = spec.period.resolve(today) {
        let offset = builder.offset();
        let from_param = builder.bind(Param::Date(from));
        let to_param = builder.bind(Param::Date(to));
        wheres.push(format!(
            "({time}) >= ({from_param}::timestamp - make_interval(mins => {offset}))",
            time = dataset.time
        ));
        wheres.push(format!(
            "({time}) < ({to_param}::timestamp + interval '1 day' - make_interval(mins => {offset}))",
            time = dataset.time
        ));
    }

    for filter in &spec.filters {
        let Some(dimension) = dataset.dimension(&filter.column) else {
            continue;
        };
        let expression = builder.expression(dimension);
        if let Some(fragment) = predicate(&mut builder, &expression, dimension.kind, filter) {
            wheres.push(fragment);
        }
    }

    let group_count = select.len() - spec.measures.len();
    let group_by = if group_count > 0 {
        let ordinals: Vec<String> = (1..=group_count).map(|index| index.to_string()).collect();
        format!("\nGROUP BY {}", ordinals.join(", "))
    } else {
        String::new()
    };

    // Ordering by the output alias, which Postgres allows and which keeps the
    // aggregate written once.
    let order = match &spec.sort {
        Some(sort) => format!(
            "\nORDER BY \"{key}\" {direction} NULLS LAST",
            key = sort.key,
            direction = if sort.desc { "DESC" } else { "ASC" }
        ),
        None if spec.grain != Grain::None => "\nORDER BY \"bucket\" ASC".to_owned(),
        None => match spec.measures.first() {
            Some(measure) => format!("\nORDER BY \"{measure}\" DESC NULLS LAST"),
            None => String::new(),
        },
    };

    let limit = builder.bind(Param::Int(checked.limit));

    let sql = format!(
        "SELECT {select}\n{source}{where_clause}{group_by}{order}\nLIMIT {limit}",
        select = select.join(",\n       "),
        source = dataset.source.trim(),
        where_clause = if wheres.is_empty() {
            String::new()
        } else {
            format!("\nWHERE {}", wheres.join("\n  AND "))
        },
    );

    Query {
        sql,
        params: builder.params,
        columns,
    }
}

/// A predicate somebody else's query can hang off its own `WHERE`.
pub struct Narrowing {
    /// `None` when there was nothing to narrow by. An empty clause list is not
    /// an error — it is a definition that matches everybody — and returning an
    /// empty string instead would leave every caller to remember that `AND ()`
    /// is a syntax error.
    pub sql: Option<String>,
    pub params: Vec<Param>,
}

/// Compile filters alone, for a caller that owns its own `SELECT`.
///
/// The narrowing half of [`compile`], sharing its `predicate` rather than
/// restating it: a saved segment is a set of filters over the `member` dataset,
/// and if it were compiled by a second function then "spent is at least five
/// million" would eventually mean one thing on the segment card and another in
/// the list the card opens.
///
/// `bound` is how many placeholders the caller has already used, so the
/// fragment numbers from `bound + 1`. `all` joins with `AND`; false joins with
/// `OR`, which is the only structural choice a segment definition gets — a
/// tree of nested groups is a query language, and this is a list of clauses.
pub fn narrow(
    dataset: &super::catalogue::Dataset,
    filters: &[Filter],
    all: bool,
    bound: usize,
    now: DateTime<Utc>,
) -> Narrowing {
    // A narrowing fragment can absolutely carry `$NOW`: the member dataset's
    // `segment` and `days_since_purchase` dimensions are clock-shaped, and a
    // saved segment may narrow on them. The caller's business instant is
    // required, never defaulted — a wall-clock default here would quietly
    // evaluate a saved segment against the wrong calendar.
    let mut builder = Builder {
        params: Vec::new(),
        base: bound,
        offset: None,
        now_literal: crate::clock::sql_now_literal(now),
    };

    let mut parts: Vec<String> = Vec::new();
    for filter in filters {
        // Skipped rather than refused, exactly as `compile` skips one: an
        // unknown column is caught by validation before anything reaches here,
        // and a compiler that could fail would need every caller to handle a
        // failure that cannot happen.
        let Some(dimension) = dataset.dimension(&filter.column) else {
            continue;
        };
        let expression = builder.expression(dimension);
        if let Some(fragment) = predicate(&mut builder, &expression, dimension.kind, filter) {
            parts.push(fragment);
        }
    }

    Narrowing {
        sql: if parts.is_empty() {
            None
        } else {
            Some(parts.join(if all { " AND " } else { " OR " }))
        },
        params: builder.params,
    }
}

/// Bind compiled parameters onto a statement, in order.
///
/// One place, because the alternative is every caller writing the same four-arm
/// match and one of them binding an `Int` as text — which Postgres accepts and
/// then compares as a string, so `spent_minor > '9'` quietly excludes ten
/// million.
pub fn bind_params<'q>(
    statement: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    params: &[Param],
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    let mut statement = statement;
    for parameter in params {
        statement = match parameter {
            Param::Text(value) => statement.bind(value.clone()),
            Param::Texts(values) => statement.bind(values.clone()),
            Param::Int(value) => statement.bind(*value),
            Param::Date(value) => statement.bind(*value),
        };
    }
    statement
}

/// One filter as a SQL predicate. `None` when the operator needs values it did
/// not get — validation refuses those first, so this is belt and braces.
fn predicate(
    builder: &mut Builder,
    expression: &str,
    kind: Kind,
    filter: &Filter,
) -> Option<String> {
    // How the column and the value meet. A number compared as text sorts "10"
    // before "9", and a date compared as text works only while the format
    // holds — so the cast is chosen by the column's kind, not guessed.
    let (left, cast) = match kind {
        Kind::Number => (format!("({expression})::numeric"), "::numeric"),
        Kind::Date => (format!("({expression})::date"), "::date"),
        // A boolean is compared as its own text, not against a bound one.
        // Every value here arrives as a string — a URL and a JSON clause carry
        // nothing else — and `boolean = text` is not a comparison Postgres
        // will make: it fails the query outright. Casting the column instead
        // of the value is what keeps `IsAnyOf` working too, where the bound
        // side is a `text[]` and casting it would need a second special case.
        Kind::Boolean => (format!("({expression})::text"), ""),
        _ => (format!("({expression})"), ""),
    };

    let one = |builder: &mut Builder, index: usize| -> Option<String> {
        let value = filter.values.get(index)?.clone();
        Some(format!("{}{cast}", builder.bind(Param::Text(value))))
    };

    Some(match filter.op {
        Operator::Is => format!("{left} = {}", one(builder, 0)?),
        Operator::IsNot => format!("{left} IS DISTINCT FROM {}", one(builder, 0)?),
        Operator::IsAnyOf => {
            let values = builder.bind(Param::Texts(filter.values.clone()));
            format!("{left} = ANY({values}::text[])")
        }
        Operator::IsNoneOf => {
            let values = builder.bind(Param::Texts(filter.values.clone()));
            format!("({left} IS NULL OR NOT ({left} = ANY({values}::text[])))")
        }
        Operator::IsEmpty => format!("({left} IS NULL OR ({expression})::text = '')"),
        Operator::IsNotEmpty => format!("({left} IS NOT NULL AND ({expression})::text <> '')"),
        Operator::Contains => {
            let value = builder.bind(Param::Text(filter.values.first()?.clone()));
            format!("({expression})::text ILIKE '%' || {value} || '%'")
        }
        Operator::NotContains => {
            let value = builder.bind(Param::Text(filter.values.first()?.clone()));
            format!("(({expression})::text IS NULL OR ({expression})::text NOT ILIKE '%' || {value} || '%')")
        }
        Operator::StartsWith => {
            let value = builder.bind(Param::Text(filter.values.first()?.clone()));
            format!("({expression})::text ILIKE {value} || '%'")
        }
        Operator::Gt => format!("{left} > {}", one(builder, 0)?),
        Operator::Gte => format!("{left} >= {}", one(builder, 0)?),
        Operator::Lt => format!("{left} < {}", one(builder, 0)?),
        Operator::Lte => format!("{left} <= {}", one(builder, 0)?),
        Operator::Between => {
            let low = one(builder, 0)?;
            let high = one(builder, 1)?;
            format!("{left} BETWEEN {low} AND {high}")
        }
        Operator::NotBetween => {
            let low = one(builder, 0)?;
            let high = one(builder, 1)?;
            // A null is outside every range, and a reader asking for "not
            // between" means to see it. `NOT BETWEEN` alone would drop it.
            format!("({left} IS NULL OR {left} NOT BETWEEN {low} AND {high})")
        }
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::cloud::reports::spec::{
        check, with_overlay, Checked, Filter as SpecFilter, Operator as Op, Present, ReportSpec,
        Sort, Unit,
    };
    use chrono::TimeZone;

    fn spec(json: serde_json::Value) -> ReportSpec {
        serde_json::from_value(json).unwrap_or_else(|error| panic!("spec: {error}"))
    }

    fn now() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 3, 0, 0, 0).unwrap()
    }

    fn checked(spec: &ReportSpec) -> Checked<'_> {
        match check(spec) {
            Ok(checked) => checked,
            Err(problems) => panic!("spec should be legal: {problems:?}"),
        }
    }

    /// The shape the whole feature rests on: keys in, one parameterised query
    /// out, every value bound.
    #[test]
    fn a_grouped_spec_compiles_to_one_parameterised_query() {
        let spec = spec(serde_json::json!({
            "dataset": "sale_line",
            "period": { "kind": "relative", "last": 14, "unit": "day" },
            "grain": "day",
            "group_by": ["site_id"],
            "measures": ["gross", "units"],
            "filters": [{ "column": "site_id", "op": "IsAnyOf", "values": ["store-07", "store-02"] }],
            "sort": { "key": "gross", "desc": true }
        }));
        let checked = checked(&spec);
        let query = compile(&checked, now());

        assert!(query.sql.contains("FROM sale_line sl"));
        assert!(
            query.sql.contains("s.status = 'COMPLETED'"),
            "base predicate is not optional"
        );
        assert!(
            query.sql.contains("= ANY($"),
            "a list filter binds an array"
        );
        assert!(query.sql.contains("GROUP BY 1, 2"), "bucket then dimension");
        assert!(query.sql.contains("ORDER BY \"gross\" DESC"));
        // No caller value is ever in the string.
        assert!(!query.sql.contains("store-07"));
        assert!(matches!(
            query.params.iter().find(|param| matches!(param, Param::Texts(_))),
            Some(Param::Texts(values)) if values == &vec!["store-07".to_owned(), "store-02".to_owned()]
        ));

        let keys: Vec<&str> = query
            .columns
            .iter()
            .map(|column| column.key.as_str())
            .collect();
        assert_eq!(keys, ["bucket", "site_id", "gross", "units"]);
    }

    /// The local clock is bound once and reused, so a report's bucket and its
    /// hour column can never disagree about where the day turns over.
    #[test]
    fn the_business_day_offset_is_bound_once() {
        let spec = spec(serde_json::json!({
            "dataset": "sale",
            "grain": "day",
            "group_by": ["hour"],
            "measures": ["sales"]
        }));
        let checked = checked(&spec);
        let query = compile(&checked, now());

        let offsets = query
            .params
            .iter()
            .filter(|param| **param == Param::Int(LOCAL_OFFSET_MINUTES.into()))
            .count();
        assert_eq!(offsets, 1, "one offset parameter, referenced everywhere");
        assert!(
            !query.sql.contains("$OFFSET"),
            "the placeholder is substituted"
        );
    }

    /// A relative period is what stops a saved report freezing on the day it
    /// was written.
    #[test]
    fn a_relative_period_moves_with_the_day() {
        let spec = spec(serde_json::json!({
            "dataset": "sale",
            "period": { "kind": "relative", "last": 7, "unit": "day" },
            "measures": ["gross"]
        }));
        let resolved = spec.period.resolve(business_day(now()));
        assert_eq!(
            resolved,
            Some((
                NaiveDate::from_ymd_opt(2026, 8, 28).unwrap_or_default(),
                business_day(now())
            )),
            "seven days inclusive of today"
        );
        assert!(matches!(
            spec.period,
            super::super::spec::Period::Relative {
                unit: Unit::Day,
                ..
            }
        ));
    }

    /// The reader's narrowing goes into the same query, not into a second pass
    /// over the rows that came back. That is the whole point: a report cut off
    /// at its row ceiling would otherwise be narrowed within the cut, and the
    /// match on the six-thousandth row would never be found.
    /// A saved segment is a clause list over the `member` dataset, compiled by
    /// `narrow` rather than by `compile`. Two things have to hold that nothing
    /// else in this file exercises: the placeholders start where the caller
    /// says, and a boolean column is comparable at all.
    ///
    /// The boolean half is not hypothetical. Every value in a clause arrives as
    /// a string, so `paired = $1` asks Postgres to compare a boolean with text,
    /// which it refuses — and the failure is a 500 from one particular clause,
    /// not a compile error.
    #[test]
    fn a_narrowing_numbers_from_where_the_caller_stopped() {
        let members = super::super::catalogue::dataset("member").expect("member dataset");
        let narrowing = narrow(
            members,
            &[
                SpecFilter {
                    column: "paired".to_owned(),
                    op: Op::Is,
                    values: vec!["true".to_owned()],
                },
                SpecFilter {
                    column: "spent_minor".to_owned(),
                    op: Op::Gte,
                    values: vec!["5000000".to_owned()],
                },
            ],
            true,
            3,
            now(),
        );

        let sql = narrowing.sql.expect("two clauses compile to a predicate");
        assert!(
            sql.contains(")::text = $4"),
            "a boolean is compared as text, and from the caller's next \
             placeholder: {sql}"
        );
        assert!(
            sql.contains("$5::numeric"),
            "the second clause is $5: {sql}"
        );
        assert!(sql.contains(" AND "), "ALL joins with AND: {sql}");
        assert_eq!(narrowing.params.len(), 2);
    }

    /// `ANY` is the only other shape a definition has, and it must not leak
    /// into the caller's own `WHERE`: the fragment is spliced in as
    /// `AND (...)`, so an unbracketed `OR` would widen the whole query.
    #[test]
    fn an_any_narrowing_is_a_single_bracketed_alternative() {
        let members = super::super::catalogue::dataset("member").expect("member dataset");
        let narrowing = narrow(
            members,
            &[
                SpecFilter {
                    column: "segment".to_owned(),
                    op: Op::Is,
                    values: vec!["LAPSING".to_owned()],
                },
                SpecFilter {
                    column: "segment".to_owned(),
                    op: Op::Is,
                    values: vec!["LAPSED".to_owned()],
                },
            ],
            false,
            0,
            now(),
        );
        let sql = narrowing.sql.expect("a predicate");
        assert!(sql.contains(" OR "), "ANY joins with OR: {sql}");
        assert!(sql.contains("$1") && sql.contains("$2"));
    }

    #[test]
    fn a_readers_narrowing_reaches_the_query() {
        let spec = spec(serde_json::json!({
            "dataset": "sale_line",
            "grain": "day",
            "group_by": ["site_id"],
            "measures": ["gross"],
            "filters": [{ "column": "channel", "op": "Is", "values": ["STORE"] }]
        }));
        let narrowed = with_overlay(
            &spec,
            &[SpecFilter {
                column: "site_id".into(),
                op: Op::IsAnyOf,
                values: vec!["store-07".into()],
            }],
        );
        // Both survive, and neither replaces the other: the report's own
        // definition still applies underneath what somebody is looking at.
        assert_eq!(narrowed.filters.len(), 2);

        let checked = checked(&narrowed);
        let query = compile(&checked, now());
        assert!(
            query.sql.contains("(s.channel) = $"),
            "the spec's own clause"
        );
        assert!(query.sql.contains("= ANY($"), "the reader's clause");
        assert!(!query.sql.contains("store-07"), "values stay bound");

        // The stored spec is untouched — a shared link must not redefine the
        // report for everybody else.
        assert_eq!(spec.filters.len(), 1);
    }

    /// An overlay naming a column the dataset does not have is refused before
    /// a query exists, exactly like a bad spec. A filter bar cannot be used to
    /// reach past the catalogue.
    #[test]
    fn an_overlay_is_validated_like_everything_else() {
        let spec = spec(serde_json::json!({
            "dataset": "sale_line",
            "measures": ["gross"]
        }));
        let narrowed = with_overlay(
            &spec,
            &[SpecFilter {
                column: "secret_column".into(),
                op: Op::Is,
                values: vec!["x".into()],
            }],
        );
        let problems = check(&narrowed).err().unwrap_or_default();
        assert!(problems
            .iter()
            .any(|problem| problem.contains("secret_column")));
    }

    #[test]
    fn every_unknown_key_is_reported_at_once() {
        let spec = spec(serde_json::json!({
            "dataset": "sale_line",
            "group_by": ["shop"],
            "measures": ["revenue"],
            "present": { "kpis": ["profit"] }
        }));
        let problems = check(&spec).err().unwrap_or_default();
        assert_eq!(problems.len(), 3, "one round trip, not three: {problems:?}");
        assert!(problems
            .iter()
            .any(|problem| problem.contains("'revenue' is not a measure")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("'shop' is not a dimension")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("KPI 'profit'")));
    }

    #[test]
    fn a_chart_without_a_time_axis_is_refused() {
        let spec = spec(serde_json::json!({
            "dataset": "sale_line",
            "group_by": ["article_code"],
            "measures": ["gross"],
            "present": { "chart": ["gross"] }
        }));
        let problems = check(&spec).err().unwrap_or_default();
        assert!(problems
            .iter()
            .any(|problem| problem.contains("time grain")));
    }

    /// The limit is the caller's only when it is smaller than ours.
    #[test]
    fn the_row_ceiling_cannot_be_raised_by_a_spec() {
        let spec = spec(serde_json::json!({
            "dataset": "sale_line",
            "measures": ["gross"],
            "limit": 100000
        }));
        let checked = checked(&spec);
        assert_eq!(checked.limit, super::super::spec::MAX_ROWS);
    }

    /// A spec with no grouping and no grain is one number, and that is legal.
    #[test]
    fn a_single_figure_is_a_report() {
        let spec = spec(serde_json::json!({
            "dataset": "sale",
            "measures": ["gross"],
            "present": { "kpis": ["gross"] }
        }));
        let checked = checked(&spec);
        let query = compile(&checked, now());
        assert!(!query.sql.contains("GROUP BY"));
        assert_eq!(checked.spec.present.kpis, vec!["gross".to_owned()]);
        let _ = Present::default();
        let _ = Sort {
            key: "gross".into(),
            desc: true,
        };
    }
}
