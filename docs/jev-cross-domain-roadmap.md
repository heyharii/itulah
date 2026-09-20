# Roadmap Jev Lintas Domain

## Peran Jev

Jev menjadi lapisan reasoning read-only di atas aturan dan state machine deterministik. Jev menerima evidence set, menjelaskan anomali, menyusun hipotesis, memberi confidence, menentukan pemilik tindak lanjut, dan menyarankan langkah berikutnya. Semua perubahan state tetap memakai endpoint domain, permission, approval, dan audit yang sudah ada.

Codebase sudah memiliki fondasi yang tepat di `backend/src/cloud/http/assistant.rs`: koneksi model, transcript, tool catalogue, dan eksekusi SQL dalam transaksi PostgreSQL `READ ONLY`. Typed report engine berada di `backend/src/cloud/reports`. Fondasi ini diperluas dengan curated evidence tools; Jev tidak diberi arbitrary write.

## Prioritas

### 1. Inventory Exception Explainer

Menjelaskan missing stock, gain/loss, selisih count, RFID anomaly, transfer yang belum selesai, allotment/fulfillment mismatch, dan sync divergence.

Authority tetap pada movement ledger, count, conservation rules, pool projection, dan lifecycle transfer. Jev tidak menghitung ulang kuantitas atau membuat adjustment, disposal, dan write-off.

Evidence utama: `backend/src/cloud/domain/inventory.rs`, `movement.rs`, `observation.rs`, `count.rs`, `allotment.rs`, `integrity.rs`, serta `backend/crates/inventory-time-machine`.

### 2. Procurement and Receiving Exception Packet

Menggabungkan PO, receipt, accepted quantity, supplier invoice, tag/EPC, verification, price amendment, serta histori supplier menjadi satu kasus yang dapat diperiksa Procurement atau DC.

Three-way matching, quantity tolerance, FIFO costing, dan receiving lifecycle tetap deterministik. Jev hanya menjelaskan mengapa dokumen tertahan dan bukti apa yang perlu diperiksa.

Evidence utama: `backend/src/cloud/domain/three_way.rs`, `costing.rs`, `supplier.rs`, payables flow, serta workflow `frontend-dc-new`.

### 3. Commercial, Promotion, and Price Health

Menjelaskan activation lag, guardrail breach, campaign underperformance, publication discrepancy, dan kemungkinan pengaruh stock availability atau cakupan site.

Pricing engine, offer eligibility, frozen product scope, guardrails, dan publication state tetap menjadi authority. Jev tidak memublikasikan harga, mengganti campaign, atau menentukan eligibility pelanggan.

Evidence utama: `backend/src/cloud/domain/commercial.rs`, `backend/src/cloud/http/performance.rs`, `campaigns.rs`, dan `backend/crates/pricing-engine`.

### 4. HR Attendance and Payroll Preflight

Menjelaskan missing punch, pola keterlambatan, konflik attendance dengan leave/overtime, payroll preflight, kontrak kedaluwarsa, dan data pegawai yang belum lengkap.

Attendance evaluator, roster, approval, payroll state machine, dan maker-checker tetap berwenang. Jev tidak menghitung pajak/payroll, mengambil tindakan disiplin, atau menyetujui leave, overtime, payroll, maupun hiring.

Catatan penting: `backend/src/cloud/http/punch.rs` belum menggabungkan leave/overtime secara lengkap. Sampai gap itu ditutup, Jev harus menyebut status absence sebagai provisional.

Evidence utama: `backend/src/cloud/domain/attendance`, `employment`, `pay`, `leave`, `overtime`, dan `hire`.

### 5. DC and Logistics Queue Triage

Menjelaskan queue yang menua, wrong destination, short shipment, expected-vs-scanned EPC, dan koli/box/consignment yang tertahan.

Pick, pack, freeze, containment, dispatch, fulfillment, dan sync lifecycle tetap deterministik. Jev hanya mengarahkan kasus ke pemilik dan langkah pemeriksaan berikutnya.

Evidence utama: `backend/src/edge/outbound.rs`, `contracts.rs`, cloud allotment/commitment/fulfillment, dan `frontend-dc-new`.

### 6. Customer, Member, and Loyalty Support

Menyusun penjelasan berbasis ledger untuk points, redemption, refund, status member, duplicate redemption, points negatif/kedaluwarsa, dan refund-link mismatch.

Points ledger, voucher, segment definition, dan transaction workflow tetap authority. Jev tidak mengubah customer, segment, points, atau melakukan redemption.

Evidence utama: `backend/src/cloud/http/customer.rs`, `member.rs`, migrations member/segment/points, serta `frontend-customer`.

### 7. Security, Fraud, Audit, and Sync Triage

Menemukan pola void/return/refund berulang, cash shortage, failed authentication, cross-site access, device anomaly, sync dead-letter, dan checkout exception.

RBAC, reach, device/session, sync fail-closed, serta till/payment equations tetap authority. Jev hanya membuat alert dan investigation packet; tidak boleh menangguhkan user/device, memblokir sale, revoke, atau membuat adjustment.

Evidence utama: `backend/src/cloud/http/audit.rs`, `sync_health.rs`, cloud/edge auth, fingerprint, PIN, till, dan checkout exceptions.

### 8. Document Intake and Operational Support

Mengklasifikasikan dan mengarahkan attachment, menyarankan duplicate/missing page/record link, meringkas discussion atau record history, serta membuat draft surat.

Sender/source rules, deduplication, archive key, link confirmation, dan issue/void surat tetap deterministik atau disetujui manusia. Konten dokumen diperlakukan sebagai data, bukan instruksi.

Evidence utama: statement intake, documents, letters, discussion, records, chat, dan notifications. OCR/extraction belum tersedia dan menjadi pekerjaan lanjutan.

### 9. Executive Cross-Domain Insight

Menggabungkan snapshot sales, inventory, commercial, DC, people, finance, dan sync menjadi perubahan utama, hipotesis, serta tindakan yang perlu ditinjau. Semua angka berasal dari typed reports dengan snapshot dan query version; Jev tidak menghitung KPI secara bebas.

Ini dilakukan setelah evidence/citation contract dan evaluasi domain tersedia.

## Output contract

```text
schema_version
case_type
case_id / record_ids
evidence_refs[]
deterministic_facts[]
hypotheses[] { label, confidence, supporting_refs[] }
recommended_next_step
owner_role
approval_required
privacy_class
model_version
created_at
expires_at
```

Keputusan reviewer disimpan sebagai feedback untuk mengukur precision per case type dan mengatur confidence threshold.

## Confidence

- `>= 99%`: boleh memberi label otomatis untuk kasus rendah risiko seperti duplicate/timing, tanpa mutation.
- `95–99%`: rekomendasi kuat kepada pemilik proses.
- `80–95%`: hipotesis untuk penyelidikan.
- `< 80%`: tampilkan bukti yang kurang; jangan mendorong tindakan.

Semua keputusan terkait uang, stok, pegawai, akses, harga, atau pelanggan tetap memerlukan rule dan/atau approval domain meskipun confidence tinggi.

## Larangan

Jev tidak boleh mengontrol:

- jumlah, saldo, journal, atau posting ledger;
- movement, count correction, disposal, dan write-off inventory;
- penerimaan PO, supplier payment, bank/tender match;
- tax dan statutory payroll;
- pricing, discount, eligibility, dan campaign publication;
- auth, RBAC, reach, sync watermark, dan device suspension;
- leave, overtime, payroll, discipline, dan hiring;
- customer/member/points mutation;
- legal letter issuance;
- arbitrary SQL write;
- secret atau data lengkap bank, NIK, biometric, dan credential RFID.

## Urutan implementasi

1. Tambahkan evidence reference dan common output contract ke assistant read-only.
2. Inventory exception explainer.
3. Procurement/receiving dan DC queue packet.
4. Commercial performance explanation.
5. HR attendance/data-quality dan payroll preflight.
6. Security/fraud alert-only digest.
7. Customer/loyalty support summary.
8. Document intake setelah content extraction tersedia.
9. Executive insight setelah evaluasi lintas-domain stabil.

Setiap tahap memerlukan curated read tools, evaluation set, model timeout/fallback, PII redaction, prompt-injection treatment, evidence citations, dan reviewer feedback. Jev tetap cloud-side; edge, handheld, tablet, dan POS hanya mengirim fakta melalui sync.
