# Talenta HRIS — prototipe lokal

Prototipe UI berdasarkan `hr-talenta-inventory.md` (29 September 2026), dengan 141 halaman menu serta Home dan Employee profile. Data seluruhnya sintetis. Laporan sumber tidak diubah.

## Menjalankan

Cara tercepat: buka `index.html` dengan browser. Tidak perlu npm, build, atau internet.

Untuk server lokal (Python 3):

```sh
cd /Users/hari/Documents/itulah/hr-talenta-prototype
python3 -m http.server 8765 --bind 127.0.0.1
```

Buka **http://127.0.0.1:8765**. Hentikan server dengan Ctrl+C. Jika port dipakai, ganti `8765` dengan `8766`.

Folder hasil utama: `/Users/hari/Documents/Codex/2026-09-29/hr-talenta-prototype/outputs`.
Salinan siap pakai: `/Users/hari/Documents/itulah/hr-talenta-prototype`.

## Alur yang dapat dicoba

1. **Home → Employees → Employee list**: cari karyawan sintetis, filter Branch, sortir kolom, pilih baris, ubah kolom, dan pagination (12 karyawan demo).
2. **Employee transfer → Create transfer**: pilih employee, tanggal, tipe transfer, lalu simpan draft dan konfirmasi simulasi. Draft muncul pada tabel dan hilang saat reload.
3. **Time → Time off requests / Overtime requests**: isi form, validasi field wajib, simpan/batalkan draft.
4. **Payroll → Payroll processing**: Set up → Review → Summary. Tidak ada penghitungan atau pembayaran.
5. **Productivity → Forms & surveys**: buat form, tambah/duplikasi/hapus field, simulasikan pengaturan reminder dan distribusi. Builder bersifat demonstrasi; belum memiliki submission renderer.
6. **Company → Assets list**: filter, tambah asset draft, detail/edit, dan hapus simulasi.
7. **Time → Calendar**: navigasi bulan dan form event. Calendar demo menampilkan satu agenda statis; event draft belum dirender ke grid.
8. **Time Tracker**: timer lokal dan manual time entry. Timer tidak disinkronkan ke laporan.
9. **Tampilan demo** di tabel: Data sintetis, Empty state, dan Error state. Cari kata yang tidak ada untuk mencoba no-results.
10. **Export**: unduh CSV sintetis sesuai filter/kolom. **Import**: pilih nama berkas untuk mencoba UI, tanpa membaca atau mengimpor isi file.

## Cakupan dan batas

- Navigasi: Employees, Recruitment, Time, Finance, Payroll, Productivity, Company, Applications, Integrations, Settings (Account, Company, Time, Payroll, Finance, ESS, Users).
- Skema kolom/form/filter berasal dari inventaris. Setiap halaman mempunyai bagian **Skema & batas inventaris**. `COVERAGE.md` merinci halaman dan tingkat cakupannya.
- Halaman yang hanya tercatat tanpa rincian menampilkan penanda **Belum terverifikasi**. Produk eksternal, koneksi integrasi, dan fitur paket tambahan hanya menampilkan batas fitur lokal.
- Bentuk visual, data contoh, serta mesin tabel/form generik merupakan interpretasi prototipe, bukan salinan persis Talenta.
- Form Add employee adalah rancangan demo karena inventaris hanya mencatat tombolnya. Beberapa field yang memiliki aturan kompleks memakai input sederhana. Permission, approval, payroll, pajak, lokasi/peta, auto assignment, dan workflow server tidak dieksekusi.
- Tab tertentu menampilkan variasi skema atau empty state; tidak semua tab memiliki dataset terpisah. KPI dashboard adalah contoh statis dan tidak dihitung ulang dari draft.
- Draft hanya di memori tab browser, tanpa localStorage/cookie/database. Reload menghapus seluruh draft, filter, dan timer. Edit record contoh membuat draft baru; edit draft mengubah draft sesi. Delete menyembunyikan baris dalam sesi.
- Semua aksi menyimpan/menghapus/mengirim ditandai **Simulasi**. Email, undangan, pembayaran, unggahan, API, dan backend tidak terhubung. CSV dibuat di browser dan berisi contoh/draft lokal saja.
- Kalkulator pajak hanya menampilkan validasi/penanda keterbatasan, tanpa angka pajak yang berpotensi disalahartikan sebagai hasil resmi.
- Nama memakai akhiran Demo; alamat email menggunakan `example.invalid`. Identifier sensitif, alamat, koordinat, nomor pajak, nomor rekening, dan nomor telepon tidak diisi.
- CSP `connect-src 'none'` memblokir koneksi API. Tidak ada CDN, font eksternal, analytics, SDK, atau package dependency.

## Berkas

- `index.html`: entry point dan kebijakan koneksi.
- `styles.css`: UI responsif desktop/mobile.
- `app.js`: navigasi, tabel, filter, form, dan simulasi.
- `schema.js`: skema 141 halaman dan cuplikan inventaris.
- `build_schema.py`: generator opsional; hanya membaca laporan sumber. Hasil siap pakai tidak memerlukan generator.
- `COVERAGE.md`: daftar cakupan.
- `QA.md`: hasil pemeriksaan.

Tidak ada file prototipe yang perlu ditaruh di server publik.
