use inventory_backend::cloud::application::sync as sync_agent;
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
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;
    postgres::MIGRATOR.run(&pool).await?;
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
    tokio::spawn(run_auth_policy_refresh_agent(state.db.clone()));
    tokio::spawn(run_catalog_publisher(state.db.clone()));
    tokio::spawn(run_ageing_work_agent(state.db.clone()));
    if state.config.finance_automation_enabled {
        tokio::spawn(run_asset_month_end_agent(state.db.clone()));
        tokio::spawn(run_prepaid_month_end_agent(state.db.clone()));
        info!("asset and prepaid month-end posting enabled");
    } else {
        info!(
            "asset and prepaid month-end posting disabled; event-driven Finance posting remains active"
        );
    }
    tokio::spawn(run_sale_day_agent(state.db.clone()));
    tokio::spawn(run_goods_receipt_posting_agent(state.db.clone()));
    tokio::spawn(run_bill_template_agent(state.db.clone()));
    tokio::spawn(run_integrity_agent(state.db.clone()));
    // The clock's own HR work: the accrual a policy has earned, the
    // carry-forward a cap put a deadline on, next week's roster carried from
    // this week's plan, and the nudges. See `postgres::schedule` and `0363`.
    tokio::spawn(run_hr_scheduler(state.db.clone()));
    if state.config.sync_apply_enabled {
        tokio::spawn(sync_agent::run_apply_agent(state.clone()));
    }
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

/// Keep the fleet's product list up to date.
///
/// Every few minutes rather than on every change, because "the products
/// changed" has no single moment — a setup mints SKUs, so could an import or a
/// correction — and a catalogue goes out as a whole snapshot to every node.
/// Publishing per change would send a hundred commands to thirty shops for one
/// new shirt; publishing on a timer sends nothing at all when nothing changed.
///
/// A few minutes of delay costs a shop nothing it can feel: the till prices
/// from the price book, not from this list, so a garment that arrives before
/// its name does can still be sold. What waits is the catalogue screen.
async fn run_catalog_publisher(pool: sqlx::PgPool) {
    // Five minutes is the shop's number, not the bench's.
    //
    // On a rig somebody is minting products by hand, the wait is the whole
    // experience: a setup is issued, the handheld is asked for a catalogue, and
    // the honest answer for up to five minutes is the list from before. That
    // reads as a broken sync rather than as a timer, and the next thing anybody
    // does is restart something.
    //
    // The default is unchanged, so no deployment moves by reading this. A bench
    // sets CATALOG_PUBLISH_SECONDS=5 and the wait stops being a thing.
    let seconds = std::env::var("CATALOG_PUBLISH_SECONDS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(5 * 60);
    info!(%seconds, "catalogue publisher interval");
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(seconds));
    loop {
        interval.tick().await;
        match postgres::publish_catalog_if_changed(&pool, "system:catalog-publisher").await {
            Ok(Some(generation)) => {
                info!(%generation, "published a new product list to the fleet");
            }
            Ok(None) => {}
            Err(error) => tracing::error!(%error, "failed to publish the product list"),
        }
        // On the same tick, and for a related reason: nothing in this estate
        // fires when a timestamp goes by, so a promotion whose window opened at
        // midnight is noticed by a pass rather than by an event. This resolves
        // what such a rule matched and writes it down once. See
        // `postgres::eligibility`.
        match postgres::freeze_started_rule_eligibility(&pool).await {
            Ok(0) => {}
            Ok(frozen) => info!(%frozen, "resolved what newly started promotions match"),
            Err(error) => tracing::error!(%error, "failed to resolve promotion eligibility"),
        }
    }
}

/// Notice work that went past its date.
///
/// Hourly, which is the right order of magnitude for something measured in
/// days: a notification that an asset has been unassessed for a week does not
/// become more useful for arriving at 09:00 instead of 09:47, and a tighter
/// loop would spend fourteen queries an hour finding nothing. The pass raises
/// each notice once and is silent on every subsequent tick, so "raised 0" is
/// the healthy state and worth no log line at all.
async fn run_ageing_work_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        match postgres::sweep_ageing_work(&pool).await {
            Ok(0) => {}
            Ok(raised) => info!(%raised, "told head office about work that went past its date"),
            Err(error) => tracing::error!(%error, "failed to look for work past its date"),
        }
    }
}

/// Charge last month's depreciation and replacement reserve, without being
/// asked.
///
/// # Why this exists at all
///
/// The arithmetic and the endpoint have been here since 0070 and 0083, and
/// nothing has ever called them except a person opening a screen and the seed
/// script running four months once. A month nobody charges looks exactly like a
/// month in which nothing was due — there is no row either way — so the failure
/// is silent, and it surfaces as a profit and loss with no depreciation in it or
/// as a disposal refused four months later because the run "still owes a
/// charge".
///
/// # Why hourly, and why it charges the month that just ended
///
/// Hourly because the run is cheap when there is nothing to do — one query
/// against the register — and because a node restarted on the 1st should not
/// wait a day. The month charged is always the PREVIOUS one: charging the month
/// in progress would post a full month of depreciation on the 3rd.
///
/// The run is idempotent by construction, so twenty-four attempts a day post
/// exactly one month's charge. That is the property that makes a schedule this
/// crude safe, and it is not incidental — it is the unique index on (asset,
/// month) and the one on (class, location, month) doing their job.
///
/// # What it will not do
///
/// It never opens a period and never posts into a closed one: the trigger on
/// the journal refuses that, and the refusal is recorded in the run log rather
/// than retried. A month somebody closed without charging it is a decision, and
/// this is not the thing that should quietly undo it.

/// Spread last month's prepaids onto the months they belong to, without being
/// asked.
///
/// The defer engine (`prepaid.rs`) has been the whole mechanism since 0309 --
/// schedules, a one-click allocate, reconciliation -- and nothing has ever
/// called the allocate except a person opening a screen. A month nobody
/// spreads looks exactly like a month in which nothing was amortising: the
/// liability just sits there and the expense lands late, which is the same
/// silent failure the depreciation agent above exists for.
///
/// Hourly, charging the PREVIOUS month, idempotent per (schedule, month) by
/// the allocate's own EXISTS check -- twenty-four attempts a day move exactly
/// one month of each schedule. It never opens a period and never posts into a
/// closed one; the refusal is logged, not retried, because a closed month
/// that still owes a spread is a decision somebody made.
async fn run_prepaid_month_end_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        let Some(previous) = chrono::Utc::now()
            .date_naive()
            .checked_sub_months(chrono::Months::new(1))
        else {
            continue;
        };
        let (year, month) = (
            chrono::Datelike::year(&previous),
            chrono::Datelike::month(&previous),
        );
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
            Ok(run) if run.posted > 0 => info!(
                %year, %month, schedules = run.posted,
                total = run.amount_minor,
                "spread a month of prepaids"
            ),
            Ok(_) => {}
            Err(error) => {
                tracing::error!(%year,%month,%error,"could not spread the month's prepaids")
            }
        }
    }
}

/// Close each completed trading day into the books without a Finance button.
///
/// The still-trading day is excluded. A prior day's figures are rebuilt from
/// source sales, checked again by `sales_posting_post`, and posted with
/// receivables and cost of sales in one transaction. If the source changed or
/// cannot resolve, the day remains unposted and the next sweep retries it.
///
/// Hourly because the sweep is one query against the sales tables, and
/// because a node restarted at noon should not wait a day to notice the
/// morning is missing from the desk.
async fn run_sale_day_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        let today = chrono::Utc::now().date_naive();
        let Some(from) = today.checked_sub_days(chrono::Days::new(6)) else {
            continue;
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
                        Ok(document) => info!(
                            site = %document.posting.site_id,
                            date = %document.posting.business_date,
                            entry = %document.posting.journal_entry_id.unwrap_or_default(),
                            "automatically posted completed sales day"
                        ),
                        Err(error) => tracing::warn!(
                            site = %day.site_id,
                            date = %day.business_date,
                            %error,
                            "sales day awaits correction before it can post"
                        ),
                    }
                }
            }
            Err(error) => tracing::error!(%error,"could not look for unraised days"),
        }
    }
}

/// Value accepted supplier deliveries automatically at their ordered price.
///
/// A failed receipt stays in the awaiting-posting list and is retried on the
/// next sweep. The list is bounded so a backlog drains steadily.
async fn run_goods_receipt_posting_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        match postgres::receipts_awaiting_posting(&pool, 200).await {
            Ok(receipts) => {
                for receipt in receipts {
                    match postgres::receipt_post(
                        &pool,
                        receipt.receipt_id,
                        None,
                        "system:goods-receipt",
                    )
                    .await
                    {
                        Ok(posting) => info!(
                            receipt = %posting.receipt_number,
                            entry = %posting.entry_number,
                            "automatically posted accepted goods receipt"
                        ),
                        Err(error) => tracing::warn!(
                            receipt = %receipt.receipt_number,
                            %error,
                            "goods receipt awaits correction before it can post"
                        ),
                    }
                }
            }
            Err(error) => tracing::error!(%error, "could not find goods receipts awaiting posting"),
        }
        // Goods moving between head office and the shops, booked in both
        // books at SJD dispatch and at receipt (client accountant, 25 Sep).
        match postgres::stock_transfer_post_pending(&pool, "system:stock-transfer").await {
            Ok(0) => {}
            Ok(booked) => info!(booked, "booked allotment dispatches and receipts"),
            Err(error) => tracing::warn!(%error, "allotment transfers await correction"),
        }
    }
}

/// Raise the recurring bills whose day has come, without being asked.
///
/// One sweep an hour against a table of promises; `bill_template_run` keeps
/// it to one draft per template per period however often it runs. The drafts
/// wait for a person exactly as a typed draft does -- see `bill_template.rs`
/// for why this agent stops at raising.
async fn run_bill_template_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        match postgres::bill_template_sweep(
            &pool,
            chrono::Utc::now().date_naive(),
            "system:recurring-bills",
        )
        .await
        {
            Ok(sweep) if sweep.raised > 0 => info!(
                raised = sweep.raised,
                "raised the recurring bills that were due"
            ),
            Ok(_) => {}
            Err(error) => tracing::error!(%error, "could not raise recurring bills"),
        }
    }
}

async fn run_asset_month_end_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        let Some(previous) = chrono::Utc::now()
            .date_naive()
            .checked_sub_months(chrono::Months::new(1))
        else {
            continue;
        };
        let (year, month) = (
            chrono::Datelike::year(&previous),
            chrono::Datelike::month(&previous),
        );

        // Asked before anything is posted, so an ordinary hour of an ordinary
        // day costs one query and writes no run row. Without this the log would
        // fill with twenty-four "nothing was due" rows a day and the one row
        // that mattered would be unfindable.
        match postgres::asset_depreciation_status(&pool, year, month).await {
            Ok(status) if status.complete => {}
            Ok(status) if status.period_status.as_deref() == Some("CLOSED") => {
                tracing::warn!(
                    %year, %month, missing = status.missing.len(),
                    "the month is closed and still owes depreciation; it needs reopening or a \
                     correction, and this agent will not decide which"
                );
            }
            Ok(_) => {
                match postgres::asset_depreciation_run_month(&pool, year, month, "system:month-end")
                    .await
                {
                    Ok(run) => info!(
                        %year, %month, posted = run.posted_count, total = run.posted_total_minor,
                        "charged a month of depreciation"
                    ),
                    Err(error) => {
                        tracing::error!(%year,%month,%error,"could not charge the month")
                    }
                }
            }
            Err(error) => tracing::error!(%year,%month,%error,"could not read the month's status"),
        }

        match postgres::asset_reserve_status(&pool, year, month).await {
            Ok(status) if status.complete => {}
            Ok(_) => {
                match postgres::asset_reserve_charge(&pool, year, month, "system:month-end").await {
                    Ok(run) => info!(
                        %year, %month, posted = run.posted_count, total = run.posted_total_minor,
                        "charged a month of replacement reserve"
                    ),
                    Err(error) => {
                        tracing::error!(%year,%month,%error,"could not charge the replacement reserve")
                    }
                }
            }
            Err(error) => {
                tracing::error!(%year,%month,%error,"could not read the reserve's status")
            }
        }
    }
}

/// Ask the ten control equations once a day, and leave the answers waiting.
///
/// Daily rather than on every posting, for the reason the catalogue publisher
/// runs on a timer: "the books changed" has no single moment, and an equation
/// that ran on every journal line would spend the day telling somebody that a
/// bill posted at ten is not yet paid. What people want is one answer per day
/// that they can trust, found before they arrive.
///
/// The date asked about is yesterday, not today. A run at three in the morning
/// asking about today would be asking about a day with four hours in it, and
/// would report every unposted document as an exception every night. Yesterday
/// is a whole day, closed, and the same date whichever hour the run happens to
/// start — which also makes two runs of the same night comparable.
///
/// Hourly ticks with a date guard rather than an interval of a day, because a
/// process restarted at eight in the morning would otherwise wait until eight
/// the next morning to ask anything, and a deploy would silently cost a night.
async fn run_integrity_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    let mut last_asked: Option<chrono::NaiveDate> = None;
    loop {
        interval.tick().await;
        let as_of = chrono::Utc::now().date_naive() - chrono::Duration::days(1);
        if last_asked == Some(as_of) {
            continue;
        }
        match postgres::integrity_run_now(&pool, as_of, "SCHEDULED", "system:integrity").await {
            Ok(run) => {
                last_asked = Some(as_of);
                info!(
                    %as_of,
                    worst = run.worst_state.as_deref().unwrap_or("UNKNOWN"),
                    open_items = run.open_items,
                    "asked the control equations"
                );
            }
            // Not recording `last_asked`, so a database that was briefly
            // unreachable is asked again on the next tick rather than skipped
            // for the day.
            Err(error) => tracing::error!(%as_of,%error,"the integrity run failed"),
        }
    }
}

async fn run_auth_policy_refresh_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 60 * 60));
    loop {
        interval.tick().await;
        match postgres::due_auth_policy_origins(&pool).await {
            Ok(origins) => {
                for origin_id in origins {
                    if let Err(error) = postgres::publish_auth_policy(
                        &pool,
                        &origin_id,
                        "system:auth-lease-renewal",
                    )
                    .await
                    {
                        tracing::error!(%origin_id,%error,"failed to refresh Edge auth policy");
                    }
                }
            }
            Err(error) => tracing::error!(%error,"failed to inspect Edge auth policy leases"),
        }
    }
}

/// The clock's HR pass.
///
/// Hourly rather than daily, for the reason the integrity agent gives: a
/// process restarted at eight in the morning must not wait until tomorrow to
/// notice that a policy has earned days. The claim ledger makes the extra ticks
/// cheap — a month already accrued is one `INSERT` that changes nothing — and
/// the delta arithmetic in `domain::schedule` makes a missed tick self-healing
/// rather than a lost month.
///
/// Every job is caught: one refused accrual must not stop the roster being
/// carried or the nudges being raised, and each job writes its own outcome to
/// `scheduled_job_run` so the screen can show a failure nobody watched happen.
async fn run_hr_scheduler(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    info!("HR scheduler started: accrual, expiry, roster carry, nudges");
    loop {
        interval.tick().await;
        let today = inventory_backend::reporting::local_today();
        let results = inventory_backend::cloud::postgres::run_all(&pool, today).await;
        for result in &results {
            match result.status.as_str() {
                "RAN" => info!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "HR scheduler job ran"
                ),
                "FAILED" => tracing::error!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "HR scheduler job failed"
                ),
                _ => {}
            }
        }
    }
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
