-- A notification reaches the phone in the pocket.
--
-- Until now a notification waited to be FOUND: the bell counted it the next
-- time a screen asked, and a person who had closed the tab learned about a
-- price query when they next sat down. Web Push lets the browser that asked
-- for it be woken by its vendor's push service (FCM for Chrome and Android,
-- Mozilla's for Firefox, Apple's for Safari and an installed iPhone app), so
-- the notification arrives on a locked phone.
--
-- Two tables, and neither changes what a notification IS. The sentence, the
-- recipients and the read state stay exactly where 0046 put them; this only
-- remembers where each person can be reached, and which of those deliveries
-- are still owed.

-- Where one person can be reached: one row per browser that said yes.
--
-- The endpoint is the identity, not the person. It is a capability URL minted
-- by the push service for ONE browser profile, so the same phone signed in by
-- a second colleague re-registers the same endpoint — and the row moves to
-- them rather than the phone being told both people's work. That is why
-- `endpoint` is UNIQUE and the write is an upsert on it.
--
-- `username` is deliberately not a foreign key to `app_user`. A development
-- node with authentication off answers as `development`, who has no row; and
-- `notification_recipient.username` is not a foreign key either, so the two
-- columns that are joined agree on what a username is. A person who is
-- deactivated keeps their rows until the delivery worker sees `active = false`
-- and skips them; nothing is pushed to somebody who has left.
CREATE TABLE push_subscription (
    subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username        text NOT NULL CHECK (btrim(username) <> ''),
    -- Validated as an https URL on a known push service by the handler, which
    -- is where the reason can be said in words. Here only its size: a
    -- browser's endpoint is a few hundred characters, and a column the server
    -- will POST to should not hold a megabyte of anybody's choosing.
    endpoint        text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 12 AND 2048),
    -- The browser's ECDH public key and auth secret (RFC 8291), base64url as
    -- the browser hands them over. Not secrets in the password sense — they
    -- are what the payload is encrypted TO — but they are what makes a push
    -- readable, so they are never logged.
    p256dh          text NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 100),
    auth            text NOT NULL CHECK (length(auth) BETWEEN 16 AND 32),
    -- Something a person can recognise on a list of their devices: "Chrome on
    -- Android". Written by the client, so it is a label and never a fact.
    device_label    text CHECK (length(device_label) <= 120),
    user_agent      text CHECK (length(user_agent) <= 512),
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Every open of the app re-registers; this says the browser still holds it.
    refreshed_at    timestamptz NOT NULL DEFAULT now(),
    last_success_at timestamptz,
    -- Messages in a row this endpoint refused or never took. Reset by a
    -- success. The worker drops the subscription when this gets large: an
    -- endpoint that has refused ten messages is a phone that is gone, whatever
    -- status code it chose to say it with.
    failure_count   integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    -- A status code and a short reason, never the payload.
    last_error      text CHECK (length(last_error) <= 300)
);

CREATE INDEX ix_push_subscription_username ON push_subscription (username);

COMMENT ON TABLE push_subscription IS
    'One browser that agreed to be woken for one person''s notifications (Web Push, RFC 8030).';

-- What is still owed: one row per (notification, device).
--
-- An outbox rather than a send from the code that raised the notification.
-- That code is inside its own transaction — accepting a delivery, posting a
-- bill — and a push service in another country answering slowly must never
-- make it wait, let alone fail. So the transaction only writes a row here, and
-- a worker in the cloud process sends it after commit. A notification rolled
-- back takes its deliveries with it, because they were never committed.
--
-- Per device rather than per person, so one phone that is offline does not
-- hold back the laptop, and a retry is of the one delivery that failed.
--
-- A row is deleted when it is done — delivered, given up on, or no longer
-- worth sending — so this table is the queue and nothing else. What happened
-- to a device is on its subscription row (`last_success_at`, `last_error`).
CREATE TABLE push_delivery (
    delivery_id     bigserial PRIMARY KEY,
    notification_id uuid NOT NULL REFERENCES notification (notification_id) ON DELETE CASCADE,
    -- ON DELETE CASCADE: a subscription the push service said is gone (404,
    -- 410) takes whatever was still queued for it along.
    subscription_id uuid NOT NULL REFERENCES push_subscription (subscription_id) ON DELETE CASCADE,
    username        text NOT NULL,
    attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    -- Also the lease: a worker that claims a row pushes this forward before
    -- sending, so a second cloud process does not send the same one, and a
    -- worker that died mid-send leaves a row that comes due again by itself.
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error      text CHECK (length(last_error) <= 300),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (notification_id, subscription_id)
);

CREATE INDEX ix_push_delivery_due ON push_delivery (next_attempt_at);
CREATE INDEX ix_push_delivery_subscription ON push_delivery (subscription_id);

COMMENT ON TABLE push_delivery IS
    'Web Push deliveries still owed. Filled by a trigger on notification_recipient, drained by the cloud worker.';

-- Filled by a trigger, not by `raise_notification`.
--
-- Every path that tells somebody something ends in a row in
-- `notification_recipient`, including the ones written in SQL by a migration
-- or a scheduled job. A trigger there cannot be forgotten by the next module
-- that raises a notification in its own way.
--
-- Statement-level with a transition table: `raise_notification` writes all of
-- a notification's recipients in one statement, so this runs once per
-- notification rather than once per person.
--
-- And it can never refuse the notification. The insert is wrapped in its own
-- exception block, so a failure here — a subscription deleted in the same
-- instant, a constraint nobody foresaw — costs one push and a WARNING in the
-- server log, never the delivery that was being accepted when it happened.
-- A notification nobody was pushed is still in the list; a delivery refused
-- because a phone could not be told is a warehouse that cannot receive.
CREATE FUNCTION push_delivery_enqueue() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        INSERT INTO push_delivery (notification_id, subscription_id, username)
        SELECT arrived.notification_id, s.subscription_id, s.username
          FROM arrived
          JOIN push_subscription s ON s.username = arrived.username
         -- Written already read is not news; nothing raises one like that
         -- today, but the rule belongs here rather than in each caller.
         WHERE arrived.read_at IS NULL
        ON CONFLICT (notification_id, subscription_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'push delivery was not queued (%): %', SQLSTATE, SQLERRM;
    END;
    RETURN NULL;
END;
$$;

CREATE TRIGGER notification_recipient_push
    AFTER INSERT ON notification_recipient
    REFERENCING NEW TABLE AS arrived
    FOR EACH STATEMENT
    EXECUTE FUNCTION push_delivery_enqueue();
