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

- **Phone**: bottom bar of three tabs, content column with room beneath it for
  the bar and the home indicator.
- **Desktop**: the same three destinations as a side rail, same content column.

One layout that fits its window, not a mobile app with a desktop variant bolted
on. The theme is the shared shadcn `base-maia` style with the neutral base
colour, the same as the other surfaces — `src/index.css` is the sibling apps'
file unchanged.

## Copy

The interface is in Indonesian. The other surfaces are in English because they
are for people who run the system; this one is for the people who shop, and
`src/components/states.tsx` turns a server refusal into a sentence a shopper
can act on rather than repeating the operator's English.
