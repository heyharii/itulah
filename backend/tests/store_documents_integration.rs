//! The two documents a shop raises: an instruction, and a deposit.
//!
//! They are tested together because their invariants are two halves of one
//! claim about what a store document may do to the books:
//!
//!   - a **payment instruction** must post NOTHING, ever, at any rung of its
//!     ladder. It is a lifecycle with no accounting consequence, which is the
//!     property that makes it safe to add — and a property nothing enforces
//!     except a test that counts journal entries before and after.
//!   - a **deposit** must post TWICE, on two different dates, into and back out
//!     of an in-transit account. One entry would be the defect it exists to
//!     remove.
//!
//! Everything below runs against a real Postgres, because most of what is being
//! asserted is enforced by 0240 and 0241 rather than by Rust. Several tests
//! reach past the module and read `journal_line` directly: if the guarantee only
//! holds when you go through the front door, it is not a guarantee.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres as cloud;
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SHOP: &str = "store-01";

/// The accounts a deposit touches, and where they come from.
///
/// Nothing is inserted: 0243 seeded the client's whole chart with no unit
/// anywhere, and 0289 replaced it with forty accounts. These are two of them.
/// A test that minted its own would be asserting against a chart nobody has —
/// and would be refused outright, because 0244 pins `ledger_account.site_id` to
/// NULL with a CHECK. The unit is `journal_line.site_id` and nowhere else,
/// which is what `every_posted_line_carries_the_unit` below is really about.
///
/// What DID move is where the third thing lives. A deposit touches a drawer, a
/// bag and a bank; the first two are one account and two categories now.

/// Kas — one account for all four states cash can be in, told apart by `pot`.
/// The drawer and the money in the bag are the SAME account now; the client's
/// `1011001001 CASH ON HAND` and the `1011005001 Setoran Dalam Perjalanan` that
/// `docs/coa-final.md` said we had to add are `1101 × DRAWER` and
/// `1101 × TRANSIT`. One fewer invented account, and one more reason the
/// balance helper below takes a category.
const CASH: &str = "1101";
const DRAWER: &str = "DRAWER";
const TRANSIT: &str = "TRANSIT";
/// `1102 Bank`, where `1011003001 Bank BCA — Tabungan` went. Which bank is
/// `bank_account_id`, so it takes no category.
const BANK: &str = "1102";

async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str, category: Option<&str>) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: SHOP.into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            category_code: category.map(str::to_string),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// Everything a deposit needs pointed at an account.
///
/// Three meanings and two accounts, where it used to be three and three. That
/// matters more than it looks: `deposits::meaning_of` reads the map BACKWARDS —
/// from the account code on the request to the meaning that posts it — and one
/// account carries four pots now. What keeps it exact is the category: the
/// lookup is `(1101, DRAWER)` rather than `1101`, so a seeded database with all
/// four pots mapped answers `cash` and nothing else. Before that the account
/// alone found three meanings and every deposit in the estate was refused.
async fn map_the_three(pool: &PgPool) {
    map(pool, "cash", "", CASH, Some(DRAWER)).await;
    map(pool, "bank_savings", "BCA", BANK, None).await;
    map(pool, "cash_in_transit", "", CASH, Some(TRANSIT)).await;
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

/// How many entries the journal holds. The number this whole file turns on.
async fn entry_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_entry")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("count entries: {error}"))
}

/// What one account at one place holds, summed from the lines.
///
/// Read from `journal_line` directly rather than through any projection: the
/// point of these assertions is where the money IS, not what a reader says
/// about it.
async fn balance(pool: &PgPool, account_code: &str, category: Option<&str>) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
           FROM journal_line l
          WHERE l.account_code = $1 AND l.site_id = $2
            AND ($3::text IS NULL OR l.category_code = $3)",
    )
    .bind(account_code)
    .bind(SHOP)
    .bind(category)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {account_code}: {error}"))
}

fn an_ask() -> cloud::RaiseInstructionRequest {
    cloud::RaiseInstructionRequest {
        site_id: SHOP.into(),
        payee: "Pak Budi — pemilik ruko".into(),
        purpose: "Sewa toko triwulan keempat".into(),
        category: "expense_misc".into(),
        amount_minor: 42_000_000,
        needed_by: Some(september(20)),
        bill_id: None,
        note: String::new(),
        submit: false,
    }
}

fn a_deposit() -> cloud::RecordDepositRequest {
    cloud::RecordDepositRequest {
        site_id: SHOP.into(),
        drawer_account_code: CASH.into(),
        // Which pot, because `1101` holds four and the slip is the only thing
        // that knows which one the bag came out of.
        drawer_category_code: Some(DRAWER.into()),
        bank_account_code: BANK.into(),
        // `1102 Bank` declares no family; naming one here would be refused.
        bank_category_code: None,
        amount_minor: 12_400_000,
        banked_on: september(10),
        carried_by: "Siti".into(),
        slip_reference: String::new(),
        note: String::new(),
        bank_now: false,
    }
}

// ---------------------------------------------------------------------------
// Payment instructions
// ---------------------------------------------------------------------------

/// The claim the whole document rests on, and the only way to prove it.
///
/// ERPNext is explicit that creating a Payment Request posts nothing to the
/// general ledger, and copying that is what makes this document safe to add.
/// Nothing in Rust enforces it — there is simply no call to `post` in the
/// module — so the guard is arithmetic: walk the entire ladder and count the
/// journal before and after.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn no_rung_of_the_ladder_posts_anything(pool: PgPool) {
    open_september(&pool).await;
    let before = entry_count(&pool).await;

    let raised = cloud::raise_instruction(&pool, &an_ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));
    assert_eq!(raised.status, "DRAFT");

    let sent = cloud::submit_instruction(&pool, raised.instruction_id)
        .await
        .unwrap_or_else(|error| panic!("submit: {error}"));
    assert_eq!(sent.status, "REQUESTED");
    assert!(
        sent.submitted_at.is_some(),
        "a sent ask records when it was sent"
    );

    let approved = cloud::decide_instruction(
        &pool,
        raised.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: true,
            reason: "Sudah dicek ke kontrak".into(),
            supplier_id: Some("SUP-RUKO".into()),
            supplier_name: Some("Pak Budi".into()),
        },
        "hari",
    )
    .await
    .unwrap_or_else(|error| panic!("decide: {error}"));
    assert_eq!(approved.status, "APPROVED");
    assert_eq!(approved.supplier_id.as_deref(), Some("SUP-RUKO"));

    assert_eq!(
        entry_count(&pool).await,
        before,
        "an instruction wrote a journal entry. It must not: the accounting \
         happens in the bill and the payment it becomes, both of which have \
         their own rules, their own period gate and their own account map."
    );
}

/// Approving means saying which vendor the payee is.
///
/// The one structural difference from ERPNext worth a test: theirs chooses the
/// party before the document can be saved, ours resolves free text into a
/// vendor as part of saying yes. 0240's CHECK is the guarantee; this is the
/// sentence somebody reads.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn approving_without_resolving_the_payee_is_refused(pool: PgPool) {
    let mut ask = an_ask();
    ask.submit = true;
    let raised = cloud::raise_instruction(&pool, &ask, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));
    assert_eq!(
        raised.status, "REQUESTED",
        "`submit: true` sends it in the same act that writes it"
    );

    let refusal = cloud::decide_instruction(
        &pool,
        raised.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: true,
            reason: String::new(),
            supplier_id: None,
            supplier_name: None,
        },
        "hari",
    )
    .await;

    let message = match refusal {
        Ok(_) => panic!("approved an ask whose payee is still free text"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("vendor") && message.contains("EXPENSE"),
        "the refusal should say what to do about it, said: {message}"
    );
}

/// A refusal the shop cannot read is a refusal they will ask about twice.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_refusal_needs_a_reason_and_an_approval_does_not(pool: PgPool) {
    let mut ask = an_ask();
    ask.submit = true;
    let raised = cloud::raise_instruction(&pool, &ask, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));

    let silent = cloud::decide_instruction(
        &pool,
        raised.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: false,
            reason: "   ".into(),
            supplier_id: None,
            supplier_name: None,
        },
        "hari",
    )
    .await;
    assert!(silent.is_err(), "a no with no reason should be refused");

    let refused = cloud::decide_instruction(
        &pool,
        raised.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: false,
            reason: "Kontraknya belum ditandatangani".into(),
            supplier_id: None,
            supplier_name: None,
        },
        "hari",
    )
    .await
    .unwrap_or_else(|error| panic!("refuse: {error}"));
    assert_eq!(refused.status, "REFUSED");
    assert_eq!(refused.decided_by.as_deref(), Some("hari"));
    assert!(refused.decision_reason.contains("ditandatangani"));

    // REFUSED is ours and is not ERPNext's Cancelled: a decision head office
    // made, and therefore not a rung an ask can be taken back from.
    assert!(
        cloud::withdraw_instruction(&pool, raised.instruction_id)
            .await
            .is_err(),
        "an ask head office has answered cannot be withdrawn"
    );
}

/// PAID is a fact about money, so it takes a payment, and the right one.
///
/// # What this covers, and what it deliberately does not
///
/// It proves the two refusals `settle_instruction` can make without reaching
/// the payment register: an ask that is not APPROVED cannot be settled, and a
/// payment id nothing answers to is a not-found rather than a silent success.
///
/// The third refusal — a payment that exists but is still a DRAFT, which would
/// say money had moved on the strength of a document that is not in the books —
/// is enforced in `settle_instruction` and is NOT exercised here. Building the
/// payment it needs means a bill, an allocation and four more account mappings,
/// and `supplier_payment` was being re-keyed against `account_map` by 0244 in
/// the same hour this was written. A test that fails for somebody else's
/// migration is a test that gets deleted rather than read. It is worth adding
/// back once that lane settles, and the refusal it would check is one `if` in
/// the module.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_an_approved_ask_can_be_settled(pool: PgPool) {
    let mut ask = an_ask();
    ask.submit = true;
    ask.amount_minor = 1_500_000;
    let raised = cloud::raise_instruction(&pool, &ask, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));

    // REQUESTED, not APPROVED: head office has not agreed to pay it yet, so
    // there is nothing for a payment to have settled.
    let early = cloud::settle_instruction(
        &pool,
        raised.instruction_id,
        &cloud::SettleInstructionRequest {
            payment_id: Uuid::new_v4(),
            bill_id: None,
        },
        "hari",
    )
    .await;
    let message = match early {
        Ok(_) => panic!("settled an ask nobody has approved"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("approved"),
        "the refusal should say which rung is missing, said: {message}"
    );

    cloud::decide_instruction(
        &pool,
        raised.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: true,
            reason: String::new(),
            supplier_id: Some("SUP-RUKO".into()),
            supplier_name: Some("Pak Budi".into()),
        },
        "hari",
    )
    .await
    .unwrap_or_else(|error| panic!("decide: {error}"));

    // Approved, and a payment that does not exist. PAID must name something.
    assert!(
        cloud::settle_instruction(
            &pool,
            raised.instruction_id,
            &cloud::SettleInstructionRequest {
                payment_id: Uuid::new_v4(),
                bill_id: None,
            },
            "hari",
        )
        .await
        .is_err(),
        "an instruction cannot be settled by a payment nothing answers to"
    );

    // And it is still APPROVED: a refused settle leaves the ask where it was.
    let after = cloud::instruction(&pool, raised.instruction_id)
        .await
        .unwrap_or_else(|error| panic!("read back: {error}"));
    assert_eq!(after.status, "APPROVED");
    assert!(after.payment_id.is_none());
}

/// The queue's own arithmetic: what is still waiting is not the same figure as
/// what has ever been asked for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_envelope_separates_what_is_open_from_what_is_merely_recorded(pool: PgPool) {
    let mut waiting = an_ask();
    waiting.submit = true;
    waiting.amount_minor = 3_000_000;
    let open = cloud::raise_instruction(&pool, &waiting, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));

    let mut gone = an_ask();
    gone.submit = true;
    gone.amount_minor = 9_000_000;
    let closed = cloud::raise_instruction(&pool, &gone, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));
    cloud::decide_instruction(
        &pool,
        closed.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: false,
            reason: "Bukan tanggungan kantor".into(),
            supplier_id: None,
            supplier_name: None,
        },
        "hari",
    )
    .await
    .unwrap_or_else(|error| panic!("refuse: {error}"));

    let page = cloud::instruction_page(&pool, cloud::InstructionScope::default())
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(page.total, 2);
    assert_eq!(page.total_minor, 12_000_000);
    assert_eq!(
        page.open_minor, 3_000_000,
        "open_minor counts what head office still has to answer, not what the \
         shop has ever asked for"
    );
    assert!(page
        .rows
        .iter()
        .any(|row| row.instruction_id == open.instruction_id));

    // The unit is a server filter on every finance list, and this one is no
    // different: another shop's queue is not this shop's.
    let elsewhere = cloud::instruction_page(
        &pool,
        cloud::InstructionScope {
            sites: vec!["store-02".into()],
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(elsewhere.total, 0);
    assert!(elsewhere.rows.is_empty());
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

/// The whole journey, and the balance that exists between its two ends.
///
/// This is the finding the Deposits screen could only estimate: after the bag
/// leaves and before the bank confirms, the money is on an account of its own
/// — not in the till, and not at the bank.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_money_sits_in_transit_between_the_two_dates(pool: PgPool) {
    open_september(&pool).await;
    map_the_three(&pool).await;

    let recorded = cloud::record_deposit(&pool, &a_deposit(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    assert_eq!(recorded.status, "DRAFT");
    assert!(
        recorded.sent_entry_id.is_none(),
        "recording a slip posts nothing"
    );

    let sent = cloud::bank_deposit(&pool, recorded.deposit_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("bank: {error}"));
    assert_eq!(sent.status, "IN_TRANSIT");
    assert_eq!(balance(&pool, CASH, Some(DRAWER)).await, -12_400_000);
    assert_eq!(
        balance(&pool, CASH, Some(TRANSIT)).await,
        12_400_000,
        "between the two dates the money is on the in-transit account, which \
         is the position this document exists to create"
    );
    assert_eq!(
        balance(&pool, BANK, None).await,
        0,
        "the bank has not credited anything yet, and our books must not say it \
         has"
    );

    let landed = cloud::land_deposit(
        &pool,
        recorded.deposit_id,
        &cloud::LandDepositRequest {
            landed_on: Some(september(11)),
            bank_line_id: None,
            slip_reference: "BCA/09/8812".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("land: {error}"));
    assert_eq!(landed.status, "LANDED");
    assert_eq!(landed.landed_on, Some(september(11)));
    assert_eq!(landed.slip_reference, "BCA/09/8812");
    assert_eq!(landed.days_in_transit, 1);
    assert_eq!(
        balance(&pool, CASH, Some(TRANSIT)).await,
        0,
        "once the bank agrees, nothing is in the air"
    );
    assert_eq!(balance(&pool, BANK, None).await, 12_400_000);
}

/// Two entries, on the two dates the two facts happened.
///
/// One entry would have to choose one of the dates and be wrong about the
/// other, which is the defect the document exists to remove.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_two_legs_are_two_entries_on_their_own_dates(pool: PgPool) {
    open_september(&pool).await;
    map_the_three(&pool).await;

    let mut slip = a_deposit();
    slip.bank_now = true;
    let sent = cloud::record_deposit(&pool, &slip, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    assert_eq!(
        sent.status, "IN_TRANSIT",
        "`bank_now` records and banks in one act"
    );
    cloud::land_deposit(
        &pool,
        sent.deposit_id,
        &cloud::LandDepositRequest {
            landed_on: Some(september(12)),
            bank_line_id: None,
            slip_reference: String::new(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("land: {error}"));

    let rows = sqlx::query(
        "SELECT e.posting_date, e.source_kind, e.rule_version
           FROM journal_entry e
          WHERE e.source_kind = 'DEPOSIT' AND e.source_id = $1
          ORDER BY e.posting_date",
    )
    .bind(sent.deposit_id.to_string())
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("read entries: {error}"));

    assert_eq!(rows.len(), 2, "a deposit posts twice, not once");
    let first: NaiveDate = rows[0].get("posting_date");
    let second: NaiveDate = rows[1].get("posting_date");
    assert_eq!(first, september(10), "the bag left on the day it left");
    assert_eq!(
        second,
        september(12),
        "the bank credited it on the bank's day"
    );
    let rule: String = rows[0].get("rule_version");
    assert_eq!(rule, "store_deposit/1");
}

/// The meaning the client's chart does not have, and what happens before
/// somebody maps it.
///
/// `cash_in_transit` is one of exactly two accounts `docs/coa-final.md` says
/// the simplified chart has to add. Until it is pointed at one, a slip can
/// still be written down — observing that a bag left a till does not depend on
/// knowing where to book it — and banking it refuses by name.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_deposit_is_recorded_without_the_transit_account_and_cannot_be_banked(pool: PgPool) {
    open_september(&pool).await;
    map(&pool, "cash", "", CASH, Some(DRAWER)).await;
    map(&pool, "bank_savings", "BCA", BANK, None).await;
    // `cash_in_transit` is deliberately UNmapped — and since 0277 that takes a
    // delete, because the migration chain now ships the mapping at every place
    // rather than leaving it to a seed. The refusal is still worth guarding:
    // somebody can retire the row on the Account Map screen, and the day they
    // do, a deposit has to say which key it could not resolve.
    sqlx::query("DELETE FROM account_map WHERE semantic_key = 'cash_in_transit'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("unmap: {error}"));

    let recorded = cloud::record_deposit(&pool, &a_deposit(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("recording must not depend on the mapping: {error}"));

    let refusal = cloud::bank_deposit(&pool, recorded.deposit_id, ACTOR).await;
    let message = match refusal {
        Ok(_) => panic!("banked a deposit with nowhere to put the money in between"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("cash_in_transit"),
        "the refusal has to name the key, because the fix is to map that key: {message}"
    );
    assert_eq!(
        entry_count(&pool).await,
        0,
        "a refused posting leaves no half-written entry behind"
    );
}

/// An account nobody mapped is refused when the slip is written, not when it
/// is posted.
///
/// `deposits::meaning_of` reads the map backwards — account and category in,
/// meaning out — and refuses both "no meaning" (this test) and "more than one".
/// The second used to be the ordinary case: `cash`, `petty_cash` and
/// `cashier_float` all map to `1101` at one site, so looking up the account
/// alone refused EVERY deposit. The slip now carries `drawer_category_code`,
/// which is the part of `1011001002` that stopped being an account, so the
/// pairing resolves to one meaning and this refusal is back to meaning what it
/// says: nothing is mapped there at all.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unmapped_drawer_is_refused_at_the_counter(pool: PgPool) {
    map(&pool, "bank_savings", "BCA", BANK, None).await;

    let refusal = cloud::record_deposit(&pool, &a_deposit(), ACTOR).await;
    let message = match refusal {
        Ok(_) => panic!("recorded a deposit out of an account that is not a drawer"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains(CASH) && message.contains("cash"),
        "the refusal should name the account and the meanings it could carry: {message}"
    );
}

/// The exposure is a fact about a place, not about which boxes are ticked.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn in_transit_survives_filtering_the_list_to_what_has_landed(pool: PgPool) {
    open_september(&pool).await;
    map_the_three(&pool).await;

    let mut first = a_deposit();
    first.bank_now = true;
    let flying = cloud::record_deposit(&pool, &first, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));

    let mut second = a_deposit();
    second.bank_now = true;
    second.amount_minor = 5_000_000;
    second.banked_on = september(11);
    let arrived = cloud::record_deposit(&pool, &second, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    cloud::land_deposit(
        &pool,
        arrived.deposit_id,
        &cloud::LandDepositRequest {
            landed_on: Some(september(12)),
            bank_line_id: None,
            slip_reference: String::new(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("land: {error}"));

    let landed_only = cloud::deposit_page(
        &pool,
        cloud::DepositScope {
            statuses: vec!["LANDED".into()],
            sites: vec![SHOP.into()],
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(landed_only.total, 1);
    assert_eq!(landed_only.total_minor, 5_000_000);
    assert_eq!(
        landed_only.in_transit_minor, 12_400_000,
        "filtering the list to what has landed must not make the exposure read \
         zero: it is what the unit has in the air, not what the table shows"
    );

    // And it agrees with the ledger, because both move only when this module
    // posts.
    assert_eq!(
        balance(&pool, CASH, Some(TRANSIT)).await,
        landed_only.in_transit_minor
    );
    assert!(flying.sent_entry_id.is_some());
}

/// A deposit into the account it came out of is a round trip.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_deposit_into_its_own_drawer_is_refused(pool: PgPool) {
    map_the_three(&pool).await;

    let mut slip = a_deposit();
    slip.bank_account_code = slip.drawer_account_code.clone();
    assert!(
        cloud::record_deposit(&pool, &slip, ACTOR).await.is_err(),
        "money cannot be deposited into the drawer it came out of"
    );
}

/// Money does not arrive before it is sent.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_bank_cannot_credit_it_before_it_left(pool: PgPool) {
    open_september(&pool).await;
    map_the_three(&pool).await;

    let mut slip = a_deposit();
    slip.bank_now = true;
    let sent = cloud::record_deposit(&pool, &slip, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));

    assert!(
        cloud::land_deposit(
            &pool,
            sent.deposit_id,
            &cloud::LandDepositRequest {
                landed_on: Some(september(9)),
                bank_line_id: None,
                slip_reference: String::new(),
            },
            ACTOR,
        )
        .await
        .is_err(),
        "a value date before the banking date is not a deposit, it is a typo"
    );
}

/// Two people pressing at once means one entry, not two.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn banking_the_same_deposit_twice_is_refused(pool: PgPool) {
    open_september(&pool).await;
    map_the_three(&pool).await;

    let recorded = cloud::record_deposit(&pool, &a_deposit(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    cloud::bank_deposit(&pool, recorded.deposit_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("bank: {error}"));

    assert!(
        cloud::bank_deposit(&pool, recorded.deposit_id, ACTOR)
            .await
            .is_err(),
        "the money has already left the drawer"
    );
    let entries: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM journal_entry WHERE source_kind = 'DEPOSIT'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(entries, 1);
}

/// The unit is on the row and never in the account code.
///
/// The module's founding claim, checked where it would fail silently: both legs
/// of both postings carry the shop's `site_id`, so the entry balances per unit
/// as well as in total — which is the only way it can be read against the
/// client's own per-location trial balance.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_posted_line_carries_the_unit(pool: PgPool) {
    open_september(&pool).await;
    map_the_three(&pool).await;

    let mut slip = a_deposit();
    slip.bank_now = true;
    let sent = cloud::record_deposit(&pool, &slip, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    cloud::land_deposit(
        &pool,
        sent.deposit_id,
        &cloud::LandDepositRequest {
            landed_on: Some(september(11)),
            bank_line_id: None,
            slip_reference: String::new(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("land: {error}"));

    let elsewhere: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE e.source_kind = 'DEPOSIT' AND l.site_id <> $1",
    )
    .bind(SHOP)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(elsewhere, 0, "a deposit's legs all belong to one unit");

    let per_unit: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE e.source_kind = 'DEPOSIT' AND l.site_id = $1",
    )
    .bind(SHOP)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("sum: {error}"));
    assert_eq!(
        per_unit, 0,
        "both entries balance at the unit, not only in total"
    );
}

/// A deposit is not a document you can post into a month somebody has sealed.
///
/// Nothing in this module checks the period; the trigger on `journal_entry`
/// does, and the refusal reaches a person as the trigger's own sentence. The
/// test is here because the alternative — a store document that quietly wrote
/// into a closed month — is exactly what a period close is for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn banking_into_a_month_nobody_opened_is_refused(pool: PgPool) {
    map_the_three(&pool).await;
    // September is deliberately never opened.

    let recorded = cloud::record_deposit(&pool, &a_deposit(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("record: {error}"));
    assert!(
        cloud::bank_deposit(&pool, recorded.deposit_id, ACTOR)
            .await
            .is_err(),
        "the period gate applies to store documents like any other"
    );

    let orphans: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM store_deposit WHERE status <> 'DRAFT'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(
        orphans, 0,
        "a refused posting must leave the document where it was: the row and \
         the journal are written in one transaction"
    );
}
