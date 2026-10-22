# Words and formats

Words are part of the design: one word for one thing, everywhere. Every figure, date and state goes through the hub's own helpers (`src/lib/format.ts`, `src/lib/words.ts`), so that the same fact is written the same way on every screen.

## States: nine words, and the retail flow

| Word | Means | Tone |
| --- | --- | --- |
| Active | On: master data in use; a live promotion | `ok` |
| Inactive | Master data switched off: an article, a term, a supplier, a user | neutral |
| Cancelled | A document ended before it was done: a PO, a voucher, an order | `bad` |
| Closed | Finished and sealed: a period, a count, a return | `ok` |
| Retired | Assets only | neutral |
| Pending | An approval waiting on somebody | `warn` |
| Approved | An approval given | `ok` |
| Rejected | An approval refused | `bad` |
| Withdrawn | An approval taken back by the person who asked | neutral |

The retail flow (`toneFor`):
- **ok:** Paid, Completed, Received, Posted, Settled, Fully received, In stock.
- **warn:** Draft, Awaiting, Delayed, Partially received, Submitted, Low.
- **info**, in motion only: Issued, Shipped, Processing, In transit, Receiving.
- **bad:** Failed, Void, Out, Exception.

Rules:
- Always go through `statusWord(code)` and `statusTone(code)`. A server enum such as `PARTIALLY_RECEIVED` becomes "Partially received".
- These older names land on the nine and are never written:
  - Live → Active;
  - Non-active, Disabled, Switched off → Inactive;
  - Waiting → Pending;
  - Refused, Declined → Rejected;
  - Taken back → Withdrawn.
- Suspended and Blocked are not Inactive: for an employee they are a different fact, and only the screen knows which.
- A carton's position follows the two-blue rule: on the road is `info`; everything still in the building is not.

## Verbs

| Job | Word |
| --- | --- |
| Create a record you own | New order · New supplier · New count |
| Put a line into the record being edited | Add item · Add photo · Add another |
| Log what already happened elsewhere | Record bill · Record repair · Record inspection |
| Register a thing the business now owns | Register asset |
| Ask for approval | Request leave · Request supplies |
| Keep edits | Save · Save changes |
| Approve or refuse | Approve · Reject |
| Book to the ledger | Post to the books |
| Call off (red) | Cancel order · Close short · End now · Cancel voucher |
| Supporting | Print · Edit · Duplicate · Export CSV · Columns · Filter |

- Write the object after the verb ("New order", not "New").
- On a phone the Fab may draw the plus alone. Its spoken name is still "Add New Order".
- Never use Submit to save, OK to confirm, Create or Make to start a record, or Change to edit.

## Casing

- **Title Case** for the names of places: departments, screens and the list in a sheet's crumb (Purchase Orders, Cash & Bank, Return PO).
- **Sentence case** for everything else: buttons, tabs, column headings, labels, statuses, switches, toasts, empty states ("New order", "Delivery date", "Group by supplier", "Nothing matches your search").
- **No capitals** for emphasis. Abbreviations keep theirs (PO, SKU, BKK, HO, DC, NPWP).
- **American spelling** on screens: Color, Colors, New color. Code and token names may keep "colour".

## Formats

| Helper | Writes | Use for |
| --- | --- | --- |
| `money(minor)` | Rp 2.040.000 · −Rp 1.000 · Rp 0 | Every amount that fits |
| `moneyCompact(minor)` | Rp 102,7 M · Rp 4,0 B · Rp 250 K | A KPI figure, a chart label or a sentence where the exact one will not fit; the exact amount goes in its title. Never beside the exact one for the same total. |
| `count(n)` | 21.060 | A whole number, grouped with dots |
| `decimal(n)` | 12,5 · 0,25 | A number with a decimal comma, no trailing zero |
| `quantity(n, unit)` | 24 pcs · 1 pc · 8 items · 3 lusin | A count with its unit; the heading says Quantity |
| `signed(n)` | −16 · +200 | A difference or variance, with a true minus; its colour carries the meaning |
| `percent(n)` | 82% · 0,25% | A share, with no space before the sign |
| `day(d)` | 29 Oct 2026 | A date |
| `dayTime(d)` | 29 Oct 2026, 14:28 | A moment |
| `dateRange(a, b)` | 01–30 Sep 2026 · 28 Sep – 04 Oct 2026 | A period |
| `monthYear(d)` | Oct 2026 | A month in a tab or a column |
| `time(d)` · `clock(d)` | 14:28 · 04 Oct, 14:28 | A time of day (24-hour, colon) |
| `dayMonth(d)` | 29 Oct | Only a chart tick or a calendar cell |
| `ago(d)` | 3 days | Only an age that is the point (a delivery waiting on the bay) |
| `EMPTY` | — | Any missing value: never n/a, none, a blank, or – |

- Dates always carry their year in a list or a fact.
- Numbers keep the Indonesian grouping (dots) and decimal comma.
- Time is 24-hour with a colon.
- Do not call `toLocaleString`, `toLocaleDateString` or `Intl.NumberFormat` on a screen.

## People, places, things

- A person is their full name, capitalised: Rina Kusuma. Resolve a login with `useNameOfLogin()`.
- A store is its name (Cikupa), never initials made into a tile.
- A supplier is its legal name with its form after it: Garmen Nusantara, PT.
- A column heading is the full word: Quantity (never Qty), Delivery date, Grand total.
- Units:
  - pcs and pc;
  - Koli in outbound, where it is the owner's word;
  - a server's own unit name (lusin, kodi) as given.

## What is never written

- A subtitle that explains the page, a note under a field that restates its label, a footnote, a "how this works" box. Explanations belong in the conversation, not on the screen.
- A second copy of a fact the screen already shows.
- Who did what, outside Activity.
- Exclamation marks, emoji, "please", "successfully".
