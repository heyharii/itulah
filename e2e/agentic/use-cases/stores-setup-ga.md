# Use cases — Stores, Setup, System, GA, Workplace and the landing screens

The hub side of the `agentic` rig. Branch map: `maps/stores-setup-ga.md`. Tests: `hub/stores/`, `hub/setup/`, `hub/ga/`;
helpers: `support/stores-ga.ts`. One session (`rina`, an ADMIN with the owner's reach) drives every browser test; an operations
login (nina, yusuf) and a store manager (maya) and a cashier (dian) sign in by API inside the test that needs them.
The bootstrap `admin` and `yusuf` browser sessions are not used: other suites' API logins kept signing them out mid-run.

Last run: `.e2e/out/stores8` — 193 tests: **182 passed, 4 failed (all four are bugs, tagged `bug`), 7 skipped** (below).

Run: `cd e2e/agentic && ./remote.sh --config hub.config.ts --output .e2e/out/stores hub/stores hub/setup hub/ga` (about 8 minutes when the VM is quiet, up to an hour when ten suites share it).

Rules this file's tests follow beyond the README: GA records and threads are made through the API with a `tag()` in their code or title; the one getting-ready
store `Uji Bersama E2E` is made once and found again by name (`sharedTestStore`), so the rig grows by one store (STO-33, made through the sheet) per run, not one per test;
`Steady` clients wait out a cloud restart (ECONNREFUSED / 502 / 503 / 504).

## Stores (list, page, open a store, install code, seats, exceptions, remote actions)

| ID | Branch | File | Last run |
|---|---|---|---|
| STO-01 | every store is a row: name, code and the count matches the API | `hub/stores/list.e2e.ts` | pass |
| STO-02 | a row says open since a dated day, its status pill and its server state | `hub/stores/list.e2e.ts` | pass |
| STO-03 | a store whose server is not installed reads Not installed, with its seats and tills online | `hub/stores/list.e2e.ts` | pass |
| STO-04 | search narrows by code, by name and by city, and says so when nothing matches | `hub/stores/list.e2e.ts` | pass |
| STO-05 | a row opens that store's own page | `hub/stores/list.e2e.ts` | pass |
| STO-06 | the sidebar does not repeat the module (Stores is under More) and /stores/exceptions is routed | `hub/stores/list.e2e.ts` | pass |
| STO-07 | an operations login (nina) is refused the Stores module | `hub/stores/list.e2e.ts` | pass |
| STO-08 | a store manager lands straight on their own store, with no list and no Open button | `hub/stores/list.e2e.ts` | pass |
| STO-09 | phone: stores are cards with the tills-online figure, a search in the dock and a round Open button | `hub/stores/list.e2e.ts` | pass |
| STO-10 | the page names the store and offers the eight tabs, Overview first | `hub/stores/detail.e2e.ts` | pass |
| STO-11 | Overview: code, city, timezone, PIC, address and open-since come from the store | `hub/stores/detail.e2e.ts` | pass |
| STO-12 | Overview carries the exceptions card; a store with none reads All clear, not the fleet's count | `hub/stores/detail.e2e.ts` | **FAIL (bug)** |
| STO-13 | Server tab of a store whose server is online: the word Online, a heartbeat and the Actions menu | `hub/stores/detail.e2e.ts` | pass |
| STO-14 | Server tab of a store with no server: the install card, its 24-hour code sentence and the Install server button | `hub/stores/detail.e2e.ts` | pass |
| STO-15 | Devices tab: tills online line, the seat count and the seats form | `hub/stores/detail.e2e.ts` | pass |
| STO-16 | Devices tab: a store with no reporting devices says so | `hub/stores/detail.e2e.ts` | pass |
| STO-17 | Activity tab: a store nobody asked anything of says so | `hub/stores/detail.e2e.ts` | pass |
| STO-18 | Team tab: the PIC card with its link to Master, and who is posted here | `hub/stores/detail.e2e.ts` | pass |
| STO-19 | Team tab: a new store lists the manager who was invited to it, with no PIC appointed | `hub/stores/detail.e2e.ts` | pass |
| STO-20 | Payments tab: the enabled methods or the sentence about cash, and the Finance link | `hub/stores/detail.e2e.ts` | pass |
| STO-21 | Stock tab: open flow documents touching the site, or none | `hub/stores/detail.e2e.ts` | pass |
| STO-22 | Facilities tab: Open facilities raises the location hub sheet for the site | `hub/stores/detail.e2e.ts` | pass |
| STO-23 | a store id nobody has is an error, not a blank page | `hub/stores/detail.e2e.ts` | pass |
| STO-24 | phone: the store page keeps its tabs and the Overview facts | `hub/stores/detail.e2e.ts` | pass |
| STO-30 | Open store stays disabled until every named store has a manager; Cancel closes it | `hub/stores/open.e2e.ts` | pass |
| STO-31 | Enter in a name adds a row, two named stores change the button to "Open 2 stores", Remove drops a row | `hub/stores/open.e2e.ts` | pass |
| STO-32 | a pasted list (name, city, manager per line) becomes one row per store | `hub/stores/open.e2e.ts` | pass |
| STO-33 | opening a store shows its manager link once, a saved note and a Getting-ready row | `hub/stores/open.e2e.ts` | pass |
| STO-34 | Overview shows the checklist and a disabled Open store with the reason beside it | `hub/stores/open.e2e.ts` | pass |
| STO-35 | the API refuses to open it and names what is unmet (409) | `hub/stores/open.e2e.ts` | pass |
| STO-36 | Server tab: Install server issues a code and a QR, "Issue a new code" replaces it | `hub/stores/open.e2e.ts` | pass |
| STO-37 | after a reload the code is gone: the page says it was shown once | `hub/stores/open.e2e.ts` | pass |
| STO-38 | Devices tab: set the seats to 3, the line and the API follow; 0 and 51 cannot be submitted | `hub/stores/open.e2e.ts` | pass |
| STO-39 | Team tab: no PIC and no one posted yet | `hub/stores/open.e2e.ts` | pass |
| STO-40 | a batch with a store that has no manager is refused whole (422) and makes nothing | `hub/stores/open.e2e.ts` | pass |
| STO-41 | phone: a getting-ready store is a card whose figure is the steps done | `hub/stores/open.e2e.ts` | pass |
| STO-50 | the screen opens on Open and offers Unacknowledged, Acknowledged, Resolved and All | `hub/stores/exceptions.e2e.ts` | pass |
| STO-51 | with nothing open the list says every store is on time | `hub/stores/exceptions.e2e.ts` | skip |
| STO-52 | Resolved lists the resolved ones with their kind pill, the store and the resolved date | `hub/stores/exceptions.e2e.ts` | skip |
| STO-53 | the store picker narrows the list to one store and puts it in the address | `hub/stores/exceptions.e2e.ts` | pass |
| STO-54 | a kind chip filters by kind and a second tap clears it | `hub/stores/exceptions.e2e.ts` | pass |
| STO-55 | an open exception can be acknowledged with a note and then reads Acknowledged | `hub/stores/exceptions.e2e.ts` | skip |
| STO-56 | Thresholds is an Admin-only button in the header | `hub/stores/exceptions.e2e.ts` | pass |
| STO-57 | phone: state is the dock status, the store and kind live in the Filters sheet | `hub/stores/exceptions.e2e.ts` | pass |
| STO-60 | the Actions menu lists the server actions; Update server is disabled with its reason | `hub/stores/exceptions.e2e.ts` | pass |
| STO-61 | a dangerous action asks first; Cancel sends nothing | `hub/stores/exceptions.e2e.ts` | pass |
| STO-62 | a plain action goes straight to the node and lands in the Activity tab | `hub/stores/exceptions.e2e.ts` | pass |
| STO-63 | a store with no server has every action disabled with the reason "no server yet" | `hub/stores/exceptions.e2e.ts` | pass |
| STO-70 | the Server tab shows the machine and the verification number, and Reject sends the store back to Not installed | `hub/stores/open.e2e.ts` | pass |
| STO-71 | the claim is also a card on System › Store Servers › Register, with Refuse | `hub/stores/open.e2e.ts` | pass |
| STO-72 | a code that was never issued is not claimable | `hub/stores/open.e2e.ts` | pass |

## System (store servers, users, devices, notifications, activity)

| ID | Branch | File | Last run |
|---|---|---|---|
| SYS-01 | the System menu lists Users, Store Servers, Devices, Notifications, Activity, Sync and Account | `hub/stores/system.e2e.ts` | pass |
| SYS-02 | Servers: totals, and a row for the DC and for store 01 with their uptime | `hub/stores/system.e2e.ts` | pass |
| SYS-03 | a server row opens its sheet with when it was last checked | `hub/stores/system.e2e.ts` | pass |
| SYS-04 | the five tabs each open without an error | `hub/stores/system.e2e.ts` | pass |
| SYS-05 | Register lists the nodes and offers Register by key | `hub/stores/system.e2e.ts` | pass |
| SYS-06 | Incidents: the filter, and "No incidents recorded yet" or the table of them | `hub/stores/system.e2e.ts` | pass |
| SYS-07 | Install server needs a site; the code and the install steps come back for a site that has no server | `hub/stores/system.e2e.ts` | pass |
| SYS-08 | phone: Install server is the round button and the tabs stay | `hub/stores/system.e2e.ts` | pass |
| SYS-09 | an operations login is refused the System module | `hub/stores/system.e2e.ts` | pass |
| SYS-20 | the list shows every account with person, job role, state and dates | `hub/stores/system.e2e.ts` | pass |
| SYS-21 | a person row opens their account sheet | `hub/stores/system.e2e.ts` | pass |
| SYS-22 | Add user directly: Submit is disabled until everything is given, then the new login works | `hub/stores/system.e2e.ts` | pass |
| SYS-23 | a username that is taken is refused with a sentence | `hub/stores/system.e2e.ts` | pass |
| SYS-24 | Invite people opens the invitation form (name, role, unit, position) | `hub/stores/system.e2e.ts` | pass |
| SYS-25 | the filters narrow by store and by job role | `hub/stores/system.e2e.ts` | pass |
| SYS-26 | a store manager cannot open Users | `hub/stores/system.e2e.ts` | pass |
| SYS-27 | an invitation for a named person comes back as a link shown once, valid 72 hours | `hub/stores/system.e2e.ts` | pass |
| SYS-30 | Block sign-in locks the account out at once and Allow sign-in again lets it back | `hub/stores/system.e2e.ts` | pass |
| SYS-31 | Set password needs a password; the new one signs in and the old one no longer does | `hub/stores/system.e2e.ts` | pass |
| SYS-32 | the account sheet shows who they belong to, and Job role Submit waits for a change | `hub/stores/system.e2e.ts` | pass |
| SYS-40 | Devices has two books, Devices and Readers; Register reader needs the fields | `hub/stores/system.e2e.ts` | pass |
| SYS-41 | Devices lists what store-01 reports, or says the register is empty | `hub/stores/system.e2e.ts` | pass |
| SYS-42 | Notifications: Unread narrows the list and Mark read on a row marks that notification read | `hub/stores/system.e2e.ts` | pass |
| SYS-43 | Activity: Everything and Refused are two books; each opens without error | `hub/stores/system.e2e.ts` | pass |
| SYS-44 | an action taken through the API shows in Activity afterwards | `hub/stores/system.e2e.ts` | pass |

## Setup (wizard and the setup card)

| ID | Branch | File | Last run |
|---|---|---|---|
| SET-01 | the business is finished: the wizard does not take over the app | `hub/setup/setup.e2e.ts` | pass |
| SET-02 | the setup card counts the tasks done and lists every one with its own words | `hub/setup/setup.e2e.ts` | pass |
| SET-03 | a pending task names how many stores are waiting, from the API | `hub/setup/setup.e2e.ts` | pass |
| SET-04 | "Pair the store servers" goes to the Stores list | `hub/setup/setup.e2e.ts` | pass |
| SET-05 | "Complete store addresses" goes to Sites | `hub/setup/setup.e2e.ts` | pass |
| SET-06 | "Add NPWP" opens the company sheet with the saved name and address | `hub/setup/setup.e2e.ts` | pass |
| SET-07 | the company sheet refuses a short NPWP and a missing legal form, and Cancel saves nothing | `hub/setup/setup.e2e.ts` | pass |
| SET-08 | the company sheet shows how the name will print once a legal form is chosen | `hub/setup/setup.e2e.ts` | pass |
| SET-09 | Hide hides the card for this browser only; the tasks still stand on the server | `hub/setup/setup.e2e.ts` | pass |
| SET-10 | the setup answer lists the 16 stores with their codes and zones | `hub/setup/setup.e2e.ts` | pass |
| SET-11 | saving the company again is refused for a short NPWP by the server too (422) | `hub/setup/setup.e2e.ts` | pass |
| SET-12 | opening books a second time is refused | `hub/setup/setup.e2e.ts` | pass |
| SET-20 | step 1 asks for the name and the head office address before it goes on | `hub/setup/setup.e2e.ts` | skip |
| SET-21 | step 2 opens stores only when every named store has a manager | `hub/setup/setup.e2e.ts` | skip |
| SET-22 | step 3 offers a fresh chart or an upload, and Finish needs the file for an upload | `hub/setup/setup.e2e.ts` | skip |
| SET-23 | "Finish later" returns to the app and the card says setup is not finished | `hub/setup/setup.e2e.ts` | skip |

## GA (overview, assets, repairs, schedule, replacements, supplies, sites, contracts, letters)

| ID | Branch | File | Last run |
|---|---|---|---|
| GA-01 | the overview counts the items it shows and says when the data is as of | `hub/ga/overview.e2e.ts` | pass |
| GA-02 | a new supply request shows under "New supply requests" and its row opens the request | `hub/ga/overview.e2e.ts` | pass |
| GA-03 | each card says what it is for | `hub/ga/overview.e2e.ts` | pass |
| GA-04 | the GA menu holds Overview, Supply Requests, Repairs, Service Schedule, Assets, Contracts, Sites, Suppliers, Letters, Files | `hub/ga/overview.e2e.ts` | pass |
| GA-05 | phone: the overview keeps its cards | `hub/ga/overview.e2e.ts` | pass |
| GA-10 | the register has its type chips, its three books and the nine columns | `hub/ga/assets.e2e.ts` | pass |
| GA-11 | an asset registered through the API is a row with its code, name, place and condition | `hub/ga/assets.e2e.ts` | pass |
| GA-12 | the sheet opens on Detail with the facts and offers Documents, History and Class accounts | `hub/ga/assets.e2e.ts` | pass |
| GA-13 | Register stays disabled until name, code, class, site and date are given | `hub/ga/assets.e2e.ts` | pass |
| GA-14 | registering through the form creates the asset and opens its sheet | `hub/ga/assets.e2e.ts` | pass |
| GA-15 | a duplicate asset code is refused with a sentence, not "database operation failed" (HTTP 500) | `hub/ga/assets.e2e.ts` | **FAIL (bug)** |
| GA-15b | the API answers a duplicate asset code with a 409 conflict, not a 500 | `hub/ga/assets.e2e.ts` | **FAIL (bug)** |
| GA-16 | Move needs a reason, takes the asset to the other site and writes it in History | `hub/ga/assets.e2e.ts` | pass |
| GA-17 | Replace opens a proposal that then appears under Replacements | `hub/ga/assets.e2e.ts` | pass |
| GA-18 | Request disposal needs a reason; a request is then pending a decision | `hub/ga/assets.e2e.ts` | pass |
| GA-19 | the Needs-details book lists nothing of ours; Registered lists the asset | `hub/ga/assets.e2e.ts` | pass |
| GA-20 | a search that matches nothing says there are no assets in this reading | `hub/ga/assets.e2e.ts` | pass |
| GA-21 | phone: the register is cards with a round Register asset button | `hub/ga/assets.e2e.ts` | pass |
| GA-30 | the list shows the request, its KPI strip and the Procurement note | `hub/ga/supplies.e2e.ts` | pass |
| GA-31 | the composer refuses an empty form with a sentence under each missing field | `hub/ga/supplies.e2e.ts` | pass |
| GA-32 | a request made in the composer lands on the list and in the API | `hub/ga/supplies.e2e.ts` | pass |
| GA-33 | Reject asks for a reason and the request ends Rejected with it shown | `hub/ga/supplies.e2e.ts` | pass |
| GA-34 | the stages move forward one at a time; ORDERED needs the PO number | `hub/ga/supplies.e2e.ts` | pass |
| GA-35 | a request that is no longer REQUESTED cannot be rejected | `hub/ga/supplies.e2e.ts` | pass |
| GA-36 | the request sheet reads as facts: item, quantity, category, location, requester | `hub/ga/supplies.e2e.ts` | pass |
| GA-37 | phone: the list is cards and Request supplies is the round button | `hub/ga/supplies.e2e.ts` | pass |
| GA-40 | the book shows its three figures and a repair made through the API | `hub/ga/repairs.e2e.ts` | pass |
| GA-41 | the composer names what is missing: problem, object, location, vendor | `hub/ga/repairs.e2e.ts` | pass |
| GA-42 | a repair on an asset takes the asset's site and class; saved, it opens its sheet | `hub/ga/repairs.e2e.ts` | pass |
| GA-43 | the sheet reads as facts with Details, Cost, Accounts and Documents | `hub/ga/repairs.e2e.ts` | pass |
| GA-44 | four eyes: the person who recorded a repair cannot approve its budget | `hub/ga/repairs.e2e.ts` | pass |
| GA-45 | another person approves the budget with a figure and the sheet shows it | `hub/ga/repairs.e2e.ts` | pass |
| GA-46 | Move stage walks the repair forward and offers Send bill to Finance once it is done | `hub/ga/repairs.e2e.ts` | pass |
| GA-47 | a cancelled repair has nowhere left to move | `hub/ga/repairs.e2e.ts` | pass |
| GA-48 | the API refuses a jump from OPEN straight to COMPLETED and names both stages | `hub/ga/repairs.e2e.ts` | pass |
| GA-49 | phone: the repair book is cards and Record repair is the round button | `hub/ga/repairs.e2e.ts` | pass |
| GA-60 | Tasks and Inspections are two books; a task shows what, where and when | `hub/ga/schedule.e2e.ts` | pass |
| GA-61 | the new-task form names each missing piece | `hub/ga/schedule.e2e.ts` | pass |
| GA-62 | a task made in the form (for a location) is saved with its interval and due date | `hub/ga/schedule.e2e.ts` | pass |
| GA-63 | Record done moves the next due date forward by the interval | `hub/ga/schedule.e2e.ts` | pass |
| GA-64 | an inspection with a finding can carry a repair; the form needs the asset and the finding | `hub/ga/schedule.e2e.ts` | pass |
| GA-65 | an inspection recorded on an asset shows in the Inspections book | `hub/ga/schedule.e2e.ts` | pass |
| GA-66 | the API refuses a task for both an asset and a site, or for neither | `hub/ga/schedule.e2e.ts` | pass |
| GA-67 | phone: the schedule keeps both books behind a switch | `hub/ga/schedule.e2e.ts` | pass |
| GA-70 | a proposed replacement is counted under Proposed and opens its sheet | `hub/ga/schedule.e2e.ts` | pass |
| GA-71 | the Replacements screen is routed but not a sidebar row; Repairs stays lit | `hub/ga/schedule.e2e.ts` | pass |
| GA-80 | Sites lists every place with a count, a type filter and Open store | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-81 | a site opens its hub: Details, Assets, Contracts, Utilities, Repairs, Schedule, Supply requests, Bills | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-82 | Edit details saves address, contact and floor area on a store of ours | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-83 | a floor area with a full stop is refused on the form, not quietly stored as 10x (12.5 became 125) | `hub/ga/sites-contracts-letters.e2e.ts` | **FAIL (bug)** |
| GA-84 | the Open store button here raises the same sheet as Stores | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-85 | phone: sites are cards with Open store as the round button | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-90 | the register shows its four figures and the contract made through the API | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-91 | the contract sheet reads as facts: party, type, location, term, signed, value | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-92 | Archive asks for a reason first, then archives and the sheet says Archived | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-93 | Add contract opens the composer and names what is missing | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-94 | the group chips narrow the register | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-95 | the API refuses an end date before the start date | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-96 | phone: the register is cards with Add contract as the round button | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-100 | Letters has its kinds, the status filter and New letter | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-101 | New letter explains what a draft is and writes a blank one | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-102 | a blank draft opens in the editor and the list counts it as awaiting issue | `hub/ga/sites-contracts-letters.e2e.ts` | pass |
| GA-103 | phone: letters keep the kind switch in the dock | `hub/ga/sites-contracts-letters.e2e.ts` | pass |

## Workplace (discussions, chat, files)

| ID | Branch | File | Last run |
|---|---|---|---|
| WP-01 | the list shows a thread with its title, the filters and the categories rail | `hub/ga/workplace.e2e.ts` | pass |
| WP-02 | a thread opens from the address with its opening post and a reply box | `hub/ga/workplace.e2e.ts` | pass |
| WP-03 | a reply typed in the box is posted and counted | `hub/ga/workplace.e2e.ts` | pass |
| WP-04 | Bookmark toggles the thread into the Bookmarked filter | `hub/ga/workplace.e2e.ts` | pass |
| WP-05 | the search narrows the list to the thread by its title | `hub/ga/workplace.e2e.ts` | pass |
| WP-06 | Open a thread asks what it is about, which one, a title and the opening post | `hub/ga/workplace.e2e.ts` | pass |
| WP-07 | phone: the list is cards, with Open a thread as the round button | `hub/ga/workplace.e2e.ts` | pass |
| WP-08 | a thread rina opened is under Mine | `hub/ga/workplace.e2e.ts` | pass |
| WP-20 | the rooms list shows the room, its filters and the empty detail pane | `hub/ga/workplace.e2e.ts` | pass |
| WP-21 | a room opens by its address and a message sent from the box is stored | `hub/ga/workplace.e2e.ts` | pass |
| WP-22 | a message from the other person raises the room's unread count, opening it clears it | `hub/ga/workplace.e2e.ts` | pass |
| WP-23 | New conversation offers One person or A group, asks who, and Start waits for an answer | `hub/ga/workplace.e2e.ts` | pass |
| WP-24 | the search box finds a person or a message | `hub/ga/workplace.e2e.ts` | pass |
| WP-25 | About this conversation: pinning the room is kept by the server for this person only | `hub/ga/workplace.e2e.ts` | pass |
| WP-26 | Archive takes the room out of the All list until somebody writes in it | `hub/ga/workplace.e2e.ts` | pass |
| WP-40 | Files opens as a library with Grid and List, Add a file and the saved views | `hub/ga/workplace.e2e.ts` | pass |

## Landing (home, executive, reports, the Apps launcher)

| ID | Branch | File | Last run |
|---|---|---|---|
| LND-01 | Home greets by name and shows Trade today, Stock and Commercial with their links | `hub/setup/landing.e2e.ts` | pass |
| LND-02 | "See pools" goes to Inventory and "See the fleet chart" to Reports | `hub/setup/landing.e2e.ts` | pass |
| LND-03 | the brief offers questions to ask the assistant, and the box to type one | `hub/setup/landing.e2e.ts` | pass |
| LND-10 | Overview: its heading and its sections | `hub/setup/landing.e2e.ts` | pass |
| LND-11 | Store Performance: its heading and its sections | `hub/setup/landing.e2e.ts` | pass |
| LND-12 | Stock & Purchasing: its heading and its sections | `hub/setup/landing.e2e.ts` | pass |
| LND-13 | Cash & Profit: its heading and its sections | `hub/setup/landing.e2e.ts` | pass |
| LND-14 | Customers & Promotions: its heading and its sections | `hub/setup/landing.e2e.ts` | pass |
| LND-15 | Team & Assets: its heading and its sections | `hub/setup/landing.e2e.ts` | pass |
| LND-20 | the period switch changes the range line and the address | `hub/setup/landing.e2e.ts` | pass |
| LND-21 | the store picker puts one store into the address and the range line | `hub/setup/landing.e2e.ts` | pass |
| LND-22 | phone: period and store are the dock's two buttons | `hub/setup/landing.e2e.ts` | pass |
| LND-30 | Reports lists what was kept or says nothing is kept, and offers Compose one | `hub/setup/landing.e2e.ts` | pass |
| LND-31 | Compose one hands the question to the assistant panel | `hub/setup/landing.e2e.ts` | pass |
| LND-40 | the launcher greets, lists the departments and ends with the search row | `hub/setup/landing.e2e.ts` | pass |
| LND-41 | the unread banner counts what the API counts and goes to Notifications | `hub/setup/landing.e2e.ts` | pass |
| LND-42 | a department row goes straight to its landing screen | `hub/setup/landing.e2e.ts` | pass |
| LND-43 | the waiting counts are whole numbers capped at 99+ | `hub/setup/landing.e2e.ts` | pass |
| LND-44 | System appears only for an administrator: yusuf (operations) has no System row | `hub/setup/landing.e2e.ts` | pass |
| LND-45 | a cashier has no office apps | `hub/setup/landing.e2e.ts` | pass |
| LND-46 | phone: the launcher is one column of rows | `hub/setup/landing.e2e.ts` | pass |

## Bugs found (tests stay red, tagged `bug`)

| Test | What is wrong | Evidence |
|---|---|---|
| STO-12 | The Exceptions card on a store's Overview shows the **fleet's** open count as its pill ("24 open") above the sentence "No open exceptions — this store is on time." | `/stores/store-12`: the pill reads `24 open`; `GET /api/v1/stores/store-12/exceptions?state=open` answers `items: []` but `summary.total: 24` (and `by_unit` lists only store-01). `screens/stores/exceptions-shared.tsx` `ExceptionsCard` reads `summary.total`. |
| GA-15, GA-15b | A second asset with a taken `asset_number` answers **HTTP 500 `database operation failed`**; the Register sheet shows that text. Users answer `409 conflict: username 'rina' already exists` for the same mistake. | `POST /api/v1/ga/assets` twice with the same body: 200, then `500 {"error":"database operation failed"}`. |
| GA-83 | Sites › Edit details › Floor area: typing `12.5` is **stored as 125** (ten times the area); the sentence "Numbers only, no full stops." that the form has for this never appears. | after typing 12.5 in the sheet of `Uji SJ520F4`, `GET /api/v1/ga/locations` has `floor_area_sqm: 125` for it. |

## Findings that are not failing tests

- An operations login opening `/system/servers` by address gets the System frame (tabs, "Install server") and the sentence `forbidden: this action requires the ADMIN role` instead of data; the sidebar and Apps never offer it. SYS-09 asserts exactly that. The backend refuses every read, so nothing leaks.
- The Stores list's search box has no accessible name (`getByRole('textbox')` is the only handle). The GA Overview shows at most ten rows per section, oldest need first (GA-02 works around it).
- The hub hides the Missing kind of exception while `SHOW_MISSING` is off, so the nine resolved `MISSING_OPEN` rows on the rig never show on Stores › Exceptions (STO-52 reads only what the hub shows).
- A new store's invited manager is posted to the unit at once (Team tab lists the invitee), which is why "no one posted" cannot be tested on a fresh store (STO-19 asserts the invitee).
- `Setup` task counts ("26 stores are waiting", "Complete store addresses … 26 stores") include the getting-ready test stores this suite opens.

## Branches with no test, and why

| Branch | Why |
|---|---|
| Wizard steps 1–3, "Finish later" (SET-20…23) | Written, skipped: setup is finished on this rig (`GET /api/v1/setup` → `finished: true`), the wizard mounts only while it is not. `RIG_SETUP_FRESH=1` on a fresh business runs them. |
| Open store 🎉 (success), the checklist turning green | needs an approved, syncing store server plus first stock; no store of ours can get there without a real node. STO-34/35 prove the disabled button, the reason and the 409 refusal. |
| Approve ("The numbers match — approve") on a claimed server, the SYNCING and OFFLINE banners | approving enrols a node and pushes initial data to a machine that does not exist; it would add an offline server to the fleet that every fleet suite reads. STO-70/71 claim a code and **Reject**/Refuse it. |
| Test print, device actions, Time-travel panel | no device is registered at any store but store-01 and its tills belong to the POS suite. |
| Acknowledge an exception (STO-55), the empty "every store is on time" list (STO-51), Resolved rows (STO-52) | state the rig does not hold: the only open exceptions are till cash differences the POS suite reads; resolved ones are Missing, which the hub hides. They run themselves when the rig has the data. |
| Alert settings, Register a reader, Register by key (submit), exception Thresholds (submit) | change fleet-wide settings or add machines other suites watch; their sheets are opened and cancelled (SYS-05, SYS-40, STO-56). |
| Library upload (Add a file), asset Documents upload, letter Issue/Void | need a file on the VM or issue a numbered legal document; Files opens (WP-40). |
| Inspection → repair from a finding, Send bill to Finance, supply Bill (Finance) | cross into Finance's bill register that the Finance suite owns; the buttons are asserted present (GA-46). |
