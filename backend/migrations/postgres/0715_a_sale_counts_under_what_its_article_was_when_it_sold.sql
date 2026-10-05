-- A sale counts under what its article was when it was sold: its tags and
-- its division.
--
-- Owner, 30 Sep 2026, on the Sales breakdowns: "semuanya tidak ada yg
-- berlaku surut". Re-filing an
-- article under another tag in the master changes where its sales count FROM
-- THAT MOMENT; the sales it made before stay under the tags it had then.
-- `article_tag` only knows the present, so every change to it is kept here as
-- a period, and the report reads the period a sale falls in.
--
-- # Where a period starts
--
-- * Tags already on an article today, and tags an article is created with
--   (the article row was written in the same transaction), reach back to the
--   beginning (`-infinity`): there was never a time the article traded under
--   anything else.
-- * Every later change starts at the moment it was made (`now()`), including
--   the first tag given to an article that sold untagged until then.
--
-- The master's save replaces an article's tags wholesale (delete, then insert
-- the new list). A tag that was in both lists is deleted and put back in one
-- transaction; the insert then reopens the period the delete just closed
-- instead of cutting it in two, so an unchanged tag keeps one period.

CREATE TABLE article_tag_period (
    period_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id uuid NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    tag_code   text NOT NULL REFERENCES tag(code),
    valid_from timestamptz NOT NULL,
    -- NULL while the article still carries the tag.
    valid_to   timestamptz,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- One open period per article and tag: the present is `article_tag`.
CREATE UNIQUE INDEX article_tag_period_open
    ON article_tag_period (article_id, tag_code) WHERE valid_to IS NULL;
CREATE INDEX ix_article_tag_period_article ON article_tag_period (article_id);

INSERT INTO article_tag_period (article_id, tag_code, valid_from)
SELECT article_id, tag_code, '-infinity'
  FROM article_tag;

CREATE FUNCTION article_tag_period_open() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Deleted and put back in this transaction: the tag never left.
    UPDATE article_tag_period
       SET valid_to = NULL
     WHERE article_id = NEW.article_id
       AND tag_code = NEW.tag_code
       AND valid_to = now();
    IF FOUND THEN
        RETURN NEW;
    END IF;

    INSERT INTO article_tag_period (article_id, tag_code, valid_from)
    SELECT NEW.article_id, NEW.tag_code,
           CASE WHEN a.created_at = now() THEN '-infinity'::timestamptz
                ELSE now() END
      FROM article a
     WHERE a.id = NEW.article_id
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE FUNCTION article_tag_period_close() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE article_tag_period
       SET valid_to = now()
     WHERE article_id = OLD.article_id
       AND tag_code = OLD.tag_code
       AND valid_to IS NULL;
    RETURN OLD;
END;
$$;

CREATE TRIGGER article_tag_period_open
    AFTER INSERT ON article_tag
    FOR EACH ROW EXECUTE FUNCTION article_tag_period_open();

CREATE TRIGGER article_tag_period_close
    AFTER DELETE ON article_tag
    FOR EACH ROW EXECUTE FUNCTION article_tag_period_close();

COMMENT ON TABLE article_tag_period IS
    'Which tags an article carried when. Kept by triggers on article_tag; Sales by tag reads the period a sale falls in, so re-tagging is not retroactive.';

-- ---------------------------------------------------------------------------
-- The division, the same way
-- ---------------------------------------------------------------------------
--
-- One division per article at a time, so a period per article: an article
-- moved from Pria to Wanita sold as Pria until the move and as Wanita after.
-- An article is created with its division (`-infinity`, as above); a change
-- of `division_code` closes one period and opens the next at `now()`. Moved
-- and moved back in one transaction is no move.

CREATE TABLE article_division_period (
    period_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id    uuid NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    -- NULL while the article has no division.
    division_code text REFERENCES division(code),
    valid_from    timestamptz NOT NULL,
    valid_to      timestamptz,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX article_division_period_open
    ON article_division_period (article_id) WHERE valid_to IS NULL;

INSERT INTO article_division_period (article_id, division_code, valid_from)
SELECT id, division_code, '-infinity'
  FROM article;

CREATE FUNCTION article_division_period_follow() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO article_division_period (article_id, division_code, valid_from)
        VALUES (NEW.id, NEW.division_code, '-infinity');
        RETURN NEW;
    END IF;

    UPDATE article_division_period
       SET valid_to = now()
     WHERE article_id = NEW.id AND valid_to IS NULL;

    -- Moved back to the division it left in this same transaction.
    UPDATE article_division_period
       SET valid_to = NULL
     WHERE period_id = (
               SELECT period_id FROM article_division_period
                WHERE article_id = NEW.id
                  AND valid_to = now()
                  AND division_code IS NOT DISTINCT FROM NEW.division_code
                  AND valid_from < now()
                ORDER BY valid_from DESC
                LIMIT 1);
    IF NOT FOUND THEN
        INSERT INTO article_division_period (article_id, division_code, valid_from)
        VALUES (NEW.id, NEW.division_code,
                CASE WHEN NEW.created_at = now() THEN '-infinity'::timestamptz
                     ELSE now() END);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER article_division_period_open
    AFTER INSERT ON article
    FOR EACH ROW EXECUTE FUNCTION article_division_period_follow();

CREATE TRIGGER article_division_period_move
    AFTER UPDATE OF division_code ON article
    FOR EACH ROW
    WHEN (OLD.division_code IS DISTINCT FROM NEW.division_code)
    EXECUTE FUNCTION article_division_period_follow();

COMMENT ON TABLE article_division_period IS
    'Which division an article was in when. Kept by triggers on article; the Sales breakdowns read the period a sale falls in, so moving an article is not retroactive.';

-- ---------------------------------------------------------------------------
-- The order a piece came in on
-- ---------------------------------------------------------------------------
--
-- By PO and by supplier read the piece itself, not the article: the EPC a
-- till scanned was minted by one tagging job, for one setup session, for one
-- receipt line of one purchase order — a fact fixed the day it was printed,
-- so nothing a buyer edits later moves a sale. The EPC carries the SKU (BCD,
-- hex 3–13) and the serial (the low 44 bits, the last 11 hex); a job line
-- holds a serial range per SKU, and serials are never reused
-- (`src/cloud/domain/identity.rs`). A tag this system did not mint, or a
-- quantity lot with no EPC, has no order: NULL.
CREATE FUNCTION po_line_of_epc(epc text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT grl.po_line_id
      FROM (SELECT CASE WHEN epc ~ '^[0-9A-Fa-f]{24}$'
                        THEN substr(epc, 3, 10) || substr(epc, 13, 1) END AS sku_code,
                   CASE WHEN epc ~ '^[0-9A-Fa-f]{24}$'
                        THEN ('x' || lpad(right(epc, 11), 16, '0'))::bit(64)::bigint END
                       AS serial) tag
      JOIN tagging_job_line tjl
        ON tjl.sku_code = tag.sku_code
       AND tag.serial BETWEEN tjl.serial_from AND tjl.serial_to
      JOIN tagging_job tj ON tj.job_id = tjl.job_id
      JOIN article_setup_session s ON s.session_id = tj.session_id
      JOIN goods_receipt_line grl ON grl.receipt_line_id = s.receipt_line_id
     LIMIT 1
$$;

COMMENT ON FUNCTION po_line_of_epc(text) IS
    'The purchase order line an EPC this system minted was received on, via its tagging job; NULL for foreign tags.';
