//! The Payment Ledger, read-only.
//!
//! Four endpoints and not one of them writes. That is the shape of the module
//! rather than an omission: an open balance exists because a document was
//! posted, so the posting rule that wrote the document is the only thing
//! allowed to open or settle one. A `POST /finance/payment-ledger` would be a
//! second writer with its own opinion about when a debt is real — the failure
//! `poster.rs` exists to prevent on the journal side, arriving through a
//! different door. `cloud::postgres::payment_ledger` says the same thing at
//! greater length.
//!
//! # Who may read it
//!
//! Everything here sits under `/api/v1/finance`, and `domain::auth`
//! already puts that whole prefix behind SUPERVISOR to read and ADMIN to
//! write. Nothing is added here on purpose: a second RBAC rule beside the
//! central one is two policies that agree until somebody edits one. What a
//! till operator has no business seeing is the supplier balances and what the
//! company owes, and that is exactly what this is.

use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, PaymentLedgerAging, PaymentLedgerEntry, PaymentLedgerFilter,
        PaymentLedgerIntegrity, PaymentLedgerPartyStatement, PaymentLedgerPartyType,
        PaymentLedgerSettlementRow, PaymentLedgerSide,
    },
};
use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// Open items are what somebody opening this screen came for; a settled one is
/// most of the table within a year and none of the question. Asking for the
/// rest is `open_only=false`.
const fn open_by_default() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct PaymentLedgerQuery {
    /// The semantic key of the control account: `trade_payable`,
    /// `card_receivable_debit`, `store_manager_receivable`.
    pub account: Option<String>,
    pub qualifier: Option<String>,
    /// Whose books: a unit id (0608).
    pub unit: Option<String>,
    pub party_type: Option<String>,
    pub party: Option<String>,
    pub voucher_kind: Option<String>,
    pub voucher: Option<String>,
    /// `RECEIVABLE` or `PAYABLE` — which is how Accounts Receivable and
    /// Accounts Payable are two readings of one table rather than two ledgers.
    pub side: Option<String>,
    #[serde(default = "open_by_default")]
    pub open_only: bool,
    pub as_of: Option<NaiveDate>,
    pub limit: Option<i64>,
}

impl PaymentLedgerQuery {
    fn filter(&self) -> Result<PaymentLedgerFilter, AppError> {
        Ok(PaymentLedgerFilter {
            account_key: self.account.clone(),
            qualifier: self.qualifier.clone(),
            unit_id: self.unit.clone(),
            party_type: self
                .party_type
                .as_deref()
                .map(PaymentLedgerPartyType::parse)
                .transpose()?,
            party_id: self.party.clone(),
            voucher_kind: self.voucher_kind.clone(),
            voucher_id: self.voucher.clone(),
            side: self
                .side
                .as_deref()
                .map(PaymentLedgerSide::parse)
                .transpose()?,
            open_only: self.open_only,
            as_of: self.as_of,
            limit: self.limit.unwrap_or(200),
        })
    }
}

/// What the ledger holds for one filter.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentLedgerView {
    pub as_of: NaiveDate,
    pub items: Vec<PaymentLedgerEntry>,
    /// The settlement history, and only when the query names a voucher.
    ///
    /// It rides along rather than living on an endpoint of its own because it
    /// is never wanted alone: the screen asking "what is open against this
    /// bill" is the same screen asking "and what has been paid against it", and
    /// two round trips to draw one panel is two loading states for one answer.
    pub settlements: Vec<PaymentLedgerSettlementRow>,
    pub open_items: i64,
    pub outstanding_minor: i64,
}

pub async fn items(
    State(state): State<AppState>,
    Query(query): Query<PaymentLedgerQuery>,
) -> Result<Json<PaymentLedgerView>, AppError> {
    let filter = query.filter()?;
    let items = infrastructure::ple_open_items(&state.db, &filter).await?;
    let settlements = match (&query.voucher_kind, &query.voucher) {
        (Some(kind), Some(voucher)) => {
            infrastructure::payment_ledger_settlements(&state.db, kind, voucher).await?
        }
        _ => Vec::new(),
    };
    let open_items = items
        .iter()
        .filter(|item| item.outstanding_minor != 0)
        .count() as i64;
    let outstanding_minor = items.iter().map(|item| item.outstanding_minor).sum();
    Ok(Json(PaymentLedgerView {
        as_of: filter
            .as_of
            .unwrap_or_else(|| chrono::Utc::now().date_naive()),
        items,
        settlements,
        open_items,
        outstanding_minor,
    }))
}

pub async fn aging(
    State(state): State<AppState>,
    Query(query): Query<PaymentLedgerQuery>,
) -> Result<Json<PaymentLedgerAging>, AppError> {
    let filter = query.filter()?;
    Ok(Json(
        infrastructure::payment_ledger_aging(&state.db, query.as_of, &filter).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct IntegrityQuery {
    /// Whose books: a unit id (0608).
    pub unit: Option<String>,
    pub as_of: Option<NaiveDate>,
}

/// Does the Payment Ledger agree with the books.
///
/// The one read this lane exists for. A row whose `difference_minor` is not
/// zero is a sub-ledger and a general ledger disagreeing about the same money,
/// and the row names the account and the unit so the disagreement can be
/// gone and looked at rather than announced.
pub async fn integrity(
    State(state): State<AppState>,
    Query(query): Query<IntegrityQuery>,
) -> Result<Json<PaymentLedgerIntegrity>, AppError> {
    Ok(Json(
        infrastructure::payment_ledger_integrity(&state.db, query.as_of, query.unit.as_deref())
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct PartyQuery {
    pub as_of: Option<NaiveDate>,
    #[serde(default = "open_by_default")]
    pub open_only: bool,
}

/// One party's statement: what is open with them, oldest first, bucketed.
pub async fn party(
    State(state): State<AppState>,
    Path((party_type, party_id)): Path<(String, String)>,
    Query(query): Query<PartyQuery>,
) -> Result<Json<PaymentLedgerPartyStatement>, AppError> {
    let kind = PaymentLedgerPartyType::parse(&party_type)?;
    Ok(Json(
        infrastructure::payment_ledger_party(
            &state.db,
            kind,
            &party_id,
            query.as_of,
            query.open_only,
        )
        .await?,
    ))
}

/// The Payment Ledger's four reads, hung on a router the caller owns.
///
/// A function rather than four more lines in `router()` because these four
/// belong together and arrive together: `/aging` and `/integrity` are single
/// segments and `{party_type}/{party_id}` is two, so axum's own ranking of
/// static over dynamic never has to choose between them.
pub fn lane_p_routes(r: Router<AppState>) -> Router<AppState> {
    r.route("/api/v1/finance/payment-ledger", get(items))
        .route("/api/v1/finance/payment-ledger/aging", get(aging))
        .route("/api/v1/finance/payment-ledger/integrity", get(integrity))
        .route(
            "/api/v1/finance/payment-ledger/{party_type}/{party_id}",
            get(party),
        )
}
