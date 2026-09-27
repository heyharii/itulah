# frontend-customer — the member's surface

What a shopper sees of their own custom: points earned, purchases, one receipt.
Read-only. There is no write path in this app and adding one would need an
answer to "should a phone be able to change a shop's takings".

It talks to the **Cloud** node, because a member's points are not a property of
one shop — they buy in Bekasi and in Depok, and only the centre holds both.

## Running it

```bash
npm install
VITE_API_TARGET=http://localhost:8080 npm run dev
```

`npm run build` is `tsc -b && vite build`, and the typecheck is the real gate.

## What it reads

All scoped by the member session rather than by anything in the URL
(`backend/src/cloud/http/member.rs`):

| Path | Answers |
| --- | --- |
| `GET /api/v1/member/summary` | spend, savings, first and last purchase, lifetime points — voided sales excluded |
| `GET /api/v1/member/points` | the spendable balance and the ledger behind it |
| `GET /api/v1/member/transactions` | their purchases, newest first, cursor-paged; a voided one is listed as `VOIDED` |
| `GET /api/v1/member/transactions/{sale_id}` | one receipt with its lines |
| `GET/POST /api/v1/member/points/redeem-requests` | ask to turn points into a voucher, and what became of each ask |

Purchases come from `edge_sale` — the sales the shops reported and the centre
accepted — so a member's screen and the centre's revenue cannot disagree.
Points are earned into `points_ledger` when the centre accepts a sale (not at
the till), debited when a cashier confirms a redemption, and taken back when a
sale is voided.

## How a phone becomes paired

The shopper types **their member number and six digits the cashier reads out**.
That is the whole sign-in.

It is deliberately **not** a one-time code sent to a phone number, which is what
all three reference implementations do (`retail/internal/cloud/customer` in Go,
`final-product/.../cloud-customer` in Rust, and the old `customer-pwa`). The
question this has to answer is "does this person hold that card", and a phone
OTP answers a different one — "does this person control that number". In this
market those come apart: prepaid numbers are changed often and Indonesian
operators recycle them after roughly 60–90 days of inactivity, so whoever is
issued a recycled number would inherit the previous holder's purchase history.
A code read out at the counter proves the card is in the person's hand, in the
shop, checked by an employee — and it needs no WhatsApp or SMS provider, no
per-message cost, and no data connection at the moment somebody signs in.

The one attack it has is a dishonest cashier pairing their own phone to a
customer's card. Every issuance carries the name of the cashier who made it, so
that is answerable; a phone OTP can name nobody.

    counter   POST /api/v1/members                       enrol the card
              POST /api/v1/members/{id}/pairing-code     six digits, 10 minutes
    shopper   POST /api/v1/member/session                card number + code
              → sets `member_session` (HttpOnly) + `member_csrf`

Then every read is scoped by that session: `/api/v1/member/summary`,
`/transactions`, `/transactions/{sale_id}`. Nothing in this app stores a member
id, because there is nothing to store — the cookie is `HttpOnly` and no script
here or anywhere else can read the thing that authorises a request.

The `/api/v1/customer/{id}/…` routes still exist and still take an operator
session. They are the counter's lookup, for somebody phoning up about a
receipt, and that is a legitimate thing for a shop to do. What was wrong was
their being the **only** way, so that a shopper's own app had to borrow an
operator's password — and so that anyone holding one could read anybody's
history.

## Redeeming points

The shopper asks for a number of points on **Tukar Poin** and is shown a
six-digit code for ten minutes. The cashier types the member number and that
code into the till's *Tukar poin* screen (`pos-desktop/ui/src/screens/redeem.tsx`),
which the shop node relays to the centre; confirming debits the ledger and
issues a voucher the till then takes as a *Voucher* tender. While a code is on
screen this app polls, so the phone turns to "Berhasil ditukar" the moment the
cashier confirms.

The rate is decided at the centre, in one place
(`backend/src/cloud/postgres/loyalty.rs::confirm_redeem_request`).

The balance may go below nought: points already turned into a voucher are not
clawed back when the sale that earned them is voided. Home says so in words.

## Shape

One phone-width column (max 30rem) on a pale grey page, at every window size,
with a floating frosted tab bar — Beranda, Riwayat, Tukar, Profil. A receipt is
pushed on top of history; the card (`/kartu`) is its own screen. Neither shows
the tab bar.

## Design

A consumer-fintech register (the brief was Plasma One, screenshots in
`~/Downloads/customer-app/`), not the operator console's:

- **Always light.** No dark mode and no dark screen; the member card is the
  only dark object and it sits on a white page. `design-lint` refuses `dark:`.
- Borderless white cards with 24px radii on a `#f1f1f3` page; a near-black
  pill (`.cta-fill`) for the one action a screen holds; white pills for the
  rest.
- The number the app exists for (the points balance) is set at 56px with
  negative tracking; screen titles are iOS-style large titles.
- **The member card** (`components/member-card.tsx`), branded **Central**: a
  graphite anodised face with brushed grain and a sheen that follows the tilt.
  Central's red (`--brand-red`) is an accent, never the whole card — a
  lacquered sash across the top-right corner, an ember glow in the opposite
  corner, the dot in the mark, and a hairline under the magnetic stripe on the
  back. The chrome stays ink and white, so red on screen always means either
  "the brand" or "a notification badge", never a button.
- The card tilts toward the finger, the pointer, or the phone itself
  (`deviceorientation`; iOS asks permission on the first press of the card), a
  band of light crosses it on arrival and again whenever points land, and on
  `/kartu` it can be dragged or flicked over to its back. The barcode says
  `M1:<card number>` (`lib/member-card.ts`, encoder in `lib/code128.ts`,
  checked bit-for-bit against JsBarcode); the till's scan field reads that
  prefix and fills the member number (`pos-desktop/ui/src/till.tsx`).
- SF Pro first (the platform face on an iPhone), Inter everywhere else; three
  weights only.

Tokens live in `src/styles/index.css` and Tailwind's utilities are generated
from them. `npm run design-lint` fails on a `dark:` variant, a raw px type
size, a hex colour outside the token file, or a fourth font weight.

### Motion

Emil Kowalski's rules (`~/.claude/skills/emil-design-eng`, `animate`) and
Apple's fluid-interface ones (`apple-design`), named once in `lib/motion.ts`
and the `--ease-*` / `--t-*` tokens:

| Where | What | Why |
| --- | --- | --- |
| every button, chip, preset | `scale(0.97)` on `:active`, 160ms, `cubic-bezier(0.23,1,0.32,1)` | feedback on pointer-down |
| rows | tint on `:active`, no shrink | a row is part of a surface |
| tabs | page fades 160ms; the white capsule glides (`layoutId`, critically damped spring) | tabs change often — no travel |
| pushed screens | 220ms slide-in from 6% | where it came from |
| first paint | 50ms stagger, 8px rise | once per screen, never blocks a tap |
| member card | springs toward the pointer/finger; drag turns it 1:1, release projects momentum (Apple's projection) and hands the finger's velocity to the flip spring | a physical object |
| balance | digit reel (`number-ticker.tsx`); KPIs count up | the one number people check |
| redeem code | digits arrive 40ms apart out of a 6px blur; countdown drains linearly via `scaleX` | a freshly minted code; a clock does not ease |
| success | disc springs in with bounce 0.3, tick draws after | rare — the delight budget lives here |

Only `transform`, `opacity` and (for the code) `filter` move. Reduced motion
keeps the fades and drops every travel, tilt and flip; hidden tabs take numbers
whole instead of freezing a reel mid-roll.

## Copy

The interface is in Indonesian. The other surfaces are in English because they
are for people who run the system; this one is for the people who shop, and
`src/components/states.tsx` turns a server refusal into a sentence a shopper
can act on rather than repeating the operator's English.
