# FormSection

A form section groups a form's questions under one 15px title with no glyph and no rule: 24px from the next section, its fields two across on a rail sheet and four across on a wide one.

## When to use it

| The job | Use |
| --- | --- |
| A form's questions, grouped (Company, Payment, Order details) | `Section` from `form.tsx` |
| A record's parts in a sheet (Order items, Notes) | `SheetSection`, or a `SubHead` over its content: the same title with a count |
| One question, or a form of a few that all belong together | A `Field`, with no section |
| Reading the same facts | `Facts`. Edit swaps the form in, with the same sections in the same order |

## Anatomy

- **Title**: 15px on 20px at 600 in `ink`, sentence case, a few words: "Company", "Order details". It is the `section` style. `form.tsx` writes it at 16px and white.css brings it to 15px.
- **Aside**: a count or a total at the right end of the title line, 15px in `mute`, tabular ("1", "of Rp 8.400.000"). Never a sentence.
- **No glyph, no rule**: the 20px icon the code can draw before the title is hidden by white.css (`.form-section-head > svg`), and the hairline under the head is transparent. Draw neither.
- **Title to fields**: 12px, the `SheetSection` rhythm.
- **Section to section**: 24px (`section-gap`). The sheet's body does it (`stack`); nobody sets a margin.
- **Fields**: a grid with 24px between its columns and its rows (`section-gap`, as the Field card draws a form). On a `rail` sheet two across, about 200px each. On a `wide`, `table` or `workspace` sheet four across, about 228px each on a 1040px sheet (owner, 14 Oct 2026: the form's fields stand where a page's figures do). A textarea or a list takes two columns or the row. On a phone, one across.
- **Required** is the field's asterisk. A section never says so.

## Sizes

| Part | Size |
| --- | --- |
| Title | 15px on 20px, 600 |
| Title to fields | 12px |
| Section to section | 24px |
| Field to field | 24px |
| Rail sheet | 480px, two across |
| Wide sheet | 1040px at 1440, four across |

## Rules

- A section is a word. No glyph, no rule, no phrase of explanation.
- Group by what the person decides (Company, Payment), not by table. A section of one field is just a field.
- Sections stand in the sheet's body, with no `Card` between the sheet and them.
- Labels are sentence case ("Delivery date", "Payment terms"), and the section's title follows the sheet's own words.
- Fields sit in the kit's grid for the sheet's size. Do not write `grid gap-3` by hand.

## Retired

- **The `icon` prop.** 13 of the 42 sections in the 9 forms that use `Section` pass one (`commercial/rule-form.tsx`, `vouchers.tsx`, `campaigns.tsx`). White.css hides it, and with one the head sits 24px over its fields where without one it sits 14px (`mb-6` against `mb-3.5`). Leave it out.
- **`aside` as a phrase.** 11 of the 42 sections write one that explains: "determines the fields below" (`assets/register.tsx`), "same door as the register", "the card carries its proposed accounts" (`contracts/composer.tsx`). That is a helper sentence. A count or a total only.
- **Four ways to title a section.** `Section` in `form.tsx` (9 files), `Section` in `rows.tsx` (8 files; it draws a hairline over every section and 20px of air, `rule` on by default), `SubHead` (43) with `SheetSection` (2), and an `h4` written by hand (the PO composer's "Order details", `composer.tsx:2281`). There is one.
- **Field grids by hand.** 116 grids in 69 files open on a `Field`, with gaps of 12px (59 of them), 16px (37) and 20px (13). `form.tsx`'s own section lays fields in one column 20px apart (`gap-5`), so every caller nests a grid.
- **Two across on a wide sheet.** The PO composer's four order questions sit two by two (`composer.tsx:2284`) with a rule under them (`border-b pb-6`); nothing draws four across yet.
- **Title Case labels.** "Delivery Date", "Payment Terms", "Payment Method" in the same form.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `Section` (`form.tsx`) | `title`, `aside`, `className`, `children` | `icon` is retired. |
| `Section` (`rows.tsx`) | `title`, `actions`, `rule`, `flush`, `quiet`, `tight`, `children` | `actions` stand at the title's right; `rule={false}` drops the hairline above. |
| `SheetSection` | `title`, `aside`, `className`, `children` | A `SubHead` over its content, 12px apart, no margin of its own. |
| `SubHead` | `children`, `aside`, `className` | The title line alone. |

Source: `frontend-hub/src/components/ui/form.tsx` (`Section`), `rows.tsx` (`Section`, `SubHead`, `SheetSection`); look in `styles/white.css` (`.form-section-head`, `.section-title`, Forms).
