# Film "Batas mundur alur barang": naskah

9 Oktober 2026. Format sama dengan film PO dan Outbound: narasi Charon (Indonesia), label dan tombol tetap English, audiens klien dan tim internal. Visual: halaman "How far back" dari `reversibility-prototype.html`, digambar ulang dengan token hub (bukan rekaman layar), di `video/src/ui/howfar.tsx` dan `video/src/film/back/`. Aturan: `2026-10-09-goods-flow-reversibility-map.md` dan `2026-10-09-final-issue-model.md`.

Recall count belum ada di aplikasi (tag "Not in the app"). Film menyebutnya sekali di Bab 2 dan menampilkannya sebagai aturan target. Baris yang terkunci tidak memakai tag "In the app", supaya tidak terbaca seolah tombol Recall sudah ada.

Status: kelima bab dibuat dan dirender jadi satu film: `video/out/Film-3-Batas-mundur.mp4`. Bab 2 juga tersedia sendiri sebagai tes awal: `video/out/Film-3-Batas-mundur-Bab2-tes.mp4`.

## Bab 1 · Empat kata, satu aturan

1. Setiap langkah barang di Central punya batas mundur.
2. **Back** artinya meninggalkan layar yang belum disimpan. Dokumen yang sudah tersimpan tidak ikut batal.
3. **Recall** menarik count yang belum diterima reviewer.
4. **Cancel** atau **Close remaining** menghentikan permintaan yang belum terjadi.
5. **Move back**: gudang membalik kerja fisik, selama barang belum berangkat.
6. Di sampingnya ada **Edit**, **Recount**, dan koreksi: revisi yang tercatat, hitung ulang, dan dokumen baru.
7. Aturannya satu. Setelah receipt, stok, atau pengiriman tercatat, perbaikannya selalu catatan atau dokumen baru.

Visual: Tab Four verbs: tujuh baris menyala saat disebut, lalu catatan "The rule."

## Bab 2 · PO → DC

1. Barang dari PO tiba di DC, dan gudang mulai menghitung.
2. Selama count belum di-**Submit**, angkanya masih bisa diubah. Kedatangannya tetap tercatat.
3. Setelah Submit, count menunggu diterima oleh pembuat PO.
4. Selama belum diterima, penghitung bisa menariknya kembali dengan **Recall**.
5. Tombol Recall belum dibangun di aplikasi. Yang ditunjukkan di sini adalah aturannya.
6. Count lama tidak dihapus, tapi tersimpan sebagai **Recalled**. Stok tidak berubah.
7. Hitungan barunya tetap untuk kedatangan yang sama, bukan kiriman kedua.
8. Pembuat PO juga bisa meminta **Recount**. Count lama tetap tersimpan.
9. Lalu pembuat PO menerima count-nya, dengan **Partial receive** atau **Close short**.
10. Begitu diterima, receipt dan stok tercatat.
11. Di sinilah garis merahnya. Setelah diterima, Recall terkunci.
12. Kalau ternyata ada yang beda, jalannya lewat bukti baru, atau pemeriksaan oleh Inventory.
13. Barang yang salah atau berlebih dikembalikan lewat **Return PO**. Tidak ada yang dibuka ulang.
14. Dengan Partial receive, sisa 15 di PO tetap terbuka untuk kedatangan berikutnya. Close short menutupnya.

Visual: PO-041026-010, Garmen AA, UD: 600 dipesan, 585 dihitung, 15 Not as Ordered. Submit, Recall (tag Not in the app), Recount, Partial receive, garis merah di "Accepted · stock recorded", Return PO.

## Bab 3 · DC → toko

1. Di jalur DC ke toko, barang yang sudah di-pick atau di-pack masih bisa dikembalikan gudang dengan **Move back**.
2. Bisa juga sebagian. Kalau 40 sudah berangkat, 40 itu tetap terkirim.
3. Sisa 60 masih bisa di-Move back, atau ditutup MD dengan **Close remaining**.
4. Garis merahnya di **In transit**. Yang sudah berangkat tidak bisa ditarik.
5. Kalau ada yang salah di kiriman, ketahuannya saat toko menghitung.
6. Receipt toko langsung tercatat begitu di-Submit, jadi tidak ada Recall. Jalannya **Recount** atau koreksi baru.
7. Allotment yang sudah selesai tidak dibuka lagi. Gantinya Return to HO atau allotment baru.

Visual: ALT-00000004 untuk C001 · Cikupa: Picked, Packed, Dispatch part (40), sisa 60, In transit (garis merah), toko menghitung 98 dari 100, Completed, Allotment closed.

## Bab 4 · Retur

1. Retur dari toko diminta oleh MD. Toko tidak membuatnya sendiri.
2. Diminta 20, toko mengirim 15. Sisa 5 tetap terbuka.
3. DC menerima 15 dari 15. Itu lengkap, bukan kekurangan receiving.
4. Retur ke supplier bisa dibatalkan selama belum keluar. **Cancel** membebaskan stok dan reservasinya, bukan cuma mengganti status.
5. Setelah diserahkan ke supplier, retur terkunci.
6. Yang tersisa adalah penyelesaiannya: **Replacement**, **Refund**, **Credit note**, atau **Close short**.

Visual: RHO-000012 (C004 · Bumiayu): diminta 20, dikirim 15, diterima 15. Lalu RS-00000007 ke supplier: Cancel (tag To design), Handed over (garis merah), Settlement open.

## Bab 5 · Yang tidak bisa mundur

1. Ringkasnya, delapan hal ini tidak bisa mundur.
2. Count yang sudah diterima, receipt yang sudah menggerakkan stok, dan kiriman yang sedang jalan.
3. Receipt toko atau DC setelah Submit, dan dokumen yang selesai, ditutup, atau dibatalkan.
4. Kehilangan atau penyesuaian stok yang sudah diposting, barang yang sudah di supplier, dan penyelesaian yang sudah ditutup.
5. Kalau baru sebagian yang diproses, batasnya hanya untuk bagian itu. Sisanya masih bisa ditarik, diubah, atau ditutup.
6. Kalau Recall dan Accept terjadi bersamaan, hanya satu yang menang. Yang lain ditolak dengan alasannya.
7. Dan kalau koneksi putus lalu dikirim ulang, hasilnya tetap sama. Bukan Recall, bukan kiriman kedua.

Visual: Tab Cannot go back (8 baris) dan catatan "Partly processed", lalu dua kasus tepi: Recall bersamaan dengan Accept, dan retry setelah koneksi putus. Ditutup logo Central.

## Rencana ganti layar ke prototype hub (menunggu "lanjut" dari Hari)

Sumber visual baru: `reversibility-hub-prototype.html` (rail 68 + kolom departemen 232, sheet, dialog, tabel, board, app toko dalam frame HP). `reversibility-prototype.html` tetap hanya penjelas konsep. Belum ada yang dirender; menunggu Hari menyetujui prototype ini.

Yang dipakai ulang dari film PO dan Outbound: AppWindow (shell hub), Camera, Band, Caption, Sheet, Dialog, Toast, Pointer, tabel Receiving dan sheet hitungan, Review Count, sheet PO, kartu board dengan strip "Edited −N", dialog Move back dan Cancel. Yang baru: kolom departemen sesuai prototype (Ops: Workload, Receiving, Board, Return PO, Activity Log; Allotment: Allotments, Return to HO, New Allotment), board lima lajur versi prototype (Pick List, Picked, Pack, Dispatch, Received), sheet kartu board, sheet allotment versi prototype (Lines: Store/Quantity, stepper saat Edit), frame HP app toko (Receive, Return to HO), daftar Return to HO dan Return PO dengan stempel.

### Bab 1 · Empat kata
Tidak ada layar hub. Tabel Four verbs yang sudah ada tetap dipakai.

### Bab 2 · PO → DC (skenario "Short: 585 of 600" di prototype)
Sesi desain menambahkan skenario yang sama dengan naskah: PO-041026-010, Garmen AA, UD, dipesan 600, dihitung 585, Not as Ordered 15. Ops › Receiving: baris "585 pcs · + 15 pcs Not as Ordered" → sheet hitungan (Review: Waiting) → Recall Count → dialog "Recall this count?" → hitung lagi → Submit count. Procurement › Purchase Orders → sheet PO → Review Count → Recount (alasan, kirim balik untuk dihitung) → hitung lagi → Review Count: Recount / Close Short / Partial Receive → Partial Receive: stempel PARTIALLY RECEIVED, sisa 15 tetap terbuka (Close Short: stempel CLOSED SHORT). Sheet hitungan sesudahnya: tidak ada Recall, hanya "Count again as evidence" dan "Report a difference". Return PO untuk 15 Not as Ordered.

Semua kalimat Bab 2 tetap.

### Bab 3 · DC → toko (data prototype: ALT-00000004, C001 · Cikupa 60, C002 · Muaro Bungo 40)
Ops › Board: Pick lalu Pack kedua kartu → Dispatch C002 saja (Part sent, 40 tetap terkirim) → Allotment › Allotments → ALT-00000004 → Edit C001 60 → 30 → Save → kartu Pack "Edited −30", "60 → 30 pcs −30" → Move back → dialog → "Move back 30 pcs" → Dispatch C001 → sheet kartu In transit terkunci ("Sent stays sent…") → Store app › Receive: hitung buta 28 → "2 missing", Completed · issue → sheet allotment "Completed · issue", tanpa Edit.

Kalimat yang tidak cocok:
- pick: usulan "Di jalur DC ke toko, barang yang sudah di-pick atau di-pack belum terkunci."
- rest: prototype tidak punya Close remaining; MD mengubah lewat Edit. Usulan: "Sisa 60 yang belum berangkat masih bisa dikurangi MD. Gudang mengembalikan kelebihannya dengan **Move back**."
- receipt: usulan "Receipt toko langsung tercatat begitu di-Submit: **Completed**, atau **Completed · issue** kalau ada selisih. Tidak ada Recall; Inventory yang memeriksa selisihnya."
- Dialog Cancel allotment ada di prototype tapi tidak punya kalimat; usul tidak ditampilkan (sudah ada di film Outbound).

### Bab 4 · Retur (data cocok dengan naskah)
Store return: Allotment › Return to HO → New return (20) → Store app › Return to HO: Actual 15, chip "Why fewer?" → Pack and send 15 → Ops › Receiving › Store returns: hitung 15 → sheet MD "Received · open 5" dengan catatan "The open 5 is not a receiving shortage". DC → supplier: Procurement › Return PO → RS-00000007 → dialog Cancel return ("Stock and reservation · freed, not only a status") → Ops › Return PO: Pick and pack 20 → Hand over → stempel HANDED OVER, catatan terkunci → Replacement / Refund / Credit note dan Close short. Semua kalimat Bab 4 tetap.

### Bab 5 · Yang tidak bisa mundur
Tabel Cannot go back dan catatan "Partly processed" tetap visual konsep (tidak ada layar hub). Kasus Recall bersamaan dengan Accept diganti dialog hub dari alur 1: "This count cannot be recalled" (sisi penghitung) dan "This count was recalled" (sisi reviewer). Retry setelah koneksi putus tidak punya layar hub; kartu konsepnya tetap.

Perkiraan: 3 kalimat Bab 3 disuarakan ulang (pick, rest, receipt), layar Bab 2–4 digambar ulang, Bab 1 dan 5 hampir tetap.
