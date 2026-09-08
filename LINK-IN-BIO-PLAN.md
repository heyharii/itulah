# The store page — a free, bento-style link in bio for every UMKM

Written 2026-09-06 as a proposal. Nothing in §0 has been decided with the owner
yet; the table is what I would decide, so the discussion can start from a
position instead of a blank page. The question it answers is the one asked:
*a free link in bio with bento.me taste — for restaurants, stores, toko baju,
every UMKM — where the store page alone is free. How?*

Repo facts below (files, crates, services) were checked against the working
tree on 2026-09-06. Market facts come from the sources at the end.

Eight interactive prototypes of §2 and §3 live in
`prototypes/link-in-bio-opsi.html` (six shops in six palettes, the desktop
view, the editor), all drawn by one renderer from one layout shape. Serve
them with the `prototypes-static` entry in `.claude/launch.json`.

---

## 0. Proposed rulings

| Question | Ruling |
|---|---|
| Who it is for | Businesses with a counter: warung, kafe, restoran, toko baju, kelontong, salon, laundry, bengkel, tempat les. **Not creators.** Lynk.id owns creators, and creators want digital-product checkout — a payments business we should not enter by accident. |
| The page's one job | Turn a profile visit into one of five actions: chat on WhatsApp, open the map, order on GoFood/GrabFood/ShopeeFood, browse the menu, pay by QRIS. Every tile type is one of those verbs, or the context for one. |
| What is free | **The page, forever.** One page, every tile type, the editor, a `brand.id/namatoko` URL, a QR code, seven-day counts. Free is limited on *media and extras* (§4), never on whether the page exists or how good it looks. |
| What is paid | Pro, monthly: no footer badge, custom domain, more items and photos, branches, 90-day stats with sources, scheduled promos, spreadsheet import, a print-ready QR card. Behind Pro sits the real upsell: kasir + stok + member — itulah. |
| Managed services | A third layer, "kami yang kerjakan": photos, page upkeep, Instagram content, ads to WhatsApp, channel onboarding (§4a). Sold only to owners whose page is already live; partners do the fieldwork; the page's own stats are the monthly report. |
| Why free is affordable | A published page is one cached HTML document and a handful of photos we compressed. Marginal cost is single-digit rupiah a month per page (§4). What costs money is abuse and support, so both are designed in (§7), not bolted on. |
| Layout | **One list of tiles, four sizes** (1×1, 2×1, 1×2, 2×2). The phone shows it in two columns; desktop reflows the same tiles into four columns beside a large profile, bento's signature two-pane look. The owner never arranges a second layout — that is where bento's editor spent most of its complexity, and our visitors are inside the Instagram browser on a phone. |
| Taste | Enforced by constraint, not by the owner's eye: one typeface, eight palettes, four sizes, photos resized by us, known links styled by us. The owner supplies words and photos and cannot make the page ugly. That constraint *is* the bento product. |
| Rendering | Server-rendered HTML from Rust (`maud`), no framework on the public page, under 1 KB of script. Cached by Cloudflare, purged on publish. Target: first paint under a second on 4G inside an in-app browser. |
| Where it lives | This repo, as a fourth binary `page` beside `cloud`, `dc`, `store` (`backend/Cargo.toml:24-35`) — with **its own Postgres instance and its own migrations directory**. It shares crates and patterns (media, ids, the ts-rs contract), never tables. The POS link is an API integration, not a join. |
| URL shape | Path, not subdomain: `brand.id/namatoko`. The editor lives on `app.brand.id`, a different origin, so nothing on a page can ever reach an editor cookie. Custom domains are Pro. |
| Sign-in | Google, first and only in V1 — free, one tap on every Android. WhatsApp OTP later, for verifying the number shown on the page and for recovery; it costs per message. |
| Payments | **Not in V1.** No checkout, no wallet, no transaction fee. Orders go to WhatsApp; payment is the owner's own static QRIS shown large. Checkout means an aggregator contract, KYC and PSE obligations — decide that with data from live pages. |
| Scope guard | V1 is one developer for five weeks (§8). What is not in the V1 column waits, including everything that sounds small. |

---

## 1. Why now

**Bento is gone.** Linktree bought Bento in 2023 and shut it on 13 February
2026; bento.me links now redirect to Linktree. The tile look people loved is
orphaned. The replacements that appeared (Paage, own.page, tini.bio, Taplink)
are creator tools, priced in dollars, English-first.

**Indonesian tools are lists, not pages.** Lynk.id is creators and digital
products with a reported 5 % transaction fee; Tautanku.id is a Linktree
clone; Qlike.id is a free catalog with a free kasir (the closest thing to our
funnel); QMenu.id is a QR menu whose order lands in WhatsApp; Cataloku is a
paid catalog for cafés. Every one is catalog-first and list-shaped. None is
something a shop owner would screenshot and post.

**A UMKM's channels are fixed and need no API.** WhatsApp (`wa.me`), Google
Maps, GoFood / GrabFood / ShopeeFood, Shopee / Tokopedia / TikTok Shop,
Instagram / TikTok, a static QRIS image. A page that *knows* these — styles
them, orders them, prefills the WhatsApp message with the item — beats a
generic link list on day one, and beats a generic bento clone too.

**We own the hard part of the upsell.** Articles, prices, stock, members,
RFID — the POS behind the page is the thing no tool above has. The page is
the cheapest top of funnel that business will ever get.

---

## 2. The page

### Shape

A profile, then a grid.

- **Profile**: logo or photo (96 px, round), business name, one line of what
  and where ("Bakmi & es kopi · Tebet"), an open/closed pill computed from
  the hours tile. Nothing else above the fold.
- **Grid**: two columns, 12 px gap, 24 px radius, no borders, one soft
  shadow. Tiles are 1×1, 2×1, 1×2 or 2×2. On desktop the grid is 480 px wide
  with the profile in a left column — bento's signature two-pane look,
  without a second layout.
- **Footer**: "Dibuat dengan <brand>" (free) and "Laporkan halaman".
- **Type**: Plus Jakarta Sans — designed by Tokotype for Jakarta's city
  identity, on Google Fonts, self-hosted as one subset variable file. It is
  the only typeface; there is no font picker.
- **Palettes**: eight, each a ground + ink + accent tuned to stay legible;
  the owner picks one. No colour wheel.
- **Known links get their own tile**: WhatsApp, GoFood, GrabFood, ShopeeFood,
  Shopee, Tokopedia, TikTok Shop, Instagram, TikTok, YouTube, Google Maps.
  The owner pastes a URL; we recognise the host and draw the brand tile.
  Unknown hosts get a card with the site's own OG image and title, fetched
  once at save time.

### Tiles

| Tile | Name on the page | What it does | When |
|---|---|---|---|
| WhatsApp | Pesan via WhatsApp | Number + template ("Halo {toko}, saya mau pesan …"). Opens `wa.me` with the message prefilled. The tile everything else exists to feed. | V1 |
| Link | Tautan | Any URL; brand style for known hosts, OG card for the rest. | V1 |
| Location | Lokasi | Address text + Google Maps deep link ("Buka di Maps"). A static map image is V1.1 (Mapbox static, one image cached per page). | V1 |
| Hours | Jam buka | Per-day hours. Renders "Buka sekarang · tutup 21.00" or "Tutup · buka besok 09.00" from a 300-byte script, and feeds the profile pill. | V1 |
| Menu / Catalog | Menu · Katalog · Layanan | Items with photo, name, price, category. 2×2 shows four; tap opens the full list at `/namatoko/menu`; an item opens a sheet with "Pesan ini via WhatsApp", message prefilled with name and price. The label follows business type. | V1 |
| Photo | Foto | One image, cover-fit. | V1 |
| Text | Teks | Heading + short paragraph. Announcements, story, delivery area. | V1 |
| QRIS | QRIS | Owner uploads their static QRIS. Tile shows the QRIS mark; tap opens it full-screen with "Simpan gambar" so the buyer can scan it from their gallery. | V1 |
| Promo | Promo | Title, line, valid-until, optional code. Hides itself after the date (the page cache TTL is short enough, §5). | V1.1 |
| Gallery | Galeri | Up to ten images, swipe. | V1.1 |
| Reviews | Ulasan | Manual rating + count + link to Google reviews. A live rating needs Places API money; not yet. | V1.1 |
| Social | Sosial | Instagram / TikTok / Facebook / YouTube handle tiles. In V1 these are Link tiles with brand style. | V1.1 |
| Branches | Cabang | One tile per branch with its own hours and map. Pro. | V2 |
| Points | Poin member | For itulah customers only: a member's balance through the existing member session. | V2 |

### Templates

Business type is asked once at onboarding and does three things: seeds a
grid, names the catalog tile, and orders tiles by what that business gets
asked most.

| Type | Seed grid (two columns, top to bottom) |
|---|---|
| Restoran · kafe · warung | WhatsApp 2×1 · Menu 2×2 · Lokasi 1×1 · Jam buka 1×1 · GoFood · GrabFood · ShopeeFood 1×1 · QRIS 1×1 · Galeri 2×1 · Instagram 1×1 |
| Toko baju · butik | Katalog 2×2 · WhatsApp 2×1 · Foto koleksi 1×2 · Shopee · Tokopedia · TikTok Shop 1×1 · Lokasi · Jam buka · Instagram · TikTok |
| Kelontong · retail | WhatsApp 2×1 · Lokasi 1×1 · Jam buka 1×1 · Katalog 2×2 · QRIS · GrabMart · GoMart |
| Jasa (salon, laundry, bengkel, les) | WhatsApp "Booking" 2×1 · Layanan 2×2 · Lokasi · Jam buka · Galeri 2×1 · Ulasan 1×1 |

A template is a starting grid, not a mode; every page can add or remove any
tile afterwards.

### Words on the page

Everything the visitor reads is Indonesian and says what happens: "Pesan via
WhatsApp", "Buka di Maps", "Lihat menu", "Tap untuk bayar", "Buka sekarang ·
tutup 21.00". The owner's own content is in whatever language they wrote it.

---

## 3. The editor

The owner edits from a phone. That single fact shapes the editor more than
anything bento did.

- **Same URL, edit bar.** A signed-in owner opens their page and gets an edit
  bar; tap a tile → a bottom sheet with that tile's fields; the change shows
  in the page after a short debounce. The preview is the real render (§5),
  not a React imitation of it — one renderer, no drift.
- **Arrange mode.** Long-press (or the "Susun" button) turns tiles into
  labelled boxes; drag to reorder, tap a box to pick a size (kecil · lebar ·
  tinggi · besar). Done → back to the real render.
- **Add tile.** A sheet of tile types with one-line descriptions, and a
  "Tempel link" field at the top that recognises the host and creates the
  right tile in one step.
- **Catalog.** A list screen: add item (photo, name, price, category,
  available), reorder, hide. Spreadsheet import is Pro.
- **Publish.** Draft and published are separate versions. "Terbitkan"
  renders, stores, purges the CDN. "Lihat halaman" opens the live URL.
- **Onboarding, under three minutes**: nama usaha → jenis usaha → Google
  sign-in → nomor WhatsApp untuk pesanan → link Google Maps (opsional) →
  tambah 3 menu/produk → Terbitkan → *"Halaman kamu: brand.id/namatoko"*
  with Salin link · Unduh QR · Cara pasang di bio Instagram.
- **QR and the counter.** Free: a QR as PNG/SVG. Pro: a print-ready A6 card
  ("Scan untuk lihat menu & pesan") — the page URL lives on the counter, not
  only in a bio. The `qrcode` crate is already a dependency
  (`backend/Cargo.toml:64`).
- **Stats.** Views and clicks per tile, by day. Free shows seven days; Pro
  ninety, split by source (Instagram / TikTok / WhatsApp / QR / direct).

Built as `frontend-page`: Vite + React + TanStack Router, Indonesian, always
light, from the `frontend-customer` kit (`frontend-customer/src/styles/index.css`
carries the Cloud Hub tokens on a phone, and `motion` is already there for
drag and shared-layout). Types come from Rust through `ts-rs` into
`frontend-contract`, as in every other app.

---

## 4. Free forever — the numbers

### What a free page costs us

| Driver | Assumption | Cost |
|---|---|---|
| Photos | 25 per page, resized to 1200 px, ~120 KB each | ~3 MB per page |
| Object storage | R2 at $0.015 / GB-month, egress free | 10 000 pages ≈ 30 GB ≈ $0.45 / month |
| Serving | Cloudflare cache in front; HTML cached, purged on publish | ≈ 0 per page |
| Cache misses + API | one `page` service, the size `cloud` runs today (0.5 CPU / 512 MB, Singapore) | ~$7 / month, flat |
| Database | own Postgres instance; a page is tens of KB of rows | ~$7 / month, flat |
| Sign-in | Google | 0 |
| Domain | a short `.id` | ~Rp 250 000 / year |
| WhatsApp OTP | authentication template, if ever used | ~Rp 400–500 per message — which is why it is not in the free flow |

Fixed: roughly $15–20 a month for the first tens of thousands of pages.
Marginal: single-digit rupiah per page per month. The free page is not the
expensive part of this business; people are — support, abuse review, and
the owner's time.

### What the free limits are for

Limits exist to bound storage and abuse, not to nag.

| | Free | Pro |
|---|---|---|
| Pages | 1 | 3 (branches) |
| Tiles | all types, up to 20 | 40 |
| Catalog items | 30 | 500 |
| Photos | 25 | 300 |
| URL | `brand.id/namatoko` | custom domain too |
| Footer badge | yes | no |
| Stats | 7 days, totals | 90 days, by tile, by source |
| Promo scheduling | manual | timed show/hide |
| Import | — | spreadsheet |
| QR | PNG/SVG | + print card |
| Price | Rp 0 | Rp 39 000 / month or Rp 349 000 / year (proposal, §10) |

### Where the money is — in order

1. **The POS funnel.** A page with a catalog is a business one step from
   wanting stock and a kasir. The page's settings screen carries one card:
   "Mau catat stok dan kasir? Coba itulah." Existing itulah customers get the
   page free with catalog sync. This is the reason the page can be free: it
   is the POS's marketing budget, spent as product instead of ads.
2. **Pro.** Honest expectation: link-in-bio tools convert a low single-digit
   percentage of free users. At 10 000 pages and 3 %, Pro is about
   Rp 12 million a month — it pays the bills above, not a team.
3. **Managed services — "kami yang kerjakan".** The owner asked whether we
   manage the page and do the marketing too. Yes, as a third layer, sold only
   to owners whose page is already live (§4a). Photos, Instagram content, ads
   to WhatsApp, channel onboarding. People-heavy, so partners do the
   fieldwork and the page is the delivery surface.
4. **Later, maybe: order and payment fees.** Only if live pages show buyers
   asking for checkout. It brings an aggregator contract, KYC, PSE and
   refunds; it is a different company.

### 4a. Managed services

Every service below either puts something *on* the page (photos, promos,
hours, channels) or sends people *to* it (content, ads, print). That is the
rule for adding one: if it does neither, it is a different business. The
page's own stats — views and WhatsApp clicks per tile — are the monthly
report for all of them, which is a report no agency can give a warung today.

| Service | What we do | Price (proposal) | Delivered by |
|---|---|---|---|
| Foto + pasang halaman | Half-day shoot, 30 edited photos, page built and published, QR handed over | Rp 450 000 once | Mitra photographer on our checklist |
| Kelola halaman | Menu, price, promo and hours changes on request via WhatsApp, 48-hour turnaround | Rp 149 000 / month | Ops; one person carries ~150 pages |
| Konten Instagram | 8 posts + 4 reels a month from page data (menu, promos, photos), captions in the shop's voice; AI drafts, human edit, owner approves in WhatsApp | Rp 899 000 / month | Content ops + the assistant already in the hub |
| Iklan ke WhatsApp | Meta / TikTok ads landing on the page; conversion = WhatsApp click measured by our beacon; weekly report | 20 % of spend, min Rp 300 000 / month; spend from Rp 1 500 000 | Ads ops |
| Onboarding kanal | Register and set up GoFood, GrabFood, ShopeeFood, Tokopedia, Google Business Profile, QRIS; upload menu and photos | Rp 250 000 per channel | Mitra, checklist-driven |
| WhatsApp Business rapi | Catalog, greeting and away messages, quick replies, labels; later a shared inbox on the WA API (product, not service) | Rp 199 000 once | Ops |
| Cetak | QR tent cards, stickers, A3 menu board, banner with the QR | Rp 150 000 – 600 000 | Print partner |
| Ulasan Google | "Ulas kami" QR at the counter, monthly replies to reviews | Rp 99 000 / month | Ops |
| Kasir + stok | POS device, opening stock count, staff training | itulah pricing | itulah |

Bundles so nobody has to assemble this: **Mulai** (once: foto + pasang + two
channels + cetak, Rp 999 000), **Jalan** (monthly: kelola + ulasan + four
posts, Rp 499 000), **Tumbuh** (monthly: full Instagram content + ads
management, Rp 1 500 000 plus ad spend).

Three rules that keep this from eating the company:

- **Partners do the fieldwork.** Photographers, channel onboarding and
  print are local "Mitra" paid per job from our checklist and rated by the
  owner. Our people do content, ads and the page. Margin on services is
  30–50 % only if the scope is fixed; an unbounded "we manage your marketing"
  retainer has no margin at all.
- **Sell to live pages only.** A service order starts from the page's
  settings screen, after the owner has seen their first WhatsApp clicks. No
  cold selling. The page qualifies the lead and the stats prove the value.
- **Productize what repeats.** Instagram captions from menu data, promo
  templates, review replies — the assistant drafts them, ops edits. Each
  month, the most repeated service task becomes a Pro feature.

Adjacent things the owner will be asked for, and the answer: business
email and domain (yes, inside Pro); simple bookkeeping from POS sales (yes,
but through itulah's finance module, not a service); NIB, PIRT and halal
paperwork (partner referral, a finder's fee, never our own work); lending
referrals (partner revenue, later, and only with a licensed lender).

---

## 5. Architecture

```
Instagram in-app browser
   │  GET brand.id/namatoko
   ▼
Cloudflare (free plan: DNS + CDN, cache rule so HTML is cached, single-URL purge)
   │  miss, or just purged by a publish
   ▼
`page` binary on Render (Singapore) ──── Postgres (page's own instance)
   │  renders maud HTML from the published layout
   │  Cache-Control: public, s-maxage=300, stale-while-revalidate=86400
   └── object storage via `object_store`: photos, OG image, QRIS image

app.brand.id (frontend-page, static site) ──── JSON API on the same `page` binary
```

- **Fourth binary.** `backend/src/bin/page.rs` next to `cloud.rs`, `dc.rs`,
  `store.rs`; module tree `backend/src/page/{domain,http,postgres,render}`
  following the cloud layering. Its own `backend/migrations/page/` and its
  own `sqlx::migrate!`. The shared cloud migration history has already
  killed a dev database once by renumbering; a free consumer product must
  never be able to do that to the POS.
- **Own Postgres instance.** Render gives one database per instance, so
  isolation is a second small instance, not a schema. Worth the $7.
- **Render once, cache everywhere.** The public route renders the
  *published* layout with `maud` (compile-time templates, escaped by
  default) and answers with `Cache-Control: public, max-age=0,
  s-maxage=300, stale-while-revalidate=86400`. Publish purges that page's
  URLs through the Cloudflare API (single-URL purge is on the free plan).
  Five minutes of TTL also handles promo expiry and hours changes without a
  purge.
- **Draft preview** is the same route with a signed draft token, `noindex`,
  `no-store`. The editor shows it in an iframe and reloads it on change.
- **Media** reuses the `object_store` setup in `backend/src/cloud/media.rs`:
  a new prefix `page/<page_id>/<ulid>.jpg`, uploads through the API rather
  than presigned PUT, resized to 1200 px and re-encoded with the pure-Rust
  `image` crate so EXIF and megabytes never reach storage. JPEG in V1; WebP
  when the build has a lossy encoder.
- **OG image** per page (name, tagline, palette) rendered from an SVG with
  `resvg` and stored beside the photos. It is what WhatsApp shows when the
  link is shared, so it is not optional.
- **QR** from the existing `qrcode` crate, SVG and PNG.
- **Hours and promos** are the only client logic: one inline script under
  1 KB with a nonce; CSP forbids everything else. No user-supplied script,
  ever.
- **Stats beacon**: `navigator.sendBeacon('/_/hit', …)` with page and tile
  ids; the binary upserts daily counters (`ON CONFLICT … count + 1`). No
  cookie, no personal data, no consent banner. Bots mostly do not run the
  beacon, which is fine.
- **Link cards**: OG title and image fetched once at save time through an
  SSRF-safe fetcher (https only, public IPs only, 3 s, 2 MB, no redirects
  into private ranges).
- **SEO for free**: `LocalBusiness` JSON-LD with address, hours, phone —
  Google can show "Buka sekarang" for the shop without the owner doing
  anything. A sitemap of published pages.
- **Path routing** means one certificate and one host; reserved slugs
  (`app`, `api`, `admin`, `menu`, `_`, …) are refused in the domain layer.
  Custom domains (Pro) are a host → page lookup on the same route, with
  certificates through Cloudflare for SaaS when the time comes.
- **Stateless service.** Nothing lives in the process but a stats buffer, so
  Render can run two of them the day one is not enough.

---

## 6. Data model

One database, eight tables. The layout is a document, not rows, because a
bento grid is edited and rendered whole and never queried by tile.

| Table | Holds |
|---|---|
| `page_owner` | Google subject, email, display name, phone (unverified until OTP), created_at |
| `page` | owner_id, slug (unique, reserved list enforced), business_type, plan, palette, status, draft_version, published_version, published_at |
| `page_version` | page_id, version, `layout jsonb` (profile + tiles as `{id, type, w, h, order, props}`), rendered_html (nullable cache), created_at. Immutable. |
| `page_item` | page_id, name, price_minor (whole rupiah as an integer — never a float), category, photo_key, available, sort |
| `page_media` | page_id, key, width, height, bytes, created_at — for quota and cleanup |
| `page_stat_day` | page_id, tile_id (null = page view), day, source, count |
| `page_domain` | page_id, host, verified_at, cert_state (Pro) |
| `page_report` | page_id, reason, reporter_ip_hash, created_at, resolved_at, action |

Plan limits live in `domain` as one struct per plan and are checked where the
mutation happens, never in the UI alone.

---

## 7. Abuse, compliance, trust

A free page on a shared domain is exactly what gambling and phishing
operators want, and in Indonesia a blocked domain takes every honest warung
down with it. This is the same risk flagged in the PaaS review, and the
answers have the same shape.

- **No anonymous publishing.** Google sign-in before anything is created;
  one page per free account; creation rate-limited per account and per IP.
- **Pages domain ≠ company domain.** If `brand.id` is ever blocked, the
  company site, the editor and the POS are elsewhere.
- **Publish-time checks.** An Indonesian gambling and phishing lexicon
  ("slot gacor", "deposit", "maxwin", bank-login phrasing) blocks publish;
  outbound links to hosts outside the known allowlist (wa.me, Maps,
  marketplaces, socials, food apps) publish but land in a review queue, with
  a reputation lookup on the unknown host.
- **Review queue** at `frontend-page/admin` for staff: newest flagged pages,
  one-tap unpublish, ban owner. Keep it boring.
- **Report link** on every page; three reports auto-unpublish pending
  review.
- **Boundaries the renderer guarantees**: escaped text, our CSS only, no
  user script, images only from our storage, links only https.
- **PSE registration** (Komdigi, private scope) before public launch — it is
  a form on OSS, and it is required for a platform with Indonesian user
  accounts. Terms and a privacy page in Indonesian. Which entity files is
  the owner's call (§10).
- **Account recovery** is Google's problem in V1; WhatsApp OTP recovery
  arrives with number verification in V1.1.

---

## 8. Roadmap

| | V1 · 5 weeks · one developer | V1.1 · +3 weeks | V2 · when data says so |
|---|---|---|---|
| Pages | profile, 8 tiles, 4 sizes, 8 palettes, path URL, OG image, JSON-LD | Promo, Galeri, Ulasan, Sosial; static map | Cabang; Poin member (itulah) |
| Editor | phone-first sheets, arrange mode, catalog list, publish, onboarding, QR download | templates by type polished; spreadsheet import and print card (Pro) | WhatsApp order form with a cart |
| Accounts | Google sign-in, one free page | Pro billing via Midtrans subscription; custom domains | WhatsApp OTP recovery |
| Ops | Cloudflare in front, cache purge, beacon stats (7 d), report link, lexicon check, review queue | 90-day stats with sources; PSE filed; terms | catalog sync from itulah Articles/Pricelist |
| Growth | "Dibuat dengan" footer, "pasang di bio" guide | counter QR card, Instagram template pack | POS card in settings → itulah lead |

Week by week for V1: (1) domain, binary, Google auth, page/slug/version
model; (2) renderer, eight tiles, palettes, Cloudflare and purge; (3) editor
sheets, arrange mode, catalog; (4) media pipeline, OG image, QR, onboarding,
publish; (5) abuse checks, review queue, stats, polish — and ten real shops
on it before anyone else.

Ship V1 to ten shops we can talk to — the owner's own network — before any
public launch. Their first week of edits will rewrite §2's tile table more
truthfully than this document can.

---

## 9. Metrics that decide the next step

| Metric | Why it matters |
|---|---|
| Sign-up → publish rate, and minutes to publish | Onboarding works or it doesn't; target under 3 minutes and over 60 % |
| Pages with a WhatsApp tile and a catalog | The page is doing its one job |
| WhatsApp clicks per page per week | The number the owner cares about; put it on their home screen |
| 30-day active pages (edited *or* visited) | Free pages nobody visits are just storage |
| Pro conversion, and itulah leads per month | Which revenue line is real |
| Flagged pages per 100 published | Abuse load; sizes the review queue |

---

## 10. Open decisions for the owner

1. **Brand and domain.** A short `.id` for pages; `.co.id` needs company
   documents and is longer. The company site stays on a different domain.
2. **Standalone brand, or "by itulah"?** Recommendation: a standalone brand
   owned by the same company; the POS is the upsell inside it, not the label
   on it. A warung should not need to know what a POS is to want the page.
3. **Free limits and Pro price** — §4's table is a proposal.
4. **V1 tile cut** — §2's V1 column is a proposal; WhatsApp, Menu and QRIS
   are not negotiable, the rest is.
5. **Entity and PSE.** Which PT files the PSE registration and signs the
   Midtrans contract when Pro billing lands.
6. **Cloudflare in front** — needs the pages domain's DNS to live at
   Cloudflare. Recommended; it is what makes free serving free.
7. **The first ten shops.**

---

## Sources

- Bento shutdown on 13 Feb 2026 and redirect to Linktree:
  [AlternativeTo](https://alternativeto.net/news/2025/12/bento-to-shut-down-in-2026-as-linktree-takes-over-and-offers-migration-path/),
  [Taplink](https://taplink.at/en/blog/bento-me-over.html),
  [own.page](https://own.page/blog/bento-alternatives),
  [Paage](https://start.paa.ge/blog/bento-me-alternative-2026),
  [tini.bio](https://tini.bio/vs-bento)
- Lynk.id free/Pro and the reported 5 % fee:
  [Jualme](https://www.jualme.com/2025/05/apa-itu-lynkid-platform-keren-buat.html),
  [Magang Digital](https://magangdigital.com/lynk-id-vs-linktree/),
  [Jetorbit](https://www.jetorbit.com/blog/lynk-id-solusi-untuk-link-in-bio-dan-personal-branding/)
- Indonesian catalog and QR-menu tools:
  [Tautanku.id](https://tautanku.id/link-in-bio-jualan),
  [Qlike.id](https://qlike.id/),
  [QMenu.id](https://qmenu.id/),
  [Cataloku](https://cataloku.com/)
- QRIS for online selling: [Ezeelink](https://ezeelink.co.id/blog/qris-untuk-jualan-online/)
