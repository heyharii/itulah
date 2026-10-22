-- 0080: A shop remembers what it counted (owner, 17–18 Oct 2026).
--
-- A blind count per SKU (`edge::inbound::StoreInboundCountRequest`) books at
-- most what was sent of each SKU: pieces beyond it, and pieces of a SKU the
-- delivery did not carry, have no tag of the delivery to book, so they are
-- not stock here. Until now the count itself was then forgotten — head office
-- saw only what was booked, and a piece meant for another shop, an extra, or
-- an article the shop added by search was invisible.
--
-- The count is kept as it was typed, per SKU, one row per delivery × SKU, and
-- travels to head office on the delivery's receipt
-- (`inventory.inbound.received.v1`, `counted`). There MD reviews what differs
-- from what was sent: what matches is in stock already, what does not waits
-- on hold until MD decides. `IF NOT EXISTS`, so it runs on every open.

-- A delivery from an allotment whose count differs from what was sent books
-- nothing: its goods are the shop's only once MD has answered the trip's
-- review (owner, 18 Oct 2026, "pengakuan saat review selesai"). A count that
-- matches books everything at once, as it always did. One row per delivery in
-- review; MD's answer (`inventory.store_inbound.on_hold.v1`) closes it and
-- books what head office names.
CREATE TABLE IF NOT EXISTS store_inbound_review (
    delivery_id     TEXT PRIMARY KEY,
    opened_at       TEXT NOT NULL,
    decision        TEXT CHECK (decision IS NULL OR decision IN ('AS_DELIVERED', 'RETURN_REALLOT')),
    dispatch_number TEXT,
    decided_by      TEXT,
    decided_at      TEXT,
    command_id      TEXT,
    CHECK ((decision IS NULL) = (decided_at IS NULL))
);

-- What MD answered for the hold, per SKU, as head office sent it
-- (`inventory.store_inbound.on_hold.v1`): `kept` pieces — another shop's,
-- accepted as delivered here — were booked by the command itself,
-- `send_back` pieces go back to HO.
CREATE TABLE IF NOT EXISTS store_inbound_hold_decision (
    delivery_id TEXT NOT NULL,
    sku_code    TEXT NOT NULL,
    kept        INTEGER NOT NULL DEFAULT 0 CHECK (kept >= 0),
    send_back   INTEGER NOT NULL DEFAULT 0 CHECK (send_back >= 0),
    decision    TEXT NOT NULL CHECK (decision IN ('AS_DELIVERED', 'RETURN_REALLOT')),
    dispatch_number TEXT NOT NULL,
    decided_by  TEXT NOT NULL,
    decided_at  TEXT NOT NULL,
    command_id  TEXT NOT NULL,
    PRIMARY KEY (delivery_id, sku_code)
);

CREATE TABLE IF NOT EXISTS store_inbound_count (
    delivery_id TEXT NOT NULL,
    sku_code    TEXT NOT NULL CHECK (length(trim(sku_code)) > 0 AND sku_code = upper(sku_code)),
    counted     INTEGER NOT NULL CHECK (counted >= 0),
    counted_at  TEXT NOT NULL,
    PRIMARY KEY (delivery_id, sku_code)
);

-- A count in review the shop took back (owner, 18 Oct 2026, "Recall count"):
-- while MD has not answered, the shop may withdraw its count and count again.
-- A count in review booked nothing, so a recall moves no stock: the delivery
-- is in transit again, its count and its open review are gone, and head
-- office is told (`inventory.inbound.recalled.v1`) so the trip waits for the
-- shop's new count. The withdrawn count is kept here as it stood: should
-- MD's answer reach the shop after the recall (MD answered first, at head
-- office), the count it answered is put back (`restored_at`) and the answer
-- applies to it.
CREATE TABLE IF NOT EXISTS store_inbound_recall (
    recall_id               TEXT PRIMARY KEY,
    delivery_id             TEXT NOT NULL REFERENCES store_inbound_delivery(delivery_id),
    counted_json            TEXT NOT NULL,
    received_at             TEXT NOT NULL,
    received_by             TEXT,
    receive_idempotency_key TEXT,
    receive_digest          TEXT,
    skipped_epcs_json       TEXT NOT NULL DEFAULT '[]',
    review_opened_at        TEXT NOT NULL,
    recalled_by             TEXT NOT NULL,
    recalled_at             TEXT NOT NULL,
    restored_at             TEXT
);
CREATE INDEX IF NOT EXISTS store_inbound_recall_by_delivery
    ON store_inbound_recall (delivery_id, recalled_at);
