-- A record is one kind of thing, and every feature spells it the same way.
--
-- # The four vocabularies this replaces
--
-- Asking "which record is this about?" had four answers and none of them could
-- read another's.
--
--   `audit_log.subject_kind` was free text, guessed from the shape of the path
--   by singularising whatever collection segment came before the last
--   identifier. The guess had produced 45 distinct words, among them
--   `activitie`, `edge_policie`, and — for
--   `/attendance-periods/{place}/{period}/closure` — the site code `dc-01`,
--   because the segment before a period is not a collection at all. `saved`
--   stood for both a saved report and a saved customer segment.
--
--   `discussion_thread.subject_kind` had nine values, lowercase, under a CHECK.
--
--   `document_link.subject_kind` had five, UPPERCASE, under a different CHECK.
--
--   `notification.subject_kind` was free text again.
--
-- So `purchase_order` was a legal subject for a thread and for a filed
-- document, and was a word the activity log had never once written — which is
-- why the order sheet's Activity panel was empty, and would have stayed empty
-- however long anybody waited.
--
-- # Why a table and not a CHECK
--
-- 0040 put its nine values in a CHECK and said why: the day a tenth "general"
-- kind arrives by hand-written INSERT, the forum stops being a list of work.
-- That reasoning is kept; only its shape changes. A CHECK cannot be shared by
-- six tables, so each table grew its own, and the six drifted. A referenced
-- table can be shared, it can carry the label a screen shows, and widening it
-- is one INSERT in a migration somebody has to write — which is the same
-- deliberate act a CHECK was buying.
--
-- The list is the one in `cloud::domain::record`, and `migration_hygiene`
-- compares the two on every run. Adding a kind in Rust without adding it here
-- turns that test red, which is where a reviewer is looking.
--
-- # Why the log is not rewritten
--
-- `audit_log` and `notification` take their foreign key NOT VALID: it holds
-- every row written from here on and leaves what is already there alone.
--
-- That is not laziness about a backfill. An audit trail that gets tidied up
-- afterwards is no longer evidence, and `activitie` in a row from August is a
-- true statement about what this system recorded in August. The two mapping
-- tables — `document_link`, `discussion_thread` — are not evidence of anything
-- and are rewritten in place.

CREATE TABLE record_kind (
    code  text PRIMARY KEY CHECK (btrim(code) <> ''),
    label text NOT NULL CHECK (btrim(label) <> '')
);

COMMENT ON TABLE record_kind IS
    'The one vocabulary of records. Mirrors `RecordKind` in '
    'cloud::domain::record; migration_hygiene compares the two.';

INSERT INTO record_kind (code, label) VALUES
    ('article', 'Article'),
    ('article_setup', 'Article setup'),
    ('colour', 'Colour'),
    ('division', 'Division'),
    ('size', 'Size'),
    ('tag', 'Tag'),
    ('supplier', 'Supplier'),
    ('supplier_item', 'Supplier item'),
    ('purchase_order', 'Purchase order'),
    ('purchase_order_line', 'Order line'),
    ('purchase_price_amendment', 'Price query'),
    ('receipt', 'Goods receipt'),
    ('purchase_exception', 'Exception'),
    ('commercial_verification', 'Verification'),
    ('packaging_item', 'Packaging item'),
    ('supply_item', 'Supply item'),
    ('count', 'Stock count'),
    ('allotment', 'Allotment'),
    ('pool', 'Pool'),
    ('missing', 'Missing unit'),
    ('sale', 'Sale'),
    ('return', 'Return'),
    ('checkout_exception', 'Checkout exception'),
    ('customer', 'Customer'),
    ('member', 'Member'),
    ('segment', 'Segment'),
    ('voucher', 'Voucher'),
    ('coupon', 'Coupon'),
    ('coupon_set', 'Coupon set'),
    ('campaign', 'Campaign'),
    ('publication', 'Publication'),
    ('account', 'Account'),
    ('journal', 'Journal entry'),
    ('bill', 'Supplier bill'),
    ('payment', 'Payment'),
    ('asset', 'Fixed asset'),
    ('bank_line', 'Bank line'),
    ('bank_statement', 'Bank statement'),
    ('statement_source', 'Statement source'),
    ('fiscal_period', 'Fiscal period'),
    ('employee', 'Employee'),
    ('leave_request', 'Leave request'),
    ('overtime_order', 'Overtime order'),
    ('payroll_run', 'Payroll run'),
    ('attendance_shift', 'Shift'),
    ('attendance_period', 'Attendance period'),
    ('holiday_calendar', 'Holiday calendar'),
    ('app_user', 'Operator'),
    ('rfid_device', 'RFID device'),
    ('origin', 'Node'),
    ('sync_command', 'Sync command'),
    ('document', 'Document'),
    ('discussion', 'Discussion'),
    ('conversation', 'Conversation'),
    ('assistant_conversation', 'Assistant chat'),
    ('saved_report', 'Saved report'),
    ('notification', 'Notification');

-- ---------------------------------------------------------------------------
-- The two mapping tables, rewritten to the shared spelling
-- ---------------------------------------------------------------------------

-- A filed document said SUPPLIER and a thread about the same supplier said
-- `supplier`, and nothing could tell they were the same word. Lowercase wins
-- because it is what the older of the two already used and what the hub
-- passes.
--
-- GOODS_RECEIPT becomes `receipt`: the threads have called it that since 0040,
-- and one of the two spellings had to go.
-- The CHECK goes first. It names the five UPPERCASE words, so a row rewritten
-- underneath it fails on the way out — which is how the first draft of this
-- file was found to be in the wrong order, against a copy of a dev database
-- that actually had documents filed in it.
ALTER TABLE document_link DROP CONSTRAINT document_link_subject_kind_check;

UPDATE document_link SET subject_kind = CASE subject_kind
    WHEN 'GOODS_RECEIPT' THEN 'receipt'
    ELSE lower(subject_kind)
END;

ALTER TABLE document_link
    ADD CONSTRAINT document_link_subject_kind_fkey
    FOREIGN KEY (subject_kind) REFERENCES record_kind(code);

-- The nine become fifty-seven, and the rule 0040 was defending is unchanged: a
-- thread still hangs on a record and there is still no "General". What is
-- different is that a supplier bill and a payroll run are now records somebody
-- may argue about, which they always were — they simply had no word for it.
ALTER TABLE discussion_thread DROP CONSTRAINT discussion_thread_subject_kind_check;
ALTER TABLE discussion_thread
    ADD CONSTRAINT discussion_thread_subject_kind_fkey
    FOREIGN KEY (subject_kind) REFERENCES record_kind(code);

-- ---------------------------------------------------------------------------
-- The two logs, constrained forward only
-- ---------------------------------------------------------------------------

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_subject_kind_fkey
    FOREIGN KEY (subject_kind) REFERENCES record_kind(code) NOT VALID;

ALTER TABLE notification
    ADD CONSTRAINT notification_subject_kind_fkey
    FOREIGN KEY (subject_kind) REFERENCES record_kind(code) NOT VALID;

COMMENT ON CONSTRAINT audit_log_subject_kind_fkey ON audit_log IS
    'NOT VALID on purpose: every row from here on conforms, and the rows that '
    'do not are what this system honestly recorded before it had a vocabulary.';
