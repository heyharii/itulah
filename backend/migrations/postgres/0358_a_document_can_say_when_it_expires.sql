-- 0358: a document can say when it expires.
--
-- The drawer (0075) records that a paper EXISTS: its file, its name, the folder
-- it was filed in, and enough text to find it by. It cannot say that the paper
-- stops being worth anything on a particular day, which is the only fact about
-- most of GA's papers that anybody acts on.
--
-- A STNK is the clean case. The paper is real, it is filed, and it expires
-- every year; what makes it worth keeping is the date on it. So is a
-- `Sertifikat Laik Operasi` for a lift, a fire-safety certificate, and the
-- warranty card on a genset. A BPKB is the counter-example: it is the proof of
-- ownership and it does not expire at all, which is why every one of these
-- columns is nullable. Absent means "this paper has no such date", which is a
-- fact about the paper rather than a gap in the filing.
--
-- # A contract or a document: the one rule
--
-- GA holds both, and the brief's §6 draws the line once:
--
--   * there is a PARTY and there is MONEY → it is a CONTRACT. A lease, a
--     maintenance agreement, an insurance policy. It has a counterparty, a
--     value, a reminder period of its own, and bills raised under it. Renewing
--     a contract is a decision somebody makes and signs.
--   * there is only PAPER → it is a DOCUMENT. The certificate, the card, the
--     scan of the letter that arrived.
--
-- The STNK shows why the rule is needed rather than pedantic. The PAPER is a
-- document — it is filed, it is found by name, it is photographed and put in
-- the drawer. Its RENEWAL is a contract: Bapenda/Samsat is the party, there is
-- a fee, there is a date it was paid, and next year it happens again. Filing
-- both as "the STNK" would put a counterparty on a document and a scan on a
-- contract, and the reminder that actually matters — the one that has to fire
-- before the plate goes dead — would sit on whichever of the two somebody
-- happened to think of.
--
-- # Why `doc_type` is free text
--
-- The kinds of paper GA files are the kinds the estate is regulated by, and
-- they change: STNK, BPKB, SLO, sertifikat tanah, polis, izin usaha, garansi.
-- A CHECK listing them would refuse the eighth the day it arrives, and the
-- refusal would land on whoever is standing at the filing cabinet. So the type
-- is a word the department writes — and the OVERVIEW below is driven by the
-- date, not by the type, so nothing downstream breaks when a new word appears.
ALTER TABLE document
    -- "STNK", "BPKB", "SLO", "SERTIFIKAT_TANAH". The department's own word.
    ADD COLUMN doc_type   TEXT,
    -- The number printed on the paper: an engine number, a certificate
    -- number, a policy number. What somebody reads back over the phone, and
    -- the one thing that finds the row when the name is "IMG_20260924.jpg".
    ADD COLUMN doc_number TEXT,
    -- Who issued it: "Bapenda / Samsat", "DPMPTSP Kota", "PT Asuransi Sentra
    -- Proteksi". A party NAME and not a supplier id — an issuing authority is
    -- often not a supplier of goods, and the certificate outlives the clerk
    -- who once had an id in another table.
    ADD COLUMN issuer     TEXT,
    ADD COLUMN issued_on  date,
    -- The date the paper stops being worth anything. Nullable: a BPKB has no
    -- such date, and inventing one would put a fictitious reminder in front of
    -- the department every year.
    ADD COLUMN expires_on date;

-- The one query this exists for: "which papers run out before the end of the
-- quarter". Partial, because most rows have no expiry at all — the drawer is
-- mostly invoices and correspondence — and a partial index keeps the ones that
-- do have a date small enough to stay in memory.
CREATE INDEX ix_document_expiry ON document (expires_on) WHERE expires_on IS NOT NULL;

-- A paper that expires before it was issued is a typing mistake, and a mistake
-- that produces a permanent overdue warning nothing can clear. Refused here so
-- it is refused once, at the moment somebody typed it.
ALTER TABLE document ADD CONSTRAINT document_expiry_is_after_issue
    CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on);

COMMENT ON COLUMN document.doc_type IS
    'The department''s own word for the paper (STNK, BPKB, SLO, garansi). Free text on purpose: the list is the regulation''s, not ours, and it grows.';
COMMENT ON COLUMN document.expires_on IS
    'The date the paper stops being worth anything. NULL is a fact about the paper (a BPKB has no such date), not a gap in the filing. A renewal with a fee is a CONTRACT, not a second date here.';
COMMENT ON COLUMN document.issuer IS
    'Who issued the paper, as a name. Not a supplier id: an issuing authority is often not somebody we buy from.';

DO $$
DECLARE
    absent  text;
    expiry  text;
BEGIN
    SELECT string_agg(c.name, ', ' ORDER BY c.name) INTO absent
      FROM unnest(ARRAY['doc_type', 'doc_number', 'issuer', 'issued_on', 'expires_on']) c(name)
     WHERE NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_name = 'document' AND column_name = c.name);
    IF absent IS NOT NULL THEN
        RAISE EXCEPTION '0358 left document without %', absent;
    END IF;

    -- The index, present AND partial. A full index on `expires_on` would be
    -- built over a drawer that is mostly NULLs, which is the cost this shape
    -- exists to avoid — so the predicate is asserted and not just the name.
    SELECT indexdef INTO expiry
      FROM pg_indexes
     WHERE tablename = 'document' AND indexname = 'ix_document_expiry';
    IF expiry IS NULL THEN
        RAISE EXCEPTION '0358 did not install an index on document.expires_on';
    END IF;
    IF expiry NOT LIKE '%WHERE%' THEN
        RAISE EXCEPTION '0358 installed document.expires_on as a whole-table index: %', expiry;
    END IF;

    -- A date that cannot go backwards, so the overview can never be handed a
    -- paper that expired before it existed.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'document'::regclass
           AND conname  = 'document_expiry_is_after_issue')
    THEN
        RAISE EXCEPTION '0358 did not refuse a document expiring before it was issued';
    END IF;

    -- And the subject vocabulary this feature hangs on. An asset's papers are
    -- filed with `subject_kind = ''asset''` (0190''s registry, which already
    -- carries it), and a hub that quietly found nothing because the word had
    -- moved would look exactly like an asset with no papers.
    IF NOT EXISTS (SELECT 1 FROM record_kind WHERE code = 'asset') THEN
        RAISE EXCEPTION '0358 expected ''asset'' to be one of the record kinds a document can be filed against';
    END IF;
END;
$$;
