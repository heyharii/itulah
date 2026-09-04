//! Reports: a definition somebody keeps, not a screen somebody wrote.
//!
//! Three files, in the order they matter. `catalogue` declares what a report
//! may be about — the only place a table or column name reaches this feature.
//! `spec` is what gets stored: dataset, period, filters, grouping, and how the
//! answer is drawn. `compile` turns a validated spec into one parameterised
//! query.
//!
//! The division of labour is the point. A model composes a spec once, from a
//! sentence; from then on the report runs without a model at all, and running
//! it twice on the same day gives the same answer. What is stored is small,
//! diffable, and editable by hand in the browser's own filter bar — none of
//! which is true of stored SQL.

pub mod catalogue;
pub mod compile;
pub mod spec;
