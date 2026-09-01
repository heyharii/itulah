#!/usr/bin/env node
/**
 * The Cloud Hub rules, checked mechanically.
 *
 * Prose in a markdown file is not a gate. These are the ones that silently
 * break the language rather than the build:
 *
 *  - a raw px type size sidesteps the named scale in `styles/index.css`, and a
 *    scale nobody has to use is a scale that drifts;
 *  - a hex colour is a value nobody can retheme;
 *  - `font-bold` is the fourth weight DESIGN.md forbids;
 *  - a dark overlay is the one move that makes a screen stop being Cloud Hub;
 *  - a `dark:` variant is a second palette. This app has one — "always light,
 *    nothing ever darkens" — and the theme toggle it used to ship was removed
 *    for exactly that reason. A stray `dark:` would quietly start rebuilding it.
 *
 * Geometry in px (`size-[17px]`, `h-[3.375rem]`) is NOT flagged: those are
 * measured boxes and touch targets, and the density is carried by the type
 * scale.
 *
 * Run: npm run design-lint
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")

/** The file that defines the tokens is allowed to hold raw values. */
const DEFINES_TOKENS = new Set(["src/styles/index.css"])

const RULES = [
  {
    id: "px-type-size",
    pattern: /\btext-\[[\d.]+px\]/,
    say: "raw px type size — use the named scale, or a `declared/16` rem value",
  },
  {
    id: "hex-colour",
    pattern: /(?:className|style)=[^\n]*#[0-9a-fA-F]{3,8}\b/,
    say: "hex colour — use a token (`text-ink`, `bg-soft`, `border-hairline`)",
  },
  {
    id: "fourth-weight",
    pattern: /\bfont-(?:bold|extrabold|black|light|thin)\b/,
    say: "only font-normal / font-medium / font-semibold exist in this language",
  },
  {
    id: "dark-overlay",
    pattern: /bg-black\/|bg-\[rgba\(0,\s*0,\s*0/,
    say: "dark overlay — overlays sit on the white veil: `bg-[var(--scrim)]`",
  },
  {
    id: "dark-variant",
    pattern: /\bdark:[a-z-]/,
    say: "this surface has one palette — see `styles/index.css` on why the theme toggle went",
  },
]

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.(tsx?|css)$/.test(entry)
        ? [full]
        : []
  })
}

let findings = 0
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file)
  if (DEFINES_TOKENS.has(rel)) continue
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      // A rule quoted in a comment is documentation, not a violation.
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return
      for (const rule of RULES) {
        const hit = rule.pattern.exec(line)
        if (hit) {
          findings += 1
          console.log(`${rel}:${index + 1}  ${rule.id}  ${hit[0].trim().slice(0, 70)}`)
          console.log(`    ${rule.say}`)
        }
      }
    })
}

console.log(
  findings === 0
    ? "design-lint: clean"
    : `\ndesign-lint: ${findings} finding${findings === 1 ? "" : "s"}`,
)
if (findings > 0) process.exit(1)
