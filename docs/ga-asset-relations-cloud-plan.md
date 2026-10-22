# GA asset relations — prototype and cloud implementation plan

Date: 17 October 2026. Status: proposal, not implemented in cloud.

## Ringkasan keputusan

- **Yang sudah ada:** satu menu Assets, pilihan Kind, sebelas bentuk form, dan relasi aset ke dokumen, servis, inspeksi, repair, penggantian, serta pelepasan.
- **Rilis pertama:** cloud menyediakan daftar terkait per aset dengan pagination; form kontrak bisa memilih aset; halaman detail membuka catatan asal dan membuat pekerjaan dengan aset sudah terisi. Gunakan tabel yang ada.
- **Cakupan banyak aset:** tambahkan tabel penghubung kontrak–aset, validasi jenis/cakupan, serta riwayat perubahan; jangan menggandakan polis untuk setiap mobil.
- **Proses baru:** klaim asuransi, peminjaman dokumen asli, dan pembacaan odometer perlu data serta aturan proses tersendiri.
- **Batas prototipe:** semua data contoh dan perubahan di browser bersifat simulasi. Tidak ada migrasi atau kode cloud produksi yang diubah.

Spesifikasi implementasi dan pemeriksaan teknis di bawah memisahkan rilis pertama dari pengembangan berikutnya.

## Model final: file digital, dokumen asli, dan barang yang dijelaskan

Satu istilah "BPKB" menyebut tiga objek yang perlu dibedakan dalam antarmuka:

```text
Mobil AST-000241                 pemegang barang: Dimas
       ↑ DOCUMENT_OF
Dokumen DOC-000091 (BPKB)        nomor, penerbit, tanggal, arsip digital
       ↑ ORIGINAL_OF
BPKB asli ORG-000091             pemegang asli: Sari; lokasi: brankas A-02
       ↑ CUSTODY_OF
Riwayat serah terima             dari siapa, kepada siapa, kapan, untuk apa
```

**BPKB asli dapat dikelola sebagai barang/dokumen berharga milik kendali GA.** Tampilan usulan menempatkannya di `Assets → Kind: Controlled documents`. Ini adalah pintu untuk menjaga dokumen asli; keputusan akuntansi bukan ditentukan oleh keberadaannya di menu Assets. Jangan membuat `fixed_asset` palsu atau klasifikasi keuangan baru hanya untuk menyimpan pemegang BPKB.

`Files → BPKB` membuka metadata dokumen dan scan yang sama. Bagian Physical originals di dalamnya menunjuk ORG-000091. Sebaliknya, ORG-000091 menunjuk DOC-000091 dan mobilnya. Semua layar membaca pemegang asli dari **riwayat custody yang sama**. `fixed_asset.holder` tetap pemegang mobil, tidak ikut berubah saat BPKB diserahkan.

Tampilan Assets yang diperluas membutuhkan pembacaan gabungan dengan identitas bertipe, misalnya `GET /api/v1/ga/managed-items?kind=controlled_documents`. Hasil membawa `object_kind: FIXED_ASSET | DOCUMENT_ORIGINAL`, `object_id` dan route detail yang benar. Endpoint `/ga/assets` yang ada tetap berisi fixed assets; jangan mengubah kontraknya diam-diam. Filter dan pagination pembacaan gabungan harus dilakukan server, bukan menyatukan dua halaman pertama di browser. Original tetap satu record di `ga_document_original`, tidak disalin ke `fixed_asset`.

### Objek lain yang terlihat di beberapa tempat

| Kasus | Catatan yang berbeda | Pemilik fakta / sumber data |
|---|---|---|
| Mobil + BPKB/STNK | Barang, dokumen, dokumen asli | Pemegang mobil pada aset; pemegang asli dari custody; nomor/validitas pada dokumen. |
| Tanah + sertifikat | Tanah, metadata sertifikat, lembar asli | Identitas tanah pada aset; nomor sertifikat pada dokumen; pinjam/kembali pada custody. |
| Bangunan + Site | Barang yang dimiliki, tempat operasional | Aset menunjuk site. Site dapat memakai beberapa aset dan juga ruang sewaan. |
| Polis + PDF bertanda tangan | Perjanjian, lampiran bukti | Pihak, masa polis, dan cakupan pada kontrak; scan pada Files, ditautkan sebagai bukti. |
| STNK + urusan perpanjangan | Dokumen berlaku, pekerjaan/biaya perpanjangan | Tanggal berlaku dokumen satu sumber; kegiatan dan tagihan perpanjangan menunjuk dokumen/objek yang sama. Jangan menyalin tanggal sebagai dua reminder yang bersaing. |
| AC/laptop + garansi | Peralatan, bukti garansi | Dokumen garansi menjadi sumber masa garansi yang ditampilkan pada aset; field `specs.warranty` lama perlu direkonsiliasi, tidak otomatis diasumsikan sama. |
| Software + langganan | Lisensi yang dikelola, kontrak komersial | Pemakai/seats pada catatan pengelolaan; term/perpanjangan pada kontrak. Instalasi/perangkat terkait memerlukan hubungan terpisah. |
| Repair + bill | Pekerjaan, transaksi uang | Status kerja di Repairs; jumlah aktual dari baris tagihan Finance yang sudah diposting. |
| Kontrak + tagihan rutin | Kesepakatan, jadwal penerbitan tagihan | Masa kontrak di GA; jadwal billing di template Finance. |
| Supplier di GA/Procurement/Finance | Satu pihak dengan beberapa peran | Satu master supplier yang sudah ada; jangan buat master asuransi/bengkel kedua. |
| Surat serah terima + custody | Bukti tertulis, kejadian fisik | Surat menunjuk kejadian custody; menerbitkan surat saja tidak mengubah pemegang. |
| Permintaan supplies + persediaan | Permintaan/pembelian, stok tersedia | Permintaan tidak menjadi saldo stok; jika ada gudang supplies, saldo berasal dari mutasi stok, bukan jumlah requested. |

### Cara mengisi dan menautkan

1. **Catatan sudah ada:** buka salah satu sisi → Link records → pilih hubungan yang diizinkan → pilih catatan melalui pencarian → tinjau pasangan → Save link. Hubungan muncul dari kedua sisi. Tombol Unlink memutus hubungan saja, bukan menghapus catatannya.
2. **Catatan belum ada:** dari aset → File document / Record repair, atau Link records → pilih jenis → Create new instead. Identitas aset sudah dipilih. Form meminta fakta milik catatan baru saja, lalu membuat catatan dan relasinya.
3. **Dokumen fisik:** pada File document, centang Register a physical original dan isi pemegang/lokasi; atau dari dokumen yang sudah diarsipkan, Register original. Scan boleh menyusul pada model usulan. Metadata dokumen dan custody tetap berbeda.
4. **Pinjam/kembali BPKB:** buka original → Hand over / Return to storage → isi penerima, lokasi, tanggal, tujuan dan batas kembali → Record handover. Catatan lama tetap ada. Semua tampilan pemegang asli berubah dari kejadian yang sama.
5. **Satu polis untuk banyak mobil:** buka polis → Manage covered assets → pilih daftar mobil → Save coverage. Masing-masing mobil menunjuk polis yang sama, bukan salinan polis baru.

### Tambahan cloud untuk mendukung alur ini

- **Tautkan file yang sudah ada.** Kode documents sekarang menerima `links` pada saat `file_document`, bukan editor relasi lengkap untuk dokumen lama. Tambahkan endpoint idempotent untuk tambah/hapus tautan, contoh `PUT /documents/{id}/links/{subject_kind}/{subject_id}` dan `DELETE` pada pasangan yang sama. Validasi keberadaan serta akses subjek, bukan hanya kosakata `subject_kind`. Audit pelaku, waktu dan alasan unlink. Unlink harus terpisah dari retensi/penghapusan dokumen.
- **Pisahkan peran relasi.** `document_link` saat ini hanya menyebut subjek. Jika antarmuka membedakan `DOCUMENT_OF` dan `EVIDENCE_OF`, tambahkan peran yang tervalidasi atau turunkan peran secara eksplisit dari jenis subjek. Jangan menyimpan teks bebas relasi yang berbeda-beda di browser. Relasi pekerjaan lainnya tetap memakai FK khusus milik modulnya; array edges dalam prototipe hanya simulasi, bukan rancangan satu tabel graph universal.
- **Pencarian target yang aman.** Picker mengambil ID, label, jenis objek, dan cakupan melalui API yang memfilter hak akses sebelum pagination. Tautan tidak boleh menunjuk ID yang tidak ada atau record yang pengguna tidak boleh lihat. Cocokkan aset, site, jenis kontrak, dan supplier pada server.
- **Pembuatan terkait harus tuntas.** Form kontekstual mengirim FK sejak create dan server menyimpan data+relasi dalam satu transaksi. Untuk dua penulisan yang memang terpisah seperti upload bytes lalu arsip, kegagalan harus dapat dicoba ulang tanpa membuat dokumen ganda. File document + original registration membutuhkan operasi aplikasi yang konsisten dan idempotent.
- **Original tanpa scan.** Rekomendasi konkret: pertahankan `document.document_id` sebagai identitas dokumen dan `document_link` sebagai relasinya, tetapi izinkan `document.file_id` kosong untuk dokumen yang belum dipindai. Tambahkan operasi pencatatan metadata (misalnya `/ga/document-records`) yang meminta nama dokumen, bukan nama file palsu. `ga_document_original.document_id` tetap menunjuk record itu. DTO baru membawa lampiran opsional dan membedakan `NO_SCAN` dari `FILE_UNAVAILABLE`; pembacaan memakai LEFT JOIN ke `stored_file`. `FileDocumentRequest` dan DTO `Document` lama tetap dilayani untuk dokumen berfile selama masa transisi, termasuk filter daftar lama dan perilaku download yang eksplisit. Saat scan tersedia, tautkan `stored_file` ke document_id yang sama melalui operasi attach yang tervalidasi. Untuk beberapa lampiran/versi, lanjutkan ke tabel attachment, bukan membuat ulang metadata dan custody. Jangan menggunakan `file_id` atau nama objek storage palsu.
- **Jenis pemegang.** Pemegang asli dapat orang internal, pihak luar, atau lokasi simpan. Simpan referensi pihak yang bertipe serta lokasi fisik terpisah; jangan memaksa bank/pihak luar menjadi employee dan jangan menyamakan nama brankas dengan orang yang bertanggung jawab. Nama bebas dalam prototipe hanya memudahkan demonstrasi.
- **Sumber tanggal yang tunggal.** Pilih fakta pemiliknya per kasus. Berkas polis membaca masa dari kontrak; kartu aset membaca garansi dari dokumen yang ditetapkan; perpanjangan STNK menunjuk dokumen berlaku. Migrasi perlu menandai perbedaan data lama untuk ditinjau, bukan menimpa diam-diam.

Detail custody, kontrak banyak aset, dan API pembacaan di fase berikut mengikuti keputusan ini.

The prototype is `ga-asset-relations-prototype.html` at the repository root. All records and writes in it are local sample data. Its insurance claims, physical-document custody, kilometre service calculation, multi-asset coverage and contextual links show proposed behaviour, not existing production capabilities.

## Intended product behaviour

Keep the ten GA destinations. Assets has the existing Kind filter; do not make a sidebar destination or database table for every asset type. A vehicle, AC and laptop each remain one `fixed_asset` record, described through `asset_class.build` and validated `specs`. The proposed Controlled documents view adds a different managed-object kind, backed by original-document custody records as described above; it is not a twelfth financial asset build.

Opening an asset shows sections in one sheet, following the current Central design system: identity and holder; documents; contracts and insurance; service schedule and inspections; repairs and claims; handover and movement; related bills. A related row opens the original record as a layer. Closing it returns to the exact parent asset and list scope. Empty sections have an empty state. Actions populate the asset and location before opening the composer.

The general Repairs list and an asset's related repairs read the same repair records. Documents are linked, not copied. A service contract that applies to a site must not be presented as explicit coverage of every asset there. Distinguish asset coverage from site-wide applicability.

## What the current code actually provides

| Area | Existing source | Current limit |
|---|---|---|
| Asset classification and forms | `backend/src/cloud/domain/ga.rs`, `asset_class.build`, `fixed_asset.specs` | Eleven builds already exist; no new asset-type hierarchy is required. |
| Asset detail | `backend/src/cloud/postgres/ga_assets.rs::GaAssetHub`, `ga_asset_hub` | Returns `asset`, `events`, `documents`, `related_cost_minor`; no related record lists. |
| Asset API | `backend/src/cloud/http/ga.rs::asset` | `GET /api/v1/ga/assets/{asset_id}`. Existing asset site authorization must continue. |
| Documents | `document_link` with `subject_kind='asset'` and asset UUID as text | Upload and metadata already link to an asset; physical originals and custody movements are separate missing facts. |
| Contract relationship | `ga_contract.asset_id`, `RecordGaContractRequest.asset_id` | One asset reference exists. Its original description is maintenance. Frontend `contracts/composer.tsx` sends `asset_id: null`. Validate and extend intended insurance/permit semantics before exposing them. |
| Maintenance | `ga_maintenance_task.asset_id`, `ga_inspection.asset_id`, `ga_repair.asset_id` | Relations exist; hub does not aggregate them. Tasks can alternatively target a site. Repairs can target a site without an asset. |
| Replacements and disposals | `ga_replacement.old_asset_id/new_asset_id`, `ga_disposal.asset_id` | Reuse existing workflows, expose related records without inventing parallel lifecycles. |
| Money | Posted supplier bill lines reference asset/repair/contract/request | `related_cost_minor` currently sums posted direct-asset and repair lines only. It is not total lifetime cost including insurance; do not relabel it as such. |
| Kilometres | Vehicle `specs.odo` is text; tasks support `KM` | There is no odometer-reading history or computed next-due kilometre threshold. |
| Letters | Manual letters are free text; system letters have source subjects | Do not turn free-text letter forms into required stock/asset pickers. Add optional contextual links independently. |

## Phase 1 — connect existing records

This phase connects existing records. By itself it does not satisfy the physical-BPKB-holder requirement: the core release for that requirement also includes the metadata-only document, physical-original and custody work specified below. Claims and odometer history can follow separately.

### Reads and API contract

Keep the existing asset hub response fields and semantics. Add `related_summary` with counts for contracts, tasks, inspections, repairs, replacements and disposals. A count is an exact authorized query result, never the length of a capped preview.

Proposed new endpoint, not present today:

```http
GET /api/v1/ga/assets/{asset_id}/related?kind=repairs&limit=20&cursor=...
```

Allowed `kind` values initially: `contracts`, `tasks`, `inspections`, `repairs`, `replacements`, `disposals`, `bills`. Return a typed page for each kind with `rows`, `total`, `next_cursor` and deterministic ordering using an immutable tie-breaker. Use existing typed rows where suitable, or explicit lightweight summaries; avoid a loosely typed universal graph API.

The frontend loads summary and only the sections actually needed. Existing document/event fields can remain for backward compatibility. Consider separately paginating them if their size becomes a concern. Never fetch an unbounded per-asset lifetime history as a single enlarged hub response.

Queries:

- Repairs: `ga_repair.asset_id = requested asset`.
- Inspections: `ga_inspection.asset_id = requested asset`.
- Tasks: direct `ga_maintenance_task.asset_id`; optionally show site tasks in a separately labelled site section, not as direct asset tasks.
- Contracts: direct asset reference initially. Return other applicable site-wide contracts separately with a `relation_kind` such as `SITE_APPLICABLE`, preserving the scope rule.
- Replacements: both `old_asset_id` and `new_asset_id`; label which side the asset occupies.
- Disposals: direct `asset_id`.
- Bills: authorized posted direct-asset and repair expense lines, with invoice and line IDs and explicit origin. Preserve the current aggregate calculation and prevent double counting.

### Writes and UI

- Expose the existing single `asset_id` field in contract creation/editing for supported contract types. Add server validation for asset existence, contract type, compatible class/build and site/coverage rules. Do not rely on the picker for validation.
- Add `asset` scopes to existing list APIs where useful, ensuring the scope is applied in SQL before pagination and totals. Do not filter the first downloaded page in the browser.
- Add contextual composers from the asset sheet: repair, maintenance, inspection and contract link; populate asset and site. Site-targeted work remains valid without an asset.
- Use the navigation registry and `AppLink`/sheet search state. Back and Esc return one layer at a time; opening the same subject reuses its layer.
- On write, invalidate asset summary, relevant related page, the global register, location hub and GA overview as applicable.

### Authorization, finance and indexing

Authorize access to the asset before fetching related rows. Apply each related record's existing visibility and contract coverage rules, including site scope and Finance permissions. Do not leak inaccessible record names or counts through the hub. Hide unauthorized Finance sections; do not substitute a misleading zero.

Inspect existing indexes before adding any: repair/task/inspection and the contract asset reference already have indexes in migrations. Add only missing access paths justified by the new queries, for example the replacement's new-asset side. Follow actual query ordering and query plans.

No GA action posts journals. Posting, capitalization, depreciation and disposal accounting stay under the existing Finance workflows.

## Phase 2 — one contract covering several assets

Use a join table rather than an array in JSON:

```text
ga_contract_asset
  contract_id       FK ga_contract
  asset_id          FK fixed_asset
  relationship      COVERED | MAINTAINED | PERMITTED | LEASED
  linked_at         timestamptz
  linked_by         session identity
  PRIMARY KEY (contract_id, asset_id, relationship)
```

Keep applicability (`site_id` / `site_scope`) distinct from the explicit asset roster. A cross-site policy needs an explicit, validated coverage model; do not silently widen the existing contract's authorization. Vehicle insurance currently expects a site, so multi-site fleet policies require a deliberate extension of those rules.

Suggested transition:

1. Backfill non-null `ga_contract.asset_id` into the join table, choosing the relationship from contract type and rejecting unmappable historical rows for review.
2. Route all writes through one application operation. During compatibility, the join is canonical and the legacy single field is a derived projection only for a single linked asset. Multi-asset records have no misleading single-asset projection. Old clients attempting a single-asset edit on a multi-asset contract receive an explicit conflict.
3. Switch reads and clients to the join table, then remove the legacy field after compatibility support ends.

Proposed endpoints:

```http
GET /api/v1/ga/contracts/{contract_id}/assets
PUT /api/v1/ga/contracts/{contract_id}/assets
```

The replace request carries `expected_version`, the full roster and relationship kinds. Perform checks and roster replacement in one transaction. Reject incompatible assets, unauthorized scope, duplicates and stale versions. Audit added and removed links. Update the contract and asset hubs from this same canonical relation.

For property coverage, distinguish an owned building asset from a Site and its contents. This model must not require creating a fictional building asset for rented premises.

## Phase 3 — new business records shown in the prototype

These are additions, not just changes to the hub's response.

### Insurance claims

Introduce `ga_insurance_claim` with claim ID/number, insurer reference, policy contract ID, incident date, description, lifecycle, reported/claimed/approved amounts and currency, creator, timestamps and optimistic version. Use `ga_insurance_claim_asset` if an incident affects multiple assets and `ga_insurance_claim_repair` to relate one or more repairs. Documents reuse `document_link` with a supported claim subject kind.

Separate claimed, approved and actually received amounts. Receipts and settlement allocations reference the existing Finance transactions; they are never independently typed as a second cash ledger. A posted repair bill does not mean the insurer paid. Allocate settlement amounts to prevent one receipt being counted against multiple claims in full. Define the lifecycle and approval roles before release; a possible sequence is DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED → SETTLED/CLOSED, with audited corrections and cancellations.

Validate policy type, explicit asset coverage and policy period on the incident date. Preserve coverage evidence after contract renewal, roster changes, expiry or archival; a claim cannot change its historical coverage simply because today's roster changes. Link renewals as predecessor/successor contracts rather than rewriting the old period when history matters.

Claim API family: `/api/v1/ga/insurance-claims`, claim detail, transitions and settlement references. No live endpoint is added by this prototype.

### Physical-document custody

Use `ga_document_original` to identify each physical original or certified copy, linked to `document_id`; include storage location and current custody derived from its events. An asset may have more than one document and a document may have more than one physical copy.

Use append-only `ga_document_custody_event`: original ID, RELEASE/RETURN/TRANSFER, from/to custodian, effective date, reason, actor, optional letter/handover reference. Enforce one current custodian/location per original under transaction locking and version checking. Keep scans and metadata in the existing document store. Add release/return actions and audit; reuse optional Letters links for handover evidence. This does not change an asset's own `holder`.

### Odometer and kilometre service

Use `ga_asset_meter_reading`: asset ID, meter kind, numeric reading, unit, observed timestamp, source, actor and an append-only correction/replacement mechanism. Start with `ODOMETER_KM`; the model may later support generator runtime without pretending hours are kilometres.

Store last completed-service reading and next due threshold on task completion, with the completion/inspection reference. Derive remaining kilometres from the latest valid observation. `next_due` remains a date for date-based tasks; add kilometre-specific fields such as `next_due_reading` rather than converting kilometres into a fabricated date. Existing `specs.odo` may be a migration hint, not trusted history; ambiguous text needs review.

Reject backwards readings unless an explicit, audited meter reset/replacement explains them. Stale or missing readings produce an unknown/stale state, not “not due”. Extend GA Overview with kilometre-due tasks separately from calendar-due tasks.

### Optional letter relations

Add a link relation from a letter to asset/document/custody event as appropriate. Preserve the existing source subject for system letters and the user's free-text writer. Linking a letter does not automatically move an asset or transfer custody; those remain explicit business actions.

## Cost semantics

Keep existing `related_cost_minor` unchanged for compatibility. If showing a new ownership-cost view, name its measures precisely: acquisition/capitalization, maintenance expense, insurance premium, claim recoveries and disposal proceeds are different measures with different periods and recognition. Do not sum them all into one figure or allocate a fleet premium in full to every asset. Multi-asset allocations need an explicit allocation method and reconciliation to the posted source.

## Implementation locations

- Domain rules: `backend/src/cloud/domain/ga.rs` and focused domain modules for new claim/custody/meter workflows.
- Reads/writes: existing `backend/src/cloud/postgres/ga_assets.rs`, `ga_contracts.rs`, `ga_maintenance.rs`; add focused modules for genuinely new tables.
- HTTP: `backend/src/cloud/http/ga.rs` or new route modules registered consistently with it.
- Migrations: use the next free sequence at implementation time; do not reserve a guessed migration number now.
- DTOs: update Rust DTO definitions, then regenerate `frontend-contract`; do not hand-edit generated TypeScript contracts.
- Frontend: `src/lib/queries/ga.ts`, asset/contract/maintenance composers and hubs, existing sheet search/navigation owners.

## Validation required for implementation

1. Every related row can be opened from both the global register and the asset without creating duplicate records; back navigation retains list scope.
2. Pagination returns correct totals and stable cursors, including an asset with more than one page of repairs.
3. GA users see only permitted assets, contracts and costs; direct URLs and related endpoints enforce the same rules, including multi-site cases.
4. Contract writes reject incompatible or cross-scope assets; concurrent roster replacement conflicts rather than losing another user's change.
5. Historic claims retain coverage evidence after renewal/roster edits; posted bills and received settlements remain distinct.
6. Custody cannot release the same physical original twice concurrently; returns preserve the full trail.
7. KM service handles missing/stale readings, threshold crossings and explicit meter replacement.
8. Existing asset, maintenance, contract, overview and Finance handoff integration checks continue to pass; add targeted integration tests around these behaviours, not tests that merely mirror DTO fields.

## Recommended delivery order

For the revised prototype scope, deliver Phase 1 together with typed link editing, metadata-only document records, physical originals and custody events. That is the core needed to answer both “what is this document about?” and “who holds the original now?”. Add Phase 2 for multi-asset policies/contracts. Claims and kilometre scheduling can follow as separate complete workflows. Prototype behaviour is proposed, not an implementation claim.

## Expanded workspace review — 17 October 2026

Owner scope update: business travel stays in HR; physical fixed-asset stocktake is excluded. Obligation reminders remain required. The recommended GA entry for renovation work is Assets → Projects, backed by a link to the existing Finance contractor-project identity rather than a duplicate project/CIP ledger.

The local workflow extension now demonstrates that entry, milestone/progress forms, BAST acceptance, defect follow-up, proposed outputs and Finance closeout. Implement operational fields against the existing contractor-project ID (or a uniquely linked GA work row). Do not replace Finance's OPEN/CLOSED accounting state with GA's operational progress state. Dates/PIC/scope/milestones/acceptance/output proposals are additional operational data; advances, settlement and capitalization continue through existing Finance operations.

Reminder identity must name the action and source obligation, including its due date/period/reading threshold. Contract renewal and the corresponding evidence document must not generate duplicate renewal work. Meter reading and payment are different monthly obligations and may each need attention. Derive completion from the source: paid bills, returned originals, completed service, completed milestones and resolved findings stop the corresponding reminder. Snooze has an actor, reason and resume date; it does not complete or change the underlying obligation. The existing scheduler already handles contract/document expiry and bill/tax reminders; extend its source rules, deduplication and recipient routing rather than introducing an unrelated second notification engine.

Expose lot quantity/unit through GA reads as well as registration. Track partial handover/return as quantity events with transactional balance validation. This is separate from the excluded physical stocktake workflow. Supply receipts and consumption need their own quantity balances; approving an order does not prove receipt or consumption.

Monthly utility follow-up needs period identity, meter/invoice due dates, responsible person and canonical links to Finance invoices/settlements. Finance remains the source for posted and actually paid amounts. Routine operating receipts need typed asset/site context and evidence; avoid forcing fuel purchases through a repair record. The prototype's sample feedback controls are not proposed production write permissions.

The embedded letter writer now demonstrates paper editing plus typed references without losing rich text when details change. Production implementation still belongs in the existing React writer/item editor and typed server writes, not in the standalone iframe adapter. The leased-out supplier-bill/received-income mismatch identified in the audit remains a production correction to make; the prototype now shows tenant charges and receipts independently.

The standalone prototype now covers every GA menu, all 11 asset builds / 59 classes, all 17 agreement types, 7 supply categories and 10 letter forms. See `ga-prototype-coverage.md` for sheets, actions and browser checks. The extra breadth does not imply those proposed relationships already exist in cloud.

Service completion needs a canonical history record even when the target is a Site and no fixed asset was inspected. Reuse the existing completion mechanism where it provides that history; otherwise add a site-target completion record rather than inventing an asset solely to satisfy an inspection foreign key. Atomically append completion, update the next calendar/KM due value, and create an optional repair from findings. Fix the asset on an asset-target task; site-target inspections may select only assets at that site. Preserve the completion reference on resulting repairs.

The menu remains compact. Claims, custody, movement, replacement, disposal requests and readings open as connected detail/action sheets, not mandatory new top-level GA menus. Add the corresponding typed write endpoints and paginated detail projections as each workflow is delivered. For financial actions, GA creates drafts or requests; Finance remains the authority for posting, settlement and disposal accounting.

## Letters audit and proposed item references — 17 October 2026

Current cloud distinguishes three transaction-sourced kinds (`GOODS_RECEIPT`, `DELIVERY_NOTE`, `SUPPLIER_RETURN`) from `GENERAL`. The ten manual forms are `GENERAL`; `draft_letter` uses the letter's own ID as its subject. `NewLetterSheet` sends an empty `subject_id`, and `WrittenItem` / `itemsOf` retain only ID, name, quantity, unit and note. Therefore typing BPKB or an asset name currently does not create a validated reference to that record. The writer reference prototype follows this same free-text behaviour.

Documents can be filed against the `letter` subject through the existing document-link vocabulary. This is supporting documentation attached to a letter; it is not equivalent to identifying a BPKB original or asset as a line item handed over. The current item editor / writer side panel does not provide that item reference selector.

The GA prototype now demonstrates manual item selection for goods out, goods in, handover and collection authority: existing asset, physical original, document/copy, or other free-text item. It also separates supporting work context from the contents handed over. These proposed selectors are not yet production behaviour. The reference writer file remains unchanged.

For implementation:

1. Add optional typed item references while preserving the printable snapshot (`name`, quantity, unit and note) and backward compatibility with unlinked text items. Use supported record kinds and validate referenced IDs/access; opaque JSON storage alone does not enforce this. Keep a normalized relation/index keyed by letter and line ID for reverse lookups, transactionally synchronized with canonical item saves.
2. Keep content references and supporting context references distinct. A BPKB original line may point to its document metadata; that document identifies the vehicle. Do not claim the vehicle itself was handed over merely because its BPKB was.
3. Extend the draft form, `itemsOf`, paper editor and side panel together. Editing wording must preserve the stable line ID and optional reference; choosing another record explicitly refreshes the draft's printable snapshot. Add source links and reverse Letters sections in asset/document/original/work hubs.
4. Validate quantity, unit, source compatibility and unique individual tracked items. A serialized asset / physical original line has quantity one; generic document copies and free-text items may have other positive quantities. New free-text items do not silently create fixed assets, stock receipts or document originals. Offer separate registration when tracking is required.
5. At issue, freeze the printable snapshot and its validated references according to letter evidence rules. Later master-data renaming must not rewrite issued paper. Corrections follow existing void/reissue behaviour; historical identity must survive archival. Saved templates must continue excluding item references and context IDs, as they already exclude items.
6. Letter issue alone does not execute asset movement, custody transfer or inventory posting. The actual workflow may create/link a draft evidence letter atomically; an independently written letter can later be selected as evidence by a validated movement/custody action. Preserve the existing system-letter source, numbering and freeze semantics.

Suggested implementation owners: `frontend-hub/src/screens/letters/{new-letter,forms,writer}.tsx` (forms is `.ts`), `backend/src/cloud/postgres/letters.rs`, related HTTP routes / DTOs, and the new original/custody domain. Regenerate `frontend-contract` after DTO changes. No such cloud migration or production implementation is included in this prototype update.
