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
//! | `server`      | yes | the heartbeat of the site's inventory-owner node (`site_node`, `node_heartbeat`), within 5 minutes, and — for a server let in by an install code — the first data it was sent (`node_enrolment.bootstrap_seq`) acknowledged (`sync_command_cursor.acked_seq`) |
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
use crate::sync::enrolment::{CLAIM_APPROVAL_WINDOW_HOURS, DEFAULT_CODE_TTL_MINUTES};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
pub const DEFAULT_STORE_INSTALLER_URL: &str =
    "https://storage.googleapis.com/itulah-central-desktop/store-server/latest.msi";

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
    /// `WAITING_FOR_APPROVAL` (a machine claimed it and could not be let in by
    /// itself, so somebody decides), `SYNCING` (let in, still taking its first
    /// data: the data head office queued for it is not all acknowledged yet),
    /// `ONLINE` (ready: a heartbeat within five minutes and the first data
    /// taken) or `OFFLINE` (no heartbeat within five minutes).
    pub state: String,
    /// The server's last heartbeat.
    pub last_seen_at: Option<DateTime<Utc>>,
    /// The enrolment to approve or refuse while one is waiting; otherwise the
    /// one that let the server in, when it came in that way.
    pub enrolment_id: Option<Uuid>,
    /// The machine that is this store's server, once one has claimed the
    /// code: what it said when it claimed, then what its heartbeat says.
    pub machine: Option<StoreServerMachine>,
    /// When the machine was connected: the moment it read its approval, else
    /// when it was let in, else when its credential was made.
    pub connected_at: Option<DateTime<Utc>>,
    /// How far the server is in taking its first data. Present while `state`
    /// is `SYNCING`.
    pub first_data: Option<StoreFirstData>,
    /// Where the shop's own screens answer on its network
    /// (`http://192.168.1.20:8082`), as the server reported it in its
    /// heartbeat. Present once `state` is `ONLINE`, when the server reported
    /// one.
    pub app_address: Option<String>,
    /// An inline `<svg>` of a QR code that encodes `app_address`.
    pub app_qr_svg: Option<String>,
    /// Records the server still had to send head office, as of its last
    /// heartbeat (`last_seen_at`). What a Disconnect would strand.
    pub waiting_records: Option<i32>,
    /// Cash drawers open at its tills, as of its last heartbeat.
    pub open_drawers: Option<i32>,
    /// Until when head office's Prepare for removal lets the machine serving
    /// the store now be uninstalled (`edge/removal.rs`); none when it was
    /// never released, or the day is over.
    pub released_until: Option<DateTime<Utc>>,
}

/// The computer that serves a store.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreServerMachine {
    /// The machine's name, as it calls itself.
    pub hostname: String,
    /// Its operating system, as it reported it (`windows x86_64`).
    pub os: String,
    /// The server software's version.
    pub version: String,
}

/// A new server taking the data head office queued for it when it was let in.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreFirstData {
    /// Streams the server has taken completely.
    pub done: i32,
    /// Streams it was sent.
    pub total: i32,
    pub streams: Vec<StoreFirstDataStream>,
}

/// One kind of data in the first delivery.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreFirstDataStream {
    /// `articles`, `price_books`, `staff`, `payment_methods`, `promotions`,
    /// `orders`, `other` — or `all` when the delivery is not told apart.
    pub key: String,
    /// What a person reads: `Articles`, `Price books`, `Staff`…
    pub label: String,
    /// Whether the server has taken every command of this kind.
    pub done: bool,
    /// How many there are, when head office knows: the articles in the
    /// catalogue, the price books published, the people on the roster.
    pub count: Option<i64>,
    /// Commands of this kind the server has taken, and how many were sent:
    /// what moves while a stream is still coming in, which `done` cannot show
    /// until its last command (C001, 30 Oct 2026: "0 of 4" for a quarter of an
    /// hour). Both 0 when the delivery is not told apart.
    pub taken: i64,
    pub queued: i64,
}

/// The store's tills as head office's register holds them.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreTills {
    /// Tills in the register that are ACTIVE.
    pub active: i64,
    /// Of those, seen within ten minutes.
    pub online: i64,
    /// New POS waiting for head office's approval, as the server last said.
    pub waiting: i64,
    /// How many till seats the counter has — Kasir 1 to Kasir N
    /// (`site.till_count`, 0714). Head office's number: a machine sits at a
    /// seat, it does not add one. Nought for a store with no shop yet.
    pub seats: i32,
    /// A person may be signed in on one device at a time here
    /// (`site.one_device_sign_in`, 0995). Head office's switch.
    pub one_device: bool,
}

/// One store, as the Stores list shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreSummary {
    /// Internal. Routes take it; screens show `code` and `name`.
    pub unit_id: String,
    pub code: String,
    pub name: String,
    /// `GETTING_READY`, `OPEN`, `STOPPED` or `CLOSED`, derived (0630, 0990).
    /// The hub says "Removed" for `CLOSED`.
    pub status: String,
    pub opened_at: Option<DateTime<Utc>>,
    /// Head office's stop (0990): while the store is stopped, and kept once it
    /// is removed, so its page still says why.
    pub stop: Option<StoreStop>,
    /// When head office removed the store for good, and who (0990).
    pub removed_at: Option<DateTime<Utc>>,
    pub removed_by: Option<String>,
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
    /// Fingers recorded at the store's POS, waiting for head office's
    /// approval on its People tab.
    pub fingers_waiting: i64,
}

/// Head office stopped a store's tills (0990): when, who, and why.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreStop {
    pub at: DateTime<Utc>,
    pub by: String,
    pub reason: String,
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
    stopped_at: Option<DateTime<Utc>>,
    stopped_by: Option<String>,
    stopped_reason: Option<String>,
    closed_at: Option<DateTime<Utc>>,
    closed_by: Option<String>,
    site_id: Option<String>,
    site_code: Option<String>,
    city: Option<String>,
    timezone: Option<String>,
    pic: Option<StorePic>,
    heartbeat_at: Option<DateTime<Utc>>,
    has_node: bool,
    tills_waiting: i64,
    /// Fingers recorded at the store's POS, waiting for head office.
    fingers_waiting: i64,
    pending_enrolment: Option<Uuid>,
    pending_claimed: bool,
    /// What the machine that claimed the pending code said about itself.
    pending_machine: Option<Value>,
    approved_enrolment: Option<Uuid>,
    /// The origin the approved enrolment registered.
    approved_origin: Option<String>,
    /// What the machine said about itself when it claimed.
    approved_machine: Option<Value>,
    approved_delivered_at: Option<DateTime<Utc>>,
    approved_decided_at: Option<DateTime<Utc>>,
    /// When the first data was queued for the approved server, the command
    /// range it took on that server's lane (`from` exclusive, `to`
    /// inclusive), whether a stream failed, and the report (`counts` in it).
    bootstrap_at: Option<DateTime<Utc>>,
    bootstrap_from_seq: Option<i64>,
    bootstrap_seq: Option<i64>,
    bootstrap_failed: bool,
    bootstrap_report: Option<Value>,
    /// The first time the approved server was ready.
    ready_at: Option<DateTime<Utc>>,
    /// The position on its lane the server has acknowledged.
    acked_seq: i64,
    /// By command type: how many of the first data were queued, how many the
    /// server has taken. Read only while the server is still taking it.
    first_data_commands: Vec<(String, i64, i64)>,
    node_created_at: Option<DateTime<Utc>>,
    hb_version: Option<String>,
    hb_hostname: Option<String>,
    hb_os: Option<String>,
    hb_app_address: Option<String>,
    /// From the last heartbeat: records still to send, drawers open.
    hb_waiting: Option<i64>,
    hb_open_drawers: Option<i64>,
    /// The machine serving now was released for removal until then.
    released_until: Option<DateTime<Utc>>,
    tills_active: i64,
    tills_online: i64,
    till_seats: i32,
    one_device: bool,
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
               u.stopped_at, u.stopped_by, u.stopped_reason, u.closed_at, u.closed_by,
               (now() AT TIME ZONE unit_business_timezone(u.id))::date AS today,
               shop.id AS site_id, shop.code AS site_code, shop.city,
               COALESCE(shop.till_count, 0) AS till_seats,
               COALESCE(shop.one_device_sign_in, false) AS one_device,
               CASE WHEN shop.id IS NULL THEN NULL
                    ELSE site_business_timezone(shop.id) END AS timezone
          FROM unit u
          LEFT JOIN LATERAL (
              SELECT s.id, s.code, s.city, s.till_count, s.one_device_sign_in
                FROM site s
               WHERE s.unit_id = u.id
               ORDER BY (s.kind = 'STORE') DESC, s.id
               LIMIT 1
          ) shop ON true
         WHERE u.kind = 'STORE'
           AND ($1::text IS NULL OR u.id = $1)
    )
    SELECT st.unit_id, st.code, st.name, st.unit_status, st.opened_at,
           st.stopped_at, st.stopped_by, st.stopped_reason, st.closed_at, st.closed_by,
           st.site_id, st.site_code, st.city, st.timezone, st.till_seats, st.one_device,
           pic.employee_id AS pic_employee_id, pic.pic_name, pic.pic_code,
           (node.origin_id IS NOT NULL AND cred.revoked_at IS NULL) AS has_node,
           cred.created_at AS node_created_at,
           hb.received_at AS heartbeat_at,
           hb.version AS hb_version,
           hb.status ->> 'hostname' AS hb_hostname,
           hb.status ->> 'os' AS hb_os,
           hb.status ->> 'app_address' AS hb_app_address,
           CASE WHEN jsonb_typeof(hb.status -> 'sync' -> 'pending_facts') = 'number'
                THEN (hb.status -> 'sync' ->> 'pending_facts')::bigint END AS hb_waiting,
           CASE WHEN jsonb_typeof(hb.status -> 'till' -> 'open_shifts') = 'number'
                THEN (hb.status -> 'till' ->> 'open_shifts')::bigint END AS hb_open_drawers,
           released.until AS released_until,
           COALESCE(cur.acked_seq, 0) AS acked_seq,
           COALESCE(CASE WHEN jsonb_typeof(hb.status -> 'devices' -> 'terminals_waiting') = 'number'
                         THEN (hb.status -> 'devices' ->> 'terminals_waiting')::bigint END, 0)
               AS tills_waiting,
           (SELECT count(*) FROM fingerprint_submission f
              JOIN sync_origin_credential fo ON fo.origin_id = f.origin_id
              JOIN site fs ON fs.id = fo.site_id
             WHERE fs.unit_id = st.unit_id AND f.status = 'PENDING') AS fingers_waiting,
           pending.enrolment_id AS pending_enrolment_id,
           pending.claimed_at IS NOT NULL AS pending_claimed,
           pending.machine AS pending_machine,
           approved.enrolment_id AS approved_enrolment_id,
           approved.origin_id AS approved_origin,
           approved.machine AS approved_machine,
           approved.delivered_at AS approved_delivered_at,
           approved.decided_at AS approved_decided_at,
           approved.bootstrap_at AS bootstrap_at,
           approved.bootstrap_from_seq AS bootstrap_from_seq,
           approved.bootstrap_seq AS bootstrap_seq,
           COALESCE(approved.bootstrap_failed, false) AS bootstrap_failed,
           approved.bootstrap_report AS bootstrap_report,
           approved.ready_at AS ready_at,
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
      LEFT JOIN sync_origin_credential cred ON cred.origin_id = node.origin_id
      LEFT JOIN sync_command_cursor cur ON cur.origin_id = node.origin_id
      LEFT JOIN node_heartbeat hb ON hb.origin_id = node.origin_id AND cred.revoked_at IS NULL
      LEFT JOIN LATERAL (
          SELECT e.enrolment_id, e.claimed_at, e.machine
            FROM node_enrolment e
           WHERE e.site_id = st.site_id
             AND e.outcome IS NULL
             AND ((e.claimed_at IS NULL AND e.expires_at > now())
                  OR e.claimed_at + make_interval(hours => $2) > now())
           ORDER BY e.issued_at DESC
           LIMIT 1
      ) pending ON true
      LEFT JOIN LATERAL (
          SELECT e.enrolment_id, e.origin_id, e.machine, e.delivered_at, e.decided_at,
                 e.bootstrap_at, e.bootstrap_from_seq, e.bootstrap_seq,
                 e.bootstrap_failed, e.bootstrap_report, e.ready_at
            FROM node_enrolment e
           WHERE e.site_id = st.site_id AND e.outcome = 'APPROVED'
             AND e.disconnected_at IS NULL
           ORDER BY e.decided_at DESC
           LIMIT 1
      ) approved ON true
      LEFT JOIN LATERAL (
          SELECT CASE WHEN jsonb_typeof(a.detail -> 'released_until') = 'string'
                      THEN (a.detail ->> 'released_until')::timestamptz END AS until
            FROM store_action a
           WHERE a.origin_id = node.origin_id AND cred.revoked_at IS NULL
             AND a.action_key = 'prepare_removal' AND a.state = 'DONE'
             AND a.requested_at >= COALESCE(approved.decided_at, cred.created_at)
           ORDER BY a.finished_at DESC NULLS LAST
           LIMIT 1
      ) released ON true
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
    let mut stores = rows
        .iter()
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
                stopped_at: row.try_get("stopped_at")?,
                stopped_by: row.try_get("stopped_by")?,
                stopped_reason: row.try_get("stopped_reason")?,
                closed_at: row.try_get("closed_at")?,
                closed_by: row.try_get("closed_by")?,
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
                fingers_waiting: row.try_get("fingers_waiting")?,
                pending_enrolment: row.try_get("pending_enrolment_id")?,
                pending_claimed: row.try_get("pending_claimed")?,
                pending_machine: row.try_get("pending_machine")?,
                approved_enrolment: row.try_get("approved_enrolment_id")?,
                approved_origin: row.try_get("approved_origin")?,
                approved_machine: row.try_get("approved_machine")?,
                approved_delivered_at: row.try_get("approved_delivered_at")?,
                approved_decided_at: row.try_get("approved_decided_at")?,
                bootstrap_at: row.try_get("bootstrap_at")?,
                bootstrap_from_seq: row.try_get("bootstrap_from_seq")?,
                bootstrap_seq: row.try_get("bootstrap_seq")?,
                bootstrap_failed: row.try_get("bootstrap_failed")?,
                bootstrap_report: row.try_get("bootstrap_report")?,
                ready_at: row.try_get("ready_at")?,
                acked_seq: row.try_get("acked_seq")?,
                first_data_commands: Vec::new(),
                node_created_at: row.try_get("node_created_at")?,
                hb_version: row.try_get("hb_version")?,
                hb_hostname: row.try_get("hb_hostname")?,
                hb_os: row.try_get("hb_os")?,
                hb_app_address: row.try_get("hb_app_address")?,
                hb_waiting: row.try_get("hb_waiting")?,
                hb_open_drawers: row.try_get("hb_open_drawers")?,
                released_until: row.try_get("released_until")?,
                tills_active: row.try_get("tills_active")?,
                tills_online: row.try_get("tills_online")?,
                till_seats: row.try_get("till_seats")?,
                one_device: row.try_get("one_device")?,
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
        .collect::<Result<Vec<StoreFacts>, AppError>>()?;
    // A server still taking its first data is shown stream by stream: what
    // was queued for it, by kind, and how much of it it has acknowledged.
    for store in &mut stores {
        if !store.getting_first_data() || store.bootstrap_failed {
            continue;
        }
        if let (Some(origin), Some(from), Some(to)) = (
            store.approved_origin.clone(),
            store.bootstrap_from_seq,
            store.bootstrap_seq,
        ) {
            store.first_data_commands =
                first_data_commands(&mut *connection, &origin, from, to, store.acked_seq).await?;
        }
    }
    Ok(stores)
}

/// What head office queued for a server when it was let in, by command type:
/// how many commands, and how many of them the server has acknowledged.
/// Positions only — the payloads are never read.
async fn first_data_commands(
    connection: &mut PgConnection,
    origin_id: &str,
    from_seq: i64,
    to_seq: i64,
    acked_seq: i64,
) -> Result<Vec<(String, i64, i64)>, AppError> {
    let rows = sqlx::query(
        "SELECT c.command_type,
                count(*)::bigint AS queued,
                (count(*) FILTER (WHERE d.seq <= $4))::bigint AS taken
           FROM sync_command_delivery d
           JOIN sync_command c ON c.command_id = d.command_id
          WHERE d.origin_id = $1 AND d.seq > $2 AND d.seq <= $3
          GROUP BY c.command_type",
    )
    .bind(origin_id)
    .bind(from_seq)
    .bind(to_seq)
    .bind(acked_seq)
    .fetch_all(&mut *connection)
    .await?;
    rows.iter()
        .map(|row| -> Result<(String, i64, i64), AppError> {
            Ok((
                row.try_get("command_type")?,
                row.try_get("queued")?,
                row.try_get("taken")?,
            ))
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

impl StoreFacts {
    /// A server let in by an install code that has not yet been ready: it is
    /// still taking the data head office queued for it. A server that came in
    /// some other way (provisioned by hand, or let in before 0966) has no
    /// first data to wait for.
    fn getting_first_data(&self) -> bool {
        self.approved_enrolment.is_some() && self.ready_at.is_none() && !self.first_data_taken()
    }

    /// Everything head office queued for the server has been acknowledged by
    /// it. Never true while a stream failed, nor before the queueing ended —
    /// "nothing was queued yet" is not "nothing to take".
    fn first_data_taken(&self) -> bool {
        self.bootstrap_at.is_some()
            && !self.bootstrap_failed
            && self
                .bootstrap_seq
                .is_some_and(|queued| self.acked_seq >= queued)
    }
}

fn server_state(facts: &StoreFacts, now: DateTime<Utc>) -> &'static str {
    let fresh = facts
        .heartbeat_at
        .is_some_and(|at| at >= now - Duration::minutes(SERVER_ONLINE_MINUTES));
    if fresh {
        // Ready only once the first data is taken: a heartbeat alone says the
        // machine is up, not that it knows the shop's catalogue and staff.
        return if facts.getting_first_data() {
            "SYNCING"
        } else {
            "ONLINE"
        };
    }
    if facts.pending_enrolment.is_some() {
        return if facts.pending_claimed {
            "WAITING_FOR_APPROVAL"
        } else {
            "WAITING_TO_INSTALL"
        };
    }
    match (
        facts.has_node || facts.approved_enrolment.is_some(),
        facts.heartbeat_at,
    ) {
        (_, Some(_)) => "OFFLINE",
        (true, None) => "SYNCING",
        (false, None) => "NOT_INSTALLED",
    }
}

/// A text field the machine reported, trimmed; `None` when it said nothing.
fn said(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// One field of what the machine said when it claimed the code.
fn claimed(machine: Option<&Value>, key: &str) -> Option<String> {
    said(
        machine
            .and_then(|machine| machine.get(key))
            .and_then(Value::as_str),
    )
}

/// The computer behind the store's server: what its heartbeat says, else what
/// it said when it claimed the code. `None` until a machine has claimed one.
fn machine_of(facts: &StoreFacts, state: &str) -> Option<StoreServerMachine> {
    let waiting = state == "WAITING_FOR_APPROVAL";
    if matches!(state, "NOT_INSTALLED" | "WAITING_TO_INSTALL") {
        return None;
    }
    // A heartbeat on file belongs to the machine before this one while a
    // new claim is waiting to be decided.
    let (said_by, beating) = if waiting {
        (facts.pending_machine.as_ref(), false)
    } else {
        (facts.approved_machine.as_ref(), true)
    };
    let hostname = beating
        .then(|| said(facts.hb_hostname.as_deref()))
        .flatten()
        .or_else(|| claimed(said_by, "hostname"));
    let os = beating
        .then(|| said(facts.hb_os.as_deref()))
        .flatten()
        .or_else(
            || match (claimed(said_by, "os"), claimed(said_by, "arch")) {
                (Some(os), Some(arch)) => Some(format!("{os} {arch}")),
                (Some(os), None) => Some(os),
                _ => None,
            },
        );
    let version = beating
        .then(|| said(facts.hb_version.as_deref()))
        .flatten()
        .or_else(|| claimed(said_by, "version"));
    if hostname.is_none() && os.is_none() && version.is_none() {
        return None;
    }
    Some(StoreServerMachine {
        hostname: hostname.unwrap_or_default(),
        os: os.unwrap_or_default(),
        version: version.unwrap_or_default(),
    })
}

/// When the machine was connected: it read its approval, else it was let in,
/// else its credential was made (a server provisioned by hand).
fn connected_at_of(facts: &StoreFacts, state: &str) -> Option<DateTime<Utc>> {
    if matches!(
        state,
        "NOT_INSTALLED" | "WAITING_TO_INSTALL" | "WAITING_FOR_APPROVAL"
    ) {
        return None;
    }
    facts
        .approved_delivered_at
        .or(facts.approved_decided_at)
        .or(facts.node_created_at)
}

/// The streams the first data is told apart in, in the order a person reads
/// them, and the command types each is made of.
const FIRST_DATA_STREAMS: [(&str, &str); 7] = [
    ("articles", "Articles"),
    ("price_books", "Price books"),
    ("staff", "Staff"),
    ("payment_methods", "Payment methods"),
    ("promotions", "Promotions"),
    ("orders", "Open orders"),
    ("other", "Other data"),
];

fn first_data_stream_of(command_type: &str) -> usize {
    if command_type.starts_with("catalog.") {
        0
    } else if command_type.starts_with("commercial.publication") {
        1
    } else if command_type.starts_with("auth.") || command_type.starts_with("attendance.") {
        2
    } else if command_type.starts_with("payment.") {
        3
    } else if command_type.starts_with("commercial.") {
        4
    } else if command_type.starts_with("purchase.") || command_type.starts_with("tagging.") {
        5
    } else {
        6
    }
}

/// How many there are in a stream, from the count taken when it was queued
/// (`counts` in the stored report); `None` for a stream that was not counted.
fn first_data_count(facts: &StoreFacts, key: &str) -> Option<i64> {
    facts
        .bootstrap_report
        .as_ref()?
        .get("counts")?
        .get(key)?
        .as_i64()
}

/// Where the server is in taking its first data. One stream, "Store data",
/// until head office has finished queueing it (or when a stream failed and
/// is about to be sent again): the delivery cannot be told apart yet.
fn first_data_of(facts: &StoreFacts) -> StoreFirstData {
    let mut queued = [0_i64; FIRST_DATA_STREAMS.len()];
    let mut taken = [0_i64; FIRST_DATA_STREAMS.len()];
    for (command_type, sent, got) in &facts.first_data_commands {
        let stream = first_data_stream_of(command_type);
        queued[stream] += sent;
        taken[stream] += got;
    }
    let streams: Vec<StoreFirstDataStream> = FIRST_DATA_STREAMS
        .iter()
        .enumerate()
        .filter(|(index, _)| queued[*index] > 0)
        .map(|(index, (key, label))| StoreFirstDataStream {
            key: (*key).into(),
            label: (*label).into(),
            done: taken[index] >= queued[index],
            count: first_data_count(facts, key),
            taken: taken[index],
            queued: queued[index],
        })
        .collect();
    if streams.is_empty() {
        let done = facts.first_data_taken();
        return StoreFirstData {
            done: i32::from(done),
            total: 1,
            streams: vec![StoreFirstDataStream {
                key: "all".into(),
                label: "Store data".into(),
                done,
                count: None,
                taken: 0,
                queued: 0,
            }],
        };
    }
    let done = streams.iter().filter(|stream| stream.done).count();
    StoreFirstData {
        done: i32::try_from(done).unwrap_or(i32::MAX),
        total: i32::try_from(streams.len()).unwrap_or(i32::MAX),
        streams,
    }
}

/// The address the server reported for the shop's own screens, if it is one a
/// browser should be sent to: what a node says about itself is not trusted
/// further than that.
fn app_address_of(facts: &StoreFacts, state: &str) -> Option<String> {
    if state != "ONLINE" {
        return None;
    }
    let address = said(facts.hb_app_address.as_deref())?;
    let plain = address.len() <= 200
        && (address.starts_with("http://") || address.starts_with("https://"))
        && address
            .chars()
            .all(|character| character.is_ascii_graphic());
    plain.then_some(address)
}

fn judge_server(facts: &StoreFacts, now: DateTime<Utc>) -> Judged {
    let state = server_state(facts, now);
    let ok = state == "ONLINE";
    let named = |word: &str| match machine_of(facts, state) {
        Some(machine) if !machine.hostname.is_empty() => format!("{word} · {}", machine.hostname),
        _ => word.to_owned(),
    };
    let detail = match state {
        "ONLINE" => named("Ready"),
        "SYNCING" => named("Getting data"),
        _ => "Waiting for the server".to_owned(),
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
            if state == "SYNCING" {
                "the store server is still getting its first data".to_owned()
            } else {
                format!(
                    "the store server has not sent a heartbeat in the last \
                     {SERVER_ONLINE_MINUTES} minutes"
                )
            }
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
            "{} waiting for head office's approval",
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
    } else if facts.stopped_at.is_some() {
        "STOPPED"
    } else if facts.opened_at.is_some() {
        "OPEN"
    } else {
        "GETTING_READY"
    }
}

fn server_of(facts: &StoreFacts, now: DateTime<Utc>) -> StoreServer {
    let state = server_state(facts, now);
    let app_address = app_address_of(facts, state);
    StoreServer {
        state: state.into(),
        last_seen_at: facts.heartbeat_at,
        enrolment_id: facts.pending_enrolment.or(facts.approved_enrolment),
        machine: machine_of(facts, state),
        connected_at: connected_at_of(facts, state),
        first_data: (state == "SYNCING").then(|| first_data_of(facts)),
        // The QR is drawn here, from the address, the way the install code's
        // is; one that cannot be drawn is left out rather than failing the page.
        app_qr_svg: app_address
            .as_deref()
            .and_then(|address| qr_svg(address).ok()),
        app_address,
        // Only about a machine that is there: a heartbeat of one let go says
        // nothing about the store now.
        waiting_records: facts
            .has_node
            .then_some(facts.hb_waiting)
            .flatten()
            .map(|n| i32::try_from(n).unwrap_or(i32::MAX)),
        open_drawers: facts
            .has_node
            .then_some(facts.hb_open_drawers)
            .flatten()
            .map(|n| i32::try_from(n).unwrap_or(i32::MAX)),
        released_until: facts.released_until.filter(|until| *until > now),
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
        stop: match (facts.stopped_at, &facts.stopped_by, &facts.stopped_reason) {
            (Some(at), Some(by), Some(reason)) => Some(StoreStop {
                at,
                by: by.clone(),
                reason: reason.clone(),
            }),
            _ => None,
        },
        removed_at: facts.closed_at,
        removed_by: facts.closed_by.clone(),
        site_id: facts.site_id.clone(),
        site_code: facts.site_code.clone(),
        city: facts.city.clone(),
        timezone: facts.timezone.clone(),
        pic: facts.pic.clone(),
        readiness: StoreReadiness {
            done: i32::try_from(done).unwrap_or(i32::MAX),
            total: i32::try_from(judged.len()).unwrap_or(i32::MAX),
        },
        server: server_of(facts, now),
        tills: StoreTills {
            active: facts.tills_active,
            online: facts.tills_online,
            waiting: facts.tills_waiting,
            seats: facts.till_seats,
            one_device: facts.one_device,
        },
        fingers_waiting: facts.fingers_waiting,
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
        "STOPPED" => {
            return Err(AppError::Conflict(format!(
                "{label} is stopped; resume it rather than opening it again"
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

/// Switch whether a person may be signed in on one device at a time at the
/// store (owner, 24 Oct 2026). Sent to the store's servers at once, in their
/// auth policy; one that is not reached now hears at its next renewal.
pub async fn set_one_device(
    pool: &PgPool,
    unit_id: &str,
    on: bool,
    actor: &str,
) -> Result<StoreDetail, AppError> {
    let updated = sqlx::query(
        "UPDATE site SET one_device_sign_in = $2
          WHERE id = (SELECT s.id FROM site s JOIN unit u ON u.id = s.unit_id
                       WHERE s.unit_id = $1 AND u.kind = 'STORE'
                       ORDER BY (s.kind = 'STORE') DESC, s.id LIMIT 1)",
    )
    .bind(unit_id)
    .bind(on)
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound(format!("a store {unit_id} with a shop")));
    }
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
            tracing::warn!(%origin, %error, "the store's node was not sent the one-device rule now; it hears at the next renewal");
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
/// (`issue_node_enrolment`): a `STORE` node for the store's shop, valid for an
/// hour, and any code still out for that shop withdrawn. The code is the
/// proof: the machine that claims it in time is let in at once, as the Admin
/// who issued it (`node_enrolment::claim_and_approve_node_enrolment`). Deciding
/// a claim by hand stays where it is, for one that could not be let in by
/// itself (`POST /api/v1/sync/enrollments/{id}/approve` and `…/refuse`).
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
            ttl_minutes: Some(DEFAULT_CODE_TTL_MINUTES),
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

/// Disconnect the machine that serves a store, and issue the code for the
/// next one, from the store's page.
///
/// The old machine's key stops working at once: the credential stays (the
/// origin's history hangs on it, and the machine that replaces this one is let
/// in under the same origin), but its key is replaced by one nobody holds, and
/// `revoked_at` says why. Its last heartbeat is cleared, so the store's server
/// returns to `NOT_INSTALLED`; any code still out is withdrawn and the
/// enrolment that let the machine in no longer stands for a server. Then a
/// fresh code is issued exactly as `install_store_server` does, and returned.
///
/// A removed store (`CLOSED`) is let go the same way, and that is the end of
/// it: no code is issued, since no server is installed there again, and the
/// answer is `None`. Removing leaves the server connected on purpose, so the
/// sales it has not sent yet still arrive; this is the step after them.
///
/// Idempotent: with no machine connected there is nothing to revoke and the
/// answer is still a fresh code (or `None` for a closed store). The sales the
/// old machine had not sent are not lost — they are on its disk, and the
/// replacement's approval refuses the rollover while head office still lacks
/// some of them (`register_origin_digest_tx`), which is the moment somebody
/// decides.
pub async fn disconnect_store_server(
    pool: &PgPool,
    unit_id: &str,
    actor: &str,
) -> Result<Option<StoreServerInstall>, AppError> {
    let mut connection = pool.acquire().await?;
    let facts = one_store(&mut connection, unit_id).await?;
    drop(connection);
    let closed = status_of(&facts) == "CLOSED";
    let site_id = facts.site_id.clone().ok_or_else(|| {
        AppError::Conflict(format!(
            "{} ({}) has no shop yet, so there is no server to disconnect",
            facts.name, facts.code
        ))
    })?;

    let mut tx = pool.begin().await?;
    let revoked: Vec<String> = sqlx::query_scalar(
        "UPDATE sync_origin_credential
            SET ingest_key_sha256 = encode(
                    sha256(convert_to('revoked:' || origin_id || ':' || gen_random_uuid()::text,
                                      'UTF8')),
                    'hex'),
                revoked_at = now(),
                rotated_at = now()
          WHERE site_id = $1 AND revoked_at IS NULL
      RETURNING origin_id",
    )
    .bind(&site_id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM node_heartbeat WHERE origin_id = ANY($1)")
        .bind(&revoked)
        .execute(&mut *tx)
        .await?;
    // A code still out, or a claim not yet decided: withdrawn.
    sqlx::query(
        "UPDATE node_enrolment
            SET outcome = 'REVOKED', decided_by = $2, decided_at = now()
          WHERE site_id = $1 AND outcome IS NULL",
    )
    .bind(&site_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    // The enrolment that let the machine in no longer stands for a server.
    sqlx::query(
        "UPDATE node_enrolment
            SET disconnected_at = now(), disconnected_by = $2
          WHERE site_id = $1 AND outcome = 'APPROVED' AND disconnected_at IS NULL",
    )
    .bind(&site_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    tracing::info!(
        unit = %unit_id,
        %actor,
        machines = revoked.len(),
        closed,
        "a store's server was disconnected; its key no longer works"
    );
    if closed {
        return Ok(None);
    }
    install_store_server(pool, unit_id, actor).await.map(Some)
}

// ── the picture at the top of the receipt (1009) ─────────────────────────

use crate::cloud::domain::receipt_header::{
    HeaderBitmap, ReceiptHeader, NARROW_DOTS, NARROW_MAX_ROWS, WIDE_DOTS, WIDE_MAX_ROWS,
};

/// What the hub sends: both widths, already one bit a dot.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct SaveReceiptHeader {
    pub wide: HeaderBitmap,
    pub narrow: HeaderBitmap,
}

/// What the hub reads back.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ReceiptHeaderView {
    pub present: bool,
    pub wide: Option<HeaderBitmap>,
    pub narrow: Option<HeaderBitmap>,
    pub updated_by: Option<String>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// The picture for a site, as a node is told it. Always `Some`: an empty one
/// tells the node to drop what it held.
pub async fn receipt_header_for_site(
    pool: &PgPool,
    site_id: &str,
) -> Result<ReceiptHeader, AppError> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT wide_width,wide_height,wide_bits,narrow_width,narrow_height,narrow_bits
           FROM store_receipt_header WHERE site_id=$1",
    )
    .bind(site_id)
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        None => ReceiptHeader::default(),
        Some(row) => ReceiptHeader {
            wide: Some(HeaderBitmap::from_bytes(
                row.get::<i16, _>("wide_width") as u16,
                row.get::<i16, _>("wide_height") as u16,
                &row.get::<Vec<u8>, _>("wide_bits"),
            )),
            narrow: Some(HeaderBitmap::from_bytes(
                row.get::<i16, _>("narrow_width") as u16,
                row.get::<i16, _>("narrow_height") as u16,
                &row.get::<Vec<u8>, _>("narrow_bits"),
            )),
        },
    })
}

async fn site_of_unit(pool: &PgPool, unit_id: &str) -> Result<String, AppError> {
    let mut connection = pool.acquire().await?;
    let facts = one_store(&mut connection, unit_id).await?;
    facts.site_id.ok_or_else(|| {
        AppError::Conflict(format!(
            "{} ({}) has no shop yet, so it has no receipt",
            facts.name, facts.code
        ))
    })
}

pub async fn read_receipt_header(
    pool: &PgPool,
    unit_id: &str,
) -> Result<ReceiptHeaderView, AppError> {
    use sqlx::Row;
    let site_id = site_of_unit(pool, unit_id).await?;
    let header = receipt_header_for_site(pool, &site_id).await?;
    let meta =
        sqlx::query("SELECT updated_by,updated_at FROM store_receipt_header WHERE site_id=$1")
            .bind(&site_id)
            .fetch_optional(pool)
            .await?;
    Ok(ReceiptHeaderView {
        present: header.wide.is_some(),
        wide: header.wide,
        narrow: header.narrow,
        updated_by: meta.as_ref().map(|row| row.get("updated_by")),
        updated_at: meta.as_ref().map(|row| row.get("updated_at")),
    })
}

pub async fn save_receipt_header(
    pool: &PgPool,
    unit_id: &str,
    request: &SaveReceiptHeader,
    actor: &str,
) -> Result<ReceiptHeaderView, AppError> {
    if let Some(problem) = request.wide.problem(WIDE_DOTS, WIDE_MAX_ROWS) {
        return Err(AppError::Validation(format!("80 mm: {problem}")));
    }
    if let Some(problem) = request.narrow.problem(NARROW_DOTS, NARROW_MAX_ROWS) {
        return Err(AppError::Validation(format!("58 mm: {problem}")));
    }
    let wide = request.wide.bytes().unwrap_or_default();
    let narrow = request.narrow.bytes().unwrap_or_default();
    let site_id = site_of_unit(pool, unit_id).await?;
    sqlx::query(
        "INSERT INTO store_receipt_header
             (site_id,wide_height,wide_bits,narrow_height,narrow_bits,updated_by,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (site_id) DO UPDATE SET
             wide_height=excluded.wide_height, wide_bits=excluded.wide_bits,
             narrow_height=excluded.narrow_height, narrow_bits=excluded.narrow_bits,
             updated_by=excluded.updated_by, updated_at=now()",
    )
    .bind(&site_id)
    .bind(request.wide.height as i16)
    .bind(wide)
    .bind(request.narrow.height as i16)
    .bind(narrow)
    .bind(actor)
    .execute(pool)
    .await?;
    super::return_policy::tell_every_store(pool, actor).await;
    read_receipt_header(pool, unit_id).await
}

pub async fn clear_receipt_header(
    pool: &PgPool,
    unit_id: &str,
    actor: &str,
) -> Result<ReceiptHeaderView, AppError> {
    let site_id = site_of_unit(pool, unit_id).await?;
    sqlx::query("DELETE FROM store_receipt_header WHERE site_id=$1")
        .bind(&site_id)
        .execute(pool)
        .await?;
    super::return_policy::tell_every_store(pool, actor).await;
    read_receipt_header(pool, unit_id).await
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
            stopped_at: None,
            stopped_by: None,
            stopped_reason: None,
            closed_at: None,
            closed_by: None,
            site_id: Some("store-c014".into()),
            site_code: Some("C014-TOKO".into()),
            city: Some("Tegal".into()),
            timezone: Some("Asia/Jakarta".into()),
            pic: None,
            heartbeat_at: None,
            has_node: false,
            tills_waiting: 0,
            fingers_waiting: 0,
            pending_enrolment: None,
            pending_claimed: false,
            pending_machine: None,
            approved_enrolment: None,
            approved_origin: None,
            approved_machine: None,
            approved_delivered_at: None,
            approved_decided_at: None,
            bootstrap_at: None,
            bootstrap_from_seq: None,
            bootstrap_seq: None,
            bootstrap_failed: false,
            bootstrap_report: None,
            ready_at: None,
            acked_seq: 0,
            first_data_commands: Vec::new(),
            node_created_at: None,
            hb_version: None,
            hb_hostname: None,
            hb_os: None,
            hb_app_address: None,
            hb_waiting: None,
            hb_open_drawers: None,
            released_until: None,
            tills_active: 0,
            tills_online: 0,
            till_seats: 0,
            one_device: false,
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
        // A heartbeat is not yet a ready server: it has to take its first data.
        store.heartbeat_at = Some(now - Duration::minutes(1));
        assert_eq!(server_state(&store, now), "SYNCING");
        store.ready_at = Some(now);
        assert_eq!(server_state(&store, now), "ONLINE");
    }

    #[test]
    fn a_server_is_ready_when_it_has_acknowledged_what_was_queued_for_it() {
        let now = Utc::now();
        let mut store = facts();
        store.approved_enrolment = Some(Uuid::nil());
        store.heartbeat_at = Some(now - Duration::seconds(10));
        // Let in, and head office is still queueing: not ready, whatever it acked.
        assert_eq!(server_state(&store, now), "SYNCING");
        store.bootstrap_at = Some(now);
        store.bootstrap_seq = Some(12);
        store.acked_seq = 7;
        assert_eq!(server_state(&store, now), "SYNCING");
        // A stream that failed is not "nothing to take".
        store.acked_seq = 12;
        store.bootstrap_failed = true;
        assert_eq!(server_state(&store, now), "SYNCING");
        store.bootstrap_failed = false;
        assert_eq!(server_state(&store, now), "ONLINE");
        // A server nobody let in with a code has no first data to wait for.
        let mut by_hand = facts();
        by_hand.heartbeat_at = Some(now - Duration::seconds(10));
        by_hand.has_node = true;
        assert_eq!(server_state(&by_hand, now), "ONLINE");
    }

    #[test]
    fn the_first_data_is_told_stream_by_stream_once_it_is_all_queued() {
        let now = Utc::now();
        let mut store = facts();
        store.approved_enrolment = Some(Uuid::nil());
        store.heartbeat_at = Some(now);
        // Still being queued: one stream, not done.
        let waiting = first_data_of(&store);
        assert_eq!((waiting.done, waiting.total), (0, 1));
        assert_eq!(waiting.streams[0].key, "all");
        assert_eq!(waiting.streams[0].label, "Store data");

        store.bootstrap_at = Some(now);
        store.bootstrap_seq = Some(9);
        store.acked_seq = 6;
        store.bootstrap_report = Some(json!({ "counts": { "articles": 12431, "staff": 18 } }));
        store.first_data_commands = vec![
            ("catalog.snapshot.chunk".into(), 4, 4),
            ("auth.policy.replace".into(), 1, 1),
            ("attendance.book.replace".into(), 1, 1),
            ("commercial.publication.activate".into(), 2, 0),
            ("commercial.campaign.v1".into(), 1, 0),
        ];
        let data = first_data_of(&store);
        assert_eq!((data.done, data.total), (2, 4));
        let keys: Vec<&str> = data
            .streams
            .iter()
            .map(|stream| stream.key.as_str())
            .collect();
        assert_eq!(keys, ["articles", "price_books", "staff", "promotions"]);
        assert_eq!(data.streams[0].count, Some(12431));
        assert_eq!(data.streams[2].count, Some(18));
        assert_eq!(data.streams[1].count, None);
        assert!(data.streams[0].done && data.streams[2].done);
        assert!(!data.streams[1].done && !data.streams[3].done);

        // Present on the wire only while the server is syncing.
        let server = server_of(&store, now);
        assert_eq!(server.state, "SYNCING");
        assert!(server.first_data.is_some());
        store.acked_seq = 9;
        store.ready_at = Some(now);
        assert!(server_of(&store, now).first_data.is_none());
    }

    #[test]
    fn the_server_check_is_green_only_when_ready_and_names_the_machine() {
        let now = Utc::now();
        let mut store = facts();
        store.approved_enrolment = Some(Uuid::nil());
        store.approved_machine =
            Some(json!({ "hostname": "KASIR-PC", "os": "windows", "arch": "x86_64" }));
        store.heartbeat_at = Some(now);
        let syncing = judge_server(&store, now);
        assert!(!syncing.check.ok);
        assert_eq!(syncing.check.detail, "Getting data · KASIR-PC");
        store.ready_at = Some(now);
        store.hb_hostname = Some("TEGAL-SRV".into());
        let ready = judge_server(&store, now);
        assert!(ready.check.ok);
        assert_eq!(ready.check.detail, "Ready · TEGAL-SRV");
        assert_eq!(
            judge_server(&facts(), now).check.detail,
            "Waiting for the server"
        );
    }

    #[test]
    fn the_machine_is_what_the_heartbeat_says_else_what_it_said_when_it_claimed() {
        let now = Utc::now();
        let mut store = facts();
        assert!(machine_of(&store, server_state(&store, now)).is_none());
        store.pending_enrolment = Some(Uuid::nil());
        store.pending_claimed = true;
        store.pending_machine = Some(
            json!({ "hostname": "NEW-PC", "os": "windows", "arch": "x86_64", "version": "0.1.4" }),
        );
        store.hb_hostname = Some("OLD-PC".into());
        let waiting = machine_of(&store, "WAITING_FOR_APPROVAL").expect("the claimant");
        assert_eq!(
            (
                waiting.hostname.as_str(),
                waiting.os.as_str(),
                waiting.version.as_str()
            ),
            ("NEW-PC", "windows x86_64", "0.1.4")
        );
        store.pending_enrolment = None;
        store.approved_enrolment = Some(Uuid::nil());
        store.approved_machine = store.pending_machine.take();
        store.hb_hostname = Some("TEGAL-SRV".into());
        store.hb_os = Some("windows x86_64".into());
        store.hb_version = Some("0.1.5".into());
        let machine = machine_of(&store, "ONLINE").expect("the server");
        assert_eq!(machine.hostname, "TEGAL-SRV");
        assert_eq!(machine.version, "0.1.5");
    }

    #[test]
    fn only_a_plain_web_address_the_server_reported_is_shown_once_it_is_ready() {
        let now = Utc::now();
        let mut store = facts();
        store.heartbeat_at = Some(now);
        store.hb_app_address = Some("http://c014.local:8082".into());
        assert_eq!(
            app_address_of(&store, server_state(&store, now)).as_deref(),
            Some("http://c014.local:8082")
        );
        assert!(server_of(&store, now).app_qr_svg.is_some());
        store.hb_app_address = Some("javascript:alert(1)".into());
        assert_eq!(app_address_of(&store, "ONLINE"), None);
        store.hb_app_address = Some("http://c014.local:8082".into());
        assert_eq!(app_address_of(&store, "SYNCING"), None);
        assert_eq!(app_address_of(&store, "OFFLINE"), None);
    }
}

/// One slice of the transaction numbers (postgres 1010): four million.
const RECEIPT_SLICE_SIZE: i64 = 4_000_000;

/// This store install's slices of the 7-letter transaction numbers, oldest
/// first — a first one when it has none, and the next once the sales it has
/// synced reach 80% of what it holds. Slices are cut from the end of the run
/// under one lock, so no two stores ever share a number.
pub async fn receipt_slices_for(
    pool: &PgPool,
    origin_id: &str,
) -> Result<Vec<crate::cloud::domain::receipt_number::ReceiptSlice>, AppError> {
    use crate::cloud::domain::receipt_number::{ReceiptSlice, SPACE};
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(1010)")
        .execute(&mut *tx)
        .await?;
    let generation: i64 = sqlx::query_scalar(
        "SELECT active_generation FROM sync_origin_credential WHERE origin_id=$1",
    )
    .bind(origin_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(1);
    let held = |rows: Vec<(i64, i64)>| {
        rows.into_iter()
            .map(|(start, size)| ReceiptSlice { start, size })
            .collect::<Vec<_>>()
    };
    let mut slices = held(
        sqlx::query_as::<_, (i64, i64)>(
            "SELECT start,size FROM receipt_slice
              WHERE origin_id=$1 AND generation=$2 ORDER BY issued_at,start",
        )
        .bind(origin_id)
        .bind(generation)
        .fetch_all(&mut *tx)
        .await?,
    );
    let granted: i64 = slices.iter().map(|slice| slice.size).sum();
    // Sales since this install was first given a slice: a store set up
    // again does not count what its old database numbered.
    let used: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM edge_sale
          WHERE origin_id=$1
            AND occurred_at >= COALESCE((SELECT MIN(issued_at) FROM receipt_slice
                                          WHERE origin_id=$1 AND generation=$2), now())",
    )
    .bind(origin_id)
    .bind(generation)
    .fetch_one(&mut *tx)
    .await?;
    if granted == 0 || used * 5 >= granted * 4 {
        let next: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(start + size), 0) FROM receipt_slice")
                .fetch_one(&mut *tx)
                .await?;
        let size = RECEIPT_SLICE_SIZE.min(i64::try_from(SPACE).unwrap_or(i64::MAX) - next);
        if size > 0 {
            sqlx::query(
                "INSERT INTO receipt_slice (start,size,origin_id,generation) VALUES ($1,$2,$3,$4)",
            )
            .bind(next)
            .bind(size)
            .bind(origin_id)
            .bind(generation)
            .execute(&mut *tx)
            .await?;
            slices.push(ReceiptSlice { start: next, size });
        } else {
            tracing::warn!(origin_id, "every 7-letter transaction number is handed out");
        }
    }
    tx.commit().await?;
    Ok(slices)
}
