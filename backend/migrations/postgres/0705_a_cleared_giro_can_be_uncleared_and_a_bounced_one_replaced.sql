-- 0705: A cleared giro can be un-cleared, and a bounced one replaced.
--
-- # The three things 7Soft's giro screen does that this ledger could not
--
-- `Pencairan BG` has four buttons: Cair, Tolak, Batal Cair and Checked. Since
-- 0117 we had Cair (clear) and Tolak (reject) — and a settled giro was
-- terminal, so:
--
--   * **Batal Cair.** A giro cleared against the wrong statement line, or
--     cleared a day early by somebody reading the bank's app, could not be
--     taken back. The only way out was a hand-written journal, which left the
--     giro saying CLEARED against money that had not moved.
--   * **Tolak after Cair.** A bank that took a customer's giro and then
--     returned it unpaid two days later — the common case, because clearing
--     is provisional until the drawer's bank answers — had no path: REJECTED
--     was reachable only from the three live states.
--   * **The replacement.** When a giro bounces, 7Soft's BKM has a Tolakan
--     button that records the payment that replaces it, and its report
--     "Perincian Tolakan Giro" follows each bounce to what settled it. Here a
--     bounce reopened the bill and said nothing about what happened next.
--
-- # How un-clearing stays honest
--
-- The clearing entry is not deleted and not edited: it is reversed, by id,
-- into an open period — the same argument `poster::reverse` makes everywhere.
-- The statement line it claimed is released. And the fact that it was ever
-- cleared is kept in `giro_unclearing`, because the giro row's own clearing
-- columns go back to empty (0117's checks tie them to CLEARED).
--
-- 0117's guard said a settled giro is settled. It still does, with exactly
-- one exception: a CLEARED giro may leave CLEARED — to DUE (un-cleared) or
-- to REJECTED (bounced after clearing) — only when its clearing has been
-- written down as undone in the same transaction. Every other move out of a
-- settled state is refused as before.

CREATE TABLE giro_unclearing (
    unclearing_id     bigserial PRIMARY KEY,
    giro_id           uuid NOT NULL REFERENCES giro (giro_id),
    -- The clearing that was undone, and the mirror that undid it.
    clearing_entry_id uuid NOT NULL REFERENCES journal_entry (entry_id),
    reversal_entry_id uuid NOT NULL REFERENCES journal_entry (entry_id),
    cleared_on        date NOT NULL,
    cleared_line_id   uuid REFERENCES bank_statement_line (line_id),
    undone_on         date NOT NULL,
    reason            text NOT NULL CHECK (btrim(reason) <> ''),
    -- True when the undo was the first half of a bounce after clearing.
    then_rejected     boolean NOT NULL DEFAULT false,
    undone_by         text NOT NULL CHECK (btrim(undone_by) <> ''),
    undone_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (clearing_entry_id)
);

CREATE INDEX ix_giro_unclearing_giro ON giro_unclearing (giro_id, undone_at);

CREATE TRIGGER giro_unclearing_append_only
    BEFORE UPDATE OR DELETE ON giro_unclearing
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

COMMENT ON TABLE giro_unclearing IS
    'Every clearing of a giro that was taken back — Batal Cair, or the first half of a bounce '
    'after clearing — with the reversal that undid it (0705).';

-- The replacement: what settled the debt a bounced giro failed to.
ALTER TABLE giro
    ADD COLUMN replaced_by_payment_id  uuid REFERENCES supplier_payment (payment_id),
    ADD COLUMN replaced_by_document_id uuid REFERENCES cash_document (document_id),
    ADD COLUMN replaced_by             text,
    ADD COLUMN replaced_at             timestamptz,
    ADD CONSTRAINT giro_replaced_once
        CHECK (num_nonnulls(replaced_by_payment_id, replaced_by_document_id) <= 1),
    ADD CONSTRAINT giro_replacement_says_who
        CHECK ((num_nonnulls(replaced_by_payment_id, replaced_by_document_id) = 1)
               = (replaced_by IS NOT NULL AND replaced_at IS NOT NULL)),
    ADD CONSTRAINT giro_only_a_bounce_is_replaced
        CHECK (status = 'REJECTED' OR num_nonnulls(replaced_by_payment_id, replaced_by_document_id) = 0);

COMMENT ON COLUMN giro.replaced_by_payment_id IS
    'The supplier payment that settled what this bounced giro did not (0705).';
COMMENT ON COLUMN giro.replaced_by_document_id IS
    'The cash document that settled what this bounced giro did not (0705).';

CREATE OR REPLACE FUNCTION protect_settled_giro() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('CLEARED', 'REJECTED') AND NEW.status <> OLD.status THEN
        -- The one way out of a settled state (0705): a clearing somebody took
        -- back, written down before the giro moved.
        IF NOT (
            OLD.status = 'CLEARED'
            AND NEW.status IN ('DUE', 'REJECTED')
            AND EXISTS (SELECT 1 FROM giro_unclearing u
                         WHERE u.giro_id = OLD.giro_id
                           AND u.clearing_entry_id = OLD.clearing_entry_id)
        ) THEN
            RAISE EXCEPTION
                'giro % at % is already %; it cannot be settled twice',
                OLD.number, OLD.bank, lower(OLD.status);
        END IF;
    END IF;
    IF OLD.status IN ('CLEARED', 'REJECTED') AND (
           NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
        OR NEW.bank         IS DISTINCT FROM OLD.bank
        OR NEW.number       IS DISTINCT FROM OLD.number
        OR NEW.due_date     IS DISTINCT FROM OLD.due_date
    ) THEN
        RAISE EXCEPTION
            'giro % at % is %; what it was written for cannot change afterwards',
            OLD.number, OLD.bank, lower(OLD.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
