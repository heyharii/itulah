#!/usr/bin/env node
/**
 * The design rules PATTERN.md states, checked mechanically.
 *
 * Prose in a markdown file is not a gate. These five are the ones that silently
 * break the language rather than the build:
 *
 *  - a raw px type size defeats the baked 0.9 density, and it is the single most
 *    common defect in the app this one replaces (128 literals in one folder);
 *  - a hex colour is a value nobody can retheme;
 *  - `font-bold` is the fourth weight DESIGN.md forbids;
 *  - a dark overlay is the one move that makes a screen stop being Cloud Hub;
 *  - a `:root` token that no longer matches the console's — the slowest of the
 *    five to notice by eye, and the only one that goes wrong while nobody here
 *    touches anything. See `token-parity` at the foot of this file.
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
          console.log(
            `${rel}:${index + 1}  ${rule.id}  ${hit[0].trim().slice(0, 70)}`,
          )
          console.log(`    ${rule.say}`)
        }
      }
    })
}

/**
 * The fifth rule, and the one that needed a machine rather than a sentence.
 *
 * This app's README has claimed "the tokens of `frontend-hub`, byte for byte"
 * since the day it was written, and twice now that claim has quietly stopped
 * being true — the console re-cut its palette, nothing here failed, and the
 * till simply looked a generation old until somebody noticed by eye. A promise
 * that only a human can check is a promise that expires.
 *
 * Only the `:root` block is compared, which is exactly the shared half: the
 * palette, the geometry, the shadows and the motion bands. The type scale
 * lives in `@theme` and is deliberately this app's own — it is read standing
 * up, at arm's length, and it is a step larger than the console's on purpose.
 *
 * Missing when the console is not checked out: skipped, not failed. A sibling
 * folder is not a build dependency.
 */
const HUB = join(ROOT, "..", "frontend-hub", "src", "styles", "index.css")

function rootTokens(file) {
  const css = readFileSync(file, "utf8")
  const start = css.indexOf(":root {")
  if (start === -1) return null
  const block = css.slice(start, css.indexOf("\n}", start))
  const tokens = new Map()
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(name, value.trim().replace(/\s+/g, " "))
  }
  return tokens
}

let drift = 0
try {
  const hub = rootTokens(HUB)
  const till = rootTokens(join(SRC, "styles", "index.css"))
  if (hub !== null && till !== null) {
    for (const [name, value] of hub) {
      const mine = till.get(name)
      if (mine === value) continue
      drift += 1
      console.log(
        mine === undefined
          ? `token-parity  --${name} is missing; the console has \`${value}\``
          : `token-parity  --${name} is \`${mine}\`; the console has \`${value}\``,
      )
    }
    if (drift > 0) {
      console.log(
        `    the design system is one file — copy the console's \`:root\`, or\n` +
          `    write down here why this token is the till's own`,
      )
    }
  }
} catch {
  // frontend-hub is not checked out beside this one. Nothing to compare.
}

const total = findings + drift
console.log(
  total === 0
    ? "design-lint: clean"
    : `\ndesign-lint: ${total} finding${total === 1 ? "" : "s"}`,
)
if (total > 0) process.exit(1)
