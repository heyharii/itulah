# Static code audit (counts over frontend-hub/src, 6 Oct 2026)

Method: grep/python counts over `*.tsx`/`*.ts`. Numbers are occurrences, not screens.

## Type scale
- Owner floor is 14px (`--text-*` tokens are all ≥ 0.875rem). Raw sizes below it still exist: `text-[0.75rem]` ×7, `text-[0.8125rem]` ×15, `text-[0.6875rem]` ×4 (26 places).
  - Chat (`workplace/chat*.tsx`, `chat-message.tsx`, `markdown.tsx`, `chat-text.tsx`, `discussions.tsx`): 13 places at 13px / 12px.
  - Bottom bar labels (`components/shell/bottom-bar.tsx:246,451`): `text-[0.75rem]` — the navigation itself is 12px on a phone.
  - `top-bar.tsx:305` badge, `stock-cards.tsx:738` ring label at 11px, `finance/payment-projection.tsx` (4), `finance/shop-payment-methods.tsx` (3), `people/directory.tsx:690`.

## Words
- Status vocabulary is not one set. Occurrences as UI strings: Cancelled 39, Completed 23, Inactive 20, Retired 16, Closed 16, Done 12, Non-active 6, Archived 4, Suspended 3, Deactivated 1, Finished 1. "Non-active" (6) and "Inactive" (20) both mean the same switch state; "Cancelled" (articles) vs "Inactive" (terms) vs "Retired" for the same on/off.
- Create-verbs on buttons: `Add …` 8, `New …` 4, `Create …` 1, `Register …` 1, `Issue …` 1 (grep undercounts: many are built from `New {capitalise(…)}`).
- Quantity: 54 UI strings say "Quantity", 0 say "Qty" — consistent (keep).
- Loading copy: `"Loading…"` 21 vs ~60 different "Reading the …" phrases (≈ 90 total). Two voices.
- Empty copy: sentences vary by author (e.g. "Nothing here", "Nothing matches that search.", "No promotions.", "Nothing is owed to a supplier.", Indonesian "Tidak ada kontrak yang berakhir …").
- Titles: "Count" (operations) vs "Counts" (inventory); "Bank Account" vs "Bank Accounts"; "Satuan & Conversions" (Indonesian + English in one title); "Schedules & Rules"; Title Case on every screen name but the Executive screens use sentence case in Indonesian ("Kinerja toko" / "Kinerja Toko" both appear).
- Indonesian strings outside the intended places (BKK/BKM 7Soft forms, printed documents, letters): Executive (5 screens: stock, overview, stores, parts, people), `commercial/pricelist*.tsx`, `commercial/price-form.tsx`, `procurement/import.tsx` ("Satuan", "Mulai ulang", "Pilih atau tarik file"), `procurement/offline-suppliers.tsx`, `locations/locations.tsx`, `contracts` (e.g. "Tidak ada kontrak yang berakhir …"), several `finance-lab*`/`finance-final` files. Hub copy rule is English.

## Numbers, money, dates
- Money has FOUR compact styles: full `Rp 1.234.000` (`money()`); words `Rp 4,0 billion` / `bn` (hand-copied twice: `procurement/suppliers.tsx:942`, `procurement/purchase-orders.tsx:1776`, plus `supplier-band.tsx`); Indonesian `rb / jt / M / T` (`sales/breakdown.tsx:1191`); and per-screen formatters. Mixed Indonesian decimal comma with English words ("Rp 4,0 billion").
- Number locale: `id-ID` ×59 (41 `toLocaleString` + 18 `NumberFormat`) vs 1 `en-GB` — the numbers are consistent; the words around them are not.
- Dates: 44 files format dates themselves (`toLocaleDateString` / `Intl.DateTimeFormat`) instead of `lib/format.ts` (`day`, `dayMonth`, `moment`, `dateText`, `ago`, `clock`, `recentMoment`, `span` — eight helpers). Examples: `sales/breakdown.tsx`, `people/roster.tsx`, `people/attendance-days.tsx`, `people/phone-cards.tsx`, `me/data/format.ts`, `contracts/format.ts`, `workplace/lib.ts`, `mobile/apps.tsx`, `system/health.tsx`.

## Components
- Status drawn four ways: `<Pill>` 516 uses, `<Tag>` 128, `<Status>` (dot + word) 89, plus plain coloured text. Pill tones: neutral 65, ok 60, warn 53, info 36, bad 32, accent 16, new 3 — `info` is meant for "in motion" only; 36 uses and `accent` 16 suggest it is used for generic emphasis too.
- Button variants: primary 461, ghost 209, quiet 209, soft 73, danger 56, tint 44 (tint is new today). Sizes: default, `sm` 29, `card` 7, `icon` 1, `lg` 0 (the sign-in form uses `size="lg"` through a different path). `primary` is meant to be one per screen: 461 uses over ~300 screens.
- Radius: tokens `rounded-inner` 379, `rounded-card` 133, `rounded-full` 275, `rounded-shell` 4; raw Tailwind radii still present: `rounded-lg` 10, `rounded-md` 6, `rounded-2xl` 5.
- Hex colours inside `*.tsx` ×39 (should be tokens).
- Containers: `Sheet` imported in 173 files, `Dialog` 56, `BottomSheet` 22 — three ways to open a record/confirm.
- Phone helpers built in parallel today (to merge): `mobile/phone-cards.tsx`, `people/phone-cards.tsx`, `finance/phone-parts.tsx`, `finance/parts.tsx` (PhoneCards), `operations/card-parts.tsx`, `commercial/card-parts.tsx`.

## Record sheets — census of `<Sheet>` (parsed, not grepped)
- 269 `<Sheet>` usages in 170 files.
- Props used: `title` 248, `id` 120 (the mono id line above the title), `caption` 44, `badge` 21 (the status badge exists on 8% of sheets), `actions` 46 (header action buttons), `footer` 118 (151 sheets have no footer prop — their buttons live inside the body or the header), `tabs` 10, `subject` 26 (record activity), `className` 97 (screen-specific overrides), `width` 55.
- Width classes: default rail 216, `wide` 41, `table` 5, `workspace` 6. 13 sheets pass their own `w-[Nrem]` (campaigns, rule-form, account-links, assets, bank-transactions, bank, basket, composer, item-form, pick-items, …) — fixed to full-width on phone today in `Sheet`, but still different widths on desk.
- Header `actions` are used by 46 sheets (commercial campaigns/pricelist/vouchers, contracts hub, finance-lab*…): on a phone the owner wants these in the footer (≥44px).
- Three containers: `Sheet` (170 files), `Dialog` (56), `BottomSheet` (22).
