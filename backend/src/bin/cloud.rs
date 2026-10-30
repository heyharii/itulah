use inventory_backend::cloud::application::sync as sync_agent;
use inventory_backend::cloud::jobs::{self, Job, Pass};
use inventory_backend::cloud::{http, postgres, AppConfig, AppError, AppState};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), AppError> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "inventory_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    let config = AppConfig::from_env()?;
    // The sandbox: one testing server, many businesses, each in a database
    // of its own behind a gateway (`cloud::tenancy`). Nothing below runs on
    // `DATABASE_URL` then — it names the list of businesses, not a business.
    if let Some(tenancy) = inventory_backend::cloud::tenancy::TenancyConfig::from_env()? {
        postgres::integrity_install_close_check();
        return inventory_backend::cloud::tenancy::serve(
            config,
            tenancy,
            start_node_work,
            shutdown_signal(),
        )
        .await;
    }
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;
    postgres::MIGRATOR.run(&pool).await?;
    inventory_backend::cloud::dc::common::warn_if_second_writer(&pool).await;
    // Durable sync identity: origin id + generation live in the node's own
    // database, not in the process environment, so a restart cannot change
    // what stream this node's facts belong to.
    postgres::provision_origin(
        &pool,
        &config.node_id,
        config.sync_generation,
        config.sync_enqueue_enabled,
    )
    .await?;
    // First-boot admin account (no-op once users exist); also warns loudly
    // when the node is running without authentication.
    postgres::bootstrap_admin(
        &pool,
        config.bootstrap_admin_password.as_deref(),
        config.jwt_secret.is_some(),
    )
    .await?;
    let bind_addr = config.bind_addr;
    let node_id = config.node_id.clone();
    let node_role = config.node_role.clone();
    // Before anything can ask for the closing checklist. The engine answers
    // Lane F's `integrity.equations` slot, which ships critical and Pending
    // until something registers under that key.
    postgres::integrity_install_close_check();
    let state = AppState::new(pool, config);
    start_node_work(&state);
    // The mail gateway. Silent and absent unless this node is told where to
    // look — see `cloud::intake`. Started before the server rather than after,
    // so a mailbox that will not answer says so in the log next to the boot.
    if let Some(source) = inventory_backend::cloud::intake::source_from_env() {
        let gateway = inventory_backend::cloud::intake::Gateway::new(state.db.clone(), source)
            .with_archive(state.attachments.clone());
        let interval = inventory_backend::cloud::intake::interval_from_env();
        info!(source = %gateway.describe(), seconds = interval.as_secs(), "bank statement intake started");
        tokio::spawn(inventory_backend::cloud::intake::run_agent(
            gateway, interval,
        ));
    }
    if let Some(url) = state.config.sync_upload_url.clone() {
        let transport = sync_agent::HttpTransport::new(&url, state.config.sync_upload_key.clone())?;
        tokio::spawn(sync_agent::run_sync_agent(
            state.clone(),
            Arc::new(transport),
        ));
    }
    let app = http::router(state);
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| AppError::Configuration(format!("cannot bind {bind_addr}: {e}")))?;
    info!(%bind_addr,%node_id,%node_role,"inventory edge node started");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| AppError::Configuration(format!("server failure: {e}")))
}

/// A business's own background work, started when its database is open: once
/// at boot on a single-business node, once per business the sandbox opens.
fn start_node_work(state: &AppState) {
    // Every periodic job below is driven by `cloud::jobs` (0703): scheduled,
    // pausable, runnable on request from the System screen, one server at a
    // time, retried with backoff, and every pass that did something or failed
    // written down in `job_run`.
    let db = state.db.clone();
    jobs::spawn(db.clone(), AUTH_POLICY, auth_policy_pass);
    jobs::spawn(db.clone(), catalog_job(), catalog_pass);
    jobs::spawn(
        db.clone(),
        Job {
            key: "articles.issue",
            label: "Issue queued article setups",
            every: std::time::Duration::from_secs(2),
        },
        |pool, mut pass| async move {
            match postgres::process_setup_issue_queue(&pool).await {
                Ok(count) => pass.did(count),
                Err(error) => pass.problem(error.to_string()),
            }
            pass
        },
    );
    jobs::spawn(db.clone(), FLEET_SWEEP, fleet_sweep_pass);
    jobs::spawn(db.clone(), EXCEPTIONS, exception_pass);
    jobs::spawn(db.clone(), AGEING, ageing_pass);
    if state.config.finance_automation_enabled {
        jobs::spawn(db.clone(), ASSET_MONTH_END, asset_month_end_pass);
        jobs::spawn(db.clone(), PREPAID_MONTH_END, prepaid_month_end_pass);
        info!("asset and prepaid month-end posting enabled");
    } else {
        info!(
            "asset and prepaid month-end posting disabled; event-driven Finance posting remains active"
        );
    }
    jobs::spawn(db.clone(), SALE_DAY, sale_day_pass);
    // The Sales screens' one summary: store days the triggers marked are
    // recomputed from the raw lines, and once a day the summary is checked
    // against them. See `postgres::sales_rollup` and `0930`.
    jobs::spawn(db.clone(), SALES_ROLLUP, sales_rollup_pass);
    jobs::spawn(db.clone(), SALES_RECONCILE, sales_reconcile_pass);
    jobs::spawn(db.clone(), STORE_STOCK, store_stock_pass);
    jobs::spawn(db.clone(), POSTINGS, postings_pass);
    jobs::spawn(db.clone(), RECURRING_BILLS, recurring_bills_pass);
    jobs::spawn(db.clone(), JOURNAL_REPEAT, journal_repeat_pass);
    jobs::spawn(db.clone(), CASH_REPEAT, cash_repeat_pass);
    jobs::spawn(db.clone(), INTEGRITY, integrity_pass);
    // The Inventory Control screen's stored answer, refreshed here and read
    // by the route in milliseconds. See `postgres::control` and `0949`.
    jobs::spawn(db.clone(), CONTROL_STATE, control_state_pass);
    // The clock's own HR work: the accrual a policy has earned, the
    // carry-forward a cap put a deadline on, next week's roster carried from
    // this week's plan, and the nudges. See `postgres::schedule` and `0363`.
    jobs::spawn(db.clone(), HR, hr_pass);
    // The same clock, telling head office what is about to lapse: GA
    // contracts, filed papers, supplier bills, tax months. See
    // `postgres::reminders` and `0383`.
    jobs::spawn(db.clone(), REMINDERS, reminder_pass);
    // Web Push: notifications sent on to the phones and browsers that asked,
    // every two seconds from the outbox 0462 fills. Says at startup whether
    // it is on; off is a missing key, never a refusal to boot. See
    // `cloud::push`.
    inventory_backend::cloud::push::spawn_agent(state.db.clone());
    // Yesterday, told to every Admin once a morning at the hour Finance set —
    // takings against the same weekday, the shops that moved, what is still
    // missing. Arithmetic only; no model is asked. See the morning brief in
    // `postgres::assistant` and `0502`.
    tokio::spawn(postgres::run_morning_brief_agent(state.db.clone()));
    if state.config.sync_apply_enabled {
        tokio::spawn(sync_agent::run_apply_agent(state.clone()));
        // Head office told what its promotions are doing that no sale causes:
        // a shop that could not apply a price book or has said nothing about
        // it, a shop behind on its messages, a guardrail crossed, tomorrow's
        // starts and ends. Beside the applier because it reads what the
        // applier writes. See `postgres::marketing_watch` and `0386`.
        jobs::spawn(db.clone(), MARKETING, marketing_pass);
    }
}

// ---------------------------------------------------------------------------
// Head office's periodic jobs (0703)
// ---------------------------------------------------------------------------
//
// Each job is a name, a label, how often, and a pass: the body of what used to
// be its own `tokio::spawn` loop, now handed a `Pass` to say what it did and
// what it could not do. Scheduling, pausing, "run now", the lock, the retries
// and the record are `cloud::jobs`'s. The log lines stay: the rows are for the
// System screen, the log for the engineer behind it.

const MINUTE: std::time::Duration = std::time::Duration::from_secs(60);
const HOUR: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Tell head office about shop servers that have gone quiet, and keep the
/// fleet status page's colours and incidents up to date.
///
/// A node that is unwell says so in its heartbeat; a node that is off, or cut
/// off, says nothing, and only a clock at the centre can notice that. Once a
/// minute, and once per silence (`postgres::sweep_silent_nodes`). The fleet
/// status page on the same minute: every part's colour and history written
/// down, and its incidents raised, escalated and closed
/// (`postgres::fleet_status`, 0637-0640).
const FLEET_SWEEP: Job = Job {
    key: "fleet.sweep",
    label: "Fleet sweep",
    every: MINUTE,
};

async fn fleet_sweep_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    if let Err(error) = postgres::sweep_silent_nodes(&pool).await {
        tracing::warn!(%error, "silent node sweep failed");
        pass.problem(format!("silent servers: {error}"));
    }
    match postgres::fleet_sweep(&pool).await {
        Ok(report) => {
            let moved = report.opened + report.notified + report.escalated + report.resolved;
            if moved > 0 {
                info!(
                    opened = report.opened,
                    notified = report.notified,
                    escalated = report.escalated,
                    resolved = report.resolved,
                    "fleet incidents moved"
                );
            }
            pass.did(u64::try_from(moved).unwrap_or(0));
        }
        Err(error) => {
            tracing::warn!(%error, "fleet sweep failed");
            pass.problem(format!("fleet status: {error}"));
        }
    }
    pass
}

/// The store exceptions list (0646-0648): every five minutes, read what is
/// wrong in the stores from their data, write down what is new, close what
/// has been fixed, and tell people once about what is red
/// (`postgres::store_exceptions`). A read of the list also sweeps, at most
/// once a minute, without telling anybody.
const EXCEPTIONS: Job = Job {
    key: postgres::JOB_EXCEPTIONS,
    label: "Store exceptions sweep",
    every: std::time::Duration::from_secs(5 * 60),
};

async fn exception_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::exceptions_sweep(&pool, true).await {
        Ok(report) => {
            let moved = report.opened + report.resolved + report.notified;
            if moved > 0 {
                info!(
                    opened = report.opened,
                    resolved = report.resolved,
                    notified = report.notified,
                    "store exceptions moved"
                );
            }
            pass.did(u64::try_from(moved).unwrap_or(0));
            if !report.failed_kinds.is_empty() {
                pass.problem(format!("could not read {}", report.failed_kinds.join(", ")));
            }
        }
        Err(error) => {
            tracing::warn!(%error, "store exceptions sweep failed");
            pass.problem(error.to_string());
        }
    }
    pass
}

/// Keep the fleet's product list up to date.
///
/// Every minute rather than on every change, because "the products changed"
/// has no single moment — a setup mints SKUs, so could an import or a
/// correction — and a catalogue goes out as a whole snapshot to every node.
/// Publishing per change would send a hundred commands to thirty shops for one
/// new shirt; publishing on a timer sends nothing at all when nothing changed.
/// One minute (owner, 26 Sep 2026; it was five): a setup is issued and the
/// handheld at the DC is the next thing asked for the new SKUs. A bench sets
/// CATALOG_PUBLISH_SECONDS=5 and the wait stops being a thing.
fn catalog_job() -> Job {
    let seconds = std::env::var("CATALOG_PUBLISH_SECONDS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(60);
    Job {
        key: "catalog",
        label: "Publish catalogue, payment methods and started promotions",
        every: std::time::Duration::from_secs(seconds),
    }
}

async fn catalog_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::publish_payment_methods_if_changed(&pool, "system:catalog-publisher").await {
        Ok(0) => {}
        Ok(nodes) => {
            info!(%nodes, "sent shop nodes their payment methods");
            pass.did(u64::try_from(nodes).unwrap_or(0));
        }
        Err(error) => {
            tracing::error!(%error, "failed to publish payment methods");
            pass.problem(format!("payment methods: {error}"));
        }
    }
    match postgres::publish_catalog_if_changed(&pool, "system:catalog-publisher").await {
        Ok(Some(generation)) => {
            info!(%generation, "published a new product list to the fleet");
            pass.did(1);
            pass.note("catalog_generation", generation);
        }
        Ok(None) => {}
        Err(error) => {
            tracing::error!(%error, "failed to publish the product list");
            pass.problem(format!("product list: {error}"));
        }
    }
    // On the same tick, and for a related reason: nothing in this estate
    // fires when a timestamp goes by, so a promotion whose window opened at
    // midnight is noticed by a pass rather than by an event. This resolves
    // what such a rule matched and writes it down once. See
    // `postgres::eligibility`.
    match postgres::freeze_started_rule_eligibility(&pool).await {
        Ok(0) => {}
        Ok(frozen) => {
            info!(%frozen, "resolved what newly started promotions match");
            pass.did(u64::try_from(frozen).unwrap_or(0));
        }
        Err(error) => {
            tracing::error!(%error, "failed to resolve promotion eligibility");
            pass.problem(format!("promotion eligibility: {error}"));
        }
    }
    pass
}

/// Notice work that went past its date, and write down lapsed coupons.
///
/// Hourly, which is the right order of magnitude for something measured in
/// days. The pass raises each notice once and is silent on every subsequent
/// tick, so "raised 0" is the healthy state. The coupon holds and codes whose
/// window passed are marked on the same tick: nothing waits on it — an expired
/// hold already stopped counting — it only lets the coupon screens show
/// EXPIRED without computing it per row.
const AGEING: Job = Job {
    key: "ageing",
    label: "Work past its date and lapsed coupons",
    every: HOUR,
};

async fn ageing_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::sweep_ageing_work(&pool).await {
        Ok(0) => {}
        Ok(raised) => {
            info!(%raised, "told head office about work that went past its date");
            pass.did(u64::try_from(raised).unwrap_or(0));
        }
        Err(error) => {
            tracing::error!(%error, "failed to look for work past its date");
            pass.problem(format!("work past its date: {error}"));
        }
    }
    match postgres::expire_lapsed_coupons(&pool).await {
        Ok(expired) => {
            let holds = expired["holds_expired"].as_u64().unwrap_or(0);
            let codes = expired["codes_expired"].as_u64().unwrap_or(0);
            if holds + codes > 0 {
                info!(%expired, "marked lapsed coupon holds and codes expired");
            }
            pass.did(holds + codes);
        }
        Err(error) => {
            tracing::error!(%error, "failed to mark lapsed coupons");
            pass.problem(format!("lapsed coupons: {error}"));
        }
    }
    pass
}

/// The month before today's, as (year, month).
fn previous_month() -> Option<(i32, u32)> {
    let previous = chrono::Utc::now()
        .date_naive()
        .checked_sub_months(chrono::Months::new(1))?;
    Some((
        chrono::Datelike::year(&previous),
        chrono::Datelike::month(&previous),
    ))
}

/// Charge last month's depreciation and replacement reserve, without being
/// asked.
///
/// The arithmetic and the endpoint have been here since 0070 and 0083, and
/// nothing called them except a person opening a screen. A month nobody
/// charges looks exactly like a month in which nothing was due, so the failure
/// is silent. Hourly because the run is cheap when there is nothing to do, and
/// the month charged is always the PREVIOUS one. The run is idempotent by
/// construction (the unique index on asset × month), so twenty-four attempts a
/// day post exactly one month's charge. It never opens a period and never
/// posts into a closed one: a month somebody closed without charging it is a
/// decision, and this is not the thing that should quietly undo it — so that
/// case is written down as a problem for a person, not retried into.
const ASSET_MONTH_END: Job = Job {
    key: "assets.month_end",
    label: "Month-end depreciation and replacement reserve",
    every: HOUR,
};

async fn asset_month_end_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let Some((year, month)) = previous_month() else {
        return pass;
    };
    pass.note("month", format!("{year:04}-{month:02}"));
    // Asked before anything is posted, so an ordinary hour costs one query
    // and writes no run row.
    match postgres::asset_depreciation_status(&pool, year, month).await {
        Ok(status) if status.complete => {}
        Ok(status) if status.period_status.as_deref() == Some("CLOSED") => {
            tracing::warn!(
                %year, %month, missing = status.missing.len(),
                "the month is closed and still owes depreciation; it needs reopening or a \
                 correction, and this agent will not decide which"
            );
            pass.problem(format!(
                "{year:04}-{month:02} is closed and still owes depreciation on {} assets; it \
                 needs a correction in an open month",
                status.missing.len()
            ));
        }
        Ok(_) => {
            match postgres::asset_depreciation_run_month(&pool, year, month, "system:month-end")
                .await
            {
                Ok(run) => {
                    info!(
                        %year, %month, posted = run.posted_count, total = run.posted_total_minor,
                        "charged a month of depreciation"
                    );
                    pass.did(u64::try_from(run.posted_count).unwrap_or(0));
                }
                Err(error) => {
                    tracing::error!(%year,%month,%error,"could not charge the month");
                    pass.problem(format!("depreciation {year:04}-{month:02}: {error}"));
                }
            }
        }
        Err(error) => {
            tracing::error!(%year,%month,%error,"could not read the month's status");
            pass.problem(format!("depreciation status: {error}"));
        }
    }
    match postgres::asset_reserve_status(&pool, year, month).await {
        Ok(status) if status.complete => {}
        Ok(_) => match postgres::asset_reserve_charge(&pool, year, month, "system:month-end").await
        {
            Ok(run) => {
                info!(
                    %year, %month, posted = run.posted_count, total = run.posted_total_minor,
                    "charged a month of replacement reserve"
                );
                pass.did(u64::try_from(run.posted_count).unwrap_or(0));
            }
            Err(error) => {
                tracing::error!(%year,%month,%error,"could not charge the replacement reserve");
                pass.problem(format!("replacement reserve {year:04}-{month:02}: {error}"));
            }
        },
        Err(error) => {
            tracing::error!(%year,%month,%error,"could not read the reserve's status");
            pass.problem(format!("reserve status: {error}"));
        }
    }
    pass
}

/// Spread last month's prepaids onto the months they belong to, without being
/// asked. Hourly, charging the PREVIOUS month, idempotent per (schedule,
/// month) by the allocate's own check. It never opens a period and never posts
/// into a closed one.
const PREPAID_MONTH_END: Job = Job {
    key: "prepaid.month_end",
    label: "Month-end prepaid spreading",
    every: HOUR,
};

async fn prepaid_month_end_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let Some((year, month)) = previous_month() else {
        return pass;
    };
    match postgres::prepaid_allocate(
        &pool,
        &postgres::PrepaidAllocationRequest {
            year,
            month,
            site_id: None,
        },
        "system:month-end",
    )
    .await
    {
        Ok(run) => {
            if run.posted > 0 {
                info!(
                    %year, %month, schedules = run.posted,
                    total = run.amount_minor,
                    "spread a month of prepaids"
                );
                pass.note("month", format!("{year:04}-{month:02}"));
            }
            pass.did(u64::try_from(run.posted).unwrap_or(0));
        }
        Err(error) => {
            tracing::error!(%year,%month,%error,"could not spread the month's prepaids");
            pass.problem(format!("prepaids {year:04}-{month:02}: {error}"));
        }
    }
    pass
}

/// Close each completed trading day into the books without a Finance button.
///
/// The still-trading day is excluded. A prior day's figures are rebuilt from
/// source sales, checked again by `sales_posting_post`, and posted with
/// receivables and cost of sales in one transaction. A day that cannot post
/// stays unposted and the next pass retries it — and is now written down as a
/// problem, with the store and the date, rather than only warned about.
const SALES_ROLLUP: Job = Job {
    key: "sales.rollup",
    label: "Sum sales per store day",
    every: std::time::Duration::from_secs(10),
};

async fn sales_rollup_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::sales_rollup_drain(&pool, std::time::Duration::from_secs(8)).await {
        Ok(drained) => {
            pass.did(drained.days);
            if drained.days > 0 {
                pass.note("rows", drained.rows);
                pass.note("waiting", drained.waiting);
            }
        }
        Err(error) => pass.problem(error.to_string()),
    }
    pass
}

const STORE_STOCK: Job = Job {
    key: "sales.stock",
    label: "Keep store stock per SKU",
    every: std::time::Duration::from_secs(30),
};

async fn store_stock_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::store_stock_refresh(&pool).await {
        Ok(true) => pass.did(1),
        Ok(false) => {}
        Err(error) => pass.problem(error.to_string()),
    }
    pass
}

const SALES_RECONCILE: Job = Job {
    key: "sales.reconcile",
    label: "Check the sales summary against the till",
    every: HOUR,
};

static SALES_RECONCILED_ON: std::sync::Mutex<Option<chrono::NaiveDate>> =
    std::sync::Mutex::new(None);

async fn sales_reconcile_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let today = chrono::Utc::now().date_naive();
    let done = SALES_RECONCILED_ON
        .lock()
        .map(|last| *last == Some(today))
        .unwrap_or(false);
    if done {
        return pass;
    }
    // The last five weeks: today's figures are still arriving, and a month
    // close reads the month before.
    let from = today - chrono::Duration::days(35);
    match postgres::sales_rollup_reconcile(&pool, from, today - chrono::Duration::days(1)).await {
        Ok(drift) => {
            if let Ok(mut last) = SALES_RECONCILED_ON.lock() {
                *last = Some(today);
            }
            pass.note("drifted_days", drift.len());
            if let Some(first) = drift.first() {
                tracing::warn!(
                    days = drift.len(),
                    first_day = %first.business_date,
                    first_site = %first.site_id,
                    "sales summary disagreed with the till; marked for recomputation"
                );
                pass.did(drift.len() as u64);
            }
        }
        Err(error) => pass.problem(error.to_string()),
    }
    pass
}

const SALE_DAY: Job = Job {
    key: "sale_day",
    label: "Post completed sales days",
    every: HOUR,
};

async fn sale_day_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let today = chrono::Utc::now().date_naive();
    let Some(from) = today.checked_sub_days(chrono::Days::new(6)) else {
        return pass;
    };
    // `to` exclusive of today: the day still trading is not missing yet.
    match postgres::sales_posting_generate_days(
        &pool,
        &postgres::GenerateSalesDaysRequest {
            site_id: None,
            from: Some(from),
            to: Some(today),
        },
        "system:sale-day",
    )
    .await
    {
        Ok(raised) => {
            for day in raised.iter().filter(|day| day.outcome == "GENERATED") {
                let Some(posting_id) = day.posting_id else {
                    continue;
                };
                match postgres::sales_posting_post(&pool, posting_id, "system:sale-day").await {
                    Ok(document) => {
                        info!(
                            site = %document.posting.site_id,
                            date = %document.posting.business_date,
                            entry = %document.posting.journal_entry_id.unwrap_or_default(),
                            "automatically posted completed sales day"
                        );
                        pass.did(1);
                    }
                    Err(error) => {
                        tracing::warn!(
                            site = %day.site_id,
                            date = %day.business_date,
                            %error,
                            "sales day awaits correction before it can post"
                        );
                        pass.problem(format!(
                            "{} {} awaits correction: {error}",
                            day.site_id, day.business_date
                        ));
                    }
                }
            }
        }
        Err(error) => {
            tracing::error!(%error,"could not look for unraised days");
            pass.problem(format!("could not look for unraised days: {error}"));
        }
    }
    pass
}

/// Value accepted supplier deliveries, book goods moving between head office
/// and the shops, and post what goods flows held back.
///
/// The net under the sync applier, which values receipt lines the moment they
/// land. This catches what that could not post — a period not yet open, an
/// account the map cannot resolve — and tries it again every minute. What is
/// still waiting is written down as the run's problems, receipt by receipt,
/// so the reason is on the System screen and not only in a log at 02:00. This
/// is also the fleet page's "automatic postings" (`postings` in
/// `job_definition`, formerly `fleet_job_beat`).
const POSTINGS: Job = Job {
    key: postgres::JOB_POSTINGS,
    label: "Automatic postings",
    every: MINUTE,
};

async fn postings_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::receipts_post_pending(&pool, false, "system:goods-receipt").await {
        Ok(sweep) => {
            for posting in &sweep.posted {
                info!(
                    receipt = %posting.receipt_number,
                    entry = %posting.entry_number,
                    "automatically posted accepted goods receipt"
                );
            }
            pass.did(u64::try_from(sweep.posted.len()).unwrap_or(0));
            for (receipt, error) in &sweep.waiting {
                tracing::warn!(
                    %receipt,
                    %error,
                    "goods receipt awaits correction before it can post"
                );
                pass.problem(format!(
                    "goods receipt {receipt} awaits correction: {error}"
                ));
            }
        }
        Err(error) => {
            tracing::error!(%error, "could not find goods receipts awaiting posting");
            pass.problem(format!("goods receipts: {error}"));
        }
    }
    // Goods moving between head office and the shops, booked in both books at
    // SJD dispatch and at receipt (client accountant, 25 Sep).
    match postgres::stock_transfer_post_pending(&pool, "system:stock-transfer").await {
        Ok(0) => {}
        Ok(booked) => {
            info!(booked, "booked allotment dispatches and receipts");
            pass.did(u64::try_from(booked).unwrap_or(0));
        }
        Err(error) => {
            tracing::warn!(%error, "allotment transfers await correction");
            pass.problem(format!("allotment transfers await correction: {error}"));
        }
    }
    // What goods flows could not post when their stage was done: inter-unit
    // goods and supplier returns, in meanings (`flow_stages`).
    match postgres::flow_stages::post_pending_flow_postings(&pool, "system:flow-posting").await {
        Ok(0) => {}
        Ok(posted) => {
            info!(posted, "posted goods-flow meanings");
            pass.did(u64::try_from(posted).unwrap_or(0));
        }
        Err(error) => {
            tracing::warn!(%error, "goods-flow postings await correction");
            pass.problem(format!("flow postings: {error}"));
        }
    }
    pass
}

/// Raise the recurring bills whose day has come, without being asked. One
/// sweep an hour; `bill_template_run` keeps it to one draft per template per
/// period however often it runs. The drafts wait for a person exactly as a
/// typed draft does.
const RECURRING_BILLS: Job = Job {
    key: "recurring_bills",
    label: "Recurring bills",
    every: HOUR,
};

async fn recurring_bills_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::bill_template_sweep(
        &pool,
        chrono::Utc::now().date_naive(),
        "system:recurring-bills",
    )
    .await
    {
        Ok(sweep) => {
            if sweep.raised > 0 {
                info!(
                    raised = sweep.raised,
                    "raised the recurring bills that were due"
                );
            }
            pass.did(u64::try_from(sweep.raised).unwrap_or(0));
        }
        Err(error) => {
            tracing::error!(%error, "could not raise recurring bills");
            pass.problem(error.to_string());
        }
    }
    pass
}

/// Raise the repeating BKKs and BKMs that are due (0716). Drafts only.
const CASH_REPEAT: Job = Job {
    key: "cash_repeat",
    label: "Repeating BKK/BKM",
    every: HOUR,
};

async fn cash_repeat_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::run_cash_document_repeats(
        &pool,
        chrono::Utc::now().date_naive(),
        "system:cash-repeat",
    )
    .await
    {
        Ok(sweep) => {
            if sweep.drafted > 0 || !sweep.failed.is_empty() {
                info!(
                    drafted = sweep.drafted,
                    failed = sweep.failed.len(),
                    "raised the repeating BKK/BKM that were due"
                );
            }
            pass.did(u64::try_from(sweep.drafted).unwrap_or(0));
            for failure in &sweep.failed {
                pass.problem(failure.clone());
            }
        }
        Err(error) => {
            tracing::error!(%error, "could not raise repeating BKK/BKM");
            pass.problem(error.to_string());
        }
    }
    pass
}

/// Raise the repeating journals that are due (ERPNext Auto Repeat, 0473).
const JOURNAL_REPEAT: Job = Job {
    key: "journal_repeat",
    label: "Repeating journals",
    every: HOUR,
};

async fn journal_repeat_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::run_journal_repeats(
        &pool,
        chrono::Utc::now().date_naive(),
        "system:journal-repeat",
    )
    .await
    {
        Ok(sweep) => {
            if sweep.drafted + sweep.posted > 0 || !sweep.failed.is_empty() {
                info!(
                    drafted = sweep.drafted,
                    posted = sweep.posted,
                    failed = sweep.failed.len(),
                    "raised the repeating journals that were due"
                );
            }
            pass.did(u64::try_from(sweep.drafted + sweep.posted).unwrap_or(0));
            for failure in &sweep.failed {
                pass.problem(failure.clone());
            }
        }
        Err(error) => {
            tracing::error!(%error, "could not raise repeating journals");
            pass.problem(error.to_string());
        }
    }
    pass
}

/// Ask the control equations once a day, and leave the answers waiting.
///
/// The date asked about is yesterday: a whole day, closed, and the same date
/// whichever hour the run starts. Hourly passes with a date guard rather than
/// a daily interval, so a process restarted at eight in the morning does not
/// wait until the next morning. A day that failed is not recorded as asked, so
/// it is asked again on the next pass rather than skipped.
const INTEGRITY: Job = Job {
    key: "integrity",
    label: "Control equations",
    every: HOUR,
};

static INTEGRITY_LAST_ASKED: std::sync::Mutex<Option<chrono::NaiveDate>> =
    std::sync::Mutex::new(None);

async fn integrity_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let as_of = chrono::Utc::now().date_naive() - chrono::Duration::days(1);
    let asked = INTEGRITY_LAST_ASKED
        .lock()
        .map(|last| *last == Some(as_of))
        .unwrap_or(false);
    if asked {
        return pass;
    }
    match postgres::integrity_run_now(&pool, as_of, "SCHEDULED", "system:integrity").await {
        Ok(run) => {
            if let Ok(mut last) = INTEGRITY_LAST_ASKED.lock() {
                *last = Some(as_of);
            }
            info!(
                %as_of,
                worst = run.worst_state.as_deref().unwrap_or("UNKNOWN"),
                open_items = run.open_items,
                "asked the control equations"
            );
            pass.did(1);
            pass.note("as_of", as_of);
            pass.note("worst", run.worst_state.as_deref().unwrap_or("UNKNOWN"));
            pass.note("open_items", run.open_items);
        }
        Err(error) => {
            tracing::error!(%as_of,%error,"the integrity run failed");
            pass.problem(format!("control equations for {as_of}: {error}"));
        }
    }
    pass
}

/// Keep the Inventory Control screen's answer written down (0949).
///
/// The screen asks whether the ledger and what is drawn from it still agree,
/// and the honest answer folds every movement fact against the projection —
/// a minute on the load estate's 8.8 million facts, on every open, for
/// numbers that describe the estate's integrity and change when the ledger
/// changes, not when the page is opened. This pass recomputes the
/// whole-ledger answer on a connection of its own, the statement clock off
/// (`SET LOCAL statement_timeout = 0`: the fold may outlast the database's
/// two minutes on two vCPUs), and upserts the one row the route reads.
/// Fifteen minutes — four folds an hour is a few percent of the estate, and
/// `computed_at` beside the numbers says how old they are.
const CONTROL_STATE: Job = Job {
    key: "inventory.control",
    label: "Keep the control screen's answer",
    every: std::time::Duration::from_secs(15 * 60),
};

async fn control_state_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    match postgres::refresh_control_state(&pool).await {
        Ok(status) => {
            pass.did(1);
            pass.note("ledger_health", status.ledger_health);
        }
        Err(error) => pass.problem(error.to_string()),
    }
    pass
}

/// Re-derive who signs in at which server, and renew the servers' auth leases.
///
/// Every five minutes: besides renewing leases, this is what tells a server
/// whose sign-in list changed without anybody publishing it — a role's reach
/// edited, a publication that failed (0635).
const AUTH_POLICY: Job = Job {
    key: "auth_policy",
    label: "Server sign-in lists and auth leases",
    every: std::time::Duration::from_secs(5 * 60),
};

async fn auth_policy_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    if let Err(error) = postgres::reconcile_node_access(&pool, None, "system:node-access").await {
        tracing::error!(%error, "failed to re-derive who signs in at which server");
        pass.problem(format!("who signs in where: {error}"));
    }
    match postgres::due_auth_policy_origins(&pool).await {
        Ok(origins) => {
            for origin_id in origins {
                match postgres::publish_auth_policy(&pool, &origin_id, "system:auth-lease-renewal")
                    .await
                {
                    Ok(_) => pass.did(1),
                    Err(error) => {
                        tracing::error!(%origin_id,%error,"failed to refresh Edge auth policy");
                        pass.problem(format!("auth lease for {origin_id}: {error}"));
                    }
                }
            }
        }
        Err(error) => {
            tracing::error!(%error,"failed to inspect Edge auth policy leases");
            pass.problem(format!("auth leases: {error}"));
        }
    }
    pass
}

/// Today at head office, by the zone its `site` row keeps (0603).
///
/// The schedulers below run for the whole company, so they keep head office's
/// calendar. A pass that cannot ask the database uses the fallback zone rather
/// than skipping: every job it drives is claimed once per day in
/// `scheduled_job_run`, so a wrong-by-an-hour guess costs nothing twice.
async fn head_office_today(pool: &sqlx::PgPool) -> chrono::NaiveDate {
    match postgres::sites::business_utc_offset_minutes(pool, None, chrono::Utc::now()).await {
        Ok(offset) => inventory_backend::reporting::local_today_at(offset),
        Err(error) => {
            tracing::warn!(%error, "head office's clock unreadable; using the fallback zone");
            inventory_backend::reporting::local_today()
        }
    }
}

/// The clock's HR pass: the accrual a policy has earned, the carry-forward a
/// cap put a deadline on, next week's roster carried from this week's plan,
/// and the nudges.
///
/// Hourly; the claim ledger makes the extra passes cheap. Every sub-job is
/// caught: one refused accrual must not stop the roster being carried, and
/// each writes its own outcome to `scheduled_job_run` as well.
const HR: Job = Job {
    key: "hr",
    label: "HR scheduler",
    every: HOUR,
};

async fn hr_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let today = head_office_today(&pool).await;
    let results = inventory_backend::cloud::postgres::run_all(&pool, today).await;
    for result in &results {
        match result.status.as_str() {
            "RAN" => {
                info!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "HR scheduler job ran"
                );
                pass.did(1);
            }
            "FAILED" => {
                tracing::error!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "HR scheduler job failed"
                );
                pass.problem(format!("{}: {}", result.job, result.detail));
            }
            _ => {}
        }
    }
    pass
}

/// The reminder pass: GA contracts inside their own reminder window, filed
/// papers about to expire, supplier bills due this week, tax months near their
/// deadline. Hourly, with the HR scheduler's business day; every notice is
/// claimed once per (subject, date, band) in `scheduled_job_run`.
const REMINDERS: Job = Job {
    key: "reminders",
    label: "Reminders",
    every: HOUR,
};

async fn reminder_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let today = head_office_today(&pool).await;
    for result in postgres::run_reminders(&pool, today).await {
        let raised = result.detail["raised"].as_u64().unwrap_or(0);
        match result.status.as_str() {
            "FAILED" => {
                tracing::error!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "reminder job failed"
                );
                pass.problem(format!("{}: {}", result.job, result.detail));
            }
            _ if raised > 0 => {
                info!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "reminder job raised notices"
                );
                pass.did(raised);
            }
            _ => {}
        }
    }
    pass
}

/// The marketing pass, every minute: a price book a shop could not apply this
/// morning is a wrong price at a counter this afternoon. Every notice is
/// claimed once in `scheduled_job_run`. Guardrails are measured every fifth
/// pass — measuring a campaign reads its takings, which is worth doing often
/// but not constantly.
const MARKETING: Job = Job {
    key: "marketing",
    label: "Marketing watch",
    every: MINUTE,
};

static MARKETING_PASSES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

async fn marketing_pass(pool: sqlx::PgPool, mut pass: Pass) -> Pass {
    let today = head_office_today(&pool).await;
    let sweep_guardrails =
        MARKETING_PASSES.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 5 == 0;
    for result in
        postgres::run_marketing_watch(&pool, chrono::Utc::now(), today, sweep_guardrails).await
    {
        let raised = result.detail["raised"].as_u64().unwrap_or(0);
        match result.status.as_str() {
            "FAILED" => {
                tracing::error!(
                    job = %result.job,
                    detail = %result.detail,
                    "marketing job failed"
                );
                pass.problem(format!("{}: {}", result.job, result.detail));
            }
            _ if raised > 0 => {
                info!(
                    job = %result.job,
                    detail = %result.detail,
                    "marketing job raised notices"
                );
                pass.did(raised);
            }
            _ => {}
        }
    }
    pass
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
