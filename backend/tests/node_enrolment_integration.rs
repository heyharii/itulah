//! A shop machine enrolled by code and approval, end to end against Postgres.
//!
//! What the protocol promises, each as a test: the code is spent once; only
//! the claiming machine can ask about its claim; approval registers exactly
//! the key the machine minted and nothing it did not; the node is sent what
//! the fleet already knows; a new code retires the old one; a replacement
//! machine starts one generation past the machine it replaces and locks the
//! old one out.

use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres as cloud;
use inventory_backend::sync::enrolment::{
    key_digest, verification_number, ClaimRequest, MachineFacts, StatusAnswer,
};
use sqlx::PgPool;

fn issue_request(site: &str) -> cloud::IssueNodeEnrolmentRequest {
    serde_json::from_value(serde_json::json!({ "site_id": site, "label": "Toko uji" }))
        .unwrap_or_else(|error| panic!("request: {error}"))
}

fn claim(code: &str, key: &str) -> ClaimRequest {
    ClaimRequest {
        code: code.to_owned(),
        key_sha256: key_digest(key),
        machine: MachineFacts {
            hostname: "DESKTOP-TOKO07".into(),
            os: "windows".into(),
            arch: "x86_64".into(),
            version: "0.1.0".into(),
        },
    }
}

const KEY_A: &str = "a key minted on the first shop machine, 64 chars of entropy..";
const KEY_B: &str = "a key minted on the replacement machine, also long enough....";

async fn command_types(pool: &PgPool, origin: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT c.command_type FROM sync_command_delivery d
           JOIN sync_command c ON c.command_id = d.command_id
          WHERE d.origin_id = $1 ORDER BY d.seq",
    )
    .bind(origin)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("commands: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_machine_is_enrolled_by_code_and_approval_and_receives_the_fleets_data(pool: PgPool) {
    let issued = cloud::issue_node_enrolment(&pool, issue_request("store-07"), "admin")
        .await
        .unwrap_or_else(|error| panic!("issue: {error}"));
    assert_eq!(issued.origin_id, "store-07");
    assert_eq!(issued.node_role, "STORE");
    assert_eq!(issued.code.len(), 11, "shown as XXXXX-XXXXX");

    // Typed badly, as a person would.
    let typed = issued.code.to_lowercase().replace('-', " ");
    let answer = cloud::claim_node_enrolment(&pool, claim(&typed, KEY_A), Some("10.0.4.23"))
        .await
        .unwrap_or_else(|error| panic!("claim: {error}"));
    let canonical = issued.code.replace('-', "");
    assert_eq!(
        answer.verification,
        verification_number(&canonical, &key_digest(KEY_A)),
        "the shop and the hub compute the same number"
    );

    let pending = cloud::node_enrolment_status(&pool, answer.enrolment_id, Some(KEY_A))
        .await
        .unwrap_or_else(|error| panic!("status: {error}"));
    assert_eq!(
        pending,
        StatusAnswer::Pending {
            verification: answer.verification.clone()
        }
    );

    // The hub sees the claim, with the machine and the number to read back.
    let listed = cloud::list_node_enrolments(&pool)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    let row = listed
        .iter()
        .find(|row| row.enrolment_id == answer.enrolment_id)
        .unwrap_or_else(|| panic!("claimed enrolment listed"));
    assert_eq!(row.status, "CLAIMED");
    assert_eq!(
        row.verification.as_deref(),
        Some(answer.verification.as_str())
    );
    assert_eq!(
        row.machine.as_ref().map(|m| m.hostname.as_str()),
        Some("DESKTOP-TOKO07")
    );
    assert_eq!(row.claimed_from.as_deref(), Some("10.0.4.23"));

    let approved = cloud::approve_node_enrolment(&pool, answer.enrolment_id, "admin")
        .await
        .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(approved.enrolment.status, "APPROVED");
    assert_eq!(approved.enrolment.active_generation, Some(1));

    // Registered with exactly the key the machine minted.
    let digest = cloud::origin_credential_digest(&pool, "store-07")
        .await
        .unwrap_or_else(|error| panic!("digest: {error}"))
        .unwrap_or_else(|| panic!("store-07 registered"));
    assert!(cloud::ingest_key_matches(&digest, KEY_A));
    assert_eq!(
        cloud::origin_site(&pool, "store-07")
            .await
            .unwrap_or_else(|error| panic!("site: {error}"))
            .as_deref(),
        Some("store-07")
    );

    // And the machine learns it, once it asks with its key.
    let delivered = cloud::node_enrolment_status(&pool, answer.enrolment_id, Some(KEY_A))
        .await
        .unwrap_or_else(|error| panic!("status: {error}"));
    assert_eq!(
        delivered,
        StatusAnswer::Approved {
            origin_id: "store-07".into(),
            site_id: "store-07".into(),
            node_role: "STORE".into(),
            active_generation: 1,
            label: Some("Toko uji".into()),
        }
    );

    // The bootstrap queued what a node joining late would otherwise wait for.
    let types = command_types(&pool, "store-07").await;
    assert!(
        types.iter().any(|t| t == "auth.policy.replace"),
        "users reach the new node: {types:?} / {}",
        approved.bootstrap
    );
    assert!(
        types.iter().any(|t| t == "catalog.snapshot.chunk"),
        "the catalogue reaches the new node: {types:?} / {}",
        approved.bootstrap
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_code_is_spent_once_and_a_claim_answers_only_its_own_key(pool: PgPool) {
    let issued = cloud::issue_node_enrolment(&pool, issue_request("store-03"), "admin")
        .await
        .unwrap_or_else(|error| panic!("issue: {error}"));
    let answer = cloud::claim_node_enrolment(&pool, claim(&issued.code, KEY_A), None)
        .await
        .unwrap_or_else(|error| panic!("claim: {error}"));

    let second = cloud::claim_node_enrolment(&pool, claim(&issued.code, KEY_B), None).await;
    assert!(matches!(second, Err(AppError::Forbidden(_))), "{second:?}");

    let unknown = cloud::claim_node_enrolment(&pool, claim("00000-00000", KEY_B), None).await;
    assert!(
        matches!(unknown, Err(AppError::Forbidden(_))),
        "{unknown:?}"
    );

    let wrong_key = cloud::node_enrolment_status(&pool, answer.enrolment_id, Some(KEY_B)).await;
    assert!(
        matches!(wrong_key, Err(AppError::Forbidden(_))),
        "{wrong_key:?}"
    );
    let no_key = cloud::node_enrolment_status(&pool, answer.enrolment_id, None).await;
    assert!(matches!(no_key, Err(AppError::Forbidden(_))), "{no_key:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_new_code_retires_the_old_one_and_a_refusal_registers_nothing(pool: PgPool) {
    let first = cloud::issue_node_enrolment(&pool, issue_request("store-04"), "admin")
        .await
        .unwrap_or_else(|error| panic!("issue: {error}"));
    let second = cloud::issue_node_enrolment(&pool, issue_request("store-04"), "admin")
        .await
        .unwrap_or_else(|error| panic!("reissue: {error}"));

    let stale = cloud::claim_node_enrolment(&pool, claim(&first.code, KEY_A), None).await;
    assert!(matches!(stale, Err(AppError::Forbidden(_))), "{stale:?}");
    let listed = cloud::list_node_enrolments(&pool)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    let status_of = |id| {
        listed
            .iter()
            .find(|row| row.enrolment_id == id)
            .map(|row| row.status)
    };
    assert_eq!(status_of(first.enrolment_id), Some("REVOKED"));
    assert_eq!(status_of(second.enrolment_id), Some("ISSUED"));

    let answer = cloud::claim_node_enrolment(&pool, claim(&second.code, KEY_A), None)
        .await
        .unwrap_or_else(|error| panic!("claim: {error}"));
    let refused = cloud::refuse_node_enrolment(&pool, answer.enrolment_id, "admin")
        .await
        .unwrap_or_else(|error| panic!("refuse: {error}"));
    assert_eq!(refused.status, "REJECTED");
    let late = cloud::approve_node_enrolment(&pool, answer.enrolment_id, "admin").await;
    assert!(matches!(late, Err(AppError::Conflict(_))), "{late:?}");
    assert!(cloud::origin_credential_digest(&pool, "store-04")
        .await
        .unwrap_or_else(|error| panic!("digest: {error}"))
        .is_none());
    assert_eq!(
        cloud::node_enrolment_status(&pool, answer.enrolment_id, Some(KEY_A))
            .await
            .unwrap_or_else(|error| panic!("status: {error}")),
        StatusAnswer::Refused {
            reason: "REJECTED".into()
        }
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_replacement_machine_starts_the_next_generation_and_locks_the_old_one_out(pool: PgPool) {
    for (key, expected_generation) in [(KEY_A, 1), (KEY_B, 2)] {
        if expected_generation > 1 {
            // A connected server is not handed over to whoever types a code:
            // no code while it is connected, one once it is let go (the store
            // page's Disconnect revokes its key the same way).
            let refused =
                cloud::issue_node_enrolment(&pool, issue_request("store-05"), "admin").await;
            assert!(matches!(refused, Err(AppError::Conflict(_))), "{refused:?}");
            sqlx::query(
                "UPDATE sync_origin_credential SET revoked_at = now() WHERE origin_id = $1",
            )
            .bind("store-05")
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("disconnect: {error}"));
        }
        let issued = cloud::issue_node_enrolment(&pool, issue_request("store-05"), "admin")
            .await
            .unwrap_or_else(|error| panic!("issue: {error}"));
        let answer = cloud::claim_node_enrolment(&pool, claim(&issued.code, key), None)
            .await
            .unwrap_or_else(|error| panic!("claim: {error}"));
        let approved = cloud::approve_node_enrolment(&pool, answer.enrolment_id, "admin")
            .await
            .unwrap_or_else(|error| panic!("approve: {error}"));
        assert_eq!(
            approved.enrolment.active_generation,
            Some(expected_generation)
        );
    }
    let digest = cloud::origin_credential_digest(&pool, "store-05")
        .await
        .unwrap_or_else(|error| panic!("digest: {error}"))
        .unwrap_or_else(|| panic!("registered"));
    assert!(cloud::ingest_key_matches(&digest, KEY_B));
    assert!(
        !cloud::ingest_key_matches(&digest, KEY_A),
        "the machine that was replaced can no longer speak for the shop"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_code_that_could_never_be_approved_is_never_issued(pool: PgPool) {
    let dc_role_at_a_shop: cloud::IssueNodeEnrolmentRequest =
        serde_json::from_value(serde_json::json!({ "site_id": "store-07", "node_role": "DC" }))
            .unwrap_or_else(|error| panic!("request: {error}"));
    let refused = cloud::issue_node_enrolment(&pool, dc_role_at_a_shop, "admin").await;
    assert!(
        matches!(refused, Err(AppError::Validation(_))),
        "{refused:?}"
    );

    let nowhere = cloud::issue_node_enrolment(&pool, issue_request("store-99"), "admin").await;
    assert!(matches!(nowhere, Err(AppError::NotFound(_))), "{nowhere:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_claimed_code_is_approved_at_once_as_the_admin_who_issued_it(pool: PgPool) {
    let issued = cloud::issue_node_enrolment(&pool, issue_request("store-07"), "rina")
        .await
        .unwrap_or_else(|error| panic!("issue: {error}"));
    let (answer, let_in) =
        cloud::claim_and_approve_node_enrolment(&pool, claim(&issued.code, KEY_A), None)
            .await
            .unwrap_or_else(|error| panic!("claim: {error}"));
    let let_in = let_in.unwrap_or_else(|| panic!("a claimed code is let in by itself"));
    assert_eq!(
        let_in.decided_by, "rina",
        "the decision is the Admin's who issued the code"
    );
    assert_eq!(
        answer.verification,
        verification_number(&issued.code.replace('-', ""), &key_digest(KEY_A)),
        "the six digits are still in the answer, for the nodes that show them"
    );

    // Nobody waits for anybody: the machine's first poll finds itself approved.
    let status = cloud::node_enrolment_status(&pool, answer.enrolment_id, Some(KEY_A))
        .await
        .unwrap_or_else(|error| panic!("status: {error}"));
    assert!(
        matches!(
            status,
            StatusAnswer::Approved {
                active_generation: 1,
                ..
            }
        ),
        "{status:?}"
    );

    // The first data is queued after the decision, and written down on the
    // enrolment: when, and which stretch of the node's command lane it took.
    cloud::finish_node_approval(&pool, &let_in)
        .await
        .unwrap_or_else(|error| panic!("first data: {error}"));
    let queued = command_types(&pool, "store-07").await.len() as i64;
    let (recorded, from, to): (bool, i64, i64) = sqlx::query_as(
        "SELECT bootstrap_at IS NOT NULL, COALESCE(bootstrap_from_seq, -1), COALESCE(bootstrap_seq, -1)
           FROM node_enrolment WHERE enrolment_id = $1",
    )
    .bind(answer.enrolment_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("enrolment: {error}"));
    assert!(recorded, "the first data is written down");
    assert!(queued > 0, "something was queued for the new node");
    assert_eq!(to - from, queued, "the range is exactly what was queued");
}
