# Marketing (hub / Central) — use-case catalogue (9–10 Oct 2026)

Every row is one branch of the Marketing module (`/commercial/*`) and of the shoppers it targets (`/members/*`). Map: `maps/marketing.md`. Tests: `hub/marketing/*.e2e.ts`; helpers: `support/marketing.ts`. Run: `./remote.sh --config hub.config.ts --output .e2e/out/marketing --workers 1 hub/marketing`.

Product decisions respected: no approval step on a promotion/campaign (Publish goes straight out); no segment-targeted promotion (scope is Everyone/Members only; segments are read-only lists). No test uses `agent.act`: every locator is deterministic, so Haiku/Sonnet make no difference to this suite.

Status: **pass**, **fail (bug)** = the app is wrong and the test asserts the right behaviour, **skip (reason)**.


## Promotions — list, tabs, search, filters, sheet (read side)

Actor rina (ADMIN). Seeded promotions (Diskon 15% Sandal & Sepatu, Diskon 10% Koleksi Wanita, Kupon HEMAT50, Poin member) plus own coupon-gated promotions on article 00000010 published through the API with a `tag()` name. Assertions in the UI and re-read from `/commercial/rules`.

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-01 | promotions list > the seeded promotions are listed with phase, benefit and where they apply | rina | `promotions-list.e2e.ts::promotions list > the seeded promotions are listed with phase, benefit and where they apply` | pass |
| MKT-02 | promotions list > a promotion never fired reads "Never used"; one that fired reads its uses | rina | `promotions-list.e2e.ts::promotions list > a promotion never fired reads "Never used"; one that fired reads its uses` | pass |
| MKT-03 | promotions list > phase tabs split Live, Scheduled and Ended and carry counts | rina | `promotions-list.e2e.ts::promotions list > phase tabs split Live, Scheduled and Ended and carry counts` | pass |
| MKT-04 | promotions list > searching narrows by name and shows "No matches." when nothing fits | rina | `promotions-list.e2e.ts::promotions list > searching narrows by name and shows "No matches." when nothing fits` | pass |
| MKT-05 | promotions list > the search also finds a promotion by its coupon code | rina | `promotions-list.e2e.ts::promotions list > the search also finds a promotion by its coupon code` | pass |
| MKT-06 | promotions list > arriving from a campaign narrows to its offers and says so | rina | `promotions-list.e2e.ts::promotions list > arriving from a campaign narrows to its offers and says so` | pass |
| MKT-07 | promotions list > a campaign with no offers says so and offers New promotion | rina | `promotions-list.e2e.ts::promotions list > a campaign with no offers says so and offers New promotion` | pass |
| MKT-08 | promotions list > a promotion opens as a sheet with Details, Stores and Activity | rina | `promotions-list.e2e.ts::promotions list > a promotion opens as a sheet with Details, Stores and Activity` | pass |
| MKT-09 | promotions list > a link to one promotion opens its sheet even when it is not on the first page | rina | `promotions-list.e2e.ts::promotions list > a link to one promotion opens its sheet even when it is not on the first page` | pass |
| MKT-10 | promotions list > Sync usage to stores sends the counts and settles without an error | rina | `promotions-list.e2e.ts::promotions list > Sync usage to stores sends the counts and settles without an error` | pass |
| MKT-11 | promotions list > the Used filter "is 0" keeps promotions that never fired; "at least 1" keeps the ones that did | rina | `promotions-list.e2e.ts::promotions list > the Used filter "is 0" keeps promotions that never fired; "at least 1" keeps the ones that did` | pass |
| MKT-12 | promotions list > the Stores filter "is 1" keeps promotions every shop carries | rina | `promotions-list.e2e.ts::promotions list > the Stores filter "is 1" keeps promotions every shop carries` | pass |
| MKT-13 | promotions list > the campaign named on a promotion links to that campaign's sheet | rina | `promotions-list.e2e.ts::promotions list > the campaign named on a promotion links to that campaign's sheet` | pass |

## Promotions — New promotion form

Actor rina. Drive the New promotion sheet by role/label; re-read the rule from `/commercial/rules`. Every live rule is on article 00000010 behind its own coupon code, so no other suite's basket is touched.

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-14 | new promotion > percent off on one article behind a coupon code is published and listed | rina | `promotions-create.e2e.ts::new promotion > percent off on one article behind a coupon code is published and listed` | pass |
| MKT-15 | new promotion > the quick percentages fill the field and the till preview rings it up | rina | `promotions-create.e2e.ts::new promotion > the quick percentages fill the field and the till preview rings it up` | pass |
| MKT-16 | new promotion > without a name, a discount or a target, Publish says what is missing, one thing at a time | rina | `promotions-create.e2e.ts::new promotion > without a name, a discount or a target, Publish says what is missing, one thing at a time` | pass |
| MKT-17 | new promotion > a zero discount is not a discount | rina | `promotions-create.e2e.ts::new promotion > a zero discount is not a discount` | pass |
| MKT-18 | new promotion > amount off the basket writes an AMOUNT rule with the typed rupiah | rina | `promotions-create.e2e.ts::new promotion > amount off the basket writes an AMOUNT rule with the typed rupiah` | pass |
| MKT-19 | new promotion > a fixed price writes FIXED_UNIT_PRICE | rina | `promotions-create.e2e.ts::new promotion > a fixed price writes FIXED_UNIT_PRICE` | pass |
| MKT-20 | new promotion > buy X get Y: quantities and the reward percentage are written as typed | rina | `promotions-create.e2e.ts::new promotion > buy X get Y: quantities and the reward percentage are written as typed` | pass |
| MKT-21 | new promotion > buy two get one free is Buy X get Y at 100% | rina | `promotions-create.e2e.ts::new promotion > buy two get one free is Buy X get Y at 100%` | pass |
| MKT-22 | new promotion > a points offer asks for the spend per point and how it combines with a better rate | rina | `promotions-create.e2e.ts::new promotion > a points offer asks for the spend per point and how it combines with a better rate` | pass |
| MKT-23 | new promotion > the points combination question appears only under a points offer | rina | `promotions-create.e2e.ts::new promotion > the points combination question appears only under a points offer` | pass |
| MKT-24 | new promotion > a SKU scope writes the SKU codes | rina | `promotions-create.e2e.ts::new promotion > a SKU scope writes the SKU codes` | pass |
| MKT-25 | new promotion > a division scope offers the vocabulary and writes the division code | rina | `promotions-create.e2e.ts::new promotion > a division scope offers the vocabulary and writes the division code` | pass |
| MKT-26 | new promotion > a tag scope writes the tag code | rina | `promotions-create.e2e.ts::new promotion > a tag scope writes the tag code` | pass |
| MKT-27 | new promotion > a whole-basket scope needs no article and says so in the summary | rina | `promotions-create.e2e.ts::new promotion > a whole-basket scope needs no article and says so in the summary` | pass |
| MKT-28 | new promotion > members only, sale items too and offer-blocking are written into the rule | rina | `promotions-create.e2e.ts::new promotion > members only, sale items too and offer-blocking are written into the rule` | pass |
| MKT-29 | new promotion > the defaults are everyone, not on sale items, and blocks every other offer | rina | `promotions-create.e2e.ts::new promotion > the defaults are everyone, not on sale items, and blocks every other offer` | pass |
| MKT-30 | new promotion > limits: minimums, budget, transaction caps and priority are written as numbers | rina | `promotions-create.e2e.ts::new promotion > limits: minimums, budget, transaction caps and priority are written as numbers` | pass |
| MKT-31 | new promotion > the till preview refuses to discount under the minimum basket | rina | `promotions-create.e2e.ts::new promotion > the till preview refuses to discount under the minimum basket` | pass |
| MKT-32 | new promotion > a start in a week is Scheduled, with its period written on the rule and in the list | rina | `promotions-create.e2e.ts::new promotion > a start in a week is Scheduled, with its period written on the rule and in the list` | pass |
| MKT-33 | new promotion > an end date before the start is flagged at the field and blocks Publish | rina | `promotions-create.e2e.ts::new promotion > an end date before the start is flagged at the field and blocks Publish` | pass |
| MKT-34 | new promotion > joining a campaign restates it unchanged and files the promotion under it | rina | `promotions-create.e2e.ts::new promotion > joining a campaign restates it unchanged and files the promotion under it` | pass |
| MKT-35 | new promotion > closing the form unpublished leaves the books as they were | rina | `promotions-create.e2e.ts::new promotion > closing the form unpublished leaves the books as they were` | pass |
| MKT-36 | new promotion > a published promotion appears in the list and a banner never claims it reached nobody | rina | `promotions-create.e2e.ts::new promotion > a published promotion appears in the list and a banner never claims it reached nobody` | pass |
| MKT-37 | new promotion > a percentage above 100 is refused [FIXED 10 Oct: rule-form caps at 100%, server refuses 0.01–100% outside], not published | rina | `promotions-create.e2e.ts::new promotion > a percentage above 100 is refused, not published` | fail (bug) |

## Promotions — pause / resume / end / change / duplicate and the shop's till

Actor rina. Own coupon rule on the Tas article; the UI switch/sheet is driven, the effect is proven on store-01 with `/api/v1/store/quote` (applied / reason / benefit_minor).

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-38 | pause and resume > pausing asks first; declining changes nothing | rina | `promotions-lifecycle.e2e.ts::pause and resume > pausing asks first; declining changes nothing` | pass |
| MKT-39 | pause and resume > Pause then Resume flips the status, says how many stores were told, and moves the tab counts | rina | `promotions-lifecycle.e2e.ts::pause and resume > Pause then Resume flips the status, says how many stores were told, and moves the tab counts` | pass |
| MKT-40 | pause and resume > the till stops and restarts the discount with the switch | rina | `promotions-lifecycle.e2e.ts::pause and resume > the till stops and restarts the discount with the switch` | pass |
| MKT-41 | end now > ending is for good: confirmed, written as Ended, no switch and no End button afterwards | rina | `promotions-lifecycle.e2e.ts::end now > ending is for good: confirmed, written as Ended, no switch and no End button afterwards` | pass |
| MKT-42 | end now > an ended promotion no longer discounts at the till | rina | `promotions-lifecycle.e2e.ts::end now > an ended promotion no longer discounts at the till` | pass |
| MKT-43 | change and duplicate > Change publishes the next version under the same id and the till follows | rina | `promotions-lifecycle.e2e.ts::change and duplicate > Change publishes the next version under the same id and the till follows` | pass |
| MKT-44 | change and duplicate > changing a paused promotion keeps it paused | rina | `promotions-lifecycle.e2e.ts::change and duplicate > changing a paused promotion keeps it paused` | pass |
| MKT-45 | change and duplicate > Duplicate opens a "(copy)" without the coupon code and mints a new id | rina | `promotions-lifecycle.e2e.ts::change and duplicate > Duplicate opens a "(copy)" without the coupon code and mints a new id` | pass |
| MKT-46 | what the till makes of a rule > a members-only promotion needs a member in the basket | rina | `promotions-lifecycle.e2e.ts::what the till makes of a rule > a members-only promotion needs a member in the basket` | pass |
| MKT-47 | what the till makes of a rule > a minimum basket is honoured: one bag is not enough, two are | rina | `promotions-lifecycle.e2e.ts::what the till makes of a rule > a minimum basket is honoured: one bag is not enough, two are` | pass |
| MKT-48 | what the till makes of a rule > a promotion that has not started yet is not applied | rina | `promotions-lifecycle.e2e.ts::what the till makes of a rule > a promotion that has not started yet is not applied` | pass |
| MKT-49 | what the till makes of a rule > without the code, a coupon promotion says it needs one | rina | `promotions-lifecycle.e2e.ts::what the till makes of a rule > without the code, a coupon promotion says it needs one` | pass |
| MKT-50 | what the till makes of a rule > amount off, fixed price and buy-two-get-one reach the till as typed | rina | `promotions-lifecycle.e2e.ts::what the till makes of a rule > amount off, fixed price and buy-two-get-one reach the till as typed` | pass |

## Campaigns — list, sheet, form, switches, stores

Actor rina. Seeded Pekan Sepatu / Gajian Hemat for reading; own campaigns created through the API (`makeCampaign`) for everything that changes; effects proven through `/commercial/campaigns` and the shop quote.

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-51 | campaigns list > the seeded campaigns show status, objective, target, budget used, stores and window | rina | `campaigns.e2e.ts::campaigns list > the seeded campaigns show status, objective, target, budget used, stores and window` | pass |
| MKT-52 | campaigns list > a campaign nobody gave a purpose reads "Not stated" | rina | `campaigns.e2e.ts::campaigns list > a campaign nobody gave a purpose reads "Not stated"` | pass |
| MKT-53 | campaigns list > searching narrows the list by name | rina | `campaigns.e2e.ts::campaigns list > searching narrows the list by name` | pass |
| MKT-54 | campaigns list > the Status filter finds a paused campaign and nothing else | rina | `campaigns.e2e.ts::campaigns list > the Status filter finds a paused campaign and nothing else` | pass |
| MKT-55 | campaigns list > the Offers filter "is 0" finds a campaign with nothing to spend its budget on | rina | `campaigns.e2e.ts::campaigns list > the Offers filter "is 0" finds a campaign with nothing to spend its budget on` | pass |
| MKT-56 | campaigns list > the Objective filter "is empty" finds campaigns with no stated goal | rina | `campaigns.e2e.ts::campaigns list > the Objective filter "is empty" finds campaigns with no stated goal` | pass |
| MKT-57 | campaigns list > a campaign sheet shows its offers, goal, results, and the stores that carry it | rina | `campaigns.e2e.ts::campaigns list > a campaign sheet shows its offers, goal, results, and the stores that carry it` | pass |
| MKT-58 | campaigns list > a fresh campaign lists its next steps; an offer ticks one off; an offer and a goal remove the list | rina | `campaigns.e2e.ts::campaigns list > a fresh campaign lists its next steps; an offer ticks one off; an offer and a goal remove the list` | pass |
| MKT-59 | campaigns list > "Set a goal" from the checklist saves an objective, metric and target | rina | `campaigns.e2e.ts::campaigns list > "Set a goal" from the checklist saves an objective, metric and target` | pass |
| MKT-60 | campaign sheet extras > "New offer" opens the promotion form with this campaign already chosen | rina | `campaigns.e2e.ts::campaign sheet extras > "New offer" opens the promotion form with this campaign already chosen` | pass |
| MKT-61 | campaign sheet extras > a planned activity is added from the sheet and saved on the campaign | rina | `campaigns.e2e.ts::campaign sheet extras > a planned activity is added from the sheet and saved on the campaign` | pass |
| MKT-62 | campaign stores > a campaign can be limited to several stores when the fleet has several | rina | `campaigns.e2e.ts::campaign stores > a campaign can be limited to several stores when the fleet has several` | skip (the rig has one registered store: the Stores picker lists only shops that have reported) |
| MKT-63 | new campaign > a name alone publishes a live, everywhere campaign starting today | rina | `campaigns.e2e.ts::new campaign > a name alone publishes a live, everywhere campaign starting today` | pass |
| MKT-64 | new campaign > without a name Publish says "Give it a name." and publishes nothing | rina | `campaigns.e2e.ts::new campaign > without a name Publish says "Give it a name." and publishes nothing` | pass |
| MKT-65 | new campaign > budget, transaction limit, window, a chosen store and the poster are all written | rina | `campaigns.e2e.ts::new campaign > budget, transaction limit, window, a chosen store and the poster are all written` | pass |
| MKT-66 | new campaign > choosing Everywhere again clears a chosen store | rina | `campaigns.e2e.ts::new campaign > choosing Everywhere again clears a chosen store` | pass |
| MKT-67 | new campaign > Status offers Draft, Scheduled, Paused and Live but never Ended or Cancelled | rina | `campaigns.e2e.ts::new campaign > Status offers Draft, Scheduled, Paused and Live but never Ended or Cancelled` | pass |
| MKT-68 | new campaign > a campaign published as Paused stays paused | rina | `campaigns.e2e.ts::new campaign > a campaign published as Paused stays paused` | pass |
| MKT-69 | new campaign > an end date before the start is flagged and blocks Publish | rina | `campaigns.e2e.ts::new campaign > an end date before the start is flagged and blocks Publish` | pass |
| MKT-70 | new campaign > Change publishes the next version under the same id and keeps stores, poster and status | rina | `campaigns.e2e.ts::new campaign > Change publishes the next version under the same id and keeps stores, poster and status` | pass |
| MKT-71 | new campaign > Duplicate opens a "(copy)" under a new id and copies no offers | rina | `campaigns.e2e.ts::new campaign > Duplicate opens a "(copy)" under a new id and copies no offers` | pass |
| MKT-72 | campaign switches > pausing from the list asks first; resuming does not | rina | `campaigns.e2e.ts::campaign switches > pausing from the list asks first; resuming does not` | pass |
| MKT-73 | campaign switches > the sheet pauses, resumes and ends a campaign for good | rina | `campaigns.e2e.ts::campaign switches > the sheet pauses, resumes and ends a campaign for good` | pass |
| MKT-74 | campaign switches > a campaign past its window reads Ended and has no switch | rina | `campaigns.e2e.ts::campaign switches > a campaign past its window reads Ended and has no switch` | pass |
| MKT-75 | campaign switches > editing the poster in the sheet is sent to the stores without a new book | rina | `campaigns.e2e.ts::campaign switches > editing the poster in the sheet is sent to the stores without a new book` | pass |
| MKT-76 | campaign switches > pausing a campaign stops its offers at the till; resuming brings them back | rina | `campaigns.e2e.ts::campaign switches > pausing a campaign stops its offers at the till; resuming brings them back` | pass |

## Vouchers — book, issue, spend, cancel, coupons

Actor rina. Seeded vouchers for reading; own vouchers issued through the API for spend/cancel flows; ledger figures compared with `/commercial/vouchers` ledger.

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-77 | voucher book > the seeded vouchers are listed with kind, member, face value, balance and status | rina | `vouchers.e2e.ts::voucher book > the seeded vouchers are listed with kind, member, face value, balance and status` | pass |
| MKT-78 | voucher book > the liability strip matches the cloud ledger | rina | `vouchers.e2e.ts::voucher book > the liability strip matches the cloud ledger` | pass |
| MKT-79 | voucher book > Live, Spent and Cancelled tabs split the book by stored status | rina | `vouchers.e2e.ts::voucher book > Live, Spent and Cancelled tabs split the book by stored status` | pass |
| MKT-80 | voucher book > search finds a voucher by code or by the member holding it | rina | `vouchers.e2e.ts::voucher book > search finds a voucher by code or by the member holding it` | pass |
| MKT-81 | voucher book > the Face value and Status filters narrow the book on the server | rina | `vouchers.e2e.ts::voucher book > the Face value and Status filters narrow the book on the server` | pass |
| MKT-82 | voucher book > with filters that match nothing, "Clear filters" brings the book back | rina | `vouchers.e2e.ts::voucher book > with filters that match nothing, "Clear filters" brings the book back` | pass |
| MKT-83 | voucher book > Coupons lists every code and the promotion it unlocks | rina | `vouchers.e2e.ts::voucher book > Coupons lists every code and the promotion it unlocks` | pass |
| MKT-84 | issuing a voucher > a gift card of a given value is minted with a code and opens its sheet | rina | `vouchers.e2e.ts::issuing a voucher > a gift card of a given value is minted with a code and opens its sheet` | pass |
| MKT-85 | issuing a voucher > Submit stays disabled and a blurred empty value says "Enter a value." | rina | `vouchers.e2e.ts::issuing a voucher > Submit stays disabled and a blurred empty value says "Enter a value."` | pass |
| MKT-86 | issuing a voucher > refund and goodwill kinds, a typed code and an expiry are all kept | rina | `vouchers.e2e.ts::issuing a voucher > refund and goodwill kinds, a typed code and an expiry are all kept` | pass |
| MKT-87 | issuing a voucher > a voucher can be given to a member picked from the directory | rina | `vouchers.e2e.ts::issuing a voucher > a voucher can be given to a member picked from the directory` | pass |
| MKT-88 | issuing a voucher > re-using an existing code is refused and mints nothing | rina | `vouchers.e2e.ts::issuing a voucher > re-using an existing code is refused and mints nothing` | pass |
| MKT-89 | one voucher > the sheet reads kind, code, member, balance and ledger | rina | `vouchers.e2e.ts::one voucher > the sheet reads kind, code, member, balance and ledger` | pass |
| MKT-90 | one voucher > spending part of a voucher lowers the balance and writes a ledger line | rina | `vouchers.e2e.ts::one voucher > spending part of a voucher lowers the balance and writes a ledger line` | pass |
| MKT-91 | one voucher > an amount above the balance is flagged and cannot be submitted | rina | `vouchers.e2e.ts::one voucher > an amount above the balance is flagged and cannot be submitted` | pass |
| MKT-92 | one voucher > spending the whole balance marks the voucher Spent and removes the actions | rina | `vouchers.e2e.ts::one voucher > spending the whole balance marks the voucher Spent and removes the actions` | pass |
| MKT-93 | one voucher > cancelling needs a reason of four characters, then voids the balance | rina | `vouchers.e2e.ts::one voucher > cancelling needs a reason of four characters, then voids the balance` | pass |
| MKT-94 | one voucher > "Keep" in the cancel question leaves the voucher live | rina | `vouchers.e2e.ts::one voucher > "Keep" in the cancel question leaves the voucher live` | pass |
| MKT-95 | voucher rules the server holds > a voucher that has already expired cannot be issued | rina | `vouchers.e2e.ts::voucher rules the server holds > a voucher that has already expired cannot be issued` | pass |
| MKT-96 | voucher rules the server holds > a cancelled voucher cannot be spent | rina | `vouchers.e2e.ts::voucher rules the server holds > a cancelled voucher cannot be spent` | pass |
| MKT-97 | voucher rules the server holds > a voucher cannot be spent beyond its balance | rina | `vouchers.e2e.ts::voucher rules the server holds > a voucher cannot be spent beyond its balance` | pass |

## Pricelist, Change price, Changes, History

Actor rina. Pricelist reads the seeded grid; publishing uses only the Tas article (scheduled, so nobody's price moves) and Kemeja size 00000005104 (one markdown ending in 2 days, tagged `till`); books/changes re-read from `/commercial/publications` and `/price-changes`.

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-98 | pricelist > the grid reads base price and what store-01 actually charges, with the reason | rina | `pricing.e2e.ts::pricelist > the grid reads base price and what store-01 actually charges, with the reason` | pass |
| MKT-99 | pricelist > the price on the grid is the price the shop catalogues and charges | rina | `pricing.e2e.ts::pricelist > the price on the grid is the price the shop catalogues and charges` | pass |
| MKT-100 | pricelist > the "Only articles with" switches keep articles carrying that kind of price | rina | `pricing.e2e.ts::pricelist > the "Only articles with" switches keep articles carrying that kind of price` | pass |
| MKT-101 | pricelist > searching narrows the grid and counts the articles | rina | `pricing.e2e.ts::pricelist > searching narrows the grid and counts the articles` | pass |
| MKT-102 | pricelist > ticking an article offers Change price… and Clear drops the selection | rina | `pricing.e2e.ts::pricelist > ticking an article offers Change price… and Clear drops the selection` | pass |
| MKT-103 | pricelist details > an article opens to its SKUs, and a store header opens that store | rina | `pricing.e2e.ts::pricelist details > an article opens to its SKUs, and a store header opens that store` | pass |
| MKT-104 | pricelist details > the Stock switch adds what store-01 holds to the grid | rina | `pricing.e2e.ts::pricelist details > the Stock switch adds what store-01 holds to the grid` | pass |
| MKT-105 | pricelist details > a store price cell that is just the base price reads "same as the base price" | rina | `pricing.e2e.ts::pricelist details > a store price cell that is just the base price reads "same as the base price"` | pass |
| MKT-106 | change price sheet > it cannot publish until a price is typed, and says so | rina | `pricing.e2e.ts::change price sheet > it cannot publish until a price is typed, and says so` | pass |
| MKT-107 | change price sheet > a markdown is previewed per store before it is published | rina | `pricing.e2e.ts::change price sheet > a markdown is previewed per store before it is published` | pass |
| MKT-108 | change price sheet > a markdown percentage of 100 or more is not a markdown | rina | `pricing.e2e.ts::change price sheet > a markdown percentage of 100 or more is not a markdown` | pass |
| MKT-109 | change price sheet > choosing stores with none ticked blocks publishing | rina | `pricing.e2e.ts::change price sheet > choosing stores with none ticked blocks publishing` | pass |
| MKT-110 | change price sheet > a scheduled markdown is published as a Markdown change that has not started | rina | `pricing.e2e.ts::change price sheet > a scheduled markdown is published as a Markdown change that has not started` | pass |
| MKT-111 | change price sheet > a new regular price writes one price rule per size for the chosen store | rina | `pricing.e2e.ts::change price sheet > a new regular price writes one price rule per size for the chosen store` | pass |
| MKT-112 | change price sheet > a markdown on chosen sizes only prices those SKUs, and the till charges it from today | rina | `pricing.e2e.ts::change price sheet > a markdown on chosen sizes only prices those SKUs, and the till charges it from today` | pass |
| MKT-113 | change price receipt > publishing a price change confirms it [FIXED 10 Oct: pricelist keeps the sheet key on close], as every other publish does | rina | `pricing.e2e.ts::change price receipt > publishing a price change confirms it, as every other publish does` | fail (bug) |
| MKT-114 | changes > the markdown on Sandal is listed with its kind, status and rollout | rina | `pricing.e2e.ts::changes > the markdown on Sandal is listed with its kind, status and rollout` | pass |
| MKT-115 | changes > Scheduled lists a change that has not started; Active does not | rina | `pricing.e2e.ts::changes > Scheduled lists a change that has not started; Active does not` | pass |
| MKT-116 | changes > search finds a change by name | rina | `pricing.e2e.ts::changes > search finds a change by name` | pass |
| MKT-117 | changes > a change opens as a sheet with its stores | rina | `pricing.e2e.ts::changes > a change opens as a sheet with its stores` | pass |
| MKT-118 | changes > "Include settled" widens the list to changes that are fully rolled out and over | rina | `pricing.e2e.ts::changes > "Include settled" widens the list to changes that are fully rolled out and over` | pass |
| MKT-119 | history > a book I publish is logged as Published and then In service at the shop | rina | `pricing.e2e.ts::history > a book I publish is logged as Published and then In service at the shop` | pass |
| MKT-120 | history > narrowing to one store says which and can be undone | rina | `pricing.e2e.ts::history > narrowing to one store says which and can be undone` | pass |
| MKT-121 | history > a store with no events shows the filtered empty state with Clear filters | rina | `pricing.e2e.ts::history > a store with no events shows the filtered empty state with Clear filters` | pass |
| MKT-122 | history > the Trouble lens holds only failures and expiries | rina | `pricing.e2e.ts::history > the Trouble lens holds only failures and expiries` | pass |

## Members, Segments, Points

Actor rina (UI) and dian (enrolment by API, as a cashier does). Own members/segments with `tag()` names; points checked against `/members/points`.

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-123 | member directory > the seeded members are listed with segment, spend, transactions and points | rina | `members.e2e.ts::member directory > the seeded members are listed with segment, spend, transactions and points` | pass |
| MKT-124 | member directory > a newly enrolled card shows up as Never bought, found by name and by card number | rina | `members.e2e.ts::member directory > a newly enrolled card shows up as Never bought, found by name and by card number` | pass |
| MKT-125 | member directory > the segment tabs keep only members in that segment | rina | `members.e2e.ts::member directory > the segment tabs keep only members in that segment` | pass |
| MKT-126 | member directory > a member sheet reads the card, spend, points and what promotions saved them | rina | `members.e2e.ts::member directory > a member sheet reads the card, spend, points and what promotions saved them` | pass |
| MKT-127 | member directory > a pairing code is six digits that expire, and the sheet says who to read it to | rina | `members.e2e.ts::member directory > a pairing code is six digits that expire, and the sheet says who to read it to` | pass |
| MKT-128 | member directory > member points held agree with the loyalty ledger | rina | `members.e2e.ts::member directory > member points held agree with the loyalty ledger` | pass |
| MKT-129 | member segments > the built-in six split the directory and each links to its filtered list | rina | `members.e2e.ts::member segments > the built-in six split the directory and each links to its filtered list` | pass |
| MKT-130 | member segments > the saved segments show their conditions and member share | rina | `members.e2e.ts::member segments > the saved segments show their conditions and member share` | pass |
| MKT-131 | member segments > a new segment needs a name and a finished condition before Submit | rina | `members.e2e.ts::member segments > a new segment needs a name and a finished condition before Submit` | pass |
| MKT-132 | member segments > a segment with a spend condition previews how many members match, and is saved | rina | `members.e2e.ts::member segments > a segment with a spend condition previews how many members match, and is saved` | pass |
| MKT-133 | member segments > editing a saved segment writes a new version; retiring it asks and removes it | rina | `members.e2e.ts::member segments > editing a saved segment writes a new version; retiring it asks and removes it` | pass |
| MKT-134 | points scheme > the scheme is a members-only "1 point per Rp 10.000" promotion that is live | rina | `members.e2e.ts::points scheme > the scheme is a members-only "1 point per Rp 10.000" promotion that is live` | pass |
| MKT-135 | points registers (routed, no menu row) > Points lists every account with its balance and counts them like the server | rina | `members.e2e.ts::points registers (routed, no menu row) > Points lists every account with its balance and counts them like the server` | pass |
| MKT-136 | points registers (routed, no menu row) > Points Ledger lists the movements with what caused each | rina | `members.e2e.ts::points registers (routed, no menu row) > Points Ledger lists the movements with what caused each` | pass |

## Marketing Overview

Actor rina. Figures compared with the voucher ledger; links followed.

| ID | Branch (describe > test) | Actor | Test file::title | Status |
|---|---|---|---|---|
| MKT-137 | marketing overview > it opens on the figures and the three campaign/promotion/voucher blocks | rina | `overview.e2e.ts::marketing overview > it opens on the figures and the three campaign/promotion/voucher blocks` | pass |
| MKT-138 | marketing overview > "Vouchers outstanding" is the voucher ledger liability | rina | `overview.e2e.ts::marketing overview > "Vouchers outstanding" is the voucher ledger liability` | pass |
| MKT-139 | marketing overview > the running campaigns are listed with their headline | rina | `overview.e2e.ts::marketing overview > the running campaigns are listed with their headline` | pass |
| MKT-140 | marketing overview > each block opens its list | rina | `overview.e2e.ts::marketing overview > each block opens its list` | pass |
| MKT-141 | marketing overview > the rail lists the Marketing screens | rina | `overview.e2e.ts::marketing overview > the rail lists the Marketing screens` | pass |

## Bugs found (tests stay red)

- `promotions-create.e2e.ts::new promotion > a percentage above 100 is refused, not published` — BUG: the form and the server accept `Percent off` 150 and publish a promotion that gives 150% off (bps 15000); only `bps <= 0` is checked (rule-form.tsx effect, `Percentage` field). BXGY has a 1-100 check, Percent does not.
- `pricing.e2e.ts::change price receipt > publishing a price change confirms it, as every other publish does` — BUG: after Publish the Change price sheet closes and its receipt (SavedDialog "“…” published — Sent to N stores.") never shows: `ChangePriceSheet` owns the SavedDialog but the pricelist re-keys/unmounts it in the same tick (`pricelist.tsx` key={changePrice===null?'empty':…}).

## Branches without a test (and why)

| Branch | Why |
|---|---|
| Choose several of the 16 stores for a campaign | The Stores tiles list only shops that have reported (`/commercial/activation`); the rig has one registered till origin (store-01). Written and skipped: `campaigns.e2e.ts::campaign stores > a campaign can be limited to several stores when the fleet has several` (runs by itself once a second shop reports). Everywhere / one store / clear are tested. |
| Promotions "N promotion(s) have reached the budget" banner, spend and uses counters moving | Needs sales at a till (POS domain); counters are only read (`Never used`, `Used` filter). |
| Voucher shown as "· Expired" | The server refuses to issue an already-expired voucher ("a voucher that has already expired cannot be issued"), tested; there is no way to age one on the rig. |
| Coupon sets (mint/expire codes), campaign guardrails ("Limits"/"Check now"), Reach "Declare", "Split between stores" hard cap | Routes exist (`/commercial/coupon-sets`, `/campaigns/{id}/guardrail-check`, `/allocations`) but are either API-only or need several shops; only the Activities and Goal parts of the campaign sheet are driven. |
| Time-of-day / weekday windows on a markdown (flash sale) | The Change price sheet has no control for them yet (MarkdownInput supports them). |
| `price-form.tsx` and `pricelist-editor.tsx` | Dead code, imported nowhere. |
| Phone layout of the marketing screens | Out of this suite (desktop 1440x900); covered by the phone audit prototypes. |

## Other findings (not failing tests)

- The search box on Promotions, Campaigns, Vouchers and Members has no accessible name (only Changes has "Search changes"); tests use `getByRole('textbox').first()`.
- On the New promotion sheet a blurred empty Name adds a problem line which shifts every control below it by one line and becomes part of the field's accessible name ("Name (required) Give the promotion a name."); a tap aimed at a radio just under it can miss. Tests fill the name first.
- While a combobox list (articles, SKUs, divisions, tags, member) is open, Escape closes the whole sheet, not just the list; tests close the list by tapping the sheet header.
- The receipt dialogs ("Paused — sent to 1 store") stay open for as long as the pointer rests on them and hold the page inert behind them; tests close them with Escape.
- Several books can be published at the same time by other suites (every new article gets a "Harga awal" book); a sheet opened with version N then fails with "book vN would be written below vN … number it vN+1 or later". Pressing Publish again works; `publishSheet()` does that.
- The segment form's problem line says "Add at least one condition" while the only condition is unfinished; "One of the conditions is not finished." only appears once another condition is complete.
- A voided voucher keeps `spent_minor` = its face value (void is counted as spent) and `balance_minor` 0.
