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
    tokio::spawn(run_silent_node_sweep(state.db.clone()));
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
    tokio::spawn(run_journal_repeat_agent(state.db.clone()));
    tokio::spawn(run_integrity_agent(state.db.clone()));
    // The clock's own HR work: the accrual a policy has earned, the
    // carry-forward a cap put a deadline on, next week's roster carried from
    // this week's plan, and the nudges. See `postgres::schedule` and `0363`.
    tokio::spawn(run_hr_scheduler(state.db.clone()));
    // The same clock, telling head office what is about to lapse: GA
    // contracts, filed papers, supplier bills, tax months. See
    // `postgres::reminders` and `0383`.
    tokio::spawn(run_reminder_scheduler(state.db.clone()));
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
        tokio::spawn(run_marketing_scheduler(state.db.clone()));
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
/// A minute of delay costs a shop nothing it can feel: the till prices from the
/// price book, not from this list, so a garment that arrives before its name
/// does can still be sold. What waits is the catalogue screen.
/// Tell head office about shop servers that have gone quiet.
///
/// A node that is unwell says so in its heartbeat; a node that is off, or cut
/// off, says nothing, and only a clock at the centre can notice that. Once a
/// minute, and once per silence (`postgres::sweep_silent_nodes`).
async fn run_silent_node_sweep(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(error) = postgres::sweep_silent_nodes(&pool).await {
            tracing::warn!(%error, "silent node sweep failed");
        }
        // The fleet status page on the same minute: every part's colour and
        // history written down, and its incidents raised, escalated and
        // closed (`postgres::fleet_status`, 0637-0640).
        match postgres::fleet_sweep(&pool).await {
            Ok(report) if report.opened + report.notified + report.escalated + report.resolved > 0 => {
                info!(
                    opened = report.opened,
                    notified = report.notified,
                    escalated = report.escalated,
                    resolved = report.resolved,
                    "fleet incidents moved"
                )
            }
            Ok(_) => {}
            Err(error) => tracing::warn!(%error, "fleet sweep failed"),
        }
    }
}

async fn run_catalog_publisher(pool: sqlx::PgPool) {
    // One minute (owner, 26 Sep 2026; it was five). A setup is issued and the
    // handheld at the DC is the next thing asked for the new SKUs; five minutes
    // of the list from before read as a broken sync rather than as a timer.
    // A tick that finds nothing changed sends nothing, so the shorter timer
    // costs a query, not a broadcast.
    //
    // A bench sets CATALOG_PUBLISH_SECONDS=5 and the wait stops being a thing.
    let seconds = std::env::var("CATALOG_PUBLISH_SECONDS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(60);
    info!(%seconds, "catalogue publisher interval");
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(seconds));
    loop {
        interval.tick().await;
        match postgres::publish_payment_methods_if_changed(&pool, "system:catalog-publisher").await {
            Ok(0) => {}
            Ok(nodes) => info!(%nodes, "sent shop nodes their payment methods"),
            Err(error) => tracing::error!(%error, "failed to publish payment methods"),
        }
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
        // On the same tick: write down the coupon holds and codes whose window
        // passed. Nothing waits on this -- an expired hold already stopped
        // counting and a lapsed code is already refused -- it only lets the
        // coupon screens show EXPIRED without computing it per row. Until now
        // it ran only when somebody pressed the button.
        match postgres::expire_lapsed_coupons(&pool).await {
            Ok(expired)
                if expired["holds_expired"].as_u64().unwrap_or(0) > 0
                    || expired["codes_expired"].as_u64().unwrap_or(0) > 0 =>
            {
                info!(%expired, "marked lapsed coupon holds and codes expired")
            }
            Ok(_) => {}
            Err(error) => tracing::error!(%error, "failed to mark lapsed coupons"),
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
/// The net under the sync applier, which values receipt lines the moment they
/// land (`application::sync::run_apply_agent`). This catches what that could
/// not post — a period not yet open, an account the map cannot resolve — and
/// tries it again every minute, so the debt appears as soon as the obstacle is
/// gone rather than at the top of the next hour.
async fn run_goods_receipt_posting_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;
        // The fleet page's "automatic postings": this pass ran, and whether
        // any part of it could not even look (`fleet_job_beat`, 0640).
        let mut failed: Option<String> = None;
        match postgres::receipts_post_pending(&pool, false, "system:goods-receipt").await {
            Ok(sweep) => {
                for posting in &sweep.posted {
                    info!(
                        receipt = %posting.receipt_number,
                        entry = %posting.entry_number,
                        "automatically posted accepted goods receipt"
                    );
                }
                for (receipt, error) in &sweep.waiting {
                    tracing::warn!(
                        %receipt,
                        %error,
                        "goods receipt awaits correction before it can post"
                    );
                }
            }
            Err(error) => {
                tracing::error!(%error, "could not find goods receipts awaiting posting");
                failed = Some(format!("goods receipts: {error}"));
            }
        }
        // Goods moving between head office and the shops, booked in both
        // books at SJD dispatch and at receipt (client accountant, 25 Sep).
        match postgres::stock_transfer_post_pending(&pool, "system:stock-transfer").await {
            Ok(0) => {}
            Ok(booked) => info!(booked, "booked allotment dispatches and receipts"),
            Err(error) => tracing::warn!(%error, "allotment transfers await correction"),
        }
        // What goods flows could not post when their stage was done: inter-unit
        // goods and supplier returns, in meanings (`flow_stages`).
        match postgres::flow_stages::post_pending_flow_postings(&pool, "system:flow-posting").await
        {
            Ok(0) => {}
            Ok(posted) => info!(posted, "posted goods-flow meanings"),
            Err(error) => {
                tracing::warn!(%error, "goods-flow postings await correction");
                failed.get_or_insert(format!("flow postings: {error}"));
            }
        }
        postgres::fleet_job_beat(&pool, postgres::JOB_POSTINGS, failed.as_deref()).await;
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

/// Raise the repeating journals that are due (ERPNext Auto Repeat, 0473).
async fn run_journal_repeat_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        match postgres::run_journal_repeats(
            &pool,
            chrono::Utc::now().date_naive(),
            "system:journal-repeat",
        )
        .await
        {
            Ok(sweep) if sweep.drafted + sweep.posted > 0 || !sweep.failed.is_empty() => info!(
                drafted = sweep.drafted,
                posted = sweep.posted,
                failed = sweep.failed.len(),
                "raised the repeating journals that were due"
            ),
            Ok(_) => {}
            Err(error) => tracing::error!(%error, "could not raise repeating journals"),
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

/// Today at head office, by the zone its `site` row keeps (0603).
///
/// The schedulers below run for the whole company, so they keep head office's
/// calendar. A tick that cannot ask the database uses the fallback zone rather
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
        let today = head_office_today(&pool).await;
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

/// The reminder pass: GA contracts inside their own reminder window, filed
/// papers about to expire, supplier bills due this week, tax months near their
/// deadline.
///
/// Hourly with the same business day as the HR scheduler, for the same reason:
/// every notice is claimed once per (subject, date, band) in
/// `scheduled_job_run`, so the extra ticks cost a query each and a restarted
/// node loses nothing.
async fn run_reminder_scheduler(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    info!("reminder scheduler started: GA contracts, papers, supplier bills, tax deadlines");
    loop {
        interval.tick().await;
        let today = head_office_today(&pool).await;
        for result in postgres::run_reminders(&pool, today).await {
            match result.status.as_str() {
                "FAILED" => tracing::error!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "reminder job failed"
                ),
                _ if result.detail["raised"].as_u64().unwrap_or(0) > 0 => info!(
                    job = %result.job,
                    %today,
                    detail = %result.detail,
                    "reminder job raised notices"
                ),
                _ => {}
            }
        }
    }
}

/// The marketing pass, every minute.
///
/// A minute rather than the hour the HR and reminder clocks keep, because what
/// it watches goes wrong within the trading day: a price book a shop could not
/// apply this morning is a wrong price at a counter this afternoon. Every
/// notice is claimed once in `scheduled_job_run`, so the extra ticks cost a
/// query each. Guardrails are measured every fifth tick — measuring a campaign
/// reads its takings, which is worth doing often but not constantly.
async fn run_marketing_scheduler(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    let mut tick: u64 = 0;
    info!("marketing scheduler started: rollouts, stale shops, guardrails, tomorrow's calendar");
    loop {
        interval.tick().await;
        let today = head_office_today(&pool).await;
        let sweep_guardrails = tick % 5 == 0;
        tick = tick.wrapping_add(1);
        for result in
            postgres::run_marketing_watch(&pool, chrono::Utc::now(), today, sweep_guardrails).await
        {
            match result.status.as_str() {
                "FAILED" => tracing::error!(
                    job = %result.job,
                    detail = %result.detail,
                    "marketing job failed"
                ),
                _ if result.detail["raised"].as_u64().unwrap_or(0) > 0 => info!(
                    job = %result.job,
                    detail = %result.detail,
                    "marketing job raised notices"
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
