-- Accepting an identity and scheduling its mint are one transaction. A lease
-- recovers work after a process dies; the session row lock prevents two mints.
CREATE TABLE article_setup_issue_queue (
    session_id uuid PRIMARY KEY REFERENCES article_setup_session(session_id),
    issued_by text NOT NULL CHECK (btrim(issued_by) <> ''),
    state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','PROCESSING','FAILED','DONE')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX article_setup_issue_due_idx ON article_setup_issue_queue(next_attempt_at,created_at)
    WHERE state IN ('QUEUED','PROCESSING');
