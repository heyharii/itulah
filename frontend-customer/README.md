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

Three endpoints, all GET, all added for this surface
(`backend/src/cloud/http/customer.rs`):

| Path | Answers |
| --- | --- |
| `/api/v1/customer/{id}/summary` | points earned, spend, savings, first and last purchase |
| `/api/v1/customer/{id}/transactions` | their purchases, newest first, cursor-paged |
| `/api/v1/customer/{id}/transactions/{sale_id}` | one receipt with its lines |

Everything is derived from `edge_sale` — the sales the shops reported and the
centre accepted — so a member's screen and the centre's revenue cannot
disagree. Points come from `edge_sale.points_earned`, computed by the pricing
engine at the till.

## Two things this app is not, yet

**There is no customer identity.** The member id lives in `localStorage`
(`src/lib/member.tsx`), put there by the person who typed it. It is a card
number, not a credential, and the code says so. The endpoints therefore sit
behind the ordinary node session like every other route — which is why this
app has a device sign-in that a real shopper should never have to see. Customer
sign-in (a phone number and a one-time code) is the work that replaces
`src/components/login-form.tsx`.

Until that exists, the deployed site (`frontend-customer` in `render.yaml`) is a
**preview for the people building it, not a shopper-facing product**: anyone
reaching the URL meets a device login they have no account for. Nothing leaks —
every route is behind the node session — but do not hand the address to
customers or announce it as a member app before sign-in lands.

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
