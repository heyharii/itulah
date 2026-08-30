-- Authentication and role-based authorization.
--
-- Deliberately plain SQL (no plpgsql, no extensions) so a future SQLite edge
-- port can carry this table across engines with minimal translation.
--
-- Roles form a strict ladder: CASHIER < SUPERVISOR < ADMIN. The mapping of
-- endpoints to minimum roles lives in domain::auth, not in the database.

CREATE TABLE app_user (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE
        CHECK (username = lower(username) AND length(username) BETWEEN 3 AND 32),
    display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 128),
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('CASHIER', 'SUPERVISOR', 'ADMIN')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE INDEX app_user_active_idx ON app_user(active, role);
