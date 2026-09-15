-- A correction is a record somebody can find.
--
-- 0129 gave a correction a document and a signature: an adjustment, a reclass
-- or a write-off is raised, approved by somebody other than its author, and
-- only then posted. Six routes act on one — raise, approve, post, reverse, and
-- two reads — and every one of them was writing an activity log entry that
-- said WHAT was done and not WHAT IT WAS DONE TO, because `record_kind` had no
-- word for a correction.
--
-- The consequence is narrow and it is exactly the thing the record vocabulary
-- exists to prevent: the correction's own sheet can never show its history.
-- Somebody asking "who approved the write-off on this bill, and when" has the
-- journal entry and the approver's name in `financial_correction`, and no way
-- to reach either from the record they started at.
--
-- # Why its own kind and not `journal`
--
-- Because the id is not a journal entry's. A correction exists as a DRAFT
-- before it posts, is refused while a month is closed, and may be reversed
-- afterwards — three states a journal entry does not have. Filing it under
-- `journal` would point the sheet at an entry that does not exist yet for
-- precisely the part of its life where the history matters most.
--
-- The journal it becomes is still reachable: `financial_correction` carries
-- `entry_id` once posted, and `poster` files THAT under `journal` as it does
-- every other entry. Two records, one for the decision and one for its
-- consequence, which is what 0129 already separated in the tables.

INSERT INTO record_kind (code, label) VALUES
    ('correction', 'Correction')
ON CONFLICT (code) DO NOTHING;
