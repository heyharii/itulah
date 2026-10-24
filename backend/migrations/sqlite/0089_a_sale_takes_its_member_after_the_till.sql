-- 0089: A sale takes its member after the till, and a float goes back
-- without closing the drawer.
--
-- Client, 24 Oct 2026 (POS port, B1 and B2):
--
-- `sale_member` — F5 "Daftar member" with a struk number: the shopper who paid
-- without a card registers at the counter, and the sale they just paid for is
-- theirs (`edge::till::attach_member`). One row per sale, and only for a sale
-- that had nobody on it at the till: the member named here earns the sale's
-- points as if they had been on it, worked out by the same earning rule at the
-- sale's own instant. The row is what makes a second attempt the same answer
-- rather than a second award, and the fact it writes
-- (`sales.member_attached`) is what carries the award to head office, after
-- the sale's own fact on the same stream.
--
-- "Setor modal" (`FLOAT_RETURN`, slip SM-0001) needs `cash_movement.kind` and
-- `cash_slip.kind` to allow the word. SQLite widens a CHECK only by rebuilding
-- the table, so that is done in code, once, from the live definition
-- (`edge::till::apply_float_return_schema`) — not here.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS sale_member (
    sale_id       TEXT PRIMARY KEY REFERENCES sale(id),
    -- The member's number as head office keeps it (`member.member_id`).
    member_id     TEXT NOT NULL,
    -- Their name as head office answered when the member was tied on; null
    -- when head office could not be asked.
    member_name   TEXT,
    points_earned INTEGER NOT NULL CHECK (points_earned >= 0),
    attached_by   TEXT NOT NULL,
    attached_at   TEXT NOT NULL
);
