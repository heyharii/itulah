-- A line proposes its own counterparty.
--
-- # What ERPNext does, and what is taken from it
--
-- `auto_match_party.py` runs when a bank transaction is submitted: the
-- party's account number (or IBAN) from the statement is matched against the
-- Bank Account master, and whoever owns the matching account becomes the
-- transaction's party — without a person typing a name. The match is
-- evidence-shaped, and that is the part worth copying: the account number is
-- the one identifier both sides of a transfer spell identically.
--
-- # What is deliberately different
--
-- ERPNext WRITES the party it matched and lets a person undo it. This estate
-- earned the opposite reflex in 0116: rules PROPOSE, people decide. A wrong
-- party on a bank line is a mis-aged balance with nobody's name on the
-- decision, and fuzzy matching made it worse by being confidently wrong. So
-- the matcher here never writes `party_type`/`party_id` on the line — it
-- writes a PROPOSAL row, the way `bank_rule` writes `bank_rule_proposal`
-- (0116), and a person accepts. `bank_said` (0214) stays untouched by both
-- halves: what the bank called them is evidence, and a proposal is not
-- evidence.
--
-- Fuzzy matching by party NAME — ERPNext's `AutoMatchbyPartyNameDescription`
-- — is deliberately absent. A name belongs to a person's reading of the
-- evidence, which is the screen they already have; a matcher that guesses by
-- name is the invention `bank_match.rs` refuses on the voucher side for the
-- same reason. Enable it later, behind the same setting ERPNext uses
-- (`enable_fuzzy_matching`, default off), only if the no-name-match rate
-- says it is worth having.

-- What the matcher read out of a line, and what it proposes.
CREATE TABLE party_proposal (
    proposal_id  uuid PRIMARY KEY,
    line_id      uuid NOT NULL REFERENCES bank_statement_line (line_id) ON DELETE CASCADE,

    -- Copied at the moment of matching: a proposal must stay readable — and
    -- refusable — even if the account is later retired (0116's reasoning
    -- about the rule that named it).
    party_type   text NOT NULL REFERENCES party_type (party_type),
    party_id     text NOT NULL,
    party_name   text NOT NULL,

    -- How the line was recognised. ACCOUNT means the digits in the narration
    -- matched the account's own digits or fingerprint; the confidence note is
    -- a sentence, not a score — the reconciliation screen prints sentences.
    matched_via  text NOT NULL CHECK (matched_via IN ('ACCOUNT_DIGITS', 'FINGERPRINT')),
    matched_on   text NOT NULL CHECK (btrim(matched_on) <> ''),
    matcher_version text NOT NULL CHECK (btrim(matcher_version) <> ''),

    -- PROPOSED  waiting for a person
    -- ACCEPTED  the party moved onto the line (and `bank_said` did not move)
    -- IGNORED   a person looked and said no — which is what stops the same
    --           proposal being made forever
    status       text NOT NULL DEFAULT 'PROPOSED'
                 CHECK (status IN ('PROPOSED', 'ACCEPTED', 'IGNORED')),
    decided_by   text,
    decided_at   timestamptz,

    created_at   timestamptz NOT NULL DEFAULT now(),

    CHECK ((status = 'PROPOSED') = (decided_by IS NULL)),
    CHECK ((status = 'PROPOSED') = (decided_at IS NULL))
);

CREATE INDEX ix_party_proposal_status ON party_proposal (status, created_at DESC);
CREATE INDEX ix_party_proposal_line ON party_proposal (line_id);

-- One open proposal per line. A second would be two matchers speaking at
-- once; re-matching supersedes the old proposal rather than joining it.
CREATE UNIQUE INDEX ux_party_proposal_open
    ON party_proposal (line_id) WHERE status = 'PROPOSED';

COMMENT ON TABLE party_proposal IS
    'The matcher''s reading of who a bank line was for, waiting for a person. Never written onto the line by the matcher itself: acceptance is a person''s act, and accepting writes party_type/party_id/party_name on the bank_statement_line while bank_said stays exactly what the bank printed (0214).';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF (SELECT count(*) FROM pg_indexes
         WHERE tablename = 'party_proposal'
           AND indexname = 'ux_party_proposal_open') <> 1 THEN
        RAISE EXCEPTION 'the one-open-proposal-per-line index is missing';
    END IF;
END $$;
