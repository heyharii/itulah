# Supplier Catalog Operational MVP

**Status:** Implemented and validated  
**Date:** 2026-08-31  
**Scope:** Cloud Supplier, Supplier Item, dan server-authoritative catalog-to-PO

## 1. Keputusan

Supplier Catalog dibuat seperti marketplace sederhana:

```text
Supplier
  └── banyak Supplier Item
          └── dipilih untuk membuat Purchase Order
```

Hanya ada dua master baru:

1. `supplier`
2. `supplier_item`

Operational MVP mencakup:

- Supplier list/create/detail/update/activate/deactivate;
- Supplier Item list/create/detail/update/activate/deactivate;
- current purchase price pada Supplier Item;
- optional link dari Supplier Item ke internal Article;
- pembuatan PO dari canonical Supplier dan Supplier Item IDs;
- server-derived Supplier/item/name/image/price/currency snapshots;
- atomic PO dan downstream DC command; dan
- backward compatibility untuk endpoint, schema, command, dan Edge existing.

Tidak ada:

- Terms Version;
- Sourcing Case, RFQ, Quote, Comparison, atau Award;
- Supplier portal atau Supplier stock;
- bank account, AP, invoice matching, atau payment;
- direct-to-Store procurement;
- hard delete Supplier/Item;
- full Supplier Catalog sync ke DC; atau
- perubahan flow GRN/receiving pada MVP ini.

`SOURCING` tidak menjadi domain baru. Catalog PO selalu memakai existing `origin_kind = DIRECT`.

## 2. Dasar keputusan dari sistem sebelumnya

### Fresh

Fresh paling dekat dengan kebutuhan ini: Supplier master, daftar barang per Supplier, current price, dan PO snapshot.

Yang dipakai:

- Supplier dipisahkan dari barang Supplier;
- kode dinormalisasi dan unique;
- item code unique di dalam satu Supplier;
- exact integer money;
- inactive Supplier/Item tidak dapat dibeli;
- PO menyimpan snapshot; dan
- repository bekerja per row di PostgreSQL.

Yang tidak dipakai:

- nama domain `Sourcing`;
- terms object, MOQ, dan lead-time rules;
- whole-estate in-memory persistence; dan
- crate per entity.

Referensi:

- `/Users/hari/Documents/fresh/crates/supplier-domain/src/lib.rs`
- `/Users/hari/Documents/fresh/crates/cloud-supplier/src/handlers.rs`
- `/Users/hari/Documents/fresh/crates/cloud-supplier/src/pg_repository.rs`
- `/Users/hari/Documents/fresh/crates/sourcing-domain/src/lib.rs`
- `/Users/hari/Documents/fresh/crates/cloud-purchase/src/store.rs`

### Newton

Newton mempunyai Supplier Product, Terms Version, Product Resolution, Sourcing Case, Candidate, Decision, dan immutable PO versions. Itu lebih kompleks daripada kebutuhan Itulah.

Yang dipakai:

- Supplier Item mempunyai identity berbeda dari internal Article;
- link ke Article boleh belum ada;
- PO menyimpan snapshot katalog; dan
- Supplier/item rename tidak mengubah history.

Yang tidak dipakai:

- Terms Version;
- Case/Candidate/Decision;
- quote dan approval workflow; dan
- PO line-version hierarchy.

Referensi:

- `/Users/hari/newton/backend/internal/supplier/domain.go`
- `/Users/hari/newton/backend/internal/catalog/catalog.go`
- `/Users/hari/newton/backend/internal/catalog/sourcing.go`
- `/Users/hari/newton/backend/internal/procurement/procurement.go`

### Current Itulah

Sebelum MVP ini, PO memakai Supplier string bebas:

- `purchase_order.supplier_id text`;
- `purchase_order.supplier_name text`; dan
- `purchase_order_line.article_code` sebagai kode barang Supplier untuk receiving.

Flow command/offline receiving existing sudah bekerja. Karena itu MVP menambah canonical identity hanya di Cloud dan mempertahankan snapshot lama di wire contract.

## 3. Authority

### Supplier Catalog memiliki

- canonical Supplier identity;
- Supplier code/name/contact/address/status;
- canonical Supplier Item identity dan ownership;
- Supplier item code/name/description/image/status;
- current unit purchase price;
- V1 currency `IDR`;
- optional internal Article code; dan
- optimistic concurrency version.

### Procurement memiliki

- PO number dan lifecycle;
- destination DC;
- ordered quantity dan promised date;
- Supplier/Item/price snapshots saat PO dibuat; dan
- downstream command identity.

### DC Edge tetap memiliki

- offline PO copy dari existing command;
- physical arrival/count/verification;
- GRN dan inventory movement facts.

Supplier Catalog tidak memiliki inventory balance, Supplier stock, selling price, tax, AP, atau payment.

## 4. Data model yang diimplementasikan

Migration:

```text
backend/migrations/postgres/0032_supplier_catalog.sql
```

### 4.1 `supplier`

```text
supplier_id              UUID PK
supplier_code            TEXT
supplier_code_normalized TEXT UNIQUE
name                     TEXT
contact_name             TEXT NULL
phone                    TEXT NULL
email                    TEXT NULL
address                  TEXT NULL
status                   ACTIVE | INACTIVE
version                  BIGINT > 0
created_by/created_at
updated_by/updated_at
```

Rules:

- code dan name tidak boleh blank;
- normalized code memakai uppercase trimmed form;
- create default `ACTIVE`;
- update/status menaikkan `version`;
- mutation menyimpan authenticated actor;
- inactive Supplier tetap readable tetapi tidak dapat dipakai untuk PO baru; dan
- tidak ada DELETE endpoint.

### 4.2 `supplier_item`

```text
supplier_item_id              UUID PK
supplier_id                   UUID FK supplier ON DELETE RESTRICT
supplier_item_code            TEXT
supplier_item_code_normalized TEXT
name                          TEXT
description                   TEXT NULL
image_url                     TEXT NULL
unit_price_minor              BIGINT >= 0
currency                      IDR
internal_article_code         TEXT NULL FK article(article_code)
status                        ACTIVE | INACTIVE
version                       BIGINT > 0
created_by/created_at
updated_by/updated_at
UNIQUE (supplier_id, supplier_item_code_normalized)
```

Rules:

- item dimiliki tepat satu Supplier;
- kode item hanya unique di dalam Supplier tersebut;
- kode Supplier Item bukan internal Article/SKU identity;
- price memakai integer minor unit, bukan floating point;
- V1 hanya menerima `IDR`;
- create default `ACTIVE`;
- inactive item tidak dapat dipakai untuk PO baru;
- update catalog hanya memengaruhi PO berikutnya; dan
- tidak ada DELETE endpoint.

### 4.3 Additive PO columns

Header PO mendapat nullable columns:

```text
supplier_ref_id UUID NULL
supplier_code_snapshot TEXT NULL
supplier_name_snapshot TEXT NULL
```

Line PO mendapat nullable columns:

```text
supplier_item_id UUID NULL
supplier_item_code_snapshot TEXT NULL
supplier_item_name_snapshot TEXT NULL
supplier_item_image_snapshot TEXT NULL
supplier_item_version BIGINT NULL
currency CHAR(3) NULL
```

Semua tambahan nullable agar historical rows dan legacy endpoint tetap valid.

Existing fields tetap dipakai sebagai Edge-compatible snapshots:

| Existing field | Makna untuk catalog PO |
|---|---|
| `purchase_order.supplier_id` | Supplier business-code snapshot |
| `purchase_order.supplier_name` | Supplier name snapshot |
| `purchase_order_line.article_code` | Supplier Item code snapshot |
| `purchase_order_line.article_name` | Supplier Item name snapshot |
| `purchase_order_line.image_url` | Supplier Item image snapshot |
| `purchase_order_line.unit_price_minor` | agreed purchase price snapshot |

Catalog update tidak pernah menulis ulang snapshot PO lama.

## 5. HTTP API

### Supplier

```text
GET    /api/v1/suppliers?status=ACTIVE|INACTIVE
POST   /api/v1/suppliers
GET    /api/v1/suppliers/{supplier_id}
PATCH  /api/v1/suppliers/{supplier_id}
POST   /api/v1/suppliers/{supplier_id}/activate
POST   /api/v1/suppliers/{supplier_id}/deactivate
```

### Supplier Item

```text
GET    /api/v1/suppliers/{supplier_id}/items?status=ACTIVE|INACTIVE
POST   /api/v1/suppliers/{supplier_id}/items
GET    /api/v1/supplier-items/{supplier_item_id}
PATCH  /api/v1/supplier-items/{supplier_item_id}
POST   /api/v1/supplier-items/{supplier_item_id}/activate
POST   /api/v1/supplier-items/{supplier_item_id}/deactivate
```

### Catalog-to-PO

```text
POST /api/v1/purchase-orders/catalog
```

Request:

```json
{
  "po_number": "PO-2026-000001",
  "supplier_id": "canonical-supplier-uuid",
  "destination_site_id": "dc-01",
  "notes": "optional",
  "lines": [
    {
      "supplier_item_id": "canonical-supplier-item-uuid",
      "quantity": 100,
      "promised_date": "2026-09-15"
    }
  ]
}
```

Body tidak menerima authoritative Supplier name, item code/name/image, price, currency, line amount, origin kind, atau actor. Semua diturunkan backend. Catalog PO selalu `DIRECT` dan `IDR`.

Response menyertakan:

```text
purchase_order_id
po_number
supplier_id
supplier_code
destination_site_id
activation_command_id
sent_to_origin
```

Existing endpoint berikut tidak diubah:

```text
POST /api/v1/purchase-orders
```

DTO, route shape, direct Rust constructors, dan response legacy tetap backward-compatible.

## 6. Mutation contract

Semua Supplier, Supplier Item, dan catalog PO mutations memakai:

- existing authentication middleware;
- existing role ladder (`SUPERVISOR` minimum untuk non-sales mutations);
- `Idempotency-Key` request header;
- canonical payload digest;
- server-derived `Principal.username` actor;
- stored stable replay response; dan
- typed validation/not-found/conflict responses.

Update dan status mutation juga memakai:

- `If-Match: "<version>"` dalam bentuk strong quoted ETag;
- JSON `null` untuk menghapus optional contact/description/image/Article link; dan
- response `ETag: "<new-version>"`.

GET detail juga mengembalikan current ETag. CORS mengizinkan `PATCH`, `If-Match`, dan `Idempotency-Key`, serta expose `ETag`.

Jika authentication sengaja disabled untuk development, middleware menyisipkan synthetic Admin principal bernama `development`; handler tetap tidak mempercayai actor dari body.

## 7. Catalog-to-PO transaction

Satu PostgreSQL transaction menjalankan:

```text
validate body
-> claim Idempotency-Key
-> resolve exact destination DC owner
-> lock active Supplier FOR SHARE
-> lock every Supplier Item FOR SHARE
-> validate item ownership/status/currency
-> calculate checked line amounts
-> insert PO header and canonical/snapshot fields
-> insert PO lines and canonical/snapshot fields
-> construct existing purchase.order.activate payload
-> validate payload with existing parser
-> insert command and exact-target delivery
-> write activation_command_id
-> store idempotent response
-> COMMIT once
```

Rejected conditions mencakup:

- missing/inactive Supplier;
- missing/inactive Supplier Item;
- item milik Supplier lain;
- duplicate item dalam satu PO;
- empty lines;
- non-positive quantity;
- amount overflow;
- unsupported currency;
- unknown destination DC; dan
- duplicate PO number.

Price/name/image/currency tidak dapat dipalsukan oleh UI karena tidak ada di request contract.

## 8. Existing PO atomicity fix

`backend/src/cloud/postgres/sync.rs::create_purchase_order` mempertahankan signature dan DTO lama, tetapi sekarang:

- destination di-resolve dengan transaction-aware helper;
- command dibuat melalui `issue_command_tx` sebelum commit;
- `activation_command_id` ditulis dalam transaction yang sama; dan
- hanya ada satu final commit.

Dengan demikian tidak ada lagi PO committed tanpa command atau command untuk PO yang rollback.

## 9. Backward compatibility dan Edge

MVP sengaja mempertahankan:

```text
command type: purchase.order.activate
payload: existing PurchaseOrderPayload
Edge SQLite schema: unchanged
Edge PO parser/application: unchanged
GRN/receiving APIs: unchanged
```

Canonical UUIDs tetap Cloud-side. DC menerima snapshot business fields yang sudah dipahaminya. Tidak ada `purchase.order.activate.v2`, SQLite migration, full catalog replication, atau unknown command type yang dapat memblokir old Edge streams.

## 10. Code structure

Files baru:

```text
backend/migrations/postgres/0032_supplier_catalog.sql
backend/src/cloud/domain/supplier.rs
backend/src/cloud/postgres/suppliers.rs
backend/src/cloud/http/suppliers.rs
```

Files integrasi:

```text
backend/src/cloud/domain/mod.rs
backend/src/cloud/postgres/mod.rs
backend/src/cloud/http/mod.rs
backend/src/cloud/http/auth.rs
backend/src/cloud/postgres/sync.rs
```

Layer rules:

- domain Supplier tidak import Axum atau SQLx;
- PostgreSQL module memiliki SQL dan transaction policy;
- HTTP module hanya extract headers/path/body/principal dan map response;
- existing active `cloud/*` architecture dipakai;
- empty legacy root scaffolding tidak dipakai; dan
- tidak dibuat crate baru.

## 11. Operational workflow

### Manage catalog

1. User membuat Supplier.
2. Backend menormalisasi code dan menolak duplicate.
3. User membuka Supplier dan menambah item.
4. User mengubah current name/image/price atau status dengan ETag.
5. Historical PO tidak berubah.

### Create PO

1. User memilih satu Supplier dan active items miliknya.
2. UI mengirim canonical IDs, quantity, dan optional promised date.
3. Backend mengambil current catalog values.
4. Backend menulis immutable PO snapshots.
5. Backend mengirim existing PO command secara atomic ke satu DC.
6. DC menjalankan flow receiving existing tanpa membutuhkan Supplier Catalog penuh.

## 12. Explicitly deferred

Berikut bukan bagian completion MVP ini dan harus menjadi perubahan terpisah bila dibutuhkan:

- GRN Supplier inference dari PO;
- mixed-Supplier GRN validation baru;
- receipt-opened fact;
- Supplier canonical ID pada goods receipt;
- Supplier legacy alias/mapping workflow;
- price history/Terms Version;
- named permission engine di luar role ladder existing;
- generic field-level audit log;
- Supplier screens/frontend; dan
- pagination/search beyond the simple status filter.

Menunda item-item tersebut menjaga MVP fokus pada: **ini Supplier kita, ini barang-barangnya, dan barang itu bisa dibeli melalui PO yang benar**.

## 13. Validation target

Validation implementation harus mencakup:

- `cargo fmt --check`;
- `cargo check`;
- existing purchase-order integration tests;
- existing API/auth flow tests yang relevan;
- migration application through the existing test harness; dan
- `git diff --check`.

Tidak diperlukan perubahan test contract existing untuk endpoint PO lama.

## 14. Completion criteria

Operational MVP selesai bila:

- Supplier dapat dibuat, dilihat, diedit, diaktifkan, dan dinonaktifkan;
- setiap Supplier mempunyai daftar Supplier Items;
- Supplier Item menyimpan current IDR price dan optional Article link;
- stale update ditolak melalui version/ETag;
- mutation actor berasal dari Principal;
- mutation replay idempotent dan changed-payload replay ditolak;
- catalog PO hanya menerima canonical IDs dan quantity;
- semua lines berasal dari satu active Supplier;
- backend menentukan semua commercial snapshots;
- catalog update tidak mengubah PO lama;
- PO, command, command delivery, activation ID, dan replay receipt commit atomically;
- endpoint dan command PO lama tetap bekerja;
- old Edge tidak perlu diubah; dan
- formatting, compile checks, serta relevant existing tests lulus.

## 15. Final shape

```text
Cloud
  Supplier
    ├── Supplier Item A — current IDR purchase price
    ├── Supplier Item B — current IDR purchase price
    └── Supplier Item C — current IDR purchase price

Buyer
  selects Supplier + Items + quantities

Backend
  validates ownership/status
  derives all catalog values
  snapshots Supplier + Item + price into PO
  atomically sends existing PO command to one DC

DC
  receives and works the existing offline PO payload
```

Itulah mempunyai **Supplier Catalog operational MVP**, bukan Sourcing platform.
