#!/usr/bin/env node
/**
 * check-retail-css — penegak daftar tertutup.
 *
 * `KEPUTUSAN-DESIGN-SYSTEM-2026-08-25` menyimpulkan bahwa dari empat design
 * system yang pernah dipakai, yang bertahan adalah yang PUNYA PENEGAK, bukan
 * yang punya dokumen. Skrip penegaknya sendiri (`check-atelier.mjs`) sudah
 * tidak ada lagi di tree — dan itulah kenapa sistem kelima lahir.
 *
 * Berkas ini adalah penegak itu. Ia memeriksa satu hal saja, dan memeriksanya
 * dengan keras: WARNA, RADIUS, dan BAYANGAN hanya boleh ada di `retail.css`.
 * Tata letak — flex, grid, padding, lebar — bebas, karena tata letak memang
 * milik tiap layar.
 *
 * Jalankan:  node check-retail-css.mjs
 * Keluar 1 kalau ada pelanggaran, supaya bisa dipasang di CI apa adanya.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = "retail.css";

/* Kelas yang benar-benar didefinisikan sebuah stylesheet. Dipakai aturan
   "kelas-tak-dikenal": sebuah kelas yang dipakai di markup tapi tidak pernah
   punya aturan CSS di mana pun tidak melempar error apa pun — halamannya
   cuma tampil salah, diam-diam. Itu persis cara `fchips` lolos ke produksi. */
function classesIn(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  return new Set([...clean.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]));
}
const BASE_CLASSES = classesIn(readFileSync(join(HERE, SOURCE), "utf8"));

/* Nilai yang boleh muncul di layar meski bukan token: keduanya bukan warna
   merek, dan keduanya memang milik satu tempat.
     - rgba putih pada sorot tombol terisi (inset highlight)
     - `#fff` pada teks di atas permukaan berwarna penuh */
const ALLOWED_INLINE = [
  /rgba\(255,\s*255,\s*255,\s*\.?\d+\)/g,
  /#fff\b/g,
];

const RULES = [
  {
    id: "hex",
    what: "warna heksadesimal",
    why: "Warna hanya boleh datang dari token di retail.css. Hex di layar adalah warna yang tidak bisa ikut berganti tema.",
    find: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    id: "oklch",
    what: "oklch() langsung",
    why: "Sama seperti hex: nilainya harus punya nama di retail.css supaya bisa ditukar sekali untuk semua layar.",
    find: /oklch\(/g,
  },
  {
    id: "shadow",
    what: "box-shadow tertulis sendiri",
    why: "Tangga bayangan tertutup: --shadow-xs sampai --shadow-overlay. Bayangan karangan membuat dua permukaan yang sama terasa beda tinggi.",
    // Yang memakai var(--shadow-…) atau var(--line…) sebagai cincin dibiarkan.
    // Sorot inset putih pada tombol terisi bukan tangga elevasi — ia bagian
    // dari bentuk tombolnya, dan sudah ada di ALLOWED_INLINE.
    find: /box-shadow:\s*(?!.*var\(--)(?!\s*inset\s+0\s+1px\s+0\s*;)[^;]+;/g,
  },
  {
    id: "radius",
    what: "border-radius bernilai bebas",
    why: "Radius tertutup: chip 6, kontrol 8, kartu 10, jendela 14, pil 999.",
    find: /border-radius:\s*(?!.*var\(--)(?!999px)(?!50%)(?!0)(?!inherit)[^;]+;/g,
  },
];

function scan() {
  const files = readdirSync(HERE)
    .filter((f) => f.endsWith(".html"))
    .sort();

  if (!files.length) {
    console.error("Tidak ada berkas .html untuk diperiksa.");
    process.exit(1);
  }

  const violations = [];
  let linked = 0;

  for (const file of files) {
    const text = readFileSync(join(HERE, file), "utf8");

    /* Layar yang belum menaut retail.css dilaporkan sebagai temuan tersendiri,
       bukan diabaikan — layar yang membawa skinnya sendiri persis masalah yang
       berkas ini ada untuk mencegahnya. */
    if (!text.includes(SOURCE)) {
      violations.push({ file, rule: "belum-tertaut", line: 0, snippet: `tidak menaut ${SOURCE}` });
      continue;
    }
    linked += 1;

    /* Komentar dikosongkan DI TEMPAT, bukan dibuang: menghapusnya menggeser
       nomor baris, dan penunjuk yang meleset membuat orang berhenti percaya
       pada pemeriksanya. Baris baru dipertahankan, isinya diganti spasi. */
    const blank = (m) => m.replace(/[^\n]/g, " ");

    /* Aturan ini hanya berlaku di dalam <style>. Alasannya bukan kelonggaran:
       warna di JS adalah DATA TENTANG DUNIA — warna kain sebuah artikel, rona
       avatar yang diturunkan dari nama orang. Keduanya tidak punya peran UI,
       tidak ikut berganti tema, dan tidak mungkin jadi token. Yang dijaga
       berkas ini adalah warna yang menyatakan PERAN, dan peran cuma ditulis
       di stylesheet. Selebihnya dikosongkan di tempat supaya nomor barisnya
       tetap benar. */
    let body = blank(text);
    for (const m of text.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      const start = m.index + "<style>".length;
      body = body.slice(0, start) + m[1] + body.slice(start + m[1].length);
    }
    body = body
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\/\*[\s\S]*?\*\//g, blank);
    for (const allowed of ALLOWED_INLINE) body = body.replace(allowed, blank);

    /* Kelas yang dipakai markup harus punya definisi — di retail.css atau di
       <style> layar itu sendiri. Token yang jelas hasil perangkaian string JS
       (mengandung kutip, tanda tambah, titik) dilewati: itu potongan ekspresi,
       bukan nama kelas. */
    const own = new Set();
    for (const m of text.matchAll(/<style>([\s\S]*?)<\/style>/g))
      for (const c of classesIn(m[1])) own.add(c);
    /* Dipindai dari `text`, bukan `body`: `body` sengaja mengosongkan seluruh
       markup dan hanya menyisakan <style>, jadi tidak ada satu pun atribut
       class yang tersisa di sana. */
    const markup = text.replace(/<!--[\s\S]*?-->/g, blank);
    const used = new Map();
    for (const m of markup.matchAll(/class="([^"]*)"/g))
      for (const token of m[1].split(/\s+/))
        if (/^[a-z][a-z0-9-]*$/.test(token) && !used.has(token))
          used.set(token, markup.slice(0, m.index).split("\n").length);
    for (const [cls, line] of used)
      if (!BASE_CLASSES.has(cls) && !own.has(cls))
        violations.push({
          file, rule: "kelas-tak-dikenal", line,
          snippet: `.${cls} dipakai tapi tidak pernah didefinisikan`,
          why: "Kelas tanpa aturan CSS tidak melempar error — halamannya cuma tampil salah tanpa suara. Definisikan di retail.css kalau ia primitif bersama, atau di <style> layar kalau ia milik layar itu.",
        });

    const lines = body.split("\n");
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        const hits = line.match(rule.find);
        if (!hits) return;
        violations.push({
          file,
          rule: rule.id,
          line: i + 1,
          snippet: hits[0].trim().slice(0, 72),
          why: rule.why,
        });
      });
    }
  }

  return { files, linked, violations };
}

const { files, linked, violations } = scan();

console.log(`Diperiksa ${files.length} layar · ${linked} menaut ${SOURCE}\n`);

if (!violations.length) {
  console.log("Bersih. Warna, radius, dan bayangan seluruhnya datang dari retail.css.");
  process.exit(0);
}

const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v);
}

for (const [file, list] of byFile) {
  console.log(`  ${file}`);
  for (const v of list.slice(0, 8)) {
    console.log(`    ${String(v.line).padStart(4)}  ${v.rule.padEnd(14)} ${v.snippet}`);
  }
  if (list.length > 8) console.log(`    …dan ${list.length - 8} lagi`);
  console.log("");
}

const kinds = [...new Set(violations.map((v) => v.rule))];
console.log(`${violations.length} pelanggaran di ${byFile.size} berkas.\n`);
for (const kind of kinds) {
  /* Alasannya diambil dari temuannya sendiri, bukan dari RULES: aturan yang
     hidup di luar RULES (kelas tak dikenal, belum tertaut) juga membawa `why`,
     dan mencetak alasan aturan lain lebih buruk daripada tidak mencetak apa-apa. */
  const why = violations.find((v) => v.rule === kind)?.why
    ?? "Layar harus menaut retail.css, bukan membawa skinnya sendiri.";
  console.log(`  ${kind}: ${why}`);
}

process.exit(1);
