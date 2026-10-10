//! GA's half of the asset register: what GA knows about a thing, what happened
//! to it, and the papers that run out.
//!
//! The register's identity and its money are tested in
//! `assets_completeness_integration`; this file holds the four columns and the
//! history migration 0357 added, the five acts that write them, the drawer's
//! expiry dates (0358), and the one list the client's form is drawn from.
//!
//! Two rules run through all of it and are worth stating once. The asset stays
//! ONE row — where a thing is gets moved, not re-registered — and every act
//! that changes it leaves a line in `ga_asset_event`, because the history is the
//! only thing that answers "how did this get here".

use chrono::NaiveDate;
use inventory_backend::cloud::{domain, postgres as cloud};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";

fn day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// A registration with everything the ordinary case has, so each test only says
/// what it is about.
fn an_asset(number: &str, class: &str, specs: Value) -> cloud::RegisterGaAssetRequest {
    cloud::RegisterGaAssetRequest {
        asset_number: number.into(),
        name: format!("{class} {number}"),
        class_code: class.into(),
        site_id: "dc".into(),
        sub_location: Some("Gudang B".into()),
        holder: Some("Kurir antar toko".into()),
        condition: "BAIK".into(),
        serial_number: Some(format!("SN-{number}")),
        acquired_on: day(2026, 1, 15),
        specs,
        notes: None,
        quantity: None,
    }
}

async fn register(pool: &PgPool, number: &str, class: &str, specs: Value) -> cloud::GaAssetRow {
    cloud::ga_asset_register(pool, &an_asset(number, class, specs), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("register {number}: {error}"))
}

/// A vehicle, because it is the build with a rule the database enforces on its
/// own: one plate belongs to one car still in service.
fn a_vehicle(number: &str, plate: &str) -> cloud::RegisterGaAssetRequest {
    an_asset(
        number,
        "MOBIL",
        json!({"make": "Toyota Gran Max", "plate": plate}),
    )
}

async fn events(pool: &PgPool, asset_id: Uuid) -> Vec<cloud::GaAssetEvent> {
    cloud::ga_asset_hub(pool, asset_id)
        .await
        .unwrap_or_else(|error| panic!("hub: {error}"))
        .events
}

async fn count_assets(pool: &PgPool, number: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM fixed_asset WHERE asset_number = $1")
        .bind(number)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
}

fn event_of<'a>(events: &'a [cloud::GaAssetEvent], kind: &str) -> &'a cloud::GaAssetEvent {
    events
        .iter()
        .find(|event| event.kind == kind)
        .unwrap_or_else(|| panic!("no {kind} event in {}", events.len()))
}

/// A filed paper, with the dates 0358 added.
async fn file_document(
    pool: &PgPool,
    name: &str,
    doc_type: &str,
    doc_number: &str,
    expires_on: Option<NaiveDate>,
) -> Uuid {
    let file_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO stored_file
             (file_id, file_name, content_type, byte_size, sha256, storage, bytes, uploaded_by)
         VALUES ($1, $2, 'application/pdf', 0, repeat('0', 64), 'DATABASE', '\\x00'::bytea, $3)",
    )
    .bind(file_id)
    .bind(name)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("file: {error}"));

    let document_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO document
             (document_id, file_id, name, doc_type, doc_number, issuer, issued_on, expires_on,
              uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'Bapenda / Samsat', $6, $7, $8)",
    )
    .bind(document_id)
    .bind(file_id)
    .bind(name)
    .bind(doc_type)
    .bind(doc_number)
    .bind(day(2025, 10, 12))
    .bind(expires_on)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("document: {error}"));
    document_id
}

async fn filed_against(pool: &PgPool, document_id: Uuid, asset_id: Uuid) {
    sqlx::query(
        "INSERT INTO document_link (document_id, subject_kind, subject_id) VALUES ($1, 'asset', $2)",
    )
    .bind(document_id)
    .bind(asset_id.to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("link: {error}"));
}

/// The smallest honest entry that takes a thing out of the books.
///
/// The register refuses a row that says DISPOSED without one (0096): a thing
/// leaves through Finance, with a date and an entry, and a test that could set
/// the status by hand would be a test of a state the system does not have. So
/// the fixture builds the entry itself — an open month, a balanced pair of
/// lines on the client's cash account — and posts nothing anywhere that
/// matters.
///
/// The header and its lines go in ONE transaction, and not merely out of
/// tidiness: `journal_entry_balances` is a deferred constraint trigger, so an
/// entry committed on its own is an entry with no lines and is refused.
async fn a_disposal_entry(pool: &PgPool) -> Uuid {
    let entry_id = Uuid::new_v4();
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("tx: {error}"));
    sqlx::query("INSERT INTO fiscal_period (year, month, status) VALUES (2026, 9, 'OPEN') ON CONFLICT DO NOTHING")
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("period: {error}"));
    sqlx::query(
        "INSERT INTO journal_entry
             (entry_id, entry_number, posting_date, source_kind, rule_version, total_minor,
              currency, posted_by)
         VALUES ($1, 'JV-GA-PROBE', '2026-09-30', 'MANUAL', 'ga-assets-test', 1, 'IDR', $2)",
    )
    .bind(entry_id)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"));
    for (number, debit, credit) in [(1, 1, 0), (2, 0, 1)] {
        sqlx::query(
            "INSERT INTO journal_line
                 (line_id, entry_id, line_number, account_code, site_id, debit_minor, credit_minor)
             VALUES ($1, $2, $3, '1002', 'dc', $4, $5)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(number)
        .bind(debit)
        .bind(credit)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"));
    }
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    entry_id
}

async fn dispose(pool: &PgPool, asset_id: Uuid) {
    let entry_id = a_disposal_entry(pool).await;
    sqlx::query(
        "UPDATE fixed_asset
            SET status = 'DISPOSED', disposed_on = '2026-09-30', disposal_method = 'WRITTEN_OFF',
                disposal_proceeds_minor = 0, disposal_journal_entry_id = $2
          WHERE asset_id = $1",
    )
    .bind(asset_id)
    .bind(entry_id)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("dispose: {error}"));
}

// ---------------------------------------------------------------------------
// 1. The migration
// ---------------------------------------------------------------------------

/// The columns 0357 added, and the promises each one makes on its own.
///
/// Written straight into the table rather than through the module under test,
/// because that is the point: a writer that never heard of this migration must
/// still find `BAIK` and `{}` rather than a NULL it has to interpret.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_register_carries_the_upkeep_columns_with_their_defaults(pool: PgPool) {
    let asset_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fixed_asset
             (asset_id, asset_number, name, category_code, site_id, acquired_on, registered_by)
         VALUES ($1, 'AST-8001', 'Meja kasir', 'FFE_OFFICE', 'dc', '2026-01-05', $2)",
    )
    .bind(asset_id)
    .bind(ACTOR)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("insert: {error}"));

    let row = sqlx::query(
        "SELECT sub_location, holder, condition, specs FROM fixed_asset WHERE asset_id = $1",
    )
    .bind(asset_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("read: {error}"));
    let condition: String = sqlx::Row::try_get(&row, "condition").unwrap_or_default();
    let specs: Value = sqlx::Row::try_get(&row, "specs").unwrap_or_default();
    let sub_location: Option<String> = sqlx::Row::try_get(&row, "sub_location").unwrap_or_default();
    let holder: Option<String> = sqlx::Row::try_get(&row, "holder").unwrap_or_default();

    assert_eq!(
        condition, "BAIK",
        "an item nobody has walked past is in good order, not unknown"
    );
    assert_eq!(specs, json!({}), "a form with no fields is an empty object");
    assert!(sub_location.is_none() && holder.is_none());

    // And the schema says the same thing, so a future writer cannot make them
    // nullable again without this failing.
    let loose: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.columns
          WHERE table_name = 'fixed_asset' AND column_name IN ('condition', 'specs')
            AND is_nullable = 'YES'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("columns: {error}"));
    assert_eq!(loose, 0);
}

/// The history is appended, and the database is what says so.
///
/// Not a code review of the module below: a live UPDATE and a live DELETE, both
/// of which have to come back as an error, because "we never do that" is a
/// convention and a register that can be edited in place is not a register.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_asset_history_is_appended_and_the_database_refuses_to_edit_it(pool: PgPool) {
    let asset = register(
        &pool,
        "AST-8002",
        "AIR_CONDITIONER",
        json!({"make": "Daikin"}),
    )
    .await;

    let edited = sqlx::query("UPDATE ga_asset_event SET reason = 'diubah' WHERE asset_id = $1")
        .bind(asset.asset_id)
        .execute(&pool)
        .await
        .expect_err("an event that can be edited is not a record of anything");
    assert!(
        edited.to_string().contains("appended"),
        "the refusal has to say what the rule is: {edited}"
    );

    let removed = sqlx::query("DELETE FROM ga_asset_event WHERE asset_id = $1")
        .bind(asset.asset_id)
        .execute(&pool)
        .await
        .expect_err("an event that can be deleted is not a record of anything");
    assert!(removed.to_string().contains("appended"), "{removed}");

    // And the line is still there, with what it said.
    let kept = events(&pool, asset.asset_id).await;
    assert_eq!(kept.len(), 1);
    assert_ne!(kept[0].reason, "diubah");
}

// ---------------------------------------------------------------------------
// 2. The build's fields
// ---------------------------------------------------------------------------

/// The four refusals, and the one thing that is dropped rather than refused.
///
/// Pure, and deliberately so: this is the validation the whole register rests
/// on, and it is answerable without a database.
#[test]
fn specs_are_checked_against_the_builds_own_fields() {
    // A key the build does not have, naming what it does have. This is the one
    // that catches a client drawing a plate field on an air conditioner.
    let unknown = domain::assert_specs("VEHICLE", &json!({"make": "Gran Max", "warna": "merah"}))
        .expect_err("a vehicle has no colour field");
    let message = unknown.to_string();
    assert!(message.contains("warna"), "{message}");
    assert!(
        message.contains("plate"),
        "the refusal lists the keys that would have worked: {message}"
    );

    // A required field, empty. `make` and `plate` are what identify a vehicle.
    let missing = domain::assert_specs("VEHICLE", &json!({"plate": "B 9615 PCD"}))
        .expect_err("a vehicle without a make is not identified");
    assert!(missing.to_string().contains("make"), "{missing}");

    // A date that is not a day. Refused at the moment somebody typed it rather
    // than a year later when the warranty reminder fires on the wrong day.
    let wrong_day =
        domain::assert_specs("TECH", &json!({"make": "Daikin", "warranty": "31-12-2027"}))
            .expect_err("a warranty end is YYYY-MM-DD");
    assert!(wrong_day.to_string().contains("warranty"), "{wrong_day}");

    // And an empty value is dropped rather than stored: `specs` should say what
    // is known, not what was left blank.
    let kept = domain::assert_specs(
        "TECH",
        &json!({"make": "Daikin", "capacity": "  ", "warranty": ""}),
    )
    .unwrap_or_else(|error| panic!("check: {error}"));
    assert_eq!(kept, json!({"make": "Daikin"}));

    // A build with no physical facts takes nothing at all, and an empty form is
    // a legitimate answer there.
    assert_eq!(
        domain::assert_specs("SOFTWARE", &json!({})).unwrap_or_else(|error| panic!("{error}")),
        json!({})
    );
    assert!(domain::assert_specs("SOFTWARE", &json!({"plate": "B 1"})).is_err());
}

/// A class the register does not keep is refused by name, before the foreign
/// key gets a chance to say something nobody can read.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_class_the_register_does_not_keep_is_refused_by_name(pool: PgPool) {
    let refused = cloud::ga_asset_register(
        &pool,
        &an_asset("AST-8100", "TIDAK_ADA_KELAS", json!({})),
        ACTOR,
    )
    .await
    .expect_err("the register keeps its own list of classes");
    assert!(refused.to_string().contains("TIDAK_ADA_KELAS"), "{refused}");
    assert_eq!(count_assets(&pool, "AST-8100").await, 0);
}

// ---------------------------------------------------------------------------
// 3. One plate, one car
// ---------------------------------------------------------------------------

/// Two vehicles in service may not wear one plate, and a plate goes back into
/// circulation with the car it was on.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_plate_belongs_to_one_vehicle_still_in_service(pool: PgPool) {
    let first = cloud::ga_asset_register(&pool, &a_vehicle("AST-8201", "B 9615 PCD"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("first: {error}"));

    let clash = cloud::ga_asset_register(&pool, &a_vehicle("AST-8202", "B 9615 PCD"), ACTOR)
        .await
        .expect_err("two cars may not wear one plate");
    assert!(
        clash.to_string().contains("B 9615 PCD") && clash.to_string().contains("plate"),
        "the refusal has to be about the plate somebody typed, not about an index name: {clash}"
    );
    assert_eq!(count_assets(&pool, "AST-8202").await, 0);

    // The car goes. The plate goes with it — a registration number in this
    // country moves between vehicles, and a disposed one holding it for ever
    // would refuse the next car that legitimately carries it.
    dispose(&pool, first.asset_id).await;
    let second = cloud::ga_asset_register(&pool, &a_vehicle("AST-8202", "B 9615 PCD"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("the plate went back with the car: {error}"));
    assert_eq!(second.specs["plate"], json!("B 9615 PCD"));

    // Two rows, because they are two things: the register moves a thing, it
    // does not re-mint one.
    assert_eq!(count_assets(&pool, "AST-8201").await, 1);
    assert_eq!(count_assets(&pool, "AST-8202").await, 1);
}

// ---------------------------------------------------------------------------
// 4. Registration
// ---------------------------------------------------------------------------

/// A registration writes the thing AND the line that says somebody put it here,
/// or it writes neither.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn registering_writes_the_asset_and_its_first_event_in_one_transaction(pool: PgPool) {
    let asset = register(
        &pool,
        "AST-8301",
        "MOBIL",
        json!({"make": "Toyota Gran Max", "plate": "B 9615 PCD"}),
    )
    .await;
    assert_eq!(asset.status, "REGISTERED");
    assert_eq!(asset.build, "VEHICLE");
    assert!(
        !asset.class_name.is_empty(),
        "the class's own name travels with the row, so a list does not show a code"
    );
    assert_eq!(asset.condition, "BAIK");
    assert_eq!(asset.specs["plate"], json!("B 9615 PCD"));

    let history = events(&pool, asset.asset_id).await;
    assert_eq!(history.len(), 1, "a history starts with one line, not none");
    let first = &history[0];
    assert_eq!(first.kind, "REGISTERED");
    assert_eq!(first.to_site.as_deref(), Some("dc"));
    assert_eq!(first.to_holder.as_deref(), Some("Kurir antar toko"));
    assert_eq!(first.occurred_on, day(2026, 1, 15));
    assert_eq!(first.recorded_by, ACTOR);
    // The reason says what was written down and under what it was filed — the
    // first question about any history is its first entry.
    assert!(first.reason.contains("VEHICLE"), "{}", first.reason);
    assert!(first.reason.contains("MOBIL"), "{}", first.reason);

    // The second write is not a courtesy. An actor with no name passes the
    // asset's own columns and fails the event's, which is the ONLY way to fail
    // between the two writes — and if they were not one transaction it would
    // leave a register row whose history starts empty.
    let orphan =
        cloud::ga_asset_register(&pool, &an_asset("AST-8302", "MOBIL", json!({})), "").await;
    assert!(orphan.is_err(), "an event with no recorder is refused");
    assert_eq!(
        count_assets(&pool, "AST-8302").await,
        0,
        "the asset goes back with the event it could not write"
    );
}

// ---------------------------------------------------------------------------
// 5. Transfer
// ---------------------------------------------------------------------------

/// A move changes where the thing is, who holds it, and writes one line saying
/// where it came from — and the thing stays one row.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_transfer_moves_the_thing_and_writes_one_row_saying_where_it_came_from(pool: PgPool) {
    let asset = register(
        &pool,
        "AST-8401",
        "AIR_CONDITIONER",
        json!({"make": "Daikin", "warranty": "2027-03-14"}),
    )
    .await;

    let moved = cloud::ga_asset_transfer(
        &pool,
        asset.asset_id,
        &cloud::TransferGaAssetRequest {
            to_site: "store-09".into(),
            to_sub_location: Some("Lt. 1 · area kasir".into()),
            to_holder: Some("Visual merchandiser".into()),
            reason: "Pindah ke toko yang baru dibuka".into(),
            occurred_on: day(2026, 3, 2),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("transfer: {error}"));

    assert_eq!(moved.site_id, "store-09");
    assert_eq!(moved.sub_location.as_deref(), Some("Lt. 1 · area kasir"));
    assert_eq!(moved.holder.as_deref(), Some("Visual merchandiser"));
    assert_eq!(
        count_assets(&pool, "AST-8401").await,
        1,
        "a move is an event, not a second row"
    );

    let history = events(&pool, asset.asset_id).await;
    assert_eq!(history.len(), 2);
    let transfer = event_of(&history, "TRANSFER");
    assert_eq!(transfer.from_site.as_deref(), Some("dc"));
    assert_eq!(transfer.to_site.as_deref(), Some("store-09"));
    assert_eq!(transfer.from_holder.as_deref(), Some("Kurir antar toko"));
    assert_eq!(transfer.to_holder.as_deref(), Some("Visual merchandiser"));
    assert_eq!(transfer.occurred_on, day(2026, 3, 2));
    assert!(
        transfer.reason.contains("Pindah ke toko yang baru dibuka"),
        "the line keeps the reason somebody gave: {}",
        transfer.reason
    );
    assert!(
        transfer.reason.contains("store-09"),
        "and where it went: {}",
        transfer.reason
    );

    // A move nobody can explain, and a move to nowhere the estate has, are both
    // refused — the second by name, because the person sending it has usually
    // just typed a site wrong.
    let unexplained = cloud::ga_asset_transfer(
        &pool,
        asset.asset_id,
        &cloud::TransferGaAssetRequest {
            to_site: "store-10".into(),
            to_sub_location: None,
            to_holder: None,
            reason: "  ".into(),
            occurred_on: day(2026, 3, 3),
        },
        ACTOR,
    )
    .await
    .expect_err("a move needs a reason");
    assert!(unexplained.to_string().contains("reason"), "{unexplained}");

    let nowhere = cloud::ga_asset_transfer(
        &pool,
        asset.asset_id,
        &cloud::TransferGaAssetRequest {
            to_site: "gudang-yang-tidak-ada".into(),
            to_sub_location: None,
            to_holder: None,
            reason: "salah ketik".into(),
            occurred_on: day(2026, 3, 3),
        },
        ACTOR,
    )
    .await
    .expect_err("a move names one of the estate's own sites");
    assert!(
        nowhere.to_string().contains("gudang-yang-tidak-ada"),
        "{nowhere}"
    );

    // And nothing was written by either refusal.
    assert_eq!(events(&pool, asset.asset_id).await.len(), 2);
}

// ---------------------------------------------------------------------------
// 6. Condition and holder
// ---------------------------------------------------------------------------

/// The two facts a walk-round changes, each with its own line — and no line at
/// all when nothing changed.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_condition_and_a_holder_each_write_their_own_line_and_only_when_they_change(
    pool: PgPool,
) {
    let asset = register(&pool, "AST-8501", "LIFT", json!({"make": "Andalan"})).await;
    let untouched = cloud::UpdateGaAssetRequest {
        name: None,
        sub_location: None,
        holder: None,
        condition: None,
        serial_number: None,
        specs: None,
        notes: None,
    };
    cloud::ga_asset_update(&pool, asset.asset_id, &untouched, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("save: {error}"));
    assert_eq!(
        events(&pool, asset.asset_id).await.len(),
        1,
        "a form saved without touching anything is not an event"
    );

    // The same word again is not a change either.
    let same_word = cloud::UpdateGaAssetRequest {
        condition: Some("BAIK".into()),
        ..untouched.clone()
    };
    cloud::ga_asset_update(&pool, asset.asset_id, &same_word, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("save: {error}"));
    assert_eq!(events(&pool, asset.asset_id).await.len(), 1);

    let worn = cloud::ga_asset_update(
        &pool,
        asset.asset_id,
        &cloud::UpdateGaAssetRequest {
            condition: Some("perlu_servis".into()),
            ..untouched.clone()
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("condition: {error}"));
    assert_eq!(worn.condition, "PERLU_SERVIS");

    let held = cloud::ga_asset_update(
        &pool,
        asset.asset_id,
        &cloud::UpdateGaAssetRequest {
            holder: Some("Teknisi lift".into()),
            ..untouched.clone()
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("holder: {error}"));
    assert_eq!(held.holder.as_deref(), Some("Teknisi lift"));

    let history = events(&pool, asset.asset_id).await;
    assert_eq!(history.len(), 3);
    let condition_line = event_of(&history, "CONDITION");
    assert!(
        condition_line.reason.contains("BAIK"),
        "{}",
        condition_line.reason
    );
    assert!(
        condition_line.reason.contains("PERLU_SERVIS"),
        "the line names the word it was and the word it became: {}",
        condition_line.reason
    );
    let assign_line = event_of(&history, "ASSIGN");
    assert_eq!(assign_line.from_holder.as_deref(), Some("Kurir antar toko"));
    assert_eq!(assign_line.to_holder.as_deref(), Some("Teknisi lift"));

    // Where a thing IS belongs to the transfer: a correction that moved it
    // would leave a location with no line explaining it.
    let smuggled = cloud::ga_asset_update(
        &pool,
        asset.asset_id,
        &cloud::UpdateGaAssetRequest {
            sub_location: Some("Lt. 2".into()),
            ..untouched.clone()
        },
        ACTOR,
    )
    .await
    .expect_err("a location moves through the transfer");
    assert!(smuggled.to_string().contains("transfer"), "{smuggled}");

    // And a specs correction is validated against the class's build.
    let wrong = cloud::ga_asset_update(
        &pool,
        asset.asset_id,
        &cloud::UpdateGaAssetRequest {
            specs: Some(json!({"make": "Andalan", "warna": "merah"})),
            ..untouched
        },
        ACTOR,
    )
    .await
    .expect_err("a lift has no colour field");
    assert!(wrong.to_string().contains("warna"), "{wrong}");
}

// ---------------------------------------------------------------------------
// 7. The hub
// ---------------------------------------------------------------------------

/// The hub is one thing: its history, and the papers filed against it — and
/// nobody else's papers.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_hub_gathers_the_things_history_and_its_own_papers(pool: PgPool) {
    let asset = register(
        &pool,
        "AST-8601",
        "AIR_CONDITIONER",
        json!({"make": "Daikin"}),
    )
    .await;
    let other = register(&pool, "AST-8602", "LIFT", json!({"make": "Andalan"})).await;
    cloud::ga_asset_note(
        &pool,
        asset.asset_id,
        "Filter dibersihkan",
        day(2026, 2, 1),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("note: {error}"));

    let stnk = file_document(
        &pool,
        "STNK B 9615 PCD",
        "STNK",
        "STNK-2026-001",
        Some(day(2026, 10, 12)),
    )
    .await;
    filed_against(&pool, stnk, asset.asset_id).await;
    let warranty = file_document(
        &pool,
        "Garansi lift",
        "GARANSI",
        "LIFT-2027",
        Some(day(2027, 1, 1)),
    )
    .await;
    filed_against(&pool, warranty, other.asset_id).await;

    let hub = cloud::ga_asset_hub(&pool, asset.asset_id)
        .await
        .unwrap_or_else(|error| panic!("hub: {error}"));
    assert_eq!(hub.asset.asset_number, "AST-8601");
    assert_eq!(hub.events.len(), 2);
    assert_eq!(event_of(&hub.events, "NOTE").reason, "Filter dibersihkan");
    assert_eq!(hub.documents.len(), 1, "the lift's warranty is not this");
    assert_eq!(hub.documents[0].name, "STNK B 9615 PCD");
    assert_eq!(hub.documents[0].doc_type.as_deref(), Some("STNK"));
    assert_eq!(
        hub.documents[0].doc_number.as_deref(),
        Some("STNK-2026-001")
    );
    assert_eq!(hub.documents[0].expires_on, Some(day(2026, 10, 12)));
    assert!(hub.documents[0].available, "the bytes are in the row");

    assert!(cloud::ga_asset_hub(&pool, Uuid::new_v4()).await.is_err());
}

// ---------------------------------------------------------------------------
// 8. Who may reach it
// ---------------------------------------------------------------------------

/// GA is the department that FILES a fact, so a shop manager's own acts are on
/// the same rung as reading them — and that rung is not the blanket GET's.
#[test]
fn the_asset_routes_are_a_supervisors_surface() {
    for (method, path) in [
        ("GET", "/api/v1/ga/assets"),
        ("POST", "/api/v1/ga/assets"),
        ("GET", "/api/v1/ga/asset-builds"),
        (
            "PATCH",
            "/api/v1/ga/assets/9f0f5f0e-0000-0000-0000-000000000000",
        ),
        (
            "POST",
            "/api/v1/ga/assets/9f0f5f0e-0000-0000-0000-000000000000/transfer",
        ),
        (
            "POST",
            "/api/v1/ga/assets/9f0f5f0e-0000-0000-0000-000000000000/notes",
        ),
    ] {
        assert_eq!(
            domain::required_role(method, path),
            domain::Role::Supervisor,
            "{method} {path}"
        );
    }
}

// ---------------------------------------------------------------------------
// 9. The overview
// ---------------------------------------------------------------------------

/// Ninety days is the window, and what is already past stays on the list.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_overview_lists_the_papers_that_run_out_and_nothing_further_off(pool: PgPool) {
    // 2026-09-24 plus ninety days is 2026-12-23, and the boundary is in.
    let overdue = file_document(&pool, "SLO lift", "SLO", "SLO-001", Some(day(2026, 8, 1))).await;
    let soon = file_document(
        &pool,
        "STNK B 9615 PCD",
        "STNK",
        "STNK-2026-001",
        Some(day(2026, 10, 12)),
    )
    .await;
    let boundary =
        file_document(&pool, "Izin usaha", "IZIN", "IZ-9", Some(day(2026, 12, 23))).await;
    let far = file_document(
        &pool,
        "Sertifikat tanah",
        "SHM",
        "SHM-00231",
        Some(day(2027, 4, 12)),
    )
    .await;
    let undated = file_document(&pool, "BPKB", "BPKB", "BPKB-1", None).await;

    let overview = cloud::ga_overview(&pool, day(2026, 9, 24))
        .await
        .unwrap_or_else(|error| panic!("overview: {error}"));

    let listed: Vec<String> = overview
        .expiring_documents
        .iter()
        .map(|row| row.id.clone())
        .collect();
    assert_eq!(
        listed,
        vec![overdue.to_string(), soon.to_string(), boundary.to_string()],
        "soonest first, and an expired permit is not less urgent than one expiring"
    );
    for out in [far, undated] {
        assert!(
            !listed.contains(&out.to_string()),
            "a paper that runs out next spring is not this quarter's work"
        );
    }

    let row = &overview.expiring_documents[1];
    assert_eq!(row.kind, "document");
    assert_eq!(row.label, "STNK B 9615 PCD");
    assert_eq!(row.detail.as_deref(), Some("STNK · STNK-2026-001"));
    assert_eq!(row.on.as_deref(), Some("2026-10-12"));
}

// ---------------------------------------------------------------------------
// The forms the client draws
// ---------------------------------------------------------------------------

/// The eleven, their fields, and the classes filed on each — from ONE list.
///
/// The point of the route is that the client's form and the server's validator
/// cannot disagree, so the middle assertion is the one that matters: the fields
/// it answers with are exactly the fields `assert_specs` enforces.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_forms_are_the_eleven_with_the_fields_the_validator_enforces(pool: PgPool) {
    let schema = cloud::ga_build_schema(&pool)
        .await
        .unwrap_or_else(|error| panic!("forms: {error}"));

    let order: Vec<&str> = schema.builds.iter().map(|one| one.build.as_str()).collect();
    assert_eq!(
        order,
        vec![
            "LAND", "BUILDING", "TECH", "VEHICLE", "FFE", "IT", "AUDIO", "OE", "SOFTWARE",
            "DEFERRED", "CIP"
        ],
        "the order the picker offers them in, not alphabetical"
    );
    for one in &schema.builds {
        assert!(!one.label.is_empty(), "{} has no name", one.build);
        assert!(!one.note.is_empty(), "{} has no tile line", one.build);
        assert!(
            !one.classes.is_empty(),
            "{} has no class filed on it, so its form is drawn for nobody",
            one.build
        );
    }

    let vehicle = schema
        .builds
        .iter()
        .find(|one| one.build == "VEHICLE")
        .unwrap_or_else(|| panic!("VEHICLE"));
    let fields: Vec<(&str, &str, bool)> = vehicle
        .fields
        .iter()
        .map(|field| (field.key.as_str(), field.kind.as_str(), field.required))
        .collect();
    assert_eq!(
        fields,
        vec![
            ("make", "TEXT", true),
            ("plate", "TEXT", true),
            ("year", "TEXT", false),
            ("chassis", "TEXT", false),
            ("engine", "TEXT", false),
            ("odo", "TEXT", false),
        ],
        "the six the client's form draws, and the validator is the same table"
    );
    // Which is only true if the validator agrees: a plate the form offers and
    // the server refused would be a form nobody could submit.
    assert!(domain::assert_specs("VEHICLE", &json!({"make": "a", "plate": "b"})).is_ok());
    assert!(domain::assert_specs(
        "VEHICLE",
        &json!({"make": "a", "plate": "b", "odometer": "1"})
    )
    .is_err());

    // A date field is a date, not free text: a warranty end is asked about
    // later, so a form that let somebody type "tiga tahun" would be a reminder
    // that never fires.
    let warranty = vehicle.fields.iter().find(|field| field.key == "warranty");
    assert!(warranty.is_none(), "a vehicle has no warranty field");

    // Four classes are one form, and the class picker is told which: a lift
    // must not appear on a vehicle form.
    assert_eq!(vehicle.classes, vec!["MOBIL", "SEPEDA_MOTOR"]);
    let tech = schema
        .builds
        .iter()
        .find(|one| one.build == "TECH")
        .unwrap_or_else(|| panic!("TECH"));
    assert!(tech.classes.iter().any(|code| code == "AIR_CONDITIONER"));
    assert!(!vehicle.classes.iter().any(|code| code == "AIR_CONDITIONER"));
}
