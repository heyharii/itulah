import { getRouteApi, useNavigate, useSearch } from "@tanstack/react-router"

import type { RecordKind } from "@itulah/contract"

/// Every sheet in the app, named once, and held in the URL.
///
/// A sheet is a thing you look at without leaving the list that produced it,
/// and that is exactly why *which one is open* belongs in the address bar
/// rather than in a `useState` beside the table. A sheet in component state
/// cannot be sent to a colleague, does not survive the reload a shop's browser
/// gets every morning, and cannot be opened by anything that is not a
/// descendant of the component holding it — which rules out the rail, the
/// command palette, and a notification saying "somebody amended a price on
/// PO-1183".
///
/// This is the file `nuqs` would be doing in another codebase; TanStack Router
/// validates search itself, so no second library is needed. It is a central
/// registry rather than a declaration per screen because the **root route has
/// to validate all of them at once**: Router merges the validated search of
/// every matched route, so declaring the keys once on the root is what makes
/// them legal on every route below it.
///
/// Adding a sheet is one line here plus a `useSheet("key")` at the call site.

/// An identifier out of a query string, or nothing.
///
/// Shape-checked rather than passed through: the value is handed to a query key
/// and then to the server, and an empty string is not an id — it is a sheet that
/// opens onto a request nobody can answer.
function id(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/// A sheet with nothing to identify: it is either open or it is not.
///
/// `"true"` as well as `true`, because a pasted URL arrives as text and a flag
/// that only understood the boolean would silently ignore the link somebody
/// sent.
function flag(value: unknown): true | undefined {
  return value === true || value === "true" ? true : undefined
}

/// A `YYYY-MM-DD` out of a query string, or nothing.
///
/// Shape-checked like the rest: these reach the server as a date, and a
/// hand-edited URL should not be able to open a screen onto a request that can
/// only answer 400. A day-close report for a malformed date is not a stale
/// answer — it is a different question, badly asked.
function isoDay(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined
}

/// A whole positive number carried as text — a count of buckets, a page size.
function counted(value: unknown): string | undefined {
  return typeof value === "string" && /^[1-9]\d{0,3}$/.test(value)
    ? value
    : undefined
}

/// A shop and a span, as `site~from~to`.
///
/// Shape-checked as one value because it reaches the server as one question. A
/// site id is `store-01` today, so the first segment is deliberately narrow —
/// anything that could carry a `~` would make the parse ambiguous rather than
/// wrong, which is worse.
function cellRef(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]{1,64}~\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined
}

/// Suppliers and their ticked articles, as `supplier:id,id;supplier:id`.
/// What a New allotment walks through after the supplier on screen (`queue`)
/// and before it (`before`). Read back by `screens/allotment/walk.ts`.
function supplierWalk(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 20000 &&
    /^[A-Za-z0-9_.-]{1,64}:[A-Za-z0-9_.:-]{1,64}(,[A-Za-z0-9_.:-]{1,64})*(;[A-Za-z0-9_.-]{1,64}:[A-Za-z0-9_.:-]{1,64}(,[A-Za-z0-9_.:-]{1,64})*)*$/.test(
      value
    )
    ? value
    : undefined
}

/// One of a fixed set. Anything else is dropped rather than passed on: the
/// value reaches the server as a grouping, and `?bucket=fortnight` is a 400
/// dressed up as a link.
function oneOf<const T extends readonly string[]>(allowed: T) {
  return (value: unknown): T[number] | undefined =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : undefined
}

/// The filter bar's clauses, as one string.
///
/// Shape-checked and length-capped here; the clauses themselves are parsed by
/// `decodeFilters`, which drops anything it does not understand and anything
/// naming a column the screen does not have. Two stages rather than one because
/// this file cannot know which columns a screen draws, and a validator that
/// guessed would either reject legal links or wave through nonsense.
function clauses(value: unknown): string | undefined {
  return typeof value === "string" &&
    value !== "" &&
    value.length <= 2048 &&
    // A control character in a query parameter is not a filter, it is somebody
    // probing the parser.
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(value)
    ? value
    : undefined
}

/// The key is the query parameter, so it is also what somebody reads in the
/// address bar — `?order=` and not `?purchaseOrderId=`.
///
/// Not everything here opens a sheet. `bucket`, `span` and `date` are a
/// screen's own controls, and they live in the URL for the same reason a sheet
/// does: a report is something you send somebody, and the window it was read
/// over is half of what you are sending.
export const SHEET_PARAMS = {
  /// How a browsable list is ordered. In the URL because an order is half of
  /// what somebody is looking at — "the newest ones" is a link worth sending.
  sort: oneOf(["newest", "price_low", "price_high"] as const),
  /// The article master has a server-side oldest-first order beside its
  /// default newest-first order. Kept separate from `sort`, whose values serve
  /// sourcing and other lists with different order vocabularies.
  articleOrder: oneOf(["newest", "oldest"] as const),
  /// What was typed into a search box, when that box filters a whole screen
  /// rather than a card. In the URL so a filtered catalogue can be sent to a
  /// colleague and survives the back button — the two things a `useState`
  /// search box cannot do.
  q: id,
  /// What the filter bar is narrowing by, as `column:operator:value~…`. In the
  /// URL for the same reasons `q` is, and one more: a filtered list is the
  /// unit of work people hand each other — "the items with no barcode" is a
  /// job, and it should be a link.
  f: clauses,
  /// The second bar, for the two screens that draw two filterable tables at
  /// once. Never used alone.
  f2: clauses,
  /// Whether the filter PANEL is standing — the controls, not the clauses.
  ///
  /// Deliberately a second key beside `f` and not a flag folded into it: `f`
  /// is what the list is narrowed BY and this is where the controls for
  /// changing it happen to be, and one parameter meaning both would make
  /// "open the panel" and "narrow the list" the same navigation. They are not:
  /// a link to a narrowed list should arrive narrowed with the panel shut, and
  /// a colleague handed a half-built question should arrive with it open.
  ///
  /// A flag, because there is one panel per screen and nothing to identify it
  /// by. In the URL rather than in a `useState` for the reason everything else
  /// in this file is: on a monitor the panel is a COLUMN the list has given
  /// width to, and a reload that silently gave that width back would re-lay
  /// every table on the screen. See `ui/filter-panel`.
  filters: flag,
  /// Whether the FIELD PICKER is standing — which questions the filter panel
  /// puts, not what the list is narrowed by and not whether the panel is open.
  /// A third key rather than a mode inside `filters`, because it is a third
  /// thing: a link to a half-built question should not arrive in the tick list
  /// of field names.
  fields: flag,
  // procurement
  order: id,
  supplier: id,
  item: id,
  amendment: id,
  /// The basket itself, open over whatever the buyer was doing. A flag rather
  /// than an id: there is one basket, and it is not a record you navigate to —
  /// which is why it is no longer a screen in the menu.
  cart: flag,
  /// Which PO (by its number) the New articles page is narrowed to. Not
  /// `order`, which opens that PO's record sheet.
  setupFor: id,
  /// One article-setup session: the receipt that arrived without an article,
  /// and the variants being declared against it.
  setup: id,
  /// A delivery line waiting to be told what it is. Distinct from `setup`
  /// because they are two moments: this one has no session yet, and opening
  /// one is the whole point of the sheet it names.
  receipt: id,
  basket: flag,
  /// An item being added to the sourcing catalogue, over whatever screen it
  /// was reached from. A flag, because the thing it names does not exist yet.
  "new-item": flag,
  /// A purchase order being written from nothing, over the order book.
  ///
  /// A flag rather than an id, because the thing it names does not exist yet:
  /// there is no order to link to until it is raised. Distinct from `basket`,
  /// which is the same composer reached from the goods rather than from the
  /// paperwork — two ways in, and a URL that says which.
  "new-order": flag,
  /// An issued purchase order being rewritten, by its id. The same composer
  /// as `new-order`, seeded from the order; the server refuses the save once
  /// anything has been received, billed or queried against it.
  "edit-order": id,
  /// Documents being turned into purchase orders, over the same order book.
  ///
  /// A flag for the same reason `new-order` is one: the drafts exist only in
  /// the browser until somebody presses Create, so there is nothing yet to
  /// link to. What the URL buys is the reload — a buyer halfway through a
  /// morning of supplier PDFs keeps the sheet they were in.
  import: flag,
  // articles
  /// One master article, keyed by its eight-digit code rather than a uuid.
  /// The code is the identifier every other system already speaks — it is on
  /// the label, in the SKU and in the supplier's own paperwork — so a link to
  /// an article is a thing somebody can type from a garment in their hand.
  article: id,
  // inventory
  pool: id,
  /// The allotments drawing on one pool, keyed by that pool. A different
  /// question from `allotment`, which is one instruction: this is "what has
  /// been promised out of this shelf", asked from the shelf rather than from
  /// the paperwork, and it is the answer behind the Allotted column.
  "pool-allotments": id,
  /// The sightings in one pool. Evidence, not movements — reading a tag never
  /// moves it — so this is deliberately not the same sheet as `movement`.
  "pool-sightings": id,
  /// The ledger movements in and out of one pool.
  "pool-movements": id,
  allotment: id,
  /// A new allotment started from an old one, as `topup~<id>` or
  /// `reallot~<id>`. Not a sheet: it narrows New allotment to the same items
  /// and stores (Top up) or to what was just cancelled (Cancel and re-allot).
  /// In the URL so the page survives a reload and the note keeps its number.
  allotFrom: (value: unknown): string | undefined =>
    typeof value === "string" &&
    /^(topup|reallot)~[A-Za-z0-9-]{1,64}$/.test(value)
      ? value
      : undefined,
  /// The articles a New allotment is made of, as comma-joined article ids,
  /// with `supplier` saying whose they are. With them the page is the grid;
  /// without them it is the list they are picked from.
  articles: (value: unknown): string | undefined =>
    typeof value === "string" &&
    value.length <= 20000 &&
    /^[A-Za-z0-9_.:-]{1,64}(,[A-Za-z0-9_.:-]{1,64})*$/.test(value)
      ? value
      : undefined,
  /// The suppliers whose ticked articles New allotment walks through AFTER
  /// the one on screen, in the list's order. One key with the print queue
  /// below: that one is the flag `true`, this one is always a walk.
  queue: (value: unknown): true | string | undefined =>
    flag(value) ?? supplierWalk(value),
  /// The suppliers already walked past, so Previous and Back still have them.
  before: supplierWalk,
  count: id,
  /// Which reading of the count book is on screen. A fixed set, because it
  /// reaches the node as `?status=` and the lifecycle has exactly four states
  /// — plus the empty string, which is "all of them" and is what `close()`
  /// leaves behind.
  ///
  /// Its own key rather than `status`, which nothing else claims but which
  /// four other screens would want to mean their own lifecycle: two screens
  /// sharing one parameter means arriving from one with the other's value in
  /// the URL, and a count book showing nothing because somebody had been
  /// looking at retired suppliers is a list nobody can explain.
  "count-status": oneOf(["DRAFT", "ACTIVE", "REVIEW", "CLOSED"] as const),
  movement: id,
  // finance
  entry: id,
  account: id,
  bill: id,
  /// One supplier payment, and what it settled.
  payment: id,
  asset: id,
  /// Which reading of the asset register is on screen: one of the build views
  /// (Property, Vehicles …) or one of the two groups that are not plant
  /// (Software, Projects). The values are `BUILD_VIEWS` in `lib/builds.ts`,
  /// which is typed against this list so the two cannot disagree.
  ///
  /// A chip on the one Assets row rather than nine routes of their own
  /// (owner, 2026-09-27): the register is one place, and a reading of it is
  /// a link somebody sends, not a destination the sidebar should list.
  "asset-view": oneOf([
    "property",
    "technical",
    "vehicles",
    "ffe",
    "it",
    "audio",
    "oe",
    "software",
    "projects",
  ] as const),
  /// One contract: the deal behind the bills — the rent, the PLN account, the
  /// cleaning service. A record people send each other ("look at what the
  /// C007 unit is costing us"), and the Overview's expiring rows open it
  /// directly, so it lives here like every other record's key.
  contract: id,
  /// Which group of contracts the register is narrowed to — the wire's
  /// `group_code`. Six sidebar rows until 2026-09-27, when the owner asked
  /// for a shorter menu: they were one table read through six doors, so they
  /// are six chips over the one Contracts row now. Absent means every group.
  "contract-group": oneOf([
    "SEWA",
    "JASA",
    "ASURANSI",
    "IZIN",
    "LANGGANAN",
    "DISEWAKAN",
  ] as const),
  /// One repair — a breakdown someone filed, with its estimate, budget and
  /// stage. Its own key rather than a second meaning for `asset`, which names
  /// the register's record: a repair is worked in the Perbaikan screen, and
  /// the Overview's open-repair rows and the asset hub both send people here.
  repair: id,
  /// One replacement — the swap of one asset for another, proposed from the
  /// asset hub and worked to INSTALLED in Maintenance › Replacement. The
  /// sheet it opens reads both ends, so a link to it is the whole story.
  replacement: id,
  /// One disposal request — GA's half of taking an asset out of service. The
  /// request is filed from the asset hub; Finance's posting of the gain or
  /// loss is tahap 6, and until then this sheet is where the request is read
  /// and decided.
  disposal: id,
  /// One place GA looks after, keyed by the site id the books already use.
  ///
  /// A place rather than a GA record of its own (brief §2.5): the site table
  /// is the company's list of locations, and this sheet adds the facilities
  /// detail beside it and reads everything that points back at it. Keyed by
  /// `site_id` because that is the word every other row already carries — a
  /// link to a location is a link to a shop somebody can type from a shelf.
  location: id,
  /// Stores being opened, over Lokasi. A flag like `new-order`: the stores do
  /// not exist until somebody presses Buka toko, so there is nothing to key
  /// it by — what the URL buys is a reload that keeps the sheet open.
  "new-stores": flag,
  /// The company's own description — name, legal form, head-office address,
  /// NPWP — over the home screen. A flag: there is one company.
  company: flag,
  /// The fleet's alert thresholds, quiet hours, escalation and who is told —
  /// over the Incidents tab of Store servers (`screens/system/fleet-incidents.tsx`).
  /// A flag: there is one settings object.
  "fleet-alert-settings": flag,
  /// One supply request — what a place asked for, and how far it has got.
  /// Filed from the Supplies list and opened by the Overview's own rows, so
  /// the address is a thing people send each other.
  supply: id,
  /// "2026-09" — the fiscal month whose close panel is open. A period is a
  /// record people send each other ("seal 412 entries in 2026-08"), not
  /// transient UI.
  period: id,
  /// One imported bank statement, and the reconcile session over it.
  statement: id,
  /// One charge a shop took where no sale was written. In the URL because a
  /// case is a thing people send each other — "look at this one, store-04 on
  /// Tuesday" — while somebody is on the phone to the bank about it.
  charge: id,
  /// One posting role on the Account links screen — its links, what each site
  /// resolves to, and who changed them.
  mapping: id,
  /// Which master record the Account links screen is narrowed to, as
  /// `SOURCE_TYPE:source_id` — `EXPENSE_CATEGORY:MEDICAL`,
  /// `PARTY:SUPPLIER:SUP-0012`. Split at the first colon only, because a party's
  /// own id carries one. Set by every master screen's "Link accounts".
  linkSource: id,
  /// A journal template to start a new entry from, by template id. Journal
  /// Entries opens its composer prefilled from it.
  journalTemplate: id,
  // commercial
  book: id,
  price: id,
  /// Which kind of event the price History is narrowed to. Its own key: it
  /// borrowed packing's `slice`, whose validator drops these words, so the
  /// History tabs never narrowed anything.
  "log-kind": oneOf(["PUBLISHED", "ACTIVATED", "TROUBLE"] as const),
  /// One shop's whole shelf, opened from its column on the pricelist.
  ///
  /// UI-001 §4's first drill-down: the matrix answers "is this style priced
  /// the same everywhere" and this answers the other half — "what is THIS shop
  /// charging, for everything". Keyed by `site_id` rather than by origin,
  /// because the column heading is a place and the reader is asking about a
  /// place; the origin is a machine standing in it.
  ///
  /// Its own key rather than a second meaning for `price`, which names one
  /// CELL — a style at a shop. A link to a shop and a link to a square are two
  /// different things to send somebody, and one parameter carrying both would
  /// open whichever sheet happened to read it first.
  shop: id,
  /// The two halves of a price history: which product, and where.
  ///
  /// Both in the URL because a history is a question about ONE product at ONE
  /// shop — the endpoint refuses to answer it any other way — and the answer is
  /// a thing people send each other: "look at what Medan has been charging for
  /// this shirt since August" is a link, not a sequence of clicks to describe
  /// over the telephone.
  ///
  /// `sku` rather than `article`: the history is per PRODUCT, because two sizes
  /// of one style can have moved at different times, and a style-level history
  /// would have to pick one of them or average them. `site` rather than `shop`:
  /// the shelf sheet already owns `shop`, and arriving at History with a shelf
  /// still open in the address bar should not silently pick that shop.
  sku: id,
  site: id,
  /// Which member a points ledger is narrowed to.
  ///
  /// Its own key rather than `member`, because it is not a sheet: nothing opens
  /// over the page: the whole list narrows. And in the URL because "why does
  /// Dian have 4.000 points" is a question somebody hands to somebody else.
  customer: id,
  /// The composer that pushes a new price to the fleet.
  ///
  /// A flag rather than an id, like `new-order`: the thing it names does not
  /// exist yet and never will as a record — a price is not amended in this
  /// system, it is superseded, so what this opens onto is a *book being
  /// written* rather than a price being edited.
  "new-price": flag,
  /// Also narrows Promotions to one campaign's rules, and preselects it in the
  /// promotion form — the Campaign screen links to both.
  campaign: id,
  rule: id,
  /// The promotion form, open. A flag like `new-price`; `1` is accepted too,
  /// because that is how the Campaign screen writes the link.
  "new-rule": (value: unknown): true | undefined =>
    flag(value) ?? (value === 1 || value === "1" ? true : undefined),
  /// One voucher, keyed by the code printed on the card rather than by its
  /// uuid. The code is what exists outside this system — somebody reads it out
  /// over a telephone — so a link to a voucher is a thing that can be typed
  /// from the card in your hand.
  voucher: id,
  /// One style across every shop, opened from its name on the pricelist.
  ///
  /// Shares the `article` key with the master directory deliberately: both
  /// name the same record by the same code, so arriving at one from a link
  /// written on the other opens the right style rather than nothing. What each
  /// screen SHOWS of it differs — the master shows what the garment is, this
  /// shows what it costs — and that is a property of the screen, not of the
  /// identifier.
  // members
  /// Which segment the directory is narrowed to. In the URL because a segment
  /// is the unit of work people hand each other: "the lapsing members" is a
  /// job, and it should be a link.
  segment: oneOf([
    "NEW",
    "ACTIVE",
    "LAPSING",
    "LAPSED",
    "NEVER",
    "BLOCKED",
  ] as const),
  /// Which *saved* segment the directory is narrowed to. A separate key from
  /// `segment` above, and not a seventh value of it: the six are derived and
  /// their names are a closed set this file can check, while a saved one is an
  /// id the server resolves to a definition. Folding them into one parameter
  /// would mean a screen could no longer tell which kind it was showing — and
  /// they do not narrow the same way.
  segmentId: id,
  /// Which saved segment is open for editing. `true` writes a new one.
  segmentEdit: id,
  /// The customer numbers a till named on a sale that no card was enrolled
  /// for. A flag: it is a whole population rather than one record, and there
  /// is nothing to identify it by.
  strays: flag,
  /// The counter's sheet: enrol a card, and activate it.
  ///
  /// A flag rather than an id, like `cart`, because the card being enrolled
  /// does not exist yet and has nothing to name it by. It carries a value in
  /// one direction only — once a card IS enrolled the sheet keeps working on
  /// it in component state, deliberately, because the next thing that happens
  /// is six digits being read aloud and a URL is the last place those should
  /// be able to reach.
  enrol: flag,
  // people
  employee: id,
  /// The Add employee form — a flag: there is nothing to identify until the
  /// record exists, and then it is the `employee` sheet that opens.
  addEmployee: flag,
  /// The Import & export sheet on Employees — a flag.
  importExport: flag,
  /// The invite-people composer — a flag, like `company` above: there is
  /// nothing to identify until the links come back, and those are shown once
  /// and never reopened by a URL.
  invite: flag,
  /// One invitation on the Invitations list.
  invitation: id,
  /// Which request in the queue is open. A request id, not an employee id: one
  /// person can have two waiting on the same desk, and the thing being decided
  /// is the request rather than the person.
  request: id,
  /// Which overtime order is open. Not `order`, which procurement's purchase
  /// orders already claim — one key cannot mean two records, and the screen
  /// that lost the argument would open somebody else's sheet.
  overtimeOrder: id,
  /// Which payroll run is open. Not `run`, which the print bench already
  /// claims — one key cannot mean two records, and the screen that lost the
  /// argument would open somebody else's sheet.
  payrollRun: id,
  /// Whose bukti potong 1721-A1 is open on Reports › Tax, by employee id.
  /// The year is the tab's own choice beside it.
  taxSlip: id,
  /// Which expense claim is open, by claim id. A claim is decided, paid and
  /// read from three places — the queue, the list, the Directory's Claims
  /// tab — and the record does not change when the way in does, so one key
  /// serves all three.
  claim: id,
  /// Which request for a new employee is open. Not `hire`: the record is a
  /// *proposal*, and approving one does not hire anybody — the employment
  /// record is opened afterwards and starts as a candidate.
  hireProposal: id,
  /// Which pipeline applicant is open. A stage move, an interview and an
  /// offer all act on one candidate, so the candidate is what the URL names.
  applicant: id,
  /// Which grievance is open, by grievance id. The queue, the lists and the
  /// filer's own view all open the same sheet — the confidential channel's
  /// one record does not change when the way in does.
  grievance: id,
  /// Which exit interview is open. One per leaver, so the id is the person's
  /// as much as the interview's — but the interview is the record, and the
  /// sheet carries it.
  exitInterview: id,
  /// Which full & final statement is open, by statement id. The list, the
  /// leaver's Directory tab and a settlement link all name the same sheet.
  fnf: id,
  /// Whose attendance is open, as an employee id. A day on its own cannot be
  /// the key: the screen shows one person across a range, and which day the
  /// reader cares about is a scroll position rather than a record.
  attendanceOf: id,
  /// Which punch station is open. `terminal` rather than `station`, matching
  /// `attendance_terminal` and the `att://` device contract.
  terminal: id,
  // storeops
  sale: id,
  /// A site id. Analytics reuses this rather than adding `shop`: two names for
  /// one site id is exactly the drift this registry exists to prevent.
  store: id,
  /// The sale-return record. Named `refund` because `return` is a reserved word
  /// and `?return=` reads like a redirect parameter.
  refund: id,
  /// Whose history is being read. There is no customer search endpoint, so the
  /// member id is typed in — without a key that screen cannot be linked to or
  /// reloaded at all.
  member: id,
  // workplace
  /// Grid or list, on the screens that offer both. In the URL rather than in
  /// component state for the same reason `sort` is: how somebody is looking at
  /// a drawer is half of what they are looking at, it should survive the reload
  /// a shop's browser gets every morning, and "the grid" is a link worth
  /// sending. Anything but these two words is dropped.
  view: oneOf(["grid", "list"] as const),
  thread: id,
  /// The record a Discussions board is narrowed to — its kind and its id. A
  /// record sheet that says "3 discussions" links here, so the board opens on
  /// exactly those three, and the link survives being sent to somebody.
  about: id,
  aboutId: id,
  /// Which letter is open. Not a sheet — a letter takes the whole screen,
  /// because it is a document somebody reads to the end and prints — but it
  /// belongs in this registry for the reason `report` does: a letter with a
  /// number on it is the thing colleagues send each other links to.
  letter: id,
  /// One filed document, with its evidence.
  document: id,
  conversation: id,
  file: id,
  /// Which kept report is open. Not a sheet — it takes the whole screen —
  /// but it belongs in this registry for the same reason `q` and `f` do: it
  /// is state that has to survive a reload and travel in a link. A report
  /// whose URL cannot be pasted into a message is a report somebody
  /// screenshots instead.
  report: id,
  /// Which assistant conversation is open. Not a sheet either, and here for
  /// exactly the reason `report` is: a chat that cannot be linked to is a chat
  /// somebody starts again from the beginning. It is also what makes the ⌘J
  /// panel and the full page the same conversation — the panel's "open in
  /// full" is a link that carries this, and nothing else has to be kept in
  /// step. Distinct from `conversation`, which is a thread between two people
  /// in Workplace.
  chat: id,
  // analytics — a report's window, which is half of what a shared report says
  bucket: oneOf(["day", "week", "month"] as const),
  span: counted,
  date: isoDay,
  /// What the figures are measured against, and the span when that is one
  /// somebody named. Three keys because "the previous period" is derived and
  /// takes no dates, while "last Ramadan" is two dates and cannot be derived
  /// from anything — Ramadan moves about eleven days earlier every Gregorian
  /// year. `cmpFrom`/`cmpTo` are read only under `cmp=custom`; a half-filled
  /// pair falls back to the previous period rather than opening the screen onto
  /// a comparison against nothing.
  cmp: oneOf(["prev", "year", "custom"] as const),
  cmpFrom: isoDay,
  cmpTo: isoDay,
  /// Which stretch the executive report reads: this month so far, the last
  /// whole month, this quarter so far, or this year so far. Named rather than
  /// two dates because a board reads a report by the period it is FOR, and
  /// "this month" pasted tomorrow should still mean this month.
  term: oneOf(["month", "last-month", "quarter", "year"] as const),
  /// One cell of the sales matrix, as `site~from~to`.
  ///
  /// One parameter carrying three things because they are one thing: a cell is
  /// a shop AND the span its figure covers. Deliberately not `store` plus two
  /// dates — `store` is the shop the whole screen is narrowed to, and a reader
  /// looking at the whole fleet still opens one shop's week.
  cell: cellRef,
  // ── Operations ───────────────────────────────────────────────────────────
  //
  // A station is a session, and that is why these are here rather than in
  // component state. A picker opens a round, walks the aisles, and the
  // handheld sleeps in their hand. A packer opens a box against a target and
  // carries it to the RFID arch. If "which session is open" lived in
  // `useState`, coming back would mean a fresh screen with an open session on
  // the node that nothing on the device points at any more — and the second
  // round they open is the paperwork saying they picked twice.
  //
  /// The order being counted on the bay, by PO number. Named `delivery` and
  /// not `receipt`: this registry already has a `receipt`, which is a *line*
  /// waiting to be told what it is over in Articles. Two meanings under one
  /// query parameter is a link that opens the wrong sheet in the wrong module.
  ///
  /// It carries an order rather than a delivery document because nobody opens
  /// a document by hand any more — Receiving opens one underneath the first
  /// count. What a person points at is the order.
  delivery: id,
  /// The order whose counts are being verified, by PO number. Named for the
  /// decision rather than for the document, so it does not collide with
  /// `count` — the official stock count, which is a different thing entirely.
  verify: id,
  /// The purchase-order line a checker is counting against.
  line: id,
  /// The tagging job being read: its variants, and the confirmation that the
  /// labels are physically on.
  job: id,
  /// The delivery being received, inspected or read back — a store's return
  /// on its way through Intake. One key for all three because a person opens
  /// exactly one at a time and the URL says which delivery, not which stage
  /// of it they are looking at.
  inbound: id,
  /// **The print queue.** A dialog rather than a screen, and it answers "what
  /// is left on this bench" — every article still waiting and how far its run
  /// has got. In the URL like every other overlay, so the bench somebody
  /// walked away from is a link rather than a state their tab happened to be
  /// in. Declared with `articles` above, where it doubles as New allotment's
  /// walk of suppliers.

  /// **The label.** Which job's tag is on screen: the drawing, the ZPL under
  /// it, the stock it is drawn on, and the button that sends it. A different
  /// question from `queue` — somebody who pressed Print on a row has already
  /// chosen the article, and showing them a list is asking again. Separate
  /// from `job` too: one is a record being read, the other is a machine being
  /// driven, and a person can want the second without the first.
  print: id,
  /// The print run. Held in the URL for the same reason as a session: a run is
  /// resumed at a different bench as often as it is finished at the first one.
  run: id,
  /// The printer settings panel — a fact about the bench, not about a record.
  printer: flag,
  /// **One picklist**, read back: what came off the racks in that round.
  ///
  /// It used to mean the round somebody had OPEN — a handheld that slept
  /// mid-pick came back to it. A picklist is composed and closed in one act
  /// now, so there is no such thing as a round in progress, and the key names
  /// the record instead of the session.
  pick: id,
  /// One picklist NOT yet accepted — an allotment × shop pairing with no id
  /// of its own until accepting it mints a session, so the key is
  /// `"<allotment_id>~<destination_id>"` rather than a record id.
  accept: id,
  /// The rack stock is being taken off. A choice, not a record — but it is
  /// what every pick on the screen is written against, so it survives a reload
  /// with the round it belongs to.
  rack: id,
  /// Packing's pack sheet for one shop, keyed by the shop's own id — a shop
  /// gathers several picklists (one per allotment) into its cartons, so the
  /// sheet is not any one picklist's. Picking's own "Pack" button opens it
  /// directly for the shop a picklist it just read belongs to.
  pack: id,
  /// One carton, and its manifest.
  koli: id,
  /// The consignment note.
  shipment: id,
  /// The loading manifest for one truck run.
  dispatch: id,
  /// **The four composers**, each over the list it is raised from.
  ///
  /// Flags rather than ids, like `new-order` and `new-price`: the thing each
  /// one names does not exist yet and has nothing to identify it by. In the
  /// URL all the same, because a composer somebody walked away from mid-shift
  /// is a link rather than a state their tab happened to be in.
  "new-pick": flag,
  "new-pack": flag,
  "new-shipment": flag,
  "new-dispatch": flag,
  /// Which slice of a carton list is being read. A fixed set, because it
  /// reaches the node as `?ready=true` / `?unassigned=true` and nothing else is
  /// answerable.
  slice: oneOf(["all", "unassigned", "open"] as const),
  /// How far back the ledger is read. Its own key rather than a second meaning
  /// for `slice`: two screens sharing one parameter means arriving from one
  /// with the other's value in the URL, and a ledger that quietly showed 250
  /// rows because somebody had been looking at open cartons is a number nobody
  /// can explain. The node caps at 500, so the set stops there.
  depth: oneOf(["100", "250", "500"] as const),

  // store exceptions (28 Sep 2026): the Stores › Exceptions list's own
  // filters, kept in the URL for the reason `segment` is — "the open
  // exceptions at C014" is a link a store's own manager sends to head
  // office, not a state their tab happened to be in. The Overview card's
  // "See all" link carries `exceptions-unit` so it lands pre-filtered.
  "exceptions-unit": id,
  "exceptions-kind": oneOf([
    "SHIFT_NOT_CLOSED",
    "CASH_DIFFERENCE",
    "DEPOSIT_MISSING",
    "RECEIVE_OVERDUE",
    "MISSING_OPEN",
    "CHECKOUT_UNRESOLVED",
  ] as const),
  "exceptions-state": oneOf([
    "open",
    "unacknowledged",
    "acknowledged",
    "resolved",
    "all",
  ] as const),
  /// The Admin-only thresholds sheet, over the Exceptions list — a flag like
  /// `fleet-alert-settings`: there is one settings object.
  "exceptions-settings": flag,

  // system
  user: id,
  /// A job role's edit sheet, on the Roles tab of Users & roles.
  role: id,
  origin: id,
  /// A till, printer or reader in the device registry.
  device: id,
  /// One shop server on the Monitoring screen.
  monitor: id,
  notifications: flag,
} as const

export type SheetKey = keyof typeof SHEET_PARAMS

/// Which record kind the audit log files each sheet's subject under.
///
/// The kinds are the server's, not ours: `audit_actions` derives them from the
/// path shape, so `/api/v1/purchase-orders/{id}` files under `purchase_order`
/// and nothing here gets to disagree. Every value below was read back from a
/// running node rather than inferred from the Rust — the singularisation has
/// edge cases ("addresses" → "address") and guessing wrong would show one
/// record's history on another record's sheet.
///
/// A key with no entry is a sheet whose subject the server does not name: the
/// window sheets, the basket, the notification drawer. They get no trail, which
/// is correct — there is no record for one to belong to.
/// Which record each sheet is showing.
///
/// Typed against `RecordKind`, the server's own vocabulary, rather than
/// `string`. That is not tidiness: when it was `string`, two of the entries
/// below were words this server has never had — `user` where the record is
/// `app_user`, and a promotion whose kind did not exist at all — and nothing
/// could say so. They filed their history under a word nothing else used, and
/// the panel on those two sheets could only ever be empty.
const SHEET_SUBJECT: Partial<Record<SheetKey, RecordKind>> = {
  order: "purchase_order",
  supplier: "supplier",
  item: "supplier_item",
  amendment: "purchase_price_amendment",
  setup: "article_setup",
  pool: "pool",
  allotment: "allotment",
  count: "count",
  entry: "journal",
  account: "account",
  bill: "bill",
  asset: "asset",
  contract: "contract",
  // Tahap 4's records. The kinds are spelled by the server's `record_kind`
  // (migration: the five maintenance rows), and like every entry here they
  // were read off the wire vocabulary rather than invented — `repair` and
  // not `repairs`, because the audit path is singular `/api/v1/ga/repairs/{id}`.
  repair: "repair",
  replacement: "replacement",
  disposal: "disposal",
  // Tahap 5's two records. `supply_request` is the spelling the Overview's
  // own `GaAttention` kind uses; a location is filed under `location`, the
  // word the endpoint's path (`/api/v1/ga/locations/{site_id}`) singularises
  // to. Both are new to the server's vocabulary with this stage.
  location: "location",
  supply: "supply_request",
  statement: "bank_statement",
  book: "publication",
  campaign: "campaign",
  rule: "commercial_rule",
  voucher: "voucher",
  employee: "employee",
  sale: "sale",
  refund: "return",
  member: "customer",
  thread: "discussion",
  letter: "letter",
  conversation: "conversation",
  document: "document",
  user: "app_user",
}

export type SheetSearch = {
  [K in SheetKey]?: ReturnType<(typeof SHEET_PARAMS)[K]>
}

/// The root route's `validateSearch`.
///
/// Unknown keys are dropped rather than preserved: a URL is a public surface,
/// and letting arbitrary parameters ride along means a stale link keeps
/// resurrecting state nothing reads any more.
export function validateSheetSearch(raw: Record<string, unknown>): SheetSearch {
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(SHEET_PARAMS)) {
    const value = check(raw[key])
    if (value !== undefined) out[key] = value
  }
  return out as SheetSearch
}

const rootApi = getRouteApi("__root__")

/// Open, read and close one sheet.
///
/// `replace: true` on close so dismissing a sheet does not leave an entry in
/// the history: pressing back after closing should go to the previous *screen*,
/// not reopen what was just dismissed. Opening does push, because arriving at a
/// record is a place you can go back from.
export function useSheet<K extends SheetKey>(key: K) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as SheetSearch
  const value = search[key]

  const kind = SHEET_SUBJECT[key]

  return {
    /// The id in the URL, or `undefined`. Feed it straight to `enabled:`.
    value,
    isOpen: value !== undefined,
    /// Hand straight to `<Sheet subject={…}>` — the record's history, without
    /// each screen restating which kind of record it is showing.
    subject:
      kind !== undefined && typeof value === "string"
        ? { kind, id: value }
        : undefined,
    open: (next: SheetSearch[K] extends true | undefined ? true : string) =>
      navigate({
        // The screen does not change; only which record is being looked at.
        to: ".",
        search: (prev: SheetSearch) => ({ ...prev, [key]: next }),
        // Said here as well as in `routes.tsx`, and not redundantly: the
        // router's `pathChanged` predicate is only consulted by a browser that
        // supports view-transition *types*, and one with view transitions but
        // without them would take the default and fade the screen behind every
        // sheet that opened. A sheet already animates; the page under it is
        // meant to hold still.
        viewTransition: false,
      }),
    /// Swap the value without a history entry.
    ///
    /// What a *session* does when it is closed and the next one opened — the
    /// pick round that just ended is not somewhere `back` should return to,
    /// because going back to it would reopen a round the node has finished.
    /// `open` pushes, because arriving at a record is a place you can return
    /// from; this does not.
    replace: (next: SheetSearch[K] extends true | undefined ? true : string) =>
      navigate({
        to: ".",
        replace: true,
        search: (prev: SheetSearch) => ({ ...prev, [key]: next }),
        viewTransition: false,
      }),
    close: () =>
      navigate({
        to: ".",
        replace: true,
        search: (prev: SheetSearch) => ({ ...prev, [key]: undefined }),
        viewTransition: false,
      }),
    /// Close the sheet under `from` and open this one, in ONE navigation — a
    /// composer giving way to the record it just made. As two calls, `close`
    /// and then `open`, the second started from a URL the first had not
    /// finished writing, and the composer came back.
    swap: (
      from: SheetKey,
      next: SheetSearch[K] extends true | undefined ? true : string
    ) =>
      navigate({
        to: ".",
        replace: true,
        search: (prev: SheetSearch) => ({
          ...prev,
          [from]: undefined,
          [key]: next,
        }),
        viewTransition: false,
      }),
  }
}

export { rootApi }
