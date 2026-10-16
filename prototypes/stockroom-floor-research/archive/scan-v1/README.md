# Stockroom → shop floor: prototype dan riset

Proposal lokal, 11 Oktober 2026. Data contoh saja; tidak memanggil API stok.

Buka di server toko yang sudah berjalan:

http://store.localhost:5482/prototypes/stockroom-floor.html

Atau buka `stockroom-floor-prototype.html` dari root repository sebagai standalone. Tidak perlu install package atau akses Internet. Sumber modular berada di folder ini.

Walkthrough:

1. Klik **Scan 5 tag contoh**, lalu coba **Tag ganda**, **Salah lokasi**, dan **Barcode SKU**. Jumlah draft tetap lima.
2. Klik **Tinjau 5 barang**, cek arah/jumlah/saldo, tandai barang tiba, lalu konfirmasi.
3. Lihat **Stok per lokasi** dan **Riwayat perpindahan**.
4. Reset data, scan lima lagi, aktifkan **1 tag gagal saat konfirmasi**, lalu konfirmasi. Empat berhasil; hanya satu tag tersisa untuk retry.
5. Aktifkan **Server toko offline**. Scan tetap menjadi draft, konfirmasi diblokir. Refresh untuk memverifikasi draft bertahan, lalu sambungkan kembali dan retry.
6. Buka **Riset & keputusan UX** untuk perbandingan empat ERP dan tautan sumber resmi.

Riset lengkap: `docs/research/2026-10-11-stockroom-shop-floor-ux.md`.

Verifikasi dan rebuild:

```sh
node --test prototypes/stockroom-floor-research/model.test.mjs
node --check prototypes/stockroom-floor-research/app.mjs
python3 prototypes/stockroom-floor-research/build-standalone.py
```

Build menghasilkan standalone root dan salinan public di `frontend-store-new/public/prototypes/stockroom-floor.html`. Tidak mengubah route atau workflow produksi. Draft/riwayat contoh persisten per origin browser; Reset data contoh mengembalikan dataset awal.
