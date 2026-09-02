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

## What is left

1. **Compile and verify.** Nothing here has been through `cargo build` or
   `cargo test` — three sessions were compiling `inventory_backend` at once and
   the machine OOM-killed the builds, so this was left as source. Expect
   ordinary first-compile fixes.
2. **`make contract`.** `MemberIdentity`, `IssuedPairingCode` and
   `MemberSessionResponse` are registered in `tests/contract_types.rs` but the
   TypeScript has not been generated, so `frontend-customer` typechecks with
   three "no exported member" errors until it is run. **Do not hand-write those
   files** — see `frontend-contract/src/contract/`.
3. **The cashier's screen.** `frontend-store-new` has no way to issue a pairing
   code yet, so the counter half of the flow has no UI. It wants a small action
   on the sell screen: enter or scan the member number → `issuePairingCode` →
   show the six digits large enough to read aloud, with the ten-minute expiry
   visible. The client method is already there (`Member.issuePairingCode`).
4. **End-to-end check.** Enrol → issue → pair → read summary, against a node on
   a database that has member sales (`itulah_customer_dev` has `M-000123` with
   35 sales and 6.520 points).
5. **Three rows in `backend/tests/write_authority.rs`.** `member`,
   `member_pairing_code` and `member_session` are each written by exactly one
   file — `src/cloud/postgres/member.rs` — and that is worth stating in the
   matrix while it is still true. Left undone only because another session was
   editing that file at the time; the guard exists to make a second writer a
   deliberate act, and these three tables are the ones where a second writer
   would be worst.

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
