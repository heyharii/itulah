-- Who works here, under what contract, and where they are posted.
--
-- Ported from the reference HR backend's `034_employee_v1.sql` and
-- `041_employee_profile_contract_v1.sql`, adapted to this schema.
-- `docs/hr-port-provenance.md` records what changed and why.
--
-- The employment record is NOT the login. `app_user` is a credential, and one
-- person can lose and regain one; a candidate exists in HR before any login is
-- issued, and a machine account is a login with nobody behind it. The two are
-- joined at the bottom of this file, not merged.

-- Where the company operates, as employment means it.
--
-- Not `site`: every row of that table is a node that syncs, which is why
-- `edge_node_id` is NOT NULL there and why its kinds are DC and STORE. Head
-- office is neither and has no edge node — yet it is where the buyer, the HR
-- officer and the payroll manager are posted, so it has to be nameable as a
-- posting or those people cannot be employed anywhere.
--
-- Not `operational_pool` either: that is warehouse geography, shelves and
-- staging areas inside one site. This is organisational geography. Different
-- question, different table.
--
-- Sites keep their own ids here, so nothing ever has to translate between the
-- two vocabularies.
CREATE TABLE org_place (
    id         text PRIMARY KEY,
    name       text NOT NULL CHECK (btrim(name) <> ''),
    kind       text NOT NULL CHECK (kind IN ('HO', 'DC', 'STORE')),
    -- The syncing node this place is, when it is one.
    site_id    text REFERENCES site(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- A DC or a store IS a site; head office is not. Stated as a constraint
    -- rather than left as a convention because the first query somebody writes
    -- will join on `site_id`, and a head office that is merely *usually* null
    -- would be silently dropped from it.
    CONSTRAINT org_place_site_matches_kind CHECK (
        (kind =  'HO' AND site_id IS NULL) OR
        (kind <> 'HO' AND site_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX ix_org_place_site
    ON org_place (site_id) WHERE site_id IS NOT NULL;

-- Every existing site becomes a place, keeping its id, plus the one place that
-- was never a site. New sites need a place too; the code that provisions one
-- writes both, because a site nobody can be posted to is a shop with no staff.
INSERT INTO org_place (id, name, kind, site_id)
SELECT id, name, kind, id FROM site;

INSERT INTO org_place (id, name, kind, site_id)
VALUES ('ho', 'Head Office', 'HO', NULL);

-- The employment record.
--
-- `status` is denormalised from `history`, deliberately and with a guard. The
-- authority is the event list: the loader replays the whole state machine over
-- `history` and refuses a row whose claimed status that history does not
-- produce. The column exists so "who is currently employed" is an index scan
-- rather than a fold over every person's past, and it is safe only because
-- nothing may write it except that fold.
CREATE TABLE employee (
    id           text PRIMARY KEY,
    -- The badge number. A *code*, not the identity: it can be reissued or
    -- corrected, which is why nothing keys on it — but two live people must
    -- not carry the same one.
    code         text NOT NULL CHECK (btrim(code) <> ''),
    status       text NOT NULL CHECK (status IN (
                     'CANDIDATE', 'ACTIVE', 'SUSPENDED', 'TERMINATED'
                 )),
    -- Append-only employment events, oldest first. The authority for `status`.
    history      jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Badge corrections, chained. Identity never moves with them.
    code_history jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ix_employee_code ON employee (code);
CREATE INDEX ix_employee_status ON employee (status, id);

-- Where a person is posted, over time.
--
-- Deliberately not the same table as `edge_identity_assignment`, which already
-- exists and answers a different question: that one is an access grant — which
-- till you may sign into, with what role, with which PIN. A district
-- supervisor may hold five of those while being posted to one place, and an HR
-- officer has a posting and no till access at all. One table cannot answer
-- both without lying about one of them.
CREATE TABLE employee_assignment (
    id          text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    place_id    text NOT NULL REFERENCES org_place(id),
    valid_from  date NOT NULL,
    valid_to    date,
    -- NOT `authorization`: that is a reserved word in PostgreSQL, and a column
    -- named it fails the CREATE TABLE outright. Holds who moved this person,
    -- under what authority, when, and why.
    authorized  jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_assignment_ends_after_it_starts
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX ix_employee_assignment_employee
    ON employee_assignment (employee_id, valid_from DESC, id);
CREATE INDEX ix_employee_assignment_place
    ON employee_assignment (place_id, valid_from DESC, id);
-- At most one open posting per person. Two open spans mean the person is in
-- two places at once, and every downstream "which place does this belong to"
-- question then has two answers and no way to choose between them.
CREATE UNIQUE INDEX ix_employee_assignment_one_open
    ON employee_assignment (employee_id) WHERE valid_to IS NULL;

-- Personal data, in its own table.
--
-- A separate table rather than more columns on `employee`, and the split is
-- the whole point: reading a rota and reading somebody's NIK and home address
-- are different privileges. A separate table is what lets a read replica, a
-- column grant or an export exclude one without excluding the other.
--
-- The amendments are the authority, not decoration: the loader replays the
-- chain and refuses a record whose current values the amendments do not
-- produce. A row whose `full_name` was edited in `psql` with the history left
-- alone fails to hydrate rather than becoming the answer — the same guarantee
-- `employee.status` has.
CREATE TABLE employee_profile (
    employee_id text PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
    full_name   text NOT NULL CHECK (btrim(full_name) <> ''),
    -- Exactly sixteen digits. Deliberately NOT unique: duplicate NIKs exist in
    -- the national registry, and a unique index here would refuse a real
    -- person because of somebody else's data-entry error at Dukcapil. Nothing
    -- keys on this value; it is recorded because statutory filings ask for it.
    -- The domain checks the shape too — this is the belt to that pair of
    -- braces, and it is here because the table outlives any one loader.
    nik         text NOT NULL CHECK (nik ~ '^[0-9]{16}$'),
    birth_date  date NOT NULL,
    address     text NOT NULL CHECK (btrim(address) <> ''),
    phone       text,
    email       text,
    -- Append-only. Each names what changed, who changed it, and why.
    amendments  jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Employment contracts.
--
-- Rows rather than one JSONB timeline, because HR genuinely asks SQL questions
-- of this: "whose PKWT ends this quarter" is a report somebody runs on a
-- Monday, and a JSONB array would make it a full scan and a fold. The ordering
-- and overlap rules stay the domain's — the timeline is rebuilt by appending
-- each row in order, so a stored pair that overlaps, or a fixed term following
-- a permanent one, fails to hydrate.
CREATE TABLE employee_contract (
    id          text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- PKWT is fixed-term, PKWTT is permanent. The distinction is load-bearing
    -- rather than decorative: which one somebody is on decides notice,
    -- severance, and whether an end date approaching is news at all.
    kind        text NOT NULL CHECK (kind IN ('PKWT', 'PKWTT')),
    starts_on   date NOT NULL,
    ends_on     date,
    position    text NOT NULL CHECK (btrim(position) <> ''),
    grade       text NOT NULL CHECK (btrim(grade) <> ''),
    -- See `employee_assignment.authorized` for the name.
    authorized  jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- The rule UU 13/2003 art. 59 turns on, enforced here as well as in the
    -- type: a PKWT must say when it ends, and a PKWTT must not. In a schema
    -- where `kind` is a string and this column is merely nullable, both
    -- mistakes are one typo away, and neither shows up until somebody's
    -- contract silently expires — or silently does not.
    CONSTRAINT employee_contract_term_matches_kind CHECK (
        (kind = 'PKWT'  AND ends_on IS NOT NULL) OR
        (kind = 'PKWTT' AND ends_on IS NULL)
    ),
    CONSTRAINT employee_contract_ends_after_it_starts CHECK (
        ends_on IS NULL OR ends_on >= starts_on
    )
);

CREATE INDEX ix_employee_contract_employee
    ON employee_contract (employee_id, starts_on DESC, id);
-- The report that made this a table rather than a column: which fixed terms
-- are running out.
CREATE INDEX ix_employee_contract_expiry
    ON employee_contract (ends_on) WHERE ends_on IS NOT NULL;

-- The join this whole migration exists for.
--
-- Nullable in both directions on purpose. A candidate exists in HR before a
-- login is issued, and the machine accounts that move stock between nodes are
-- logins with nobody behind them; neither is an error to be constrained away.
--
-- ON DELETE RESTRICT rather than CASCADE: ending an employment record must not
-- silently take a login with it. Someone who has left keeps their audit trail,
-- and the account is disabled by the code that handles leaving, in daylight.
ALTER TABLE app_user
    ADD COLUMN employee_id text REFERENCES employee(id) ON DELETE RESTRICT;

-- One login per employment record. Two accounts pointing at one employee makes
-- "who is this person" ambiguous at exactly the moment it matters — an audit.
CREATE UNIQUE INDEX ix_app_user_employee
    ON app_user (employee_id) WHERE employee_id IS NOT NULL;

COMMENT ON TABLE org_place IS
    'Organisational geography: the places people are posted to. Head office is '
    'one and is not a site; DCs and stores are sites and keep their site ids.';
COMMENT ON COLUMN employee.status IS
    'Denormalised from history for index scans. The fold is the authority — '
    'a row whose history does not produce this value fails to load.';
COMMENT ON COLUMN employee.code IS
    'Badge number. Correctable, therefore never a key: identity is employee.id.';
COMMENT ON COLUMN employee_profile.nik IS
    'Sixteen digits, deliberately not unique: duplicates exist in the national '
    'registry and nothing here keys on it.';
COMMENT ON TABLE employee_assignment IS
    'Where somebody is posted, over time. Not access: edge_identity_assignment '
    'says which till they may sign into, which is a different question.';
