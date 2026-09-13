/**
 * The design language, checked mechanically.
 *
 * Prose in a comment is not a gate. These are the four rules that break the
 * language SILENTLY — the build stays green, the types stay happy, and the app
 * quietly stops looking like itself:
 *
 *  - a raw px or rem type size escapes the scale in `styles/index.css`, which
 *    every other size hangs off. This is the most common defect in the app this
 *    one replaces: 128 literals in one folder.
 *  - a hex colour is a value nobody can retheme, and it will be the one thing
 *    still light when a dark ground is ever added.
 *  - `font-bold` is a fourth weight. Three exist: 400, 500, 600.
 *  - a dark overlay. Nothing in this system darkens — a sheet washes what is
 *    behind it toward near-white, and a black scrim is the single most
 *    recognisable way a screen stops belonging to this app.
 *
 * Exemptions are deliberate and few, and each says why in `ALLOWED` below.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const RULES = [
  {
    name: "raw type size",
    // `text-[13px]` / `text-[0.8rem]` — a size outside the scale.
    find: /\btext-\[[0-9.]+(px|rem|em)\]/g,
    why: "use a token from @theme (text-cell, text-ctl, text-label …)",
  },
  {
    name: "hex colour",
    find: /(?:bg|text|border|fill|stroke|ring|shadow)-\[#[0-9a-fA-F]{3,8}\]/g,
    why: "use a colour token (text-ink, bg-side, border-line …)",
  },
  {
    name: "fourth weight",
    find: /\bfont-(bold|extrabold|black|light|thin)\b/g,
    why: "three weights exist: font-normal, font-medium, font-semibold",
  },
  {
    name: "dark overlay",
    find: /bg-(black|neutral-[89]00|zinc-[89]00|gray-[89]00)\/[0-9]+/g,
    why: "the veil is white — use bg-[var(--veil)]",
  },
]

/**
 * What is allowed to break a rule, and why.
 *
 * A list rather than an inline comment marker, so adding one is a decision
 * somebody makes in this file rather than a `// eslint-disable` nobody reviews.
 */
const ALLOWED = [
  // The row hover is one step lighter than `--hover` and exists only here. It
  // is a wash under a 48px row, not a surface anything else stands on, and
  // naming it as a token would put a sixth near-white in a palette that reads
  // as five.
  { file: "src/kit/table.tsx", text: "bg-[#fbfbfa]" },
]

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.tsx?$/.test(path)) files.push(path)
  }
})("src")

let bad = 0
for (const file of files) {
  const source = readFileSync(file, "utf8")
  source.split("\n").forEach((line, index) => {
    for (const rule of RULES) {
      for (const hit of line.match(rule.find) ?? []) {
        if (ALLOWED.some((a) => file.endsWith(a.file) && hit === a.text)) continue
        bad += 1
        console.log(`${file}:${index + 1}  ${rule.name}: ${hit}`)
        console.log(`    ${rule.why}`)
      }
    }
  })
}

if (bad > 0) {
  console.log(`\n${bad} place${bad === 1 ? "" : "s"} break the design language.`)
  process.exit(1)
}
console.log(`design-lint: ${files.length} files, clean.`)
