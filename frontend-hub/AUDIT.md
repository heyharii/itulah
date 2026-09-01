# Audit and notifications

Two halves of one question, deliberately kept apart.

| | `audit_log` | `notification` |
|---|---|---|
| Records | every write | the things worth interrupting somebody for |
| Calls anybody | never | always |
| Read from | a record's sheet, and System → Activity | the bell |

`0046_notifications.sql` already stated the rule this split protects: *a
notification for everything that merely happened trains people to dismiss all of
them.* So the log records everything and calls nobody, and notifications call
people and record little.

## What is recorded

**Writes only.** POST, PATCH, PUT, DELETE. A GET is a person looking, and this
table exists to answer "who changed this". Logging reads as well would bury
every change under a hundred glances — and it would turn an audit trail into a
record of what each colleague was curious about, which is a different thing and
not one anybody asked for.

**Refusals too.** A 403 is as much a fact as a 201, and the more interesting of
the two: "who kept trying to publish a book they may not publish" is a question
only a log that kept the refusals can answer. The Activity screen has a
**Refused** filter for exactly this.

**Never the request body.** Bodies here carry passwords, sync keys and personal
data, and an audit table is the last place any of them should be durably
written. `payload` exists for what a handler chooses to add; the middleware puts
nothing in it.

## How it is written

One middleware — `backend/src/cloud/http/audit.rs` — sitting **inside** the auth
layer, so the actor is the server's resolved `Principal` and not an `actor_id`
the request claimed.

That is a trade. A per-handler call could say "published price book v9" where
this can only say `POST /api/v1/commercial/publications/{id}/publish → 200`.
What it buys is that nothing can be forgotten: two hundred handlers each
remembering to log is two hundred chances to miss one, and the one that gets
missed is always the one somebody later needs. A handler that wants to say more
writes its own row on top; the middleware's row is the floor.

The row is written **after** the handler's transaction, on the pool rather than
in it. An audit row that vanished because the thing it recorded failed would be
the row you most wanted to keep.

## Which record a row belongs to

Derived from the path shape: the innermost identifier-looking segment, named by
the collection before it, singularised.

```
POST /api/v1/suppliers/{uuid}/activate        → supplier / {uuid}
POST /api/v1/purchase-orders/{a}/lines/{b}    → line / {b}      (the innermost)
POST /api/v1/suppliers                        → no subject      (a collection)
POST /api/v1/notifications/read-all           → no subject      (a route word)
```

Best-effort on purpose: a path that names no record leaves it empty and the row
is still a true statement about who did what. The four shapes above are pinned
by tests in `audit.rs` — a wrong guess is not cosmetic, it files one record's
history under another record's id.

## Reading it

`GET /api/v1/audit?subject_kind=&subject_id=` — one record's history, newest
first. Both parameters together or neither; naming half is a caller bug and the
server says so rather than quietly answering the global feed.

`GET /api/v1/audit?actor=&limit=` — the whole feed.

In the browser: pass `subject` to `<Sheet>` and the trail appears at its foot,
**collapsed**, fetching nothing until it is opened. That is DESIGN.md's rule
rather than a space saving — depth is shown on demand, and a record sheet is
opened constantly while its history is read rarely.

## The broadcast

Every successful action raises an `activity` notification to every active user.
That is what was asked for, and it is worth being plain about the cost: one row
per user per action in `notification_recipient`, and a queue that fills faster
than anybody clears it.

It is a **separate kind** from the two that name real work
(`purchase.price_amendment.requested`, `receipt.awaiting_identity`) precisely so
narrowing it later is a change to one string rather than an archaeology
exercise. When the noise becomes the problem it will be, the shape of the fix is
already there: keep the audit log exactly as it is, and stop raising `activity`.
