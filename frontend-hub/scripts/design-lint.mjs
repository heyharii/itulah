#!/usr/bin/env node
/**
 * The design rules PATTERN.md states, checked mechanically.
 *
 * Prose in a markdown file is not a gate. These four are the ones that silently
 * break the language rather than the build:
 *
 *  - a raw px type size defeats the baked 0.9 density, and it is the single most
 *    common defect in the app this one replaces (128 literals in one folder);
 *  - a hex colour is a value nobody can retheme;
 *  - `font-bold` is the fourth weight DESIGN.md forbids;
 *  - a dark overlay is the one move that makes a screen stop being Cloud Hub.
 *
 * Geometry in px (`size-[17px]`, `w-[248px]`) is NOT flagged: those are measured
 * boxes and icons, and the density is carried by the type scale.
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

/**
 * `cn()` must keep a named type size next to a named colour.
 *
 * `text-*` is ambiguous in Tailwind — font-size and text-colour share the
 * namespace — so `twMerge` has to be told this app's scale or it guesses every
 * unknown name is a colour and throws the size away. It fails silently: the
 * heading is simply the wrong size, and the one black CTA loses its white
 * text. This is checked rather than trusted because the failure leaves no
 * trace anywhere else.
 */
const PAIRS = [
  ["text-card-title font-semibold text-ink", "a card title"],
  ["text-hero font-semibold text-ink", "a page title"],
  ["text-meta text-body", "prose meta"],
  ["text-eyebrow text-mute", "an eyebrow label"],
  ["text-id text-body", "a mono id"],
  ["bg-ink text-white text-card-title", "the black CTA"],
]
const { cn } = await import("../src/lib/utils.ts").catch(() => ({}))
if (typeof cn === "function") {
  for (const [classes, what] of PAIRS) {
    if (cn(classes) !== classes) {
      findings += 1
      console.log(`src/lib/utils.ts  cn-drops-size  ${what}`)
      console.log(`    cn("${classes}") → "${cn(classes)}" — teach twMerge the scale`)
    }
  }
}

console.log(
  findings === 0
    ? "design-lint: clean"
    : `\ndesign-lint: ${findings} finding${findings === 1 ? "" : "s"}`,
)
if (findings > 0) process.exit(1)
