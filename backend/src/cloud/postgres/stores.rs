//! Opening a store: how ready each store is, head office's "Open store", and
//! installing its server from the store's page.
//!
//! The agreed flow is `store-opening-flow.html`: head office drives it from
//! the hub, and only the physical steps happen at the shop — the server PC
//! installed, the tills switched on and let in, the team's fingers enrolled,
//! the first lorry received. Each of those already writes something head
//! office keeps. This module reads them; it stores nothing of its own but the
//! decision itself (`unit.opened_at`, 0630).
//!
//! # A store's status is derived
//!
//! `CLOSED` when its unit is closed, `OPEN` once head office opened it,
//! `GETTING_READY` otherwise — never a word somebody sets.
//!
//! # The checks are read, never ticked
//!
//! | Check         | Required | Read from |
//! |---------------|----------|-----------|
//! | `server`      | yes | the heartbeat of the site's inventory-owner node (`site_node`, `node_heartbeat`), within 5 minutes |
//! | `tills`       | yes | an ACTIVE till in the register seen within 10 minutes (`device`); the detail says whether a test page came out in 7 days |
//! | `team`        | yes | somebody posted at the unit today, and a PIC in force (`employee_assignment`, `unit_pic`); fingerprints are information only |
//! | `payments`    | yes | a payment method switched on for the shop (`payment_method_site`) — cash counts; QRIS and debit are in the detail |
//! | `first_stock` | yes | a delivery received at the shop: a flow's RECEIVE stage done, or a node's receipt fact (`edge_goods_step`, 0625) |
//!
//! A checkbox somebody ticks would say what they believed; this says what is
//! true. It is the reasoning `setup.rs` gives for its task list.
//!
//! # Only stores
//!
//! Units of kind `STORE`. Head office and the Gudang are opened by the setup
//! wizard and have a page of their own later.

use super::{
    issue_node_enrolment, publish_auth_policy, raise_notification, recipients_with_role,
    IssueNodeEnrolmentRequest, NewNotification,
};
use crate::cloud::application::AppError;
use crate::sync::enrolment::{CLAIM_APPROVAL_WINDOW_HOURS, MAX_CODE_TTL_MINUTES};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;

/// How recent a server's heartbeat must be for it to count as online.
pub const SERVER_ONLINE_MINUTES: i64 = 5;
/// How recently a till must have signed a request to count as online.
pub const TILL_ONLINE_MINUTES: i64 = 10;
/// How far back a successful test page still counts.
pub const TEST_PRINT_FRESH_DAYS: i64 = 7;
/// The installer's address when head office has not set one
/// (`system_setting.store_installer_url`, 0631): on the hub's own origin.
pub const DEFAULT_STORE_INSTALLER_URL: &str = "/downloads/itulah-store-setup.msi";

// ── the wire ─────────────────────────────────────────────────────────────

/// The store's PIC in force today.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePic {
    pub employee_id: String,
    /// The person's name: their HR profile's, else the name on their login
    /// or their invitation. Their badge code only when none of those says.
    pub name: String,
    /// Their badge code (`ITL-62EF783F`), for a screen that shows it beside
    /// the name.
    pub code: String,
}

/// How many of the checks pass.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReadiness {
    pub done: i32,
    pub total: i32,
}

/// Where the store's server stands.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreServer {
    /// `NOT_INSTALLED`, `WAITING_TO_INSTALL` (a code is out, unclaimed),
    /// `WAITING_FOR_APPROVAL` (a machine claimed it), `SYNCING` (approved, no
    /// heartbeat yet), `ONLINE` or `OFFLINE` (heartbeat within five minutes,
    /// or not).
    pub state: String,
    /// The server's last heartbeat.
    pub last_seen_at: Option<DateTime<Utc>>,
    /// The enrolment to approve or refuse while one is waiting; otherwise the
    /// one that let the server in, when it came in that way.
    pub enrolment_id: Option<Uuid>,
}

/// The store's tills as head office's register holds them.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreTills {
    /// Tills in the register that are ACTIVE.
    pub active: i64,
    /// Of those, seen within ten minutes.
    pub online: i64,
    /// Tills waiting for a supervisor at the shop, as the server last said.
    pub waiting: i64,
    /// How many till seats the counter has — Kasir 1 to Kasir N
    /// (`site.till_count`, 0714). Head office's number: a machine sits at a
    /// seat, it does not add one. Nought for a store with no shop yet.
    pub seats: i32,
}

/// One store, as the Stores list shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreSummary {
    /// Internal. Routes take it; screens show `code` and `name`.
    pub unit_id: String,
    pub code: String,
    pub name: String,
    /// `GETTING_READY`, `OPEN` or `CLOSED`, derived (0630).
    pub status: String,
    pub opened_at: Option<DateTime<Utc>>,
    /// The store's shop. Absent only for a store unit with no premises yet.
    pub site_id: Option<String>,
    pub site_code: Option<String>,
    pub city: Option<String>,
    /// IANA name.
    pub timezone: Option<String>,
    pub pic: Option<StorePic>,
    pub readiness: StoreReadiness,
    pub server: StoreServer,
    pub tills: StoreTills,
}

/// One thing that must be true before a store opens.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreCheck {
    /// `server`, `tills`, `team`, `payments` or `first_stock`.
    pub key: String,
    pub ok: bool,
    pub required: bool,
    pub title: String,
    /// What the data says, in a sentence.
    pub detail: String,
}

/// One store's page.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreDetail {
    pub store: StoreSummary,
    /// The shop's address, as General Affairs keeps it.
    pub address: Option<String>,
    pub checks: Vec<StoreCheck>,
    /// Getting ready, and every required check passes.
    pub can_open: bool,
    /// Whether the caller may open the store and install its server — an
    /// Admin at head office. The hub hides both buttons otherwise; the
    /// server refuses them either way.
    pub can_manage: bool,
}

/// The stores within the caller's reach: every one for head office, the
/// owner, an Admin and IT; their own for a store's manager or supervisor.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreList {
    pub items: Vec<StoreSummary>,
    /// Whether the caller may open new stores and install servers — an Admin
    /// at head office. The hub hides those buttons otherwise; the server
    /// refuses them either way.
    pub can_manage: bool,
}

/// Which stores a caller may read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StoreReach {
    /// Every store: head office, the owner, an Admin, IT.
    Every,
    /// The one unit the caller is posted to.
    Unit(String),
    /// None: posted nowhere.
    Nothing,
}

impl StoreReach {
    pub fn covers(&self, unit_id: &str) -> bool {
        match self {
            Self::Every => true,
            Self::Unit(mine) => mine == unit_id,
            Self::Nothing => false,
        }
    }
}

/// `POST /api/v1/stores/{unit}/open`.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenStoreRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenedStore {
    pub unit_id: String,
    pub opened_at: DateTime<Utc>,
    pub opened_by: String,
}

/// `POST /api/v1/stores/{unit}/server/install`: the code to type at the shop,
/// shown once, with its QR and where the installer is.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreServerInstall {
    pub enrolment_id: Uuid,
    /// In its display form, `K7Q2M-X4PZ9`.
    pub code: String,
    pub expires_at: DateTime<Utc>,
    pub installer_url: String,
    /// An inline `<svg>` of a QR code that encodes `code`.
    pub qr_svg: String,
}

// ── what the data says about one store ──────────────────────────────────

/// Everything the checks read, for one store, in one row.
struct StoreFacts {
    unit_id: String,
    code: String,
    name: String,
    unit_status: String,
    opened_at: Option<DateTime<Utc>>,
    site_id: Option<String>,
    site_code: Option<String>,
    city: Option<String>,
    timezone: Option<String>,
    pic: Option<StorePic>,
    heartbeat_at: Option<DateTime<Utc>>,
    has_node: bool,
    tills_waiting: i64,
    pending_enrolment: Option<Uuid>,
    pending_claimed: bool,
    pending_expires_at: Option<DateTime<Utc>>,
    pending_verification: Option<String>,
    approved_enrolment: Option<Uuid>,
    tills_active: i64,
    tills_online: i64,
    till_seats: i32,
    test_print_ok_at: Option<DateTime<Utc>>,
    test_print_failed_at: Option<DateTime<Utc>>,
    people: i64,
    fingerprinted: i64,
    tenders: Vec<String>,
    received_reference: Option<String>,
    received_at: Option<DateTime<Utc>>,
    on_the_way: i64,
    address: Option<String>,
}

/// One statement for the list and the page alike, so the two can never
/// disagree about a store. `$1` narrows it to one unit; `$2`–`$5` are the
/// windows above, bound rather than spelled twice.
const STORE_FACTS: &str = "
    WITH store AS (
        SELECT u.id AS unit_id, u.code, u.name, u.status AS unit_status, u.opened_at,
               (now() AT TIME ZONE unit_business_timezone(u.id))::date AS today,
               shop.id AS site_id, shop.code AS site_code, shop.city,
               COALESCE(shop.till_count, 0) AS till_seats,
               CASE WHEN shop.id IS NULL THEN NULL
                    ELSE site_business_timezone(shop.id) END AS timezone
          FROM unit u
          LEFT JOIN LATERAL (
              SELECT s.id, s.code, s.city, s.till_count
                FROM site s
               WHERE s.unit_id = u.id
               ORDER BY (s.kind = 'STORE') DESC, s.id
               LIMIT 1
          ) shop ON true
         WHERE u.kind = 'STORE'
           AND ($1::text IS NULL OR u.id = $1)
    )
    SELECT st.unit_id, st.code, st.name, st.unit_status, st.opened_at,
           st.site_id, st.site_code, st.city, st.timezone, st.till_seats,
           pic.employee_id AS pic_employee_id, pic.pic_name, pic.pic_code,
           node.origin_id IS NOT NULL AS has_node,
           hb.received_at AS heartbeat_at,
           COALESCE(CASE WHEN jsonb_typeof(hb.status -> 'devices' -> 'terminals_waiting') = 'number'
                         THEN (hb.status -> 'devices' ->> 'terminals_waiting')::bigint END, 0)
               AS tills_waiting,
           pending.enrolment_id AS pending_enrolment_id,
           pending.claimed_at IS NOT NULL AS pending_claimed,
           pending.expires_at AS pending_expires_at,
           pending.verification AS pending_verification,
           approved.enrolment_id AS approved_enrolment_id,
           COALESCE(tills.active, 0) AS tills_active,
           COALESCE(tills.online, 0) AS tills_online,
           printed.ok_at AS test_print_ok_at,
           printed.failed_at AS test_print_failed_at,
           COALESCE(team.people, 0) AS people,
           COALESCE(team.fingerprinted, 0) AS fingerprinted,
           COALESCE(pay.tenders, ARRAY[]::text[]) AS tenders,
           COALESCE(flow_received.reference, node_received.reference) AS received_reference,
           COALESCE(flow_received.at, node_received.at) AS received_at,
           COALESCE(coming.documents, 0) AS on_the_way,
           NULLIF(btrim(addr.address), '') AS address
      FROM store st
      LEFT JOIN LATERAL (
          SELECT p.employee_id, e.code AS pic_code,
                 COALESCE(pr.full_name, login.display_name,
                          (SELECT i.name FROM user_invitation i
                            WHERE i.employee_id = p.employee_id
                            ORDER BY i.created_at DESC LIMIT 1),
                          e.code) AS pic_name
            FROM unit_pic p
            JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
            LEFT JOIN employee_profile pr ON pr.employee_id = p.employee_id
            LEFT JOIN app_user login ON login.employee_id = p.employee_id
           WHERE p.unit_id = st.unit_id
             AND p.valid_from <= st.today
             AND (p.valid_to IS NULL OR p.valid_to > st.today)
             AND EXISTS (SELECT 1 FROM employee_assignment a
                          WHERE a.employee_id = p.employee_id
                            AND a.unit_id = p.unit_id
                            AND a.valid_from <= st.today
                            AND (a.valid_to IS NULL OR a.valid_to >= st.today))
           ORDER BY p.valid_from DESC, p.id DESC
           LIMIT 1
      ) pic ON true
      LEFT JOIN site_node node ON node.site_id = st.site_id
      LEFT JOIN node_heartbeat hb ON hb.origin_id = node.origin_id
      LEFT JOIN LATERAL (
          SELECT e.enrolment_id, e.claimed_at, e.expires_at, e.verification
            FROM node_enrolment e
           WHERE e.site_id = st.site_id
             AND e.outcome IS NULL
             AND ((e.claimed_at IS NULL AND e.expires_at > now())
                  OR e.claimed_at + make_interval(hours => $2) > now())
           ORDER BY e.issued_at DESC
           LIMIT 1
      ) pending ON true
      LEFT JOIN LATERAL (
          SELECT e.enrolment_id
            FROM node_enrolment e
           WHERE e.site_id = st.site_id AND e.outcome = 'APPROVED'
           ORDER BY e.decided_at DESC
           LIMIT 1
      ) approved ON true
      LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE d.status = 'ACTIVE') AS active,
                 count(*) FILTER (WHERE d.status = 'ACTIVE'
                                    AND d.last_seen_at >= now() - make_interval(mins => $3))
                     AS online
            FROM device d
           WHERE d.site_id = st.site_id AND d.kind = 'TILL'
      ) tills ON true
      LEFT JOIN LATERAL (
          SELECT max(d.last_test_print_at) FILTER (WHERE d.last_test_print_ok) AS ok_at,
                 max(d.last_test_print_at) FILTER (WHERE NOT d.last_test_print_ok) AS failed_at
            FROM device d
           WHERE d.site_id = st.site_id
             AND d.kind IN ('TILL', 'PRINTER')
             AND d.status <> 'REVOKED'
             AND d.last_test_print_at >= now() - make_interval(days => $4)
      ) printed ON true
      LEFT JOIN LATERAL (
          SELECT count(DISTINCT a.employee_id) AS people,
                 count(DISTINCT a.employee_id) FILTER (
                     WHERE EXISTS (SELECT 1 FROM fingerprint_template f
                                    WHERE f.employee_id = a.employee_id)) AS fingerprinted
            FROM employee_assignment a
            JOIN employee e ON e.id = a.employee_id AND e.status = 'ACTIVE'
           WHERE a.unit_id = st.unit_id
             AND a.valid_from <= st.today
             AND (a.valid_to IS NULL OR a.valid_to >= st.today)
      ) team ON true
      LEFT JOIN LATERAL (
          SELECT array_agg(DISTINCT p.tender_type ORDER BY p.tender_type) AS tenders
            FROM payment_method_site m
            JOIN payment_method p ON p.code = m.method_code
           WHERE m.site_id = st.site_id AND p.is_active
      ) pay ON true
      LEFT JOIN LATERAL (
          SELECT d.document_number AS reference, s.done_at AS at
            FROM flow_stage_state s
            JOIN flow_document d ON d.id = s.document_id
           WHERE d.destination_site_id = st.site_id
             AND s.stage_kind = 'RECEIVE' AND s.status = 'DONE'
           ORDER BY s.done_at DESC NULLS LAST
           LIMIT 1
      ) flow_received ON true
      LEFT JOIN LATERAL (
          SELECT COALESCE(g.shipment_reference, g.delivery_id) AS reference,
                 g.occurred_at AS at
            FROM edge_goods_step g
           WHERE g.site_id = st.site_id AND g.kind = 'RECEIVED'
           ORDER BY g.occurred_at DESC
           LIMIT 1
      ) node_received ON true
      LEFT JOIN LATERAL (
          SELECT count(DISTINCT d.id) AS documents
            FROM flow_document d
            JOIN flow_stage_state s ON s.document_id = d.id
           WHERE d.destination_site_id = st.site_id
             AND d.status IN ('REQUESTED', 'CONFIRMED')
             AND s.stage_kind = 'RECEIVE' AND s.status IN ('PENDING', 'PARKED')
      ) coming ON true
      LEFT JOIN ga_location_detail addr ON addr.site_id = st.site_id
     ORDER BY st.code, st.unit_id";

async fn store_facts(
    connection: &mut PgConnection,
    unit_id: Option<&str>,
) -> Result<Vec<StoreFacts>, AppError> {
    let rows = sqlx::query(STORE_FACTS)
        .bind(unit_id)
        .bind(i32::try_from(CLAIM_APPROVAL_WINDOW_HOURS).unwrap_or(24))
        .bind(i32::try_from(TILL_ONLINE_MINUTES).unwrap_or(10))
        .bind(i32::try_from(TEST_PRINT_FRESH_DAYS).unwrap_or(7))
        .fetch_all(&mut *connection)
        .await?;
    rows.iter()
        .map(|row| -> Result<StoreFacts, AppError> {
            let pic_employee: Option<String> = row.try_get("pic_employee_id")?;
            let pic_name: Option<String> = row.try_get("pic_name")?;
            let pic_code: Option<String> = row.try_get("pic_code")?;
            Ok(StoreFacts {
                unit_id: row.try_get("unit_id")?,
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                unit_status: row.try_get("unit_status")?,
                opened_at: row.try_get("opened_at")?,
                site_id: row.try_get("site_id")?,
                site_code: row.try_get("site_code")?,
                city: row.try_get("city")?,
                timezone: row.try_get("timezone")?,
                pic: pic_employee.map(|employee_id| {
                    let code = pic_code.unwrap_or_else(|| employee_id.clone());
                    StorePic {
                        name: pic_name.unwrap_or_else(|| code.clone()),
                        code,
                        employee_id,
                    }
                }),
                heartbeat_at: row.try_get("heartbeat_at")?,
                has_node: row.try_get("has_node")?,
                tills_waiting: row.try_get("tills_waiting")?,
                pending_enrolment: row.try_get("pending_enrolment_id")?,
                pending_claimed: row.try_get("pending_claimed")?,
                pending_expires_at: row.try_get("pending_expires_at")?,
                pending_verification: row.try_get("pending_verification")?,
                approved_enrolment: row.try_get("approved_enrolment_id")?,
                tills_active: row.try_get("tills_active")?,
                tills_online: row.try_get("tills_online")?,
                till_seats: row.try_get("till_seats")?,
                test_print_ok_at: row.try_get("test_print_ok_at")?,
                test_print_failed_at: row.try_get("test_print_failed_at")?,
                people: row.try_get("people")?,
                fingerprinted: row.try_get("fingerprinted")?,
                tenders: row.try_get("tenders")?,
                received_reference: row.try_get("received_reference")?,
                received_at: row.try_get("received_at")?,
                on_the_way: row.try_get("on_the_way")?,
                address: row.try_get("address")?,
            })
        })
        .collect()
}

/// "12 s ago", "3 min ago", "5 h ago", "2 days ago".
fn ago(now: DateTime<Utc>, at: DateTime<Utc>) -> String {
    let seconds = (now - at).num_seconds().max(0);
    match seconds {
        0..=89 => format!("{seconds} s ago"),
        90..=5_399 => format!("{} min ago", seconds / 60),
        5_400..=172_799 => format!("{} h ago", seconds / 3_600),
        _ => format!("{} days ago", seconds / 86_400),
    }
}

/// "in 23 h", "in 40 min".
fn from_now(now: DateTime<Utc>, at: DateTime<Utc>) -> String {
    let seconds = (at - now).num_seconds().max(0);
    if seconds >= 5_400 {
        format!("in {} h", seconds / 3_600)
    } else {
        format!("in {} min", (seconds / 60).max(1))
    }
}

/// "3 people", "1 person".
fn people(count: i64) -> String {
    if count == 1 {
        "1 person".into()
    } else {
        format!("{count} people")
    }
}

/// One check, and the clause that names it when it fails.
struct Judged {
    check: StoreCheck,
    blocker: Option<String>,
}

fn server_state(facts: &StoreFacts, now: DateTime<Utc>) -> &'static str {
    let fresh = facts
        .heartbeat_at
        .is_some_and(|at| at >= now - Duration::minutes(SERVER_ONLINE_MINUTES));
    if fresh {
        return "ONLINE";
    }
    if facts.pending_enrolment.is_some() {
        return if facts.pending_claimed {
            "WAITING_FOR_APPROVAL"
        } else {
            "WAITING_TO_INSTALL"
        };
    }
    match (facts.has_node || facts.approved_enrolment.is_some(), facts.heartbeat_at) {
        (_, Some(_)) => "OFFLINE",
        (true, None) => "SYNCING",
        (false, None) => "NOT_INSTALLED",
    }
}

fn judge_server(facts: &StoreFacts, now: DateTime<Utc>) -> Judged {
    let state = server_state(facts, now);
    let ok = state == "ONLINE";
    let seen = facts.heartbeat_at.map(|at| ago(now, at));
    let detail = match state {
        "ONLINE" => format!(
            "Online · heartbeat {}",
            seen.unwrap_or_else(|| "just now".into())
        ),
        "WAITING_FOR_APPROVAL" => match &facts.pending_verification {
            Some(number) => format!(
                "Installed at the store · waiting for head office to approve it \
                 (verification number {number})"
            ),
            None => "Installed at the store · waiting for head office to approve it".into(),
        },
        "WAITING_TO_INSTALL" => match facts.pending_expires_at {
            Some(expires) => format!(
                "Install code issued · waiting to be installed at the store (the code \
                 expires {})",
                from_now(now, expires)
            ),
            None => "Install code issued · waiting to be installed at the store".into(),
        },
        "SYNCING" => "Approved · taking its first data, no heartbeat yet".into(),
        "OFFLINE" => format!(
            "Offline · last heartbeat {}",
            seen.unwrap_or_else(|| "never".into())
        ),
        _ => "Not installed yet · issue an install code from the store's Server page".into(),
    };
    Judged {
        check: StoreCheck {
            key: "server".into(),
            ok,
            required: true,
            title: "Store server".into(),
            detail,
        },
        blocker: (!ok).then(|| {
            format!("the store server has not sent a heartbeat in the last {SERVER_ONLINE_MINUTES} minutes")
        }),
    }
}

fn judge_tills(facts: &StoreFacts, now: DateTime<Utc>) -> Judged {
    let ok = facts.tills_online >= 1;
    let mut parts = vec![if facts.tills_active == 0 {
        "No till has joined yet".to_string()
    } else {
        format!(
            "{} of {} active till{} online",
            facts.tills_online,
            facts.tills_active,
            if facts.tills_active == 1 { "" } else { "s" }
        )
    }];
    if facts.tills_waiting > 0 {
        parts.push(format!(
            "{} waiting for a supervisor at the store",
            facts.tills_waiting
        ));
    }
    parts.push(match (facts.test_print_ok_at, facts.test_print_failed_at) {
        (Some(ok_at), _) => format!("test print OK {}", ago(now, ok_at)),
        (None, Some(failed_at)) => format!(
            "the last test print failed {}; none has succeeded in {TEST_PRINT_FRESH_DAYS} days",
            ago(now, failed_at)
        ),
        (None, None) => format!("no test print in the last {TEST_PRINT_FRESH_DAYS} days"),
    });
    Judged {
        check: StoreCheck {
            key: "tills".into(),
            ok,
            required: true,
            title: "Tills".into(),
            detail: parts.join(" · "),
        },
        blocker: (!ok).then(|| {
            format!("no active till has been seen in the last {TILL_ONLINE_MINUTES} minutes")
        }),
    }
}

fn judge_team(facts: &StoreFacts) -> Judged {
    let ok = facts.people >= 1 && facts.pic.is_some();
    let posted = if facts.people == 0 {
        "Nobody is posted at the store yet".to_string()
    } else {
        format!("{} posted", people(facts.people))
    };
    let pic = match &facts.pic {
        Some(pic) => format!("PIC {}", pic.name),
        None => "no PIC".into(),
    };
    let detail = format!(
        "{posted} · {pic} · fingerprints {}/{}",
        facts.fingerprinted, facts.people
    );
    let blocker = match (facts.people >= 1, facts.pic.is_some()) {
        (true, true) => None,
        (false, _) => Some("nobody is posted at the store".to_string()),
        (true, false) => Some("nobody is in charge of the store (no PIC)".to_string()),
    };
    Judged {
        check: StoreCheck {
            key: "team".into(),
            ok,
            required: true,
            title: "Team".into(),
            detail,
        },
        blocker,
    }
}

fn judge_payments(facts: &StoreFacts) -> Judged {
    let on = |tender: &str| facts.tenders.iter().any(|held| held == tender);
    let word = |tender: &str| if on(tender) { "on" } else { "not yet" };
    let ok = !facts.tenders.is_empty();
    let mut detail = format!(
        "Cash {} · QRIS {} · debit {}",
        word("CASH"),
        word("QRIS"),
        word("DEBIT_CARD")
    );
    let others: Vec<String> = facts
        .tenders
        .iter()
        .filter(|tender| !matches!(tender.as_str(), "CASH" | "QRIS" | "DEBIT_CARD"))
        .map(|tender| tender.to_ascii_lowercase().replace('_', " "))
        .collect();
    if !others.is_empty() {
        detail.push_str(&format!(" · also {}", others.join(", ")));
    }
    Judged {
        check: StoreCheck {
            key: "payments".into(),
            ok,
            required: true,
            title: "Payments".into(),
            detail,
        },
        blocker: (!ok).then(|| "no payment method is switched on for the store".to_string()),
    }
}

fn judge_first_stock(facts: &StoreFacts, now: DateTime<Utc>) -> Judged {
    let ok = facts.received_at.is_some() || facts.received_reference.is_some();
    let detail = match (&facts.received_reference, facts.received_at) {
        (Some(reference), Some(at)) => format!("Received {reference} {}", ago(now, at)),
        (Some(reference), None) => format!("Received {reference}"),
        (None, Some(at)) => format!("First delivery received {}", ago(now, at)),
        (None, None) if facts.on_the_way > 0 => format!(
            "Nothing received yet · {} shipment{} on the way",
            facts.on_the_way,
            if facts.on_the_way == 1 { "" } else { "s" }
        ),
        (None, None) => "Nothing received yet · allot the first stock to this store".into(),
    };
    Judged {
        check: StoreCheck {
            key: "first_stock".into(),
            ok,
            required: true,
            title: "First stock".into(),
            detail,
        },
        blocker: (!ok).then(|| "the store has not received its first delivery".to_string()),
    }
}

fn judge(facts: &StoreFacts, now: DateTime<Utc>) -> Vec<Judged> {
    vec![
        judge_server(facts, now),
        judge_tills(facts, now),
        judge_team(facts),
        judge_payments(facts),
        judge_first_stock(facts, now),
    ]
}

fn status_of(facts: &StoreFacts) -> &'static str {
    if facts.unit_status == "CLOSED" {
        "CLOSED"
    } else if facts.opened_at.is_some() {
        "OPEN"
    } else {
        "GETTING_READY"
    }
}

fn summary_of(facts: &StoreFacts, judged: &[Judged], now: DateTime<Utc>) -> StoreSummary {
    let done = judged.iter().filter(|one| one.check.ok).count();
    StoreSummary {
        unit_id: facts.unit_id.clone(),
        code: facts.code.clone(),
        name: facts.name.clone(),
        status: status_of(facts).into(),
        opened_at: facts.opened_at,
        site_id: facts.site_id.clone(),
        site_code: facts.site_code.clone(),
        city: facts.city.clone(),
        timezone: facts.timezone.clone(),
        pic: facts.pic.clone(),
        readiness: StoreReadiness {
            done: i32::try_from(done).unwrap_or(i32::MAX),
            total: i32::try_from(judged.len()).unwrap_or(i32::MAX),
        },
        server: StoreServer {
            state: server_state(facts, now).into(),
            last_seen_at: facts.heartbeat_at,
            enrolment_id: facts.pending_enrolment.or(facts.approved_enrolment),
        },
        tills: StoreTills {
            active: facts.tills_active,
            online: facts.tills_online,
            waiting: facts.tills_waiting,
            seats: facts.till_seats,
        },
    }
}

fn detail_of(facts: &StoreFacts, now: DateTime<Utc>) -> (StoreDetail, Vec<String>) {
    let judged = judge(facts, now);
    let store = summary_of(facts, &judged, now);
    let blockers: Vec<String> = judged
        .iter()
        .filter(|one| one.check.required && !one.check.ok)
        .filter_map(|one| one.blocker.clone())
        .collect();
    let can_open = store.status == "GETTING_READY" && blockers.is_empty();
    let detail = StoreDetail {
        store,
        address: facts.address.clone(),
        checks: judged.into_iter().map(|one| one.check).collect(),
        can_open,
        can_manage: false,
    };
    (detail, blockers)
}

// ── the reads ────────────────────────────────────────────────────────────

/// Which stores this login may read: every one when their job role signs in
/// at every server (the owner, an Admin, IT) or they are posted at head
/// office; otherwise the unit they are posted to, which for a store's manager
/// or supervisor is their store. The rung's own answer — an Admin reads every
/// store — is the handler's, before this is asked.
pub async fn store_reach(pool: &PgPool, username: &str) -> Result<StoreReach, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(r.node_reach = 'EVERY', false) AS every_server,
                a.unit_id, unit.kind
           FROM app_user u
           LEFT JOIN job_role r ON r.code = u.role_code
           LEFT JOIN employee_assignment a
                  ON a.employee_id = u.employee_id AND a.valid_to IS NULL
           LEFT JOIN unit ON unit.id = a.unit_id
          WHERE u.username = $1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(StoreReach::Nothing);
    };
    let every_server: bool = row.try_get("every_server")?;
    let unit_id: Option<String> = row.try_get("unit_id")?;
    let kind: Option<String> = row.try_get("kind")?;
    Ok(if every_server || kind.as_deref() == Some("HO") {
        StoreReach::Every
    } else {
        unit_id.map_or(StoreReach::Nothing, StoreReach::Unit)
    })
}

/// The stores within `reach`, by their client code.
pub async fn list_stores(
    pool: &PgPool,
    reach: &StoreReach,
    can_manage: bool,
) -> Result<StoreList, AppError> {
    let facts = match reach {
        StoreReach::Nothing => Vec::new(),
        StoreReach::Every => {
            let mut connection = pool.acquire().await?;
            store_facts(&mut connection, None).await?
        }
        // `STORE_FACTS` keeps units of kind STORE only, so somebody posted
        // at a unit that is not a store is given an empty list.
        StoreReach::Unit(unit_id) => {
            let mut connection = pool.acquire().await?;
            store_facts(&mut connection, Some(unit_id)).await?
        }
    };
    let now = Utc::now();
    let items = facts
        .iter()
        .map(|facts| summary_of(facts, &judge(facts, now), now))
        .collect();
    Ok(StoreList { items, can_manage })
}

/// One store's page: its summary, address and checks.
pub async fn store_detail(
    pool: &PgPool,
    unit_id: &str,
    can_manage: bool,
) -> Result<StoreDetail, AppError> {
    let mut connection = pool.acquire().await?;
    let facts = one_store(&mut connection, unit_id).await?;
    let mut detail = detail_of(&facts, Utc::now()).0;
    detail.can_manage = can_manage;
    Ok(detail)
}

async fn one_store(connection: &mut PgConnection, unit_id: &str) -> Result<StoreFacts, AppError> {
    store_facts(connection, Some(unit_id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("store {unit_id}")))
}

// ── opening ──────────────────────────────────────────────────────────────

/// Head office opens a store.
///
/// Refused, with every unmet check in one sentence, unless all the required
/// checks pass — read inside the same transaction that writes the decision,
/// with the unit locked, so two Admins pressing at once open it once. Every
/// Admin is told. Afterwards the store's nodes are sent a fresh auth policy,
/// whose site directory now says the store is open, so its tills may open a
/// shift without waiting for the twelve-hourly renewal; a node that cannot be
/// sent one now hears at that renewal instead, and the store is open either
/// way.
pub async fn open_store(
    pool: &PgPool,
    unit_id: &str,
    request: OpenStoreRequest,
    actor: &str,
) -> Result<OpenedStore, AppError> {
    let note = request
        .note
        .map(|note| note.trim().to_owned())
        .filter(|note| !note.is_empty());
    if note.as_ref().is_some_and(|note| note.chars().count() > 500) {
        return Err(AppError::Validation(
            "a note on opening a store is at most 500 characters".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let locked: Option<String> =
        sqlx::query_scalar("SELECT kind FROM unit WHERE id = $1 FOR UPDATE")
            .bind(unit_id)
            .fetch_optional(&mut *tx)
            .await?;
    match locked.as_deref() {
        Some("STORE") => {}
        Some(_) => {
            return Err(AppError::Conflict(format!(
                "{unit_id} is not a store; only a store is opened from here"
            )))
        }
        None => return Err(AppError::NotFound(format!("store {unit_id}"))),
    }
    let now = Utc::now();
    let facts = one_store(&mut *tx, unit_id).await?;
    let label = format!("{} ({})", facts.name, facts.code);
    match status_of(&facts) {
        "CLOSED" => {
            return Err(AppError::Conflict(format!(
                "{label} is closed; a closed store is not opened again from here"
            )))
        }
        "OPEN" => {
            let since = facts
                .opened_at
                .map(|at| format!(" since {}", at.format("%d %b %Y")))
                .unwrap_or_default();
            return Err(AppError::Conflict(format!(
                "{label} is already open{since}"
            )));
        }
        _ => {}
    }
    let (_, blockers) = detail_of(&facts, now);
    if !blockers.is_empty() {
        return Err(AppError::Conflict(format!(
            "{label} cannot open yet: {}.",
            blockers.join("; ")
        )));
    }
    let opened_at: DateTime<Utc> = sqlx::query_scalar(
        "UPDATE unit
            SET opened_at = now(), opened_by = $2, opened_note = $3, updated_at = now()
          WHERE id = $1
      RETURNING opened_at",
    )
    .bind(unit_id)
    .bind(actor)
    .bind(&note)
    .fetch_one(&mut *tx)
    .await?;
    let recipients = recipients_with_role(&mut tx, &["ADMIN"]).await?;
    raise_notification(
        &mut tx,
        NewNotification {
            kind: "store.opened",
            title: format!("Store {} is open", facts.name),
            body: match &note {
                Some(note) => format!("{actor} opened {label}: {note}"),
                None => format!("{actor} opened {label}. Its tills may open a shift now."),
            },
            subject: Some(("unit", unit_id.to_owned())),
            origin_id: None,
            payload: json!({
                "unit_id": unit_id,
                "code": facts.code,
                "opened_at": opened_at,
                "opened_by": actor,
            }),
        },
        &recipients,
    )
    .await?;
    tx.commit().await?;

    let origins: Vec<String> = sqlx::query_scalar(
        "SELECT c.origin_id
           FROM sync_origin_credential c
           JOIN site s ON s.id = c.site_id
          WHERE s.unit_id = $1
          ORDER BY c.origin_id",
    )
    .bind(unit_id)
    .fetch_all(pool)
    .await?;
    for origin in origins {
        if let Err(error) = publish_auth_policy(pool, &origin, actor).await {
            tracing::warn!(%origin, %error, "the opened store's node was not sent its policy now; it hears at the next renewal");
        }
    }
    Ok(OpenedStore {
        unit_id: unit_id.to_owned(),
        opened_at,
        opened_by: actor.to_owned(),
    })
}

// ── the seats at the counter ────────────────────────────────────────────

/// Set how many till seats a store's counter has: Kasir 1 to Kasir `count`.
///
/// Head office's number and nobody else's — the owner's rule that a till is a
/// seat the store has, not a machine that joined. Fewer seats never ends a
/// shift: a drawer open at a seat that is gone stays listed at the shop until
/// it is closed, and no new one opens there. The store's nodes are sent a
/// fresh policy so the shop hears now rather than at the twelve-hourly
/// renewal; a node that cannot be reached hears then, and the number stands.
pub async fn set_till_seats(
    pool: &PgPool,
    unit_id: &str,
    count: i32,
    actor: &str,
) -> Result<StoreDetail, AppError> {
    if !(1..=50).contains(&count) {
        return Err(AppError::Validation(
            "a store has between 1 and 50 till seats".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let kind: Option<String> = sqlx::query_scalar("SELECT kind FROM unit WHERE id = $1 FOR UPDATE")
        .bind(unit_id)
        .fetch_optional(&mut *tx)
        .await?;
    match kind.as_deref() {
        Some("STORE") => {}
        Some(_) => {
            return Err(AppError::Conflict(format!(
                "{unit_id} is not a store; only a store has till seats"
            )))
        }
        None => return Err(AppError::NotFound(format!("store {unit_id}"))),
    }
    let updated = sqlx::query(
        "UPDATE site SET till_count = $2
          WHERE id = (SELECT s.id FROM site s WHERE s.unit_id = $1
                       ORDER BY (s.kind = 'STORE') DESC, s.id LIMIT 1)",
    )
    .bind(unit_id)
    .bind(count)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "{unit_id} has no shop yet; add its premises before its till seats"
        )));
    }
    tx.commit().await?;

    let origins: Vec<String> = sqlx::query_scalar(
        "SELECT c.origin_id
           FROM sync_origin_credential c
           JOIN site s ON s.id = c.site_id
          WHERE s.unit_id = $1
          ORDER BY c.origin_id",
    )
    .bind(unit_id)
    .fetch_all(pool)
    .await?;
    for origin in origins {
        if let Err(error) = publish_auth_policy(pool, &origin, actor).await {
            tracing::warn!(%origin, %error, "the store's node was not sent its new till seats now; it hears at the next renewal");
        }
    }
    store_detail(pool, unit_id, true).await
}

// ── installing the server ───────────────────────────────────────────────

/// Where the person at the shop downloads the installer: head office's
/// setting, or the default beside the hub's own files.
async fn installer_url(pool: &PgPool) -> Result<String, AppError> {
    let set: Option<String> = sqlx::query_scalar(
        "SELECT value_text FROM system_setting WHERE setting_key = 'store_installer_url'",
    )
    .fetch_optional(pool)
    .await?;
    Ok(set
        .map(|url| url.trim().to_owned())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_STORE_INSTALLER_URL.to_owned()))
}

/// The code as a QR, inline SVG, for a phone or the installer's camera.
fn qr_svg(payload: &str) -> Result<String, AppError> {
    use qrcode::render::svg;
    use qrcode::{EcLevel, QrCode};
    let code = QrCode::with_error_correction_level(payload, EcLevel::M).map_err(|error| {
        AppError::Configuration(format!("cannot draw the install code as a QR: {error}"))
    })?;
    Ok(code
        .render()
        .min_dimensions(180, 180)
        .quiet_zone(true)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

/// Issue a code to install the store's server, from the store's page.
///
/// The same enrolment an Admin issues from System › Nodes
/// (`issue_node_enrolment`): a `STORE` node for the store's shop, valid for a
/// day, and any code still out for that shop withdrawn. Approving and refusing
/// the machine that claims it stay where they are
/// (`POST /api/v1/sync/enrollments/{id}/approve` and `…/refuse`).
pub async fn install_store_server(
    pool: &PgPool,
    unit_id: &str,
    actor: &str,
) -> Result<StoreServerInstall, AppError> {
    let mut connection = pool.acquire().await?;
    let facts = one_store(&mut connection, unit_id).await?;
    drop(connection);
    if status_of(&facts) == "CLOSED" {
        return Err(AppError::Conflict(format!(
            "{} ({}) is closed; its server is not installed again from here",
            facts.name, facts.code
        )));
    }
    let site_id = facts.site_id.clone().ok_or_else(|| {
        AppError::Conflict(format!(
            "{} ({}) has no shop yet, so there is nowhere to install a server",
            facts.name, facts.code
        ))
    })?;
    let issued = issue_node_enrolment(
        pool,
        IssueNodeEnrolmentRequest {
            site_id,
            node_role: Some("STORE".into()),
            label: Some(format!("{} {} server", facts.code, facts.name)),
            ttl_minutes: Some(MAX_CODE_TTL_MINUTES),
        },
        actor,
    )
    .await?;
    Ok(StoreServerInstall {
        enrolment_id: issued.enrolment_id,
        qr_svg: qr_svg(&issued.code)?,
        code: issued.code,
        expires_at: issued.expires_at,
        installer_url: installer_url(pool).await?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> StoreFacts {
        StoreFacts {
            unit_id: "store-c014".into(),
            code: "C014".into(),
            name: "Tegal".into(),
            unit_status: "ACTIVE".into(),
            opened_at: None,
            site_id: Some("store-c014".into()),
            site_code: Some("C014-TOKO".into()),
            city: Some("Tegal".into()),
            timezone: Some("Asia/Jakarta".into()),
            pic: None,
            heartbeat_at: None,
            has_node: false,
            tills_waiting: 0,
            pending_enrolment: None,
            pending_claimed: false,
            pending_expires_at: None,
            pending_verification: None,
            approved_enrolment: None,
            tills_active: 0,
            tills_online: 0,
            test_print_ok_at: None,
            test_print_failed_at: None,
            people: 0,
            fingerprinted: 0,
            tenders: vec!["CASH".into()],
            received_reference: None,
            received_at: None,
            on_the_way: 0,
            address: None,
        }
    }

    #[test]
    fn a_new_store_is_getting_ready_and_says_what_is_missing() {
        let now = Utc::now();
        let (detail, blockers) = detail_of(&facts(), now);
        assert_eq!(detail.store.status, "GETTING_READY");
        assert_eq!(detail.store.server.state, "NOT_INSTALLED");
        assert!(!detail.can_open);
        // Cash is on from the day a store is opened in the wizard.
        assert_eq!(detail.store.readiness.done, 1);
        assert_eq!(detail.store.readiness.total, 5);
        assert_eq!(blockers.len(), 4);
    }

    #[test]
    fn a_store_whose_checks_all_pass_may_open() {
        let now = Utc::now();
        let mut ready = facts();
        ready.heartbeat_at = Some(now - Duration::seconds(20));
        ready.has_node = true;
        ready.tills_active = 1;
        ready.tills_online = 1;
        ready.people = 3;
        ready.pic = Some(StorePic {
            employee_id: "e1".into(),
            name: "Rina".into(),
            code: "ITL-62EF783F".into(),
        });
        ready.received_reference = Some("ALR-00000012".into());
        ready.received_at = Some(now - Duration::hours(2));
        let (detail, blockers) = detail_of(&ready, now);
        assert!(blockers.is_empty(), "{blockers:?}");
        assert!(detail.can_open);
        assert_eq!(detail.store.server.state, "ONLINE");

        ready.opened_at = Some(now);
        let (detail, _) = detail_of(&ready, now);
        assert_eq!(detail.store.status, "OPEN");
        assert!(!detail.can_open);
    }

    #[test]
    fn the_server_state_follows_the_enrolment_and_the_heartbeat() {
        let now = Utc::now();
        let mut store = facts();
        store.pending_enrolment = Some(Uuid::nil());
        assert_eq!(server_state(&store, now), "WAITING_TO_INSTALL");
        store.pending_claimed = true;
        assert_eq!(server_state(&store, now), "WAITING_FOR_APPROVAL");
        store.pending_enrolment = None;
        store.approved_enrolment = Some(Uuid::nil());
        assert_eq!(server_state(&store, now), "SYNCING");
        store.heartbeat_at = Some(now - Duration::minutes(30));
        assert_eq!(server_state(&store, now), "OFFLINE");
        store.heartbeat_at = Some(now - Duration::minutes(1));
        assert_eq!(server_state(&store, now), "ONLINE");
    }
}
