# UX consistency audit — Sales, Members, Stores, Executive, Home/Apps, System, Me, GA and small modules

Auditor: read-only. Phone 414x896 and desk 1440x900 on http://localhost:5360 (rig backend, signed in as Rina).
Method: live DOM reads and computed styles (text, sizes, geometry) plus reading `frontend-hub/src` for the same concepts. "Seen on screen" = DOM text or computed style read in the browser. "From code" = read in source only.

## Limits — read this first

- **The Browser pane was hidden for the whole run, so no screenshots were possible.** Everything "seen" is DOM text and computed style/geometry, not pixels. Colour, alignment and overlap findings are inferred from styles and code.
- **The working tree changed while I audited.** `git status` shows ~296 uncommitted files, and the file times show `screens/executive/*`, `components/shell/push-control.tsx` and `lib/format.ts` were rewritten at 13:53–14:07. Early in the run the Executive screens and the iOS push-install note read in Indonesian; by 14:07 the Executive screens read in English. Wherever an Indonesian string is cited below it is labelled "as of HEAD / earlier in run". An in-flight `lib/format.ts` bug (`maximumFractionDigits is not defined`) also stopped the app from mounting for several minutes, and the rig session expired for ~15 minutes (not caused by me; I did not sign in or out).
- The service worker (`dev-sw.js`, workbox precache on :5360) can serve older module versions, so some early reads may be a mix of old and new code. Code citations below are against the current working tree.
- The rig is empty or near-empty for Sales (all zero), Assets, Contracts, GA overview, Letters, Repairs, Supplies, Suppliers (GA), Files, Discussions, Reports, Points and Devices. Those were judged from code (card specs, empty states, buttons).
- Not opened: phone sign-in (desk sign-in was visible), the Ask panel, the command palette, any Sales sheet (no sales on the rig), Chat conversation view.

---

## A. Same concept, different words or formats

### [H] Two bottom-bar tabs are both called "Home", and "Home" is not Home
**Where:** phone bottom bar on /home, /apps and every non-department route (`components/shell/bottom-bar.tsx`: `TABS[0]` and `HomeButton`); /home, /apps.
**Evidence:** seen on screen: the bar text is "Home · Chat · Activity · Home". Tab 1 is a grid icon labelled "Home" (links to /apps); tab 4 is a house icon labelled "Home" (also navigates to /apps; disabled only on /apps itself, not on /home). /home's top bar says "Brief", the page heading is "Afternoon, Rina Kusuma" (28px), while /apps says "Good afternoon, Rina" (28px, first name only). Inside a department the first tab is the house "Home" and goes to the launcher.
**Inconsistent with:** the launcher tile list ("Apps" H2) and the screen title "Brief"; two greetings for two "home" screens.
**Suggested standard:** one home per device. The grid tab should be "Apps" (it is a launcher), the house should not exist on the launcher routes; /home keeps one name ("Brief" or "Home"), one greeting ("Good afternoon, Rina").

### [H] "Activity" means two different screens; the bell is "Notifications" on desk
**Where:** phone bottom bar tab 3; desk rail; System nav (`screens/system/nav.ts`); /system/notifications, /system/activity.
**Evidence:** seen on screen: phone tab "Activity" (bell icon) opens /system/notifications whose heading is "Notifications"; System › "Activity" (scroll icon) is the audit log (375 actions, rows like "Rina Kusuma · Created · POST /api/v1/auth/edge-sso-ticket · 200"). System sidebar: "Notifications" carries the Activity (pulse) icon, "Activity" carries the scroll icon. Desk rail button: "Notifications, 68 unread".
**Inconsistent with:** itself — tab label ≠ screen title ≠ icon.
**Suggested standard:** the bell/tab, the popover and the screen are all "Notifications"; the log is "Audit log" (or "Activity log"). The pulse icon goes with neither.

### [H] Ten different verbs for "make a new thing" on the same dock button
**Where:** the Fab/dock action and desk header primary buttons in every list module (from code).
**Evidence:** Fab labels: "New segment", "Open a new store", "Open store" (Sites), "Install server", "Invite people", "Register reader", "Register asset", "Add task", "Record inspection", "Add contract", "New letter", "Record repair", "Add supplier", "Request supplies", "Open a thread", "Add a file", "New word", "Compose one", "New conversation". Empty-state buttons: "Register the first one" (Assets), "Record the first one" (Contracts, Repairs), "New letter", "Add the first task", "Request the first one". Same act, two names: Stores says "Open a new store", Sites says "Open store". The Fab speaks "Add New contract" / "Add New letter" (regex in `fab.tsx`) for any label starting New/Add.
**Inconsistent with:** each other; owner's own note in `fab.tsx` ("Add" and "Add New" both looked worse than the plus).
**Suggested standard:** "New <noun>" for anything that creates a record ("New contract", "New repair", "New asset", "New store"); a verb only when the act is not creation ("Invite people", "Install server"). The empty-state CTA repeats the same label as the dock button.

### [H] Save verb and its pending word differ by screen (and Cancel is two different buttons)
**Where:** every sheet footer: `system/users.tsx`, `members/segment-form.tsx`, `assets/register.tsx`, `contracts/composer.tsx`, `supplies/composer.tsx`, `maintenance/repairs.tsx`, `maintenance/schedule.tsx`, `letters/letters.tsx`, `vendors/vendors.tsx` (from code); user sheet on desk (seen on screen).
**Evidence:** "Submit" 31x / "Submitting…" 29x is the norm; exceptions are "Register" + "Saving…" (Assets), "Keep it" + "Keeping…" (Letters), "Save" (1), "Send"/"Sending…" (5), "Confirm", "Done" (6), "Set password" (Users, in the same sheet as a bare "Submit"). Cancel is `variant="ghost"` in Assets/Contracts/Supplies/Repairs/Segments but `variant="quiet"` in Users. `members/segment-form.tsx` even has `editing ? "Submit" : "Submit"`. Seen on screen: the user sheet has "Submit" (72x36), "Block sign-in" (112x36), "Set password" (119x36) as three separate section buttons.
**Inconsistent with:** the 31 Submit sheets; the owner's "Save/Submit/Confirm" single standard.
**Suggested standard:** primary "Submit" / "Submitting…" everywhere a sheet creates or edits; secondary "Cancel" (ghost). Section-level buttons in a sheet say what they do on a record ("Set password") only if every sheet does so.

### [H] Dates are drawn at least six ways across this group
**Where:** Sales, Stores, Users, Notifications, Me, Executive, Contracts, Chat/Discussions.
**Evidence:** seen on screen — `lib/format.ts day()`: "02 Oct 2026" (Stores "open since", Users "Signed in 02 Oct 2026", Exceptions, GA "06 Oct 2026"); timestamps "06 Oct 2026, 07:01" (Notifications); Sales root: "7 Sept 2026 — 6 Oct 2026", day rows "30 Sept 2026", "Compare 8 Aug – 6 Sept 2026" (no zero pad, "Sept" with four letters); Sales by Store date inputs "01 Jan 2026" to "06 Oct 2026" (padded) on the same department; Sales Analytics: "2026-09-07 — 2026-10-06" and "30 days to 2026-10-06" (ISO); Me: "Tue, 6 Oct 2026", "25 Dec · in 80 days", "17 Aug"; Executive: "1–6 October 2026 · vs 1–6 September 2026", "Balance as of 6 Oct 2026", chart ticks "1 Oct". From code: `contracts/format.ts monthLabel` and `workplace/lib.ts dayOf` use `id-ID` (Indonesian month names such as "Okt") — Contracts usage month and Chat/Discussions day dividers. `lib/format.ts dateText` states the hub standard (English, zero-padded, "Sept" trimmed to "Sep"), but `screens/me/data/format.ts`, `executive/scope.ts`, `components/ui/day.tsx`, `day-range.tsx`, `day-range-sheet.tsx` and `sales/breakdown.tsx` call `toLocaleDateString("en-GB")` directly, which yields "Sept".
**Inconsistent with:** the hub's own `dateText`/`day()`.
**Suggested standard:** one formatter. Full date "06 Oct 2026" (padded), no weekday unless the screen is a calendar; range "07 Sep – 06 Oct 2026"; timestamp "06 Oct 2026, 07:01"; never ISO or Indonesian month names; "Sep" not "Sept".

### [H] Money is drawn four ways, and GA lists use the Executive board format
**Where:** everywhere money appears.
**Evidence:** seen on screen: full "Rp 0" / "Rp 4.200.000" (hub `money()`); Executive compact "Rp0", "Rp320 rb", "Rp6,7 jt", "Rp4 miliar" (no space; Indonesian words); Sales chart ticks `compactMoney` "Rp 4,2 jt", "Rp 1 M", "Rp 1 T" (space; "M" for billion); chart axes use `Intl compact id-ID` ("4 jt"). From code: `locations/locations.tsx`, `contracts/contracts.tsx`, `maintenance/repairs.tsx` import `rupiah` from `executive/format` — so "Billed this month Rp0" on Sites and repair costs read as board figures ("Rp0", compact when large) beside "Rp 0" on Contracts' KPI strip. Billion is "miliar" on the Executive board and "M" on Sales charts.
**Inconsistent with:** `lib/format.ts money()`.
**Suggested standard:** full rupiah "Rp 1.234.000" in lists, cards and sheets; one shared compact helper only for chart axes ("1,2 jt"), with a space after "Rp" everywhere. GA screens should call `money()`.

### [M] Casing: nav is Title Case, page titles and labels are a mix
**Where:** Sales, System, Members, Executive, Me.
**Evidence:** seen on screen: nav item "Sales by Store" but desk H1 "Sales by store" (`breakdown.tsx` titles "Sales by tag/division/store/…/cashier session"); phone top bar "Store Analytics" and H1 "Sales Analytics"; desk Sales granularity "day / week / month" (lowercase) vs Analytics "Day / Week / Month"; table heads "Avg transaction" (Sales day table) vs "Avg Transaction", "Vs Before" (Analytics, Members); user table "Job Role · State · Last Sign-in" vs filter chip "Job role" vs sheet field "Job Role"; search labels "Search Stores / Members / Returns / Exceptions" (Title) vs "Search stores / devices / accounts / sites / assets" (lower).
**Suggested standard:** the owner's sweep says Title Case for screen names and buttons: keep nav = page title (derive the H1 from the nav label), keep table headers and field labels in one case (Title Case if the sweep is Title Case), and make search labels "Search <plural lowercase>" everywhere.

### [M] Status words for the same states differ per screen
**Where:** Users, Devices, Suppliers, Contracts, Members, Stores, Me, Maintenance.
**Evidence:** from code and seen on screen: Users "Active / Blocked / Left, still open"; Devices "Active / Suspended / Off"; Suppliers "Active / Inactive"; Contract templates "Active / Inactive"; Contracts "Active / Archived"; Members segment BLOCKED shown as "Stopped" (chip "Stopped" on desk Members); Stores "Open / Closed / getting ready"; Me contract "In force / Ended", employee "Active"; Maintenance "Open / Done / Closed / Cancelled / Scrapped / Lost"; assets "Needs details". Approval states: Me kit says "Waiting / Refused / Taken back / Needs your reply", HR (`lib/queries/hr-employees.ts`) says "Waiting / Rejected / Withdrawn", people invitations say "Pending". Filter label for the same field is "State" (Users) vs "Status" elsewhere.
**Suggested standard:** one vocabulary — Active / Inactive; Open / Closed; Pending / Approved / Rejected / Withdrawn; "Blocked" only for sign-in. Label the field "Status".

### [M] The same measure has several names (and jargon abbreviations)
**Where:** Home, Sales, Members, Executive, Stores.
**Evidence:** seen on screen: the day's money is "Takings" (Sales KPI, Shop Floor), "Sales" (Sales by Store column, Segments "Sales 0"), "Net sales" (Executive), "taken Rp 0" (Home). The count of sales is "Transactions" (Members table, KPI), "Sales" (Segments, filter unit "sales"), "0 transactions" (phone Members card). Quantity is "Units" (KPI), "Pieces sold" (KPI caption on desk), "pcs" (filter unit), "pieces" (Home "0 pieces on hand"), "Qty" (Sales by Store sub-heads, `breakdown.tsx:1496`) next to "Quantity sold" (the same screen's other mode, `:1302`) and "Quantity" (sale sheet). Averages: "AVG TRANSACTION", "ATV", "Avg Rp 0", "Average each", "Average sale". Basket size: "UNITS PER SALE", "UPT" (also as the sentence "0 units · UPT 0,0").
**Inconsistent with:** the owner's "Quantity not Qty" rule and the plain-label rule.
**Suggested standard:** pick one: "Sales" (money), "Transactions" (count), "Quantity" (pieces), "Average transaction", "Units per transaction"; drop ATV/UPT as visible captions.

### [M] Empty, filtered-empty and first-use sentences have no shared grammar
**Where:** every list (from code unless noted).
**Evidence:** filtered-empty: "No match." (Sales breakdown), "No store matches that search.", "No exception matches that search.", "Nothing matches this filter.", "Nobody matches what you asked for." (Users), "No reader matches what you asked for.", "No return matches this search and the filters in force."; the kit's `NoMatch` component (with a held count) is used by only 1 screen in this group (Members). First-use: "No assets in this reading yet." / "No contracts in this reading yet." (seen on screen) vs "No letters yet." vs "No repairs recorded yet." vs "No store has been opened yet. "Open a new store" makes its unit, its shop site and its stock pools together." Several empty states are paragraphs of explanation (Points: "…which is not the same as loyalty being switched off", Segments blurbs: "Honestly described as former customers"), against the owner's no-filler rule.
**Suggested standard:** filtered → `NoMatch` ("No <plural> match."); first-use → one short sentence + the same CTA label as the dock button; no explanations.

### [M] Loading wording varies, and loading screens show real-looking zeros
**Where:** all lists (seen on screen and from code).
**Evidence:** "Reading the stores…", "Loading the returns…", "Adding up the tills…", "Opening the drawer…", "Opening supply requests…", "Looking for records…" (verbs: Reading / Loading / Opening / Adding up / Looking for). Skeletons only for Ops/Procurement/Master/Merchandise (by design in `states.tsx`). While loading, Members shows "0 found, 0 enrolled." above "Reading the directory…", Discussions shows "0 threads" above "Loading the discussions…", and /sales shows "Rp 0" KPIs later when nothing was sold — a zero reads as an answer.
**Suggested standard:** one verb ("Loading …") and no figures until the data exists.

### [M] Filter, sort, export, search labels
**Where:** dock, desk toolbars, sheets.
**Evidence:** count in group: "Filters" 9, "Filter" 4, "Filter and sort" 3 (dock gear aria), "Sort by" 4, "Sort" 1; Export: "Export" 2, "Download" 2, "Export CSV" 1. Phone filter sheet is titled "Filters", the dock gear is "Filter and sort", desk button "Filter" (76x32).
**Suggested standard:** "Filter" on desk; "Filter and sort" for the combined dock sheet; one export label ("Export").

### [M] Empty-value placeholders: seven different forms
**Evidence:** "—" (store city, KPI deltas), "Never" and "never" (Members "Last purchase never" / "Last purchase —" in Segments), "Nothing recorded" (Me attendance), "Not entered yet" / "Not appointed yet" (Store facts), "Not installed" (server), "Account not set" in italics (Suppliers card), "no number yet" lowercase (Letters card), "Not assessed" in amber. The phone Members card says both "Last purchase never" and "Never bought".
**Suggested standard:** "—" for an absent value; one sentence-case phrase when the absence is the news ("Never bought").

### [M] Numbers: percent, decimal separator and duration shapes
**Evidence:** seen on screen: "69,04 %" (System servers, space before %), "0%" and "100%" (Segments), "0.0% of the estate" (Sales Analytics, dot decimal) beside "UPT 0,0" (comma) in the same row; Executive shares "12,3%" (no space). Durations: "Up · 19 h 55 m" (button text) vs "19 h 55 min" (inline), "Recovered after 2 h 32 min", "No backup in 1 day 2 h", "3d" / "23h" (chips), "28 h past its deadline" next to a "1d" chip on the same Exceptions card, "heard 36s ago".
**Suggested standard:** `id-ID` decimals with a comma everywhere and "12,3%" (no space); durations "2 h 32 min" in sentences and "3d/23h" only in chips, never both in one card.

### [M] Hub copy is not uniformly English
**Evidence:** seen on screen early in the run (as of HEAD): all six Executive screens in Indonesian ("Ringkasan", "Kinerja Toko", "Penjualan bersih", "Buka procurement", "Saldo per 6 Okt 2026", mixed with English "Gross operating profit", "This month"); iOS install note on Notifications ("Di iPhone dan iPad… Ketuk Bagikan di Safari"). By 14:07 both were English in the working tree (nav now "Overview / Store Performance / Stock & Purchasing / Cash & Profit / Customers & Promotions / Team & Assets"). Still Indonesian: Executive rupiah words "miliar / jt / rb" (`executive/format.ts`); the Home assistant's three suggested questions ("Bandingkan penjualan tiap toko minggu ini dengan minggu lalu", "Toko mana yang stoknya paling berisiko hilang…", "Apakah pricelist terbaru sudah aktif di semua toko?") come from the backend (`backend/src/cloud/http/assistant.rs`); Reports' empty state quotes "penjualan per warna bulan ini, per toko"; Contracts month labels and Chat day dividers use `id-ID` month names. Data in Indonesian is fine (leave types "Cuti tahunan", chat messages).
**Suggested standard:** UI strings, suggestions and money words in English; only user data stays Indonesian.

### [L] Developer and system jargon leaks into the UI
**Evidence:** seen on screen: "Assistant.brief", "Node.recovered", "Node.attention", "People.period.month open" under each notification; "POST /api/v1/auth/edge-sso-ticket · 200" in Activity; "Legacy access" on every user row; "Node cloud-rig · CLOUD", "Role ADMIN" (all caps, vs "Admin" two screens earlier); "This node has no model key… Set OPENROUTER_API_KEY on the server and restart it" (Assistant); "in this reading" (Assets/Contracts); "estate" ("0.0% of the estate"), "centre", "PIC", ISO month "2026-09" inside a sentence ("Attendance at Cikupa for 2026-09"), a party emoji in the Store page ("Cikupa is open and trading since 02 Oct 2026. 🎉").
**Suggested standard:** never print machine kinds, API routes or env var names; replace estate/centre/PIC with the words the owner uses.

### [M] The same store has three names
**Evidence:** seen on screen: Stores list and Exceptions: "Cikupa C001"; Sales, Analytics, Executive, Locations: "Store 01" / "store-01"; Notifications: "C001 Cikupa: Daily backup recovered"; head office as "HO-GUDANG DC", "DC", "Head Office (HO)".
**Suggested standard:** one display name per site everywhere ("Cikupa"); code in the mono sub-line only.

---

## B. Same concept, different component or pattern

### [H] Status is drawn four different ways, sometimes inside one card
**Where:** record cards and tables.
**Evidence:** seen on screen (phone cards): Stores — green outlined `Pill` "Open" (60x28, r8) on the right of the foot plus a dot+word "Online" on the left; Members — `Pill` "Never bought"; Users — dot+word "Active" (58x22, no border); Exceptions — a lowercase plain word "open" under the red "3d" figure and a tint button "Acknowledge" on the right. From code: System uses `<Status>` 9x, `<Pill>` 30x and `<Tag>` 17x on its own screens; Me uses its own `StatusPill` (25px high) while the hub `Pill` is 28px.
**Inconsistent with:** `pill.tsx` ("one grammar for every state in the app").
**Suggested standard:** card foot: dot+word on the left for server/connection state; one outlined `Pill` for the record's own status on the right; never a lowercase caption; `Tag` only for codes.

### [H] "Me" ships its own UI kit, so Profile looks and reads like another app
**Where:** `/me`, `/me/attendance`, `/me/leave`, `/me/pay`, `/me/details`; `screens/me/ui/*`, `screens/me/data/format.ts`.
**Evidence:** forked `button.tsx`, `button-style.ts`, `card.tsx`, `field.tsx`, `pill.tsx`, `status-pill.tsx`, plus its own date and money formatters. Seen on screen: "Sign out" is a 368x48 (phone) / 670x48 (desk) full-width button on /me and again an 86x36 (desk) / 368x44 (phone) button in My Details "This app"; "Change password" 48px tall; section headings H3 16px for "Today/Leave/Next day off" but H2 15px for "Your records/Account" on the same page; desk has no PageHeader at all (sidebar title "Profile", first item "Profile", then "Hello, Rina Kusuma") in a ~670px centred column. Approval words differ from HR ("Refused", "Taken back" vs "Rejected", "Withdrawn"). Same act named three ways: "Apply" (Leave card), "Apply for leave" (Leave screen), "Request Leave" (hidden nav item); "Ask for a fix" (attendance) vs "Correct a Day" (nav) vs "Ask to change" (details).
**Suggested standard:** drop the fork and use the hub kit; one "Sign out" (profile menu) at one size; name the leave act "Request leave" everywhere.

### [M] Three implementations of the phone record card, and several lists that do not follow it
**Where:** Stores, Members, Sales, Exceptions (`commercial/card-parts.tsx` `RecordCard`/`CardLead`/`CardName`); GA modules (`mobile/phone-cards.tsx` `PhoneCards`/`LeadFigure`/`CodedTitle`); Notifications and Users (hand-built).
**Evidence:** `CardLead` and `LeadFigure` are the same 24px/600 component written twice, as are `CardName` (16px/600) and `CodedTitle` (no weight set). Seen on screen: card heights Members 149, Users 151, Stores 175, Exceptions 211; Users has no right-hand figure at all (rule: one figure top-right); from code the Assets and Suppliers cards have no `lead` either; Notifications cards (Tag chips + "Open the record" link + tint "Mark read") have no figure; Chat uses 67px list rows with avatars; Reports is a bespoke grid. Foot heights 49 (Users) vs 65–69 elsewhere.
**Suggested standard:** merge into one card kit; every record list is the lead-figure card (use "Last sign-in" / "Condition" as the figure when nothing else exists); foot always holds one pill or one tint word-button.

### [M] Control heights on desk toolbars range 28–40 inside one row
**Evidence:** seen on screen: Exceptions — chips 28, "Every store" select 224x40, "Thresholds"/"Acknowledge" 36; Sales by Store — date fields 32, "All units" 36, "Export" 36, Clear buttons 20; Analytics — Day/Week/Month 28, 7/14/30/90 32, "Filter" 32; Users — "Filter" 32, group chips 28, buttons 36; System › Servers/Devices sub-tabs 40; search inputs `h-8` (32) beside 36px primary buttons (Stores, Assets, Members). `sales.tsx` has a comment admitting the picker is `min-h-8` to match `Segmented`.
**Inconsistent with:** the hub scale (36px controls).
**Suggested standard:** every control in a toolbar row is 36px (chips included); sub-tabs are the only 40px element.

### [M] The same "switch the list" job is a tab bar, a chip row, a segmented control or a card header
**Evidence:** seen on screen/from code: System › Servers and Devices use underline sub-tabs (40px: "Servers · Sync · Register · Health · Incidents"); Notifications, Activity, Users, Members, Exceptions use outlined chips (28px); Sales and Analytics use a segmented day/week/month plus a button group 7/14/30/90; Executive uses a Segmented "All | Down" inside the "Store comparison" card header (also on phone). On phone these all become the dock's status chip except the Executive one.
**Suggested standard:** status of a list → chips (desk) / dock chip (phone); view of a record → sub-tabs; unit of time → one segmented control.

### [M] Destructive and committing actions confirm inconsistently
**Evidence:** from code: "Retire segment" and exception "Acknowledge" use `ConfirmButton`; "Block sign-in" (danger button; "Signs them out now, here and at every store server"), supplier "Deactivate" (ghost) and "Mark all read" fire immediately; chat/discussions use `Dialog` for the same job. End-of-life verb differs: Retire (segments), Archive (contracts, chat), Deactivate (suppliers), Block sign-in (users), Remove/Delete.
**Suggested standard:** anything that signs somebody out, stops a supplier or retires a record confirms; one verb per outcome.

### [M] Phone dock actions are hand-built in four places
**Evidence:** `Fab` (`components/ui/fab.tsx`) is the standard (round "+" beside tabs, full-width labelled alone, `h-9`). Duplicates with the same classes: `sales/customer.tsx:402` ("Look up"), `system/notifications.tsx:150` ("Mark all read"), `components/shell/dock-selection.tsx`, `operations/card-parts.tsx:176`. The Fab's spoken label rewrites "Add contract" to "Add New contract". Seen on screen: Mark all read is accent blue (37,99,235), same as Fab.
**Suggested standard:** one `Fab` with an `icon` prop; delete the copies.

### [M] Doubled or mismatched titles; crumbs repeat the title
**Where:** /sales/analytics, /reports, /stores, /members, /system/organisation, Me.
**Evidence:** seen on screen: phone /sales/analytics has two H1s: "Store Analytics" (17px, from nav) and "Sales Analytics" (15px), then a section "Sales by store"; phone /reports shows "Saved" (nav) and "Reports" (page); desk /stores and /members: crumb "Stores"/"Members" directly above H1 "Stores"/"Members" (page text reads "Stores · Stores"); Units has crumb "Master" while living in the System sidebar (from code); crumbs exist on Sales/GA/System/Executive but not on Chat, Files, Reports or Me. Phone top-bar H1 is 17px inside departments but 16px on System, Users, Assistant, Home ("Brief") and Me.
**Suggested standard:** the page title is the nav label (pick "Sales Analytics" or "Store Analytics" and use it in both); crumb only when it differs from the title; one H1 size in the phone top bar.

### [L] Sheets and forms: required marks and labels
**Evidence:** seen on screen: user sheet password field "New Password*" with "(Required)" and a field "Job Role" (Title Case) while the sibling chip says "Job role"; section buttons "Submit / Block sign-in / Set password" inside one sheet instead of one footer; `Field` label "New value" / "New holder" / "Opening figure" (From code) mix Title and sentence case.
**Suggested standard:** one required mark; labels in one case; one footer per sheet.

### [L] What a tap does varies
**Evidence:** seen on screen/from code: Stores card opens a page (/stores/<id>); Users row and Members row open the right-hand record sheet (`?user=dian`); Exceptions cards do not open anything (a button "Acknowledge" and an "Open" link); Notifications cards have a "Mark read" button and a separate "Open the record" link; Sales day opens a sheet. Discussions uses an icon-only pencil to edit a thread ("Edit the title, note and tags").
**Suggested standard:** card tap = open the record (page or sheet, one rule per module type); card buttons are words; no icon-only edit.

---

## C. Phone rules

### [H] Touch targets below 44px on controls that are always on screen
**Where:** every list screen (dock), Notifications, Users, Executive, Me.
**Evidence:** seen on screen (414px): dock status chip 36px (e.g. "Last 30 days 128x36", "Store 79x36"), dock search 36px, Fab 36x36 (code: `h-9`/`size-9`), the dock "Filter and sort" icon 28x28, "Mark read" 99x32 (and 88x28 desk), Executive store names 57x20 (links in the "Stores" table), system group headers 39px, Me "Show my code" 124x36, year buttons "2025/2027" 57x36, "Ask to change" 123x36, "Install server"/"Invite people" 36x36. `Button` itself is 44px only under `pointer-coarse`, so these read 36px in a mouse emulation but the dock controls are fixed 36px on real phones too.
**Suggested standard:** every tap target 44px (hit area may exceed the visual, as `size="card"` does with its `after:-inset-1.5`).

### [H] Text below 14px
**Evidence:** seen on screen: bottom-bar labels "Home / Chat / Activity / Sales by Store / More" are 12px on every route (`bottom-bar.tsx:246, 451`, `text-[0.75rem]`). From code: readiness ring figure 10px (`stores/shared.tsx:132`), bell badge 11px (`top-bar.tsx:305`), letter caption 10px (`letters/document.tsx:100`), Chat 13px (`chat-text`, `chat-message`, `chat-composer`, `chat.tsx`) and 12px unread badges. Everything else in this group is ≥14px (tokens are 14–15px).
**Suggested standard:** raise the bar labels to 14px (shorten "Sales by Division" → "Division" for the bar, as `short` already allows) and the others to 14px.

### [H] Controls and content at the top of lists, actions not in the dock
**Evidence:** seen on screen: /system/notifications opens with a bordered card of iOS install steps (`PushControl`) above the first notification; Executive "Store comparison" has an "All | Down" segmented control inside the card (not the dock) on phone; /system/users has the second action "Add user directly" (370x44) at the bottom of the list content, not in the dock (the dock only has "Invite people"); Members shows a "2 found, 2 enrolled." line above the list (a figure line, acceptable) but a wrong "0 found, 0 enrolled." while loading.
**Inconsistent with:** the owner's "nothing at the top of a list except title and figures; every action at the bottom".
**Suggested standard:** push-control and filters go to the dock/sheet; secondary create actions go into the Fab's sheet or the ⚙ menu.

### [M] Cards that should read "word button" or "one figure" do not
**Evidence:** Exceptions card figure is the red "3d" with caption "open" (a state, not a measure); Notifications use two tags and a link inside the head; Assets/Suppliers have no figure (code). The Members card puts a status pill in the foot where Exceptions/Notifications put a tint word-button; Stores shows two statuses in one foot.
**Suggested standard:** foot right is exactly one of {Pill, word button}; actions and states do not mix.

---

## D. Desk/phone parity

### [H] Screens flagged `more: true` are in no menu on either device
**Where:** Stores, Exceptions, Members, Segments, Store Analytics, Returns, Member, Shop Floor, Sales root, and the Executive module (`hidden: true`).
**Evidence:** `components/shell/nav-column.tsx:400 const SHOW_MORE = false` hides the More fold (owner 2026-09-29), and the phone's AppSheet uses the same `DepartmentScreens`. Seen on screen: on /stores (desk) the "Sales" sidebar lists only Sales by Store … Sales by Cashier Session, so the open screen has no row and nothing is lit; the phone bar shows "Home · Sales by Store · Sales by Division · Sales by Tag · More", and "More" opens a sheet (`AppSheet`) of the same ten "Sales by …" rows with none of the `more: true` screens in it. These screens are reachable only through ⌘K, deep links, or buttons inside other screens. Executive is not in the launcher or the rail either, yet draws its own department tabs on phone.
**Suggested standard:** either show the fold (desk and phone) or move these screens into primary rows; do not keep a bar tab named "More" that opens nothing extra.

### [M] Facts present on desk and absent on phone
**Evidence:** seen on screen: Home setup checklist rows show "done / before stores open / before the first delivery / optional" on desk but the phone hides them (`setup-card.tsx:242 max-sm:hidden`), including the amber urgent colour; Sales KPI cards carry captions "Gross, tax in / Completed sales / ATV / Pieces sold / UPT" on desk, none on phone; Members desk table has Segment, Avg Transaction, Units, UPT, Points Spent (card "hide") that the phone card drops; Analytics "Compare 8 Aug – 6 Sept 2026" and the desk Day/Week/Month are behind the phone ⚙ sheet; Executive desk "1–6 October 2026 · vs 1–6 September 2026" line is missing on phone.
**Suggested standard:** if the owner means "same on every device", every caption or status the desk shows goes on the phone card too.

### [M] Desk search boxes carry no label or placeholder; the phone dock names them
**Evidence:** seen on screen: desk /stores, /members, /system/users, /sales/returns, /sales/customer, /system/devices have `INPUT` with empty `placeholder` and no aria-label (192–224x32); /sales/by-store has aria-label "Search stores". Phone dock labels: "Search Stores", "Search Members", "Search accounts". Code: `screens/stores/list.tsx:106`, `members/directory.tsx:606`, `system/users.tsx:551`, `assets/assets.tsx:157`, `letters/letters.tsx:169` pass neither prop.
**Suggested standard:** one `SearchField` with the same label as the dock ("Search stores") as placeholder and aria-label.

### [L] Desk Me pages are a phone layout in a 670px column
**Evidence:** seen on screen: /me content column 670px at x=529 with full-width 48px buttons; no PageHeader (see Me finding).
**Suggested standard:** same page frame as every other desk screen.

---

## E. Behaviour and visual

### [M] Group heading and row type disagree on Exceptions
**Evidence:** seen on screen: the third and fourth exception rows are "Gudang → store ALR-… is 3 days past its deadline for Pick" yet the card title and the group header are "Receiving overdue · 5". Age appears as "3d" (chip) and "28 h" (sentence) on one card.
**Suggested standard:** title by task type ("Pick overdue", "Receive overdue") and one age format.

### [L] Loading/empty zero states look like data on Sales
**Evidence:** seen on screen once loaded: Sales KPIs "Rp 0 · 0 · Rp 0 · 0 · 0,0" with "—" deltas and 30 identical "–" rows; Executive "Rp0 vs previous period —" ×N. (Rig has no sales.) The empty-sales message ("No shop is registered…") is shown only when no site exists.
**Suggested standard:** when every figure is zero for the span, say "No sales in this span." once.

---

## What is already consistent (do not touch)

- Phone dock pattern: status chip + search + gear + round Fab (where there is a create action) on every list I opened (Stores, Members, Exceptions, Users, Devices, Sales, Assets, Contracts, Letters, Sites, Suppliers) — same order, same pill look.
- Record card geometry: radius 10px, 16px padding, name 16px/600 with a 14px mono code, one 24px/600 figure top-right with a 14px caption, hairline, foot text 14px. Stores, Members, Users and Exceptions measured the same.
- No sideways scrolling on any phone screen in the group (no overflow-x scrollers, document width = viewport on every route visited); desk tables scroll inside their panel only (Activity 1629 wide, Members 1182 wide).
- Phone page headers drop the echo of the top bar title (PageHeader `useEchoesTopBar`), and the `sub` prop is no longer drawn (no subtitles) — except the inline paragraphs listed above.
- Pill tones: green/amber/red/blue used with the stated meanings in Stores, Users, Exceptions, Me; CTA/primary is the accent blue (37,99,235) on Fab, "Mark all read", primary buttons.
- Record sheets live in the URL (`/system/users?user=dian`) and open as a right-hand sheet (760px) on desk.
- Sign-in page (desk): H1 "Sign in" 28px, 44px fields and button, English copy ("Central.", "Use the account your administrator set up for you."), 15px labels, no text below 14px.
- Skeleton loading limited to Ops/Procurement/Master/Merchandise is a documented owner decision (`states.tsx`), not drift.
- Desk page frame: H1 15px, one primary button per header (e.g. "Open a new store", "Invite people", "New segment").
- Rail order and sizes: department icons 40px, aside icons 32px, profile 40px; the profile avatar is a link to /me (no menu to keep in sync).
