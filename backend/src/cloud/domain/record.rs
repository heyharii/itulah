//! The one vocabulary of records, and the map from a route to the record it
//! acts on.
//!
//! # Why this module exists
//!
//! Four features had grown four answers to the same question — *which record
//! is this about?* — and none of them could read another's:
//!
//!   - `audit_log.subject_kind` was free text, guessed from the shape of the
//!     path by singularising whatever collection segment preceded the last
//!     identifier. On the day this was written that guess had produced 45
//!     distinct words, among them `activitie`, `edge_policie`, and — for
//!     `/attendance-periods/{unit}/{period}/closure` — the site code `dc-01`,
//!     because the segment before the period is not a collection at all.
//!   - `discussion_thread.subject_kind` had nine values, lowercase, held by a
//!     `CHECK`.
//!   - `document_link.subject_kind` had five, UPPERCASE, held by a different
//!     `CHECK`.
//!   - `notification.subject_kind` was free text again.
//!
//! So `purchase_order` was a legal subject for a thread and for a filed
//! document, and was a word the activity log had never once written — which is
//! why the order sheet's Activity panel was empty and always would have been.
//! Three vocabularies that overlap by accident are not a vocabulary.
//!
//! This is the fifth and last one. Everything that names a record — the log,
//! threads, filed documents, notifications, comments, tags — spells it from
//! here, and the database holds the same list in `record_kind` so a
//! hand-written `INSERT` cannot invent a forty-sixth word.
//!
//! # Why the route map is a table and not a rule
//!
//! The guess it replaces was not badly written; it was a rule where a rule
//! cannot work. A path is a URL, not a schema: `/members/segments/preview` and
//! `/members/{id}/pairing-code` are the same shape and different things, and
//! no amount of singularising tells them apart. The only honest answer is to
//! write down which route acts on which record, once, where a reviewer sees
//! it.
//!
//! The table is matched against the *route pattern* axum matched — not the
//! concrete path — which is what makes it exact. A `{}` here matches only a
//! placeholder segment there, so `/api/v1/members/{}` matches
//! `/api/v1/members/{member_id}/pairing-code` and cannot match
//! `/api/v1/members/segments/preview`, whose fourth segment is a literal. That
//! one rule removes the entire class of mistake the guess kept making.
//!
//! # What the table deliberately does not cover
//!
//! A route whose path cannot name the record — every `POST` that CREATES one,
//! and the handful whose identifier is composite or spelled differently from
//! the record's own key — is absent here on purpose. Those are declared by the
//! handler instead, which knows the answer the path does not have. See
//! `DeclaredSubject` in `cloud::http::audit`.

use serde::{Deserialize, Serialize};
use std::fmt;

/// A kind of record: the left half of every `(kind, id)` pair this system
/// stores.
///
/// The spellings are the ones already on the wire — `missing`, `return`,
/// `pool` — rather than tidier ones, because the hub's sheets pass them today
/// and renaming a subject is a data migration of every row that used it.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum RecordKind {
    // Product master
    Article,
    ArticleSetup,
    Colour,
    Division,
    Size,
    Tag,
    // Buying
    Supplier,
    SupplierItem,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchasePriceAmendment,
    Receipt,
    /// A letter somebody signs: a goods receipt note, a delivery note.
    ///
    /// Its own kind rather than a property of the record it was drawn from,
    /// because it is a separate document with its own number, its own date and
    /// its own signatures — a delivery note issued against an allotment is not
    /// the allotment, and voiding one does not cancel the other.
    Letter,
    // Four this business argues about that the schema does not yet hold. They
    // arrived as discussion subjects — an exception raised against an invoice,
    // a price book somebody is checking, the carton a jacket ships in, the
    // fabric it is cut from — and they stay in the vocabulary because a thread
    // and a filed document hang on a `(kind, id)` pair and never join to the
    // record. Nothing here needs the record to exist; the day one does, it
    // gets its own tables and this line stops being a promissory note.
    PurchaseException,
    CommercialVerification,
    PackagingItem,
    SupplyItem,
    // Stock
    Count,
    Allotment,
    Pool,
    Missing,
    // Selling
    Sale,
    Return,
    CheckoutException,
    Customer,
    Member,
    Segment,
    // Commercial
    Voucher,
    Coupon,
    CouponSet,
    Campaign,
    Publication,
    /// A promotion. Named `commercial_rule` because that is the table, the
    /// route (`/commercial/rules`) and the word the hub's sheet already
    /// passes — and renaming a subject is a data migration of every row that
    /// used it.
    CommercialRule,
    // Money
    Account,
    Journal,
    JournalDraft,
    Bill,
    Payment,
    /// A shop asking head office to pay something, and what happened to the ask.
    ///
    /// Its own kind rather than a property of the [`Self::Bill`] it may become,
    /// for the reason [`Self::HireProposal`] gives about employees: most of the
    /// history worth reading happens while there is no bill to hang it on, and
    /// an instruction head office refused never gets one at all. It is also
    /// where the evidence lives — the quotation, the demand, the photograph of
    /// the meter are documents linked to this record, so the ask needs no file
    /// column of its own.
    PaymentInstruction,
    Asset,
    /// A deal GA keeps: the lease, the policy, the permit, the subscription.
    ///
    /// Its own kind for the same reason every object in brief §6 gets one —
    /// files, comments and history hang on a `(kind, id)` pair, and a
    /// contract's papers (the signed agreement, the policy document) are filed
    /// against the deal and not against the asset or site it mentions.
    Contract,
    /// A standing service promise on the schedule — the interval and the day it
    /// next comes due. Its own kind because the files and history worth keeping
    /// are the service's, not the asset's.
    MaintenanceTask,
    /// What somebody found on a walk-round. Append-only evidence (0365), and
    /// its own record so a photograph or a technician's report can be filed
    /// against the inspection itself.
    Inspection,
    /// A breakdown GA records: the object, the supplier, the estimate and the
    /// budget. The MONEY is Finance's; this is the fact of the breakdown.
    Repair,
    /// A thing swapped for another because repairing it no longer made sense.
    Replacement,
    /// The request to let a thing go, and Finance's answer. Its own kind
    /// because the decision has a life — requested, approved, posted — that the
    /// asset's own row does not.
    Disposal,
    /// A place GA keeps facilities facts about — a shop, a warehouse, an
    /// office, a mess. The `site` row belongs to the register's own table; this
    /// kind is what a photograph, a comment or a history entry hangs on.
    Location,
    /// A place asking for what it needs: ATK, a mop, a cash-box. Its own kind
    /// because it has a life — requested, approved, ordered, received, billed —
    /// and because the bill that settles it points back at the ask.
    SupplyRequest,
    /// Damage to an insured thing claimed under its policy (0975): photos, the
    /// police report and the survey letter hang on it.
    InsuranceClaim,
    /// A store opening or a renovation (0997): its tasks, the assets it
    /// registers, the work it asks for and the cost Finance capitalises.
    /// Files and the activity hang on it.
    Project,
    /// Routine spending GA records on a thing or a place — fuel, tyres, oil —
    /// and hands to Finance (0974). The receipt hangs on it.
    OperatingExpense,
    /// A physical original of a filed paper and who holds it (0974).
    DocumentOriginal,
    BankLine,
    BankStatement,
    StatementSource,
    FiscalPeriod,
    /// One tax in one month — what is owed to the state, what was credited,
    /// and whether the return went in (0279). Not a [`Self::FiscalPeriod`]:
    /// that closes the books, this is a debt with deadlines. The tax deadline
    /// reminder names it as the notice's subject, which is why 0973 had to
    /// register it.
    TaxPeriod,
    /// A correction as a DECISION — raised, approved, posted, maybe reversed.
    /// Not the journal entry it becomes: that is filed under [`Self::Journal`]
    /// by the poster, and a correction has three states an entry never has.
    /// See 0129 and 0259.
    Correction,
    /// One integrity check's own record. 0190's `notification_subject_kind_fkey`
    /// has pointed at this word since the check started raising notifications,
    /// and 0314 registered the row — but `RecordKind` never learned it, so the
    /// two vocabularies disagreed. It has no sheet of its own: the check is
    /// read inside the latest-integrity report, which is the path below.
    IntegrityCheck,
    // People
    Employee,
    LeaveRequest,
    OvertimeOrder,
    PayrollRun,
    AttendanceShift,
    AttendancePeriod,
    HolidayCalendar,
    /// A shop's request for an employee it does not have, and head office's
    /// answer.
    ///
    /// Its own kind rather than a property of the [`Self::Employee`] it may
    /// lead to, because most of them never lead to one: a proposal head office
    /// rejected has a history worth reading and no employee to hang it on. And
    /// while it is being negotiated there is nobody to file the conversation
    /// against — the person it names is not employed here and may never be.
    HireProposal,
    // The node itself
    AppUser,
    RfidDevice,
    Origin,
    SyncCommand,
    // The organisation: a store, the Gudang, head office. What head office
    // opens, acts on and is told about (0649).
    Unit,
    // Workplace
    Document,
    Discussion,
    Conversation,
    AssistantConversation,
    SavedReport,
    Notification,
}

impl RecordKind {
    /// Every kind, in declaration order.
    ///
    /// Exported because two guards read it: the conformance test that compares
    /// this list against the `record_kind` table, and the catalogue that
    /// records which kind each route files under.
    pub const ALL: [Self; 78] = [
        Self::Article,
        Self::ArticleSetup,
        Self::Colour,
        Self::Division,
        Self::Size,
        Self::Tag,
        Self::Supplier,
        Self::SupplierItem,
        Self::PurchaseOrder,
        Self::PurchaseOrderLine,
        Self::PurchasePriceAmendment,
        Self::Receipt,
        Self::Letter,
        Self::PurchaseException,
        Self::CommercialVerification,
        Self::PackagingItem,
        Self::SupplyItem,
        Self::Count,
        Self::Allotment,
        Self::Pool,
        Self::Missing,
        Self::Sale,
        Self::Return,
        Self::CheckoutException,
        Self::Customer,
        Self::Member,
        Self::Segment,
        Self::Voucher,
        Self::Coupon,
        Self::CouponSet,
        Self::Campaign,
        Self::Publication,
        Self::CommercialRule,
        Self::Account,
        Self::Journal,
        Self::JournalDraft,
        Self::Bill,
        Self::Payment,
        Self::PaymentInstruction,
        Self::Correction,
        Self::IntegrityCheck,
        Self::Asset,
        Self::Contract,
        Self::MaintenanceTask,
        Self::Inspection,
        Self::Repair,
        Self::Replacement,
        Self::Disposal,
        Self::Location,
        Self::SupplyRequest,
        Self::InsuranceClaim,
        Self::Project,
        Self::OperatingExpense,
        Self::DocumentOriginal,
        Self::BankLine,
        Self::BankStatement,
        Self::StatementSource,
        Self::FiscalPeriod,
        Self::TaxPeriod,
        Self::Employee,
        Self::LeaveRequest,
        Self::OvertimeOrder,
        Self::PayrollRun,
        Self::AttendanceShift,
        Self::AttendancePeriod,
        Self::HolidayCalendar,
        Self::HireProposal,
        Self::AppUser,
        Self::RfidDevice,
        Self::Origin,
        Self::SyncCommand,
        Self::Unit,
        Self::Document,
        Self::Discussion,
        Self::Conversation,
        Self::AssistantConversation,
        Self::SavedReport,
        Self::Notification,
    ];

    /// The wire spelling, and the value stored in every `subject_kind` column.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Article => "article",
            Self::ArticleSetup => "article_setup",
            Self::Colour => "colour",
            Self::Division => "division",
            Self::Size => "size",
            Self::Tag => "tag",
            Self::Supplier => "supplier",
            Self::SupplierItem => "supplier_item",
            Self::PurchaseOrder => "purchase_order",
            Self::PurchaseOrderLine => "purchase_order_line",
            Self::PurchasePriceAmendment => "purchase_price_amendment",
            Self::Receipt => "receipt",
            Self::Letter => "letter",
            Self::PurchaseException => "purchase_exception",
            Self::CommercialVerification => "commercial_verification",
            Self::PackagingItem => "packaging_item",
            Self::SupplyItem => "supply_item",
            Self::Count => "count",
            Self::Allotment => "allotment",
            Self::Pool => "pool",
            Self::Missing => "missing",
            Self::Sale => "sale",
            Self::Return => "return",
            Self::CheckoutException => "checkout_exception",
            Self::Customer => "customer",
            Self::Member => "member",
            Self::Segment => "segment",
            Self::Voucher => "voucher",
            Self::Coupon => "coupon",
            Self::CouponSet => "coupon_set",
            Self::Campaign => "campaign",
            Self::Publication => "publication",
            Self::CommercialRule => "commercial_rule",
            Self::Account => "account",
            Self::Journal => "journal",
            Self::JournalDraft => "journal_draft",
            Self::Bill => "bill",
            Self::Payment => "payment",
            Self::PaymentInstruction => "payment_instruction",
            Self::Correction => "correction",
            Self::IntegrityCheck => "integrity_check",
            Self::Asset => "asset",
            Self::Contract => "contract",
            Self::MaintenanceTask => "maintenance_task",
            Self::Inspection => "inspection",
            Self::Repair => "repair",
            Self::Replacement => "replacement",
            Self::Disposal => "disposal",
            Self::Location => "location",
            Self::SupplyRequest => "supply_request",
            Self::InsuranceClaim => "insurance_claim",
            Self::Project => "project",
            Self::OperatingExpense => "operating_expense",
            Self::DocumentOriginal => "document_original",
            Self::BankLine => "bank_line",
            Self::BankStatement => "bank_statement",
            Self::StatementSource => "statement_source",
            Self::FiscalPeriod => "fiscal_period",
            Self::TaxPeriod => "tax_period",
            Self::Employee => "employee",
            Self::LeaveRequest => "leave_request",
            Self::OvertimeOrder => "overtime_order",
            Self::PayrollRun => "payroll_run",
            Self::AttendanceShift => "attendance_shift",
            Self::AttendancePeriod => "attendance_period",
            Self::HolidayCalendar => "holiday_calendar",
            Self::HireProposal => "hire_proposal",
            Self::AppUser => "app_user",
            Self::RfidDevice => "rfid_device",
            Self::Origin => "origin",
            Self::SyncCommand => "sync_command",
            Self::Unit => "unit",
            Self::Document => "document",
            Self::Discussion => "discussion",
            Self::Conversation => "conversation",
            Self::AssistantConversation => "assistant_conversation",
            Self::SavedReport => "saved_report",
            Self::Notification => "notification",
        }
    }

    /// What a person calls it. Used where a screen shows the kind rather than
    /// the record — the discussions rail, a filed document's "about" line.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Article => "Article",
            Self::ArticleSetup => "Article setup",
            Self::Colour => "Colour",
            Self::Division => "Division",
            Self::Size => "Size",
            Self::Tag => "Tag",
            Self::Supplier => "Supplier",
            Self::SupplierItem => "Supplier item",
            Self::PurchaseOrder => "Purchase order",
            Self::PurchaseOrderLine => "Order line",
            Self::PurchasePriceAmendment => "Price query",
            Self::Receipt => "Goods receipt",
            Self::Letter => "Letter",
            Self::PurchaseException => "Exception",
            Self::CommercialVerification => "Verification",
            Self::PackagingItem => "Packaging item",
            Self::SupplyItem => "Supply item",
            Self::Count => "Stock count",
            Self::Allotment => "Allotment",
            Self::Pool => "Pool",
            Self::Missing => "Missing unit",
            Self::Sale => "Sale",
            Self::Return => "Return",
            Self::CheckoutException => "Checkout exception",
            Self::Customer => "Customer",
            Self::Member => "Member",
            Self::Segment => "Segment",
            Self::Voucher => "Voucher",
            Self::Coupon => "Coupon",
            Self::CouponSet => "Coupon set",
            Self::Campaign => "Campaign",
            Self::Publication => "Publication",
            Self::CommercialRule => "Promotion",
            Self::Account => "Account",
            Self::Journal => "Journal entry",
            Self::JournalDraft => "Journal draft",
            Self::Bill => "Supplier bill",
            Self::Payment => "Payment",
            Self::PaymentInstruction => "Payment instruction",
            Self::Correction => "Correction",
            Self::IntegrityCheck => "Integrity check",
            Self::Asset => "Fixed asset",
            Self::Contract => "Contract",
            Self::MaintenanceTask => "Maintenance task",
            Self::Inspection => "Inspection",
            Self::Repair => "Repair",
            Self::Replacement => "Replacement",
            Self::Disposal => "Disposal",
            Self::Location => "Location",
            Self::SupplyRequest => "Supply request",
            Self::InsuranceClaim => "Insurance claim",
            Self::Project => "Project",
            Self::OperatingExpense => "Operating expense",
            Self::DocumentOriginal => "Document original",
            Self::BankLine => "Bank line",
            Self::BankStatement => "Bank statement",
            Self::StatementSource => "Statement source",
            Self::FiscalPeriod => "Fiscal period",
            Self::TaxPeriod => "Tax period",
            Self::Employee => "Employee",
            Self::LeaveRequest => "Leave request",
            Self::OvertimeOrder => "Overtime order",
            Self::PayrollRun => "Payroll run",
            Self::AttendanceShift => "Shift",
            Self::AttendancePeriod => "Attendance period",
            Self::HolidayCalendar => "Holiday calendar",
            Self::HireProposal => "Hire proposal",
            Self::AppUser => "Operator",
            Self::RfidDevice => "RFID device",
            Self::Origin => "Node",
            Self::SyncCommand => "Sync command",
            Self::Unit => "Unit",
            Self::Document => "Document",
            Self::Discussion => "Discussion",
            Self::Conversation => "Conversation",
            Self::AssistantConversation => "Assistant chat",
            Self::SavedReport => "Saved report",
            Self::Notification => "Notification",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }

    /// The read whose permission governs this record.
    ///
    /// The point of it is `/api/v1/records/{kind}/{id}/info`, which serves
    /// every kind through one route. `required_role` answers from
    /// `(method, path)` alone, so a single path would give one answer for all
    /// of them — and the lowest answer wins, which would put a payroll run's
    /// comments in front of a cashier. Delegating to the path that already
    /// serves this record keeps the answer the one the estate already gives.
    ///
    /// It is a *read* path on purpose. Reading a record's comments is reading
    /// the record; writing one is not writing the record, and the comment
    /// routes ask for the same rung rather than the mutating one. A person who
    /// may see a bill may say something about it.
    pub const fn read_path(self) -> &'static str {
        match self {
            Self::Article => "/api/v1/articles",
            Self::ArticleSetup => "/api/v1/article-setups",
            Self::Colour => "/api/v1/colours",
            Self::Division | Self::Size | Self::Tag => "/api/v1/vocabulary",
            Self::Supplier => "/api/v1/suppliers",
            Self::SupplierItem | Self::PackagingItem | Self::SupplyItem => "/api/v1/supplier-items",
            Self::PurchaseOrder | Self::Receipt => "/api/v1/purchase-orders",
            // Its own surface, and the rung matters: the letters read is a
            // CASHIER read because the person who ships the goods prints the
            // delivery note, and the letter carries quantities and names but
            // never a price — which is the whole reason purchasing itself is
            // SUPERVISOR to read.
            Self::Letter => "/api/v1/letters",
            Self::PurchaseOrderLine => "/api/v1/purchase-order-lines",
            Self::PurchasePriceAmendment | Self::PurchaseException => {
                "/api/v1/purchase-price-amendments"
            }
            Self::CommercialVerification => "/api/v1/commercial/publications",
            Self::Count => "/api/v1/inventory/counts",
            Self::Allotment => "/api/v1/inventory/allotments",
            Self::Pool => "/api/v1/inventory/pools",
            Self::Missing => "/api/v1/inventory/missing",
            Self::Sale | Self::Return => "/api/v1/sales",
            Self::CheckoutException => "/api/v1/checkout-exceptions",
            Self::Customer => "/api/v1/customers",
            Self::Member | Self::Segment => "/api/v1/members",
            Self::Voucher => "/api/v1/commercial/vouchers",
            Self::Coupon => "/api/v1/commercial/coupons",
            Self::CouponSet => "/api/v1/commercial/coupon-sets",
            Self::Campaign => "/api/v1/commercial/campaigns",
            Self::Publication => "/api/v1/commercial/publications",
            Self::CommercialRule => "/api/v1/commercial/rules",
            Self::Account => "/api/v1/finance/accounts",
            Self::Journal => "/api/v1/finance/journal",
            Self::JournalDraft => "/api/v1/finance/journal/drafts",
            Self::Bill => "/api/v1/finance/bills",
            Self::Payment => "/api/v1/finance/payments",
            Self::PaymentInstruction => "/api/v1/finance/payment-instructions",
            Self::Correction => "/api/v1/finance/corrections",
            Self::IntegrityCheck => "/api/v1/finance/integrity",
            Self::Asset => "/api/v1/finance/assets",
            Self::Contract => "/api/v1/ga/contracts",
            Self::MaintenanceTask => "/api/v1/ga/maintenance-tasks",
            Self::Inspection => "/api/v1/ga/inspections",
            Self::Repair => "/api/v1/ga/repairs",
            Self::Replacement => "/api/v1/ga/replacements",
            Self::Disposal => "/api/v1/ga/disposals",
            Self::Location => "/api/v1/ga/locations",
            Self::SupplyRequest => "/api/v1/ga/supplies",
            Self::InsuranceClaim => "/api/v1/ga/claims",
            Self::Project => "/api/v1/ga/projects",
            Self::OperatingExpense => "/api/v1/ga/operating-expenses",
            Self::DocumentOriginal => "/api/v1/ga/originals",
            Self::BankLine => "/api/v1/finance/bank-lines",
            Self::BankStatement => "/api/v1/finance/bank-statements",
            Self::StatementSource => "/api/v1/finance/statement-sources",
            Self::FiscalPeriod => "/api/v1/finance/periods",
            Self::TaxPeriod => "/api/v1/finance/tax/periods",
            Self::Employee | Self::LeaveRequest | Self::OvertimeOrder | Self::AttendancePeriod => {
                "/api/v1/employees"
            }
            Self::PayrollRun => "/api/v1/payroll/runs",
            Self::AttendanceShift => "/api/v1/attendance-shifts",
            Self::HolidayCalendar => "/api/v1/holiday-calendars",
            Self::HireProposal => "/api/v1/hire-proposals",
            Self::AppUser | Self::RfidDevice | Self::Origin => "/api/v1/auth/users",
            Self::SyncCommand => "/api/v1/sync/commands",
            Self::Unit => "/api/v1/stores",
            Self::Document => "/api/v1/documents",
            Self::Discussion => "/api/v1/discussions",
            Self::Conversation => "/api/v1/chat/conversations",
            Self::AssistantConversation => "/api/v1/assistant/conversations",
            Self::SavedReport => "/api/v1/reports/saved",
            Self::Notification => "/api/v1/notifications",
        }
    }
}

impl fmt::Display for RecordKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Which record each route acts on, written down.
///
/// `{}` stands for one placeholder segment of the route pattern, and the LAST
/// `{}` is the record's identifier. A pattern matches a route whose leading
/// segments agree with it; whatever follows is the verb, so one line here
/// covers `PATCH /suppliers/{id}`, `POST /suppliers/{id}/activate` and
/// `POST /suppliers/{id}/deactivate` at once.
///
/// Where two lines could match, the longer one wins — which is how closing a
/// line short is an act against the LINE and not against the order above it.
const ROUTE_SUBJECTS: &[(&str, RecordKind)] = &[
    ("/api/v1/article-setups/{}", RecordKind::ArticleSetup),
    ("/api/v1/articles/{}", RecordKind::Article),
    // The catalogue's article routes are keyed by `article_code`, which is
    // what the article sheet is keyed by too, so these file where they belong.
    ("/api/v1/catalogue/articles/{}", RecordKind::Article),
    (
        "/api/v1/assistant/conversations/{}",
        RecordKind::AssistantConversation,
    ),
    ("/api/v1/attendance-shifts/{}", RecordKind::AttendanceShift),
    ("/api/v1/auth/users/{}", RecordKind::AppUser),
    ("/api/v1/auth/rfid-devices/{}", RecordKind::RfidDevice),
    ("/api/v1/auth/edge-policies/{}", RecordKind::Origin),
    // Turning one person's access to one node on or off is a fact about that
    // person, and their sheet is where somebody will go looking for it.
    ("/api/v1/auth/edge-assignments/{}/{}", RecordKind::AppUser),
    ("/api/v1/chat/conversations/{}", RecordKind::Conversation),
    (
        "/api/v1/checkout-exceptions/{}",
        RecordKind::CheckoutException,
    ),
    ("/api/v1/colours/{}", RecordKind::Colour),
    // Intent, plan, target, activities and guardrail breaches are all parts of
    // the campaign rather than records of their own: none has a sheet, and
    // every one of them is a thing somebody did TO the campaign.
    ("/api/v1/commercial/campaigns/{}", RecordKind::Campaign),
    ("/api/v1/commercial/coupon-sets/{}", RecordKind::CouponSet),
    ("/api/v1/commercial/coupons/{}", RecordKind::Coupon),
    (
        "/api/v1/commercial/publications/{}",
        RecordKind::Publication,
    ),
    ("/api/v1/commercial/vouchers/{}", RecordKind::Voucher),
    ("/api/v1/customers/{}", RecordKind::Customer),
    ("/api/v1/discussions/{}", RecordKind::Discussion),
    // Every letter route but the create carries the letter's own id, so the
    // path answers and the handler does not have to.
    ("/api/v1/letters/{}", RecordKind::Letter),
    ("/api/v1/letters/{}/issue", RecordKind::Letter),
    ("/api/v1/letters/{}/void", RecordKind::Letter),
    ("/api/v1/documents/{}", RecordKind::Document),
    ("/api/v1/employees/{}", RecordKind::Employee),
    (
        "/api/v1/employees/{}/leave-requests/{}",
        RecordKind::LeaveRequest,
    ),
    (
        "/api/v1/employees/{}/overtime-orders/{}",
        RecordKind::OvertimeOrder,
    ),
    ("/api/v1/finance/assets/{}", RecordKind::Asset),
    ("/api/v1/finance/bank-lines/{}", RecordKind::BankLine),
    ("/api/v1/finance/bills/{}", RecordKind::Bill),
    (
        "/api/v1/finance/journal/drafts/{}",
        RecordKind::JournalDraft,
    ),
    ("/api/v1/finance/journal/{}", RecordKind::Journal),
    ("/api/v1/finance/payments/{}", RecordKind::Payment),
    (
        "/api/v1/finance/payment-instructions/{}",
        RecordKind::PaymentInstruction,
    ),
    // A close, a reopen, the checklist behind either, and the history of both
    // are all things done TO one month. `FiscalPeriod` already names
    // `/api/v1/finance/periods` as its sheet, and this is what files the acts
    // there instead of leaving the log saying a month was reopened without
    // saying which.
    ("/api/v1/finance/corrections/{}", RecordKind::Correction),
    ("/api/v1/finance/periods/{}", RecordKind::FiscalPeriod),
    (
        "/api/v1/finance/statement-sources/{}",
        RecordKind::StatementSource,
    ),
    // One check's own record, read at `/api/v1/finance/integrity/{key}`. The
    // literal `/integrity/run` beside it is a machine act, not a record and not
    // matched here: a placeholder in a shape matches only a placeholder.
    ("/api/v1/finance/integrity/{}", RecordKind::IntegrityCheck),
    // GA's own records. Every path that carries the record's id is here, and
    // the placeholders match only the route's own `{param}` segments — so
    // `/api/v1/ga/repairs/{}/move` files against the repair and not against
    // the literal word "move". Without these the maintenance and contract
    // sheets would show an empty history: the act would be logged, but not the
    // thing it was done to.
    ("/api/v1/ga/assets/{}", RecordKind::Asset),
    ("/api/v1/ga/assets/{}/transfer", RecordKind::Asset),
    ("/api/v1/ga/assets/{}/notes", RecordKind::Asset),
    ("/api/v1/ga/contracts/{}", RecordKind::Contract),
    ("/api/v1/ga/contracts/{}/archive", RecordKind::Contract),
    (
        "/api/v1/ga/contracts/{}/meter-readings",
        RecordKind::Contract,
    ),
    (
        "/api/v1/ga/maintenance-tasks/{}",
        RecordKind::MaintenanceTask,
    ),
    ("/api/v1/ga/inspections/{}", RecordKind::Inspection),
    ("/api/v1/ga/repairs/{}", RecordKind::Repair),
    ("/api/v1/ga/repairs/{}/move", RecordKind::Repair),
    ("/api/v1/ga/repairs/{}/approve-budget", RecordKind::Repair),
    ("/api/v1/ga/replacements/{}", RecordKind::Replacement),
    ("/api/v1/ga/replacements/{}/move", RecordKind::Replacement),
    ("/api/v1/ga/disposals/{}", RecordKind::Disposal),
    ("/api/v1/ga/disposals/{}/decide", RecordKind::Disposal),
    ("/api/v1/ga/disposals/{}/close", RecordKind::Disposal),
    ("/api/v1/ga/locations/{}", RecordKind::Location),
    ("/api/v1/ga/supplies/{}/move", RecordKind::SupplyRequest),
    ("/api/v1/ga/claims/{}", RecordKind::InsuranceClaim),
    ("/api/v1/ga/claims/{}/submit", RecordKind::InsuranceClaim),
    ("/api/v1/ga/claims/{}/survey", RecordKind::InsuranceClaim),
    ("/api/v1/ga/claims/{}/approve", RecordKind::InsuranceClaim),
    ("/api/v1/ga/claims/{}/reject", RecordKind::InsuranceClaim),
    ("/api/v1/ga/claims/{}/pay", RecordKind::InsuranceClaim),
    ("/api/v1/ga/claims/{}/repair", RecordKind::InsuranceClaim),
    ("/api/v1/ga/projects/{}", RecordKind::Project),
    ("/api/v1/ga/projects/{}/close", RecordKind::Project),
    ("/api/v1/ga/projects/{}/tasks", RecordKind::Project),
    ("/api/v1/ga/projects/{}/links", RecordKind::Project),
    ("/api/v1/holiday-calendars/{}", RecordKind::HolidayCalendar),
    ("/api/v1/hire-proposals/{}", RecordKind::HireProposal),
    ("/api/v1/inventory/allotments/{}", RecordKind::Allotment),
    ("/api/v1/inventory/counts/{}", RecordKind::Count),
    ("/api/v1/inventory/missing/{}", RecordKind::Missing),
    ("/api/v1/members/segments/saved/{}", RecordKind::Segment),
    ("/api/v1/members/{}", RecordKind::Member),
    ("/api/v1/notifications/{}", RecordKind::Notification),
    ("/api/v1/payroll/runs/{}", RecordKind::PayrollRun),
    // An edit, a cancel and a return raised from it are all done TO the
    // order: its sheet's Activity is where a buyer looks for them.
    ("/api/v1/purchase-orders/{}", RecordKind::PurchaseOrder),
    (
        "/api/v1/purchase-order-lines/{}",
        RecordKind::PurchaseOrderLine,
    ),
    (
        "/api/v1/purchase-price-amendments/{}",
        RecordKind::PurchasePriceAmendment,
    ),
    ("/api/v1/reports/saved/{}", RecordKind::SavedReport),
    ("/api/v1/sales/{}", RecordKind::Sale),
    // The basket is keyed by the item it holds, so an act against a basket
    // line is an act against that supplier item — which is the record with a
    // sheet, and the one a buyer would ask about.
    ("/api/v1/sourcing-basket/{}", RecordKind::SupplierItem),
    // A store's page and everything head office does to it — open it, act
    // on its server, answer its exceptions — is about the store's unit.
    ("/api/v1/stores/{}", RecordKind::Unit),
    ("/api/v1/supplier-items/{}", RecordKind::SupplierItem),
    ("/api/v1/suppliers/{}", RecordKind::Supplier),
    ("/api/v1/sync/commands/{}", RecordKind::SyncCommand),
];

/// Routes whose HANDLER names the record, because the path cannot.
///
/// Every creation is here, and that is the point of the list: a `POST` that
/// mints a record cannot name it in the path, so until these handlers spoke
/// there was no row anywhere saying that an order, a supplier, an employee, a
/// bill or a document had been created at all.
///
/// A few are here for a second reason — the path names one record and the act
/// belongs to another. `POST /sales/{id}/returns` is an act against the sale
/// by its URL and against the refund by its meaning, and the refund is the
/// record somebody opens afterwards.
///
/// `None` means the handler picks between several: `/vocabulary/{kind}` is one
/// path serving divisions, sizes and tags.
///
/// This exists so the route catalogue can tell a route that files nothing from
/// one whose subject is simply written elsewhere. Without it every creation
/// would show a `-` in that column and the column would stop being worth
/// reading. `route_catalog` checks every line here is a route the estate
/// actually serves, so a renamed route takes this list with it.
pub const DECLARED_BY_HANDLER: &[(&str, &str, Option<RecordKind>)] = &[
    // The record surface itself: `{kind}` is a path parameter, so the record
    // is named at runtime and the handler is the only thing that can say it.
    ("POST", "/api/v1/records/{kind}/{id}/comments", None),
    ("PUT", "/api/v1/records/{kind}/{id}/tags/{code}", None),
    ("DELETE", "/api/v1/records/{kind}/{id}/tags/{code}", None),
    // Filed against the record the comment is ON — read from the row before
    // it changes, because after a delete there is nothing left to ask.
    ("PATCH", "/api/v1/comments/{id}", None),
    ("DELETE", "/api/v1/comments/{id}", None),
    ("POST", "/api/v1/auth/users", Some(RecordKind::AppUser)),
    (
        "POST",
        "/api/v1/auth/rfid-devices",
        Some(RecordKind::RfidDevice),
    ),
    ("POST", "/api/v1/discussions", Some(RecordKind::Discussion)),
    // Drawing a letter mints one, so its id exists only in the answer.
    ("POST", "/api/v1/letters", Some(RecordKind::Letter)),
    ("POST", "/api/v1/payroll/runs", Some(RecordKind::PayrollRun)),
    // The one-off figures a place files, and the withdrawals of them. Filed
    // against the EMPLOYEE rather than against a row of their own: "why did
    // Siti get three hundred thousand extra in April" is a question somebody
    // asks on her sheet, and an adjustment id is not a record anybody opens.
    // The shape `POST /inventory/movements/correct` settled on.
    //
    // Defining a payroll component and ratifying its rate are deliberately
    // NOT here. A component is a rule for the whole company rather than a
    // record with a sheet — the position the attendance policy and the
    // overtime caps already take — so those writes show `-` in the catalogue
    // and their evidence is the `defined` and `ratified` authority on the row
    // itself, which is what an auditor reads.
    (
        "POST",
        "/api/v1/payroll/adjustments",
        Some(RecordKind::Employee),
    ),
    (
        "POST",
        "/api/v1/payroll/adjustments/{id}/withdrawal",
        Some(RecordKind::Employee),
    ),
    // Money kept somewhere, and the acts that describe or contradict it. All
    // four are filed against the LEDGER ACCOUNT rather than against their own
    // row: "this account was counted on the 13th and was 25.000 short" belongs
    // on the account's history, and the count's own id is not a record anybody
    // opens. None of the four can be read from the path — a describe names the
    // account in its body, and the other two carry their own row's id — so the
    // handler is the only thing that can say.
    // A correction is drafted before it has an id in any URL, so the three
    // routes that raise one can only be filed by the handler that just made it.
    // The four that follow it — approve, post, reverse, and the read — carry the
    // id and are matched from the path by `ROUTE_SUBJECTS`.
    (
        "POST",
        "/api/v1/finance/corrections/adjustment",
        Some(RecordKind::Correction),
    ),
    (
        "POST",
        "/api/v1/finance/corrections/reclass",
        Some(RecordKind::Correction),
    ),
    (
        "POST",
        "/api/v1/finance/corrections/write-off",
        Some(RecordKind::Correction),
    ),
    (
        "POST",
        "/api/v1/finance/bank-accounts",
        Some(RecordKind::Account),
    ),
    (
        "POST",
        "/api/v1/finance/bank-accounts/{id}/retire",
        Some(RecordKind::Account),
    ),
    (
        "POST",
        "/api/v1/finance/cash-counts",
        Some(RecordKind::Account),
    ),
    (
        "POST",
        "/api/v1/finance/cash-counts/{id}/post",
        Some(RecordKind::Account),
    ),
    // A deposit is filed against the DRAWER'S ledger account, the same choice
    // the four above make and for the same reason: "this till banked
    // 12.000.000 on the 13th" belongs on that account's history, and the
    // deposit's own id is not something anybody opens. The account is named in
    // the body on the create and sits on the deposit's own row afterwards, so
    // the path cannot say it in either case.
    (
        "POST",
        "/api/v1/finance/deposits",
        Some(RecordKind::Account),
    ),
    (
        "POST",
        "/api/v1/finance/deposits/{id}/bank",
        Some(RecordKind::Account),
    ),
    (
        "POST",
        "/api/v1/finance/deposits/{id}/land",
        Some(RecordKind::Account),
    ),
    // Raising an instruction mints one, so its id exists only in the answer.
    // Every other act on it carries the id in the path and is matched by the
    // pattern table instead.
    (
        "POST",
        "/api/v1/finance/payment-instructions",
        Some(RecordKind::PaymentInstruction),
    ),
    (
        "POST",
        "/api/v1/article-setups",
        Some(RecordKind::ArticleSetup),
    ),
    // One delivery line split into several articles mints several sessions;
    // the act is filed against the first.
    (
        "POST",
        "/api/v1/article-setups/split",
        Some(RecordKind::ArticleSetup),
    ),
    ("POST", "/api/v1/colours", Some(RecordKind::Colour)),
    (
        "POST",
        "/api/v1/commercial/coupon-sets",
        Some(RecordKind::CouponSet),
    ),
    (
        "POST",
        "/api/v1/commercial/publications",
        Some(RecordKind::Publication),
    ),
    (
        "POST",
        "/api/v1/commercial/vouchers",
        Some(RecordKind::Voucher),
    ),
    ("POST", "/api/v1/documents", Some(RecordKind::Document)),
    ("POST", "/api/v1/employees", Some(RecordKind::Employee)),
    (
        "POST",
        "/api/v1/hire-proposals",
        Some(RecordKind::HireProposal),
    ),
    // The path names the proposal and the act belongs to the employment
    // record it just created — the shape `POST /sales/{id}/returns` has.
    // Filed against the employee because that is the record somebody opens
    // afterwards, and the only place a row saying it was created can live;
    // the proposal already carries the step in its own history.
    (
        "POST",
        "/api/v1/hire-proposals/{id}/employment",
        Some(RecordKind::Employee),
    ),
    ("POST", "/api/v1/finance/assets", Some(RecordKind::Asset)),
    ("POST", "/api/v1/finance/bills", Some(RecordKind::Bill)),
    ("POST", "/api/v1/finance/journal", Some(RecordKind::Journal)),
    (
        "POST",
        "/api/v1/finance/journal/drafts",
        Some(RecordKind::JournalDraft),
    ),
    (
        "POST",
        "/api/v1/finance/payments",
        Some(RecordKind::Payment),
    ),
    (
        "POST",
        "/api/v1/inventory/allotments",
        Some(RecordKind::Allotment),
    ),
    (
        "POST",
        "/api/v1/inventory/allotments/batch",
        Some(RecordKind::Allotment),
    ),
    ("POST", "/api/v1/inventory/counts", Some(RecordKind::Count)),
    // Filed against the pool the stock left, which is the figure that was
    // wrong and the sheet the person was standing on.
    (
        "POST",
        "/api/v1/inventory/movements/correct",
        Some(RecordKind::Pool),
    ),
    ("POST", "/api/v1/members", Some(RecordKind::Member)),
    (
        "POST",
        "/api/v1/members/segments/saved",
        Some(RecordKind::Segment),
    ),
    (
        "POST",
        "/api/v1/purchase-orders",
        Some(RecordKind::PurchaseOrder),
    ),
    // The catalog composer mints the order too; its id is in the answer.
    (
        "POST",
        "/api/v1/purchase-orders/catalog",
        Some(RecordKind::PurchaseOrder),
    ),
    (
        "POST",
        "/api/v1/reports/saved",
        Some(RecordKind::SavedReport),
    ),
    ("POST", "/api/v1/sales", Some(RecordKind::Sale)),
    (
        "POST",
        "/api/v1/sales/{id}/returns",
        Some(RecordKind::Return),
    ),
    ("POST", "/api/v1/suppliers", Some(RecordKind::Supplier)),
    (
        "POST",
        "/api/v1/suppliers/{id}/items",
        Some(RecordKind::SupplierItem),
    ),
    // One path, three masters. The handler knows which.
    ("POST", "/api/v1/vocabulary/{kind}", None),
    ("PATCH", "/api/v1/vocabulary/{kind}/{code}", None),
    ("DELETE", "/api/v1/vocabulary/{kind}/{code}", None),
];

/// What a route's handler declares, if it declares anything.
///
/// `Some(None)` — the route is in the list and the kind is chosen at runtime.
pub fn declared_subject_of(method: &str, pattern: &str) -> Option<Option<RecordKind>> {
    DECLARED_BY_HANDLER
        .iter()
        .find(|(declared_method, declared_pattern, _)| {
            *declared_method == method && *declared_pattern == pattern
        })
        .map(|(_, _, kind)| *kind)
}

/// The record kind a route acts on, and which of its segments holds the id.
///
/// Split out from [`record_subject_of`] because the route catalogue asks the
/// first half of the question without having a request: it writes the kind of
/// every route into a committed file, so a route added with the wrong subject
/// — or with none — shows up in a diff rather than in an empty panel months
/// later.
pub fn record_kind_of(pattern: &str) -> Option<(RecordKind, usize)> {
    let pattern_parts: Vec<&str> = pattern.trim_matches('/').split('/').collect();

    let mut best: Option<(usize, RecordKind, usize)> = None;
    for (shape, kind) in ROUTE_SUBJECTS {
        let shape_parts: Vec<&str> = shape.trim_matches('/').split('/').collect();
        if shape_parts.len() > pattern_parts.len() {
            continue;
        }
        let mut id_at = None;
        let matched = shape_parts
            .iter()
            .zip(pattern_parts.iter())
            .enumerate()
            .all(|(index, (shape_part, pattern_part))| {
                if *shape_part == "{}" {
                    // A placeholder in the table matches only a placeholder in
                    // the route. This is the whole trick: it is what stops
                    // `/api/v1/members/{}` from claiming
                    // `/api/v1/members/segments/preview`, whose third segment
                    // is a literal word and not a record's id.
                    if pattern_part.starts_with('{') && pattern_part.ends_with('}') {
                        id_at = Some(index);
                        true
                    } else {
                        false
                    }
                } else {
                    shape_part == pattern_part
                }
            });
        if !matched {
            continue;
        }
        let Some(index) = id_at else { continue };
        // Longest wins: an act against a line is not an act against the order.
        if best
            .as_ref()
            .is_none_or(|(depth, _, _)| shape_parts.len() > *depth)
        {
            best = Some((shape_parts.len(), *kind, index));
        }
    }
    best.map(|(_, kind, index)| (kind, index))
}

/// The record a matched route acts on, if its path names one.
///
/// `pattern` is what axum matched — `/api/v1/suppliers/{id}` — and `path` the
/// request as it arrived. Both are walked together, so the identifier is read
/// out of the position the pattern says holds it rather than found by looking
/// for something that resembles an id.
pub fn record_subject_of(pattern: &str, path: &str) -> Option<(RecordKind, String)> {
    let pattern_parts = pattern.trim_matches('/').split('/').count();
    let path_parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    // A pattern and a path that disagree in length are not the pair axum
    // matched, and lining them up anyway would read an identifier out of the
    // wrong segment.
    if pattern_parts != path_parts.len() {
        return None;
    }
    let (kind, index) = record_kind_of(pattern)?;
    let id = path_parts[index].trim();
    if id.is_empty() {
        return None;
    }
    Some((kind, id.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The browser gets this enum as a TypeScript union, generated from the
    /// serde spelling — and everything on the wire uses `as_str`. If the two
    /// ever disagreed, the union would type-check a word the server refuses.
    #[test]
    fn serde_spells_a_kind_the_same_way_as_str_does() {
        for kind in RecordKind::ALL {
            let json = serde_json::to_string(&kind).expect("serialise");
            assert_eq!(
                json,
                format!("\"{}\"", kind.as_str()),
                "{kind:?} is spelled one way by serde and another by as_str"
            );
        }
    }

    #[test]
    fn every_kind_round_trips_through_its_wire_spelling() {
        for kind in RecordKind::ALL {
            assert_eq!(RecordKind::parse(kind.as_str()), Some(kind));
        }
    }

    /// Two kinds sharing a spelling would silently merge two records'
    /// histories, which is the failure this whole module exists to end.
    #[test]
    fn no_two_kinds_share_a_spelling() {
        let mut seen: Vec<&str> = RecordKind::ALL.iter().map(|kind| kind.as_str()).collect();
        let before = seen.len();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(before, seen.len(), "two kinds spell themselves the same");
    }

    #[test]
    fn a_verb_after_the_record_is_still_that_record() {
        assert_eq!(
            record_subject_of(
                "/api/v1/suppliers/{id}/activate",
                "/api/v1/suppliers/S-1/activate"
            ),
            Some((RecordKind::Supplier, "S-1".to_owned()))
        );
        assert_eq!(
            record_subject_of("/api/v1/suppliers/{id}", "/api/v1/suppliers/S-1"),
            Some((RecordKind::Supplier, "S-1".to_owned()))
        );
    }

    /// The guess this replaces answered `segment` here — it singularised
    /// `segments` and called the literal word an identifier.
    #[test]
    fn a_literal_segment_is_never_mistaken_for_an_identifier() {
        assert_eq!(
            record_subject_of(
                "/api/v1/members/segments/preview",
                "/api/v1/members/segments/preview"
            ),
            None
        );
        assert_eq!(
            record_subject_of(
                "/api/v1/members/segments/saved/{id}/retire",
                "/api/v1/members/segments/saved/abc/retire"
            ),
            Some((RecordKind::Segment, "abc".to_owned()))
        );
        assert_eq!(
            record_subject_of(
                "/api/v1/members/{member_id}/pairing-code",
                "/api/v1/members/M-9/pairing-code"
            ),
            Some((RecordKind::Member, "M-9".to_owned()))
        );
    }

    /// Closing a line short is an act against the line. The order's own sheet
    /// hears about it from the line, not by stealing the line's history.
    #[test]
    fn the_deeper_record_wins() {
        assert_eq!(
            record_subject_of(
                "/api/v1/employees/{id}/leave-requests/{request_id}/approve",
                "/api/v1/employees/E-1/leave-requests/L-2/approve"
            ),
            Some((RecordKind::LeaveRequest, "L-2".to_owned()))
        );
        assert_eq!(
            record_subject_of(
                "/api/v1/employees/{id}/contracts",
                "/api/v1/employees/E-1/contracts"
            ),
            Some((RecordKind::Employee, "E-1".to_owned()))
        );
    }

    /// The three the old guess got worst: a mangled plural, a site code read
    /// as a kind, and a collection word read as an id.
    #[test]
    fn the_paths_that_broke_the_guess() {
        // `activitie`
        assert_eq!(
            record_subject_of(
                "/api/v1/commercial/campaigns/{campaign_id}/activities/{activity_id}",
                "/api/v1/commercial/campaigns/C-1/activities/A-2"
            ),
            Some((RecordKind::Campaign, "C-1".to_owned()))
        );
        // `dc-01` as a kind. Nothing claims it, and saying nothing is right:
        // the period is `(unit, period)` and the handler declares it.
        assert_eq!(
            record_subject_of(
                "/api/v1/attendance-periods/{unit}/{period}/closure",
                "/api/v1/attendance-periods/dc-01/2026-09/closure"
            ),
            None
        );
        // `saved`, which stood for both a saved report and a saved segment.
        assert_eq!(
            record_subject_of(
                "/api/v1/reports/saved/{id}/run",
                "/api/v1/reports/saved/R-1/run"
            ),
            Some((RecordKind::SavedReport, "R-1".to_owned()))
        );
    }

    #[test]
    fn a_collection_names_no_record() {
        assert_eq!(
            record_subject_of("/api/v1/suppliers", "/api/v1/suppliers"),
            None
        );
        assert_eq!(
            record_subject_of("/api/v1/inventory/movements", "/api/v1/inventory/movements"),
            None
        );
        assert_eq!(
            record_subject_of(
                "/api/v1/notifications/read-all",
                "/api/v1/notifications/read-all"
            ),
            None
        );
    }

    /// Every read path must be one `required_role` can answer for, or the
    /// records surface would delegate its permission to a path that means
    /// nothing.
    #[test]
    fn every_kind_has_a_read_path_under_the_api() {
        for kind in RecordKind::ALL {
            assert!(
                kind.read_path().starts_with("/api/v1/"),
                "{kind} has no read path"
            );
        }
    }
}
