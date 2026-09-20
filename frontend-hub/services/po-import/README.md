# PO import service

Pipeline di balik **Procurement → Import PO** di frontend-hub: beberapa file
(Excel / PDF / foto) masuk, draf PO keluar. Service ini **tidak pernah** membuat
PO — pembuatan PO hanya terjadi lewat tombol di review summary layar hub,
yang memanggil endpoint cloud yang sudah ada.

## Menjalankan

```sh
cd frontend-hub/services/po-import
npm install
npm start          # port 8094 default (PORT=...)
```

Dev server / preview Vite di frontend-hub sudah mem-proxy `/po-import` ke
`http://127.0.0.1:8094` (lihat `vite.config.ts`).

## Environment

| Variabel | Perlu | Arti |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | ya, untuk Jev | Vercel AI Gateway. Tanpa ini semua keputusan jatuh ke aturan deterministik (ditandai jelas di report per file). |
| `OPENPARSER_API_KEY` | disarankan | OpenParser — OCR (`paddleocr-vl-1.6`) + ekstraksi schema (`/extract`). |
| `OPENPARSER_OCR_MODEL` | opsional | default `paddleocr-vl-1.6`. |
| `OPENPARSER_LLM_MODEL` | opsional | default `openai/gpt-5.6-terra`. |
| `LITEPARSE_BIN` | opsional | path ke CLI `litparse` (LiteParse + Tesseract) — fallback OCR lokal saat OpenParser tidak dikonfigurasi. |
| `LITEPARSE_OCR_LANGUAGE` | opsional | default `ind+eng`. |
| `PORT` | opsional | default `8094`. |

## Endpoint

- `GET /healthz` → `{ gateway, openparser, liteparse }`.
- `POST /v1/ingest` — multipart, field file apa saja (xlsx/xls/csv, pdf, png/jpg/jpeg/webp/heic).
  Jawab: `{ reports: FileReport[], drafts: PoDraft[] }`. Draf sudah dikelompokkan:
  file-file yang menyebut supplier + nomor PO yang sama dilebur jadi satu draf.
- `POST /v1/validate` — `{ draft, answers }` → `{ draft }`. Jawaban wizard digabung;
  field yang tadinya hasil ekstraksi dinilai ulang Jev — yang belum settle tetap jadi pertanyaan.

## Keputusan oleh Jev (`typesafe-ai/jev`, via `experimental_evaluate` dari `ai`)

1. **Per halaman PDF: perlu OCR atau tidak?** Halaman tanpa teks → OCR
   (deterministik, tidak ada yang dinilai); halaman dengan teks utuh → dibaca
   lokal (pdfjs); yang meragukan ditanya ke Jev. Pola yang sama dengan
   [doc-router](https://github.com/misbahsy/doc-router).
2. **Per field hasil ekstraksi: layak dipakai atau harus ditanyakan?** Di bawah
   ambang (`USABLE = 0.7`) field jadi pertanyaan wizard, bukan fakta senyap.
3. **Setelah dijawab: sudah resolve atau belum?** (`RESOLVED = 0.8`).

## Batas yang jujur

- Jalur lokal (tanpa OpenParser) memakai heuristik regex untuk ekstraksi —
  field yang ditemukan ditandai tidak yakin sehingga wizard menanyakannya;
  heuristik tidak mengarang field.
- `litparse` dipanggil sebagai CLI eksternal; kalau outputnya bukan JSON,
  stdout polos dipakai sebagai teks.
