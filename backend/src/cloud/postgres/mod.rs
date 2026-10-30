mod account_links;
mod accounting_dimensions;
mod accounts;
mod accruals;
mod acquirer;
/// MD edits an allotment in place and cancels it at any stage before it is
/// sent; the Gudang moves back what MD took out.
mod allotment_amend;
mod allotment_close_short;
/// Allotments the Gudang server holds once the pen has moved: MD's edit
/// forwarded, and the server's facts that are Central's read copy.
mod allotment_node;
mod allotment_store_review;
mod allotments;
mod article_history;
mod articles;
mod asset_classes;
mod assets;
mod assistant;
mod attendance;
mod attendance_settings;
mod audit;
mod auth_policy;
mod bank_rules;
mod banking;
mod basket;
mod batches;
mod benefit;
pub mod bill_template;
mod campaigns;
/// The hard cap: a limit split into allowances each shop enforces against its
/// own sales, granted and topped up here and never taken back. See `0387`.
mod cap_allocation;
mod cash;
mod cash_counts;
mod cash_repeats;
mod catalogue;
mod chart_changes;
mod chat;
mod checkout_exceptions;
mod claim_benefits;
/// Money a shop took without producing a sale — the queue head office works,
/// because the shop's own Z report balances and nothing looks wrong there.
/// The claims lane's rows and the two transactions that post them.
mod claims;
mod colours;
mod commercial;
mod company_banks;
/// The payroll component catalogue, its ratified rates, and the one-off
/// figures a place files. See `domain::component`.
mod components;
mod contractor_projects;
pub(crate) mod control;
mod corrections;
mod counts;
mod coupons;
mod customer;
mod data_requests;
mod delegation;
mod deposits;
mod destinations;
/// Every machine enrolled to a node, fed by heartbeats. See migration 0604.
mod devices;
mod discipline;
mod discussion;
mod documents;
mod dossier;
mod eligibility;
mod employment;
mod enrolment;
/// The end of employment, as rows: the interview at the door and the one
/// statement that settles a leaver's books. See `domain::exit`.
mod exit;
mod expense_categories;
mod expense_codes;
mod files;
mod finance_policies;
mod finance_setup;
/// Head office's fleet status page, sync freshness and alerts. See 0637-0640.
mod fleet_status;
/// Flow templates and the documents that run them (0615-0619), and the
/// stage handlers that connect a stage to the code that already does its
/// work. Read as `postgres::flows::…`, not glob-exported.
pub mod flow_stages;
pub mod flows;
mod giro;
mod giro_print;
mod global_search;
/// The confidential queue and its catalogue, as rows. See `domain::grievance`.
mod grievance;
/// A shop asks for an employee it does not have; head office approves, returns
/// it for revision, or rejects. Not a recruitment pipeline — see `domain::hire`.
mod hire;
mod holiday;
mod integrity;
mod interunit;
mod inventory_valuation;
pub mod jobs;
mod journal;
mod journal_templates;
mod leave;
mod leave_extras;
mod ledger;
mod letters;
mod line_categories;
mod loyalty;
mod management_fee;
mod manual_journal;
/// What the promotions are doing, said to head office and to the shops: a cap
/// crossed and the fresh count it calls for, a price book a shop could not
/// apply, a shop behind on its messages, a guardrail crossed, and tomorrow's
/// starts and ends. Every notice claimed once through the run ledger.
mod marketing_watch;
mod member;
mod member_otp;
mod membership;
mod movements;
mod node_enrolment;
mod node_health;
mod notifications;
pub mod number_series;
mod observations;
mod opening;
mod organisation;
mod overtime;
pub mod party;
mod pay;
mod pay_component_accounts;
mod payables;
mod payables_flow;
mod payment_allocation;
mod payment_context;
mod payment_execution;
mod payment_instructions;
mod payment_ledger;
mod payment_methods;
mod payment_terms;
mod payments;
/// People's next generation, as rows. See `domain::people`.
mod people;
mod performance;
mod period_close;
mod period_closing;
mod permissions;
mod poster;
/// What a shop has charged for one product and when it changed — replayed
/// through the engine's own ranking rather than read off the rows.
/// Pricing changes still scheduled or running — one row per publication,
/// projected from the books themselves rather than stored a second time.
mod price_changes;
mod price_history;
mod pricing;
mod punch;
/// Web Push subscriptions and the deliveries still owed. See `cloud::push`.
mod push;
mod queries;
mod receipts;
mod received_shipments;
mod records;
/// The return promise: a fleet-wide window, an exception for a division, a
/// tag or an article, and the sentence a receipt prints. See 1005.
mod point_policy;
mod return_policy;
/// Head office told, once, what is about to lapse: GA contracts, filed papers,
/// supplier bills and tax months. Claimed through the same run ledger as the
/// HR nudges; the bands are `domain::reminder`'s.
mod reminders;
mod reports;
mod reserves;
mod returns;
/// How far one price book has reached each shop — told, in service, or failed
/// with the shop's own account of why. The three-state evidence 0179 made of
/// the activation table.
mod rollout;
mod roster;
/// A day's takings, carried into the general ledger — the one `source_kind`
/// the schema has always allowed and nothing ever wrote.
mod sale_day;
mod sales;
/// The clock's own rows: which HR period has been worked, and the work each
/// claimed period does. See `0363` for why a claim ledger is not a
/// `last_run_at` column.
mod schedule;
/// What a site is — head office, kind, clock, display code — read from its
/// row and never from its id. Reached by path, not glob-exported.
pub mod sites;
mod sku_suppliers;
mod supplier_returns;
mod tax_templates;
mod voucher;
mod withholding_report;
// lane-A
mod advance;
mod finance_control;
mod financial_statements;
mod financing;
mod ga;
/// The account a bill line should propose (brief §8.2), written once for the
/// suggestion endpoint and the pre-posting warnings.
mod ga_accounts;
/// GA's own half of the asset register: sub-location, holder, condition, the
/// build's fields and the appended history. See the module for why it is not
/// `postgres::assets`.
mod ga_assets;
/// GA's insurance claims: damage to a covered thing, claimed under its policy,
/// and the repair it pays for (0975).
mod ga_claims;
/// GA's contracts: the deals with a window, their meters, and the pointers
/// Finance's recurring bills keep back at them.
mod ga_contracts;
/// GA's operating expenses: fuel, tyres, oil, genset fuel — recorded by GA,
/// handed to Finance as a draft bill or linked to the bill/BKK it already has.
mod ga_expenses;
/// GA's places: the site register read as a list of places, the one-to-one
/// facilities detail beside it, and the hub that reads every reference back at
/// a place. See the module for why a site without a detail still appears.
mod ga_locations;
/// GA's upkeep: the schedule, the walk-round, the repair, the swap and the
/// disposal. The four facts between "we own this" and "Finance priced it".
mod ga_maintenance;
/// A vehicle's odometer over time: typed, from a receipt, or read at a service
/// (0975). The latest reading drives km-based service.
mod ga_odometer;
/// GA's papers: a document filed before it is scanned, its physical original,
/// and every handover of that original (BPKB in the safe, lent to Samsat).
mod ga_papers;
/// Projects, GA's half: a store opening or a renovation, its tasks counted
/// back from the opening day, and the records it holds (0997).
mod ga_projects;
/// GA's supplies: the ask a place files, the seven categories it is filed
/// under, and the ladder it walks to a bill Finance pays.
mod ga_supplies;
mod invitations;
mod job_roles;
/// Head office stops a till, a cashier or a whole store on the POS, and
/// removes a store that closed for good (0990). See the module.
mod pos_access;
mod pos_joins;
mod prepaid;
mod principal;
/// Projects, Finance's half: the cost lines a project gathered, and placing
/// them when it is capitalised (0997).
mod project_costs;
/// Goods beyond an order going back to the supplier (0710).
mod purchase_returns;
/// The 7Soft "Summary Penjualan per Divisi by HPP rata-rata" report, and the
/// same figures by tag.
mod sales_by_division;
mod sales_explorer;
mod sales_posting;
mod sales_rollup;
mod saved_reports;
mod segments;
mod setup;
mod statement_intake;
mod statements;
mod stock_card;
mod stock_ledger;
/// A store page's Actions menu: head office acting on a store's server and
/// devices, each action followed until it finishes. See migration 0643.
mod store_actions;
/// Store exceptions: the needs-attention list of what goes wrong in stores
/// (0646-0648). See the module.
mod store_exceptions;
/// Opening a store: its readiness checks, head office's decision, and
/// installing its server from the store's page. See the module.
mod store_fingers;
mod store_money;
/// A shop's own Send of its reject: the return allotment it stands on.
mod store_reject_return;
mod stores;
mod supplier_banks;
mod supplier_contacts;
mod suppliers;
mod sync;
mod sync_generation;
mod sync_health;
mod tagging;
mod tax;
mod time_machine;
mod transaction_categories;
mod unit_register;
mod units;
/// Sales the till could not take from its own stock, matched at head office.
mod unmatched_sales;
mod users;
mod vocabulary;
mod vouchers;

pub use account_links::*;
pub use accounting_dimensions::*;
pub use accounts::*;
pub use accruals::*;
pub use acquirer::*;
pub use allotment_amend::*;
pub use allotment_close_short::*;
pub use allotment_store_review::*;
pub use allotments::*;
pub use article_history::*;
pub use articles::*;
pub use asset_classes::*;
pub use assets::*;
pub use assistant::*;
pub use attendance::*;
pub use attendance_settings::*;
pub use audit::*;
pub use auth_policy::*;
pub use bank_rules::*;
pub use banking::*;
pub use basket::*;
pub use batches::*;
pub use benefit::*;
pub use campaigns::*;
pub use cap_allocation::{
    cap_allocation, rebalance_allocations, set_cap_allocation, CapAllocationRequest,
    CapAllocationView, ShopAllowanceView,
};
pub use cash::*;
pub use cash_counts::*;
pub use cash_repeats::*;
pub use catalogue::*;
pub use chart_changes::*;
pub use chat::*;
pub use checkout_exceptions::*;
pub use claim_benefits::*;
pub use claims::*;
pub use colours::*;
pub use commercial::*;
pub use company_banks::*;
pub use components::*;
pub use contractor_projects::*;
pub use control::*;
pub use corrections::*;
pub use counts::*;
pub use coupons::*;
pub use customer::*;
pub use data_requests::*;
pub use delegation::*;
pub use deposits::*;
pub use destinations::*;
pub use devices::*;
pub use discipline::*;
pub use discussion::*;
pub use documents::*;
pub use dossier::*;
pub use eligibility::*;
pub use employment::*;
pub use enrolment::*;
pub use exit::*;
pub use expense_categories::*;
pub use expense_codes::*;
pub use files::*;
pub use finance_policies::*;
pub use finance_setup::*;
pub use fleet_status::*;
pub use giro::*;
pub use giro_print::*;
pub use global_search::*;
pub use grievance::*;
pub use hire::*;
pub use holiday::*;
pub use integrity::*;
pub use interunit::*;
pub use inventory_valuation::*;
pub use jobs::{job_beat, JobList, JobRunRow, JobStatus};
pub use journal::*;
pub use journal_templates::*;
pub use leave::*;
pub use leave_extras::*;
pub use ledger::*;
pub use letters::*;
pub use line_categories::*;
pub use loyalty::*;
pub use management_fee::*;
pub use manual_journal::*;
pub use marketing_watch::*;
pub use member::*;
pub use member_otp::*;
pub use membership::*;
pub use movements::*;
pub use node_enrolment::*;
pub use node_health::*;
pub use notifications::*;
pub use number_series::{NumberSeries, NumberSeriesList, NumberSeriesPatch};
pub use observations::*;
pub use opening::*;
pub use organisation::*;
pub use overtime::*;
pub use party::*;
pub use pay::*;
pub use pay_component_accounts::*;
pub use payables::*;
pub use payables_flow::*;
pub use payment_allocation::*;
pub use payment_context::*;
pub use payment_instructions::*;
pub use payment_ledger::*;
pub use payment_methods::*;
pub use payment_terms::*;
pub use payments::*;
pub use people::*;
pub use performance::*;
pub use period_close::*;
pub use period_closing::*;
pub use permissions::*;
pub use poster::*;
pub use price_changes::*;
pub use price_history::*;
pub use pricing::*;
pub use project_costs::*;
pub use punch::*;
pub use push::*;
pub use queries::*;
pub use receipts::*;
pub use received_shipments::*;
pub use records::*;
pub use reminders::*;
pub use reports::*;
pub use reserves::*;
pub use point_policy::*;
pub use return_policy::*;
pub use returns::*;
pub use rollout::*;
pub use roster::*;
pub use sale_day::*;
pub use sales::*;
pub use schedule::*;
pub use sku_suppliers::*;
pub use supplier_returns::*;
pub use tax_templates::*;
pub use voucher::{voucher_record, CashDocumentLineRow, RecordVoucherRequest, VoucherLineRequest};
pub use withholding_report::*;
// lane-A
pub use advance::*;
pub use bill_template::*;
pub use finance_control::*;
pub use financial_statements::*;
pub use financing::*;
pub use ga::*;
pub use ga_accounts::*;
pub use ga_assets::*;
pub use ga_claims::*;
pub use ga_contracts::*;
pub use ga_expenses::*;
pub use ga_locations::*;
pub use ga_maintenance::*;
pub use ga_odometer::*;
pub use ga_papers::*;
pub use ga_projects::*;
pub use ga_supplies::*;
pub use invitations::*;
pub use job_roles::*;
pub use pos_access::*;
pub use pos_joins::*;
pub use prepaid::*;
pub use principal::*;
pub use purchase_returns::*;
pub use sales_by_division::*;
pub use sales_explorer::*;
pub use sales_posting::*;
pub use sales_rollup::*;
pub use saved_reports::*;
pub use segments::*;
pub use setup::*;
pub use statement_intake::*;
pub use statements::*;
pub use stock_card::*;
pub use stock_ledger::*;
pub use store_actions::*;
pub use store_exceptions::*;
pub use store_fingers::*;
pub use store_money::*;
pub use store_reject_return::*;
pub use stores::*;
pub use supplier_banks::*;
pub use supplier_contacts::*;
pub use suppliers::*;
pub use sync::*;
pub use sync_generation::*;
pub use sync_health::*;
pub use tagging::*;
pub use tax::*;
pub use time_machine::*;
pub use transaction_categories::*;
pub use unit_register::*;
pub use units::*;
pub use unmatched_sales::*;
pub use users::*;
pub use vocabulary::*;
pub use vouchers::*;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/postgres");

use crate::cloud::application::AppError;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

/// A keyset cursor, as the wire carries it: opaque, and issued only here.
///
/// Every paged list in this crate encodes WHERE THE LAST PAGE STOPPED — the
/// natural key of the final row — rather than how far into the answer it got.
/// An offset is a position in a list that is still being edited while somebody
/// reads it, and paging by one silently skips and repeats rows with nothing
/// saying so.
///
/// Hex over JSON, and opaque on purpose. A caller that can read a cursor is a
/// caller that will eventually construct one, and then the shape of the seek
/// is a published interface that cannot be changed without breaking somebody.
/// It survives a URL, a log line and a copy-paste out of an address bar with
/// nothing having to remember to escape it, which base64 does not.
///
/// `money_overview` predates this helper and carries its own copy; the two
/// agree byte for byte, and the older one is left alone rather than edited
/// from here while another lane has that file open.
pub(super) fn encode_cursor<T: Serialize>(value: &T) -> Result<String, AppError> {
    Ok(hex::encode(serde_json::to_vec(value)?))
}

/// The other half. Both failures answer the same sentence deliberately: a
/// cursor that does not decode and a cursor that decodes to the wrong shape
/// are the same mistake from the caller's side — it did not come from here —
/// and naming the internals in the message would only invite somebody to fix
/// their forgery.
pub(super) fn decode_cursor<T: DeserializeOwned>(raw: &str) -> Result<T, AppError> {
    let bytes = hex::decode(raw)
        .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
}

/// A keyset's two spellings of one order: the row expression and the `ORDER BY`.
///
/// They are not interchangeable — `ORDER BY` takes directions and a row
/// expression does not, so `(a ASC, b) > (…)` is a syntax error — and getting
/// them out of step is a class of bug the compiler cannot see, because both are
/// strings spliced into SQL. One function, so a new sort key cannot arrive with
/// only half of it written.
///
/// `tie` is the unique column every order ends in. Without it two rows that
/// compare equal on the lead can repeat or vanish across a page boundary, which
/// is the failure a keyset exists to prevent. When the lead IS the tie-break it
/// is not repeated: `(rule_id, rule_id)` is legal and pointless, and the reader
/// deserves the shorter clause.
///
/// `lead` is a column name this server chose from a closed set, never one a
/// caller sent — every list that calls this matches the caller's `sort` against
/// its own `match` arms first, because a list endpoint that accepts arbitrary
/// column names is a list endpoint that accepts arbitrary SQL.
pub(super) fn order_by(lead: &str, tie: &str, desc: bool) -> (String, String) {
    let dir = if desc { "DESC" } else { "ASC" };
    if lead == tie {
        return (tie.to_owned(), format!("{tie} {dir}"));
    }
    (
        format!("{lead}, {tie}"),
        format!("{lead} {dir}, {tie} {dir}"),
    )
}

pub fn payload_digest<T: Serialize>(payload: &T) -> Result<String, AppError> {
    let bytes = serde_json::to_vec(payload)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

pub(super) async fn begin_idempotent(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    command_type: &str,
    digest: &str,
) -> Result<Option<Value>, AppError> {
    if key.trim().is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    let inserted = sqlx::query(
        "INSERT INTO command_deduplication (idempotency_key, command_type, payload_digest) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING"
    ).bind(key).bind(command_type).bind(digest).execute(&mut **tx).await?.rows_affected() == 1;
    if inserted {
        return Ok(None);
    }
    let row = sqlx::query("SELECT command_type, payload_digest, response_json FROM command_deduplication WHERE idempotency_key=$1")
        .bind(key).fetch_one(&mut **tx).await?;
    let existing_type: String = row.try_get("command_type")?;
    let existing_digest: String = row.try_get("payload_digest")?;
    if existing_type != command_type || existing_digest != digest {
        return Err(AppError::Conflict(
            "idempotency key was already used with a different command or payload".into(),
        ));
    }
    let response: Option<Value> = row.try_get("response_json")?;
    response.map(Some).ok_or_else(|| {
        AppError::Conflict("matching command is still in progress; retry shortly".into())
    })
}

pub(super) async fn complete_idempotent(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    response: &Value,
) -> Result<(), AppError> {
    sqlx::query("UPDATE command_deduplication SET response_json=$2 WHERE idempotency_key=$1 AND response_json IS NULL")
        .bind(key).bind(response).execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn resolve_subject(
    tx: &mut Transaction<'_, Postgres>,
    subject_id: Option<Uuid>,
    epc: Option<&str>,
    lock: bool,
) -> Result<Uuid, AppError> {
    if subject_id.is_none() && epc.map(str::trim).filter(|v| !v.is_empty()).is_none() {
        return Err(AppError::Validation("subject_id or epc is required".into()));
    }
    let lock_clause = if lock { " FOR UPDATE" } else { "" };
    let row = if let Some(id) = subject_id {
        sqlx::query(&format!(
            "SELECT id FROM inventory_subject WHERE id=$1{lock_clause}"
        ))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        sqlx::query(&format!(
            "SELECT id FROM inventory_subject WHERE epc=$1{lock_clause}"
        ))
        .bind(epc.unwrap_or_default().trim().to_ascii_uppercase())
        .fetch_optional(&mut **tx)
        .await?
    };
    row.map(|r| r.get::<Uuid, _>("id"))
        .ok_or_else(|| AppError::NotFound("inventory subject".into()))
}

#[cfg(test)]
mod tests {
    use super::order_by;

    /// The keyset's two clauses, which are not the same string.
    ///
    /// The case worth writing down is the third: when the lead is already the
    /// tie-break, naming it twice is legal SQL that reads as a mistake.
    #[test]
    fn an_order_is_written_once_and_spelled_twice() {
        assert_eq!(
            order_by("name_key", "id", false),
            ("name_key, id".to_owned(), "name_key ASC, id ASC".to_owned())
        );
        assert_eq!(
            order_by("version", "rule_id", true),
            (
                "version, rule_id".to_owned(),
                "version DESC, rule_id DESC".to_owned()
            )
        );
        assert_eq!(
            order_by("rule_id", "rule_id", true),
            ("rule_id".to_owned(), "rule_id DESC".to_owned())
        );
    }
}
