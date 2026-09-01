-- Where goods stop being a quantity and become identified merchandise.
--
-- # What this is for
--
-- A delivery that has been counted and verified sits in `unidentified`: the
-- warehouse knows it has 118 pieces of the article it ordered, and nothing
-- else. No SKU, no tag, no price. It cannot be picked, allotted or sold,
-- because there is nothing yet to pick BY.
--
-- Head office resolves that here. It gives the article a name, a division and
-- tags, splits it into the colour/size variants that actually arrived, and
-- prices each one. That act mints the SKUs. Only then can a tagging job go
-- down to the DC, and only after tagging does the stock become individually
-- tracked units.
--
-- # Why the centre and only the centre
--
-- Identity is the one thing a node must never invent. Thirty shops each
-- coining their own SKU for the same shirt is thirty different products in
-- every report, and no amount of later cleanup recovers what the codes were
-- supposed to mean. So the centre mints, the edge receives and applies.
--
-- # The code format, and the cap it carries
--
-- An article code is 8 digits; a SKU is 11: `article(8) + colour(1) + size(2)`.
-- This is the format the business already uses, and it is enforced in the
-- domain codec rather than in a column type, for the reason our own history
-- gives: an article code has to be free to be reissued or absent, while a SKU
-- is DERIVED and can therefore be held to the rule absolutely.
--
-- The single digit of colour is a real, permanent ceiling: an article can
-- have at most ten colourways, ever. Not "awkwardly many" — ten. The eleventh
-- cannot be expressed, because there is no eleventh value of one digit. That
-- limit is inherited deliberately, with eyes open, because it is the format
-- the warehouse, the handhelds and the printed labels already speak.

-- ---------------------------------------------------------------------------
-- Vocabularies
-- ---------------------------------------------------------------------------

-- Divisions are a controlled list, not free text. A typo in free text does
-- not fail; it silently creates a division of one and quietly splits every
-- report that groups by it.
CREATE TABLE division (
    code          text PRIMARY KEY CHECK (btrim(code) <> ''),
    label         text NOT NULL CHECK (btrim(label) <> ''),
    display_order integer NOT NULL DEFAULT 0,
    active        boolean NOT NULL DEFAULT true
);

-- Sizes are global: `03` is M on every article in the company. This is what
-- makes a size filter meaningful across the catalogue.
CREATE TABLE size_code (
    code          char(2) PRIMARY KEY CHECK (code ~ '^[0-9]{2}$'),
    label         text NOT NULL CHECK (btrim(label) <> ''),
    display_order integer NOT NULL DEFAULT 0,
    active        boolean NOT NULL DEFAULT true
);

INSERT INTO division (code, label, display_order) VALUES
    ('MENSWEAR',   'Menswear',   10),
    ('WOMENSWEAR', 'Womenswear', 20),
    ('KIDS',       'Kids',       30),
    ('FOOTWEAR',   'Footwear',   40),
    ('ACCESSORY',  'Accessories', 50);

INSERT INTO size_code (code, label, display_order) VALUES
    ('00', 'No Size',  0),
    ('01', 'XS',      10),
    ('02', 'S',       20),
    ('03', 'M',       30),
    ('04', 'L',       40),
    ('05', 'XL',      50),
    ('06', 'XXL',     60),
    ('07', 'XXXL',    70),
    ('08', 'One Size', 80),
    ('11', 'EU 37',  110),
    ('12', 'EU 38',  120),
    ('13', 'EU 39',  130),
    ('14', 'EU 40',  140),
    ('15', 'EU 41',  150);

-- ---------------------------------------------------------------------------
-- Master article, extended
-- ---------------------------------------------------------------------------

-- `article` and `sku` already existed, carrying only what the demo seed
-- needed. These columns are what a real master article has to say, and they
-- are nullable so the rows that predate this migration remain legal. Anything
-- MINTED from here on is required to have them.
-- Tags live in their own table (see 0027), because a free-text tag does not
-- fail when it is misspelt — it silently splits every report that groups by it.
ALTER TABLE article
    ADD COLUMN division_code text REFERENCES division(code),
    ADD COLUMN image_url     text,
    -- Which setup session first created this article, so a reader can get
    -- from a product back to the delivery that prompted it.
    ADD COLUMN created_by_session_id uuid;

CREATE INDEX ix_article_division ON article(division_code) WHERE division_code IS NOT NULL;

-- Colour is ARTICLE-SCOPED: digit 3 is not a colour, it is *this article's*
-- third colourway. Two articles may both use digit 3 for entirely different
-- colours, and that is correct — the digit only has meaning inside the SKU
-- string it sits in.
CREATE TABLE article_colour (
    article_id   uuid    NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    colour_digit char(1) NOT NULL CHECK (colour_digit ~ '^[0-9]$'),
    label        text    NOT NULL CHECK (btrim(label) <> ''),
    hex_code     text    CHECK (hex_code IS NULL OR hex_code ~ '^#[0-9A-Fa-f]{6}$'),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, colour_digit)
);

-- A colour name may not be used twice on one article under different digits:
-- two digits both called "Merah" produce two SKUs that no human can tell
-- apart on a picking list.
CREATE UNIQUE INDEX article_colour_label_unique
    ON article_colour(article_id, lower(btrim(label)));

ALTER TABLE sku
    ADD COLUMN colour_digit     char(1) CHECK (colour_digit IS NULL OR colour_digit ~ '^[0-9]$'),
    ADD COLUMN size_code        char(2) REFERENCES size_code(code),
    -- The price the article was given when it was set up. Commercial
    -- publication overrides this per site, channel and period; this is the
    -- floor underneath, so a SKU minted today is sellable today rather than
    -- waiting on a publication that mentions it.
    ADD COLUMN base_price_minor bigint CHECK (base_price_minor IS NULL OR base_price_minor >= 0),
    ADD COLUMN currency         char(3),
    -- One QR per SKU, not per unit: the QR says *what* this is, the EPC says
    -- *which one*. Every red medium shirt carries the same QR and its own EPC.
    ADD COLUMN qr_payload       text,
    ADD COLUMN created_by_session_id uuid,
    -- The colour digit must belong to this SKU's own article.
    ADD CONSTRAINT sku_colour_belongs_to_article
        FOREIGN KEY (article_id, colour_digit)
        REFERENCES article_colour(article_id, colour_digit),
    -- Priced means priced in something.
    ADD CONSTRAINT sku_price_has_currency
        CHECK ((base_price_minor IS NULL) = (currency IS NULL));

CREATE INDEX ix_sku_qr ON sku(qr_payload) WHERE qr_payload IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The setup session
-- ---------------------------------------------------------------------------

-- Head office's working document: one delivery's worth of goods being given
-- an identity. It is keyed to the receipt so that variants can only ever be
-- declared for goods that actually arrived — a session floating free of a
-- receipt would let someone mint stock by describing it.
CREATE TABLE article_setup_session (
    session_id       uuid PRIMARY KEY,
    -- One line of one delivery: a truck brings several articles, and each is
    -- worked out on its own. The reference goes in with migration 0028, which
    -- is where a receipt stops being an alias for a count and becomes a
    -- document in its own right.
    receipt_line_id  uuid NOT NULL UNIQUE,
    -- OUR article code, minted at setup. Eight digits, because a SKU is this
    -- plus a colour digit plus a size code.
    --
    -- It is NOT the code on the purchase order. That one belongs to the
    -- supplier: two suppliers will use the same string for different goods,
    -- and one supplier will change theirs between shipments, so it can never
    -- be an identity. The order tells us what to expect on the loading bay;
    -- what the thing IS gets decided here.
    article_code     char(8) NOT NULL CHECK (article_code ~ '^[0-9]{8}$'),
    -- What the supplier called it, copied from the order line. Kept so a
    -- buyer can trace a product back to the line it was bought on, and so a
    -- second shipment of the same supplier code can be recognised by a human.
    supplier_article_code text,
    -- Copied from the receipt at creation, so the session states plainly what
    -- it is splitting and the sum check has something local to check against.
    receipt_quantity bigint NOT NULL CHECK (receipt_quantity > 0),
    destination_site_id text NOT NULL,

    -- What head office decides.
    article_name  text NOT NULL CHECK (btrim(article_name) <> ''),
    division_code text NOT NULL REFERENCES division(code),
    image_url     text,
    currency      char(3) NOT NULL,

    -- OPEN, not DRAFT: head office fills the form and submits it. There is no
    -- save-and-come-back, so there is no third state to reason about.
    status        text NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN', 'ISSUED', 'TAGGED', 'CANCELLED')),
    created_by    text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    issued_by     text,
    issued_at     timestamptz,
    tagged_at     timestamptz,
    cancelled_at  timestamptz,
    -- The command that carried the tagging job to the DC.
    tagging_command_id uuid,

    -- Issuing stamps a time and never un-stamps it, so a session cancelled
    -- after it was issued keeps the mark. Writing this as one equality would
    -- have made cancelling an un-issued session impossible.
    CHECK (status <> 'OPEN' OR issued_at IS NULL),
    CHECK (status NOT IN ('ISSUED', 'TAGGED') OR issued_at IS NOT NULL),
    CHECK ((issued_at IS NULL) = (issued_by IS NULL)),
    CHECK ((status = 'TAGGED') = (tagged_at IS NOT NULL)),
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE INDEX ix_setup_session_status ON article_setup_session(status, created_at);
CREATE INDEX ix_setup_session_article ON article_setup_session(article_code);

-- The colourways this session declares. Separate from the variants so that
-- one digit cannot be given two different names within a session — a
-- contradiction that would otherwise only surface once the labels were
-- printed.
CREATE TABLE article_setup_colour (
    session_id   uuid    NOT NULL REFERENCES article_setup_session(session_id) ON DELETE CASCADE,
    colour_digit char(1) NOT NULL CHECK (colour_digit ~ '^[0-9]$'),
    label        text    NOT NULL CHECK (btrim(label) <> ''),
    hex_code     text    CHECK (hex_code IS NULL OR hex_code ~ '^#[0-9A-Fa-f]{6}$'),
    PRIMARY KEY (session_id, colour_digit)
);
CREATE UNIQUE INDEX article_setup_colour_label_unique
    ON article_setup_colour(session_id, lower(btrim(label)));

-- One row per (colour, size) actually present in the delivery, with how many
-- of them there are and what they will sell for.
CREATE TABLE article_setup_variant (
    session_id       uuid    NOT NULL,
    colour_digit     char(1) NOT NULL,
    size_code        char(2) NOT NULL REFERENCES size_code(code),
    target_quantity  bigint  NOT NULL CHECK (target_quantity > 0),
    base_price_minor bigint  NOT NULL CHECK (base_price_minor >= 0),
    PRIMARY KEY (session_id, colour_digit, size_code),
    FOREIGN KEY (session_id, colour_digit)
        REFERENCES article_setup_colour(session_id, colour_digit) ON DELETE CASCADE
);

COMMENT ON TABLE article_setup_session IS
    'Head office giving a verified delivery its identity: name, division, tags, variants and prices. Issuing it mints SKUs and sends a tagging job to the DC.';
COMMENT ON COLUMN article_setup_session.receipt_quantity IS
    'What the DC counted and a second person accepted. The declared variant quantities must sum to exactly this: anything else invents or loses stock.';
COMMENT ON TABLE article_colour IS
    'Colour digits are scoped to one article, which caps an article at ten colourways permanently — the digit is one character of the SKU string.';
