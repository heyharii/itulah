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

Three endpoints, all GET, all scoped by the member session rather than by
anything in the URL (`backend/src/cloud/http/member.rs`):

| Path | Answers |
| --- | --- |
| `/api/v1/member/summary` | points earned, spend, savings, first and last purchase |
| `/api/v1/member/transactions` | their purchases, newest first, cursor-paged |
| `/api/v1/member/transactions/{sale_id}` | one receipt with its lines |

Everything is derived from `edge_sale` — the sales the shops reported and the
centre accepted — so a member's screen and the centre's revenue cannot
disagree. Points come from `edge_sale.points_earned`, computed by the pricing
engine at the till.

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

## What this app is not, yet

**Points are earned, never spent.** `points_earned_total` is a lifetime total,
not a balance: nothing in this system records a redemption yet. The wording on
screen is deliberate — "Poin terkumpul", not "Saldo poin" — and should stay
that way until a redemption ledger exists to subtract from it.

## Shape

- **Phone**: full-bleed. A borderless 3-zone app-bar on top (chip · centred
  title · chip), and a floating row of three squircles at the bottom with no
  containing bar — the active one solid indigo. A pushed receipt hides the
  tabs and turns the left chip into a back arrow.
- **Desktop** (`md` and up): the floating app-card on the neutral backdrop,
  with the same three destinations as a sidebar down its left.

One layout that fits its window, not a mobile app with a desktop variant
bolted on.

## Design

The **Cloud Hub / ollama** language, authored rather than remapped:
`src/styles/index.css` holds the tokens and Tailwind's utilities are generated
from them, so `bg-soft` and `text-ink` are the only spellings that exist.
Source of truth is `~/Documents/retail/cloud-app/ollama/DESIGN.md` (v0.5), and
`frontend-hub` is the sibling implementation to stay in step with. This app
used to speak shadcn's slots (`--primary`, `--muted`, a `.dark` block); that is
the two-vocabulary problem `CLOUDHUB-BRIEF.md` catalogues, and it is gone
rather than mapped.

Two deliberate departures from `frontend-hub`, both because the reader here is
a shopper holding a phone rather than an operator at a desk:

- **Root stays 16px.** The workbench bakes the prototypes' `zoom:0.9` into
  14.4px; DESIGN.md scopes that 0.9 to the *shell*, and applying it here would
  set body copy at 12.6px on a 375px screen. Sizes are DESIGN.md's declared
  values, unscaled.
- **Buttons are 44px, not 32px.** DESIGN.md's phone rule is "touch targets
  ≥ 44px"; the console's pill is a mouse target.

**There is no dark mode, and the theme toggle that used to sit in Profil is
gone.** "Always light. Nothing ever darkens" — every veil in this system is
white. `npm run design-lint` fails on a `dark:` variant, a raw px type size, a
hex colour, a fourth font weight, or a dark overlay, because prose in a
markdown file is not a gate.

### Motion

`motion` is a dependency here and deliberately is not one in `frontend-hub` —
for the reason the hub's own note gives. The two cases it names as genuinely
needing JS are both on this surface: a shared-layout indicator travelling
between elements (the indigo tab squircle) and a drag gesture
(pull-to-refresh). Everything else is CSS, on the `--ease-*` and `--t-*` tokens
the two apps share.

The curves, springs and the components adapted from them are
[beUI](https://beui.dev)'s, credited in each file:

| Where | What | Why here |
| --- | --- | --- |
| `motion/number-ticker.tsx` | slot-machine digits | the points total — the one number the app exists to show |
| `motion/animated-number.tsx` | spring count-up | the KPI tiles, so a refetch shows the difference |
| `motion/pressable.tsx` | press spring + ripple from the touch point | DESIGN.md's one piece of motion guidance |
| `motion/pull-to-refresh.tsx` | resistance, threshold, settle | a member picks the phone back up wanting one number |
| `app-shell.tsx` | `layoutId` glide on the tab squircle | one tile moving says the selection moved |

Both number components take their value whole when `document.hidden` — a
`requestAnimationFrame` animation frozen by a background tab leaves a *wrong*
points total on screen looking like a fact.

## Copy

The interface is in Indonesian. The other surfaces are in English because they
are for people who run the system; this one is for the people who shop, and
`src/components/states.tsx` turns a server refusal into a sentence a shopper
can act on rather than repeating the operator's English.
