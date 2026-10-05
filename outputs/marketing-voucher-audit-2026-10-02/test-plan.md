# Rencana verifikasi perbaikan marketing/voucher

Pengujian lokal, tidak memakai database produksi. Tes Postgres memakai `sqlx::test` dengan database per-test di PostgreSQL lokal.

| Risiko | Bukti regresi yang diperlukan |
| --- | --- |
| Shared campaign budget | Dua rule stackable mengambil total maksimal remainder; scenario alternatif tidak menghabiskan budget scenario lain; rule cap juga tetap berlaku |
| Shared campaign max uses | Jumlah aplikasi rule mengikuti definisi uses ledger; campaign tersisa satu use tidak menerapkan dua rule |
| Free item | Nilai item gratis tidak melewati sisa budget/cap; item indivisible ditolak jika tidak cukup |
| Coupon lintas toko | Limited coupon wajib authorization pusat yang atomik, atau ditolak eksplisit saat jaminan tidak tersedia; unlimited coupon normal tidak rusak |
| Voucher tanpa hold | Cloud parser menolak VOUCHER tanpa hold dan authorization pada tender bukan voucher |
| Voucher binding | Salah amount, site/code, reuse hold pada sale lain ditolak; replay identik tidak mengurangi saldo dua kali |
| Partial tender | Hold 100.000 tidak boleh didebit seluruhnya oleh tender 20.000 tanpa partial-settlement yang eksplisit |
| Manual redeem | Tidak mengambil live holds; available remainder boleh diambil; expiry/release dan retry konsisten |
| Loyalty conversion | 1 poin tidak menghasilkan nilai request arbitrer; conversion server konsisten dengan konfirmasi member dan retry |
| Allocation concurrency | Dua rebalance dengan snapshot berbeda tidak menghasilkan total grants di atas limit |
| Invariants | Voucher balance sama dengan movements; tidak ada live holds melebihi balance setelah direct redeem; redemption points sama dengan ledger |

Hasil final dan batas coverage akan dicatat di `fix-validation.md` setelah patch ditinjau dan tes selesai.
