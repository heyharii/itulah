mod allotment;
mod attendance;
mod auth;
mod bank_match;
mod cash_document;
/// Expense claims: what somebody spent, what a second person sanctioned, and
/// how the sanction became money. See `claim`.
mod claim;
mod commercial;
mod commitment;
/// The payroll component engine: five shapes, no expression evaluation, and
/// nothing statutory invented. See `component`.
mod component;
mod costing;
mod count;
mod depreciation;
mod employment;
/// The end of employment: the interview at the door, and the one statement
/// that closes a leaver's books. See `exit`.
mod exit;
/// Flows of goods as templates: the stage catalogue (code), the template an
/// Admin edits (data) and the typed actions a flow document is made of. Read
/// as `domain::flow::…` rather than glob-exported, so its `Stage…` and
/// `Flow…` names never meet another module's.
pub mod flow;
/// The forms the register is filled in on, and the fields each accepts — the
/// validation half of `asset_class.build` (migration 0356). See `ga`.
mod ga;
/// The supply request's stage ladder: filed, approved, ordered, received,
/// billed, with a refusal reachable only from the first rung. Pure, so the
/// server that enforces it and the button that offers it read one list.
mod ga_supplies;
mod giro;
/// The confidential channel: filed by anybody, investigated and resolved at
/// head office under two disjoint keys. See `grievance`.
mod grievance;
mod hire;
mod holiday;
mod identity;
mod ids;
mod integrity;
mod interunit;
mod inventory;
pub mod job_role;
mod leave;
pub mod number_series;
mod movement;
mod observation;
mod opening;
mod overtime;
mod pay;
mod payment;
mod payment_ledger;
mod period_close;
mod place;
mod record;
mod sales;
mod settlement_report;
mod statement_intake;
mod store_cash;
/// Store exceptions: the kinds, who owns them, who sees them (0646-0648).
pub mod store_exception;
// lane-A
pub mod sales_posting;
/// People's next generation: roster swaps, change proposals, the onboarding
/// and separation checklist, the recruitment pipeline, performance, training
/// and the rule numbers. One module because they share one shape — filed,
/// decided, read back — and one rule: the filer never decides their own.
pub mod people;
/// What the date decides: the entitlement a policy has earned, the
/// carry-forward a cap put a deadline on, next week's roster carried from this
/// week's plan, and the nudges. Pure functions over dates and records, so the
/// schedule is testable without a clock or a database.
pub mod schedule;
/// What the date says to head office outside HR: a GA contract or a paper about
/// to lapse, a supplier bill about to fall due, a tax month about to be late.
/// Pure decisions, so the reminder pass is testable without a database.
pub mod reminder;
/// What head office is told about the promotions it runs: a budget or basket
/// cap crossed, and when the fleet is due a fresh count. Pure, so the watch is
/// testable without a clock or a database.
pub mod marketing_watch;
/// The hard cap: a promotion's limit split into allowances each shop enforces
/// against its own sales, which only ever grow. Pure, so the split is testable
/// without a database.
pub mod cap_allocation;
/// Which HR calls a store node may relay to the cloud for its signed-in
/// manager, and the headers that carry them. Pure, and imported by the store
/// node rather than copied, so both ends enforce one list.
pub mod relay;
mod supplier;
mod sync;
mod sync_generation;
mod tender_recon;
pub mod three_way;
mod transaction_category;
pub mod uom;
mod voucher;
pub mod withholding;

pub use allotment::*;
pub use attendance::*;
pub use people::*;
pub use auth::*;
pub use bank_match::*;
pub use cash_document::*;
pub use claim::*;
pub use commercial::*;
pub use commitment::*;
pub use component::*;
pub use costing::*;
pub use count::*;
pub use depreciation::*;
pub use employment::*;
pub use exit::*;
pub use ga::*;
pub use ga_supplies::*;
pub use giro::*;
pub use grievance::*;
pub use hire::*;
pub use holiday::*;
pub use identity::*;
pub use ids::*;
pub use integrity::*;
pub use interunit::*;
pub use inventory::*;
pub use leave::*;
pub use movement::*;
pub use observation::*;
pub use opening::*;
pub use overtime::*;
pub use pay::*;
pub use payment::*;
pub use payment_ledger::*;
pub use period_close::*;
pub use place::*;
pub use record::*;
pub use sales::*;
pub use settlement_report::*;
pub use statement_intake::*;
pub use store_cash::*;
pub use supplier::*;
pub use sync::*;
pub use sync_generation::*;
pub use tender_recon::*;
pub use transaction_category::*;
pub use voucher::*;
