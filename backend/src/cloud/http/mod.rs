use crate::cloud::{
    application::*,
    domain::{IngestBatch, RecordKind},
    http::audit::{id_in, DeclaredSubject},
    postgres as infrastructure,
};
use crate::security;
use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    routing::{get, patch, post, put},
    Extension, Json, Router,
};
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use uuid::Uuid;

// lane-H
pub mod acquirer;
pub mod articles;
pub mod assets;
pub mod assistant;
pub mod attendance;
pub mod audit;
pub mod auth;
pub mod basket;
pub mod campaigns;
pub mod catalogue;
pub mod categories;
pub mod chat;
pub mod colours;
/// The payroll component catalogue, its ratified rates, and the one-off
/// figures a place files. See `domain::component`.
pub mod components;
pub mod coupons;
pub mod customer;
pub mod discussion;
pub mod documents;
pub mod employment;
pub mod files;
pub mod finance;
pub mod giro_print;
pub mod hire;
pub mod holiday;
pub mod integrity;
pub mod interunit;
pub mod leave;
pub mod letters;
pub mod member;
pub mod money;
pub mod notifications;
pub mod opening;
pub mod overtime;
pub mod pay;
pub mod payables_flow;
pub mod payment_ledger;
pub mod payments_lane;
pub mod performance;
pub mod punch;
pub mod records;
pub mod reports;
pub mod roster;
// lane-A
pub mod sales_posting;
pub mod statement_intake;
pub mod stock_ledger;
pub mod store_money;
pub mod supplier_banks;
pub mod suppliers;
pub mod sync_generation;
pub mod sync_health;
pub mod terminal;
pub mod vocabulary;
pub mod vouchers;

/// Exact browser origins from config. Unset means same-origin only.
fn cors_layer(config: &AppConfig) -> CorsLayer {
    match &config.cors_allowed_origins {
        Some(origins) => {
            let list: Vec<HeaderValue> = origins
                .split(',')
                .filter_map(|origin| origin.trim().parse().ok())
                .collect();
            CorsLayer::new()
                .allow_origin(list)
                .allow_methods([Method::GET, Method::POST, Method::PATCH])
                .allow_headers([
                    header::CONTENT_TYPE,
                    header::AUTHORIZATION,
                    header::IF_MATCH,
                    header::HeaderName::from_static("idempotency-key"),
                    header::HeaderName::from_static("x-csrf-token"),
                ])
                .expose_headers([header::ETAG])
                .allow_credentials(true)
        }
        None => CorsLayer::new(),
    }
}

pub fn router(state: AppState) -> Router {
    let frontend = state.config.frontend_dir.clone();
    // Four lanes hand their routes in as one call each rather than twenty
    // lines here — several sessions edit this function in a week, and a call
    // is the smallest hunk that can conflict.
    //
    // Inter-unit is the one figure in these books that two people have to
    // agree about; Lane S owns the generation handshake and the receiver's
    // integrity alerts; Lane G the rest of the payables loop — valuing a
    // delivery, matching a bill to it, credit notes, advances, withholding;
    // Lane E the integrity engine and the attention feed.
    let router = integrity::lane_e_routes(payables_flow::lane_g_routes(
        sync_generation::lane_s_routes(interunit::lane_d_routes(Router::new())),
    ))
    .merge(crate::cloud::media::router())
    .route("/api/v1/health", get(health))
    .route("/api/v1/inventory/pools", get(pools))
    .route("/api/v1/inventory/fleet-pools", get(fleet_pools))
    .route(
        "/api/v1/inventory/reconciliations",
        get(transfer_reconciliations),
    )
    .route("/api/v1/inventory/pools/{id}", get(pool_detail))
    .route(
        "/api/v1/inventory/allotments",
        get(allotments).post(create_allotment),
    )
    .route(
        "/api/v1/inventory/allotments/by-store/{store_id}",
        get(allotments_by_store),
    )
    .route("/api/v1/inventory/allotments/{id}", get(allotment_detail))
    .route(
        "/api/v1/inventory/allotments/{id}/cancel",
        post(cancel_allotment),
    )
    .route(
        "/api/v1/inventory/allotments/{id}/execute",
        post(execute_allotment),
    )
    .route("/api/v1/inventory/availability", get(availability))
    .route(
        "/api/v1/inventory/movements",
        get(movements).post(move_stock),
    )
    .route("/api/v1/inventory/movements/correct", post(correct))
    .route(
        "/api/v1/inventory/observations",
        get(observations).post(observe),
    )
    .route("/api/v1/inventory/observation-anomalies", get(anomalies))
    .route("/api/v1/inventory/counts", get(counts).post(create_count))
    .route("/api/v1/inventory/counts/{id}", get(count_detail))
    .route(
        "/api/v1/inventory/counts/{id}/activate",
        post(activate_count),
    )
    .route("/api/v1/inventory/counts/{id}/entries", post(count_entries))
    .route("/api/v1/inventory/counts/{id}/submit", post(submit_count))
    .route("/api/v1/inventory/counts/{id}/approve", post(approve_count))
    .route("/api/v1/inventory/missing", get(missing))
    .route("/api/v1/inventory/missing/{id}/found", post(found))
    .route("/api/v1/inventory/missing/{id}/lost", post(lost))
    .route("/api/v1/inventory/missing/{id}/dispose", post(dispose))
    .route("/api/v1/inventory/as-of", get(as_of))
    .route("/api/v1/inventory/replay", post(replay))
    .route("/api/v1/inventory/repost", post(repost))
    .route("/api/v1/inventory/control", get(control))
    .route(
        "/api/v1/inventory/control/corrupt-projection",
        post(corrupt_projection),
    )
    .route("/api/v1/inventory/time-machine/state", get(tm_state))
    .route(
        "/api/v1/inventory/time-machine/divergence",
        get(tm_divergence),
    )
    .route(
        "/api/v1/inventory/time-machine/sync-divergence",
        get(tm_sync_divergence),
    )
    .route("/api/v1/inventory/time-machine/what-if", post(tm_what_if))
    .route(
        "/api/v1/commercial/publications",
        get(commercial_publications).post(create_commercial_publication),
    )
    .route(
        "/api/v1/commercial/publications/{id}",
        get(commercial_publication_detail),
    )
    .route(
        "/api/v1/commercial/publications/{id}/publish",
        post(publish_commercial_publication),
    )
    // Which shop is charging which book, and what the promotions have cost.
    // Both tables have been written for a while and read by nothing: a shop
    // whose sync had stalled looked exactly like one that was up to date.
    .route("/api/v1/commercial/activation", get(commercial_activation))
    .route("/api/v1/commercial/usage", get(commercial_usage))
    .route(
        "/api/v1/commercial/usage/publish",
        post(publish_commercial_usage),
    )
    // Price a basket without selling it. A write in shape only — nothing is
    // recorded — so that a promotion can be checked before it is published
    // rather than discovered at a counter.
    .route("/api/v1/commercial/simulate", post(commercial_simulate))
    .route("/api/v1/commercial/offers/resolve", get(resolve_offer))
    .route("/api/v1/commercial/offers", get(commercial_offers))
    // Styles rather than products, every shop side by side, and the losing
    // candidates as well as the winner.
    .route("/api/v1/commercial/article-prices", get(article_prices))
    // What a book can name. The authoring screen's picker: a merchandiser
    // types a code or a description and gets back the product with what it
    // currently costs, which is the number a change is judged against.
    .route("/api/v1/commercial/products", get(commercial_products))
    // What the offers did, as opposed to what they say. Read from the sale
    // facts rather than from the usage counters, because a counter has no
    // window and no shop: it can say a rule spent four million and never
    // say whether that was last week or last year.
    .route(
        "/api/v1/commercial/performance/campaigns",
        get(performance::campaign_performance),
    )
    .route(
        "/api/v1/commercial/performance/rules",
        get(performance::rule_performance),
    )
    .route(
        "/api/v1/commercial/performance/pricelist",
        get(performance::pricelist_performance),
    )
    // What every published book declares, deduplicated the way a shop
    // resolves it: newest book wins. Promotions and Campaign used to build
    // this in the browser by opening each published book in turn, which was
    // eleven requests in dev and one more with every publish.
    .route("/api/v1/commercial/rules", get(catalogue::commercial_rules))
    .route(
        "/api/v1/commercial/coupons",
        get(catalogue::commercial_coupons),
    )
    .route(
        "/api/v1/commercial/campaigns",
        get(catalogue::commercial_campaigns),
    )
    .route(
        // The one lever on a published campaign. Everything else in a book
        // is frozen; this is what "stop the Lebaran promo" reaches for, and
        // it dispatches to the fleet in the same call.
        "/api/v1/commercial/campaigns/{campaign_id}",
        axum::routing::patch(switch_campaign),
    )
    // Vouchers. Under `/commercial` because that is the module a
    // merchandiser reaches them from, and NOT because a voucher is
    // pricing — it is tender, and the screen above them says so. The
    // redemption route is the one a till calls; `required_role` puts it on
    // the Cashier rung, where the other three stay Supervisor.
    .route(
        "/api/v1/commercial/vouchers",
        get(vouchers::list_vouchers).post(vouchers::issue_voucher),
    )
    .route(
        "/api/v1/commercial/vouchers/{code}",
        get(vouchers::voucher_detail),
    )
    .route(
        "/api/v1/commercial/vouchers/{code}/redeem",
        post(vouchers::redeem_voucher),
    )
    .route(
        "/api/v1/commercial/vouchers/{code}/void",
        post(vouchers::void_voucher),
    )
    .route(
        "/api/v1/suppliers",
        get(suppliers::list_suppliers).post(suppliers::create_supplier),
    )
    .route(
        "/api/v1/suppliers/{id}",
        get(suppliers::supplier_detail).patch(suppliers::update_supplier),
    )
    .route(
        "/api/v1/suppliers/{id}/activate",
        post(suppliers::activate_supplier),
    )
    .route(
        "/api/v1/suppliers/{id}/deactivate",
        post(suppliers::deactivate_supplier),
    )
    .route(
        "/api/v1/suppliers/{id}/items",
        get(suppliers::list_supplier_items).post(suppliers::create_supplier_item),
    )
    .route(
        "/api/v1/supplier-items",
        get(suppliers::search_supplier_items),
    )
    .route(
        "/api/v1/catalogue/vocabulary",
        get(suppliers::catalogue_vocabulary),
    )
    // The master product, read whole. Nothing listed `article` before
    // this; every screen that wanted to know what the company sells was
    // reading the supplier catalogue, which is what somebody offers us.
    .route("/api/v1/articles", get(articles::search_articles))
    .route(
        "/api/v1/articles/{article_code}",
        get(articles::article_detail).patch(articles::update_article),
    )
    // The colour master. Picked from, never typed into — which is why the
    // only way a colour is created is deliberately, here.
    .route(
        "/api/v1/colours",
        get(colours::list_colours).post(colours::create_colour),
    )
    .route(
        "/api/v1/colours/{code}",
        patch(colours::update_colour).delete(colours::delete_colour),
    )
    // Divisions, sizes and tags. One route pair for the three, because
    // they are one shape — code, label, order, active — and nine handlers
    // differing in one word is where the ninth forgets the auth check.
    // They had tables from 0022 and 0027 and no way in until 0091: every
    // term was a row somebody INSERTed in a migration.
    .route(
        "/api/v1/vocabulary/{kind}",
        get(vocabulary::list_terms).post(vocabulary::create_term),
    )
    .route(
        "/api/v1/vocabulary/{kind}/{code}",
        patch(vocabulary::update_term).delete(vocabulary::delete_term),
    )
    // The drawer. Upload goes past this process to the bucket; everything
    // else is small enough to come through it.
    .route(
        "/api/v1/documents",
        get(documents::search).post(documents::file),
    )
    .route("/api/v1/documents/upload-url", post(documents::upload_url))
    .route("/api/v1/documents/{id}", get(documents::detail))
    .route(
        "/api/v1/documents/{id}/download-url",
        get(documents::download_url),
    )
    // The bytes through the node, for the documents `download-url` cannot
    // answer for — the ones stored in the database rather than a bucket —
    // and for the tile previews, which need a stable path an `<img>` can be
    // pointed at rather than a URL that expires in five minutes.
    .route("/api/v1/documents/{id}/content", get(documents::content))
    .route(
        "/api/v1/supplier-items/{id}",
        get(suppliers::supplier_item_detail).patch(suppliers::update_supplier_item),
    )
    .route(
        "/api/v1/supplier-items/{id}/activate",
        post(suppliers::activate_supplier_item),
    )
    .route(
        "/api/v1/supplier-items/{id}/deactivate",
        post(suppliers::deactivate_supplier_item),
    )
    // The buyer's basket: picked out, not yet ordered. Scoped to the
    // caller by the session, so no path here names a user.
    .route(
        "/api/v1/sourcing-basket",
        get(basket::read_basket).post(basket::add_to_basket),
    )
    .route("/api/v1/sourcing-basket/clear", post(basket::clear_basket))
    .route(
        "/api/v1/sourcing-basket/{supplier_item_id}",
        patch(basket::set_basket_quantity),
    )
    .route(
        "/api/v1/sourcing-basket/{supplier_item_id}/remove",
        post(basket::remove_from_basket),
    )
    .route("/api/v1/sales", get(sales).post(create_sale))
    .route("/api/v1/sales/{id}", get(sale_detail))
    .route("/api/v1/sales/{id}/lines", post(add_sale_line))
    .route("/api/v1/sales/{id}/payments", post(add_sale_payment))
    .route("/api/v1/sales/{id}/complete", post(complete_sale))
    .route("/api/v1/sales/{id}/void", post(void_sale))
    .route("/api/v1/sales/{id}/receipt", get(sale_receipt))
    // A sale that happened at a shop, not one made here. Separate paths
    // because they are separate records: `sale` is the centre's own, and
    // `edge_sale` is where essentially every real sale lives.
    .route("/api/v1/shop-sales/{id}", get(shop_sale_detail))
    .route("/api/v1/sales/{id}/returns", post(create_sale_return))
    .route("/api/v1/returns", get(sale_returns))
    .route("/api/v1/returns/{id}", get(sale_return_detail))
    .route("/api/v1/reports/sales/daily", get(daily_report))
    .route("/api/v1/reports/sales/series", get(sales_series))
    .route("/api/v1/reports/sales/window", get(sales_window))
    // What a member is allowed to see about themselves. Read-only: points
    // are earned by buying something at a till, and the surface a shopper
    // holds is the last place that should be able to change them.
    .route(
        "/api/v1/customer/{customer_id}/summary",
        get(customer::summary),
    )
    .route(
        "/api/v1/customer/{customer_id}/transactions",
        get(customer::transactions),
    )
    .route(
        "/api/v1/customer/{customer_id}/transactions/{sale_id}",
        get(customer::transaction),
    )
    // ── the member's own surface ────────────────────────────────────
    //
    // Two prefixes on purpose. `/members` (plural) is the counter: enrol a
    // card, issue the six digits a cashier reads out. `/member` (singular)
    // is the shopper, holding a member session and able to read only their
    // own sales. See `http/member.rs` for why the routes above this — the
    // `/customer/{id}/...` lookups — stay operator-only rather than being
    // replaced.
    .route(
        "/api/v1/members",
        get(member::directory).post(member::enrol),
    )
    // Above `{member_id}` shapes for readability only — axum ranks a
    // literal segment over a capture regardless of declaration order.
    .route("/api/v1/members/segments", get(member::segments))
    // The other half of the segment book's arithmetic: the numbers a till
    // wrote onto sales that no card was ever enrolled for. Under
    // `/members` and not a segment — they hold no card — but this is where
    // somebody goes looking for them.
    .route("/api/v1/members/unenrolled", get(member::unenrolled))
    // The other species of segment: written down rather than worked out.
    // Under `saved` so the URL says which is which — the six above cannot
    // be written, and these cannot be exhaustive.
    .route(
        "/api/v1/members/segments/saved",
        get(member::saved_segments).post(member::create_segment),
    )
    .route(
        "/api/v1/members/segments/preview",
        post(member::preview_segment),
    )
    .route(
        "/api/v1/members/segments/saved/{id}",
        get(member::read_segment).post(member::revise_segment),
    )
    // Retired, not deleted, and so a POST rather than a DELETE: the
    // versions stay, because they are the record of what a message was
    // actually sent to.
    .route(
        "/api/v1/members/segments/saved/{id}/retire",
        post(member::archive_segment),
    )
    .route(
        "/api/v1/members/{member_id}/pairing-code",
        post(member::issue_code),
    )
    .route("/api/v1/member/session", post(member::pair))
    .route("/api/v1/member/logout", post(member::sign_out))
    .route("/api/v1/member/me", get(member::me))
    .route("/api/v1/member/summary", get(member::summary))
    .route("/api/v1/member/transactions", get(member::transactions))
    .route(
        "/api/v1/member/transactions/{sale_id}",
        get(member::transaction),
    )
    .route("/api/v1/auth/login", post(auth::login))
    .route("/api/v1/auth/me", get(auth::me))
    .route("/api/v1/auth/logout", post(auth::logout))
    .route("/api/v1/auth/change-password", post(auth::change_password))
    .route(
        "/api/v1/auth/users",
        get(auth::list_users).post(auth::create_user),
    )
    .route(
        "/api/v1/auth/users/{id}/active",
        post(auth::set_user_active),
    )
    .route(
        "/api/v1/auth/users/{id}/password",
        post(auth::reset_password),
    )
    .route("/api/v1/auth/users/{id}/role", post(auth::set_user_role))
    .route(
        "/api/v1/auth/edge-assignments",
        get(auth::edge_assignments).post(auth::upsert_edge_assignment),
    )
    .route(
        "/api/v1/auth/edge-assignments/{origin_id}/{user_id}/active",
        post(auth::set_edge_assignment_active),
    )
    .route(
        "/api/v1/auth/rfid-devices",
        get(auth::rfid_devices).post(auth::register_rfid_device),
    )
    .route(
        "/api/v1/auth/rfid-devices/{device_id}/active",
        post(auth::set_rfid_device_active),
    )
    .route(
        "/api/v1/auth/rfid-devices/{device_id}/rotate",
        post(auth::rotate_rfid_device_key),
    )
    .route(
        "/api/v1/auth/edge-policies/{origin_id}/publish",
        post(auth::publish_edge_policy),
    )
    .route("/api/v1/sync/status", get(sync_status))
    .route("/api/v1/sync/ingest", post(sync_ingest))
    .route("/api/v1/sync/dead-letters", get(sync_dead_letters))
    .route("/api/v1/sync/trigger", post(sync_trigger))
    .route("/api/v1/sync/breaker/reset", post(sync_breaker_reset))
    .route(
        "/api/v1/sync/origins",
        get(sync_list_origins).post(sync_register_origin),
    )
    .route("/api/v1/sync/commands", post(sync_issue_command))
    .route("/api/v1/sync/commands/{id}", get(sync_command_reach))
    .route(
        "/api/v1/sync/commands/{id}/revoke",
        post(sync_revoke_command),
    )
    .route("/api/v1/sync/fleet", get(sync_fleet))
    .route("/api/v1/sync/reconciliation", get(sync_reconciliation))
    .route(
        "/api/v1/purchase-orders",
        get(list_purchase_orders).post(raise_purchase_order),
    )
    .route(
        "/api/v1/purchase-orders/catalog",
        post(suppliers::create_catalog_purchase_order),
    )
    .route(
        "/api/v1/purchase-destinations",
        get(suppliers::list_purchase_destinations),
    )
    .route("/api/v1/purchase-orders/{id}", get(purchase_order_detail))
    .route(
        "/api/v1/purchase-order-lines/{id}/close-short",
        post(close_purchase_line_short),
    )
    .route(
        "/api/v1/purchase-price-amendments",
        get(pending_price_amendments),
    )
    .route(
        "/api/v1/purchase-price-amendments/{id}/decide",
        post(decide_price_amendment),
    )
    // Head office giving a delivery its identity.
    .route(
        "/api/v1/article-setups",
        get(list_setup_sessions).post(open_setup_session),
    )
    .route(
        "/api/v1/article-setups/unidentified",
        get(list_unidentified_receipts),
    )
    .route("/api/v1/article-setups/{id}", get(setup_session_detail))
    .route(
        "/api/v1/article-setups/{id}/issue",
        post(issue_setup_session),
    )
    .route("/api/v1/article-codes", post(mint_article_code))
    // Reports. The catalogue says what a report may be about, `run`
    // answers a spec without keeping it, and everything under `saved` is
    // append-only — editing writes a version rather than overwriting one.
    .route("/api/v1/reports/catalogue", get(reports::catalogue))
    .route("/api/v1/reports/run", post(reports::run))
    .route(
        "/api/v1/reports/saved",
        get(reports::list).post(reports::create),
    )
    .route(
        "/api/v1/reports/saved/{id}",
        get(reports::read).patch(reports::amend),
    )
    .route("/api/v1/reports/saved/{id}/versions", post(reports::revise))
    .route("/api/v1/reports/saved/{id}/run", post(reports::run_saved))
    // The assistant. One question in, one streamed answer out, and the
    // reads it made along the way — every one of them a query that already
    // backs a screen, so nothing here can reach further than the person
    // asking already could.
    .route("/api/v1/assistant/ask", post(assistant::ask))
    // The chats themselves. Kept on the node rather than in the tab that
    // asked, so the sidebar of past questions survives a reload and a
    // different machine — see migration `0102`.
    .route(
        "/api/v1/assistant/conversations",
        get(assistant::conversations),
    )
    .route(
        "/api/v1/assistant/conversations/{id}",
        get(assistant::conversation)
            .patch(assistant::rename_conversation)
            .delete(assistant::discard_conversation),
    )
    .route(
        "/api/v1/assistant/capabilities",
        get(assistant::capabilities),
    )
    // The figures the home screen opens with. Not a model call: it is the
    // same handful of numbers every morning and they are all already
    // computed.
    .route("/api/v1/assistant/brief", get(assistant::brief))
    // Talking. Conversations are private to their participants;
    // discussions are readable by everybody signed in, because an argument
    // about a purchase order is a record and not correspondence.
    .route(
        "/api/v1/chat/conversations",
        get(chat::list_conversations).post(chat::start_conversation),
    )
    .route(
        "/api/v1/chat/conversations/{id}",
        get(chat::read_conversation),
    )
    .route(
        "/api/v1/chat/conversations/{id}/messages",
        get(chat::read_messages).post(chat::send_message),
    )
    .route(
        "/api/v1/chat/conversations/{id}/read",
        post(chat::mark_read),
    )
    .route(
        "/api/v1/chat/conversations/{id}/files",
        get(chat::conversation_files),
    )
    // The conversation id in this path is the permission, not decoration:
    // a file id on its own reaches nothing.
    .route(
        "/api/v1/chat/conversations/{id}/attachments/{file_id}",
        get(chat::attachment),
    )
    // Resumable from the last event actually received, so a dropped
    // connection fills its gap instead of skipping it.
    .route("/api/v1/chat/stream", get(chat::stream))
    .route("/api/v1/chat/events", get(chat::events))
    // Work that found a person. Read-only plus two ways to say "dealt
    // with": nothing here can raise one, because a notification exists
    // only as a consequence of something that actually happened.
    // Finance. Reads are projections; the only writer is `poster::post`.
    .route("/api/v1/finance/accounts", get(finance::accounts))
    .route(
        "/api/v1/finance/accounts/{code}",
        get(finance::account_detail),
    )
    .route(
        "/api/v1/finance/accounts/{code}/ledger",
        get(finance::account_ledger),
    )
    .route("/api/v1/finance/trial-balance", get(finance::trial_balance))
    .route("/api/v1/finance/balances", get(finance::balances))
    .route("/api/v1/finance/statement", get(finance::statement))
    .route(
        "/api/v1/finance/bills",
        get(finance::bills).post(finance::record_bill),
    )
    // The detail read. Separate from the list because it is the only one
    // that fetches the expense lines — the list leaves them null rather
    // than running a query per row to draw a table.
    .route("/api/v1/finance/bills/{id}", get(finance::bill))
    .route("/api/v1/finance/bills/{id}/post", post(finance::post_bill))
    .route("/api/v1/finance/unbilled", get(finance::unbilled))
    // What is owed and how late. Beside the bills, not in Reports: it is
    // the list somebody works from to decide who gets paid this week.
    .route(
        "/api/v1/finance/payables-aging",
        get(finance::payables_aging),
    )
    // Money leaving. A payment is recorded, allocated against posted bills,
    // and only then posted — the same two-step a bill goes through, and for
    // the same reason: keying and booking are different acts by different
    // people.
    .route(
        "/api/v1/finance/payments",
        get(finance::payments).post(finance::record_payment),
    )
    .route("/api/v1/finance/payments/{id}", get(finance::payment))
    .route(
        "/api/v1/finance/payments/{id}/post",
        post(finance::post_payment),
    )
    .route(
        "/api/v1/finance/assets",
        get(finance::assets).post(finance::register_asset),
    )
    .route(
        "/api/v1/finance/assets/{id}/assess",
        post(finance::assess_asset),
    )
    // Where the register and the books disagree about what was bought.
    // Registered above `{id}` routes only by convention — the segment
    // counts differ, so there is no ambiguity to resolve.
    //
    // There is no acquisition posting rule and there will not be one: an
    // asset is bought by a supplier bill, and 0094's expense bill already
    // posts a line coded to a 10215* account. This is the exception report
    // for where that link is missing in either direction.
    .route(
        "/api/v1/finance/assets/unbacked",
        get(finance::unbacked_assets),
    )
    // The other end of an asset's life. Disposal takes its cost and its
    // accumulated depreciation out of the books and lands the difference in
    // a gain or a loss; a transfer moves both between two locations,
    // because the client keeps a profit and loss per location and moving
    // the cost alone would leave two of them wrong.
    .route(
        "/api/v1/finance/assets/{id}/dispose",
        post(finance::dispose_asset),
    )
    .route(
        "/api/v1/finance/assets/{id}/transfer",
        post(finance::transfer_asset),
    )
    // What was actually charged, month by month, and what is left to
    // charge. The record and the projection side by side, which is the only
    // way to see that a run has been quietly skipping an asset.
    .route(
        "/api/v1/finance/assets/{id}/schedule",
        get(finance::asset_schedule),
    )
    .route(
        "/api/v1/finance/depreciation/run",
        post(finance::run_depreciation),
    )
    // The month that charges itself, whether or not a month is complete,
    // and the replacement reserve the client's own chart has always had.
    .merge(assets::lane_j_routes(Router::new()))
    // Where the money is. One row per mapped money account per location,
    // beside the last statement imported for it — the list a treasurer
    // opens. `bank-statements` below is the drill-in from a row of it.
    .route("/api/v1/finance/money", get(finance::money))
    .route(
        "/api/v1/finance/bank-statements",
        get(finance::bank_statements).post(finance::import_bank_statement),
    )
    .route(
        "/api/v1/finance/bank-statements/{id}/lines",
        get(finance::bank_statement_lines),
    )
    .route(
        "/api/v1/finance/bank-statements/{id}/suggestions",
        get(finance::bank_suggestions),
    )
    .route(
        "/api/v1/finance/bank-lines/{id}/match",
        post(finance::confirm_bank_match).delete(finance::unmatch_bank_line),
    )
    // The other half of reconciling: a line the bank has and the books do
    // not. Writes the entry AND agrees the line with it, in one
    // transaction — the two are one decision, and splitting them leaves a
    // window in which an entry exists and nothing points at its cause.
    .route(
        "/api/v1/finance/bank-lines/{id}/book",
        post(finance::book_bank_line),
    )
    .route(
        "/api/v1/finance/account-map",
        get(finance::account_map).post(finance::set_account_map),
    )
    .route(
        "/api/v1/finance/periods",
        get(finance::periods).post(finance::open_period),
    )
    .route("/api/v1/finance/periods/close", post(finance::close_period))
    // A period's id is its label — `2026-09` — because a month has no
    // surrogate key and `/periods/2026-09/reopen` is a URL somebody can
    // read in a log. Registered after `/periods/close` so that the literal
    // segment is matched first and nobody can name a period "close".
    .route(
        "/api/v1/finance/periods/{id}/checklist",
        get(finance::period_checklist),
    )
    .route(
        "/api/v1/finance/periods/{id}/reopen",
        post(finance::reopen_period),
    )
    .route(
        "/api/v1/finance/periods/{id}/events",
        get(finance::period_events),
    )
    // The three corrections. One collection and one document, then the
    // three drafting routes: the kind is in the path rather than the body
    // because they take genuinely different requests, and one endpoint
    // switching on a `kind` field would be one handler with three
    // half-validated shapes in it.
    .route("/api/v1/finance/corrections", get(finance::corrections))
    .route(
        "/api/v1/finance/corrections/reclass",
        post(finance::create_reclass),
    )
    .route(
        "/api/v1/finance/corrections/adjustment",
        post(finance::create_adjustment),
    )
    .route(
        "/api/v1/finance/corrections/write-off",
        post(finance::create_write_off),
    )
    .route("/api/v1/finance/corrections/{id}", get(finance::correction))
    .route(
        "/api/v1/finance/corrections/{id}/approve",
        post(finance::approve_correction),
    )
    .route(
        "/api/v1/finance/corrections/{id}/post",
        post(finance::post_correction),
    )
    .route(
        "/api/v1/finance/corrections/{id}/reverse",
        post(finance::reverse_correction),
    )
    .route(
        "/api/v1/finance/journal",
        get(finance::journal).post(finance::post_manual_entry),
    )
    .route("/api/v1/finance/journal/{id}", get(finance::journal_entry))
    .route(
        "/api/v1/finance/journal/{id}/reverse",
        post(finance::reverse_entry),
    )
    // The Payment Ledger: what is open, how old it is, and whether it
    // agrees with the books. Read-only — an open balance is opened by the
    // posting rule that created the document, never by a screen.
    .merge(payment_ledger::lane_p_routes(Router::new()))
    // lane-A routes: a day of takings, and moving a settled tender.
    .merge(sales_posting::lane_a_routes(Router::new()))
    // lane-H routes: a shop's evening against its own EDC slip, and
    // head office settling what the acquirers owe.
    .merge(acquirer::lane_h_routes(Router::new()))
    // What stock cost, which layers a posting took, and whether the stock
    // ledger and the inventory account still agree. Merged rather than
    // spelled out here because several sessions edit this file at once and
    // one line collides less than four.
    .merge(stock_ledger::lane_i_routes(Router::new()))
    // What "late" means. Readable by anybody signed in — a tolerance
    // kept from the people measured against it is a trap, not a rule —
    // and writable only at head office.
    .route(
        "/api/v1/attendance-policy",
        get(attendance::read_policy).post(attendance::set_policy),
    )
    // Who works here, under what contract, and where they are posted.
    //
    // `{id}` accepts `me`, which the handler resolves from the session:
    // the employee app asks about its own holder on every screen, and a
    // round trip just to learn one's own id would be on every one of them.
    .route(
        "/api/v1/employees",
        get(employment::list).post(employment::register),
    )
    // Above `{id}` for reading only — the router ranks a static segment
    // over a dynamic one itself, so "contracts" here is never an id.
    .route(
        "/api/v1/employees/contracts/expiring",
        get(employment::expiring),
    )
    // How far the caller reaches, and where they are posted. Above `{id}`
    // for the same reason `contracts/expiring` is: the router ranks a
    // static segment over a dynamic one, so `me` here is never an id.
    //
    // Its own route rather than a field on `/auth/me`: a session says who
    // signed in and which rung they hold, and where somebody is posted is
    // HR data with a history behind it — a place copied into the session
    // is wrong from the transfer until the next sign-in.
    .route("/api/v1/employees/me/reach", get(employment::reach))
    .route("/api/v1/employees/{id}", get(employment::detail))
    .route(
        "/api/v1/employees/{id}/employment",
        post(employment::transition),
    )
    .route(
        "/api/v1/employees/{id}/code",
        post(employment::correct_code),
    )
    .route(
        "/api/v1/employees/{id}/assignments",
        post(employment::assign),
    )
    .route(
        "/api/v1/employees/{id}/account",
        post(employment::link_account),
    )
    .route(
        "/api/v1/employees/{id}/account/targets",
        get(employment::account_targets),
    )
    .route(
        "/api/v1/employees/{id}/account/provision",
        post(employment::provision_account),
    )
    .route(
        "/api/v1/employees/{id}/account/release",
        post(employment::release_account),
    )
    // Who somebody is at work: number, job, place, joining date. What the
    // employee app means when it says profile.
    .route(
        "/api/v1/employees/{id}/profile",
        get(employment::employment_profile),
    )
    // And personal data, on its own route because it is its own privilege.
    // A rota and a NIK are different questions with different audiences,
    // and one route answering both is how the second leaks through the
    // first.
    .route(
        "/api/v1/employees/{id}/personal-data",
        get(employment::read_personal_data).post(employment::enrol_personal_data),
    )
    .route(
        "/api/v1/employees/{id}/personal-data/amendments",
        post(employment::amend_personal_data),
    )
    .route(
        "/api/v1/employees/{id}/contracts",
        get(employment::read_contracts).post(employment::add_contract),
    )
    // Which days are red, for a year.
    //
    // Reading needs no key, for the reason the attendance policy's read
    // needs none: somebody planning leave has to know which days are
    // holidays before they can ask for any, and a rule kept from the people
    // it governs is a trap rather than a rule. Publishing and amending are
    // head office's, and they share one key — adding a cuti bersama in
    // March changes what people are owed exactly as much as publishing the
    // year in January did.
    .route(
        "/api/v1/holiday-calendars",
        get(holiday::years).post(holiday::publish),
    )
    .route(
        "/api/v1/holiday-calendars/{year}",
        get(holiday::read_calendar),
    )
    .route(
        "/api/v1/holiday-calendars/{year}/amendments",
        post(holiday::amend),
    )
    // A regional day is a holiday in some shops and a working day in
    // others, so this asks per place and there is no place-free form of it.
    .route(
        "/api/v1/holiday-calendars/{year}/on/{date}",
        get(holiday::on_day),
    )
    // The kinds of leave, and the rules a balance folds under. Both
    // readable by anybody signed in — somebody filing their own leave has
    // to know which kinds exist, and somebody whose days are counted under
    // a rule is entitled to read it — and both set at head office.
    .route(
        "/api/v1/leave-types",
        get(leave::list_types).post(leave::define_type),
    )
    .route(
        "/api/v1/leave-policy",
        get(leave::read_policy).post(leave::install_policy),
    )
    // Everything waiting on a decision, bounded by the caller's posting.
    // One queue rather than one screen per kind of thing: a manager has
    // five minutes and a list, not three tasks.
    .route("/api/v1/leave-requests/pending", get(leave::pending))
    // `{id}` accepts `me` on all four, like the rest of the employee
    // surface. There is deliberately no route that spends a balance: days
    // leave one only through an approval, which mints the deduction and
    // stores it in the same transaction.
    .route(
        "/api/v1/employees/{id}/leave-balances",
        get(leave::balances).post(leave::move_balance),
    )
    .route(
        "/api/v1/employees/{id}/leave-requests",
        get(leave::list_requests).post(leave::file),
    )
    .route(
        "/api/v1/employees/{id}/leave-requests/{request_id}/approve",
        post(leave::approve),
    )
    .route(
        "/api/v1/employees/{id}/leave-requests/{request_id}/reject",
        post(leave::reject),
    )
    .route(
        "/api/v1/employees/{id}/leave-requests/{request_id}/withdraw",
        post(leave::withdraw),
    )
    // Overtime: the employer orders, the worker answers, and the two are
    // recorded under keys that are deliberately disjoint. PP 35/2021
    // art. 26(2) wants two written acts from two people, and that holds
    // only if the transport keeps them apart — so the ordering route and
    // the consent route never accept each other's key.
    .route(
        "/api/v1/overtime-policy",
        get(overtime::read_policy).post(overtime::ratify_policy),
    )
    // What is waiting on an answer, bounded by the caller's posting. An
    // order nobody answers authorizes nothing, so an unanswered one is
    // overtime that will be worked unpaid or not worked at all.
    .route("/api/v1/overtime-orders/awaiting", get(overtime::awaiting))
    .route(
        "/api/v1/employees/{id}/overtime-orders",
        get(overtime::list_orders).post(overtime::issue),
    )
    // The worker's own key, and their own record. Not a rung: at the
    // cashier rung the ladder bounds nothing, and the bound that matters
    // is that this is their order.
    .route(
        "/api/v1/employees/{id}/overtime-orders/{order_id}/consent",
        post(overtime::consent),
    )
    .route(
        "/api/v1/employees/{id}/overtime-orders/{order_id}/withdrawal",
        post(overtime::withdraw),
    )
    // Shift patterns are head office's — a shop with its own idea of a
    // shift is a shop whose rota means nothing next to the shop beside it
    // — and reading them needs nothing but a session, because somebody
    // whose week is built out of them is entitled to know what they are.
    .route(
        "/api/v1/attendance-shifts",
        get(roster::list_shifts).post(roster::define_shift),
    )
    // Retire, never delete: a roster day already naming a shift would be
    // left pointing at nothing.
    .route(
        "/api/v1/attendance-shifts/{id}/retirement",
        post(roster::retire_shift),
    )
    // The grid a manager builds, and the week one person reads. Both
    // bounded by the caller's posting; `{id}` accepts `me`.
    .route("/api/v1/roster", get(roster::place_roster))
    .route(
        "/api/v1/employees/{id}/roster",
        get(roster::read_roster).post(roster::plan_day),
    )
    // Signing the month off. Closing is the place's; reopening is head
    // office's, because a place that could reopen its own close has not
    // closed anything.
    .route("/api/v1/attendance-periods", get(roster::read_periods))
    .route(
        "/api/v1/attendance-periods/{place}/{period}/closure",
        post(roster::close_period),
    )
    .route(
        "/api/v1/attendance-periods/{place}/{period}/reopening",
        post(roster::reopen_period),
    )
    // Pay and payroll: head office only, all of it. A place manager's
    // whole contribution is closing their attendance period.
    //
    // `/pay` is the effective-dated *agreement* — what somebody is on —
    // and `/payslips` is what they were actually paid in a month. Two
    // routes because they are two questions; the employee app asked the
    // second at the first one's path, and this is the resolution.
    .route(
        "/api/v1/employees/{id}/pay",
        get(pay::read_pay).post(pay::agree_pay),
    )
    .route(
        "/api/v1/employees/{id}/payroll-identity",
        get(pay::read_identity).post(pay::amend_identity),
    )
    .route("/api/v1/employees/{id}/payslips", get(pay::payslips))
    .route("/api/v1/notifications", get(notifications::list))
    .route(
        "/api/v1/notifications/read-all",
        post(notifications::mark_all_read),
    )
    .route(
        "/api/v1/notifications/{id}/read",
        post(notifications::mark_read),
    )
    .route(
        "/api/v1/discussions",
        get(discussion::list_threads).post(discussion::open_thread),
    )
    .route(
        "/api/v1/discussions/subjects",
        get(discussion::subject_counts),
    )
    .route("/api/v1/discussions/{id}", get(discussion::read_thread))
    .route(
        "/api/v1/discussions/{id}/posts",
        get(discussion::read_posts).post(discussion::reply),
    )
    .route(
        "/api/v1/discussions/{id}/solution",
        post(discussion::accept_solution),
    )
    .route(
        "/api/v1/discussions/{id}/status",
        post(discussion::set_status),
    )
    .route(
        "/api/v1/discussions/{id}/bookmark",
        post(discussion::set_bookmark),
    )
    .route(
        "/api/v1/discussions/{id}/attachments/{file_id}",
        get(discussion::attachment),
    )
    // Its own body limit, replacing the router-wide one for this route
    // alone: everything else here is JSON measured in kilobytes, and an
    // attachment is the one place a person hands over megabytes on
    // purpose. The ceiling itself is enforced in `postgres::files`, which
    // can explain it in a sentence rather than answering a bare 413.
    .route(
        "/api/v1/files",
        get(files::list)
            .post(files::upload)
            .layer(DefaultBodyLimit::max(
                infrastructure::MAX_ATTACHMENT_BYTES + 64 * 1024,
            )),
    )
    .route("/api/v1/audit", get(audit::list))
    // Store money: the drawer, the deposit, the remittance order, the
    // manager's float, the receipt. One line rather than thirty, because
    // several lanes are editing this file at once and a shared route table
    // is a merge somebody resolves by hand at the wrong hour.
    .merge(store_money::lane_b_routes(Router::new()))
    .route(
        "/api/v1/inventory/allotments/by-article",
        get(allotments_by_article),
    )
    // The one campaign metric that is not in the sale facts alone. Its own
    // route rather than a field on the aggregate above: it needs the
    // projection as well as the tills, it is asked for ONE campaign, and it
    // would make the fleet-wide read carry an inventory join every screen
    // that does not want it would still pay for.
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/sell-through",
        get(performance::campaign_sell_through),
    )
    // Why the campaign exists, which is the half a price book does not
    // carry. Its own route under the campaign rather than a field on the
    // publication: changing a target must never reprice a shop. See
    // migration 0161.
    .route("/api/v1/commercial/campaign-intents", get(campaign_intents))
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/intent",
        get(campaign_intent)
            .put(save_campaign_intent)
            .delete(delete_campaign_intent),
    )
    // The rest of what a campaign is, and none of it pricing: what it runs,
    // where it was DECLARED to run, the lines it must not cross, and the
    // score against the campaign it was meant to beat. Migrations 0173 and
    // 0174. Nothing under here reaches a till.
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/plan",
        get(campaigns::campaign_plan).put(campaigns::save_campaign_plan),
    )
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/activities/{activity_id}",
        put(campaigns::save_campaign_activity).delete(campaigns::delete_campaign_activity),
    )
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/outcome",
        get(campaigns::campaign_outcome),
    )
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/target",
        put(campaigns::save_campaign_target),
    )
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/guardrail-check",
        post(campaigns::check_campaign_guardrails),
    )
    .route(
        "/api/v1/commercial/campaigns/{campaign_id}/breaches/{breach_id}",
        post(campaigns::acknowledge_campaign_breach),
    )
    // Hold, then commit — the pair a till uses, because a redemption is
    // final and a checkout is not. `redeem` below stays: it is the direct
    // path for a back-office correction, where there is no basket to hold
    // against. See migration 0162.
    // Loyalty. Under `/customers` and not `/commercial`, because a balance
    // belongs to the shopper rather than to the price book — the locked
    // domain split. The one place points leave an account is the
    // redemption, which issues a voucher and debits in one transaction.
    .route(
        "/api/v1/customers/{customer_id}/points",
        get(points_account),
    )
    .route(
        "/api/v1/customers/{customer_id}/points/redeem",
        post(redeem_points_to_voucher),
    )
    .route(
        "/api/v1/commercial/vouchers/{code}/authorize",
        post(vouchers::authorize_voucher),
    )
    .route(
        "/api/v1/commercial/vouchers/{code}/commit",
        post(vouchers::commit_voucher_hold),
    )
    .route(
        "/api/v1/commercial/vouchers/{code}/release",
        post(vouchers::release_voucher_hold),
    )
    // Letters — the paperwork somebody signs. A goods receipt note for a
    // supplier's delivery and a delivery note for goods going to a shop,
    // both drawn from records this database already holds and then frozen
    // into a numbered document. See `postgres::letters`.
    //
    // Reading is a CASHIER read because a letter carries quantities and
    // names and never a price — the reason `letters.rs` gives, and the
    // reason it may not grow a money column without this rung being
    // reconsidered.
    .route(
        "/api/v1/letters",
        get(letters::list_letters).post(letters::draft_letter),
    )
    .route("/api/v1/letters/sources", get(letters::letter_sources))
    // Patterns. Listed before `/{letter_id}` so the literal segment wins,
    // and a pattern is retired rather than deleted — the letters written
    // from it are part of how they came to say what they say.
    .route(
        "/api/v1/letters/templates",
        get(letters::letter_templates).post(letters::save_template),
    )
    .route(
        "/api/v1/letters/templates/{template_id}",
        axum::routing::delete(letters::retire_template),
    )
    .route(
        "/api/v1/letters/{letter_id}",
        get(letters::letter_detail)
            .patch(letters::save_letter)
            .delete(letters::discard_letter),
    )
    .route(
        "/api/v1/letters/{letter_id}/issue",
        post(letters::issue_letter),
    )
    .route(
        "/api/v1/letters/{letter_id}/void",
        post(letters::void_letter),
    )
    // Coupons. Migration 0170 turned a counter into a set, its codes and a
    // redemption per sale; these are the routes for authoring one and for
    // the hold a till takes while a basket is still being paid for. The
    // hold/commit/release trio is the voucher trio's shape on purpose —
    // see `postgres/coupons.rs`.
    // Money a shop took where no sale was written — the queue head office
    // works. Not under `commercial/`: this is not pricing, it is a branch
    // holding somebody's money, and the only node that can see it is this
    // one (the shop's own day report balances).
    // What one shop has charged for one product, and what changed it. The
    // Pricelist answers "why this price"; this answers "why did it move".
    .route("/api/v1/commercial/price-history", get(price_history))
    // What the business is doing to prices now or next — one row per
    // change, as wide as it reaches. The sibling of price-history and a
    // different question: that one is one product's past, this is the
    // estate's present.
    .route("/api/v1/commercial/price-changes", get(price_changes))
    // The price book's log. Sibling to `price-history`, which traces ONE
    // product at ONE shop: this is the other axis — everything that has
    // happened to the books themselves, with publication, delivery,
    // activation, failure and expiry kept as separate kinds so a
    // publication is never read as evidence that a till is charging it.
    .route("/api/v1/commercial/price-events", get(price_events))
    .route("/api/v1/checkout-exceptions", get(list_checkout_exceptions))
    .route(
        "/api/v1/checkout-exceptions/{checkout_id}/resolve",
        post(resolve_checkout_exception),
    )
    .route(
        "/api/v1/commercial/coupon-sets",
        get(coupons::list_coupon_sets).post(coupons::create_coupon_set),
    )
    .route(
        "/api/v1/commercial/coupon-sets/{set_code}",
        get(coupons::coupon_set_detail),
    )
    .route(
        "/api/v1/commercial/coupon-sets/{set_code}/mint",
        post(coupons::mint_coupon_codes),
    )
    .route(
        "/api/v1/commercial/coupons/expire-lapsed",
        post(coupons::expire_lapsed_coupons),
    )
    .route(
        "/api/v1/commercial/coupons/{code}",
        get(coupons::coupon_code_detail),
    )
    .route(
        "/api/v1/commercial/coupons/{code}/authorize",
        post(coupons::authorize_coupon),
    )
    .route(
        "/api/v1/commercial/coupons/{code}/commit",
        post(coupons::commit_coupon_hold),
    )
    .route(
        "/api/v1/commercial/coupons/{code}/release",
        post(coupons::release_coupon_hold),
    )
    .route(
        "/api/v1/commercial/coupons/{code}/cancel",
        post(coupons::cancel_coupon_code),
    )
    // Where a supplier's money is supposed to land. Nested under the
    // supplier because that is the only place anybody asks the question,
    // and because it puts the supplier's id in the path — which is what
    // files these writes against the supplier in the activity log.
    .route(
        "/api/v1/suppliers/{id}/bank-accounts",
        get(supplier_banks::list_supplier_bank_accounts)
            .post(supplier_banks::create_supplier_bank_account),
    )
    // Where the words go on a bank's own giro leaf. Under finance because
    // that is who calibrates it and who prints from it; the coordinates
    // themselves are per bank, not per site — HO writes the giro.
    .route(
        "/api/v1/finance/giro-print-templates",
        get(giro_print::list_giro_print_templates).post(giro_print::create_giro_print_template),
    )
    .route(
        "/api/v1/finance/giro-print-templates/{id}",
        get(giro_print::giro_print_template).patch(giro_print::update_giro_print_template),
    )
    .route(
        "/api/v1/suppliers/{id}/bank-accounts/{account_id}",
        patch(supplier_banks::update_supplier_bank_account),
    )
    // What the company has agreed it can agree. Read by the order
    // composer, which carried these four arrangements in a `const` until
    // 0201 gave them a table.
    .route("/api/v1/payment-terms", get(suppliers::payment_terms_book))
    // What an edit to this article would do to the promotions around it.
    // A POST that writes nothing: the question carries a proposed division
    // and a set of tags, and it is asked before the save rather than after,
    // when the answer would be something to undo.
    .route(
        "/api/v1/articles/{article_code}/consequences",
        post(articles::article_consequences),
    )
    // What speaks for one colour. Read before a screen offers to delete
    // it, and the same sweep the delete itself runs.
    .route("/api/v1/colours/{code}/usage", get(colours::colour_usage))
    // Every table and rule document that names one term. A delete is only
    // ever allowed for a term nothing has ever named — 0167 — and this is
    // how a screen knows before it offers one.
    .route(
        "/api/v1/vocabulary/{kind}/{code}/usage",
        get(vocabulary::term_usage),
    )
    // Loyalty, filed under the members it belongs to rather than under
    // Commercial. A point is a LIABILITY the business owes a shopper;
    // everything in Commercial is what something costs. Putting the two
    // together is how an obligation comes to be read as a discount — the
    // same mistake the system this replaces made with gift cards.
    //
    // Two routes and not one, because a balance and the entries behind it
    // are two questions: `points` is what the estate owes, `points-ledger`
    // is what moved. A single endpoint would have to choose which of them
    // it is authoritative for, and the answer — the ledger, always — is
    // exactly what a balance-shaped answer hides.
    .route("/api/v1/members/points", get(points_accounts))
    .route("/api/v1/members/points-ledger", get(points_ledger))
    .route("/api/v1/sync/health", get(sync_health::sync_health))
    // The same month, rehearsed. Writes nothing, and unlike the run it
    // answers even when a category has no accounts mapped: naming those
    // assets is most of why anybody looks first.
    .route(
        "/api/v1/finance/depreciation/preview",
        post(finance::preview_depreciation),
    )
    // The mail gateway: where a statement comes from, and what arrived.
    .route(
        "/api/v1/finance/statement-sources",
        get(statement_intake::statement_sources).post(statement_intake::create_statement_source),
    )
    .route(
        "/api/v1/finance/statement-sources/{id}",
        put(statement_intake::update_statement_source)
            .delete(statement_intake::delete_statement_source),
    )
    .route(
        "/api/v1/finance/statement-intake",
        get(statement_intake::statement_intake_log),
    )
    .route(
        "/api/v1/finance/statement-intake/run",
        post(statement_intake::run_statement_intake),
    )
    // Who the other side was. Not the bank's words — those are evidence and
    // stay read-only; this is our reading of them, in its own columns.
    .route(
        "/api/v1/finance/bank-lines/{id}",
        patch(finance::update_bank_line),
    )
    // Cash's answer to reconciliation: no statement arrives, so a person
    // counts, and the difference is a separate decision to post.
    // Gathered from the accounts that name them, never maintained.
    .route("/api/v1/finance/banks", get(finance::bank_institutions))
    // What is still missing before bank postings work. Empty means complete.
    .route(
        "/api/v1/finance/banking-readiness",
        get(finance::banking_readiness),
    )
    // What our accounts ARE, beside the map that says where they post.
    .route(
        "/api/v1/finance/bank-accounts",
        get(finance::company_bank_accounts).post(finance::describe_bank_account),
    )
    .route(
        "/api/v1/finance/bank-accounts/{id}/retire",
        post(finance::retire_bank_account),
    )
    .route(
        "/api/v1/finance/cash-counts",
        get(finance::cash_counts).post(finance::record_cash_count),
    )
    .route(
        "/api/v1/finance/cash-counts/{id}/post",
        post(finance::post_cash_count),
    )
    // A day's takings. The list is built from the SALES, so it can say
    // which days are NOT in the book — which is the question, and which a
    // list of postings cannot answer. Read only: the day is POSTED through
    // `/sales-postings`, which 0273 made the one authority for it.
    .route("/api/v1/finance/sale-days", get(finance::sale_days))
    // A shop asking head office to pay something. Six routes and not one
    // of them posts: the document is a lifecycle with no accounting
    // consequence until head office acts, and the bill and the payment it
    // becomes already carry the rules. See
    // `postgres::payment_instructions`.
    .route(
        "/api/v1/finance/payment-instructions",
        get(finance::payment_instructions).post(finance::raise_payment_instruction),
    )
    .route(
        "/api/v1/finance/payment-instructions/{id}",
        get(finance::payment_instruction),
    )
    .route(
        "/api/v1/finance/payment-instructions/{id}/submit",
        post(finance::submit_payment_instruction),
    )
    .route(
        "/api/v1/finance/payment-instructions/{id}/decide",
        post(finance::decide_payment_instruction),
    )
    .route(
        "/api/v1/finance/payment-instructions/{id}/withdraw",
        post(finance::withdraw_payment_instruction),
    )
    .route(
        "/api/v1/finance/payment-instructions/{id}/settle",
        post(finance::settle_payment_instruction),
    )
    // Takings between a drawer and a bank. Two postings on two dates —
    // `/bank` when the bag leaves, `/land` when the statement agrees — so
    // the money in between is a ledger position rather than a subtraction
    // a screen performs.
    .route(
        "/api/v1/finance/deposits",
        get(finance::deposits).post(finance::record_deposit),
    )
    .route("/api/v1/finance/deposits/{id}", get(finance::deposit))
    .route(
        "/api/v1/finance/deposits/{id}/bank",
        post(finance::bank_deposit),
    )
    .route(
        "/api/v1/finance/deposits/{id}/land",
        post(finance::land_deposit),
    )
    .route("/api/v1/finance/attention", get(finance::attention))
    // ── fingerprint attendance ──────────────────────────────────────
    //
    // The punch source, answered 2026-09-13: a fingerprint station per
    // unit, ZKTeco readers, templates held centrally, punches taken at the
    // edge and synced up. `frontend-hub/PEOPLE-BRIEF.md` recorded the
    // question; `docs/hr-port-provenance.md` records what was adapted.
    //
    // The stations. Registering one *creates* attendance authority — a row
    // in ACTIVE is the only thing that can produce a punch — so it is head
    // office's and audited, while reading them needs only a session,
    // because somebody whose only way through the door is a reader is
    // entitled to know whether anybody has suspended it.
    .route(
        "/api/v1/attendance-terminals",
        get(terminal::list_terminals).post(terminal::register_terminal),
    )
    .route(
        "/api/v1/attendance-terminals/{id}/status",
        post(terminal::set_terminal_status),
    )
    // Enrolment is HR's even though the capture happens at the store: the
    // finger is on the reader in the shop and binding a biometric to an
    // employment record is head office's. Reading which fingers somebody
    // has enrolled is roster-grade — a manager needs it to know why a
    // person keeps appearing absent — and carries no template, because the
    // bytes live in a type with no `Serialize`.
    .route(
        "/api/v1/employees/{id}/fingerprints",
        get(terminal::read_enrolment).post(terminal::enrol_finger),
    )
    // Withdrawal deletes the template and keeps the evidence. A
    // retired-but-present biometric is regulated data still held without a
    // purpose.
    .route(
        "/api/v1/employees/{id}/fingerprints/{finger}/withdrawal",
        post(terminal::withdraw_finger),
    )
    // Push the plan down to a unit's station. The roster key, because what
    // travels is the roster — the manager who built next week's is the one
    // who wants it on the reader.
    .route(
        "/api/v1/attendance/employee-book",
        post(terminal::publish_book),
    )
    // The two routes a unit's node reaches, authenticated by its own
    // `x-sync-key` rather than by a session — see `http::auth::is_public`
    // for why that is the enforcement of the privacy decision and not a
    // shortcut. Nothing a browser holds opens either.
    .route(
        "/api/v1/attendance/terminal-sync",
        post(terminal::sync_templates),
    )
    .route("/api/v1/attendance/punches", post(terminal::ingest_punches))
    // The second punch source, and the door it does NOT come through is
    // the one above. That route is a node's, behind `x-sync-key`, and
    // widening it to sessions would undo the privacy decision it enforces
    // — so the employee app gets its own route, session-authenticated,
    // bounded to the caller's own record by `Access::own` and carrying its
    // own action key at the cashier rung.
    //
    // It exists because no reader has been bought: on 2026-09-13 nobody
    // could clock in anywhere, so the roster, the derivation, the
    // corrections and the close had nothing to be exercised against. Every
    // row it writes says `source = 'EMPLOYEE_APP'` (migration `0239`) and
    // names no terminal, so when the readers arrive nobody has to guess
    // which readings came from a finger — and retiring this source means
    // refusing one key, with no history to unpick.
    //
    // There is deliberately no on-behalf-of form. A manager who knows
    // somebody was at work files an attendance *correction*, which another
    // person decides.
    .route(
        "/api/v1/employees/{id}/punches",
        post(punch::record_own_punch),
    )
    // What a day amounted to. Derived on every request from the plan, the
    // punches, the policy version, the approvals and the effective
    // correction — there is no stored outcome and no column one could go
    // in.
    .route("/api/v1/attendance/today", get(punch::read_today))
    .route(
        "/api/v1/employees/{id}/attendance",
        get(punch::read_attendance),
    )
    // The two punch-derived counts the period close used to report as
    // `null` because there was no punch source. They are numbers now
    // wherever a unit has a station, and still `null` where one has none —
    // "the checks passed" and "there was nothing to check" are different
    // facts and only one of them is a zero.
    .route(
        "/api/v1/attendance/punch-readiness",
        get(punch::read_punch_readiness),
    )
    // Corrections: an append-only overlay that never edits a punch. The
    // only route by which a real day of work the reader failed to see
    // becomes a real day of work again — which matters because fingerprint
    // is the only way in. Filing and deciding are disjoint keys, and the
    // requester and the decider must be different actors.
    .route(
        "/api/v1/attendance-corrections",
        get(punch::list_corrections),
    )
    .route(
        "/api/v1/employees/{id}/attendance-corrections",
        post(punch::file_correction),
    )
    .route(
        "/api/v1/attendance-corrections/{id}/decision",
        post(punch::decide_correction),
    )
    .route(
        "/api/v1/attendance-corrections/{id}/withdrawal",
        post(punch::withdraw_correction),
    )
    // The run, and the two signatures on it. Submit is the place's and
    // approve is head office's — separate keys at separate rungs, so the
    // domain can compare actors: a control one person can complete alone
    // is a record of a signature, not a control.
    //
    // There is no `/verify` and no `/seal`. The first act moved to the
    // place as `/submission`, and approval is final — a state whose only
    // content is "and we mean it" cannot be told from the one before it.
    .route(
        "/api/v1/payroll/runs",
        get(pay::list_runs).post(pay::open_run),
    )
    .route(
        "/api/v1/payroll/runs/{id}/submission",
        post(pay::submit_run),
    )
    .route("/api/v1/payroll/runs/{id}/approve", post(pay::approve_run))
    .route("/api/v1/payroll/runs/{id}/reopen", post(pay::reopen_run))
    .route("/api/v1/payroll/runs/{id}/slips", get(pay::run_slips))
    .route(
        "/api/v1/payroll/runs/{id}/reconciliation",
        get(pay::run_reconciliation),
    )
    // The crossing to Finance: one gross liability plus its breakdown,
    // idempotent per (place, period) so sending twice cannot double what
    // the company owes. GET is the status coming back — received, or paid
    // — which is why the handoff is a route and not a fire-and-forget.
    //
    // Settling it is Finance's own statement under its own key, because a
    // grant that could hand a liability over and then declare it paid
    // would be one person closing the loop on their own request.
    .route(
        "/api/v1/payroll/runs/{id}/finance-handover",
        get(pay::read_handover).post(pay::hand_over_run),
    )
    .route(
        "/api/v1/payroll/runs/{id}/finance-handover/settlement",
        post(pay::settle_handover),
    )
    // The component engine. `0250` and `0251`, and the four gaps they
    // close: deductions exist at all, overtime becomes money, a place can
    // file a one-off, and a slip has a net.
    //
    // Reading the catalogue and the rates needs NO key, deliberately —
    // the position the attendance policy and the holiday calendar already
    // take, and it has more force here: a rate that decides what comes out
    // of somebody's wage is exactly the rule they are entitled to read.
    // Nothing on these two routes is about a named person.
    //
    // Defining a component and stating what it is worth are two head
    // office keys, not one. Inventing a line item decides what a payslip
    // may say; its percentage decides what comes out of every wage, and a
    // deployment that wants the second in fewer hands cannot say so with
    // one key. The same split `overtime_policy` makes.
    .route(
        "/api/v1/payroll/components",
        get(components::catalogue).post(components::define),
    )
    .route(
        "/api/v1/payroll/components/{code}/retirement",
        post(components::retire),
    )
    // Retire, never delete: a slip line naming a deleted component would
    // point at nothing, and the slips it produced are still the record of
    // what somebody was paid.
    .route(
        "/api/v1/payroll/components/{code}/rates",
        get(components::rates).post(components::ratify),
    )
    // The one-offs: an incentive, a *kasbon* instalment, a bonus. **The
    // place's**, bounded by its own posting, and the other half of the
    // owner's decision of 2026-09-13 — a place that submits a batch and
    // cannot add a figure to it can only resend numbers head office
    // already fixed.
    //
    // There is no decide route. A one-off rides the batch carrying it:
    // writable while that month's run is absent or DRAFT, frozen by the
    // place's submission, and decided by head office's approval of the
    // run. A second approval chain would ask head office to approve one
    // figure twice.
    .route(
        "/api/v1/payroll/adjustments",
        get(components::adjustments).post(components::file),
    )
    // `POST .../withdrawal` rather than a DELETE, matching
    // `/attendance-corrections/{id}/withdrawal`: taking a figure back
    // needs a reason, and a DELETE has nowhere to put one.
    .route(
        "/api/v1/payroll/adjustments/{id}/withdrawal",
        post(components::withdraw),
    )
    // The generic record surface. One shape for every kind, which is what
    // lets a sheet offer comments, tags and a true history without each
    // screen wiring its own. `required_role` answers for these by
    // delegating to the read that already serves the record named in the
    // path — see `cloud::http::records`.
    .route("/api/v1/records/{kind}/{id}/info", get(records::info))
    .route(
        "/api/v1/records/{kind}/{id}/comments",
        post(records::comment),
    )
    .route(
        "/api/v1/records/{kind}/{id}/tags/{code}",
        put(records::tag).delete(records::untag),
    )
    // Not under `/records/…`: a comment is edited by its own id, and the
    // person editing it has the id and not the record's. Author-only, in
    // the statement rather than in a check beside it.
    .route(
        "/api/v1/comments/{id}",
        patch(records::edit).delete(records::remove),
    )
    // *Karyawan baru*: a shop asks for an employee it does not have, and
    // head office answers. Two ways in, one employee record out — the
    // owner's decision of 2026-09-13, and a form rather than the hiring
    // menu he rejected on 2026-09-04. `POST /api/v1/employees` above is
    // the other way in and is untouched.
    //
    // Filing is a place manager's act, bounded by their own posting;
    // deciding is head office's, and the one rule a rung cannot express —
    // the proposer may not decide their own proposal — is enforced on the
    // actor in `domain::hire`.
    .route(
        "/api/v1/hire-proposals",
        get(hire::list).post(hire::propose),
    )
    .route("/api/v1/hire-proposals/{id}", get(hire::detail))
    // A revision is a NEW version, and the returned one stays readable —
    // which is why this is not a PATCH of the proposal.
    .route("/api/v1/hire-proposals/{id}/revision", post(hire::revise))
    // Approve, return for revision, or reject: one decision with three
    // answers, each needing a reason. Three routes would be three places
    // to forget to ask for one.
    .route("/api/v1/hire-proposals/{id}/decision", post(hire::decide))
    // What an approval buys. It opens a CANDIDATE and posts them to the
    // unit that asked; the HIRE event that makes somebody an active
    // employee is still `POST /employees/{id}/employment`, because
    // "Approved" is not "working here".
    .route(
        "/api/v1/hire-proposals/{id}/employment",
        post(hire::open_employment),
    )
    .route("/metrics", get(metrics));
    // lane-C: cash documents, bank rules and giros, gathered in their own
    // module. One call rather than twenty routes spliced into the chain above,
    // because they are one subject and because four lanes editing one
    // four-hundred-line builder is four conflicts in the same hunk.
    let router = money::lane_c_routes(router);
    // lane-N: the words a person explains money in, and the three doors out of
    // a bank statement line. Gathered for the same reason.
    let router = categories::lane_n_routes(router);
    // lane-M: destinations, batches, the payment context and the allocation
    // surface, added in one call rather than as twenty more lines here.
    let router = payments_lane::lane_m_routes(router);
    // lane-L: the cutover. Four routes, added the same way, and gathered
    // because they are one act — the beginning of every balance in the books.
    let router = opening::lane_l_routes(router);
    router
        .fallback_service(ServeDir::new(frontend).append_index_html_on_directories(true))
        // Layer order (execution is outermost-last-added): trace -> CORS ->
        // body limit -> auth -> handler, so even a 401 carries CORS headers
        // and no unauthenticated body larger than the limit is ever buffered.
        // Inside auth, so the actor is already resolved and truthful: an
        // audit row that trusted an `actor_id` from the request body would be
        // a log of what people claimed rather than of what they did.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            audit::audit_actions,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ))
        // Outside `require_auth`, so it runs first and the member routes never
        // reach the operator check at all. A shopper has no node account, and
        // a surface that answered 401 until they found an operator's password
        // would be the hole this exists to close.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            member::require_member,
        ))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(cors_layer(&state.config))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    sqlx::query("SELECT 1").execute(&state.db).await?;
    let snapshot = infrastructure::sync_snapshot(&state.db).await?;
    let now = Utc::now();
    Ok(Json(json!({
        "status": "ok",
        "node_id": state.config.node_id,
        "node_role": state.config.node_role,
        "ledger_authority": "movement",
        "capabilities": [
            "inventory.pools.native",
            "inventory.pools.fleet",
            "inventory.transfers.reconciliation",
            "inventory.pool.detail",
            "inventory.movements",
            "inventory.counts",
            "inventory.missing",
            "inventory.observations",
            "inventory.allotments",
            "inventory.sales",
            "inventory.commercial",
            "inventory.control"
        ],
        "inventory_endpoints": {
            "owned": "/api/v1/inventory/pools",
            "fleet": "/api/v1/inventory/fleet-pools",
            "reconciliations": "/api/v1/inventory/reconciliations"
        },
        "auth": if state.config.jwt_secret.is_some() { "enabled" } else { "DISABLED" },
        "sync": {
            "state": infrastructure::sync_health_state(&snapshot, state.config.sync_degraded_after_seconds, now),
            "backlog_count": snapshot.backlog_count,
            "backlog_oldest_seconds": snapshot.backlog_oldest_seconds,
            "dead_letter_count": snapshot.dead_letter_count,
            "breaker_open": infrastructure::breaker_is_open(&snapshot.sender, now),
        }
    })))
}
/// The operational pools: searched, filtered, sorted and paged by the server.
///
/// It answers with an envelope — `rows`, a `next_cursor`, a `total` and facet
/// counts — in the shape `GET /finance/money` established and `GET /employees`
/// follows, so one hook in the browser draws all of them.
async fn pools(
    State(s): State<AppState>,
    Query(q): Query<PoolQuery>,
) -> Result<Json<infrastructure::PoolPage>, AppError> {
    Ok(Json(
        infrastructure::pools_page(
            &s.db,
            infrastructure::PoolScope {
                at: q.as_of,
                needle: q.q,
                site_id: q.site_id,
                group: q.group,
                pool_id: q.pool_id,
                counted: q.counted,
                sort: q.sort,
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor,
                // Clamped where it is enforced, not here: one spelling of how
                // much of the fleet one request may see.
                limit: q.limit,
                count: audit::wants_counting(q.count.as_deref()),
            },
            s.config.observed_window_hours,
            s.config.lost_risk_window_days,
        )
        .await?,
    ))
}
async fn fleet_pools(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list_fleet_pools(
            &s.db,
            &s.config.node_id,
            s.config.observed_window_hours,
            s.config.lost_risk_window_days,
        )
        .await?,
    ))
}
async fn transfer_reconciliations(
    State(s): State<AppState>,
    Query(q): Query<ReconciliationQuery>,
) -> Result<Json<infrastructure::ReconciliationPage>, AppError> {
    Ok(Json(
        infrastructure::reconciliations_page(
            &s.db,
            infrastructure::ReconciliationScope {
                needle: q.q,
                status: q.status,
                destination_store_id: q.destination_store_id,
                source_dc_id: q.source_dc_id,
                sort: q.sort,
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor,
                limit: q.limit,
            },
        )
        .await?,
    ))
}
async fn pool_detail(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::get_pool(
            &s.db,
            &id,
            s.config.observed_window_hours,
            s.config.lost_risk_window_days,
        )
        .await?,
    ))
}
async fn allotments(
    State(s): State<AppState>,
    Query(q): Query<AllotmentQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::list_allotments(&s.db, q).await?))
}
async fn create_allotment(
    State(s): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(r): Json<CreateAllotmentRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = infrastructure::create_allotment(&s.db, r).await?;
    if let Some(allotment_id) = id_in(&body, "id") {
        acted_on.set(RecordKind::Allotment, allotment_id);
    }
    Ok((StatusCode::CREATED, Json(body)))
}
async fn allotments_by_store(
    State(s): State<AppState>,
    Path(store_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list_allotments_by_store(&s.db, &store_id).await?,
    ))
}
async fn allotments_by_article(
    State(s): State<AppState>,
    Query(q): Query<AllotmentQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list_allotments_by_article(&s.db, q).await?,
    ))
}
async fn allotment_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::get_allotment(&s.db, id).await?))
}
async fn cancel_allotment(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CancelAllotmentRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let response = infrastructure::cancel_allotment(&s.db, id, r).await?;
    let status = if response["edge_cancellation_status"] == "PENDING" {
        StatusCode::ACCEPTED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(response)))
}
async fn execute_allotment(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<ExecuteAllotmentRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::execute_allotment(&s.db, id, r).await?))
}
async fn availability(
    State(s): State<AppState>,
    Query(q): Query<AvailabilityQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::get_availability(&s.db, q).await?))
}
async fn movements(
    State(s): State<AppState>,
    Query(q): Query<MovementQuery>,
) -> Result<Json<infrastructure::MovementPage>, AppError> {
    Ok(Json(
        infrastructure::movements_page(
            &s.db,
            infrastructure::MovementScope {
                subject_id: q.subject_id,
                pool_id: q.pool_id,
                needle: q.q,
                cause: q.cause,
                actor_id: q.actor_id,
                sort: q.sort,
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor,
                limit: q.limit,
                count: audit::wants_counting(q.count.as_deref()),
            },
        )
        .await?,
    ))
}
async fn move_stock(
    State(s): State<AppState>,
    Json(r): Json<CreateMovementRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    // Workflow-owned causes must go through their workflow endpoint: a manual
    // movement claiming SALE would "sell" stock with no sale, payment, or
    // receipt behind it. Only genuinely manual logistics moves pass here.
    if let Some(cause) = r.cause.as_deref() {
        let manual_causes = ["NORMAL_MOVE", "RETURN_TO_DC"];
        if !manual_causes.contains(&cause) {
            return Err(AppError::Validation(format!(
                "cause {cause} is workflow-owned; manual movements accept only {}",
                manual_causes.join(", ")
            )));
        }
    }
    // Clamp client-supplied timestamps: modest backdating for offline catch-up
    // is fine, silent history rewriting or future-dating is not.
    if let Some(occurred_at) = r.occurred_at {
        let now = Utc::now();
        if occurred_at > now + Duration::minutes(5) || occurred_at < now - Duration::days(7) {
            return Err(AppError::Validation(
                "occurred_at must lie within the last 7 days and not in the future".into(),
            ));
        }
    }
    Ok((
        StatusCode::CREATED,
        Json(infrastructure::create_manual_movement(&s.db, r).await?),
    ))
}
async fn correct(
    State(s): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(r): Json<CorrectPlacementRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    // A correction touches two pools and the log holds one. It is filed under
    // the pool the stock LEFT, because that is the pool whose figure was
    // wrong, and the sheet somebody was standing on when they corrected it.
    let corrected = r.line.from.clone();
    let body = infrastructure::correct_placement(&s.db, r).await?;
    acted_on.set(RecordKind::Pool, corrected);
    Ok((StatusCode::CREATED, Json(body)))
}
async fn observe(
    State(s): State<AppState>,
    Json(r): Json<ObservationBatchRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if s.config.jwt_secret.is_some() {
        return Err(AppError::Forbidden(
            "production RFID readers must submit device-signed batches to their DC/Store Edge; Cloud receives them through authenticated sync"
                .into(),
        ));
    }
    const MAX_OBSERVATIONS_PER_BATCH: usize = 10_000;
    if r.observations.len() > MAX_OBSERVATIONS_PER_BATCH {
        return Err(AppError::Validation(format!(
            "observation batch exceeds {MAX_OBSERVATIONS_PER_BATCH} reads; split the upload"
        )));
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(
            infrastructure::ingest_observations(&s.db, r, s.config.rfid_burst_window_seconds)
                .await?,
        ),
    ))
}
async fn observations(
    State(s): State<AppState>,
    Query(q): Query<ObservationQuery>,
) -> Result<Json<infrastructure::SightingPage>, AppError> {
    Ok(Json(
        infrastructure::sightings_page(
            &s.db,
            infrastructure::SightingScope {
                pool_id: q.pool_id,
                epc: q.epc,
                needle: q.q,
                device_id: q.device_id,
                method: q.method,
                site_id: q.site_id,
                sort: q.sort,
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor,
                limit: q.limit,
            },
        )
        .await?,
    ))
}
async fn anomalies(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::observation_anomalies(&s.db).await?))
}
async fn counts(
    State(s): State<AppState>,
    Query(q): Query<CountListQuery>,
) -> Result<Json<infrastructure::CountPage>, AppError> {
    Ok(Json(
        infrastructure::counts_page(
            &s.db,
            infrastructure::CountScope {
                needle: q.q,
                status: q.status,
                site_id: q.site_id,
                pool_id: q.pool_id,
                kind: q.kind,
                sort: q.sort,
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor,
                limit: q.limit,
            },
        )
        .await?,
    ))
}
async fn count_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::get_count(&s.db, id).await?))
}
async fn create_count(
    State(s): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(r): Json<CreateCountRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = infrastructure::create_count(&s.db, r).await?;
    if let Some(count_id) = id_in(&body, "id") {
        acted_on.set(RecordKind::Count, count_id);
    }
    Ok((StatusCode::CREATED, Json(body)))
}
async fn activate_count(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CommandRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::activate_count(&s.db, id, r).await?))
}
async fn count_entries(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CountEntriesRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::add_count_entries(&s.db, id, r).await?))
}
async fn submit_count(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CommandRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::submit_count(&s.db, id, r).await?))
}
async fn approve_count(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CommandRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::approve_count(&s.db, id, r).await?))
}
async fn missing(
    State(s): State<AppState>,
    Query(q): Query<MissingQuery>,
) -> Result<Json<infrastructure::MissingPage>, AppError> {
    Ok(Json(
        infrastructure::missing_page(
            &s.db,
            infrastructure::MissingScope {
                needle: q.q,
                pool_id: q.pool_id,
                site_id: q.site_id,
                counted: q.counted,
                sort: q.sort,
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor,
                limit: q.limit,
            },
        )
        .await?,
    ))
}
async fn found(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(r): Json<MissingResolutionRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::resolve_missing_found(&s.db, &id, r).await?,
    ))
}
async fn lost(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(r): Json<MissingResolutionRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::resolve_missing_lost(&s.db, &id, r).await?,
    ))
}
async fn dispose(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(r): Json<MissingResolutionRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::resolve_missing_dispose(&s.db, &id, r).await?,
    ))
}
async fn as_of(
    State(s): State<AppState>,
    Query(q): Query<AsOfQuery>,
) -> Result<Json<infrastructure::PoolPage>, AppError> {
    Ok(Json(
        infrastructure::inventory_as_of(
            &s.db,
            q,
            s.config.observed_window_hours,
            s.config.lost_risk_window_days,
        )
        .await?,
    ))
}
async fn replay(
    State(s): State<AppState>,
    Json(r): Json<ReplayRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::run_replay(&s.db, r).await?))
}
async fn repost(
    State(s): State<AppState>,
    Json(r): Json<RepostRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::run_repost(&s.db, r).await?))
}
async fn control(
    State(s): State<AppState>,
    Query(q): Query<ControlQuery>,
) -> Result<Json<infrastructure::ControlStatus>, AppError> {
    Ok(Json(
        infrastructure::control_status(
            &s.db,
            infrastructure::ControlScope {
                site_id: q.site_id,
                pool_id: q.pool_id,
                subject_id: q.subject_id,
                needle: q.q,
                sort: q.sort,
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor,
                limit: q.limit,
                count: audit::wants_counting(q.count.as_deref()),
            },
        )
        .await?,
    ))
}
async fn corrupt_projection(
    State(s): State<AppState>,
    Json(r): Json<CorruptProjectionRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::corrupt_projection_for_test(&s.db, r, s.config.enable_test_controls)
            .await?,
    ))
}

async fn commercial_publications(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list_commercial_publications(&s.db).await?,
    ))
}

async fn create_commercial_publication(
    State(s): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(r): Json<CreateCommercialPublicationRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = infrastructure::create_commercial_publication(&s.db, r).await?;
    if let Some(publication_id) = id_in(&body, "id") {
        acted_on.set(RecordKind::Publication, publication_id);
    }
    Ok((StatusCode::CREATED, Json(body)))
}

async fn publish_commercial_publication(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CommandRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::publish_commercial_publication(&s.db, id, r).await?,
    ))
}

/// The pricelist: searched, filtered, sorted and paged.
///
/// It answers with an envelope — `rows`, a `next_cursor`, a `total` and facet
/// counts — in the shape `GET /finance/money` established and
/// `GET /commercial/rules` follows, so one hook in the browser draws all three
/// Commercial lists.
///
/// A typed query struct rather than `Query<Vec<(String, String)>>`, unlike the
/// two beside it: nothing this route takes repeats — `divisions` and `tags`
/// have always arrived as comma lists — so a struct loses nothing and gains
/// `deny_unknown_fields`, which refuses `?divisionss=KIDS` instead of quietly
/// pricing the whole catalogue under a filter the caller believes is applied.
async fn article_prices(
    State(s): State<AppState>,
    Query(q): Query<ArticlePriceQuery>,
) -> Result<Json<infrastructure::ArticlePricePage>, AppError> {
    Ok(Json(
        infrastructure::article_prices(
            &s.db,
            q.channel,
            q.at.unwrap_or_else(chrono::Utc::now),
            infrastructure::ArticlePriceScope {
                q: q.q.clone().filter(|value| !value.trim().is_empty()),
                divisions: ArticlePriceQuery::list(&q.divisions),
                tags: ArticlePriceQuery::list(&q.tags),
                min_price: q.min_price,
                max_price: q.max_price,
                sort: q.sort.clone(),
                // `dir=desc` and nothing else. Absent, empty and anything
                // unrecognised all mean ascending, which is the direction a
                // list is in before anybody touches it.
                desc: q.dir.as_deref() == Some("desc"),
                cursor: q.cursor.clone(),
                // Clamped where it is enforced, not here.
                limit: q.limit,
            },
        )
        .await?,
    ))
}

async fn commercial_products(
    State(s): State<AppState>,
    Query(q): Query<CommercialProductQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::commercial_products(&s.db, q.q.as_deref(), q.limit.unwrap_or(50)).await?,
    ))
}

async fn commercial_publication_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::commercial_publication_detail(&s.db, id).await?,
    ))
}

async fn commercial_activation(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::commercial_activation(&s.db).await?))
}

async fn commercial_usage(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::commercial_usage(&s.db).await?))
}

async fn publish_commercial_usage(
    State(s): State<AppState>,
    Json(r): Json<CommandRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::publish_commercial_usage_to_fleet(&s.db, r.actor_id.trim()).await?,
    ))
}

/// Stop a campaign, restart it, or move its dates — and tell the shops.
///
/// `PATCH` rather than `POST`, because it changes one field of something that
/// already exists rather than creating anything. The dispatch happens inside:
/// a pause that reached Postgres and waited for the next broadcast would still
/// be a pause that had not reached the shop floor.
async fn switch_campaign(
    State(s): State<AppState>,
    Path(campaign_id): Path<String>,
    Json(r): Json<CampaignSwitchRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::switch_campaign(&s.db, &campaign_id, r).await?,
    ))
}

async fn points_account(
    State(s): State<AppState>,
    Path(customer_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::points_account(&s.db, &customer_id).await?,
    ))
}

/// Spend points on a voucher.
///
/// No `Idempotency-Key` header: the key is in the body and is stored on the
/// redemption itself, because it has to survive longer than a request. A retry
/// hours later — after a till was restarted — must still return the voucher
/// that was issued rather than issue a second one.
async fn redeem_points_to_voucher(
    State(s): State<AppState>,
    Path(customer_id): Path<String>,
    Json(mut r): Json<infrastructure::RedeemPointsRequest>,
) -> Result<Json<Value>, AppError> {
    // The member in the path wins over the one in the body. A body that could
    // name a different member than the URL is a way to spend somebody else's
    // points through an endpoint that looks addressed to your own.
    r.customer_id = customer_id;
    Ok(Json(
        infrastructure::redeem_points_to_voucher(&s.db, r).await?,
    ))
}

async fn campaign_intents(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::campaign_intents(&s.db).await?))
}

/// `null` where nobody has stated one — a 200 rather than a 404.
///
/// "This campaign has no objective" is the finding, not an error: it is exactly
/// the campaign somebody should be asked to justify or delete, and a 404 would
/// have the screen draw an error state over a perfectly readable answer.
async fn campaign_intent(
    State(s): State<AppState>,
    Path(campaign_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::campaign_intent(&s.db, &campaign_id)
            .await?
            .unwrap_or(Value::Null),
    ))
}

async fn save_campaign_intent(
    State(s): State<AppState>,
    Path(campaign_id): Path<String>,
    Json(r): Json<infrastructure::CampaignIntentInput>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::save_campaign_intent(&s.db, &campaign_id, r).await?,
    ))
}

async fn delete_campaign_intent(
    State(s): State<AppState>,
    Path(campaign_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::delete_campaign_intent(&s.db, &campaign_id).await?,
    ))
}

/// Pricing changes that are scheduled or running, newest first.
///
/// Finished changes are off by default: this is a working list, and an archive
/// of every book ever cut is a different screen with a different reader.
async fn price_changes(
    State(s): State<AppState>,
    Query(q): Query<PriceChangesQuery>,
) -> Result<Json<Value>, AppError> {
    let changes = infrastructure::price_changes(&s.db, q.include_settled).await?;
    Ok(Json(json!({ "rows": changes })))
}

/// What the estate owes its members in points.
async fn points_accounts(
    State(s): State<AppState>,
    Query(q): Query<PointsQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::points_accounts(&s.db, q.limit.unwrap_or(200)).await?,
    ))
}

/// Every points movement, or one member's.
async fn points_ledger(
    State(s): State<AppState>,
    Query(q): Query<PointsQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::points_ledger(
            &s.db,
            q.customer_id.as_deref().filter(|id| !id.trim().is_empty()),
            q.limit.unwrap_or(200),
        )
        .await?,
    ))
}

#[derive(Debug, serde::Deserialize)]
struct PointsQuery {
    /// One member, or the whole estate when absent. Shared by both routes: the
    /// ledger narrows by it, and the account list ignores it — a list of one
    /// account is `points-ledger` with the member named, not a second shape of
    /// this one.
    customer_id: Option<String>,
    limit: Option<i64>,
}

/// Everything that has happened to the price books, newest first.
async fn price_events(
    State(s): State<AppState>,
    Query(q): Query<PriceEventsQuery>,
) -> Result<Json<Value>, AppError> {
    let events = infrastructure::price_events(
        &s.db,
        q.version,
        q.site_id.as_deref().filter(|id| !id.trim().is_empty()),
        q.limit.unwrap_or(200),
    )
    .await?;
    Ok(Json(json!({ "rows": events })))
}

#[derive(Debug, serde::Deserialize)]
struct PriceEventsQuery {
    /// One book's own log. The version rather than the uuid, because that is
    /// what every other surface in this module names a book by.
    version: Option<i64>,
    site_id: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
struct PriceChangesQuery {
    #[serde(default)]
    include_settled: bool,
}

/// Every price one shop has charged for one product, oldest first.
///
/// Three narrowing parameters and all three required, deliberately: a history
/// is a question about ONE product at ONE shop on ONE channel, and a call that
/// left any of them open would replay the cascade across the estate to answer a
/// question nobody asked.
async fn price_history(
    State(s): State<AppState>,
    Query(q): Query<PriceHistoryQuery>,
) -> Result<Json<Value>, AppError> {
    let history = infrastructure::price_history(&s.db, &q.sku_code, &q.site_id, &q.channel).await?;
    Ok(Json(serde_json::to_value(history)?))
}

#[derive(Debug, serde::Deserialize)]
struct PriceHistoryQuery {
    sku_code: String,
    site_id: String,
    /// `STORE` unless asked otherwise — the channel almost every question is
    /// about, and the one a shelf edge belongs to.
    #[serde(default = "store_channel")]
    channel: String,
}

fn store_channel() -> String {
    "STORE".to_string()
}

/// Charges a branch took that never became a sale.
///
/// `open_only` defaults to true — the work, not the archive. A list that opens
/// on every case ever reported is a list nobody scrolls, and the ones that
/// matter are the ones nobody has answered.
async fn list_checkout_exceptions(
    State(s): State<AppState>,
    Query(q): Query<CheckoutExceptionQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list_exceptions(&s.db, q.site_id.as_deref(), q.open_only).await?,
    ))
}

#[derive(Debug, serde::Deserialize)]
struct CheckoutExceptionQuery {
    #[serde(default)]
    site_id: Option<String>,
    #[serde(default = "yes")]
    open_only: bool,
}

fn yes() -> bool {
    true
}

/// Answer for one case. Refuses to reopen a closed one — see the module note:
/// a fact redelivered by a sync retry must not undo a refund somebody made.
async fn resolve_checkout_exception(
    State(s): State<AppState>,
    Path(checkout_id): Path<Uuid>,
    Json(r): Json<infrastructure::ResolveExceptionRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::resolve_exception(&s.db, checkout_id, r).await?,
    ))
}

async fn commercial_simulate(
    State(s): State<AppState>,
    Json(r): Json<SimulateRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::simulate(&s.db, r).await?))
}

async fn resolve_offer(
    State(s): State<AppState>,
    Query(q): Query<ResolveOfferQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::resolve_offer(&s.db, q).await?))
}

async fn commercial_offers(
    State(s): State<AppState>,
    Query(q): Query<OfferListQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list_resolved_offers(
            &s.db,
            &q.site_id,
            q.channel,
            q.at.unwrap_or_else(chrono::Utc::now),
        )
        .await?,
    ))
}

async fn shop_sale_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::get_shop_sale(&s.db, id).await?))
}

async fn sales(
    State(s): State<AppState>,
    Query(q): Query<SaleQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::list_sales(&s.db, q).await?))
}

async fn create_sale(
    State(s): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(r): Json<CreateSaleRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = infrastructure::create_sale(&s.db, r).await?;
    if let Some(sale_id) = id_in(&body, "id") {
        acted_on.set(RecordKind::Sale, sale_id);
    }
    Ok((StatusCode::CREATED, Json(body)))
}

async fn sale_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::get_sale(&s.db, id).await?))
}

async fn add_sale_line(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<AddSaleLineRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    Ok((
        StatusCode::CREATED,
        Json(infrastructure::add_sale_line(&s.db, id, r).await?),
    ))
}

async fn add_sale_payment(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<AddSalePaymentRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    Ok((
        StatusCode::CREATED,
        Json(infrastructure::add_sale_payment(&s.db, id, r).await?),
    ))
}

async fn complete_sale(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CommandRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::complete_sale(&s.db, id, r).await?))
}

async fn void_sale(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(r): Json<CommandRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::void_open_sale(&s.db, id, r).await?))
}

async fn sale_receipt(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::build_receipt(&s.db, id).await?))
}

async fn create_sale_return(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(r): Json<CreateReturnRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = infrastructure::create_sale_return(&s.db, id, r).await?;
    // The route says `sale`, and the route is not wrong — but the record a
    // person opens afterwards is the refund, and its own sheet is where they
    // will look for who made it.
    if let Some(return_id) = id_in(&body, "id") {
        acted_on.set(RecordKind::Return, return_id);
    }
    Ok((StatusCode::CREATED, Json(body)))
}

/// Refunds, as an envelope rather than a bare `{items, limit}`.
///
/// `limit` is gone from the answer and `total`, `refund_total_minor`,
/// `next_cursor` and `facets` are in its place: echoing back the ceiling told a
/// caller what it had asked for, which it already knew, and never whether the
/// answer was all of them.
async fn sale_returns(
    State(s): State<AppState>,
    Query(q): Query<ReturnQuery>,
) -> Result<Json<infrastructure::SaleReturnList>, AppError> {
    Ok(Json(infrastructure::list_sale_returns(&s.db, q).await?))
}

async fn sale_return_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::get_sale_return(&s.db, id).await?))
}

async fn daily_report(
    State(s): State<AppState>,
    Query(q): Query<DailyReportQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::daily_sales_report(&s.db, q).await?))
}

/// Every shop's takings over a span, bucketed by day, week or month.
async fn sales_series(
    State(s): State<AppState>,
    Query(q): Query<SalesSeriesQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::sales_series(&s.db, q).await?))
}

/// One shop over one span, down to the receipts.
async fn sales_window(
    State(s): State<AppState>,
    Query(q): Query<SalesWindowQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::sales_window(&s.db, q).await?))
}

// ---- Ordered edge->cloud sync -------------------------------------------

/// Sender + receiver observability in one place: watermark, backlog, breaker,
/// dead letters, and (for a receiving node) every ingest stream it holds.
async fn sync_status(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    let snapshot = infrastructure::sync_snapshot(&s.db).await?;
    let now = Utc::now();
    let ingest_streams: Vec<Value> = snapshot
        .ingest_streams
        .iter()
        .map(|stream| {
            json!({
                "origin_id": stream.origin_id,
                "generation": stream.generation,
                "durable_seq": stream.durable_seq,
                "rejected_count": stream.rejected_count,
                "last_received_at": stream.last_received_at,
                "last_received_age_seconds":
                    infrastructure::seconds_since(stream.last_received_at, now),
                "applied_seq": stream.applied_seq,
                "apply_lag": stream.apply_lag(),
                "blocked": stream.blocked_at_seq.map(|seq| json!({
                    "seq": seq,
                    "reason": stream.blocked_reason,
                    "since": stream.blocked_since,
                })),
            })
        })
        .collect();
    Ok(Json(json!({
        "node_id": s.config.node_id,
        "node_role": s.config.node_role,
        "state": infrastructure::sync_health_state(&snapshot, s.config.sync_degraded_after_seconds, now),
        "origin": snapshot.origin.as_ref().map(|(origin_id, generation)| json!({
            "origin_id": origin_id,
            "generation": generation,
        })),
        "watermark_seq": snapshot.watermark_seq,
        "backlog_count": snapshot.backlog_count,
        "backlog_oldest_seconds": snapshot.backlog_oldest_seconds,
        "dead_letter_count": snapshot.dead_letter_count,
        "sender": {
            "consecutive_failures": snapshot.sender.consecutive_failures,
            "breaker_open": infrastructure::breaker_is_open(&snapshot.sender, now),
            "breaker_open_until": snapshot.sender.breaker_open_until,
            "last_success_at": snapshot.sender.last_success_at,
            "last_error": snapshot.sender.last_error,
            "last_error_at": snapshot.sender.last_error_at,
        },
        "upload_configured": s.config.sync_upload_url.is_some(),
        "ingest_streams": ingest_streams,
    })))
}

/// The receiver half of the protocol: a contiguous batch in, a prefix
/// acknowledgement out. Guarded by a shared key when one is configured.
async fn sync_ingest(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(batch): Json<IngestBatch>,
) -> Result<Json<Value>, AppError> {
    // Per-origin credential first: a registered origin is accepted ONLY with
    // its own key, so no store can upload facts claiming another store's
    // origin_id. An authenticated Cloud rejects unregistered origins: its
    // master key is a provisioning credential, never an ingest identity.
    // Auth-disabled development keeps the explicit master-key fallback.
    let presented = headers.get("x-sync-key").and_then(|v| v.to_str().ok());
    match infrastructure::origin_credential_digest(&s.db, &batch.origin_id).await? {
        Some(digest) => {
            let authorized =
                presented.is_some_and(|key| infrastructure::ingest_key_matches(&digest, key));
            if !authorized {
                return Err(AppError::Forbidden(
                    "invalid or missing x-sync-key for this origin".into(),
                ));
            }
        }
        None => {
            if s.config.jwt_secret.is_some() {
                return Err(AppError::Forbidden(
                    "invalid or missing x-sync-key for this origin".into(),
                ));
            }
            if let Some(expected) = &s.config.sync_ingest_key {
                if !presented.is_some_and(|value| security::constant_time_eq(value, expected)) {
                    return Err(AppError::Forbidden("invalid or missing x-sync-key".into()));
                }
            }
        }
    }
    let response = infrastructure::ingest_batch(&s.db, &batch).await?;
    Ok(Json(serde_json::to_value(&response)?))
}

/// What the fleet sent that this server would not take — an envelope rather
/// than a bare `{items}`.
///
/// The limit is no longer read here and handed on: it is clamped where it is
/// enforced, which is one spelling of how much of a backlog one request may
/// see, and `total` is what turns a silent truncation into a visible one.
async fn sync_dead_letters(
    State(s): State<AppState>,
    Query(q): Query<DeadLetterQuery>,
) -> Result<Json<infrastructure::DeadLetterList>, AppError> {
    Ok(Json(infrastructure::list_dead_letters(&s.db, q).await?))
}

/// Wake the sender now instead of waiting out its interval.
async fn sync_trigger(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    s.sync_wake.notify_one();
    Ok(Json(json!({"status": "triggered"})))
}

/// Operator action: close the breaker and retry immediately. Deliberately a
/// human-invoked endpoint, never something observability calls on its own —
/// the breaker opened because retries were making an incident worse.
async fn sync_breaker_reset(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    infrastructure::reset_breaker(&s.db).await?;
    s.sync_wake.notify_one();
    Ok(Json(json!({"status": "breaker_reset"})))
}

/// Prometheus text exposition, hand-rolled: a handful of gauges does not need
/// a metrics crate.
async fn metrics(State(s): State<AppState>) -> Result<impl axum::response::IntoResponse, AppError> {
    use std::fmt::Write as _;
    let snapshot = infrastructure::sync_snapshot(&s.db).await?;
    let now = Utc::now();
    let mut out = String::with_capacity(1024);
    let _ = writeln!(out, "# TYPE sync_backlog_facts gauge");
    let _ = writeln!(out, "sync_backlog_facts {}", snapshot.backlog_count);
    let _ = writeln!(out, "# TYPE sync_backlog_oldest_seconds gauge");
    let _ = writeln!(
        out,
        "sync_backlog_oldest_seconds {}",
        snapshot.backlog_oldest_seconds.unwrap_or(0.0)
    );
    if let Some((origin_id, generation)) = &snapshot.origin {
        let _ = writeln!(out, "# TYPE sync_watermark_seq gauge");
        let _ = writeln!(
            out,
            "sync_watermark_seq{{origin=\"{origin_id}\",generation=\"{generation}\"}} {}",
            snapshot.watermark_seq
        );
    }
    let _ = writeln!(out, "# TYPE sync_dead_letter_total gauge");
    let _ = writeln!(out, "sync_dead_letter_total {}", snapshot.dead_letter_count);
    let _ = writeln!(out, "# TYPE sync_breaker_open gauge");
    let _ = writeln!(
        out,
        "sync_breaker_open {}",
        i32::from(infrastructure::breaker_is_open(&snapshot.sender, now))
    );
    let _ = writeln!(out, "# TYPE sync_consecutive_failures gauge");
    let _ = writeln!(
        out,
        "sync_consecutive_failures {}",
        snapshot.sender.consecutive_failures
    );
    if let Some(age) = infrastructure::seconds_since(snapshot.sender.last_success_at, now) {
        let _ = writeln!(out, "# TYPE sync_last_success_age_seconds gauge");
        let _ = writeln!(out, "sync_last_success_age_seconds {age}");
    }
    if !snapshot.ingest_streams.is_empty() {
        let _ = writeln!(out, "# TYPE sync_ingest_watermark_seq gauge");
        let _ = writeln!(out, "# TYPE sync_ingest_rejected_total gauge");
        let _ = writeln!(out, "# TYPE sync_apply_applied_seq gauge");
        let _ = writeln!(out, "# TYPE sync_apply_lag gauge");
        let _ = writeln!(out, "# TYPE sync_apply_blocked gauge");
        let _ = writeln!(out, "# TYPE sync_ingest_last_received_age_seconds gauge");
        for stream in &snapshot.ingest_streams {
            let labels = format!(
                "origin=\"{}\",generation=\"{}\"",
                stream.origin_id, stream.generation
            );
            let _ = writeln!(
                out,
                "sync_ingest_watermark_seq{{{labels}}} {}",
                stream.durable_seq
            );
            let _ = writeln!(
                out,
                "sync_ingest_rejected_total{{{labels}}} {}",
                stream.rejected_count
            );
            let _ = writeln!(
                out,
                "sync_apply_applied_seq{{{labels}}} {}",
                stream.applied_seq
            );
            let _ = writeln!(out, "sync_apply_lag{{{labels}}} {}", stream.apply_lag());
            let _ = writeln!(
                out,
                "sync_apply_blocked{{{labels}}} {}",
                i32::from(stream.blocked_at_seq.is_some())
            );
            if let Some(age) = infrastructure::seconds_since(stream.last_received_at, now) {
                let _ = writeln!(
                    out,
                    "sync_ingest_last_received_age_seconds{{{labels}}} {age}"
                );
            }
        }
    }
    Ok(([(header::CONTENT_TYPE, "text/plain; version=0.0.4")], out))
}

async fn tm_state(
    State(s): State<AppState>,
    Query(q): Query<infrastructure::TimeMachineStateQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::time_machine_state(&s.db, q).await?))
}
async fn tm_divergence(
    State(s): State<AppState>,
    Query(q): Query<infrastructure::TimeMachineScope>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::time_machine_divergence(&s.db, q).await?,
    ))
}
async fn tm_sync_divergence(
    State(s): State<AppState>,
    Query(q): Query<infrastructure::SyncDivergenceQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::time_machine_sync_divergence(&s.db, q).await?,
    ))
}
async fn tm_what_if(
    State(s): State<AppState>,
    Json(r): Json<infrastructure::WhatIfRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::time_machine_what_if(&s.db, r).await?))
}

/// Register or rotate one store's ingest key. Guarded by the master
/// SYNC_INGEST_KEY when configured — the operator registers all 30 stores
/// with the master key, then each store authenticates only as itself.
async fn sync_register_origin(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<RegisterOriginRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if let Some(master) = &s.config.sync_ingest_key {
        let presented = headers.get("x-sync-key").and_then(|v| v.to_str().ok());
        if !presented.is_some_and(|value| security::constant_time_eq(value, master)) {
            return Err(AppError::Forbidden(
                "origin registration requires the master x-sync-key".into(),
            ));
        }
    }
    infrastructure::register_origin_credential_binding(
        &s.db,
        &request.origin_id,
        &request.ingest_key,
        request.label.as_deref(),
        request.site_id.as_deref(),
        request.node_role.as_deref(),
        request.active_generation,
        request.inventory_enabled,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"status": "registered", "origin_id": request.origin_id.trim()})),
    ))
}

/// Every origin, with where its stream actually stands. Keys never included.
///
/// This used to list credentials alone — who is registered, at which
/// generation the fence sits — which answers "was this shop set up" and not
/// "is this shop reaching me". Those look identical from a credential table
/// and could not be further apart on the evening a till's database is
/// replaced. The watermark, the last fact received and any unclosed integrity
/// alert now ride along; the credential fields keep their names for the
/// readers that already had them.
async fn sync_list_origins(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::sync_origins_list(&s.db).await?))
}

// ---- Downstream lane: issuing, recalling, and watching commands ----------

fn require_master_key(config: &AppConfig, headers: &HeaderMap) -> Result<(), AppError> {
    let Some(master) = &config.sync_ingest_key else {
        return Ok(());
    };
    let presented = headers.get("x-sync-key").and_then(|v| v.to_str().ok());
    if !presented.is_some_and(|value| security::constant_time_eq(value, master)) {
        return Err(AppError::Forbidden(
            "this endpoint requires the master x-sync-key".into(),
        ));
    }
    Ok(())
}

/// Issue a command to named stores, or to the whole fleet when `targets` is
/// empty. The payload is validated here so a malformed broadcast is refused at
/// the issuing desk rather than blocking 30 shops at once.
async fn sync_issue_command(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<IssueCommandRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    require_master_key(&s.config, &headers)?;
    if request.issued_by.trim().is_empty() {
        return Err(AppError::Validation("issued_by is required".into()));
    }
    let (command_id, targets) = infrastructure::issue_command(
        &s.db,
        &request.command_type,
        &request.payload,
        &request.issued_by,
        request.expires_at,
        &request.targets,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "command_id": command_id,
            "command_type": request.command_type,
            "targets": targets,
        })),
    ))
}

/// Recall a command. Stores that have not applied it yet will skip it; those
/// that already applied it are unaffected — a recall is not an undo.
async fn sync_revoke_command(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(request): Json<RevokeCommandRequest>,
) -> Result<Json<Value>, AppError> {
    require_master_key(&s.config, &headers)?;
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation("reason is required".into()));
    }
    let caught = infrastructure::revoke_command(&s.db, id, &request.reason).await?;
    Ok(Json(json!({
        "command_id": id,
        "status": "revoked",
        "stores_caught_in_time": caught,
    })))
}

/// Where one command has reached: which stores settled it, which have not.
async fn sync_command_reach(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::command_reach(&s.db, id).await?))
}

/// The whole fleet's command convergence in one view — the question 30 stores
/// make unavoidable: who is up to date, who is behind, who is stuck and why.
async fn sync_fleet(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    let stores = infrastructure::fleet_command_status(&s.db).await?;
    let now = Utc::now();
    let converged = stores.iter().filter(|st| st.converged()).count();
    let blocked = stores
        .iter()
        .filter(|st| st.blocked_at_seq.is_some())
        .count();
    let items: Vec<Value> = stores
        .iter()
        .map(|st| {
            json!({
                "origin_id": st.origin_id,
                "label": st.label,
                "issued_seq": st.issued_seq,
                "acked_seq": st.acked_seq,
                "pending": st.pending(),
                "converged": st.converged(),
                "last_ack_age_seconds": infrastructure::seconds_since(st.acked_at, now),
                "blocked": st.blocked_at_seq.map(|seq| json!({
                    "seq": seq,
                    "reason": st.blocked_reason,
                    "since": st.blocked_since,
                })),
            })
        })
        .collect();
    Ok(Json(json!({
        "stores": stores.len(),
        "converged": converged,
        "behind": stores.len() - converged,
        "blocked": blocked,
        "items": items,
    })))
}

/// Where the centre's arithmetic and a node's own claim disagree.
///
/// An empty list is the ordinary state and the one worth watching for: it
/// means every node the centre has caught up with agrees with the position
/// the centre derived from that node's own facts.
async fn sync_reconciliation(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    let discrepancies = infrastructure::reconcile_positions(&s.db).await?;
    let items: Vec<Value> = discrepancies
        .iter()
        .map(|d| {
            json!({
                "origin_id": d.origin_id,
                "site_id": d.site_id,
                "pool_id": d.pool_id,
                "computed_on_hand": d.computed_on_hand,
                "observed_on_hand": d.observed_on_hand,
                "difference": d.difference(),
                "computed_allotted": d.computed_allotted,
                "observed_allotted": d.observed_allotted,
                "allotted_difference": d.allotted_difference(),
                "snapshot_seq": d.snapshot_seq,
                "applied_seq": d.applied_seq,
            })
        })
        .collect();
    Ok(Json(json!({
        "reconciled": items.is_empty(),
        "discrepancy_count": items.len(),
        "discrepancies": items,
    })))
}

// ---- Purchase orders ------------------------------------------------------

/// Raise a purchase order and send it to the DC that will receive it.
///
/// Both happen in one transaction inside `create_purchase_order`: an order
/// nobody was told about and a command about an order that rolled back are
/// each incoherent on their own.
async fn raise_purchase_order(
    State(s): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<infrastructure::NewPurchaseOrder>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let (purchase_order_id, command_id, target) =
        infrastructure::create_purchase_order(&s.db, &request).await?;
    // The order's first line of history. The path cannot say this — there was
    // no order to name when the request was written — so the handler does.
    acted_on.set(RecordKind::PurchaseOrder, purchase_order_id.to_string());
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "purchase_order_id": purchase_order_id,
            "po_number": request.po_number,
            "destination_site_id": request.destination_site_id,
            "activation_command_id": command_id,
            "sent_to_origin": target,
        })),
    ))
}

/// One order with what has actually arrived against it. The received figure
/// is summed from the DC's receipts on every read, never stored.
async fn purchase_order_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::purchase_order_status(&s.db, id).await?,
    ))
}

async fn list_purchase_orders(
    State(s): State<AppState>,
    Query(q): Query<PurchaseOrderQuery>,
) -> Result<Json<infrastructure::PurchaseOrderPage>, AppError> {
    Ok(Json(
        infrastructure::list_purchase_orders(
            &s.db,
            &infrastructure::PurchaseOrderFilter {
                q: q.q.clone().filter(|value| !value.trim().is_empty()),
                statuses: comma_list(&q.status),
                suppliers: comma_list(&q.supplier),
                issued_from: q.issued_from,
                issued_to: q.issued_to,
                sort: q.sort.clone(),
                dir: q.dir.clone(),
                cursor: q.cursor.clone(),
                // Defaulted and clamped where it is enforced, not here. It was
                // spelled in both places and the two disagreed.
                limit: q.limit,
            },
        )
        .await?,
    ))
}

// ---- Article master setup -------------------------------------------------

/// Deliveries that have been counted and accepted but not yet worked out —
/// head office's queue. What each row carries is the SUPPLIER's code and the
/// buyer's own wording, which are presets for the form, not decisions.
async fn list_unidentified_receipts(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({
        "items": infrastructure::unidentified_receipts(&s.db).await?
    })))
}

/// Sessions head office has opened and not yet issued.
async fn list_setup_sessions(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    let items = infrastructure::pending_setup_sessions(&s.db).await?;
    Ok(Json(json!({ "items": items })))
}

/// Open a session against an accepted delivery: name the article, file it
/// under a division, split it into the variants that actually arrived and
/// price each one. Nothing is minted until it is issued.
async fn open_setup_session(
    State(s): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<infrastructure::NewSetupSession>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let session_id = infrastructure::create_setup_session(&s.db, &request).await?;
    acted_on.set(RecordKind::ArticleSetup, session_id.to_string());
    Ok((
        StatusCode::CREATED,
        Json(infrastructure::setup_session_status(&s.db, session_id).await?),
    ))
}

async fn setup_session_detail(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::setup_session_status(&s.db, id).await?))
}

#[derive(serde::Deserialize)]
struct IssueSetupRequest {
    issued_by: String,
}

/// Mint the article, its SKUs and their EPCs, and send the tagging job down.
/// All of it commits together: a serial range drawn and not sent is a hole in
/// the numbering that nothing will ever fill.
async fn issue_setup_session(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<IssueSetupRequest>,
) -> Result<Json<Value>, AppError> {
    let (job_id, command_id) =
        infrastructure::issue_setup_session(&s.db, id, &request.issued_by).await?;
    let mut status = infrastructure::setup_session_status(&s.db, id).await?;
    if let Some(object) = status.as_object_mut() {
        object.insert("tagging_job_id".into(), json!(job_id));
        object.insert("tagging_command_id".into(), json!(command_id));
    }
    Ok(Json(status))
}

/// Mint an article code for a product new to the catalogue.
///
/// Ordinarily a setup session mints its own; this exists for the case where a
/// buyer wants the code in hand before the goods arrive.
async fn mint_article_code(
    State(s): State<AppState>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let code = infrastructure::mint_article_code(&s.db).await?;
    Ok((StatusCode::CREATED, Json(json!({ "article_code": code }))))
}

/// Price queries waiting for whoever raised the order.
async fn pending_price_amendments(
    State(s): State<AppState>,
    Query(q): Query<PriceAmendmentQuery>,
) -> Result<Json<infrastructure::PriceAmendmentPage>, AppError> {
    Ok(Json(
        infrastructure::pending_price_amendments(
            &s.db,
            &infrastructure::PriceAmendmentScope {
                q: q.q.clone().filter(|value| !value.trim().is_empty()),
                origins: comma_list(&q.origin),
                sort: q.sort.clone(),
                dir: q.dir.clone(),
                cursor: q.cursor.clone(),
                limit: q.limit,
            },
        )
        .await?,
    ))
}

#[derive(serde::Deserialize)]
struct PriceDecisionRequest {
    outcome: crate::cloud::domain::PriceAmendmentOutcome,
    decided_by: String,
    #[serde(default)]
    note: Option<String>,
    /// How far an approval reaches: `DELIVERY` (the default) settles the
    /// acceptance that raised the query; `REMAINING` also reprices the
    /// quantity not yet received. Two different commercial acts, so the
    /// narrow one is what happens when nobody says.
    #[serde(default)]
    reach: Option<infrastructure::AmendmentReach>,
}

/// Answer one. Approving changes the order and tells the DC in one step; both
/// have to happen or a delivery waits on an answer that already exists.
async fn decide_price_amendment(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<PriceDecisionRequest>,
) -> Result<Json<Value>, AppError> {
    // Absent means the narrow answer. A buyer who means to reprice the rest of
    // the order says so; defaulting the other way would let an invoice change
    // what an order costs because nobody ticked a box.
    let reach = request
        .reach
        .unwrap_or(infrastructure::AmendmentReach::Delivery);
    let (request_id, command_id) = infrastructure::decide_price_amendment(
        &s.db,
        id,
        request.outcome,
        reach,
        &request.decided_by,
        request.note.as_deref(),
    )
    .await?;
    Ok(Json(json!({
        "request_id": request_id,
        "outcome": request.outcome,
        "reach": reach,
        "decision_command_id": command_id,
    })))
}

#[derive(serde::Deserialize)]
struct CloseShortRequest {
    closed_by: String,
    reason: String,
}

/// Stop waiting for the rest of a line: 100 of 300 arrived and the buyer
/// decides the other 200 are not coming.
///
/// Only from here, never from the warehouse. A DC that could close its own
/// outstanding lines would be marking the company's purchases complete on the
/// strength of what happened to turn up at its door.
async fn close_purchase_line_short(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<CloseShortRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::close_purchase_line_short(&s.db, id, &request.closed_by, &request.reason)
            .await?,
    ))
}

/// Query-string helpers, shared.
///
/// They started in `articles.rs` and moved here the moment a second module
/// needed them: a filter that accepts repeated keys in one module and drops
/// all but the last in another is the kind of difference nobody discovers
/// until a screen quietly shows one filter's worth of rows.
/// Every value given for one query key.
///
/// Repeated keys AND comma-separated values, both, because the two halves of
/// this repository already disagree: `supplier-items` reads
/// `division=KIDS,DIVIDED` while the shared spec for this module says to
/// repeat the key. Accepting one and rejecting the other would work perfectly
/// in a browser and fail for whoever wrote the other form by hand, with an
/// empty list rather than an error — a filter that silently matches everything
/// is worse than one that refuses.
pub(super) fn facet_values(params: &[(String, String)], key: &str) -> Vec<String> {
    params
        .iter()
        .filter(|(name, _)| name == key)
        .flat_map(|(_, value)| value.split(','))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

pub(super) fn single_value(params: &[(String, String)], key: &str) -> Option<String> {
    params
        .iter()
        .rev()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// `limit`, parsed rather than defaulted.
///
/// `None` is a real answer: some of these lists read it as "everything,
/// unpaged" and others as "the default page", and which one is a property of
/// the list rather than of the parsing. A number that is not a number is
/// refused here rather than silently ignored — a caller that sent
/// `limit=fifty` believes it asked for fifty rows, and answering with a
/// different number looks like the server working until the day the list is
/// long.
pub(super) fn limit_value(params: &[(String, String)]) -> Result<Option<i64>, AppError> {
    match single_value(params, "limit") {
        Some(raw) => Ok(Some(raw.parse::<i64>().map_err(|_| {
            AppError::Validation(format!("limit {raw:?} is not a number"))
        })?)),
        None => Ok(None),
    }
}

/// What `deny_unknown_fields` does for a struct, for a route that cannot use
/// one.
///
/// A list whose facets are multi-select has to read the query string as pairs —
/// `?status=ACTIVE&status=PAUSED` is how a panel with two boxes ticked spells
/// itself, and a struct's deserializer keeps the last value and drops the rest
/// in silence. The cost of reading pairs is that a misspelling becomes a
/// parameter nobody claims: `?statuss=ACTIVE` narrows nothing, the caller
/// believes a filter is applied, and the screen shows the whole list under it.
///
/// So the known names are declared and anything else is refused. The same
/// bargain a typed query struct strikes, made explicitly because the typed
/// struct is not available here.
pub(super) fn refuse_unknown_parameters(
    params: &[(String, String)],
    known: &[&str],
) -> Result<(), AppError> {
    match params
        .iter()
        .find(|(name, _)| !known.contains(&name.as_str()))
    {
        Some((name, _)) => Err(AppError::Validation(format!(
            "{name:?} is not a parameter this list takes; it accepts {}",
            known.join(", ")
        ))),
        None => Ok(()),
    }
}
