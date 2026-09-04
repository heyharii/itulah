# Member identity — what was built, and what is left

Written 2026-09-02. The blocker this closes: until now the whole customer
domain was one nullable text column on `edge_sale` (migration 0042) plus three
read endpoints scoped by a `customer_id` **taken from the URL**. The code was
honest about it — "a member id in the path is an argument, not a credential" —
but it meant any node account could read any shopper's purchase history, and it
is why `frontend-customer` stood behind an operator login no shopper should
ever see.

## The decision, and why it is not an OTP

Three implementations were read first: `~/Documents/retail/internal/cloud/customer`
(Go), `~/Documents/retail/final-product/backend/crates/cloud-customer` (Rust),
and `~/Documents/fresh/crates/member-domain` + `points-domain`. All three prove
identity with a one-time code sent to a phone.

We do not. The question is *"does this person hold that card"*; a phone OTP
answers *"does this person control that number"*, and for this market — middle
and lower income, prepaid — those come apart. Indonesian operators recycle a
number after roughly 60–90 days of inactivity, so whoever is issued a recycled
number would inherit the previous holder's history. It is also the only option
that needs a paid provider (WhatsApp Cloud API or an SMS gateway), a per-message
cost, and a live data connection at the exact moment somebody is signing in.

**A code the cashier reads out** proves the card is in the person's hand, in the
shop, checked by an employee. No provider, no cost, works with the data off.

The one attack it has is a dishonest cashier pairing their own phone to a
customer's card. `member_pairing_code.issued_by` names whoever issued it, so
that is answerable — a phone OTP can name nobody.

## What is built

**Backend** (`backend/`)

| File | What |
| --- | --- |
| `migrations/postgres/0082_member_identity.sql` | `member`, `member_pairing_code`, `member_session` |
| `src/cloud/postgres/member.rs` | enrol, issue code, redeem code, authenticate, revoke |
| `src/cloud/http/member.rs` | the routes and the `require_member` middleware |
| `src/security.rs` | `random_digits` — uniform, rejection-sampled, leading zeros kept |
| `src/cloud/http/auth.rs` | `is_public` stands aside for `/api/v1/member/…` |
| `src/cloud/domain/auth.rs` | `/api/v1/members` is a **Cashier** act, not Supervisor |
| `src/cloud/http/mod.rs` | routes + the member middleware, layered outside `require_auth` |
| `tests/contract_types.rs` | three new types registered for `make contract` |

```
counter (operator session, Cashier)
  POST /api/v1/members                      enrol a card — idempotent on the number
  POST /api/v1/members/{id}/pairing-code    six digits, 10 minutes, one live per member

shopper (no account at all)
  POST /api/v1/member/session               card number + code → sets the cookies
  GET  /api/v1/member/me
  POST /api/v1/member/logout
  GET  /api/v1/member/summary
  GET  /api/v1/member/transactions
  GET  /api/v1/member/transactions/{sale_id}
```

**Frontend** (`frontend-contract/`, `frontend-customer/`)

- `client/member.ts` — the whole surface, both halves.
- `client/node.ts` — `Node` now takes a CSRF cookie name; the member app passes
  `MEMBER_CSRF_COOKIE`.
- `frontend-customer` — `login-form.tsx`, `member-gate.tsx`, `member-provider.tsx`
  and `lib/member.ts` are **deleted**; `components/pairing-form.tsx` replaces all
  four. Every screen reads the session instead of a string in `localStorage`.

## Invariants — do not undo these by accident

1. **`member.member_id` is the number on the card**, not a uuid.
   `edge_sale.customer_id` already holds it; re-keying detaches every existing
   sale from the member who made it. (The Rust reference mints `cust_<uuid>` —
   correct on an empty database, wrong on ours.)
2. **No foreign key from `edge_sale.customer_id`.** Sales arrive from edge nodes
   that have never seen the `member` table; a sale naming an unenrolled member
   must be accepted and attributed, not rejected.
3. **Every pairing failure answers identically** (`pairing_refused`). Unknown
   card, wrong code, expired, already used, too many guesses and blocked
   membership are one status and one sentence. All three references distinguish
   these, which turns the sign-in form into a service for discovering which
   numbers are members.
4. **Attempts are counted in the database, under `FOR UPDATE`.** The Go
   reference counted them in a process-local map (lost on restart, useless
   across replicas); the Rust port dropped attempt limiting entirely. Six digits
   with unlimited guesses is not a second factor.
5. **`member_session` is never `auth_session`.** A member session carries no
   `Role` and its cookies are named apart, so a shopper's proof of holding a
   loyalty card can never be read as an operator's authority.
6. **The `/api/v1/customer/{id}/…` routes stay operator-only.** They are the
   counter's lookup and are legitimate. What was wrong was their being the only
   way.

## What was left, and what closed it (2026-09-04)

Items 1, 2, 3 and 5 of the original list are done. What follows is what they
turned into, because two of them did not land where the brief expected.

1. **Compile and verify — done.** `cargo check` is clean and
   `backend/tests/member_identity.rs` now drives the whole flow over HTTP:
   enrol → issue → pair → read, plus the six identical refusals, the five-guess
   burn, one-device-per-code, reissue superseding, CSRF, sign-out revocation,
   and blocking a membership stopping a phone already in the pocket. It is
   driven over HTTP and not at the query layer on purpose — every promise this
   feature makes is a promise about *credentials*, and none of it is visible
   from a function signature.
2. **`make contract` — done.** The three types are generated;
   `frontend-customer` typechecks.
3. **The cashier's screen — built, but NOT in `frontend-store-new`.** The
   original plan here was wrong about which app can do it. The till addresses
   the shop's own Edge and nothing else — that is what keeps it selling when
   the line to head office is down — and the member directory is central. So
   enrolment and code issuance live in **`frontend-hub` → Members**
   (`screens/members/counter.tsx`): an "Enrol a card" action on the directory
   that carries straight on into the six digits, and an "Issue a pairing code"
   on any member's sheet, with the ten-minute expiry counting down. The rung is
   still Cashier, so the person at the counter is the person who can do it.

   Putting it on the till would mean either a second backend for that app or a
   member directory on the shop's SQLite. The second is the real answer if this
   ever needs to work offline, and it has a shape already: a **published
   snapshot**, versioned and stamped with when it was computed, carried on the
   command lane the way a price book is. Not a live predicate sent to a till.
4. **End-to-end check against a seeded database** — still worth doing by hand
   against `itulah_customer_dev` (`M-000123`, 35 sales, 6.520 points), though
   the integration test now covers the same chain on a scratch database.
5. **Three rows in `write_authority.rs` — done.** `member`,
   `member_pairing_code` and `member_session` are each declared as written by
   `src/cloud/postgres/member.rs` alone.

### Found on the way, and fixed

- **A cashier could write and retire saved segments.** `required_role` matched
  the whole `/api/v1/members` prefix, and segments were added under it later
  (0093). Writing a marketing segment is not an act at a counter — it decides
  who the company talks to, and retiring one changes what an already-sent
  campaign was sent against. `/api/v1/members/segments` is now excluded from
  the Cashier arm and falls through to Supervisor. Reads are unchanged.
- **A pairing code could be read out under the wrong name.** Found by driving
  the screen rather than by reading it: the member sheet stays mounted when an
  operator clicks the next row, so asking for a code and moving on before the
  reply landed put those six digits into a sheet showing somebody else's card.
  A cashier reading from that screen reads out the wrong card's code. Resetting
  in an effect does not fix it — the effect runs when the row changes and the
  response arrives after that — so `<IssueCode>` is keyed on the member id and
  unmounts instead. Same reason `segment-form.tsx` is keyed.
- **The unenrolled were a number and nothing else.** The segment book has long
  counted the customer numbers a till wrote onto sales with no card behind them
  — and said they were "the only group on this screen with an obvious next
  action" while offering none. `GET /api/v1/members/unenrolled` now names them,
  and Members → Segments → *See who they are* enrols one in a click. Enrolling
  is not a repair: the directory joins a member to their sales on the card
  number, so the history is attached the moment the card exists.

## Still open, and needing a decision rather than an implementation

- **Any non-empty `customer_id` satisfies a members-only promotion.** The
  engine's gate is `context.customer_id.is_none()`
  (`crates/pricing-engine/src/engine.rs`), so a cashier typing anything at all
  into the Member field unlocks every members-only offer. Closing it properly
  needs the till to know whether a number is a real card, which needs the
  published roster described in item 3 — including a decision about shipping a
  member list to every shop. Until then the till's field says plainly that it
  cannot check the number and that a wrong one credits nobody.
- **Points still only ever increase.** See below.

## Deliberately not built

- **Phone numbers.** Not a credential here. When they arrive they are contact
  detail behind consent, and they can be added as a second path without
  touching the identity model.
- **A PIN.** The Go reference has phone+PIN as a second, weaker credential
  beside its OTP. One way in.
- **A points balance.** `points_earned_total` is a lifetime total and the UI
  says "Poin terkumpul" for that reason. `~/Documents/fresh/crates/points-domain`
  is the design to lift when a redemption ledger is built — FIFO expiry lots,
  versioned valuation, idempotent reversal, no overdraft.
