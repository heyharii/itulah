-- One delivery line can be set up as several articles.
--
-- The owner, 2026-10-02: an article with too many variants for one article is
-- split at setup into sibling articles — same name and base price, their own
-- codes, each with its own colour x size SKUs. No parent article: N peers.
--
-- So a receipt line may now carry several setup sessions, opened together in
-- one transaction (`create_split_setup`). The rule that a line is set up ONCE
-- stays; it moves from this UNIQUE to that transaction, which locks the
-- receipt line and refuses a line that already has any session. Each
-- session's `receipt_quantity` is then its own share of the line, and the
-- shares add up to the matched quantity.

ALTER TABLE article_setup_session
    DROP CONSTRAINT IF EXISTS article_setup_session_receipt_line_id_key;

CREATE INDEX IF NOT EXISTS article_setup_session_receipt_line_idx
    ON article_setup_session (receipt_line_id);

COMMENT ON COLUMN article_setup_session.receipt_quantity IS
    'The pieces of the receipt line this session identifies: the whole matched quantity, or this article''s share when the line was split into several articles.';
