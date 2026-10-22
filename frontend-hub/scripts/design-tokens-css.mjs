#!/usr/bin/env node
/**
 * Rebuild design-system/tokens.css from design-system/tokens.json.
 *
 * tokens.json is the Central design system's tokens as data (the shape the
 * Design System artifact reads); tokens.css is the same values as CSS
 * variables, for prototypes and the static previews in design-system/previews.
 * The app itself never imports either: its values live in src/styles.
 *
 * Run: node scripts/design-tokens-css.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "design-system")
const tokens = JSON.parse(readFileSync(join(DIR, "tokens.json"), "utf8"))

const value = (v) => (typeof v === "string" ? v : v.light)
const alias = (v) => {
  const m = /^\{(.+)\}$/.exec(v)
  return m ? `var(--${m[1]})` : v
}

let css = `/* Central — generated from tokens.json. Do not edit by hand: change tokens.json (and the hub's styles/index.css or white.css it mirrors), then run node scripts/design-tokens-css.mjs. */\n:root {\n`
for (const t of tokens.color.tokens) css += `  --${t.name}: ${alias(value(t.value))};\n`
for (const t of tokens.shadow.tokens) css += `  --${t.name}: ${value(t.value)};\n`
for (const family of ["spacing", "size", "radius", "duration", "easing"])
  for (const t of tokens[family].tokens) css += `  --${t.name}: ${t.value};\n`
for (const [key, stack] of Object.entries(tokens.type.families))
  css += `  --font-${key}: ${stack};\n`
css += `}\n`
for (const group of tokens.type.groups)
  for (const s of group.styles)
    css += `.ds-text-${s.name} { font-family: var(--font-${s.family ?? group.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ""} }\n`
css += `@font-face { font-family: "Inter Variable"; src: url("../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2") format("woff2"); font-weight: 100 900; font-style: normal; font-display: swap; }\n`

writeFileSync(join(DIR, "tokens.css"), css)
console.log(`design-system/tokens.css: ${css.split("\n").length - 1} lines`)
