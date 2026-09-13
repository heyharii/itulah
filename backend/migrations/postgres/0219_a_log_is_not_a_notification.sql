-- A log is not a notification.
--
-- Until today every successful write announced itself to every active user,
-- with a body that read `POST /api/v1/finance/assets/{id}/assess`. Nobody was
-- asked to do anything by one of those and nobody was waiting on it: it is the
-- audit log, fanned out one row per person. `0046_notifications.sql` said what
-- that costs when it created the table, and the function doing it repeated the
-- warning in its own comment.
--
-- The fan-out is now gone from the middleware. This handles what it already
-- left behind: 2,919 rows in this estate alone, all of them unread, sitting on
-- top of the list a bell in the top bar is about to show.
--
-- # Marked read, not deleted
--
-- They are a true record of what happened and cost nothing where they sit. What
-- they must not do is claim to be WAITING for somebody — "unread" on this table
-- means "still wants you", and none of these ever did. Deleting them would
-- throw away history to fix a display; marking them read says the honest thing.

UPDATE notification_recipient r
   SET read_at = now()
  FROM notification n
 WHERE n.notification_id = r.notification_id
   AND n.kind = 'activity'
   AND r.read_at IS NULL;
