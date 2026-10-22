-- A koli is verified by RFID before it goes (owner, 21 Oct 2026: "verify rfid
-- yg kita select dulu koli yg mana … rfid verified … list EPC nya").
--
-- The handheld reads the tags of the koli chosen on the Packed tab; each koli
-- is checked against its own units (dc_koli_unit). The last check of a koli is
-- kept: which of its EPCs were read, how many were not, who checked and when.
-- `verified_at` is set only when every unit was read. A new table, nothing
-- else changes: the binary before this one never reads it.
CREATE TABLE IF NOT EXISTS dc_koli_rfid_check (
    koli_id     uuid PRIMARY KEY REFERENCES dc_koli (koli_id),
    read_epcs   text[] NOT NULL DEFAULT '{}',
    total       integer NOT NULL CHECK (total >= 0),
    missing     integer NOT NULL CHECK (missing >= 0 AND missing <= total),
    checked_by  text NOT NULL CHECK (btrim(checked_by) <> ''),
    checked_at  timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    CHECK ((verified_at IS NULL) = (missing > 0))
);
