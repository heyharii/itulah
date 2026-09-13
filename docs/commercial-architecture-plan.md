# Commercial / Pricing Architecture Plan

> **Catatan baseline 12 September 2026:** dokumen ini dipertahankan sebagai latar arsitektur 31 Agustus. Untuk scope dan semantics Commercial V1 terbaru, gunakan [acuan utama](commercial-v1.md) dan [daftar koreksi terhadap draft lama](commercial-v1-change-control.md). Bagian yang berbeda—termasuk strict Campaign budget, offline tender, tax basis, dan advanced capabilities—tidak menjadi kontrak V1. Pernyataan kondisi kode di bawah adalah catatan pada tanggal dokumen, bukan audit implementasi terbaru.

**Status:** Proposed target architecture
**Date:** 2026-08-31
**Scope:** Price authoring, deterministic pricing, simulation, release, Store publication, activation, and pricing attribution

## 1. Executive decision

Dalam Itulah, **Commercial adalah domain Pricing**.

Commercial memiliki:

- price list dan price entry;
- scope, precedence, dan effective period harga;
- markdown;
- promotion rule, campaign, dan promotional code;
- deterministic pricing engine;
- simulation dan coverage analysis;
- authoring revision, validation, dan release approval;
- per-Store artifact compilation;
- signing, publication, delivery, dan activation status;
- immutable price trace; dan
- idempotent promotion-usage projection.

Commercial bukan nama untuk seluruh alur retail. Commercial tidak memiliki Supplier, Procurement, Receiving, Inventory, Assortment, Tax, Checkout, Sale, Return, Tender, Voucher, Loyalty, AP, atau GL.

Domain-domain tersebut hanya memberikan input kepada Commercial, menggunakan hasil pricing, atau menyimpan pricing trace sebagai bukti transaksi.

Keputusan utama:

> Bangun satu loop authoritative: **authoring -> simulation -> compile -> signed per-Store artifact -> durable publish -> Store verify/activate -> deterministic evaluation -> immutable trace**.

Kita tidak membuat legacy Commercial versi kelima. Kita mengambil rule richness terbaik dari legacy, tetapi membuang duplicate authority, split snapshot, best-effort publication, dan incomplete producer-to-Store path.

## 2. Scope dan authority

### 2.1 Yang dimiliki Commercial

| Capability | Authority Commercial |
|---|---|
| Price List | Nama, currency, scope, priority, effective window, revision |
| Price Entry | Harga SKU/Article dalam satu Price List revision |
| Price Resolution Policy | Precedence dan deterministic tie-break |
| Markdown | Replacement price sementara, bukan discount biasa |
| Campaign | Lifecycle dan grouping promotion rule |
| Promotion Rule | Eligibility, effect, stacking, priority, dan cap policy |
| Promotional Code | Gate untuk rule; bukan stored-value voucher |
| Pricing Engine | Resolusi base price, markdown, promotion, free item, dan trace |
| Simulation | Evaluasi tanpa konsumsi usage/budget atau side effect |
| Compiler | Mengubah authoring revision menjadi Store-safe artifact |
| Release | Revision/target pinning, compile, approval, publish, retire |
| Publication | Durable per-Store delivery and activation state |
| Pricing Artifact | Complete immutable Store pricing snapshot |
| Price Trace | Penjelasan hasil, source, applied rule, allocation, digest |
| Usage Projection | Idempotent projection dari sale/return facts |

### 2.2 Yang bukan milik Commercial

| Domain | Authority sebenarnya | Kontrak dengan Commercial |
|---|---|---|
| Merchandise/Catalog | Article, SKU, division, tags, lifecycle, assortment | Memberikan classification dan catalog generation |
| Organization | Store, Store Group, channel, timezone | Memberikan target dan valid pricing scope |
| Costing | Cost layer dan valuation | Memberikan Cloud-only margin input |
| Inventory | Stock, movement, availability | Checkout memeriksa stok; Commercial tidak menulis balance |
| Tax | Category mapping, rate, treatment, rounding | Menghitung tax sesudah commercial amount selesai |
| Checkout/Sales | Cart, override approval, tender, completed sale | Memanggil engine dan menyimpan Price Trace |
| Returns | Eligibility, refund, disposition | Membalik original sale values; tidak reprice history |
| Voucher | Stored value dan redemption ledger | External checkout benefit |
| Loyalty | Point balance, earn/redeem ledger | External checkout benefit |
| Employee Benefits | Employee eligibility dan entitlement | External checkout benefit |
| Finance/Marketing Budget | Budget dan funding authority | Memberikan strict Store allowance/lease |
| Accounting | Revenue, discount, tax, COGS, GL | Menggunakan sale attribution; bukan evaluator pricing |
| Sync | Transport, ordering, retry, signing envelope | Mengirim artifact/fact tanpa pricing logic |

### 2.3 Boundary rules

- Commercial boleh mereferensikan `sku_id`, `article_id`, `store_id`, `store_group_id`, `channel`, dan `customer_tier`, tetapi tidak menjadi authority atas data itu.
- Commercial boleh membaca cost untuk margin validation atau compile-time derivation, tetapi cost tidak boleh masuk Store artifact.
- Commercial menghasilkan listed/commercial amount dan discount attribution. Tax menghitung tax secara terpisah.
- Checkout boleh mengirim approved manual override sebagai explicit input. Commercial men-trace override tetapi tidak mengotorisasi supervisor.
- Sale menyimpan output Commercial. Commercial tidak membuat, menender, atau menyelesaikan sale.
- Return membalik original commercial values. Return tidak memanggil current pricing untuk menghitung refund historis.
- Promotional code adalah promotion gate. Stored-value voucher tetap domain terpisah.

## 3. Current state Itulah

Current Itulah sudah mempunyai fondasi pricing sederhana:

- `commercial_publication` dengan lifecycle `DRAFT | PUBLISHED` dan effective dates;
- `commercial_price_rule` untuk harga SKU berdasarkan site/channel;
- published rows yang dilindungi trigger immutable;
- integer minor-unit money;
- Cloud sale line yang menyimpan publication/version dan price digest;
- resolver Cloud yang mem-pin offer ketika line dimasukkan ke sale; dan
- SQLite tables untuk activated commercial/catalog data.

Namun current model belum menjadi Commercial/Pricing platform yang utuh:

1. **Boundary tercampur.** `commercial_publication` juga memiliki tax dan assortment rules, padahal keduanya authority domain lain.
2. **Tidak ada shared pure engine.** Cloud resolver dan Store sale path belum memakai satu evaluator yang sama.
3. **Store sale belum coherent dengan active publication.** Simple Store sale masih membaca `unit_price_minor` dari local inventory subject, bukan complete active pricing artifact.
4. **Authoring terlalu tipis.** Belum ada Price List revision, markdown, promotion rule, campaign, promotional code, simulation, atau conflict diagnostics.
5. **Publication belum end-to-end.** Belum ada immutable per-Store artifact, signer, durable publication state, activation evidence, dan last-known-good protocol yang lengkap.
6. **Historical trace masih minimal.** Publication/version dan digest ada, tetapi belum menjelaskan source cascade, markdown, applied rules, allocation, rejection, dan free-item attribution.
7. **Tidak ada Store/Cloud parity contract.** Belum ada bukti bahwa input identik menghasilkan byte-identical pricing result.
8. **Tidak ada explicit budget semantics.** Strict budget versus allowed oversubscription belum menjadi policy yang dapat diaudit.

Fondasi existing dipertahankan sebagai compatibility input dan historical evidence, bukan sebagai target akhir.

## 4. Komparasi seluruh implementasi sebelumnya

### 4.1 Capability matrix

Legend: `Strong`, `Partial`, `Missing`, atau `Risk`.

| Capability | Current Itulah | Newton | Fresh | Retail internal | Final-product | Target Itulah |
|---|---|---|---|---|---|---|
| Commercial hanya Pricing | Risk: tax/assortment tercampur | Strong | Mostly | Risk: dua model | Strong | Strong dan enforced |
| Exact money | Strong | Strong | Strong | Mixed legacy | Strong | Strong |
| Versioned authoring | Partial | Strong | Strong | Strong tetapi terduplikasi | Strong | Strong, satu model |
| Price-list cascade | Partial | Strong | Strong | Strongest | Strong | Strong dan versioned |
| Markdown sebagai source | Missing | Strong | Strong | Strong | Strong | Strong |
| Promotion semantics | Missing | Strong | Strong | Strongest | Strong | Adopted bertahap |
| Deterministic pure engine | Missing | Strong | Strong | Strong | Strong | Satu engine authoritative |
| Cloud simulation | Missing | Strong | Strong | Strong | Strong | Same engine, no side effect |
| Compile diagnostics | Missing | Strong | Strong | Partial | Strong | Structured dan blocking |
| Complete per-Store artifact | Missing | Strong | Partial | Risk: rules/prices split | Strong candidate | Complete artifact |
| Artifact signature | Missing | Strong | Missing/incomplete | Missing | Store verifier strong | Ed25519 end-to-end |
| Durable Cloud publisher | Missing | Strong | Missing/incomplete | Risk: timer/best effort | Missing | Required |
| Strict Store activation | Partial | Strong | Partial | Cache replacement | Strong | Signature/scope/floor/generation |
| Last-known-good | Missing | Strong | Partial | Implicit cache | Strong | Explicit atomic pointer |
| Per-Store activation status | Missing | Strong | Partial | Weak | Missing producer loop | Full status model |
| Price trace | Minimal | Strong | Strong | Strongest | Strong | Reproducible and content-addressed |
| Free-item consistency | Missing | Supported | Supported | Risk: unavailable item can be skipped | Supported | Delivered or rule re-evaluated |
| Strict offline campaign budget | Missing | Partial | Allowance kernel | Risk: stale counters | Allowance kernel, unwired | Explicit fenced allowance |
| Cost redaction | N/A | Strong | Strong | Risk in legacy DTOs | Strong | Compile-time enforced |
| Simple package boundaries | Monolithic adapters | Direct SQL coupling | Many crates | Go monolith/dual paths | Too many crates | Module-first, two shared crates |
| Full author-to-Store loop | Missing | Closest | Incomplete | Incomplete/best effort | Incomplete | Complete by definition |

### 4.2 Newton

**Yang paling kuat:**

- pricing engine pure dan deterministic;
- Cloud simulation dan Store evaluation memakai semantic core yang sama;
- authoring revision dipin saat publish;
- immutable per-Store artifacts;
- signature, Store scope, generation, catalog floor, dan digest validation;
- last-known-good activation;
- sale provenance mengacu pada artifact/release/digest; dan
- publication/release diagnostics cukup matang.

**Yang tidak kita copy:**

- banyak domain service langsung bergantung pada `pgxpool` dan embedded SQL;
- transport/repository boundary tidak konsisten;
- Store checkout keseluruhan belum selesai, sehingga pricing bagus belum terbukti dalam complete POS flow; dan
- workflow truth berisiko tersebar antara service, prompt, dan prototype.

**Keputusan target:** gunakan semantic dan artifact safety Newton, tetapi implementasikan melalui pure crate, application service, narrow repository port, dan complete operational publication status.

### 4.3 Fresh

**Yang paling kuat:**

- `pricing-engine` sebagai shared pure kernel;
- Cloud authoring dengan ETag dan idempotency;
- compiler deterministic yang memakai Cloud-only cost lalu membuangnya;
- Store-safe candidate dan checksum;
- offline checkout yang menyimpan trace; dan
- clear Cloud/Store authority.

**Kelemahan:**

- compiler berhenti pada `ReadyToPublish`;
- signing, publisher, dan Store activation producer path belum lengkap;
- schema publication lebih maju daripada application workflow;
- beberapa UI menghitung cascade sendiri; dan
- jumlah crate dan transitional persistence terlalu besar untuk di-copy langsung.

**Keputusan target:** adopsi compiler dan handler contract, tetapi release belum disebut selesai sebelum artifact signed, delivered, verified, dan activated.

### 4.4 Retail internal

**Yang paling kuat:**

- price-list cascade paling kaya;
- markdown sebagai replacement source;
- promotion gates, time windows, coupon, cumulative rules, budget dan usage caps;
- additive/compound percentage, fixed amount, fixed price, free goods, dan bundles;
- deterministic stackable-versus-exclusive scenario selection;
- detailed price trace dan posting hints;
- Cloud/Store determinism tests; dan
- checkout-benefit separation untuk voucher/points/employee discount.

**Kelemahan:**

- `cloud/commercial` dan `cloud/pricing` menjadi dua model yang overlap;
- rules/campaigns dan prices dikirim melalui jalur berbeda sehingga snapshot dapat drift;
- auto-publish memakai in-process timer dan best-effort callback;
- UI dapat menduplikasi cascade;
- hard-coded tax assumptions masuk ke pricing/posting paths;
- cost dan money masih `float64` pada beberapa legacy DTO; dan
- unavailable free item dapat di-skip sementara original trace tetap menunjukkan grant.

**Keputusan target:** adopsi rule semantics dan trace, tetapi gunakan satu authoring model, satu complete artifact, durable publisher, exact money, clean Tax boundary, dan strict free-item consistency.

### 4.5 Retail final-product backend

**Yang paling kuat:**

- Rust pure-domain/application/composition separation;
- executable dependency-boundary tests;
- deterministic commercial object-set compilation;
- Store verifier yang ketat terhadap signature, scope, expiry, generation, catalog floor, digest, completeness, dan forbidden cost fields;
- ETag, tenant, idempotency, dan advisory-lock patterns.

**Kelemahan:**

- Cloud commercial lifecycle berhenti di `ready_to_publish`;
- signer/distributor/activation worker tidak terhubung;
- promotion allowance kuat sebagai kernel tetapi belum durable/integrated; dan
- fragmentasi crate menambah migration dan operational coupling.

**Keputusan target:** adopsi boundary tests dan Store verifier, tetapi hanya extract `pricing-engine` dan `commercial-contracts`; bounded context lain tetap module-first.

### 4.6 Current Itulah

**Yang dipertahankan:**

- exact money;
- effective publication;
- immutable published rules;
- historical sale snapshots;
- existing Edge sync, signed commands, generation fencing, idempotency, dan durable outbox foundation.

**Yang diganti:**

- mixed price/tax/assortment publication;
- Cloud-only resolver tanpa shared engine;
- `unit_price_minor` pada inventory subject sebagai Store pricing authority;
- no per-Store signed artifact;
- no authoring/release/activation status model; dan
- minimal trace.

## 5. Bagaimana target lebih baik dari semua legacy

| Legacy failure mode | Target design | Proof yang wajib ada |
|---|---|---|
| Lebih dari satu pricing evaluator | Hanya `pricing-engine` boleh resolve harga | Dependency/forbidden-evaluator test |
| Rule dan price version dapat drift | Satu complete per-Store Pricing Artifact | Artifact fixture berisi semua required pricing inputs |
| `compiled` disamakan dengan `published` | Compile, publish, deliver, activate adalah state berbeda | Per-Store lifecycle test |
| Publish timer/callback dapat hilang saat restart | Publication work ditulis dalam transaction release | Restart/retry integration test |
| Artifact salah dapat mengganti harga aktif | Verify dulu, atomic pointer swap, last-known-good | Corrupt/stale artifact test |
| Store menerima cost atau margin input | Compiler strips dan verifier rejects forbidden fields | Payload leakage test |
| UI/SQL melakukan cascade sendiri | Adapter hanya memanggil pure engine | Static architecture guard |
| Markdown dianggap discount biasa | Markdown mengganti base source sebelum promotion | Trace assertion |
| Promo conflict tidak deterministic | Stable scenario ordering dan tie-break | Map/order permutation property test |
| Free item hilang tetapi trace tetap claim | Re-evaluate atau fail; tidak pernah silent drop | Unavailable grant test |
| Strict budget memakai stale global counter | Fenced per-Store allowance atau explicit non-strict policy | Concurrent/offline allowance test |
| Return memakai current price | Return membaca original trace; pricing tidak dipanggil | Return integration contract test |
| Current Itulah mix tax/assortment | Commercial schema baru hanya pricing | Table-owner architecture test |
| Reference terlalu monolithic/fragmented | Dua shared crates, module-first adapters | Cargo dependency test |
| History tidak reproducible | Artifact ID/digest dan complete trace pada sale line | Replay historical fixture |

Keunggulan bukan jumlah feature. Keunggulan adalah **satu authority, satu engine, satu complete artifact, satu closed publication loop, dan satu reproducible trace**.

## 6. Goals dan non-goals

### Goals

1. Cloud simulation dan Store evaluation menghasilkan output identik untuk input identik.
2. Store dapat pricing offline memakai last-known-good artifact.
3. Semua effective pricing policy datang dari signed immutable artifact.
4. Authoring tidak menjadi effective sampai release diaktifkan Store.
5. Setiap hasil dapat dijelaskan sampai source price dan rule revision.
6. Cost/PII/tax authority data tidak bocor ke artifact.
7. Publication dapat di-retry, diobservasi, dan dipulihkan tanpa manual database edit.
8. Legacy price resolution dapat dimigrasi tanpa mengubah historical sales.
9. Advanced promotion ditambahkan setelah base-price vertical slice selesai.
10. Commercial tetap Pricing dan tidak berkembang menjadi commerce god-domain.

### Non-goals

- membangun Supplier, Procurement, Inventory, Tax, Checkout, Return, Loyalty, Payment, atau Accounting;
- membuat Store stock decision di pricing engine;
- tax calculation atau statutory tax advice;
- automatic repricing of historical transactions;
- dynamic expression/scripting pada rule;
- microservices atau satu crate per entity;
- autonomous AI pricing dalam authority path;
- delta artifact pada versi pertama; dan
- semua promotion type pada milestone pertama.

## 7. Non-negotiable invariants

### 7.1 Determinism

Pricing adalah pure function:

```text
resolve(snapshot, cart, context) -> PricingResult
```

Engine tidak boleh mengakses database, network, filesystem, system clock, randomness, atau dynamic code execution. Semua time, timezone, customer context, usage, allowance, dan override masuk sebagai explicit input.

Input canonical yang identik harus menghasilkan output dan `trace_id` identik.

### 7.2 Exact money

- Gunakan integer minor units atau exact decimal.
- Jangan gunakan `f32`/`f64` untuk price, discount, budget, atau margin result.
- Arithmetic overflow adalah error.
- Percentage menggunakan integer basis points atau typed ratio.
- Apportionment menggunakan largest remainder dengan stable tie-break.
- Currency wajib eksplisit dan satu cart hanya boleh memakai satu currency.

### 7.3 Immutable published truth

- Authoring draft boleh berubah melalui revision baru.
- Release mem-pin exact revisions.
- Artifact immutable.
- Publication tidak mengubah artifact.
- Activation hanya mengganti active pointer secara atomic.
- Completed sale menyimpan artifact/digest/trace dan tidak pernah di-resolve ulang.

### 7.4 Fail closed

Unknown SKU, missing required price, invalid artifact, signature failure, wrong Store, stale generation, conflicting same-generation digest, unmet catalog floor, unsupported rule, atau arithmetic overflow tidak boleh menghasilkan harga tebakan.

Fallback hanya boleh digunakan jika explicit policy mengizinkan dan trace menyebut fallback source serta reason.

### 7.5 One-way Cloud-only inputs

Cost dan margin target boleh masuk compiler. Hasilnya harus menjadi explicit Store-safe amount/effect. Raw cost, margin source, supplier information, dan purchase data tidak boleh masuk artifact.

## 8. Target architecture

```text
                    CLOUD COMMERCIAL CONTROL PLANE

  Authoring API
      │
      ├── Price Lists / Entries
      ├── Markdowns
      ├── Campaigns / Promotion Rules
      ├── Promotional Codes
      └── Revision / Approval
                     │
                     v
              Simulation / Validation
                     │
                     v
          Deterministic Store Compiler
             │                 │
       Cloud-only input     Store-safe output
       catalog / cost       no cost / no PII
             │                 │
             └──────> Signed Pricing Artifact
                               │
                     durable per-Store publication
                               │
                               v
                       STORE PRICING RUNTIME

                    verify -> persist -> activate
                               │
                     same pure pricing engine
                               │
                     PricingResult + PriceTrace
                               │
                               v
                  Checkout/Sale stores the result
```

Commercial memiliki Cloud control plane dan Store pricing runtime. Store runtime mengeksekusi pricing policy; Store tidak menjadi authoring authority.

## 9. Domain model

### 9.1 Value objects

- `Money { currency, minor }`
- `BasisPoints`
- `Quantity`
- `LocalDateTime` plus Store timezone
- `PriceListId`, `PriceEntryId`, `MarkdownId`
- `CampaignId`, `PromotionRuleId`, `PromotionCodeId`
- `AuthoringRevision`
- `ReleaseId`, `ArtifactId`, `ArtifactGeneration`
- `CatalogGeneration`
- `ContentDigest`, `TraceId`
- `StoreId`, `StoreGroupId`, `Channel`, `CustomerTier`
- `ProductRef { SKU | ARTICLE }`

Invalid or mixed-currency states harus gagal saat construction, bukan jauh di persistence layer.

### 9.2 Price List

```text
PriceList {
  id
  revision
  name
  currency
  scope_kind
  scope_id
  channel
  customer_tier
  priority
  valid_from / valid_to
  status
}
```

Status authoring: `DRAFT | APPROVED | RETIRED`. Effective behavior tetap ditentukan oleh release dan valid window, bukan mutable `active=true` di Store.

### 9.3 Price Entry

```text
PriceEntry {
  id
  price_list_revision
  product_ref
  unit_price
  min_quantity
  valid_from / valid_to
  priority
}
```

Satu entry tidak menyimpan cost, tax rate, stock, atau supplier information.

### 9.4 Markdown

```text
Markdown {
  id
  revision
  product_scope
  store_scope
  replacement_unit_price
  priority
  valid_from / valid_to
  status
}
```

Markdown adalah replacement price source. Hanya satu markdown menang untuk satu line. Markdown dipilih sesudah base price dan sebelum promotion.

### 9.5 Campaign

```text
Campaign {
  id
  revision
  name
  valid_from / valid_to
  lifecycle
  cap_policy
  external_budget_ref
}
```

Lifecycle: `DRAFT | ACTIVE | PAUSED | ENDED | RETIRED`. Artifact hanya membawa effective campaign data yang dibutuhkan Store.

### 9.6 Promotion Rule

```text
PromotionRule {
  id
  revision
  campaign_id?
  name
  product_scope
  store_scope
  channel_scope
  customer_scope
  time_window
  threshold
  effect
  stacking
  priority
  usage_policy
  online_policy
  valid_from / valid_to
}
```

Supported effect bertahap:

- percentage discount;
- amount discount;
- fixed unit/line price;
- buy-X-get-Y atau free item;
- bundle effect; dan
- margin-derived price yang wajib di-compile menjadi Store-safe explicit value.

### 9.7 Promotional Code

Promotional Code hanya gate menuju promotion rule. Ia memiliki validity, usage policy, optional customer binding, dan online requirement.

Stored-value voucher tidak boleh disimpan sebagai Promotional Code.

### 9.8 Authoring head dan revision

Semua authoring mutation menaikkan monotonic `authoring_revision`. Release mem-pin expected revision. Concurrent publish terhadap stale revision ditolak.

### 9.9 Release

```text
CommercialRelease {
  id
  authoring_revision
  target_store_ids
  status
  attempt
  requested_by
  approved_by?
  diagnostics
  created_at / compiled_at / published_at / retired_at
}
```

Lifecycle:

```text
DRAFT -> COMPILING -> READY -> PUBLISHED -> RETIRED
                      \-> FAILED
```

`PUBLISHED` berarti durable per-Store publication rows telah dibuat, bukan seluruh Store sudah aktif.

### 9.10 Pricing Artifact

```text
PricingArtifact {
  schema_version
  artifact_id
  release_id
  tenant_id
  store_id
  generation
  authoring_revision
  catalog_generation_floor
  effective_from / effective_to
  store_timezone
  currencies
  fallback_policy
  price_lists / price_entries
  markdowns
  campaigns / promotion_rules
  promotional_codes
  canonical_payload_digest
  signing_key_id
  signature
}
```

V1 adalah complete snapshot, bukan delta.

Artifact tidak boleh berisi:

- cost atau margin input;
- supplier/purchase data;
- tax rate/treatment;
- stock quantity;
- customer PII;
- loyalty balance;
- voucher balance; atau
- employee data.

### 9.11 Pricing Result dan Price Trace

```text
PricingResult {
  artifact_id / generation / digest
  line_results
  free_lines
  subtotal_before_promotion
  markdown_delta
  promotion_discount
  commercial_total
  applied_rules
  rejected_candidates
  external_stacking_permissions
  trace_id
}
```

Setiap line result menyimpan:

- input product/quantity;
- resolved base source;
- original/base unit price;
- markdown source dan replacement price;
- applied effects dalam urutan deterministic;
- allocated discount;
- final commercial amount;
- free-item attribution; dan
- stable reason codes.

## 10. Pricing semantics

### 10.1 Base-price cascade

Default V1 precedence:

```text
approved manual override (external input)
> exact Store
> Store Group
> Channel
> Customer Tier
> Company default
> explicit SKU catalog fallback, only if policy allows
```

Pada level scope yang sama:

1. SKU beats Article;
2. higher priority wins;
3. later `valid_from` wins;
4. stable lower revision/object ID wins sebagai final tie-break.

Store Group diexpansi menjadi Store IDs saat compile agar Cloud dan Store tidak memakai membership version berbeda.

### 10.2 Markdown resolution

- markdown dipilih dari line yang sudah mempunyai base price;
- markdown mengganti base unit price;
- dua markdown tidak stack;
- priority/scope/time tie-break deterministic;
- pre-markdown dan post-markdown price tetap ada di trace; dan
- promotion threshold policy harus eksplisit memilih original atau markdown basis.

### 10.3 Promotion eligibility

Engine mengevaluasi:

- campaign/rule lifecycle;
- validity window;
- Store, Store Group, channel, dan customer tier;
- SKU, Article, division, dan tags;
- cart quantity dan amount threshold;
- day/time window menggunakan Store timezone;
- Promotional Code;
- customer usage/cumulative context;
- Store allowance/budget context;
- online requirement; dan
- product/free-item support pada artifact.

`require_online` wajib ditegakkan; field tidak boleh hanya dekoratif.

### 10.4 Effects

- Percentage dapat `ADDITIVE_ORIGINAL` atau `COMPOUND_RUNNING`.
- Flat amount dialokasikan menurut stable line weight.
- Fixed price menetapkan explicit eligible total/unit price.
- Semua discount di-clamp terhadap eligible amount, bukan menjadi negatif.
- Per-rule maximum discount diterapkan sebelum final scenario comparison.
- Free item menjadi explicit output line, bukan annotation.
- Margin rule tidak menghitung raw cost di Store; compiler menghasilkan effect final atau menolak rule.

### 10.5 Stacking

Default strategy:

1. semua eligible stackable rules membentuk satu cumulative scenario;
2. setiap exclusive/non-stackable rule dievaluasi sebagai scenario sendiri;
3. scenario external-benefit compatibility dihitung sebagai permissions, bukan langsung menebus voucher/points;
4. customer menerima scenario dengan benefit tertinggi;
5. tie: priority lebih tinggi, lalu stable rule ID lebih rendah; dan
6. urutan effect di dalam scenario ditentukan secara eksplisit.

Conflict tidak boleh melempar error generik di cashier. Compile diagnostics menangkap conflict authoring; runtime selalu menghasilkan deterministic result atau stable rejection.

### 10.6 Free items

- Free item adalah real sale line agar inventory dan COGS tetap benar.
- Artifact harus membawa referenced grant SKU.
- Store integration memeriksa catalog dan availability sebelum finalize.
- Jika grant tidak dapat diberikan, checkout harus re-evaluate dengan rule unavailable atau gagal dengan actionable error.
- Tidak boleh silent skip sambil mempertahankan original promotion trace.

### 10.7 Usage and budget

Pricing engine hanya membaca immutable usage/allowance input.

- Simulation tidak mengonsumsi apa pun.
- Store checkout mengonsumsi local usage/allowance bersama sale transaction.
- Cloud projection idempotent terhadap `(sale_event_id, rule_id)`.
- Return projection membalik attributed usage/budget sesuai original trace.
- Strict shared budget menggunakan fenced per-Store allowance/lease dari budget authority.
- Tanpa allowance valid, policy harus eksplisit: decline promotion atau non-strict oversubscription. Tidak boleh implicit.

## 11. Compiler dan diagnostics

Compiler menjalankan langkah berikut:

1. lock release dan pin exact authoring revision;
2. validasi target Store dan Store timezone;
3. snapshot catalog generation;
4. resolve Article/SKU classification;
5. expand Store Group ke concrete Store IDs;
6. load Cloud-only cost untuk margin checks;
7. validate currency dan effective windows;
8. detect missing base price, duplicate candidate, dead scope, overlap, cycle, unsupported effect, unknown product, dan contradictory stacking;
9. compile margin rule menjadi explicit Store-safe value;
10. strip all forbidden fields;
11. sort seluruh collection secara canonical;
12. serialize canonical payload;
13. compute digest;
14. sign artifact; dan
15. persist artifact plus diagnostics.

Diagnostics minimum:

- severity: `ERROR | WARNING | INFO`;
- object type/ID/revision;
- target Store;
- stable diagnostic code;
- human-readable explanation;
- remediation hint; dan
- blocking flag.

`READY` hanya tercapai jika tidak ada blocking diagnostic dan semua target Store memiliki complete artifact.

## 12. Publication dan Store activation

### 12.1 Cloud publication transaction

Satu PostgreSQL transaction menulis:

- release transition ke `PUBLISHED`;
- immutable artifacts;
- per-Store publication rows;
- audit record;
- durable idempotency response; dan
- exact-target command/outbox work.

Tidak ada in-process timer sebagai authority. Worker hanya mengirim durable rows dan dapat restart kapan pun.

### 12.2 Per-Store publication state

```text
PENDING -> INFLIGHT -> DELIVERED -> ACTIVATED
             |             |           |
             v             v           v
           FAILED       REJECTED     RETIRED
```

Retry metadata meliputi attempt count, last error, next attempt, delivered digest, activation digest, dan timestamps.

### 12.3 Store verification

Sebelum activation, Store memverifikasi:

- trusted signing key dan signature;
- canonical digest;
- tenant dan exact Store scope;
- schema compatibility;
- effective/expiry window;
- generation monotonicity;
- same-generation same-digest rule;
- catalog generation floor;
- semua referenced SKU/Article tersedia;
- currency support;
- artifact completeness; dan
- tidak ada forbidden Cloud-only fields.

### 12.4 Atomic activation

Satu SQLite transaction menulis:

- immutable artifact/components;
- active artifact pointer;
- activation evidence;
- idempotency result; dan
- `commercial.pricing.artifact.activated.v1` outbox fact.

Jika verification gagal:

- artifact tidak menjadi active;
- last-known-good tetap digunakan;
- structured rejection disimpan; dan
- `commercial.pricing.artifact.rejected.v1` dikirim ke Cloud.

### 12.5 Rollout status

Cloud harus dapat menjawab per Store:

- desired release/generation;
- delivered artifact/generation;
- active artifact/generation/digest;
- catalog generation;
- activation time;
- rejection code/reason;
- artifact age;
- expiry risk; dan
- rollout lag.

## 13. Authoring dan simulation API

### 13.1 Cloud HTTP surface

```text
/api/v1/commercial/price-lists
/api/v1/commercial/price-lists/{id}
/api/v1/commercial/price-lists/{id}/entries
/api/v1/commercial/markdowns
/api/v1/commercial/campaigns
/api/v1/commercial/promotion-rules
/api/v1/commercial/promotion-codes
/api/v1/commercial/simulate
/api/v1/commercial/coverage
/api/v1/commercial/releases
/api/v1/commercial/releases/{id}/compile
/api/v1/commercial/releases/{id}/publish
/api/v1/commercial/releases/{id}/retire
/api/v1/commercial/stores/{store_id}/status
```

Mutation contract:

- authenticated server-derived actor;
- exact permission;
- tenant/scope validation;
- `Idempotency-Key`;
- `If-Match` untuk versioned resource;
- canonical request digest;
- stable replay response;
- append-only audit; dan
- Problem Details error envelope.

### 13.2 Simulation

Simulation menerima:

- explicit authoring revision atau release candidate;
- cart;
- Store/channel/customer context;
- evaluation instant/timezone;
- optional usage/allowance fixture; dan
- optional approved manual override.

Simulation mengembalikan:

- full Pricing Result/Trace;
- applied/rejected rules;
- diagnostics;
- source coverage;
- margin warnings dari Cloud-only analysis; dan
- no side effect.

### 13.3 Coverage

Coverage read model menjawab:

- SKU tanpa required base price;
- overlapping candidates;
- Store tanpa artifact-ready coverage;
- rule yang tidak pernah match;
- promotion dengan missing grant SKU;
- price di bawah configured margin guard;
- artifact size estimate; dan
- expiring price/markdown/campaign.

Coverage bukan resolver kedua. Ia memakai compiler/engine diagnostics.

## 14. Integration contracts dengan domain lain

### Catalog

Input compile:

- stable Article/SKU IDs;
- active status;
- division/tags/classification;
- catalog generation; dan
- optional explicit catalog fallback price.

Commercial tidak mengubah catalog atau assortment.

### Organization

Input compile:

- Store IDs;
- Store Group membership version;
- channels;
- timezone; dan
- currency support.

Store Group selalu diexpansi di Cloud dan pinned pada artifact.

### Costing

Input compile/simulation:

- cost snapshot reference;
- exact cost amount/status; dan
- margin policy.

Cost tidak masuk Store artifact atau Price Trace customer-facing.

### Tax

Pricing Result memberikan commercial line amount dan attribution. Tax engine kemudian menghitung tax dari priced lines dan tax policy snapshot.

Pricing artifact tidak membawa tax rate/treatment. Completed sale mem-pin pricing artifact digest dan tax policy digest secara terpisah.

### Checkout/Sales

Checkout:

1. membaca active artifact;
2. membangun Cart/Context;
3. memanggil shared engine;
4. mengorkestrasi external benefits;
5. memvalidasi stock/free items;
6. menyelesaikan tax/tender; dan
7. menyimpan immutable Pricing Result/Trace bersama sale.

Commercial tidak menulis sale tables.

### Returns

Return membaca original sale trace untuk attribution reversal. Return tidak memanggil current pricing engine untuk refund basis.

Cloud mengirim return usage reversal ke Commercial projection dengan original applied rule IDs dan amount attribution.

### Voucher, Loyalty, dan Employee Benefit

Semua adalah external benefits. Pricing Result hanya membawa stacking permissions. Checkout-benefit orchestrator menentukan scenario gabungan dan menyimpan trace terpisah.

### Budget authority

Commercial campaign mereferensikan external budget ID. Budget authority menerbitkan allowance/lease untuk strict Store execution. Commercial tidak membuat general marketing budget ledger.

### Accounting

Price Trace memberikan posting attribution seperti markdown delta, promotion discount, free-item grant, dan campaign/rule IDs. Accounting menentukan journal; Commercial tidak menulis GL.

## 15. Persistence model

### 15.1 Cloud tables

```text
commercial_authoring_head
commercial_price_list
commercial_price_list_revision
commercial_price_entry_revision
commercial_markdown_revision
commercial_campaign_revision
commercial_promotion_rule_revision
commercial_promotion_code_revision
commercial_release
commercial_release_target
commercial_compile_attempt
commercial_compile_diagnostic
commercial_pricing_artifact
commercial_publication
commercial_activation
commercial_usage_projection
commercial_customer_usage_projection
commercial_idempotency_response
commercial_audit_event
```

Rules:

- revisions immutable setelah direferensikan release;
- artifact immutable;
- satu current authoring head per tenant;
- unique artifact `(store_id, generation)`;
- same generation cannot have two digests;
- one active desired release per Store/effective instant;
- activation evidence append-only; dan
- usage projection idempotent by source event/rule.

### 15.2 Store SQLite tables

```text
pricing_artifact
pricing_artifact_component
active_pricing_artifact
pricing_activation_event
pricing_rule_usage
pricing_customer_usage
pricing_promotion_allowance
pricing_command_receipt
```

Sale/transaction tables tetap dimiliki Store POS. Mereka hanya menyimpan artifact reference dan Pricing Trace.

## 16. Recommended code structure

Gunakan module-first boundaries. Hanya dua crate baru yang wajib:

```text
backend/
  crates/
    inventory-time-machine/       # existing, unrelated
    pricing-engine/               # pure pricing semantics
    commercial-contracts/         # artifact, command, activation, trace wire DTOs

  src/
    cloud/
      commercial/
        domain.rs                 # authoring/release state and value objects
        application.rs            # commands/use cases
        compiler.rs               # Store-safe deterministic compiler
        simulation.rs
        coverage.rs
        ports.rs
      postgres/
        commercial_authoring.rs
        commercial_release.rs
        commercial_publication.rs
        commercial_usage.rs
      http/
        commercial.rs

    edge/
      pricing/
        activation.rs
        runtime.rs
        ports.rs
      sqlite/
        pricing_artifact.rs
        pricing_usage.rs

    sync/
      # transport only; imports commercial-contracts, no pricing rules
```

Dependency rules:

- `pricing-engine` imports no Axum, SQLx, Rusqlite, filesystem, network, or wall clock.
- `commercial-contracts` contains versioned DTOs, not services or SQL types.
- Cloud application depends on engine/contracts and repository ports.
- Store runtime depends on engine/contracts and SQLite ports.
- HTTP, SQL, and sync adapters never implement price resolution.
- Frontend never imports/reimplements pricing precedence.
- Architecture tests fail on a second evaluator or forbidden table writer.

Jangan melakukan big-bang file move. Extract one use case at a time, route legacy/current callers through the new service, then remove duplicate path.

## 17. Commands, facts, dan versioning

### Cloud to Store

- `commercial.pricing.artifact.available.v1`
- optional future `commercial.pricing.artifact.revoke.v1`

Command membawa artifact reference atau complete bounded payload, exact target, generation, digest, expiry, dan signing metadata.

### Store to Cloud

- `commercial.pricing.artifact.activated.v1`
- `commercial.pricing.artifact.rejected.v1`

### Inputs from Sales/Returns

- `sale.completed.v2` membawa immutable Pricing Trace atau content-addressed trace reference.
- `return.completed.v2` membawa original rule attribution dan reversal amounts.

Commercial usage consumer tidak mengubah sale/return fact. Ia hanya membuat idempotent projections.

Semua deployed payload memiliki `schema_version`. Old durable inbox/outbox payload tetap didukung oleh compatibility decoder selama migration window.

## 18. Migration dari current Itulah

### 18.1 Preserve history

- Jangan ubah existing `commercial_publication`, price/tax/assortment rows, atau historical sale snapshots.
- Label current publication sebagai `LEGACY` pada new release read model.
- Historical sale tetap mengacu pada original publication/version/digest.
- Tidak ada backfill yang mengklaim advanced Price Trace bila data historis tidak pernah ada.

### 18.2 Pisahkan ownership

- Freeze future writes ke `commercial_tax_rule`; Tax domain menjadi authority untuk policy baru.
- Freeze future writes ke `commercial_assortment_rule`; Catalog/Merchandise menjadi authority untuk assortment baru.
- Migrate `commercial_price_rule` menjadi legacy source untuk Price List revision 1.
- Setelah cutover, schema Commercial baru hanya berisi pricing objects.

### 18.3 Bootstrap Price List

- Buat satu legacy Price List per current publication/scope/currency.
- Convert site-specific dan company default price rules menjadi Price Entry revisions.
- Preserve exact amount, effective period, source publication ID, dan original digest.
- `sku.base_price_minor` tetap explicit fallback selama rollout, bukan silent candidate.

### 18.4 Bootstrap Artifact generation 1

- Compile active legacy pricing menjadi one complete artifact per Store.
- Pin current catalog generation floor.
- Sign menggunakan production artifact key.
- Roll out ke test Store lebih dahulu.
- Store tetap memakai existing price path sampai artifact verified dan feature flag diaktifkan.

### 18.5 Dual-read, single-write migration

Urutan cutover:

1. new authoring writes only new model;
2. compiler dapat membaca legacy bootstrap plus new revisions;
3. Store dapat menyimpan artifact tanpa menggunakannya;
4. shadow evaluation membandingkan legacy result versus new engine;
5. discrepancy harus dijelaskan sebelum activation;
6. activate new engine per Store;
7. completed sale mulai menyimpan new Pricing Trace;
8. disable legacy Store price resolution;
9. keep legacy tables read-only for history; dan
10. remove compatibility code hanya setelah usage metric nol.

### 18.6 No historical rewrite

Existing sale totals tidak berubah. New engine tidak digunakan untuk “memperbaiki” old transactions. Reconciliation hanya melaporkan perbedaan; correction financial mengikuti domain accounting/return, bukan mutation history.

## 19. Implementation roadmap

### Milestone 0 — Boundary dan baseline (P0)

1. Tetapkan ADR bahwa Commercial = Pricing.
2. Inventaris seluruh writer/reader current commercial, tax, assortment, Store price, dan sale snapshot tables.
3. Freeze penambahan feature pada mixed legacy publication.
4. Capture golden fixtures dari current Itulah price resolution.
5. Definisikan exact money, scope, precedence, fallback, timezone, dan stable reason codes.
6. Tambahkan architecture guard: Commercial tidak menulis tax, assortment, inventory, sale, atau GL tables.
7. Tambahkan guard terhadap frontend/handler pricing arithmetic.

**Exit criteria**

- Ownership matrix disetujui.
- Seluruh current pricing entry point terpetakan.
- Golden legacy cases dapat direplay.
- Tidak ada feature baru yang memperluas mixed legacy model.

### Milestone 1 — Pure Pricing Engine V1 (P0)

1. Buat `pricing-engine` pure crate.
2. Implement Money, Cart, Context, Snapshot, Result, dan Trace.
3. Implement company/store-group/store/channel/tier cascade.
4. Implement SKU-versus-Article specificity dan stable tie-break.
5. Implement explicit catalog fallback policy.
6. Implement deterministic canonical trace hashing.
7. Buat Cloud adapter yang memanggil engine.
8. Jalankan shadow parity terhadap legacy resolver.

**Exit criteria**

- Engine tidak punya IO dependency.
- Input permutation tidak mengubah result/trace.
- Semua approved legacy cases match atau mempunyai documented intentional difference.
- Unknown/missing price menghasilkan stable failure, bukan tebakan.

### Milestone 2 — Authoring, revision, simulation (P0)

1. Implement Price List dan Price Entry revision tables.
2. Implement ETag, Idempotency-Key, audit, dan strong validation.
3. Implement authoring head revision.
4. Implement Cloud simulation memakai pure engine.
5. Implement batch simulation dan coverage.
6. Implement release draft serta risk-based publish approval.
7. Build admin read models tanpa pricing logic di frontend.

**Exit criteria**

- Stale update ditolak.
- Retry mengembalikan original response.
- Simulation tidak mengubah usage/budget.
- Frontend hanya menampilkan server diagnostics/result.

### Milestone 3 — Compiler dan signed Artifact V1 (P0)

1. Implement per-Store compiler.
2. Expand Store Group saat compile.
3. Pin catalog generation floor.
4. Implement missing-price, dead-scope, overlap, unknown-product, currency, dan forbidden-field diagnostics.
5. Strip cost/Cloud-only data.
6. Implement canonical serialization/digest.
7. Implement Ed25519 signing dan key ID.
8. Persist immutable artifacts dan compile attempts.

V1 artifact hanya perlu:

- base Price Lists/Entries;
- explicit fallback policy;
- Store/channel/timezone data; dan
- deterministic engine metadata.

**Exit criteria**

- Every target Store mendapatkan complete artifact atau release gagal.
- Artifact deterministic untuk revision/input yang sama.
- Cost/PII/tax data leakage test lulus.
- Signature dapat diverifikasi dengan independent verifier.

### Milestone 4 — Durable publication dan Store runtime (P0)

1. Implement per-Store publication rows dan transactional outbox.
2. Implement retryable publisher worker.
3. Implement Store artifact persistence.
4. Implement signature/scope/generation/catalog-floor verification.
5. Implement atomic active-pointer swap dan last-known-good.
6. Implement activation/rejection facts.
7. Implement Store runtime adapter ke pure engine.
8. Expose rollout/status dashboard.
9. Jalankan shadow evaluation sebelum Store cutover.

**Exit criteria**

- Process restart tidak kehilangan publication.
- Wrong Store, corrupt, stale, expired, catalog-ahead, dan same-generation-conflict artifacts ditolak.
- Rejection tidak mematikan active pricing.
- Cloud mengetahui desired versus activated generation per Store.
- Cloud dan Store result/trace identik untuk fixture yang sama.

### Milestone 5 — Markdown (P1)

1. Implement Markdown authoring/revision.
2. Implement replacement-source semantics.
3. Add scope/priority/window diagnostics.
4. Include markdown in complete artifact.
5. Add pre/post-markdown attribution to trace.
6. Add simulation and coverage.

**Exit criteria**

- Hanya satu markdown menang per line.
- Markdown tidak tercatat sebagai generic promotion discount.
- Historical trace menjelaskan original dan replacement source.

### Milestone 6 — Promotion engine (P1)

1. Implement Campaign, Promotion Rule, dan Promotional Code revisions.
2. Implement eligibility gates dan Store timezone.
3. Implement percentage, flat amount, fixed price, dan free-item effects.
4. Implement deterministic stacking/scenario selection.
5. Implement discount caps dan largest-remainder allocation.
6. Implement online-required behavior.
7. Integrate external stacking permissions.
8. Add rich compile diagnostics dan simulation matrix.

**Exit criteria**

- No negative line/total atau over-discount.
- Map/input order tidak memengaruhi hasil.
- Free item selalu delivered, re-evaluated, atau actionable failure; never silent drop.
- `require_online` benar-benar enforced.
- Voucher/loyalty/employee lifecycle tidak masuk engine.

### Milestone 7 — Usage, allowance, dan reversal (P1)

1. Implement Store local rule/customer usage ledgers.
2. Consume usage atomically dengan completed sale integration.
3. Implement Cloud idempotent usage projection.
4. Implement return attribution reversal dari original trace.
5. Integrate strict per-Store fenced allowance.
6. Add pause-at-cap as Cloud authoring transition dan release baru, bukan mutation artifact aktif.

**Exit criteria**

- Retry sale/return tidak double consume/reverse.
- Strict budget tidak overspend melebihi valid Store allowance.
- Non-strict oversubscription selalu explicit dan observable.
- Artifact tetap immutable ketika cap tercapai; Cloud menerbitkan release berikutnya.

### Milestone 8 — Cutover dan legacy retirement (P1)

1. Roll out per Store dengan capability flag.
2. Require new Price Trace on new Store sales.
3. Monitor parity, artifact age, activation lag, dan fallback usage.
4. Disable legacy Store resolver setelah seluruh Store sehat.
5. Freeze legacy pricing tables read-only.
6. Remove UI/handler duplicate logic.
7. Remove compatibility path hanya setelah zero-usage evidence.

**Exit criteria**

- 100% active Stores memakai signed artifact.
- 0 new Store transaction memakai legacy resolver.
- 0 unexplained Cloud/Store parity difference.
- Legacy tables hanya historical read source.

## 20. Validation strategy

### Pure engine tests

- deterministic output dan trace;
- permutation/order independence;
- cascade specificity/tie-break;
- effective-window boundaries;
- Store timezone and overnight windows;
- exact money overflow handling;
- largest-remainder reconciliation;
- markdown replacement semantics;
- promotion eligibility/effects/stacking;
- no negative totals atau over-discount;
- free-item attribution; dan
- stable reason codes.

### Compiler tests

- same input -> same artifact bytes/digest;
- Store Group expansion;
- catalog-floor pinning;
- unknown/dead/conflicting rules;
- missing base price;
- cost stripping;
- forbidden field scan;
- artifact completeness; dan
- signature verification.

### Persistence tests

- idempotent authoring replay;
- stale ETag conflict;
- release/advisory lock concurrency;
- immutable revision/artifact triggers;
- release plus publication atomicity;
- publisher restart/retry;
- activation atomicity; dan
- same-generation different-digest rejection.

### End-to-end tests

1. Author price -> simulate -> compile -> sign -> publish -> activate -> evaluate.
2. Cloud down -> Store evaluates last-known-good.
3. New artifact corrupt -> Store rejects -> old artifact remains active.
4. Catalog behind -> Store rejects -> activates after catalog catches up.
5. Same cart/context on Cloud and Store -> identical result/trace.
6. Sale retry -> usage consumed once.
7. Partial/full return facts -> original attribution reversed exactly once.
8. Key rotation -> old/new trusted window -> old key retirement.
9. Legacy shadow mode -> parity report -> per-Store cutover.

### Architecture tests

Fail CI bila:

- pricing logic muncul di frontend, HTTP, SQL, return, atau reporting package;
- Commercial menulis tax, assortment, inventory, sale, tender, return, AP, atau GL tables;
- Store menerima cost fields;
- Store imports Cloud persistence/domain implementation;
- second pricing evaluator diperkenalkan; atau
- publication dapat dibuat tanpa durable artifact/outbox.

## 21. Observability dan operations

Metrics/dashboard minimum:

- authoring revision;
- compile duration/failure count;
- diagnostics by code;
- desired/delivered/activated generation per Store;
- publication retry/backlog age;
- artifact age dan expiry risk;
- activation rejection reason;
- catalog-floor mismatch;
- Cloud/Store parity mismatch;
- fallback price usage;
- applied/rejected rule counts;
- promotion allowance remaining;
- usage-projection lag; dan
- artifact payload size.

Operational rules:

- Tidak ada manual DB edit sebagai normal recovery.
- Failed compile diperbaiki melalui authoring revision baru.
- Failed delivery di-retry dari durable publication row.
- Failed activation mempertahankan last-known-good.
- Signing key rotation memakai explicit key IDs dan overlap verification window.
- Artifact rollback memerlukan explicit emergency procedure, audit, dan higher generation; generation tidak boleh mundur.

## 22. Security

- Authoring, approval, compile, publish, dan retire mempunyai permission terpisah.
- Release approval dapat diwajibkan berdasarkan risk: discount depth, margin, target scope, campaign budget, atau emergency override.
- Actor berasal dari authenticated context, bukan body bebas.
- Artifact memakai Ed25519 signature dan canonical digest.
- Store hanya menerima exact-target artifact.
- Cost dan PII redaction diuji otomatis.
- Promotion codes disimpan sesuai sensitivity; raw customer entitlement tidak masuk artifact.
- Approval evidence mengikat release ID, revision, target, digest, actor, dan expiry.

## 23. Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Scope kembali melebar menjadi full commerce | Authority matrix dan forbidden-writer tests |
| Rule semantics terlalu kompleks sebelum basic pricing live | Milestone base price -> artifact -> markdown -> promotion |
| Cloud/Store drift | Shared engine, canonical artifact, parity fixtures |
| Split version antara price dan rule | One complete artifact per Store |
| Artifact terlalu besar | Measure first; chunk transport tanpa mengubah atomic activation |
| Store catalog tertinggal | Catalog generation floor dan last-known-good |
| Clock/timezone salah | Explicit Store timezone dan clock-health trace |
| Strict budget overspend offline | Fenced Store allowance/lease |
| Free SKU tidak tersedia | Compile validation plus checkout re-evaluation/failure |
| Cost leakage | Compiler DTO allowlist dan Store forbidden-field verifier |
| Publish hilang saat restart | Transactional publication outbox |
| Legacy discrepancy tidak terlihat | Shadow mode dan parity dashboard |
| Over-fragmented Rust workspace | Hanya engine/contracts sebagai shared crates |
| Historical transaction berubah | Immutable artifact/trace; no reprice history |

## 24. Definition of Commercial completion

Commercial/Pricing foundation dianggap selesai bila:

- hanya ada satu authoritative pricing engine;
- seluruh active Store memakai signed Pricing Artifact;
- setiap Store mempunyai visible desired/delivered/activated generation;
- Cloud simulation dan Store evaluation deterministic dan parity-tested;
- setiap new sale line menyimpan artifact provenance dan complete Price Trace;
- Store pricing tetap berjalan offline dengan last-known-good;
- corrupt/stale/wrong-target artifacts ditolak tanpa outage pricing;
- price, markdown, promotion, dan promotional-code revision dapat disimulasikan sebelum publish;
- publication durable dan restart-safe;
- cost/PII/tax authority data tidak ada di artifact;
- strict campaign budgets menggunakan explicit allowance semantics;
- Commercial tidak menulis domain-owned tables di luar pricing;
- legacy Store resolver tidak menerima transaksi baru; dan
- historical legacy publication/sales tetap dapat dibaca tanpa rewrite.

Advanced analytics atau AI price recommendation bukan syarat completion dan tidak boleh menjadi authority path.

## 25. Evidence map

### Newton

- `~/newton/backend/internal/pricing/doc.go`
- `~/newton/backend/internal/pricingcloud/authoring.go`
- `~/newton/backend/internal/pricingcloud/service.go`
- `~/newton/backend/internal/pricingcloud/release.go`
- `~/newton/backend/internal/commercial`
- `~/newton/backend/internal/storeedge/commercial.go`

### Fresh

- `~/Documents/fresh/crates/pricing-engine`
- `~/Documents/fresh/crates/cloud-commercial/src/handlers.rs`
- `~/Documents/fresh/crates/cloud-commercial/src/compiler.rs`
- `~/Documents/fresh/crates/cloud-commercial/src/repo.rs`
- `~/Documents/fresh/crates/store-edge/src/checkout.rs`
- `~/Documents/fresh/crates/cloud-persist/migrations/025_commercial.sql`

### Retail internal

- `~/Documents/retail/internal/pricingengine`
- `~/Documents/retail/internal/cloud/pricing/service.go`
- `~/Documents/retail/internal/cloud/commercial`
- `~/Documents/retail/internal/store/pricing`
- `~/Documents/retail/internal/store/pos/discount_engine_path.go`
- `~/Documents/retail/internal/checkoutbenefits`
- `~/Documents/retail/internal/AUDIT_ARCHITECTURE_CLEANUP.md`

### Retail final-product backend

- `~/Documents/retail/final-product/backend/crates/pricing-engine`
- `~/Documents/retail/final-product/backend/crates/cloud-commercial/src/handlers.rs`
- `~/Documents/retail/final-product/backend/crates/cloud-commercial/src/repo.rs`
- `~/Documents/retail/final-product/backend/crates/cloud-commercial/src/module.rs`
- `~/Documents/retail/final-product/backend/crates/store-edge/src/pricing.rs`
- `~/Documents/retail/final-product/backend/crates/cloud-hub/tests/dependency_boundaries.rs`

### Current Itulah

- `backend/src/cloud/domain/commercial.rs`
- `backend/src/edge/domain/commercial.rs`
- `backend/src/cloud/postgres/commercial.rs`
- `backend/src/cloud/postgres/sales.rs`
- `backend/migrations/postgres/0003_commercial_sales.sql`
- `backend/migrations/sqlite/0002_edge_sync.sql`
- `backend/tests/pos_integration.rs`
